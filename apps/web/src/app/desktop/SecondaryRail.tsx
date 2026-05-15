// P2 — 240px secondary rail. Discord's "channel list" equivalent.
//
// Two tabs: 「节点」(node tree of the current canvas) and 「历史」(generation
// history of the current canvas). Active tab is global state (uiStore) so
// keyboard shortcuts / settings overlay actions can switch tabs from
// elsewhere later.
//
// Phase A: tabs render but content is placeholder. Phase B replaces the
// placeholders with actual node tree and history list (extracted from the
// existing GenerationHistoryPanel + a new SecondaryNodeTree component).

import React from 'react';

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

  return (
    <aside style={asideStyle} aria-label="Secondary rail">
      <div style={tabBarStyle} role="tablist">
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

      <div style={tabContentStyle}>
        {activeTab === 'nodes' && <SecondaryNodeTree />}
        {activeTab === 'templates' && <SecondaryTemplateList />}
        {activeTab === 'voices' && <SecondaryVoiceList />}
        {activeTab === 'history' && <SecondaryHistoryList />}
      </div>
    </aside>
  );
};

const asideStyle: React.CSSProperties = {
  width: 240,
  flexShrink: 0,
  background: '#0d0d0d',
  borderRight: '1px solid #1a1a1a',
  display: 'flex',
  flexDirection: 'column',
  boxSizing: 'border-box',
};

const tabBarStyle: React.CSSProperties = {
  display: 'flex',
  borderBottom: '1px solid #1a1a1a',
  flexShrink: 0,
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

const tabContentStyle: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflowY: 'auto',
  padding: 8,
  boxSizing: 'border-box',
};
