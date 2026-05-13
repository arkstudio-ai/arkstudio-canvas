import { Module } from '@nestjs/common';
import { GenerationHistoryService } from './generation-history.service';
import { GenerationHistoryController } from './generation-history.controller';
import { CanvasConfigModule } from '../canvas-config/canvas-config.module';

/**
 * 生成历史模块（开源版）。
 *
 * 暴露 `/generation-history` 三个端点供前端 HistoryPanel 使用，并把
 * `GenerationHistoryService` 导出，让 executions / providers 模块直接注入
 * `record(...)` 来写入历史记录。
 *
 * 依赖 CanvasConfigModule 取 HistoryRetentionService —— record() 写入后
 * 顺手做节流 prune，避免该表无界增长。
 */
@Module({
  imports: [CanvasConfigModule],
  controllers: [GenerationHistoryController],
  providers: [GenerationHistoryService],
  exports: [GenerationHistoryService],
})
export class GenerationHistoryModule {}
