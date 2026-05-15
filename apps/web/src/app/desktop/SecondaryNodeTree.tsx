// P2 「节点」tab — node tree of the current canvas, grouped by subgraph.
//
// Layout:
//   ┌──────────────────────────────────┐
//   │ [+] 添加节点                     │  ← toolbar
//   │ ───────────────────────────────  │
//   │ ▼ 编组 A                         │  ← group header (collapsible)
//   │   • image  (cover.png)           │
//   │   • text   (prompt)              │
//   │ ▶ 编组 B                         │  ← collapsed
//   │ ▼ 未分组                          │  ← synthetic bucket for top-level
//   │   • video  (intro)               │
//   └──────────────────────────────────┘
//
// We render all groups expanded by default. Header click toggles. The
// expand state is per-group, kept in component state — losing it on flow
// switch is fine and arguably correct (user expects to see everything when
// they jump to a different canvas).
//
// Click row → scroll the matching xyflow node into view.
// Right-click row → 详情 / 删除.

import React, { useCallback, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ChevronDown,
  ChevronRight,
  Image,
  Video,
  Music,
  Type,
  FileText,
  Box,
  FolderOpen,
  Plus,
  Info,
  Trash2,
} from 'lucide-react';
import { FloatingNodeMenu } from '@canvas-flow/core';

import {
  useUIStore,
  type GroupTreeEntry,
  type NodeTreeEntry,
} from '../store/uiStore';
import { ContextMenu, type ContextMenuItem } from './ContextMenu';
import { DetailModal, type DetailField } from './DetailModal';

const ICONS: Record<string, React.ComponentType<{ size?: number }>> = {
  image: Image,
  video: Video,
  audio: Music,
  text: Type,
  prompt: FileText,
  group: Box,
};

const UNGROUPED_KEY = '__ungrouped__';

const focusNodeOnCanvas = (nodeId: string) => {
  const el = document.querySelector<HTMLElement>(
    `.react-flow__node[data-id="${CSS.escape(nodeId)}"]`,
  );
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
  const prevOutline = el.style.outline;
  const prevOutlineOffset = el.style.outlineOffset;
  el.style.outline = '2px solid #4f46e5';
  el.style.outlineOffset = '4px';
  window.setTimeout(() => {
    el.style.outline = prevOutline;
    el.style.outlineOffset = prevOutlineOffset;
  }, 900);
};

