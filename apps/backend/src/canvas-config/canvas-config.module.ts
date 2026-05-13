import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CanvasConfigController } from './canvas-config.controller';
import { CanvasConfigService } from './canvas-config.service';
import { DashscopeConfigService } from './dashscope-config.service';
import { HistoryRetentionService } from './history-retention.service';
import { StorageConfigService } from './storage-config.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule, ConfigModule],
  controllers: [CanvasConfigController],
  providers: [
    CanvasConfigService,
    DashscopeConfigService,
    HistoryRetentionService,
    StorageConfigService,
  ],
  exports: [
    CanvasConfigService,
    DashscopeConfigService,
    HistoryRetentionService,
    StorageConfigService,
  ],
})
export class CanvasConfigModule {}
















