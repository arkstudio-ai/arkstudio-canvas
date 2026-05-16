import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { AxiosProxyConfig } from 'axios';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Network proxy settings — managed in admin, applied at the
 * `process.env.HTTP_PROXY` / `HTTPS_PROXY` level so axios's built-in
 * env-based proxy detection (axios v1 default behaviour) sees them
 * without provider-by-provider changes.
 *
 * Why mutate process.env at runtime
 *   axios v1 reads HTTP_PROXY / HTTPS_PROXY from env per request, not
 *   cached at instance level — so flipping the env at runtime takes
 *   effect on the next call. This lets admin edits land without a
 *   backend restart, matching the rest of the canvas-config pattern.
 *
 * Why a `disabled` flag instead of clearing the strings
 *   Users in China typically have HTTPS_PROXY set in their shell for
 *   翻墙 to OpenAI/etc., which BREAKS DashScope / Volcengine (国内厂商
 *   走代理慢/被拒). The `disabled` flag is "force direct" — it unsets
 *   the env at backend boot AND ignores the configured proxy strings.
 *   This is the safest default for an open-source desktop where we
 *   can't assume shell hygiene.
 *
 * Authoritative storage: `global_configs` rows
 *   - network.httpProxy   : plain string (e.g. http://127.0.0.1:7890)
 *   - network.httpsProxy  : plain string
 *   - network.disabled    : boolean (force-direct)
 *
 * Out of scope (deferred): NO_PROXY whitelist, per-vendor proxy routing
 * (e.g. only OpenAI traffic through proxy). Phase 1 is one global toggle.
 */

const KEY_HTTP_PROXY = 'network.httpProxy';
const KEY_HTTPS_PROXY = 'network.httpsProxy';
const KEY_DISABLED = 'network.disabled';

const CACHE_TTL_MS = 30_000;

interface CachedValue<T> {
  value: T;
  expiresAt: number;
}

@Injectable()
export class NetworkConfigService implements OnModuleInit {
  private readonly logger = new Logger(NetworkConfigService.name);
  private httpProxyCache: CachedValue<string | null> | null = null;
  private httpsProxyCache: CachedValue<string | null> | null = null;
  private disabledCache: CachedValue<boolean> | null = null;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Boot: read whatever's in DB and immediately apply to process.env. If
   * nothing is in DB, leave process.env untouched (= use whatever shell
   * exported, same behaviour as before this service existed).
   */
  async onModuleInit(): Promise<void> {
    await this.applyToEnv();
  }

  // ---- runtime accessors --------------------------------------------------

  async getDisabled(): Promise<boolean> {
    const cached = this.readCached(this.disabledCache);
    if (cached !== undefined) return cached;
    const row = await this.prisma.globalConfig.findUnique({
      where: { key: KEY_DISABLED },
    });
    const value = this.unwrapBoolValue(row?.value);
    this.disabledCache = { value, expiresAt: Date.now() + CACHE_TTL_MS };
    return value;
  }

  async getHttpProxy(): Promise<string | null> {
    const cached = this.readCached(this.httpProxyCache);
    if (cached !== undefined) return cached;
    const row = await this.prisma.globalConfig.findUnique({
      where: { key: KEY_HTTP_PROXY },
    });
    const value = this.unwrapStringValue(row?.value);
    this.httpProxyCache = { value, expiresAt: Date.now() + CACHE_TTL_MS };
    return value;
  }

  async getHttpsProxy(): Promise<string | null> {
    const cached = this.readCached(this.httpsProxyCache);
    if (cached !== undefined) return cached;
    const row = await this.prisma.globalConfig.findUnique({
      where: { key: KEY_HTTPS_PROXY },
    });
    const value = this.unwrapStringValue(row?.value);
    this.httpsProxyCache = { value, expiresAt: Date.now() + CACHE_TTL_MS };
    return value;
  }

  /**
   * Build an axios `proxy` option for one outbound request. Used by
   * providers that talk to *overseas* endpoints (OpenAI, OpenRouter, ...)
   * where the user typically needs the configured HTTP/S proxy.
   *
   * Why per-request explicit `proxy` and not env-based detection:
   *
   *   axios v1 reads HTTP(S)_PROXY from `process.env` per request, but
   *   the resulting http(s).Agent is cached in a process-wide pool. When
   *   the env flips between "proxy set" and "proxy cleared" mid-process
   *   (which is exactly what NetworkConfigService.applyToEnv does on
   *   admin save), the next call may reuse a stale agent and surface
   *   `ERR_ASSERTION / protocol mismatch`. Passing `proxy` (object or
   *   `false`) explicitly per-request bypasses env detection entirely
   *   and never collides with the pool.
   *
   * Semantics:
   *   - `disabled` flag set → returns `false` (force direct)
   *   - target is https → prefer `httpsProxy`, fall back to `httpProxy`
   *   - target is http  → prefer `httpProxy`, fall back to `httpsProxy`
   *   - no proxy configured → returns `false` (also bypasses pool)
   *
   * The returned `protocol` is the proxy *server*'s scheme (e.g. an
   * `http://127.0.0.1:7890` HTTP proxy tunnels HTTPS targets via
   * CONNECT — axios handles it natively in v1.x).
   */
  async getAxiosProxy(targetUrl: string): Promise<AxiosProxyConfig | false> {
    if (await this.getDisabled()) return false;
    const targetIsHttps = targetUrl.toLowerCase().startsWith('https:');
    const primary = targetIsHttps
      ? await this.getHttpsProxy()
      : await this.getHttpProxy();
    const fallback = targetIsHttps
      ? await this.getHttpProxy()
      : await this.getHttpsProxy();
    const raw = primary ?? fallback;
    if (!raw) return false;
    try {
      const u = new URL(raw);
      const protocol = (u.protocol === 'https:' ? 'https' : 'http') as
        | 'http'
        | 'https';
      const port = u.port
        ? Number(u.port)
        : protocol === 'https'
          ? 443
          : 80;
      const cfg: AxiosProxyConfig = { protocol, host: u.hostname, port };
      if (u.username || u.password) {
        cfg.auth = {
          username: decodeURIComponent(u.username),
          password: decodeURIComponent(u.password),
        };
      }
      return cfg;
    } catch {
      this.logger.warn(
        `[network-config] proxy URL parse failed: ${raw}; falling back to direct`,
      );
      return false;
    }
  }

  // ---- admin surface ------------------------------------------------------

  async getViewPayload(): Promise<{
    httpProxy: string;
    httpsProxy: string;
    disabled: boolean;
    /** Snapshot of process.env at view time — diagnostic, lets admin see what's
     *  actually in effect even if a stale shell env vs DB mismatches. */
    effective: {
      httpProxy: string | null;
      httpsProxy: string | null;
    };
  }> {
    const [httpProxy, httpsProxy, disabled] = await Promise.all([
      this.getHttpProxy(),
      this.getHttpsProxy(),
      this.getDisabled(),
    ]);
    return {
      httpProxy: httpProxy ?? '',
      httpsProxy: httpsProxy ?? '',
      disabled,
      effective: {
        httpProxy: process.env.HTTP_PROXY ?? process.env.http_proxy ?? null,
        httpsProxy: process.env.HTTPS_PROXY ?? process.env.https_proxy ?? null,
      },
    };
  }

  /**
   * Partial update. Semantics:
   *   - undefined → field untouched
   *   - empty string '' → clear DB row (env stops being overridden — falls back
   *     to whatever the shell originally exported)
   *   - non-empty string → upsert
   *
   * After write, re-apply to process.env so the next axios request sees it.
   */
  async updateSettings(input: {
    httpProxy?: string;
    httpsProxy?: string;
    disabled?: boolean;
  }): Promise<void> {
    if (input.httpProxy !== undefined) {
      const trimmed = input.httpProxy.trim();
      if (trimmed === '') {
        await this.prisma.globalConfig.deleteMany({
          where: { key: KEY_HTTP_PROXY },
        });
      } else {
        await this.prisma.globalConfig.upsert({
          where: { key: KEY_HTTP_PROXY },
          create: {
            key: KEY_HTTP_PROXY,
            value: trimmed,
            description: 'HTTP proxy URL (admin-set)',
          },
          update: { value: trimmed },
        });
      }
      this.httpProxyCache = null;
    }

    if (input.httpsProxy !== undefined) {
      const trimmed = input.httpsProxy.trim();
      if (trimmed === '') {
        await this.prisma.globalConfig.deleteMany({
          where: { key: KEY_HTTPS_PROXY },
        });
      } else {
        await this.prisma.globalConfig.upsert({
          where: { key: KEY_HTTPS_PROXY },
          create: {
            key: KEY_HTTPS_PROXY,
            value: trimmed,
            description: 'HTTPS proxy URL (admin-set)',
          },
          update: { value: trimmed },
        });
      }
      this.httpsProxyCache = null;
    }

    if (input.disabled !== undefined) {
      await this.prisma.globalConfig.upsert({
        where: { key: KEY_DISABLED },
        create: {
          key: KEY_DISABLED,
          value: input.disabled,
          description: 'Force direct (no proxy) — overrides http/httpsProxy',
        },
        update: { value: input.disabled },
      });
      this.disabledCache = null;
    }

    await this.applyToEnv();
  }

  // ---- internals ----------------------------------------------------------

  /**
   * Reflect current DB state onto process.env. Order:
   *   1. disabled = true → unset HTTP_PROXY / HTTPS_PROXY (both lowercase
   *      and uppercase forms — axios checks lowercase first by historical
   *      libcurl convention).
   *   2. disabled = false + httpProxy set → set HTTP_PROXY.
   *   3. disabled = false + httpProxy empty → leave env untouched (admin
   *      hasn't expressed a preference; whatever shell exported stays).
   */
  private async applyToEnv(): Promise<void> {
    const [httpProxy, httpsProxy, disabled] = await Promise.all([
      this.getHttpProxy(),
      this.getHttpsProxy(),
      this.getDisabled(),
    ]);

    if (disabled) {
      this.unsetProxyEnv();
      this.logger.log('[network-config] proxy disabled (force direct)');
      return;
    }

    if (httpProxy !== null) {
      process.env.HTTP_PROXY = httpProxy;
      process.env.http_proxy = httpProxy;
    }
    if (httpsProxy !== null) {
      process.env.HTTPS_PROXY = httpsProxy;
      process.env.https_proxy = httpsProxy;
    }
    if (httpProxy !== null || httpsProxy !== null) {
      this.logger.log(
        `[network-config] proxy applied: http=${httpProxy ?? '(unchanged)'} https=${httpsProxy ?? '(unchanged)'}`,
      );
    }
  }

  private unsetProxyEnv(): void {
    delete process.env.HTTP_PROXY;
    delete process.env.http_proxy;
    delete process.env.HTTPS_PROXY;
    delete process.env.https_proxy;
  }

  private readCached<T>(slot: CachedValue<T> | null): T | undefined {
    if (!slot) return undefined;
    if (slot.expiresAt < Date.now()) return undefined;
    return slot.value;
  }

  private unwrapStringValue(value: unknown): string | null {
    if (value === null || value === undefined) return null;
    if (typeof value === 'string') return value;
    if (
      typeof value === 'object' &&
      value !== null &&
      'value' in (value as Record<string, unknown>)
    ) {
      const inner = (value as Record<string, unknown>).value;
      return typeof inner === 'string' ? inner : null;
    }
    return null;
  }

  private unwrapBoolValue(value: unknown): boolean {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string')
      return value === 'true' || value === '1';
    if (
      typeof value === 'object' &&
      value !== null &&
      'value' in (value as Record<string, unknown>)
    ) {
      return this.unwrapBoolValue((value as Record<string, unknown>).value);
    }
    return false;
  }
}
