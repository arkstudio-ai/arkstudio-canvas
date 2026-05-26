import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, RefreshCw, Save, RotateCcw, Download, Upload } from 'lucide-react';
import { toast } from 'sonner';
import {
  buttonAccentStyle,
  buttonStyle,
  emptyStyle,
  tabBarStyle,
  tabStyle,
  tokens,
} from './styles';
import { useConfigEditor } from './state/useConfigEditor';
import { NodeLevelCard } from './NodeLevelCard';
import { ModelGrid } from './ModelGrid';
import { ModelDetailDrawer, type ModelEntryDraft } from './ModelDetailDrawer';
import { ConfirmSaveDialog } from './forms/ConfirmSaveDialog';
import { ImportPreviewDialog } from './forms/ImportPreviewDialog';
import {
  exportCanvasConfig,
  importCanvasConfig,
} from '../../api/admin-api';
import type { ConfigExportEnvelope, ImportConfigResponse } from '../../types';

/**
 * /admin/config — top-level page.
 *
 * Tabs across the top = one per node type. Below: node-level card +
 * model grid. Click a model -> drawer opens with all editable fields.
 *
 * Save flow:
 *   [保存] -> ConfirmSaveDialog (diff summary)
 *         -> [确认] -> useConfigEditor.save() (re-checks version, PUT, bumps cache)
 *
 * Unsaved-changes guard uses a window beforeunload listener; in-app
 * navigation guards aren't wired because the surrounding app uses the
 * non-data router (BrowserRouter), which doesn't expose `useBlocker`.
 * Operators get a confirm() on tab close / reload, which is the highest-
 * risk path; in-app nav is acceptable to leave unguarded for now.
 */
