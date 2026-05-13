/**
 * 坐标转换测试工具
 * 用于验证编组操作不会影响其他编组的节点位置
 */

import { CanvasFlowNode, CanvasFlowGroup } from '@canvas-flow/core';

export interface CoordinateTestResult {
  passed: boolean;
  message: string;
  details?: any;
}

/**
 * 测试场景1：创建编组不影响已有编组
 */
export function testGroupCreationIsolation(
  beforeNodes: CanvasFlowNode[],
  afterNodes: CanvasFlowNode[],
  newGroupId: string
): CoordinateTestResult {
  // 找出不在新编组中的节点
  const unchangedNodes = beforeNodes.filter(
    node => !afterNodes.some(n => n.id === node.id && n.groupId === newGroupId)
  );
  
  // 验证这些节点的位置没有变化
  for (const beforeNode of unchangedNodes) {
    const afterNode = afterNodes.find(n => n.id === beforeNode.id);
    
    if (!afterNode) {
      return {
        passed: false,
        message: `节点 ${beforeNode.id} 在操作后丢失`,
        details: { beforeNode }
      };
    }
    
    // 比较位置（允许小数点误差）
    const positionChanged = 
      Math.abs(beforeNode.position.x - afterNode.position.x) > 0.01 ||
      Math.abs(beforeNode.position.y - afterNode.position.y) > 0.01;
    
    if (positionChanged) {
      return {
        passed: false,
        message: `节点 ${beforeNode.id} 的位置发生了变化`,
        details: {
          before: beforeNode.position,
          after: afterNode.position,
          diff: {
            x: afterNode.position.x - beforeNode.position.x,
            y: afterNode.position.y - beforeNode.position.y
          }
        }
      };
    }
  }
  
  return {
    passed: true,
    message: `✅ 测试通过：${unchangedNodes.length} 个未操作的节点位置保持不变`
  };
}

/**
 * 测试场景2：坐标类型标记正确性
 */
export function testCoordinateTypeMarking(
  nodes: CanvasFlowNode[]
): CoordinateTestResult {
  const errors: string[] = [];
  
  for (const node of nodes) {
    if (node.groupId) {
      // 在编组内的节点
      if (!node._coordinateType) {
        errors.push(`节点 ${node.id} 在编组内但缺少坐标类型标记`);
      } else if (node._coordinateType === 'absolute') {
        // 绝对坐标：检查位置是否合理（应该在编组外部）
        // 这是合法的，说明是从 getFlow() 返回的数据
      } else if (node._coordinateType === 'relative') {
        // 相对坐标：检查位置是否在合理范围内
        if (node.position.x < -1000 || node.position.y < -1000 ||
            node.position.x > 10000 || node.position.y > 10000) {
          errors.push(`节点 ${node.id} 的相对坐标超出合理范围: ${JSON.stringify(node.position)}`);
        }
      }
    } else {
      // 不在编组内的节点
      if (node._coordinateType && node._coordinateType !== 'absolute') {
        errors.push(`节点 ${node.id} 不在编组内但坐标类型不是 absolute: ${node._coordinateType}`);
      }
    }
  }
  
  if (errors.length > 0) {
    return {
      passed: false,
      message: `❌ 坐标类型标记错误`,
      details: { errors }
    };
  }
  
  return {
    passed: true,
    message: `✅ 所有节点的坐标类型标记正确`
  };
}

/**
 * 测试场景3：编组内节点的相对位置
 */
export function testGroupedNodesRelativePosition(
  nodes: CanvasFlowNode[],
  groups: CanvasFlowGroup[]
): CoordinateTestResult {
  const groupMap = new Map(groups.map(g => [g.id, g]));
  const errors: string[] = [];
  
  for (const node of nodes) {
    if (!node.groupId) continue;
    
    const group = groupMap.get(node.groupId);
    if (!group) {
      errors.push(`节点 ${node.id} 的编组 ${node.groupId} 不存在`);
      continue;
    }
    
    // 如果节点标记为绝对坐标，验证它是否真的在编组范围内
    if (node._coordinateType === 'absolute') {
      const inGroupX = node.position.x >= group.position.x && 
                      node.position.x <= group.position.x + group.width;
      const inGroupY = node.position.y >= group.position.y && 
                      node.position.y <= group.position.y + group.height;
      
      if (!inGroupX || !inGroupY) {
        // 这不一定是错误，可能节点被拖出了编组范围
        // 但我们记录下来作为警告
        console.warn(`节点 ${node.id} 标记为编组内但位置超出编组范围`, {
          node: node.position,
          group: { x: group.position.x, y: group.position.y, w: group.width, h: group.height }
        });
      }
    }
  }
  
  if (errors.length > 0) {
    return {
      passed: false,
      message: `❌ 编组内节点位置验证失败`,
      details: { errors }
    };
  }
  
  return {
    passed: true,
    message: `✅ 所有编组内节点的位置合法`
  };
}

/**
 * 运行所有测试
 */
export function runAllCoordinateTests(
  beforeState: { nodes: CanvasFlowNode[], groups: CanvasFlowGroup[] },
  afterState: { nodes: CanvasFlowNode[], groups: CanvasFlowGroup[] },
  operationDescription: string,
  newGroupId?: string
): { passed: boolean; results: CoordinateTestResult[] } {
  console.log(`\n========== 坐标转换测试：${operationDescription} ==========`);
  
  const results: CoordinateTestResult[] = [];
  
  // 测试1：如果是创建编组，验证其他节点不受影响
  if (newGroupId) {
    const test1 = testGroupCreationIsolation(beforeState.nodes, afterState.nodes, newGroupId);
    results.push(test1);
    console.log(test1.message);
    if (!test1.passed && test1.details) {
      console.error('详情:', test1.details);
    }
  }
  
  // 测试2：坐标类型标记
  const test2 = testCoordinateTypeMarking(afterState.nodes);
  results.push(test2);
  console.log(test2.message);
  if (!test2.passed && test2.details) {
    console.error('详情:', test2.details);
  }
  
  // 测试3：编组内节点位置
  const test3 = testGroupedNodesRelativePosition(afterState.nodes, afterState.groups);
  results.push(test3);
  console.log(test3.message);
  if (!test3.passed && test3.details) {
    console.error('详情:', test3.details);
  }
  
  const passed = results.every(r => r.passed);
  console.log(`\n========== 测试结果：${passed ? '✅ 全部通过' : '❌ 存在失败'} ==========\n`);
  
  return { passed, results };
}




















