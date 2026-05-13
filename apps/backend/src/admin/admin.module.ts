import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ExecutionsModule } from '../executions/executions.module';
import { AdminExecutionsController } from './executions/admin-executions.controller';
import { AdminExecutionsService } from './executions/admin-executions.service';

/**
 * 后台 / admin module.
 *
 * Aggregates the read-only surface for the在线后台页（日志、用量、未来的
 * 配置/模型/计费等）。Each admin sub-domain lives in its own folder under
 * `src/admin/<domain>/` with its own controller + service so商业化 fork 时
 * 可以单独抽出某域而不会牵动其他模块.
 *
 * Today only `executions/` is wired; new sub-modules just land in this
 * `controllers` / `providers` array.
 */
@Module({
  imports: [PrismaModule, ExecutionsModule],
  controllers: [AdminExecutionsController],
  providers: [AdminExecutionsService],
})
export class AdminModule {}
