# Canvas Core 节点与编组使用与扩展指南

> 目标：5 分钟跑起来，10 分钟新增一个节点；理解核心概念。

目录
- 你将获得 / 你需要
- 5 分钟跑起来（最小示例）
- 核心概念：结构 vs 媒体
- 配置与注册：节点定义 + 组件表
- 媒体与状态 API（Handle）
- 编组使用与事件钩子（含传参/建议）
- 执行模型：默认与自定义
- 10 分钟新增一个节点（步骤+示例）
- 常见问题/排查
- 参考入口

---

## 你将获得 / 你需要
- 你将获得：可拖拽/分组/运行的节点编排画布，语义化媒体/状态 API，可自定义节点与执行逻辑。
- 你需要：React 18/19 环境；了解基本组件/props；无需编排引擎背景。

---

## 5 分钟跑起来（最小示例，占 2/5）
```tsx
import { useRef } from 'react';
import CanvasFlow, { defaultCanvasConfig, defaultComponentRegistry } from '@canvas-flow/core';
import type { CanvasFlowHandle, CanvasFlowValue } from '@canvas-flow/core';

const initialFlow: CanvasFlowValue = {
  nodes: [
    { id: 'text-1', type: 'text', position: { x: 0, y: 0 }, data: { text: 'Hello' } },
    { id: 'img-1', type: 'image', position: { x: 320, y: 0 } },
  ],
  edges: [{ id: 'e1', source: 'text-1', target: 'img-1' }],
  groups: [],
};

export default function Demo() {
  const flowRef = useRef<CanvasFlowHandle>(null);
  return (
    <div style={{ width: '100%', height: 560 }}>
      <CanvasFlow
        ref={flowRef}
        initialFlow={initialFlow}
        config={defaultCanvasConfig}
        components={defaultComponentRegistry}
        onRunFlow={async () => {
          flowRef.current?.setNodeLoading('text-1');
          await new Promise(r => setTimeout(r, 300));
          flowRef.current?.setNodeText('text-1', 'Hello Canvas');
          flowRef.current?.clearNodeLoading('text-1');
        }}
      />
    </div>
  );
}
```
验证：看到文本节点连到图片节点；运行时文本节点出现 loading，随后文案更新。

---

## 核心概念：结构 vs 媒体（用途/注意）
```
[结构层 CanvasFlowValue]
  nodes (id/type/pos/size/groupId)
  edges (source -> target)
  groups (id/pos/size/label)

[媒体层 mediaMap - 仅通过 Handle API]
  src | text | outputData | _loading | _error | fileName ...
```
- 用途：结构层仅描述拓扑/尺寸/归属；媒体与 UI 状态存于 `mediaMap`。
- 调用建议：只用 Handle API 读写媒体/状态；结构数据用 `getFlow`。
- 注意：业务配置放外部 Store，不写进 `data`；`data` 仅用于结构/媒体分离下的展示必要字段。

---

## 配置与注册：节点定义 + 组件表（用途/示例/建议）
- `CanvasConfig.nodeDefinitions`
  - 用途：声明可用节点类型与 UI/连接规则。
  - 字段说明：
    - `type`：唯一类型标识（示例：`'image'`）
    - `label`：显示名称（示例：`'图片'`）
    - `component`：组件表中的键（示例：`'ImageNode'`）
    - `defaultData`：媒体/展示默认值（示例：`{ src: '', resourceType: 'image/png' }`）
    - `width/height`：初始尺寸（示例：`260/260`）
    - `connectionRules.allowedSources/allowedTargets`：连线规则（示例：sources `['text','image']`，targets `['video']`）
  - 调用建议：尽量为每类节点给出默认尺寸与连接白名单，避免自由连线导致无效流。
- `ComponentRegistry`
  - 用途：把组件名映射到实际 React 组件。
  - 示例：`const components = { ...defaultComponentRegistry };`
  - 注意：键名需与 `nodeDefinitions[*].component` 对应，否则节点会显示 “Missing Component”。

---

## 媒体与状态 API（用途/时机/示例/建议）
通过 `ref.current` 获取：

媒体类
- `setNodeImage(nodeId, src)` / `setNodeVideo` / `setNodeAudio` / `setNodeText`
  - 用途：设置媒体或文本。
  - 示例：`setNodeImage('img-1', 'https://...')`
  - 建议：先确保节点类型匹配（API 内部有校验，避免无效调用）。