export const SecondaryNodeTree: React.FC = () => {
  const nodes = useUIStore((s) => s.currentNodes);
  const groups = useUIStore((s) => s.currentGroups);
  const addNodeMenuItems = useUIStore((s) => s.addNodeMenuItems);
  const addNode = useUIStore((s) => s.addNodeFromMenu);
  const uploadNode = useUIStore((s) => s.uploadNodeFromMenu);
  const deleteNode = useUIStore((s) => s.deleteNodeFromCanvas);

  const [addAnchor, setAddAnchor] = useState<{ x: number; y: number } | null>(null);
  const [ctxMenu, setCtxMenu] = useState<{
    pos: { x: number; y: number };
    entry: NodeTreeEntry;
  } | null>(null);
  const [detail, setDetail] = useState<NodeTreeEntry | null>(null);
  // Per-group expand state. We seed lazily inside grouped() — every group
  // we encounter for the first time is treated as expanded.
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const grouped = useMemo(() => {
    // Bucket nodes by groupId. Anything without a groupId — or with a
    // groupId that doesn't match a known group (orphan) — falls into the
    // synthetic ungrouped bucket so we never lose nodes from the tree.
    const byGroup = new Map<string, NodeTreeEntry[]>();
    const knownGroupIds = new Set(groups.map((g) => g.id));
    for (const n of nodes) {
      const key = n.groupId && knownGroupIds.has(n.groupId) ? n.groupId : UNGROUPED_KEY;
      const arr = byGroup.get(key);
      if (arr) arr.push(n);
      else byGroup.set(key, [n]);
    }
    const sections: Array<{ group: GroupTreeEntry | null; nodes: NodeTreeEntry[] }> =
      groups.map((g) => ({ group: g, nodes: byGroup.get(g.id) ?? [] }));
    const ungrouped = byGroup.get(UNGROUPED_KEY) ?? [];
    if (ungrouped.length > 0 || sections.length === 0) {
      sections.push({ group: null, nodes: ungrouped });
    }
    return sections;
  }, [nodes, groups]);

  const toggleGroup = useCallback((key: string) => {
    setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const handleAddClick = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      e.stopPropagation();
      if (addAnchor) {
        setAddAnchor(null);
        return;
      }
      const rect = e.currentTarget.getBoundingClientRect();
      setAddAnchor({ x: rect.left, y: rect.bottom + 4 });
    },
    [addAnchor],
  );

  const ctxItems: ContextMenuItem[] = ctxMenu
    ? [
        {
          label: '聚焦到画布',
          icon: <Info size={14} />,
          onClick: () => focusNodeOnCanvas(ctxMenu.entry.id),
        },
        {
          label: '详细信息',
          icon: <Info size={14} />,
          onClick: () => setDetail(ctxMenu.entry),
        },
        { divider: true, label: '' },
        {
          label: '删除',
          icon: <Trash2 size={14} />,
          danger: true,
          disabled: !deleteNode,
          onClick: () => deleteNode?.(ctxMenu.entry.id),
        },
      ]
    : [];

  const detailFields: DetailField[] = detail
    ? [
        { label: 'ID', value: detail.id, copyable: true, monospace: true },
        { label: '类型', value: detail.type, monospace: true },
        { label: '显示名', value: detail.label ?? '' },
        { label: '所属编组', value: detail.groupId ?? '', monospace: true },
      ]
    : [];

  const ready = !!addNode;

  return (
    <div style={containerStyle}>
      <div style={toolbarStyle}>
        <button
          type="button"
          onClick={handleAddClick}
          disabled={!ready}
          style={{
            ...addBtnStyle,
            background: addAnchor ? 'rgba(99,102,241,0.18)' : 'transparent',
            color: addAnchor ? '#a5b4fc' : ready ? '#cbd0d8' : '#3f4451',
            cursor: ready ? 'pointer' : 'not-allowed',
          }}
          title={ready ? '添加节点' : '画布加载中…'}
          onMouseEnter={(e) => {
            if (!ready || addAnchor) return;
            e.currentTarget.style.background = 'rgba(255,255,255,0.05)';
          }}
          onMouseLeave={(e) => {
            if (!ready || addAnchor) return;
            e.currentTarget.style.background = 'transparent';
          }}
        >
          <Plus size={14} />
          <span style={addLabelStyle}>添加节点</span>
        </button>
      </div>

      {nodes.length === 0 && groups.length === 0 ? (
        <div style={emptyStyle}>
          画布暂无节点
          <br />
          <span style={emptyHintStyle}>点上方"添加节点"，或拖文件到画布</span>
        </div>
      ) : (
        <div style={treeStyle}>
          {grouped.map((section) => {
            const key = section.group ? section.group.id : UNGROUPED_KEY;
            const isCollapsed = !!collapsed[key];
            const headerLabel = section.group ? section.group.label : '未分组';
            return (
              <div key={key} style={sectionStyle}>
                <button
                  type="button"
                  onClick={() => toggleGroup(key)}
                  style={sectionHeaderStyle}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.color = '#fff';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.color = '#9aa0a6';
                  }}
                >
                  {isCollapsed ? (
                    <ChevronRight size={12} />
                  ) : (
                    <ChevronDown size={12} />
                  )}
                  {section.group ? (
                    <FolderOpen size={12} />
                  ) : (
                    <Box size={12} />
                  )}
                  <span style={sectionLabelStyle}>{headerLabel}</span>
                  <span style={sectionCountStyle}>{section.nodes.length}</span>
                </button>

                {!isCollapsed && (
                  <ul style={listStyle}>
                    {section.nodes.length === 0 ? (
                      <li style={emptyGroupStyle}>(空)</li>
                    ) : (
                      section.nodes.map((n) => {
                        const Icon = ICONS[n.type] ?? Box;
                        const display = n.label || n.type;
                        return (
                          <li key={n.id}>
                            <button
                              type="button"
                              onClick={() => focusNodeOnCanvas(n.id)}
                              onContextMenu={(e) => {
                                e.preventDefault();
                                setCtxMenu({
                                  pos: { x: e.clientX, y: e.clientY },
                                  entry: n,
                                });
                              }}
                              style={rowStyle}
                              title={`${display} (${n.id.slice(0, 8)})`}
                              onMouseEnter={(e) => {
                                e.currentTarget.style.background =
                                  'rgba(255,255,255,0.05)';
                                e.currentTarget.style.color = '#fff';
                              }}
                              onMouseLeave={(e) => {
                                e.currentTarget.style.background = 'transparent';
                                e.currentTarget.style.color = '#cbd0d8';
                              }}
                            >
                              <Icon size={14} />
                              <span style={nameStyle}>{display}</span>
                              <span style={typeStyle}>{n.type}</span>
                            </button>
                          </li>
                        );
                      })
                    )}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}

      {addAnchor && addNode && createPortal(
        <FloatingNodeMenu
          position={addAnchor}
          onAddNode={(type) => {
            addNode(type);
            setAddAnchor(null);
          }}
          onUploadNode={uploadNode ? (file) => {
            uploadNode(file);
            setAddAnchor(null);
          } : undefined}
          availableTypes={addNodeMenuItems}
          onClose={() => setAddAnchor(null)}
        />,
        document.body,
      )}

      {ctxMenu && (
        <ContextMenu
          position={ctxMenu.pos}
          items={ctxItems}
          onClose={() => setCtxMenu(null)}
        />
      )}

      {detail && (
        <DetailModal
          title={`节点 · ${detail.label || detail.type}`}
          fields={detailFields}
          onClose={() => setDetail(null)}
        />
      )}
    </div>
  );
};

const containerStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  height: '100%',
};

const toolbarStyle: React.CSSProperties = {
  display: 'flex',
  paddingBottom: 4,
  borderBottom: '1px solid #1a1a1a',
  marginBottom: 4,
};

const addBtnStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  flex: 1,
  padding: '6px 8px',
  borderRadius: 6,
  border: 'none',
  fontSize: 12,
  textAlign: 'left',
  transition: 'background 0.15s, color 0.15s',
};

const addLabelStyle: React.CSSProperties = {
  flex: 1,
};

const treeStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
};

const sectionStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
};

const sectionHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  width: '100%',
  padding: '4px 6px',
  border: 'none',
  background: 'transparent',
  color: '#9aa0a6',
  cursor: 'pointer',
  borderRadius: 4,
  fontSize: 11,
  fontWeight: 600,
  textAlign: 'left',
  textTransform: 'uppercase',
  letterSpacing: 0.4,
  transition: 'color 0.15s',
};

