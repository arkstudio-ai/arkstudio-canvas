import { Injectable, Logger, MessageEvent } from '@nestjs/common';
import { Subject, Observable } from 'rxjs';
import { filter, map } from 'rxjs/operators';

/**
 * One status transition for a FlowExecution row.
 *
 * Mirrors the canonical status values written by ExecutionsService:
 *  PENDING (created) → RUNNING (started) → COMPLETED / FAILED (finished).
 */
export interface ExecutionStatusEvent {
  executionId: string;
  flowId: string;
  nodeId: string;
  batchId: string | null;
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';
  errorMsg?: string | null;
  latencyMs?: number | null;
  emittedAt: number;
}

interface SubscriptionFilter {
  flowId?: string;
  batchId?: string;
  executionId?: string;
}

/**
 * Pub/sub hub for FlowExecution status transitions.
 *
 * - ExecutionsService calls {@link emit} whenever it writes a new status row
 *   (PENDING → RUNNING → COMPLETED/FAILED).
 * - The controller exposes an SSE endpoint that consumes {@link subscribe}
 *   and streams MessageEvents to the browser, so individual nodes can update
 *   the moment they finish — even when other nodes in the same batch are
 *   still running.
 *
 * In-memory only on purpose: technical-debt doc explicitly asks for a single
 * source of truth in the DB, with SSE as the live notification channel.
 * Recovery after reload happens via REST (`GET /executions?status=...`), not
 * the event stream.
 */
@Injectable()
export class ExecutionEventsService {
  private readonly logger = new Logger(ExecutionEventsService.name);
  private readonly events$ = new Subject<ExecutionStatusEvent>();

  emit(event: Omit<ExecutionStatusEvent, 'emittedAt'>) {
    const full: ExecutionStatusEvent = { ...event, emittedAt: Date.now() };
    this.logger.debug(
      `emit status=${full.status} execution=${full.executionId} node=${full.nodeId}` +
        (full.batchId ? ` batch=${full.batchId}` : ''),
    );
    this.events$.next(full);
  }

  /**
   * Return a MessageEvent observable matching the given filter.
   *
   * Note: NestJS serialises SSE payloads with `JSON.stringify`, so we must
   * return a plain object `{ data }` here — not a `new MessageEvent(...)`
   * instance whose `.data` is a getter and would serialise to `{}`.
   */
  subscribe(filterArgs: SubscriptionFilter): Observable<MessageEvent> {
    return this.events$.pipe(
      filter((e) => this.matches(e, filterArgs)),
      map((e) => ({ data: e }) as MessageEvent),
    );
  }

  private matches(event: ExecutionStatusEvent, args: SubscriptionFilter): boolean {
    if (args.executionId && event.executionId !== args.executionId) return false;
    if (args.batchId && event.batchId !== args.batchId) return false;
    if (args.flowId && event.flowId !== args.flowId) return false;
    return true;
  }
}