- `setNodeTitle(nodeId, title)`
  - 用途：设置节点标题。
  - 示例：`setNodeTitle('node-1', '生成结果')`
- `setNodeOutput(nodeId, outputData)`
  - 用途：写入结构化结果。
  - 示例：`setNodeOutput('node-1', { summary: 'ok' })`

状态类
- `setNodeLoading(nodeId)` / `clearNodeLoading(nodeId)`
  - 用途：标记/清除节点运行态。
  - 示例：运行前 `setNodeLoading`，完成后 `clearNodeLoading`。
- `setNodeError(nodeId, msg)` / `clearNodeError(nodeId)`
  - 用途：标记/清除错误。

查询类
- `getNode(nodeId)` / `getUpstreamNodes(nodeId)` / `getNodeMedia(nodeId)` / `getFlow()`
  - 用途：获取结构或媒体数据；`getUpstreamNodes` 方便调试上游输出。

兼容类（不推荐）
- `updateNodeMedia` / `batchUpdateNodeMedia`
  - 用途：旧版直写媒体，缺少类型/白名单过滤。
  - 建议：优先语义化 API。

典型执行片段：
```ts
flowRef.current?.setNodeLoading(nodeId);
try {
  const result = await runNode(nodeId);
  flowRef.current?.setNodeOutput(nodeId, result);
} catch (e: any) {
  flowRef.current?.setNodeError(nodeId, e?.message || 'error');
} finally {
  flowRef.current?.clearNodeLoading(nodeId);
}
```

注意/白名单（常用字段）：`src` / `text` / `title` / `outputData` / `_loading` / `_error` / `_executionStatus` / `fileName` / `fileType` / `_uploading` / `_uploadError` / `resourceType`。

---

## 编组使用与事件钩子（含传参/建议）
行为：多选创建/合并编组；解组保留节点；拖拽节点自动更新组尺寸；可对子组运行/保存。

事件钩子（均为 `CanvasFlow` props，可任选）：

- `onGroupAdd(group)`
  - 时机：新建编组后。
  - 传入示例：
    ```ts
    {
      id: 'group-1',
      label: '新建分组',
      position: { x: 100, y: 80 },
      width: 420,
      height: 260,
      style: { backgroundColor: '#f6f8fa' }
    }
    ```
  - 调用建议：落盘编组元数据或同步到外部 Store。

- `onGroupDelete(groupId)`
  - 时机：删除编组（组内节点也会被移除）。
  - 示例：`'group-1'`
  - 调用建议：清理关联配置/权限。

- `onGroupUpdate(partialGroup)`
  - 时机：拖拽/尺寸变化后保存位置与尺寸。
  - 示例：
    ```ts
    { id: 'group-1', position: { x: 120, y: 90 }, width: 500, height: 320 }
    ```
  - 调用建议：持久化最新尺寸/位置。

- `onGroupUngroup(groupId, nodeIds)`
  - 时机：解组（仅移除组，保留节点）。
  - 示例：`('group-1', ['node-a', 'node-b'])`
  - 调用建议：清理外部关于该组的元数据。

- `onGroupRun(groupId)`
  - 时机：点击组运行；如果提供则由你接管执行。
  - 示例：`'group-1'`
  - 调用建议：在后端/服务端调度该子 flow；执行前后用 Handle API 设置组内节点 loading/error。

- `onGroupSave(groupId, groupFlow)`
  - 时机：保存编组（抽取子 flow）。
  - 示例：
    ```ts
    ('group-1', {
      nodes: [...],
      edges: [...],
      groups: [{ id: 'group-1', label: '新建分组', position: { x: 120, y: 90 }, width: 500, height: 320 }],
      meta: { ... }
    })
    ```
  - 调用建议：把子流程存成模板或上传后端。

节点/边事件（如需同步外部状态或审计）：
- `onNodeAdd(node)` / `onNodeCopy(sourceNodeId, newNodeId)` / `onNodeDelete(nodeId)` / `onNodeMove(node)` / `onNodeDataChange(nodeId, data)`
- `onEdgeAdd(edge)` / `onEdgeDelete(edgeId)`
- `onSelectionChange(nodeIds)` — 选中节点变化时触发

---

## 画布交互扩展

