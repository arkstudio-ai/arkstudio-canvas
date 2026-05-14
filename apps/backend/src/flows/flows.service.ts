import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateFlowDto } from './dto/create-flow.dto';
import { UpdateFlowDto } from './dto/update-flow.dto';
import { QueryFlowDto } from './dto/query-flow.dto';
import { BatchOperationDto } from './dto/flow-operation.dto';
import { FlowNodeDataService } from './flow-node-data.service';
import { Prisma } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class FlowsService {
  constructor(
    private prisma: PrismaService,
    private nodeDataService: FlowNodeDataService,
  ) {}

  async create(createFlowDto: CreateFlowDto) {
    const initialGraph = createFlowDto.initialGraph || { nodes: [], edges: [], meta: {} };
    
    const structureJson = {
      nodes: (initialGraph.nodes || []).map((n: any) => {
        const node: any = {
          id: n.id,
          type: n.type,
          position: n.position || { x: 0, y: 0 },
        };
        if (n.groupId !== undefined) node.groupId = n.groupId;
        if (n.width !== undefined) node.width = n.width;
        if (n.height !== undefined) node.height = n.height;
        return node;
      }),
      edges: initialGraph.edges || [],
      groups: initialGraph.groups || []
    };
    
    const serializedStructureJson = JSON.parse(JSON.stringify(structureJson));
    
    const flow = await this.prisma.flow.create({
      data: {
        name: createFlowDto.name,
        description: createFlowDto.description,
        cover: createFlowDto.cover,
        structureJson: serializedStructureJson,
        version: 1,
      },
    });
    
    return flow;
  }

  async findAll() {
    return this.prisma.flow.findMany({
      where: { 
        status: { not: 'DELETED' },
      },
      select: {
        id: true,
        name: true,
        description: true,
        cover: true,
        status: true,
        version: true,
        updatedAt: true,
        createdAt: true,
      },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async query(query: QueryFlowDto = {}) {
    const { page = 1, limit = 20 } = query;

    const where = {
      status: { not: 'DELETED' },
    };

    const [total, items] = await Promise.all([
      this.prisma.flow.count({ where }),
      this.prisma.flow.findMany({
        where,
        select: {
          id: true,
          name: true,
          description: true,
          cover: true,
          status: true,
          version: true,
          updatedAt: true,
          createdAt: true,
        },
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return {
      items,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findOne(id: string) {
    const flow = await this.prisma.flow.findUnique({
      where: { id },
    });
    if (!flow) throw new NotFoundException(`Flow with ID ${id} not found`);
    return flow;
  }

  async applyOperations(id: string, batchDto: BatchOperationDto) {
    const { version: clientBaseVersion, operations } = batchDto;

    return this.prisma.$transaction(async (tx) => {
      const flow = await tx.flow.findUnique({ where: { id } });
      if (!flow) throw new NotFoundException(`Flow not found`);

      if (flow.version !== clientBaseVersion) {
        throw new ConflictException(
          `Version mismatch: Client=${clientBaseVersion}, Server=${flow.version}`,
        );
      }

      const structure = (flow.structureJson as any) || { nodes: [], edges: [], groups: [] };

      for (const operation of operations) {
        await this.applyOperation(tx, id, structure, operation);
      }

      const updatedFlow = await tx.flow.update({
        where: { id },
        data: {
          structureJson: structure,
          version: { increment: 1 },
        },
      });

      await tx.flowOperation.createMany({
        data: operations.map((op) => ({
          flowId: id,
          type: op.op,
          payload: op.data,
          version: updatedFlow.version,
        })),
      });

      const allOps = await tx.flowOperation.findMany({
        where: { flowId: id },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      });

      if (allOps.length > 10) {
        const idsToDelete = allOps.slice(10).map((op) => op.id);
        await tx.flowOperation.deleteMany({
          where: { id: { in: idsToDelete } },
        });
      }

      return {
        id: updatedFlow.id,
        version: updatedFlow.version,
      };
    });
  }

  private async applyOperation(tx: any, flowId: string, structure: any, operation: any) {
    const { op, data } = operation;

    switch (op) {
      case 'NODE_ADD':
        await this.applyNodeAdd(tx, flowId, structure, data);
        break;
      case 'NODE_MOVE':
        await this.applyNodeMove(tx, flowId, structure, data);
        break;
      case 'NODE_UPDATE':
        await this.applyNodeUpdate(tx, flowId, structure, data);
        break;
      case 'NODE_REMOVE':
        await this.applyNodeRemove(tx, flowId, structure, data);
        break;
      case 'EDGE_ADD':
        this.applyEdgeAdd(structure, data);
        break;
      case 'EDGE_REMOVE':
        this.applyEdgeRemove(structure, data);
        break;
      case 'GROUP_ADD':
        await this.applyGroupAdd(tx, flowId, structure, data);
        break;
      case 'GROUP_MOVE':
        this.applyGroupMove(structure, data);
        break;
      case 'GROUP_UPDATE':
        await this.applyGroupUpdate(tx, flowId, structure, data);
        break;
      case 'GROUP_UNGROUP':
        this.applyGroupUngroup(structure, data);
        break;
      case 'GROUP_REMOVE':
        await this.applyGroupRemove(tx, flowId, structure, data);
        break;
      default:
        throw new Error(`Unknown operation type: ${op}`);
    }
  }

  // ========== Node Operations ==========

  private async applyNodeAdd(tx: any, flowId: string, structure: any, payload: any) {
    const { id, type, position, width, height, groupId } = payload;

    structure.nodes.push({
      id,
      type,
      position: position || { x: 0, y: 0 },
      width: width || 250,
      height: height || 250,
      groupId: groupId || null,
    });

    await tx.flowNode.create({
      data: {
        flowId,
        nodeId: id,
        type,
        position: position || { x: 0, y: 0 },
        width: width || 250,
        height: height || 250,
        groupId: groupId || null,
      },
    });
  }

  private async applyNodeMove(tx: any, flowId: string, structure: any, payload: any) {
    const { id, position } = payload;

    const node = structure.nodes.find((n: any) => n.id === id);
    if (node) {
      node.position = position;
      // Frontend's fromReactFlowNodes always converts in-group children
      // to absolute coordinates before sending NODE_MOVE. Stamp the
      // coordinate type so a subsequent reload's toReactFlowNodes knows
      // to subtract the group offset. Without this, GROUP_ADD's
      // _coordinateType: 'relative' lingers on the row, the loader
      // believes the now-absolute position is relative, and children
      // (and their edges) snap to wrong screen positions.
      if (node.groupId) {
        node._coordinateType = 'absolute';
      }
    }

    await tx.flowNode.updateMany({
      where: { flowId, nodeId: id },
      data: { position },
    });
  }

  private async applyNodeUpdate(tx: any, flowId: string, structure: any, payload: any) {
    const { id, position, width, height, groupId, type } = payload;

    const node = structure.nodes.find((n: any) => n.id === id);
    if (node) {
      if (position !== undefined) node.position = position;
      if (width !== undefined) node.width = width;
      if (height !== undefined) node.height = height;
      if (groupId !== undefined) node.groupId = groupId;
      if (type !== undefined) node.type = type;
    }

    const updateData: any = {};
    if (position !== undefined) updateData.position = position;
    if (width !== undefined) updateData.width = width;
    if (height !== undefined) updateData.height = height;
    if (groupId !== undefined) updateData.groupId = groupId;
    if (type !== undefined) updateData.type = type;

    if (Object.keys(updateData).length > 0) {
      await tx.flowNode.updateMany({
        where: { flowId, nodeId: id },
        data: updateData,
      });
    }
  }

  private async applyNodeRemove(tx: any, flowId: string, structure: any, payload: any) {
    const { id } = payload;

    structure.nodes = structure.nodes.filter((n: any) => n.id !== id);
    structure.edges = structure.edges.filter(
      (e: any) => e.source !== id && e.target !== id,
    );
    structure.groups.forEach((g: any) => {
      if (g.nodeIds) {
        g.nodeIds = g.nodeIds.filter((nid: string) => nid !== id);
      }
    });

    await tx.flowNode.deleteMany({
      where: { flowId, nodeId: id },
    });
  }

  // ========== Edge Operations ==========

  private applyEdgeAdd(structure: any, payload: any) {
    const { id, source, target } = payload;
    structure.edges.push({ id, source, target });
  }

  private applyEdgeRemove(structure: any, payload: any) {
    const { id } = payload;
    structure.edges = structure.edges.filter((e: any) => e.id !== id);
  }

  // ========== Group Operations ==========

  private async applyGroupAdd(tx: any, flowId: string, structure: any, payload: any) {
    const { id, label, position, width, height, style, nodeIds, nodes } = payload;

    structure.groups.push({
      id,
      label,
      position: position || { x: 0, y: 0 },
      width: width || 600,
      height: height || 300,
      style: style || {},
      nodeIds: nodeIds || [],
    });

    if (nodes && nodes.length > 0) {
      for (const nodeUpdate of nodes) {
        const node = structure.nodes.find((n: any) => n.id === nodeUpdate.id);
        if (node) {
          node.groupId = id;
          node.position = nodeUpdate.position;
          if (nodeUpdate.width) node.width = nodeUpdate.width;
          if (nodeUpdate.height) node.height = nodeUpdate.height;

          await tx.flowNode.updateMany({
            where: { flowId, nodeId: nodeUpdate.id },
            data: {
              groupId: id,
              position: nodeUpdate.position,
              width: nodeUpdate.width,
              height: nodeUpdate.height,
            },
          });
        }
      }
    }
  }

  private applyGroupMove(structure: any, payload: any) {
    const { id, position } = payload;
    const group = structure.groups.find((g: any) => g.id === id);
    if (group) {
      group.position = position;
    }
  }

  private async applyGroupUpdate(tx: any, flowId: string, structure: any, payload: any) {
    const { id, label, position, width, height, style, nodeIds } = payload;
    const group = structure.groups.find((g: any) => g.id === id);
    if (group) {
      if (label !== undefined) group.label = label;
      if (position !== undefined) group.position = position;
      if (width !== undefined) group.width = width;
      if (height !== undefined) group.height = height;
      if (style !== undefined) group.style = style;
      if (nodeIds !== undefined) group.nodeIds = nodeIds;
    }
  }

  private applyGroupUngroup(structure: any, payload: any) {
    const { id } = payload;
    structure.groups = structure.groups.filter((g: any) => g.id !== id);
  }

  private async applyGroupRemove(tx: any, flowId: string, structure: any, payload: any) {
    const { id } = payload;

    const nodeIds = structure.nodes
      .filter((n: any) => n.groupId === id)
      .map((n: any) => n.id);

    structure.nodes = structure.nodes.filter((n: any) => n.groupId !== id);
    structure.edges = structure.edges.filter(
      (e: any) => !nodeIds.includes(e.source) && !nodeIds.includes(e.target),
    );
    structure.groups = structure.groups.filter((g: any) => g.id !== id);

    if (nodeIds.length > 0) {
      await tx.flowNode.deleteMany({
        where: { flowId, nodeId: { in: nodeIds } },
      });
    }
  }

  async getHistory(id: string) {
    return this.prisma.flowOperation.findMany({
      where: { flowId: id },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });
  }

  async remove(id: string) {
    return this.prisma.flow.update({
      where: { id },
      data: { status: 'DELETED' },
    });
  }

  async update(id: string, dto: UpdateFlowDto) {
    const updateData: Prisma.FlowUpdateInput = {};
    
    if (dto.name !== undefined) updateData.name = dto.name;
    if (dto.description !== undefined) updateData.description = dto.description;
    if (dto.cover !== undefined) updateData.cover = dto.cover;
    if (dto.status !== undefined) updateData.status = dto.status;

    return this.prisma.flow.update({
      where: { id },
      data: updateData,
    });
  }

  async preview(id: string) {
    const flow = await this.prisma.flow.findUnique({
      where: { id },
    });

    if (!flow || flow.status === 'DELETED') {
      throw new NotFoundException(`Flow with ID ${id} not found`);
    }

    const flowNodes = await this.prisma.flowNode.findMany({
      where: { flowId: id },
      include: {
        data: true,
        params: true,
      },
    });

    const nodes = flowNodes.map(node => ({
      nodeId: node.nodeId,
      type: node.type,
      position: node.position,
      width: node.width,
      height: node.height,
      groupId: node.groupId,
      data: node.data?.data ?? null,
      params: node.params?.params ?? null,
    }));

    return {
      id: flow.id,
      name: flow.name,
      description: flow.description,
      cover: flow.cover,
      structureJson: flow.structureJson,
      nodes,
      createdAt: flow.createdAt,
      updatedAt: flow.updatedAt,
    };
  }

  async clone(id: string, name?: string) {
    const sourceFlow = await this.prisma.flow.findUnique({
      where: { id },
    });

    if (!sourceFlow || sourceFlow.status === 'DELETED') {
      throw new NotFoundException(`Flow with ID ${id} not found`);
    }

    const sourceNodes = await this.prisma.flowNode.findMany({
      where: { flowId: id },
      include: {
        data: true,
        params: true,
      },
    });

    const nodeIdMap = new Map<string, string>();
    const groupIdMap = new Map<string, string>();

    sourceNodes.forEach(node => {
      nodeIdMap.set(node.nodeId, uuidv4());
    });

    const structure = sourceFlow.structureJson as any;
    if (structure.groups && Array.isArray(structure.groups)) {
      structure.groups.forEach((g: any) => {
        groupIdMap.set(g.id, uuidv4());
      });
    }

    const newStructureJson = {
      nodes: (structure.nodes || []).map((n: any) => ({
        id: nodeIdMap.get(n.id) || n.id,
        type: n.type,
        position: n.position,
        width: n.width,
        height: n.height,
        groupId: n.groupId ? (groupIdMap.get(n.groupId) || n.groupId) : null,
      })),
      edges: (structure.edges || [])
        .filter((e: any) => nodeIdMap.has(e.source) && nodeIdMap.has(e.target))
        .map((e: any) => ({
          id: uuidv4(),
          source: nodeIdMap.get(e.source)!,
          target: nodeIdMap.get(e.target)!,
          sourceHandle: e.sourceHandle,
          targetHandle: e.targetHandle,
        })),
      groups: (structure.groups || []).map((g: any) => ({
        id: groupIdMap.get(g.id) || g.id,
        label: g.label,
        position: g.position,
        width: g.width,
        height: g.height,
        style: g.style,
        nodeIds: (g.nodeIds || []).map((nid: string) => nodeIdMap.get(nid) || nid),
      })),
    };

    const newFlowName = name || `${sourceFlow.name} (副本)`;

    return this.prisma.$transaction(async (tx) => {
      const newFlow = await tx.flow.create({
        data: {
          name: newFlowName,
          description: sourceFlow.description,
          cover: sourceFlow.cover,
          structureJson: newStructureJson,
          version: 1,
        },
      });

      for (const sourceNode of sourceNodes) {
        const newNodeId = nodeIdMap.get(sourceNode.nodeId)!;
        const newGroupId = sourceNode.groupId ? (groupIdMap.get(sourceNode.groupId) || sourceNode.groupId) : null;

        const newFlowNode = await tx.flowNode.create({
          data: {
            flowId: newFlow.id,
            nodeId: newNodeId,
            type: sourceNode.type,
            position: sourceNode.position as any,
            width: sourceNode.width,
            height: sourceNode.height,
            groupId: newGroupId,
          },
        });

        if (sourceNode.data) {
          await tx.flowNodeData.create({
            data: {
              flowNodeId: newFlowNode.id,
              data: sourceNode.data.data as any,
              version: 1,
            },
          });
        }

        if (sourceNode.params) {
          await tx.flowNodeParams.create({
            data: {
              flowNodeId: newFlowNode.id,
              params: sourceNode.params.params as any,
              version: 1,
            },
          });
        }
      }

      return { id: newFlow.id };
    });
  }
}
