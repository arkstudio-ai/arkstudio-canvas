import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import { CanvasConfigController } from './canvas-config.controller';
import { CanvasConfigService } from './canvas-config.service';
import { DashscopeConfigService } from './dashscope-config.service';
import { HistoryRetentionService } from './history-retention.service';
import { OpenaiCompatConfigService } from './openai-compat-config.service';
import { ProviderConnectivityService } from './provider-connectivity.service';
import { VolcengineConfigService } from './volcengine-config.service';
import { PrismaModule } from '../prisma/prisma.module';
import { StorageModule } from '../storage/storage.module';

// HttpModule 仅 ProviderConnectivityService 用到 (探活用); 其它 service 都不直接发请求.
@Module({
  imports: [PrismaModule, ConfigModule, StorageModule, HttpModule],
  controllers: [CanvasConfigController],
  providers: [
    CanvasConfigService,
    DashscopeConfigService,
    HistoryRetentionService,
    OpenaiCompatConfigService,
    ProviderConnectivityService,
    VolcengineConfigService,
  ],
  exports: [
    CanvasConfigService,
    DashscopeConfigService,
    HistoryRetentionService,
    OpenaiCompatConfigService,
    VolcengineConfigService,
  ],
})
export class CanvasConfigModule {}
