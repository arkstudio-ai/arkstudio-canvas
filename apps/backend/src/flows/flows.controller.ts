import { Controller, Get, Post, Body, Patch, Param, Delete, UsePipes, ValidationPipe, Query, HttpCode, HttpStatus } from '@nestjs/common';
import { FlowsService } from './flows.service';
import { FlowNodeDataService } from './flow-node-data.service';
import { FlowNodeParamsService } from './flow-node-params.service';
import { CreateFlowDto } from './dto/create-flow.dto';
import { UpdateFlowDto } from './dto/update-flow.dto';
import { QueryFlowDto } from './dto/query-flow.dto';
import { BatchOperationDto } from './dto/flow-operation.dto';
import { CloneFlowDto } from './dto/clone-flow.dto';

@Controller('flows')
export class FlowsController {
  constructor(
    private readonly flowsService: FlowsService,
    private readonly nodeDataService: FlowNodeDataService,
    private readonly nodeParamsService: FlowNodeParamsService,
  ) {}

  @Post()
  @UsePipes(new ValidationPipe())
  create(@Body() createFlowDto: CreateFlowDto) {
    return this.flowsService.create(createFlowDto);
  }

  @Get()
  findAll() {
    return this.flowsService.findAll();
  }

  @Post('query')
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ValidationPipe({ transform: true }))
  query(@Body() queryDto: QueryFlowDto) {
    return this.flowsService.query(queryDto);
  }

  @Get(':id/preview')
  preview(@Param('id') id: string) {
    return this.flowsService.preview(id);
  }

  @Post(':id/clone')
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ValidationPipe({ transform: true }))
  clone(@Param('id') id: string, @Body() cloneDto: CloneFlowDto) {
    return this.flowsService.clone(id, cloneDto.name);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.flowsService.findOne(id);
  }

  @Post(':id/operations')
  @UsePipes(new ValidationPipe({ transform: true }))
  applyOperations(@Param('id') id: string, @Body() batchDto: BatchOperationDto) {
    return this.flowsService.applyOperations(id, batchDto);
  }

  @Get(':id/history')
  getHistory(@Param('id') id: string) {
    return this.flowsService.getHistory(id);
  }

  @Patch(':id')
  @UsePipes(new ValidationPipe())
  update(@Param('id') id: string, @Body() updateFlowDto: UpdateFlowDto) {
    return this.flowsService.update(id, updateFlowDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.flowsService.remove(id);
  }

  // ========== Node Data API ==========

  @Patch(':id/nodes/:nodeId/data')
  async updateNodeData(
    @Param('id') id: string,
    @Param('nodeId') nodeId: string,
    @Body() body: { data: any },
    @Query('merge') merge?: string,
  ) {
    const mergeMode = merge !== 'false';
    await this.nodeDataService.updateNodeData(id, nodeId, body.data, mergeMode);
    return null;
  }

  @Get(':id/nodes/:nodeId/data')
  async getNodeData(@Param('id') id: string, @Param('nodeId') nodeId: string) {
    return this.nodeDataService.getNodeData(id, nodeId);
  }

  @Get(':id/nodes/data')
  async getFlowNodesData(@Param('id') flowId: string) {
    return this.nodeDataService.getFlowNodesData(flowId);
  }

  @Get(':id/groups/:groupId/nodes/data')
  async getGroupNodesData(
    @Param('id') flowId: string,
    @Param('groupId') groupId: string,
  ) {
    return this.nodeDataService.getGroupNodesData(flowId, groupId);
  }

  // ========== Node Params API ==========

  @Patch(':id/nodes/:nodeId/params')
  async updateNodeParams(
    @Param('id') id: string,
    @Param('nodeId') nodeId: string,
    @Body() params: any,
    @Query('merge') merge?: string,
  ) {
    const mergeMode = merge !== 'false';
    await this.nodeParamsService.updateNodeParams(id, nodeId, params, mergeMode);
    return null;
  }

  @Get(':id/nodes/:nodeId/params')
  async getNodeParams(@Param('id') id: string, @Param('nodeId') nodeId: string) {
    return this.nodeParamsService.getNodeParams(id, nodeId);
  }

  @Get(':id/nodes/params')
  async getFlowNodesParams(@Param('id') flowId: string) {
    return this.nodeParamsService.getFlowNodesParams(flowId);
  }

  @Get(':id/groups/:groupId/nodes/params')
  async getGroupNodesParams(
    @Param('id') flowId: string,
    @Param('groupId') groupId: string,
  ) {
    return this.nodeParamsService.getGroupNodesParams(flowId, groupId);
  }
}
