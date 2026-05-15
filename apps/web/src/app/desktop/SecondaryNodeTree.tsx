// P2 「节点」tab — flat list of nodes in the current canvas.
//
// Click a row → scroll the matching xyflow node into view. We use DOM
// `scrollIntoView` instead of a CanvasFlowHandle method because the core
// package's public surface doesn't yet expose a "focus on node" call, and
// adding one is out of scope for the desktop-shell PR. xyflow attaches a
// `data-id` attribute to every rendered node DOM element, which is enough
// for a smooth scroll-to.
//
// Future polish (not now):
//   - Group nodes by `groupId` so users see canvas hierarchy
//   - Drag nodes from this list onto the canvas as templates
//   - Right-click context menu (rename / delete) — would need to expose
//     handleNodeDelete via the store too
//
// If the canvas is empty / not loaded yet, render an empty state so
// the rail isn't a featureless dark box.

import React, { useCallback } from 'react';
import { Image, Video, Music, Type, FileText, Box } from 'lucide-react';

import { useUIStore, type NodeTreeEntry } from '../store/uiStore';

const ICONS: Record<string, React.ComponentType<{ size?: number }>> = {
  image: Image,
  video: Video,
  audio: Music,
  text: Type,
  prompt: FileText,
  group: Box,
};

const focusNodeOnCanvas = (nodeId: string) => {
  // xyflow renders each node as <div class="react-flow__node …" data-id="…">
  const el = document.querySelector<HTMLElement>(
    `.react-flow__node[data-id="${CSS.escape(nodeId)}"]`,
  );
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
  // Brief outline pulse so the user sees where the node is. Vanilla JS
  // because importing motion just for a 600ms ring is overkill.
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

  const handleClick = useCallback((entry: NodeTreeEntry) => {
    focusNodeOnCanvas(entry.id);
  }, []);

  if (nodes.length === 0) {
    return (
      <div style={emptyStyle}>
        画布暂无节点
        <br />
        <span style={emptyHintStyle}>
          点画布左侧 + 添加，或拖文件到画布
        </span>
      </div>
    );
  }

  return (
    <ul style={listStyle}>
      {nodes.map((n) => {
        const Icon = ICONS[n.type] ?? Box;
        const display = n.label || n.type;
        return (
          <li key={n.id}>
            <button
              type="button"
              onClick={() => handleClick(n)}
              style={rowStyle}
              title={`${display} (${n.id.slice(0, 8)})`}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(255,255,255,0.05)';
                e.currentTarget.style.color = '#fff';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent';
                e.currentTarget.style.color = '#cbd0d8';
              }}
            >
              <Icon size={14} />
              <span style={labelStyle}>{display}</span>
              <span style={typeStyle}>{n.type}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
};

const listStyle: React.CSSProperties = {
  listStyle: 'none',
  margin: 0,
  padding: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 1,
};

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  width: '100%',
  padding: '6px 8px',
  border: 'none',
  background: 'transparent',
  color: '#cbd0d8',
  cursor: 'pointer',
  borderRadius: 6,
  fontSize: 12,
  textAlign: 'left',
  transition: 'background 0.15s, color 0.15s',
};

const labelStyle: React.CSSProperties = {
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
