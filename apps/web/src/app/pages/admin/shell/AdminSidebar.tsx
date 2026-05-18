import React from 'react';
import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft } from 'lucide-react';
import type { AdminModule } from '../types';

export interface AdminSidebarProps {
  modules: AdminModule[];
  /** Absolute path to jump back to the editor — defaults to `/canvas`. */
  backTo?: string;
  /** Absolute base used to mount the admin shell. Module paths are joined
   *  to this base when rendering `NavLink`s. Kept absolute so we don't
   *  rely on react-router relative-path resolution under splat routes
   *  (`<Route path="/admin/*">`), which is fiddly and was the reason
   *  sidebar nav silently no-op'd before. */
  basePath?: string;
}

/**
 * Left rail nav. Renders a back-to-canvas link on top + one item per
 * registered admin module. Active state purely driven by `react-router`
 * `NavLink`, so route changes from anywhere (browser back, programmatic
 * navigation, deep-link) stay in sync.
 */
export const AdminSidebar: React.FC<AdminSidebarProps> = ({
  modules,
  backTo = '/canvas',
  basePath = '/admin',
}) => {
  const { t } = useTranslation();
  const join = (p: string) =>
    `${basePath.replace(/\/$/, '')}/${p.replace(/^\//, '')}`;
  return (
    <aside style={asideStyle}>
      <div style={brandStyle}>Canvas Flow · 后台</div>

      <NavLink to={backTo} style={backLinkStyle}>
        <ArrowLeft size={14} />
        <span>回画布</span>
      </NavLink>

      <nav style={navStyle}>
        {modules.map((m) => {
          const Icon = m.icon;
          return (
            <NavLink
              key={m.id}
              to={join(m.path)}
              style={({ isActive }) => navItemStyle(isActive)}
            >
              <Icon size={16} />
              <span>{t(m.labelKey)}</span>
            </NavLink>
          );
        })}
      </nav>
    </aside>
  );
};

const asideStyle: React.CSSProperties = {
  width: 200,
  flexShrink: 0,
  background: '#0d0d0d',
  borderRight: '1px solid #1f1f1f',
  display: 'flex',
  flexDirection: 'column',
  padding: '20px 12px',
  gap: 12,
  height: '100vh',
  boxSizing: 'border-box',
  overflowY: 'auto',
};

const brandStyle: React.CSSProperties = {
  color: '#aaa',
  fontSize: 12,
  fontWeight: 600,
  letterSpacing: 0.4,
  textTransform: 'uppercase',
  padding: '4px 8px 8px',
};

const backLinkStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  color: '#888',
  textDecoration: 'none',
  fontSize: 12,
  padding: '6px 8px',
  borderRadius: 6,
};

const navStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  marginTop: 8,
};

const navItemStyle = (active: boolean): React.CSSProperties => ({
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '8px 10px',
  borderRadius: 8,
  textDecoration: 'none',
  fontSize: 13,
  fontWeight: active ? 600 : 400,
  color: active ? '#fff' : '#bbb',
  background: active ? 'rgba(255,255,255,0.06)' : 'transparent',
  transition: 'background 0.15s, color 0.15s',
});
