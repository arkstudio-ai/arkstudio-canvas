import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const KEY_MAX_AGE_DAYS = 'history.maxAgeDays';
const KEY_MAX_PER_KIND = 'history.maxPerKind';
const CACHE_TTL_MS = 30_000;

/** Built-in defaults applied when no admin override exists in DB. */
export const DEFAULT_MAX_AGE_DAYS = 30;
export const DEFAULT_MAX_PER_KIND = 500;

/** Throttle window for inline prunes triggered from the write path. */
const LAZY_PRUNE_MIN_INTERVAL_MS = 10 * 60 * 1000; // 10 min

/**
 * The set of nodeType buckets we cap independently. Anything outside this
 * list is capped under the same overall age limit but does not get a
 * "max per kind" treatment (it would never be present in current
 * generation flow nodes; we only persist outputs of these four).
 */
const TRACKED_KINDS = ['image', 'video', 'audio', 'text'] as const;
export type HistoryKind = typeof TRACKED_KINDS[number];

interface CachedNumber {
  value: number | null;
  expiresAt: number;
}

export interface HistoryRetentionView {
  /** Effective day window (DB override OR DEFAULT_MAX_AGE_DAYS). 0 = disabled. */
  maxAgeDays: number;
  maxAgeDaysDefault: number;
  maxAgeDaysConfigured: boolean;
  /** Effective per-kind cap (DB override OR DEFAULT_MAX_PER_KIND). 0 = disabled. */
  maxPerKind: number;
  maxPerKindDefault: number;
  maxPerKindConfigured: boolean;
  /** Per-kind row counts at the time of the read. */
  counts: Record<HistoryKind | 'total', number>;
  /** Last prune attempt timestamp (epoch ms) and how many rows it deleted. */
  lastPruneAt: string | null;
  lastPruneDeleted: number;
}

export interface PruneOutcome {
  ageDeleted: number;
  perKindDeleted: number;
  total: number;
  ranAt: string;
}

/**
 * Lifecycle controller for the `generation_history` table.
 *
 * Open-source build keeps the table small without running a cron job: every
 * write path on `GenerationHistoryService.record` calls `pruneIfNeeded` which
 * is throttled to once per `LAZY_PRUNE_MIN_INTERVAL_MS` (10 min). The admin
 * UI can also trigger an immediate prune through `pruneNow()`.
 *
 * Both knobs are stored in `global_configs`:
 *   - history.maxAgeDays   (number, 0 = no age limit)
 *   - history.maxPerKind   (number, 0 = no count limit)
 *
 * `lastPrune*` are kept in-memory only; admins reading the page fresh after
 * a backend restart will see "未运行" until the next prune fires. That's
 * acceptable -- it's a debugging hint, not a billable metric.
 */
@Injectable()
export class HistoryRetentionService {
  private readonly logger = new Logger(HistoryRetentionService.name);
  private maxAgeCache: CachedNumber | null = null;
  private maxPerKindCache: CachedNumber | null = null;
  private lastPruneAt = 0;
  private lastPruneDeleted = 0;

  constructor(private readonly prisma: PrismaService) {}

  // ---- runtime accessors ---------------------------------------------------

  async getMaxAgeDays(): Promise<number> {
    const cached = this.readCached(this.maxAgeCache);
    if (cached !== undefined) return cached ?? DEFAULT_MAX_AGE_DAYS;
    const row = await this.prisma.globalConfig.findUnique({ where: { key: KEY_MAX_AGE_DAYS } });
    const v = this.unwrapNumberValue(row?.value);
    this.maxAgeCache = { value: v, expiresAt: Date.now() + CACHE_TTL_MS };
    return v ?? DEFAULT_MAX_AGE_DAYS;
  }

  async getMaxPerKind(): Promise<number> {
    const cached = this.readCached(this.maxPerKindCache);
    if (cached !== undefined) return cached ?? DEFAULT_MAX_PER_KIND;
    const row = await this.prisma.globalConfig.findUnique({ where: { key: KEY_MAX_PER_KIND } });
    const v = this.unwrapNumberValue(row?.value);
    this.maxPerKindCache = { value: v, expiresAt: Date.now() + CACHE_TTL_MS };
    return v ?? DEFAULT_MAX_PER_KIND;
  }

  // ---- prune ---------------------------------------------------------------

  /**
   * Called from `GenerationHistoryService.record` after every successful
   * insert. Returns immediately if the throttle window hasn't elapsed so
   * high-frequency writes don't pay the prune cost on every call.
   *
   * Errors are swallowed (logged at warn) -- a failed cleanup must NOT
   * propagate up and fail the user-facing record write.
   */
  async pruneIfNeeded(): Promise<void> {
    if (Date.now() - this.lastPruneAt < LAZY_PRUNE_MIN_INTERVAL_MS) return;
    try {
      await this.pruneNow();
    } catch (e) {
      this.logger.warn(
        `[history-retention] lazy prune failed (will retry next tick): ${(e as Error).message}`,
      );
    }
  }

