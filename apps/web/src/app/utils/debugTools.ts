import { CanvasFlowHandle } from '@canvas-flow/core';
import { nodeConfigStore } from '../store/nodeConfigStore';
import { runAllCoordinateTests } from './coordinateTest';

/**
 * 打印当前 Flow 的完整信息
 */
export const debugFlow = (flowRef: React.RefObject<CanvasFlowHandle | null>) => {
  const flow = flowRef.current?.getFlow();
  
  if (!flow) {
    console.warn('🔍 [Debug] Flow 未初始化');
    return;
  }
  
  console.group('🔍 Flow Debug Info');
  console.log('📊 总览:', {
    节点数量: flow.nodes?.length || 0,
    边数量: flow.edges?.length || 0,
    分组数量: flow.groups?.length || 0
  });
  
  console.log('📦 Nodes:', flow.nodes);
  console.log('🔗 Edges:', flow.edges);
  console.log('👥 Groups:', flow.groups);
  console.log('📝 Meta:', flow.meta);
  console.groupEnd();
  
  return flow;
};

/**
 * 打印所有节点的媒体数据
 */
export const debugMediaMap = (flowRef: React.RefObject<CanvasFlowHandle | null>) => {
  if (!flowRef.current?.getNodeMedia) {
    console.warn('🎬 [Debug] getNodeMedia API 不可用');
    return;
  }
  
  const flow = flowRef.current.getFlow();
  if (!flow) {
    console.warn('🎬 [Debug] Flow 未初始化');
    return;
  }
  
  console.group('🎬 Media Map Debug');
  flow.nodes.forEach((node: any) => {
    const media = flowRef.current!.getNodeMedia(node.id);
    console.log(`${node.id} (${node.type}):`, media);
  });
  console.groupEnd();
};

/**
 * 打印节点结构信息（不含媒体数据）
 */
export const debugNodeStructure = (flowRef: React.RefObject<CanvasFlowHandle | null>) => {
  const flow = flowRef.current?.getFlow();
  
  if (!flow) {
    console.warn('🏗️ [Debug] Flow 未初始化');
    return;
  }
  
  console.group('🏗️ Node Structure (No Media)');
  flow.nodes.forEach((node: any) => {
    console.log(`${node.id}:`, {
      type: node.type,
      position: node.position,
      groupId: node.groupId,
      width: node.width,
      height: node.height,
    });
  });
  console.groupEnd();
};

/**
 * 对比应用层和 Core 层的数据同步状态（仅用于调试旧架构）
 */
export const debugSyncStatus = (
  flowRef: React.RefObject<CanvasFlowHandle | null>,
  appFlow?: any
) => {
  const coreFlow = flowRef.current?.getFlow();
  
  console.group('🔄 Sync Status');
  console.log('Core Flow:', coreFlow);
  console.log('App Flow (deprecated):', appFlow);
  
  if (appFlow) {
    console.warn('⚠️ 应用层仍在维护 flow 状态，应该移除！');
  } else {
    console.log('✅ 应用层已完全依赖 Core');
  }
  console.groupEnd();
};

/**
 * 打印节点业务配置（应用层数据）
 */
export const debugNodeConfigs = () => {
  console.group('⚙️ Node Configs (App Layer)');
  
  const allConfigs = nodeConfigStore.getAll();
  const nodeIds = Object.keys(allConfigs);
  
  if (nodeIds.length === 0) {
    console.log('暂无节点配置');
  } else {
    nodeIds.forEach((nodeId) => {
      console.log(`${nodeId}:`, allConfigs[nodeId]);
    });
  }
  
  console.groupEnd();
  
  return allConfigs;
};

/**
 * 打印完整的数据分离状态
 */
export const debugDataSeparation = (flowRef: React.RefObject<CanvasFlowHandle | null>) => {
  const flow = flowRef.current?.getFlow();
  
  if (!flow) {
    console.warn('📊 [Debug] Flow 未初始化');
    return;
  }
  
  console.group('📊 Data Separation Debug');
  
  flow.nodes.forEach((node: any) => {
    const config = nodeConfigStore.get(node.id);
    
    console.group(`📦 ${node.id} (${node.type})`);
    console.log('Core Layer (node.data):', node.data);
    console.log('App Layer (nodeConfig):', config);
    
    // 检查是否有数据泄漏
    const hasParamsInData = node.data && ('params' in node.data);
    const hasPromptInData = node.data && ('prompt' in node.data);
    
    if (hasParamsInData || hasPromptInData) {
      console.error('❌ 数据分离失败！node.data 中仍包含业务配置:', {
        hasParams: hasParamsInData,
        hasPrompt: hasPromptInData
      });
    } else {
      console.log('✅ 数据分离正确');
    }
    
    console.groupEnd();
  });
  
  console.groupEnd();
};

