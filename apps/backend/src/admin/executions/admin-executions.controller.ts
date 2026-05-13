import { Controller, Get, NotFoundException, Param, Query } from '@nestjs/common';
import { ExecutionsService } from '../../executions/executions.service';
import { QueryExecutionsDto } from '../../executions/dto/query-executions.dto';
import { AdminExecutionsService, type UsageRange } from './admin-executions.service';

const VALID_RANGES: ReadonlySet<UsageRange> = new Set(['today', 'week', 'month']);

/**
 * Admin-side read API for `flow_executions`.
 *
 * Mounted under `/admin/executions` so the frontend `editor` page can keep
 * pointing the existing `/executions` controller at the in-flight recovery
 * use-case while the 后台 page (logs / usage) goes through this surface.
 *
 * Auth is intentionally absent in the open-source build — see
 * `open-source-refactor.mdc` for the商业化 split. When auth is added it
 * will land here as a single guard, no per-route changes needed.
 */
@Controller('admin/executions')
export class AdminExecutionsController {
  constructor(
    private readonly executions: ExecutionsService,
    private readonly admin: AdminExecutionsService,
  ) {}

  /**
   * `GET /admin/executions/usage?range=today|week|month`
   *
   * Must be declared before the `:id` routes so Nest doesn't capture
   * "usage" as an execution id.
   */
  @Get('usage')
  async getUsage(@Query('range') rangeParam?: string) {
    const range: UsageRange =
      rangeParam && VALID_RANGES.has(rangeParam as UsageRange) ?
        (rangeParam as UsageRange)
      : 'today';
    return this.admin.getUsageOverview(range);
  }

  /** Reuses ExecutionsService.listExecutions; passes the extended DTO through. */
  @Get()
  async list(@Query() query: QueryExecutionsDto) {
    return this.executions.listExecutions(query);
  }

  /**
   * Single execution + its phase events appended. Saves a follow-up call
   * from the detail drawer.
   */
  @Get(':id')
  async detail(@Param('id') id: string) {
    const found = await this.admin.findOneWithEvents(id);
    if (!found) throw new NotFoundException(`Execution ${id} not found`);
    return found;
  }
}
