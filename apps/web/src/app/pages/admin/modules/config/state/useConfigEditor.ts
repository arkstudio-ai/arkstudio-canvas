import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  getCanvasConfig,
  getCanvasConfigVersion,
  saveCanvasConfig,
} from '../../../api/admin-api';
import { configService } from '../../../../../../services/configService';
import type { CanvasConfigPayload } from '../../../types';

/**
 * Editor state for /admin/config. The whole config tree is held twice --
 * `baseConfig` (last server snapshot) and `draftConfig` (user edits).
 * `isDirty` is a structural diff via JSON.stringify; cheap because the
 * config payload is at most a few KB.
 *
 * Save uses the existing PUT /api/canvas-flow/config which does smart
 * upsert + version bump on the backend; we then sync the editor's local
 * `serverVersion` and re-prime `baseConfig` from the response so a
 * second save without a refetch still works.
 */
export interface ConfigEditorApi {
  loading: boolean;
  saving: boolean;
  loaded: boolean;
  serverVersion: number;
  baseConfig: CanvasConfigPayload | null;
  draftConfig: CanvasConfigPayload | null;
  isDirty: boolean;
  load: () => Promise<void>;
  save: () => Promise<void>;
  reset: () => void;
  /**
   * Mutate the draft in place. Caller may also return a brand-new payload
   * to fully replace it. Cloning is done up front so callers can mutate
   * freely without touching the previous state.
   */
  setDraft: (
    updater: (draft: CanvasConfigPayload) => CanvasConfigPayload | void,
  ) => void;
}

export function useConfigEditor(): ConfigEditorApi {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [serverVersion, setServerVersion] = useState(0);
  const [baseConfig, setBaseConfig] = useState<CanvasConfigPayload | null>(null);
  const [draftConfig, setDraftConfig] = useState<CanvasConfigPayload | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [cfg, ver] = await Promise.all([getCanvasConfig(), getCanvasConfigVersion()]);
      setBaseConfig(cfg);
      setDraftConfig(structuredClone(cfg));
      setServerVersion(ver.version);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '加载配置失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const reset = useCallback(() => {
    if (!baseConfig) return;
    setDraftConfig(structuredClone(baseConfig));
  }, [baseConfig]);

  const setDraft = useCallback(
    (updater: (draft: CanvasConfigPayload) => CanvasConfigPayload | void) => {
      setDraftConfig((prev) => {
        if (!prev) return prev;
        const next = structuredClone(prev);
        const ret = updater(next);
        return ret ?? next;
      });
    },
    [],
  );

  const save = useCallback(async () => {
    if (!draftConfig) return;
    setSaving(true);
    try {
      const latestVer = await getCanvasConfigVersion();
      if (latestVer.version !== serverVersion) {
        throw new Error(
          `配置已被他人修改 (服务器 v${latestVer.version}, 你拿到的是 v${serverVersion})。请刷新后再保存`,
        );
      }
      const result = await saveCanvasConfig(draftConfig);
      setServerVersion(result.version);
      setBaseConfig(structuredClone(draftConfig));
      configService.clearCache();
      toast.success(
        `已保存 v${result.version} · 节点 ${result.summary.nodesUpdated} 改 / ${result.summary.nodesDeleted} 删`,
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '保存失败');
      throw err;
    } finally {
      setSaving(false);
    }
  }, [draftConfig, serverVersion]);

  const isDirty =
    !!baseConfig &&
    !!draftConfig &&
    JSON.stringify(baseConfig) !== JSON.stringify(draftConfig);

  return {
    loading,
    saving,
    loaded: !!baseConfig,
    serverVersion,
    baseConfig,
    draftConfig,
    isDirty,
    load,
    save,
    reset,
    setDraft,
  };
}
