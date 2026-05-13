import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import { VoicesController } from './voices.controller';
import { VoicesService } from './voices.service';
import { CanvasConfigModule } from '../canvas-config/canvas-config.module';

@Module({
  imports: [HttpModule, ConfigModule, CanvasConfigModule],
  controllers: [VoicesController],
  providers: [VoicesService],
})
export class VoicesModule {}