export const CanvasConfigPage: React.FC = () => {
  const { t } = useTranslation();
  const editor = useConfigEditor();
  const [activeNodeType, setActiveNodeType] = useState<string | null>(null);
  const [openModelValue, setOpenModelValue] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // ---- import/export state ----
  // The hidden <input type="file"> is owned by the page; we never pass it
  // through children so the file-picker close/cancel behaviour stays
  // identical to a vanilla form input.
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importApplying, setImportApplying] = useState(false);
  const [importFileName, setImportFileName] = useState<string | null>(null);
  const [importEnvelope, setImportEnvelope] = useState<ConfigExportEnvelope | null>(null);
  const [importPreview, setImportPreview] = useState<ImportConfigResponse | null>(null);

  const resetImportState = () => {
    setImportFileName(null);
    setImportEnvelope(null);
    setImportPreview(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleExport = async () => {
    try {
      const envelope = await exportCanvasConfig();
      const blob = new Blob([JSON.stringify(envelope, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const stamp = new Date().toISOString().slice(0, 10);
      a.href = url;
      a.download = `canvas-config-v${envelope.exportedFromVersion}-${stamp}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success(t('settings:config.page.toastExported', { version: envelope.exportedFromVersion }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('settings:config.page.toastExportFailed'));
    }
  };

  const handleImportClick = () => {
    if (editor.isDirty) {
      const ok = window.confirm(t('settings:config.importConfirm'));
      if (!ok) return;
    }
    resetImportState();
    fileInputRef.current?.click();
  };

  const handleImportFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setImportFileName(file.name);
    setImportDialogOpen(true);
    try {
      const text = await file.text();
      const envelope = JSON.parse(text);
      setImportEnvelope(envelope);
      const preview = await importCanvasConfig(envelope, 'preview');
      setImportPreview(preview);
    } catch (err) {
      toast.error(
        err instanceof Error
          ? t('settings:config.page.toastPreviewFailed', { error: err.message })
          : t('settings:config.page.toastPreviewFailedFallback'),
      );
      setImportDialogOpen(false);
      resetImportState();
    } finally {
      setImporting(false);
    }
  };

  const handleImportConfirm = async () => {
    if (!importEnvelope) return;
    setImportApplying(true);
    try {
      const result = await importCanvasConfig(importEnvelope, 'apply');
      toast.success(
        t('settings:config.page.toastImported', {
          version: result.version,
          added: result.summary.nodesAdded,
          updated: result.summary.nodesUpdated,
          deleted: result.summary.nodesDeleted,
        }),
      );
      setImportDialogOpen(false);
      resetImportState();
      // Reload editor state so version badge + draft mirror the new server
      // truth; clearing local edits is intended (the import was a server-
      // side replace, anything in flight is now stale).
      await editor.load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('settings:config.page.toastImportFailed'));
    } finally {
      setImportApplying(false);
    }
  };

  useEffect(() => {
    if (!editor.draftConfig) return;
    if (
      activeNodeType &&
      editor.draftConfig.nodeDefinitions.some((n: any) => n.type === activeNodeType)
    )
      return;
    const first = editor.draftConfig.nodeDefinitions[0]?.type ?? null;
    setActiveNodeType(first);
  }, [editor.draftConfig, activeNodeType]);

  useEffect(() => {
    if (!editor.isDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [editor.isDirty]);

  const activeNode = useMemo(() => {
    if (!editor.draftConfig || !activeNodeType) return null;
    return editor.draftConfig.nodeDefinitions.find((n: any) => n.type === activeNodeType) ?? null;
  }, [editor.draftConfig, activeNodeType]);

  const openModel = useMemo(() => {
    if (!activeNode || !openModelValue) return null;
    return (activeNode.models ?? []).find((m: any) => m.value === openModelValue) ?? null;
  }, [activeNode, openModelValue]);

  const handleNodePatch = (patch: any) => {
    if (!activeNodeType) return;
    editor.setDraft((draft) => {
      const idx = draft.nodeDefinitions.findIndex((n: any) => n.type === activeNodeType);
      if (idx === -1) return;
      draft.nodeDefinitions[idx] = { ...draft.nodeDefinitions[idx], ...patch };
    });
  };

  const handleModelPatch = (patch: Partial<ModelEntryDraft>) => {
    if (!activeNodeType || !openModelValue) return;

    // Renaming `value` requires special handling: we (a) reject duplicates
    // up front so editor.setDraft() stays a pure transform, and (b) re-aim
    // openModelValue afterwards so the drawer keeps showing the row
    // instead of disappearing (drawer visibility is keyed on openModel,
    // which looks up by the current openModelValue).
    let nextValue: string | null = null;
    if (typeof patch.value === 'string') {
      const trimmed = patch.value.trim();
      if (trimmed && trimmed !== openModelValue) {
        const conflict = (activeNode?.models ?? []).some(
          (m: any) => m.value !== openModelValue && m.value === trimmed,
        );
        if (conflict) {
          alert(t('settings:config.page.dupValueAlert', { value: trimmed }));
          return;
        }
        nextValue = trimmed;
      }
    }

    editor.setDraft((draft) => {
      const node = draft.nodeDefinitions.find((n: any) => n.type === activeNodeType);
      if (!node) return;
      const i = (node.models ?? []).findIndex((m: any) => m.value === openModelValue);
      if (i === -1) return;
      node.models[i] = { ...node.models[i], ...patch };
    });

    if (nextValue) setOpenModelValue(nextValue);
  };

  const handleAddModel = (m: { value: string; label: string; action: string }) => {
    if (!activeNodeType) return;
    editor.setDraft((draft) => {
      const node = draft.nodeDefinitions.find((n: any) => n.type === activeNodeType);
      if (!node) return;
      const list = node.models ?? [];
      if (list.some((x: any) => x.value === m.value)) return;
      node.models = [...list, { ...m }];
    });
    setOpenModelValue(m.value);
  };

  const handleRemoveModel = (modelValue: string) => {
    if (!activeNodeType) return;
    editor.setDraft((draft) => {
      const node = draft.nodeDefinitions.find((n: any) => n.type === activeNodeType);
      if (!node) return;
      node.models = (node.models ?? []).filter((m: any) => m.value !== modelValue);
    });
    if (openModelValue === modelValue) setOpenModelValue(null);
  };

  const handleAddNode = () => {
    const type = prompt(t('settings:config.page.addNodePrompt'));
    if (!type) return;
    const trimmed = type.trim();
    if (!trimmed) return;
    if (editor.draftConfig?.nodeDefinitions.some((n: any) => n.type === trimmed)) {
      alert(t('settings:config.page.addNodeDuplicate', { type: trimmed }));
      return;
    }
    editor.setDraft((draft) => {
      draft.nodeDefinitions.push({
        type: trimmed,
        label: trimmed,
        component: 'TextNode',
        width: 250,
        height: 250,
        defaultData: {},
        defaultParams: {},
        connectionRules: { allowedSources: [], allowedTargets: [] },
        models: null,
      });
    });
    setActiveNodeType(trimmed);
  };

  if (!editor.loaded) {
    return (
      <div style={pageStyle}>
        <header style={headerStyle}>
          <h1 style={titleStyle}>{t('settings:config.page.title')}</h1>
        </header>
        <div style={emptyStyle}>{editor.loading ? t('settings:common.loading') : t('settings:config.page.notLoaded')}</div>
      </div>
    );
  }

  const cfg = editor.draftConfig!;
  const base = editor.baseConfig!;

  return (
    <div style={pageStyle}>
      <header style={headerStyle}>
        <div>
          <h1 style={titleStyle}>{t('settings:config.page.title')}</h1>
          <div style={subTitleStyle}>
            v{editor.serverVersion}
            {editor.isDirty && <span style={dirtyBadgeStyle}>{t('settings:config.page.unsavedBadge')}</span>}
          </div>
        </div>
        <div style={toolbarStyle}>
          <button
            type="button"
            onClick={() => editor.load()}
            style={buttonStyle}
            disabled={editor.loading}
          >
            <RefreshCw size={12} style={{ verticalAlign: 'middle' }} /> {t('settings:common.refresh')}
          </button>
          <button
            type="button"
            onClick={handleExport}
            style={buttonStyle}
            disabled={editor.loading}
            title={t('settings:config.page.exportTitle')}
          >
            <Download size={12} style={{ verticalAlign: 'middle' }} /> {t('settings:config.page.exportLabel')}
          </button>
          <button
            type="button"
            onClick={handleImportClick}
            style={buttonStyle}
            disabled={editor.loading || importing || importApplying}
            title={t('settings:config.page.importTitle')}
          >
            <Upload size={12} style={{ verticalAlign: 'middle' }} /> {t('settings:config.page.importLabel')}
          </button>
          <button
            type="button"
            onClick={() => editor.reset()}
            style={buttonStyle}
            disabled={!editor.isDirty}
          >
            <RotateCcw size={12} style={{ verticalAlign: 'middle' }} /> {t('settings:config.page.undo')}
          </button>
          <button
            type="button"
            onClick={() => setConfirmOpen(true)}
            style={buttonAccentStyle}
            disabled={!editor.isDirty || editor.saving}
          >
            <Save size={12} style={{ verticalAlign: 'middle' }} />{' '}
            {editor.saving ? t('settings:common.saving') : t('settings:common.save')}
          </button>
          {/* Hidden — opened by handleImportClick above. */}
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            style={{ display: 'none' }}
            onChange={handleImportFileChange}
          />
        </div>
      </header>

      <nav style={tabBarStyle}>
        {cfg.nodeDefinitions.map((n: any) => (
          <button
            key={n.type}
            type="button"
            onClick={() => {
              setActiveNodeType(n.type);
              setOpenModelValue(null);
            }}
            style={tabStyle(n.type === activeNodeType)}
          >
            {n.label || n.type}
            <span style={tabCountStyle}>{Array.isArray(n.models) ? n.models.length : 0}</span>
          </button>
        ))}
        <button type="button" onClick={handleAddNode} style={addNodeBtnStyle} title={t('settings:config.page.addNodeTitle')}>
          <Plus size={12} />
        </button>
      </nav>

      {activeNode ?
        <>
          <NodeLevelCard node={activeNode} onChange={handleNodePatch} />
          <ModelGrid
            models={(activeNode.models ?? []) as any[]}
            onSelect={(v) => setOpenModelValue(v)}
            onAdd={handleAddModel}
            onRemove={handleRemoveModel}
          />
        </>
      : <div style={emptyStyle}>{t('settings:config.page.emptyNode')}</div>}

      {openModel && activeNodeType && (
        <ModelDetailDrawer
          open
          nodeType={activeNodeType}
          model={openModel as ModelEntryDraft}
          onClose={() => setOpenModelValue(null)}
          onChange={handleModelPatch}
        />
      )}

      <ConfirmSaveDialog
        open={confirmOpen}
        base={base}
        draft={cfg}
        saving={editor.saving}
        serverVersion={editor.serverVersion}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={async () => {
          try {
            await editor.save();
            setConfirmOpen(false);
          } catch {
            // toast already shown by save()
          }
        }}
      />

      <ImportPreviewDialog
        open={importDialogOpen}
        applying={importApplying}
        fileName={importFileName}
        envelope={importEnvelope}
        preview={importPreview}
        serverVersion={editor.serverVersion}
        onCancel={() => {
          if (importApplying) return;
          setImportDialogOpen(false);
          resetImportState();
        }}
        onConfirm={handleImportConfirm}
      />
    </div>
  );
};

const pageStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 16,
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'flex-end',
  gap: 16,
  flexWrap: 'wrap',
};

const titleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 20,
  fontWeight: 600,
  color: tokens.textPrimary,
};

const subTitleStyle: React.CSSProperties = {
  marginTop: 4,
  fontSize: 12,
  color: tokens.textMuted,
  display: 'flex',
  alignItems: 'center',
  gap: 8,
};

const dirtyBadgeStyle: React.CSSProperties = {
  display: 'inline-block',
  fontSize: 10,
  padding: '2px 8px',
  borderRadius: 999,
  background: tokens.bgAccent,
  color: tokens.accent,
};

const toolbarStyle: React.CSSProperties = {
  display: 'flex',
  gap: 8,
};

const tabCountStyle: React.CSSProperties = {
  display: 'inline-block',
  marginLeft: 6,
  padding: '0 6px',
  fontSize: 10,
  borderRadius: 999,
  background: tokens.bgChip,
  color: tokens.textMuted,
  fontFamily: 'ui-monospace, SFMono-Regular, monospace',
  fontWeight: 400,
};

const addNodeBtnStyle: React.CSSProperties = {
  background: 'transparent',
  border: `1px dashed ${tokens.borderStrong}`,
  borderRadius: 6,
  padding: '6px 10px',
  color: tokens.textMuted,
  cursor: 'pointer',
  alignSelf: 'center',
  marginLeft: 8,
};
