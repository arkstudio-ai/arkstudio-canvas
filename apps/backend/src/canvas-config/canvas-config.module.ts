import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CanvasConfigController } from './canvas-config.controller';
import { CanvasConfigService } from './canvas-config.service';
import { DashscopeConfigService } from './dashscope-config.service';
import { HistoryRetentionService } from './history-retention.service';
import { OpenaiCompatConfigService } from './openai-compat-config.service';
import { PrismaModule } from '../prisma/prisma.module';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [PrismaModule, ConfigModule, StorageModule],
  controllers: [CanvasConfigController],
  providers: [
    CanvasConfigService,
    DashscopeConfigService,
    HistoryRetentionService,
    OpenaiCompatConfigService,
  ],
  exports: [
    CanvasConfigService,
    DashscopeConfigService,
    HistoryRetentionService,
    OpenaiCompatConfigService,
  ],
})
export class CanvasConfigModule {}
