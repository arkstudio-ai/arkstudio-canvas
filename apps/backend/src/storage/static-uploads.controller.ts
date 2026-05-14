import {
  Controller,
  Get,
  NotFoundException,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { LocalStorageService } from './local-storage.service';

const ROUTE_PREFIX = '/static/uploads/';

/**
 * `GET /static/uploads/<key>` — serve files from the local data dir.
 *
 * Why a controller instead of `@nestjs/serve-static` or letting nginx
 * directly fileserve the volume:
 *
 *   1. Single-source authority: only `LocalStorageService.assertSafeKey`
 *      decides what's a valid path. ServeStatic would let nginx make
 *      that decision, which means two places to remember to keep in sync.
 *
 *   2. Mime-type guessing already lives on the service; controller just
 *      forwards. Keeping nginx out also means dev runs (no nginx) work
 *      identically to docker runs.
 *
 *   3. Cache-control is uniform — uuid-keyed paths are immutable, so
 *      a year of public caching is correct without surprising operators
 *      who tweaked nginx for unrelated reasons.
 *
 * Path-traversal defence sits on `LocalStorageService.readObject` which
 * pipes through `assertSafeKey`. Don't bypass it from here.
 *
 * Routing note: NestJS 11 ships Express 5 + path-to-regexp v8, where
 * the legacy bare `*` wildcard is treated as a literal character. The
 * working syntax is the named splat `*splat`. We register that and
 * recover the key off `req.path` directly to also dodge `@Param('splat')`
 * shape differences (string vs string[]) across path-to-regexp versions.
 */
@Controller()
export class StaticUploadsController {
  constructor(private readonly localStorage: LocalStorageService) {}

  @Get('static/uploads/*splat')
  async serve(@Req() req: Request, @Res() res: Response): Promise<void> {
    const url = req.path; // already without query string
    if (!url.startsWith(ROUTE_PREFIX)) throw new NotFoundException();
    const key = decodeURIComponent(url.slice(ROUTE_PREFIX.length));
    if (!key) throw new NotFoundException();

    const obj = await this.localStorage.readObject(key);
    if (!obj) throw new NotFoundException(`storage object not found: ${key}`);

    res.setHeader('Content-Type', obj.contentType);
    res.setHeader('Content-Length', String(obj.bytes));
    // Keys carry uuids → file at this URL is immutable for its lifetime.
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    obj.stream.pipe(res);
  }
}