const sectionLabelStyle: React.CSSProperties = {
  flex: 1,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const sectionCountStyle: React.CSSProperties = {
  color: '#5a5f68',
  fontSize: 10,
  fontWeight: 500,
  letterSpacing: 0,
};

const listStyle: React.CSSProperties = {
  listStyle: 'none',
  margin: 0,
  // Indent under the group header so the tree shape reads at a glance.
  paddingInlineStart: 18,
  paddingTop: 1,
  paddingBottom: 2,
  display: 'flex',
  flexDirection: 'column',
  gap: 1,
};

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  width: '100%',
  padding: '5px 8px',
  border: 'none',
  background: 'transparent',
  color: '#cbd0d8',
  cursor: 'pointer',
  borderRadius: 6,
  fontSize: 12,
  textAlign: 'left',
  transition: 'background 0.15s, color 0.15s',
};

const nameStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const typeStyle: React.CSSProperties = {
  fontSize: 10,
  color: '#5a5f68',
  letterSpacing: 0.3,
  textTransform: 'uppercase',
};

const emptyGroupStyle: React.CSSProperties = {
  padding: '4px 8px',
  color: '#3f4451',
  fontSize: 10,
  fontStyle: 'italic',
};

const emptyStyle: React.CSSProperties = {
  color: '#8a8f98',
  fontSize: 12,
  padding: '24px 8px',
  textAlign: 'center',
  lineHeight: 1.6,
};

const emptyHintStyle: React.CSSProperties = {
  color: '#5a5f68',
  fontSize: 11,
};
