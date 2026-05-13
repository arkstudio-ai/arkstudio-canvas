import { Module } from '@nestjs/common';
import { ExecutionsController } from './executions.controller';
import { ExecutionsService } from './executions.service';
import { NodeParserService } from './node-parser.service';
import { ExecutionEventsService } from './execution-events.service';
import { ParamsBuilderService } from './params-builder.service';
import { ModelResolverService } from './model-resolver.service';
import { FlowsModule } from '../flows/flows.module';
import { PrismaModule } from '../prisma/prisma.module';
import { UploadModule } from '../upload/upload.module';
import { ProvidersModule } from '../providers/providers.module';
import { GenerationHistoryModule } from '../generation-history/generation-history.module';

@Module({
  imports: [
    FlowsModule,
    PrismaModule,
    UploadModule,
    ProvidersModule,
    GenerationHistoryModule,
  ],
  controllers: [ExecutionsController],
  providers: [
    ExecutionsService,
    NodeParserService,
    ExecutionEventsService,
    ParamsBuilderService,
    ModelResolverService,
  ],
  exports: [ExecutionsService, ExecutionEventsService],
})
export class ExecutionsModule {}
