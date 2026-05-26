// P2 — 240px secondary rail. Discord's "channel list" equivalent.
//
// Four tabs: 节点 / 模板 / 音色 / 历史. Active tab lives in uiStore.

import React from 'react';
import { PanelLeftClose } from 'lucide-react';

import { useUIStore, type SecondaryTab } from '../store/uiStore';
import { SecondaryNodeTree } from './SecondaryNodeTree';
import { SecondaryTemplateList } from './SecondaryTemplateList';
import { SecondaryVoiceList } from './SecondaryVoiceList';
import { SecondaryHistoryList } from './SecondaryHistoryList';

const TABS: ReadonlyArray<{ id: SecondaryTab; label: string }> = [
  { id: 'nodes', label: '节点' },
  { id: 'templates', label: '模板' },
  { id: 'voices', label: '音色' },
  { id: 'history', label: '历史' },
];

export const SecondaryRail: React.FC = () => {
  const activeTab = useUIStore((s) => s.secondaryTab);
  const setTab = useUIStore((s) => s.setSecondaryTab);
  const collapsed = useUIStore((s) => s.secondaryRailCollapsed);
  const collapse = useUIStore((s) => s.toggleSecondaryRail);

  return (
    <aside
      style={{
        ...asideStyle,
        width: collapsed ? 0 : RAIL_WIDTH,
        // collapse 后 inert 整块, 避免键盘焦点 / 屏幕阅读器走到隐藏内容里.
        // (HTML 标准属性, React 19 / TS 5 已识别.)
        ...(collapsed ? { pointerEvents: 'none' } : null),
      }}
      aria-hidden={collapsed}
      aria-label="Secondary rail"
    >
      {/* 内层固定 240px width, 即使 aside 在 transition 到 0 也不会让内容
          被压扁后再展开时回弹. 父容器 overflow:hidden 负责把多余部分裁掉. */}
      <div style={innerStyle}>
      <div style={tabBarStyle} role="tablist">
        <div style={tabsGroupStyle}>
          {TABS.map((t) => {
            const active = activeTab === t.id;
            return (
              <button
                key={t.id}
                role="tab"
                aria-selected={active}
                onClick={() => setTab(t.id)}
                style={{
                  ...tabButtonStyle,
                  color: active ? '#fff' : '#8a8f98',
                  borderBottomColor: active ? '#fff' : 'transparent',
                  fontWeight: active ? 600 : 500,
                }}
                type="button"
              >
                {t.label}
              </button>
            );
          })}
        </div>
        <button
          type="button"
          onClick={collapse}
          title="收起侧边栏 (Cmd+B)"
          aria-label="收起侧边栏"
          style={collapseBtnStyle}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'rgba(255,255,255,0.06)';
            e.currentTarget.style.color = '#fff';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent';
            e.currentTarget.style.color = '#8a8f98';
          }}
        >
          <PanelLeftClose size={14} />
        </button>
      </div>

      <div style={tabContentStyle}>
        {activeTab === 'nodes' && <SecondaryNodeTree />}
        {activeTab === 'templates' && <SecondaryTemplateList />}
        {activeTab === 'voices' && <SecondaryVoiceList />}
        {activeTab === 'history' && <SecondaryHistoryList />}
      </div>
      </div>
    </aside>
  );
};

const RAIL_WIDTH = 240;

const asideStyle: React.CSSProperties = {
  flexShrink: 0,
  background: '#0d0d0d',
  borderRight: '1px solid #1a1a1a',
  boxSizing: 'border-box',
  // Smooth slide. cubic-bezier(0.32, 0.72, 0, 1) is roughly Apple's
  // ease-out-expo — feels intentional and weighted, not snappy/twitchy.
  transition: 'width 220ms cubic-bezier(0.32, 0.72, 0, 1)',
  overflow: 'hidden',
};

const innerStyle: React.CSSProperties = {
  width: 240,
  height: '100%',
  display: 'flex',
  flexDirection: 'column',
};

const tabBarStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'stretch',
  borderBottom: '1px solid #1a1a1a',
  flexShrink: 0,
};

const tabsGroupStyle: React.CSSProperties = {
  display: 'flex',
  flex: 1,
  minWidth: 0,
};

const tabButtonStyle: React.CSSProperties = {
  flex: 1,
  padding: '12px 0',
  background: 'transparent',
  border: 'none',
  borderBottom: '2px solid transparent',
  fontSize: 12,
  letterSpacing: 0.4,
  cursor: 'pointer',
  transition: 'color 0.15s, border-color 0.15s',
};

const collapseBtnStyle: React.CSSProperties = {
  width: 32,
  flexShrink: 0,
  border: 'none',
  background: 'transparent',
  color: '#8a8f98',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderLeft: '1px solid #1a1a1a',
  transition: 'background 0.15s, color 0.15s',
};

const tabContentStyle: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflowY: 'auto',
  padding: 8,
  boxSizing: 'border-box',
};
