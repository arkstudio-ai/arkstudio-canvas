import { Module } from '@nestjs/common';
import { FlowsService } from './flows.service';
import { FlowsController } from './flows.controller';
import { FlowNodeStateService } from './flow-node-state.service';

@Module({
  controllers: [FlowsController],
  providers: [FlowsService, FlowNodeStateService],
  exports: [FlowsService, FlowNodeStateService],
})
export class FlowsModule {}
