import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTemplateDto } from './dto/create-template.dto';
import { UpdateTemplateDto } from './dto/update-template.dto';
import { QueryTemplateDto } from './dto/query-template.dto';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class TemplatesService {
  private readonly logger = new Logger(TemplatesService.name);

  constructor(private prisma: PrismaService) {}

  async create(createDto: CreateTemplateDto) {
    const { name, description, cover, json, flowId, tags } = createDto;

    const nodeIds = json.nodes.map((n: any) => n.id);

    const flowNodes = await this.prisma.flowNode.findMany({
      where: { flowId, nodeId: { in: nodeIds } },
      include: { data: true, params: true },
    });

    const flowNodeMap = new Map(flowNodes.map(fn => [fn.nodeId, fn]));

    const validNodes = json.nodes.filter((node: any) => {
      const flowNode = flowNodeMap.get(node.id);
      if (!flowNode) return false;
      if (!flowNode.data && !flowNode.params) return false;
      return true;
    });

    if (validNodes.length === 0) {
      throw new Error('No valid nodes to save');
    }

    const nodeIdMap = new Map<string, string>();
    validNodes.forEach((node: any) => nodeIdMap.set(node.id, uuidv4()));

    const transformedData = this.transformCoordinates(validNodes, json.groups || [], json.edges || []);

    const nodesData = transformedData.nodes.map((node: any) => {
      const flowNode = flowNodeMap.get(node.id)!;
      const newNodeId = nodeIdMap.get(node.id)!;
      return {
        nodeId: newNodeId,
        type: node.type,
        position: node.position,
        width: node.width || 250,
        height: node.height || 250,
        data: flowNode?.data?.data ?? Prisma.JsonNull,
        params: flowNode?.params?.params ?? Prisma.JsonNull,
      };
    });

    const transformedEdges = transformedData.edges
      .filter((edge: any) => nodeIdMap.has(edge.source) && nodeIdMap.has(edge.target))
      .map((edge: any) => ({
        ...edge,
        source: nodeIdMap.get(edge.source)!,
        target: nodeIdMap.get(edge.target)!,
      }));

    const transformedGroups = transformedData.groups.map((group: any) => ({
      ...group,
      id: nodeIdMap.get(group.id) || group.id,
    }));

    const structureJson = {
      nodes: nodesData.map((n: any) => ({
        id: n.nodeId, type: n.type, position: n.position, width: n.width, height: n.height,
      })),
      edges: transformedEdges,
      groups: transformedGroups,
      meta: { ...json.meta, sourceFlowId: flowId },
    };

    const tagsCreate = tags?.map(tag => ({
      tag: {
        connectOrCreate: {
          where: { category_value: { category: tag.category, value: tag.value } },
          create: { category: tag.category, value: tag.value },
        },
      },
    })) || [];

    return this.prisma.template.create({
      data: {
        name,
        description,
        cover,
        structureJson,
        nodes: { create: nodesData },
        tags: { create: tagsCreate },
      },
      include: {
        nodes: true,
        tags: { include: { tag: true } },
      },
    });
  }

  private transformCoordinates(nodes: any[], groups: any[], edges: any[]) {
    groups.forEach(group => {
      const nodesInGroup = nodes.filter((n: any) => n.groupId === group.id);
      if (nodesInGroup.length > 0) {
        const minX = Math.min(...nodesInGroup.map((n: any) => n.position.x));
        const minY = Math.min(...nodesInGroup.map((n: any) => n.position.y));
        nodesInGroup.forEach((node: any) => {
          node.position = { x: node.position.x - minX, y: node.position.y - minY };
        });
        group.position = { x: 0, y: 0 };
      }
    });

    const ungroupedNodes = nodes.filter((n: any) => !n.groupId);
    if (ungroupedNodes.length > 0) {
      const minX = Math.min(...ungroupedNodes.map((n: any) => n.position.x));
      const minY = Math.min(...ungroupedNodes.map((n: any) => n.position.y));
      ungroupedNodes.forEach((node: any) => {
        node.position = { x: node.position.x - minX, y: node.position.y - minY };
      });
    }

    return { nodes, groups, edges };
  }

  async query(dto: QueryTemplateDto) {
    const { keyword, tags, page = 1, limit = 20 } = dto;

    const where: any = { enabled: true };

    if (keyword) {
      where.OR = [
        { name: { contains: keyword } },
        { description: { contains: keyword } },
      ];
    }

    if (tags && tags.length > 0) {
      where.AND = tags.map(t => ({
        tags: { some: { tag: { category: t.category, value: t.value } } },
      }));
    }

    const [total, items] = await Promise.all([
      this.prisma.template.count({ where }),
      this.prisma.template.findMany({
        where,
        select: {
          id: true, name: true, description: true, cover: true,
          enabled: true, createdAt: true, updatedAt: true,
          tags: { select: { tag: true } },
        },
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    const formattedItems = items.map(item => ({
      ...item,
      tags: item.tags.map(t => ({ category: t.tag.category, value: t.tag.value, color: t.tag.color })),
    }));

    return {
      items: formattedItems,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async findOne(id: string) {
    const template = await this.prisma.template.findUnique({
      where: { id },
      include: { tags: { include: { tag: true } } },
    });

    if (!template) throw new NotFoundException(`Template ${id} not found`);

    return {
      id: template.id,
      name: template.name,
      description: template.description,
      cover: template.cover,
      json: template.structureJson,
      tags: template.tags.map(t => ({ category: t.tag.category, value: t.tag.value, color: t.tag.color })),
      createdAt: template.createdAt,
      updatedAt: template.updatedAt,
    };
  }

  async remove(id: string) {
    return this.prisma.template.delete({ where: { id } });
  }

  async update(id: string, updateDto: UpdateTemplateDto) {
    const existing = await this.prisma.template.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException(`Template ${id} not found`);

    const updateData: Prisma.TemplateUpdateInput = {};
    if (updateDto.name !== undefined) updateData.name = updateDto.name;
    if (updateDto.description !== undefined) updateData.description = updateDto.description;
    if (updateDto.cover !== undefined) updateData.cover = updateDto.cover;
    if (updateDto.enabled !== undefined) updateData.enabled = updateDto.enabled;

    return this.prisma.$transaction(async (tx) => {
      if (updateDto.removeTags?.length) {
        for (const tagToRemove of updateDto.removeTags) {
          const tag = await tx.tag.findUnique({
            where: { category_value: { category: tagToRemove.category, value: tagToRemove.value } },
          });
          if (tag) {
            await tx.tagsOnTemplates.deleteMany({ where: { templateId: id, tagId: tag.id } });
          }
        }
      }

      if (updateDto.addTags?.length) {
        for (const tagToAdd of updateDto.addTags) {
          const tag = await tx.tag.upsert({
            where: { category_value: { category: tagToAdd.category, value: tagToAdd.value } },
            create: { category: tagToAdd.category, value: tagToAdd.value },
            update: {},
          });
          const exists = await tx.tagsOnTemplates.findUnique({
            where: { templateId_tagId: { templateId: id, tagId: tag.id } },
          });
          if (!exists) {
            await tx.tagsOnTemplates.create({ data: { templateId: id, tagId: tag.id } });
          }
        }
      }

      const updated = await tx.template.update({
        where: { id },
        data: updateData,
        include: { tags: { include: { tag: true } } },
      });

      return {
        ...updated,
        tags: updated.tags.map(t => ({ category: t.tag.category, value: t.tag.value, color: t.tag.color })),
      };
    });
  }

  async instantiate(templateId: string) {
    const template = await this.prisma.template.findUnique({
      where: { id: templateId },
      include: { nodes: true, tags: { include: { tag: true } } },
    });

    if (!template) throw new NotFoundException(`Template ${templateId} not found`);

    const structure = template.structureJson as any;

    const nodeIdMap = new Map<string, string>();
    const groupIdMap = new Map<string, string>();

    template.nodes.forEach(node => nodeIdMap.set(node.nodeId, uuidv4()));

    if (structure.groups?.length) {
      structure.groups.forEach((g: any) => groupIdMap.set(g.id, uuidv4()));
    }

    const nodes = template.nodes.map(node => {
      const newNodeId = nodeIdMap.get(node.nodeId)!;
      const structureNode = structure.nodes?.find((n: any) => n.id === node.nodeId);
      return {
        id: newNodeId,
        type: node.type,
        position: node.position as { x: number; y: number },
        width: node.width,
        height: node.height,
        groupId: structureNode?.groupId ? groupIdMap.get(structureNode.groupId) : undefined,
        data: node.data === null ? undefined : node.data,
        params: node.params === null ? undefined : node.params,
      };
    });

    const edges = (structure.edges || [])
      .filter((e: any) => nodeIdMap.has(e.source) && nodeIdMap.has(e.target))
      .map((e: any) => ({
        id: uuidv4(),
        source: nodeIdMap.get(e.source)!,
        target: nodeIdMap.get(e.target)!,
        sourceHandle: e.sourceHandle,
        targetHandle: e.targetHandle,
      }));

    const groups = (structure.groups || []).map((g: any) => ({
      id: groupIdMap.get(g.id) || g.id,
      label: g.label,
      position: g.position,
      width: g.width,
      height: g.height,
    }));

    return {
      nodes, edges, groups,
      meta: {
        sourceTemplateId: template.id,
        sourceTemplateName: template.name,
        nodeCount: nodes.length,
        edgeCount: edges.length,
        groupCount: groups.length,
      },
    };
  }

  async getTags(category?: string) {
    const where: Prisma.TagWhereInput = {};
    if (category) where.category = category;

    return this.prisma.tag.findMany({
      where,
      select: { id: true, category: true, value: true, color: true },
      orderBy: [{ category: 'asc' }, { value: 'asc' }],
    });
  }
}
