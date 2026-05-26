import { lazy } from 'react';
import { BarChart3, ScrollText, Settings, SlidersHorizontal } from 'lucide-react';
import type { AdminModule } from '../types';

/**
 * Admin shell module registry.
 *
 * Add a sub-module here in one line. The shell renders its sidebar nav and
 * routes from this array; modules themselves don't know they're being
 * mounted by this shell (商业版 fork 时可以单独把某个模块挂到独立顶级
 * 路由 + 独立 layout，这份注册表只负责"挂在 admin 壳子里"的入口).
 */
export const adminModules: AdminModule[] = [
  {
    id: 'usage',
    labelKey: 'settings:nav.usage',
    icon: BarChart3,
    path: 'usage',
    Component: lazy(async () => {
      const m = await import('../modules/usage/UsagePage');
      return { default: m.UsagePage };
    }),
  },
  {
    id: 'logs',
    labelKey: 'settings:nav.logs',
    icon: ScrollText,
    path: 'logs',
    Component: lazy(async () => {
      const m = await import('../modules/logs/LogsPage');
      return { default: m.LogsPage };
    }),
  },
  {
    id: 'config',
    labelKey: 'settings:nav.config',
    icon: Settings,
    path: 'config',
    Component: lazy(async () => {
      const m = await import('../modules/config/CanvasConfigPage');
      return { default: m.CanvasConfigPage };
    }),
  },
  {
    id: 'system',
    labelKey: 'settings:nav.system',
    icon: SlidersHorizontal,
    path: 'system',
    Component: lazy(async () => {
      const m = await import('../modules/system/SystemSettingsPage');
      return { default: m.SystemSettingsPage };
    }),
  },
  // 占位（未来 / 商业版按需加）：
  // { id: 'billing', labelKey: 'settings:nav.billing', icon: CreditCard, path: 'billing', Component: lazy(...) },
];

export const DEFAULT_ADMIN_MODULE_ID = 'usage';