### 拖拽放置（onCanvasDrop）
```tsx
<CanvasFlow
  onCanvasDrop={(event) => {
    // event.data: 拖拽数据（JSON 解析后）
    // event.position: 画布坐标 { x, y }
    // event.dataTransfer: 原始 DataTransfer
  }}
/>
```
- 用途：从外部列表拖入画布时创建节点。
- 传入类型：`CanvasDropEvent`（从包导出）。

### 自定义右键菜单（getNodeContextMenuItems）
```tsx
<CanvasFlow
  getNodeContextMenuItems={(nodeId, node, mediaData) => [
    { label: '导出', onClick: () => exportNode(nodeId) },
    { label: '复制链接', onClick: () => copyLink(mediaData.src), disabled: !mediaData.src },
  ]}
/>
```
- 用途：为节点追加自定义右键菜单项（追加到默认菜单之后）。
- 类型：`CustomContextMenuItem[]`（从包导出）。

---

## 执行模型：默认与自定义（用途/时机/示例/建议）
- 默认执行（FlowRunner 串行）
  - 用途：快速跑通，无需自建调度。
  - 时机：未提供自定义 `runFlow` 时使用；`runNode` 可选。
  - 行为：按节点顺序串行，聚合上游输出到 `ctx.incoming` 后调用 `runNode`。
  - 注意：无拓扑排序优化，复杂依赖可自定义。
- 自定义单节点：`execution.runNode = async (ctx) => ({ output, artifacts? })`
  - ctx 示例：
    ```ts
    {
      node,                    // CanvasFlowNode
      incoming: [prevOutputs], // 上游输出数组
      flow                     // 当前（子）flow
    }
    ```
  - 建议：在此调用后端服务/模型推理；返回结构化 output。
- 自定义全局：`execution.runFlow = async (flow) => any`
  - 用途：接管整个流的调度/并行/重试。
  - 时机：需要复杂拓扑/并行/幂等控制时。
  - 注意：提供后默认串行将被跳过。

---

## 10 分钟新增一个节点（步骤/示例/验证）
1) 内容组件（`NodeContentProps`，用 `onChange` 写媒体字段）
```tsx
import type { NodeContentProps } from '@canvas-flow/core';
export function MarkdownNode({ data, onChange }: NodeContentProps) {
  return (
    <textarea
      style={{ width: '100%', height: '100%' }}
      defaultValue={data?.text || ''}
      onChange={(e) => onChange({ text: e.target.value })}
    />
  );
}
```
2) 注册组件表
```ts
const components = { ...defaultComponentRegistry, MarkdownNode };
```
3) `nodeDefinitions` 增加条目
```ts
const markdownDef = {
  type: 'markdown',
  label: 'Markdown',
  component: 'MarkdownNode',
  width: 320,
  height: 240,
  defaultData: { text: '# Hello' },
  connectionRules: { allowedSources: ['text'], allowedTargets: ['image', 'video'] },
};
const config = {
  ...defaultCanvasConfig,
  nodeDefinitions: [...defaultCanvasConfig.nodeDefinitions, markdownDef],
};
```
4) 挂到 `CanvasFlow`
```tsx
<CanvasFlow config={config} components={components} />
```
5) 验证清单
- 能拖出新节点；连线符合规则。
- `onChange` 更新文本并能通过 `getNodeMedia` 读到。
- 编组后坐标/尺寸正常；拖动组会触发 `onGroupUpdate`。
- Handle API 可设置/读取媒体（如 `setNodeText`）。

---

## 常见问题/排查
- 连接失败：检查 `connectionRules`；确保无环（DAG 校验）。
- 媒体字段不生效：仅白名单字段被接受；使用语义化 API；业务参数不要写 `data`。
- 组尺寸/坐标异常：确保节点有宽高/测量值；拖动后触发 `onGroupUpdate` 落盘。
- 兼容旧代码：`updateNodeMedia` 仍可用但不推荐，优先语义化 API。

---

## 参考入口
- 详细二开 / 接模型场景见仓库根 [`MODEL_INTEGRATION.md`](../../MODEL_INTEGRATION.md)
- 源码快速定位：
  - 默认节点与配置：`src/core/defaults.ts`
  - Handle/API & 媒体管理：`src/core/CanvasFlow.tsx`
  - 运行器：`src/core/FlowRunner.tsx`
  - 类型：`src/types/flow.ts`、`src/types/schema.ts`、`src/types/nodeData.ts`
  - 连接/编组交互：`src/core/hooks/useCanvasConnection.ts`、`src/core/CanvasEditor.tsx`

---

---

> 文档最后更新：2026-05-09

