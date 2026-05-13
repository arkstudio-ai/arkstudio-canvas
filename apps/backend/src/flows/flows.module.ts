import { Module } from '@nestjs/common';
import { FlowsService } from './flows.service';
import { FlowsController } from './flows.controller';
import { FlowNodeDataService } from './flow-node-data.service';
import { FlowNodeParamsService } from './flow-node-params.service';

@Module({
  controllers: [FlowsController],
  providers: [
    FlowsService,
    FlowNodeDataService,
    FlowNodeParamsService,
  ],
  exports: [FlowsService, FlowNodeDataService, FlowNodeParamsService],
})
export class FlowsModule {}
