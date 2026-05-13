import { Controller, Get } from '@nestjs/common';

/**
 * Liveness probe — only `/health` is exposed at the root.
 *
 * The previous Hello-World endpoint inherited from `nest new` was removed
 * because the open-source build does not need a marketing landing page on
 * the API host; deployers point a load balancer at `/health` and route
 * everything else under `/api/*` and `/admin/*`.
 */
@Controller()
export class AppController {
  @Get('health')
  health(): { ok: true; ts: number } {
    return { ok: true, ts: Date.now() };
  }
}
