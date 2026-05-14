import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LocalStorageService } from './local-storage.service';
import { StaticUploadsController } from './static-uploads.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule, ConfigModule],
  controllers: [StaticUploadsController],
  providers: [LocalStorageService],
  exports: [LocalStorageService],
})
export class StorageModule {}
