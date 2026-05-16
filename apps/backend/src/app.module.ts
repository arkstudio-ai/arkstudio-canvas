import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_INTERCEPTOR, APP_FILTER } from '@nestjs/core';
import { AppController } from './app.controller';
import { FlowsModule } from './flows/flows.module';
import { ExecutionsModule } from './executions/executions.module';
import { PrismaModule } from './prisma/prisma.module';
import { TemplatesModule } from './templates/templates.module';
import { CanvasConfigModule } from './canvas-config/canvas-config.module';
import { StorageModule } from './storage/storage.module';
import { UploadModule } from './upload/upload.module';
import { AdminModule } from './admin/admin.module';
import { VoicesModule } from './voices/voices.module';
import { GenerationHistoryModule } from './generation-history/generation-history.module';
import { VolcengineAssetModule } from './volcengine-asset/volcengine-asset.module';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    PrismaModule,
    FlowsModule,
    ExecutionsModule,
    TemplatesModule,
    CanvasConfigModule,
    StorageModule,
    UploadModule,
    AdminModule,
    VoicesModule,
    GenerationHistoryModule,
    VolcengineAssetModule,
  ],
  controllers: [AppController],
  providers: [
    {
      provide: APP_INTERCEPTOR,
      useClass: ResponseInterceptor,
    },
    {
      provide: APP_FILTER,
      useClass: HttpExceptionFilter,
    },
  ],
})
export class AppModule {}
