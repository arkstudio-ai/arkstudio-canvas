import React, { Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AdminSidebar } from './AdminSidebar';
import { adminModules, DEFAULT_ADMIN_MODULE_ID } from './adminModules';

/** Absolute mount point. Kept here as the single source of truth so both
 *  sidebar links and internal Navigate redirects use the same base. */
const ADMIN_BASE = '/admin';

/**
 * 后台壳。Sidebar + content area, with all child routes coming straight
 * from `adminModules.ts`. Adding a new admin module = one entry in the
 * registry; this file stays untouched.
 *
 * All redirects use absolute paths because `<Route path="/admin/*">`
 * splats interact poorly with relative `to=` resolution in react-router
 * v6 — sidebar nav silently no-op'd before this was made explicit.
 */
export const AdminShell: React.FC = () => {
  const defaultModule = adminModules.find((m) => m.id === DEFAULT_ADMIN_MODULE_ID) ?? adminModules[0];
  const defaultPath = `${ADMIN_BASE}/${defaultModule?.path ?? 'usage'}`;

  return (
    <div style={rootStyle}>
      <AdminSidebar modules={adminModules} basePath={ADMIN_BASE} />
      <main style={mainStyle}>
        <Suspense fallback={<div style={loadingStyle}>加载中…</div>}>
          <Routes>
            {adminModules.map((m) => (
              <Route key={m.id} path={`${m.path}/*`} element={<m.Component />} />
            ))}
            <Route path="/" element={<Navigate to={defaultPath} replace />} />
            <Route path="*" element={<Navigate to={defaultPath} replace />} />
          </Routes>
        </Suspense>
      </main>
    </div>
  );
};

const rootStyle: React.CSSProperties = {
  display: 'flex',
  height: '100vh',
  width: '100vw',
  background: '#070707',
  color: '#e0e0e0',
  overflow: 'hidden',
};

const mainStyle: React.CSSProperties = {
  flex: 1,
  height: '100vh',
  overflow: 'auto',
  padding: 24,
  boxSizing: 'border-box',
};

const loadingStyle: React.CSSProperties = {
  color: '#888',
  fontSize: 13,
  padding: 24,
};