  /**
   * Manual trigger from the admin UI. Always runs end-to-end regardless of
   * the throttle window; updates `lastPrune*` so the page reflects it.
   */
  async pruneNow(): Promise<PruneOutcome> {
    const maxAgeDays = await this.getMaxAgeDays();
    const maxPerKind = await this.getMaxPerKind();

    let ageDeleted = 0;
    if (maxAgeDays > 0) {
      const cutoff = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000);
      const r = await this.prisma.generationHistory.deleteMany({
        where: { createdAt: { lt: cutoff } },
      });
      ageDeleted = r.count;
    }

    let perKindDeleted = 0;
    if (maxPerKind > 0) {
      for (const kind of TRACKED_KINDS) {
        // findMany + deleteMany dance: Prisma has no LIMIT on deleteMany,
        // so we fetch the ids we want gone (rows older than the Nth most
        // recent) and delete by id. Cheap because the typical overflow is
        // single-digit.
        const overflow = await this.prisma.generationHistory.findMany({
          where: { nodeType: kind },
          orderBy: { createdAt: 'desc' },
          skip: maxPerKind,
          select: { id: true },
        });
        if (overflow.length > 0) {
          const r = await this.prisma.generationHistory.deleteMany({
            where: { id: { in: overflow.map((o) => o.id) } },
          });
          perKindDeleted += r.count;
        }
      }
    }

    const total = ageDeleted + perKindDeleted;
    this.lastPruneAt = Date.now();
    this.lastPruneDeleted = total;
    if (total > 0) {
      this.logger.log(
        `[history-retention] pruned ${total} rows (age=${ageDeleted}, perKind=${perKindDeleted})`,
      );
    }
    return {
      ageDeleted,
      perKindDeleted,
      total,
      ranAt: new Date(this.lastPruneAt).toISOString(),
    };
  }

  // ---- admin surface -------------------------------------------------------

  async getViewPayload(): Promise<HistoryRetentionView> {
    const ageRow = await this.prisma.globalConfig.findUnique({ where: { key: KEY_MAX_AGE_DAYS } });
    const perKindRow = await this.prisma.globalConfig.findUnique({ where: { key: KEY_MAX_PER_KIND } });
    const ageStored = this.unwrapNumberValue(ageRow?.value);
    const perKindStored = this.unwrapNumberValue(perKindRow?.value);

    const total = await this.prisma.generationHistory.count();
    const counts: Record<HistoryKind | 'total', number> = {
      image: 0,
      video: 0,
      audio: 0,
      text: 0,
      total,
    };
    for (const kind of TRACKED_KINDS) {
      counts[kind] = await this.prisma.generationHistory.count({ where: { nodeType: kind } });
    }

    return {
      maxAgeDays: ageStored ?? DEFAULT_MAX_AGE_DAYS,
      maxAgeDaysDefault: DEFAULT_MAX_AGE_DAYS,
      maxAgeDaysConfigured: ageStored !== null,
      maxPerKind: perKindStored ?? DEFAULT_MAX_PER_KIND,
      maxPerKindDefault: DEFAULT_MAX_PER_KIND,
      maxPerKindConfigured: perKindStored !== null,
      counts,
      lastPruneAt: this.lastPruneAt > 0 ? new Date(this.lastPruneAt).toISOString() : null,
      lastPruneDeleted: this.lastPruneDeleted,
    };
  }

  /**
   * Admin patch.
   *
   *   - undefined        → field untouched
   *   - negative         → clear (revert to DEFAULT_*)
   *   - 0                → upsert as 0; runtime treats 0 as "knob disabled"
   *   - positive integer → upsert
   *
   * The 0-vs-negative distinction matters because admins can explicitly say
   * "do not enforce this dimension" by saving 0, separate from "I want the
   * built-in default back" (negative).
   */
  async updateSettings(input: {
    maxAgeDays?: number;
    maxPerKind?: number;
  }): Promise<void> {
    if (input.maxAgeDays !== undefined) {
      await this.upsertNumber(KEY_MAX_AGE_DAYS, input.maxAgeDays, 'history max age (days)');
      this.maxAgeCache = null;
    }
    if (input.maxPerKind !== undefined) {
      await this.upsertNumber(KEY_MAX_PER_KIND, input.maxPerKind, 'history max rows per kind');
      this.maxPerKindCache = null;
    }
  }

  // ---- internals -----------------------------------------------------------

  private async upsertNumber(key: string, raw: number, description: string): Promise<void> {
    // Negative or non-finite => clear the row so reads fall back to DEFAULT_*.
    if (!Number.isFinite(raw) || raw < 0) {
      await this.prisma.globalConfig.deleteMany({ where: { key } });
      return;
    }
    const clamped = Math.floor(raw);
    await this.prisma.globalConfig.upsert({
      where: { key },
      create: { key, value: clamped, description: `${description} (admin-set)` },
      update: { value: clamped },
    });
  }

  private readCached<T>(slot: { value: T; expiresAt: number } | null): T | undefined {
    if (!slot) return undefined;
    if (slot.expiresAt < Date.now()) return undefined;
    return slot.value;
  }

  private unwrapNumberValue(value: unknown): number | null {
    if (value === null || value === undefined) return null;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
      const n = Number(value);
      return Number.isFinite(n) ? n : null;
    }
    if (typeof value === 'object' && value !== null && 'value' in (value as any)) {
      return this.unwrapNumberValue((value as any).value);
    }
    return null;
  }
}
