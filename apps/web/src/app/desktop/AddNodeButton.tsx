// "+ Add node" button for the P1 rail. Reuses core's FloatingNodeMenu so
// the menu UI (icons, upload tile, custom items) stays in lockstep with
// the canvas's own node-creation menus.
//
// Why not import from EditorLeftRail directly: we want to drop EditorLeftRail
// entirely. This component is the rail-friendly version — same menu, but the
// trigger is a square 36px tile to match CanvasRailList's visual rhythm.

import React, { useCallback, useState } from 'react';
import { createPortal } from 'react-dom';
import { Plus } from 'lucide-react';
import { FloatingNodeMenu } from '@canvas-flow/core';

import { useUIStore } from '../store/uiStore';

export const AddNodeButton: React.FC = () => {
  const items = useUIStore((s) => s.addNodeMenuItems);
  const addNode = useUIStore((s) => s.addNodeFromMenu);
  const uploadNode = useUIStore((s) => s.uploadNodeFromMenu);

  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);

  const handleClick = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    if (anchor) {
      setAnchor(null);
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    setAnchor({
      // Open immediately to the right of the rail (P1 width is 56, button
      // sits inside it). +8 leaves a tiny gutter so the popover doesn't
      // visually fuse with the rail border.
      x: rect.right + 8,
      // Align menu top with the button top, minus FloatingNodeMenu's own
      // 8px internal padding so the first item sits where the button is.
      y: rect.top - 8,
    });
  }, [anchor]);

  // Disable the button until EditorPage has registered its action callbacks
  // (happens within a few ms of canvas load). Avoids a confusing no-op
  // click during the brief window before the canvas is ready.
  const ready = !!addNode;

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        title={ready ? '添加节点' : '画布加载中…'}
        disabled={!ready}
        style={{
          ...buttonStyle,
          background: anchor ? '#fff' : 'rgba(255,255,255,0.04)',
          color: anchor ? '#111' : ready ? '#cbd0d8' : '#3f4451',
          borderStyle: anchor ? 'solid' : 'dashed',
          cursor: ready ? 'pointer' : 'not-allowed',
        }}
        onMouseEnter={(e) => {
          if (!ready || anchor) return;
          e.currentTarget.style.background = 'rgba(99,102,241,0.18)';
          e.currentTarget.style.color = '#a5b4fc';
        }}
        onMouseLeave={(e) => {
          if (!ready || anchor) return;
          e.currentTarget.style.background = 'rgba(255,255,255,0.04)';
          e.currentTarget.style.color = '#cbd0d8';
        }}
      >
        <Plus size={18} />
      </button>

      {anchor && addNode && createPortal(
        <FloatingNodeMenu
          position={anchor}
          onAddNode={(type) => {
            addNode(type);
            setAnchor(null);
          }}
          onUploadNode={uploadNode ? (file) => {
            uploadNode(file);
            setAnchor(null);
          } : undefined}
          availableTypes={items}
          onClose={() => setAnchor(null)}
        />,
        document.body,
      )}
    </>
  );
};

const buttonStyle: React.CSSProperties = {
  width: 36,
  height: 36,
  borderRadius: 10,
  border: '1px dashed rgba(255,255,255,0.12)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
  transition: 'background 0.15s, color 0.15s, border-color 0.15s',
  padding: 0,
};
