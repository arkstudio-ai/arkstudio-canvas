import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ViduAssetController } from './vidu-asset.controller';
import { ViduAssetService } from './vidu-asset.service';

@Module({
  imports: [PrismaModule],
  controllers: [ViduAssetController],
  providers: [ViduAssetService],
  exports: [ViduAssetService],
})
export class ViduAssetModule {}