/**
 * 测试坐标转换（用于验证编组操作）
 */
export const testCoordinates = (flowRef: React.RefObject<CanvasFlowHandle | null>) => {
  const flow = flowRef.current?.getFlow();
  
  if (!flow) {
    console.warn('🧪 [Test] Flow 未初始化');
    return;
  }
  
  console.group('🧪 坐标系统测试');
  
  // 显示所有节点的坐标和标记
  console.table(flow.nodes.map((node: any) => ({
    id: node.id,
    type: node.type,
    x: node.position.x.toFixed(2),
    y: node.position.y.toFixed(2),
    groupId: node.groupId || '-',
    coordinateType: node._coordinateType || 'unspecified',
  })));
  
  // 显示所有编组
  if (flow.groups && flow.groups.length > 0) {
    console.log('📦 编组列表:');
    console.table(flow.groups.map((group: any) => ({
      id: group.id,
      label: group.label,
      x: group.position.x,
      y: group.position.y,
      width: group.width,
      height: group.height,
    })));
  }
  
  console.groupEnd();
  
  return flow;
};

/**
 * 在浏览器控制台中暴露调试工具
 */
export const exposeDebugTools = (flowRef: React.RefObject<CanvasFlowHandle | null>) => {
  if (typeof window !== 'undefined') {
    (window as any).__CANVAS_FLOW__ = flowRef.current;
    (window as any).__NODE_CONFIG_STORE__ = nodeConfigStore;
    (window as any).__canvasFlow = flowRef.current; // ✅ 添加简短的别名
    (window as any).flowRef = flowRef; // ✅ 也暴露 ref
    
    // 用于测试的状态快照
    let beforeSnapshot: any = null;
    
    (window as any).__canvasFlowDebug = {
      flow: () => debugFlow(flowRef),
      media: () => debugMediaMap(flowRef),
      structure: () => debugNodeStructure(flowRef),
      configs: () => debugNodeConfigs(),
      separation: () => debugDataSeparation(flowRef),
      sync: (appFlow?: any) => debugSyncStatus(flowRef, appFlow),
      test: () => testCoordinates(flowRef),
      // 快照功能：用于对比操作前后的状态
      snapshot: () => {
        const flow = flowRef.current?.getFlow();
        beforeSnapshot = JSON.parse(JSON.stringify(flow));
        console.log('📸 已保存快照');
        return beforeSnapshot;
      },
      compare: (operationDesc: string, newGroupId?: string) => {
        if (!beforeSnapshot) {
          console.error('❌ 请先调用 snapshot() 保存快照');
          return;
        }
        const afterFlow = flowRef.current?.getFlow();
        if (!afterFlow) {
          console.error('❌ Flow 未初始化');
          return;
        }
        
        const result = runAllCoordinateTests(
          beforeSnapshot,
          { nodes: afterFlow.nodes, groups: afterFlow.groups ?? [] },
          operationDesc,
          newGroupId
        );
        
        // 清除快照
        beforeSnapshot = null;
        
        return result;
      },
      ref: flowRef,
    };
    
    console.log(
      '%c🛠️ Canvas Flow 调试工具已加载',
      'background: #222; color: #bada55; font-size: 14px; padding: 4px 8px; border-radius: 4px;'
    );
    console.log('在控制台输入以下命令进行调试:');
    console.log('  __canvasFlowDebug.flow()       - 查看完整 flow');
    console.log('  __canvasFlowDebug.media()      - 查看所有节点媒体数据');
    console.log('  __canvasFlowDebug.structure()  - 查看节点结构（不含媒体）');
    console.log('  __canvasFlowDebug.configs()    - 查看所有节点业务配置');
    console.log('  __canvasFlowDebug.separation() - 检查数据分离状态');
    console.log('  __canvasFlowDebug.sync()       - 检查同步状态');
    console.log('  __canvasFlowDebug.test()       - 测试坐标系统');
    console.log('');
    console.log('坐标测试流程:');
    console.log('  1. __canvasFlowDebug.snapshot()              - 操作前保存快照');
    console.log('  2. （执行编组操作：创建/删除/移动编组）');
    console.log('  3. __canvasFlowDebug.compare("操作描述", "新编组ID") - 对比验证');
    console.log('');
    console.log('全局变量:');
    console.log('  __CANVAS_FLOW__       - CanvasFlow API 引用');
    console.log('  __NODE_CONFIG_STORE__ - 节点配置 Store');
  }
};


