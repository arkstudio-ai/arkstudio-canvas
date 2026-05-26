import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { listExecutions } from '../../api/admin-api';
import type {
  ExecutionListResponse,
  ExecutionPhase,
  ExecutionRow,
  ExecutionStatus,
  ListExecutionsParams,
} from '../../types';
import { LogRow } from './LogRow';
import { LogDrawer } from './LogDrawer';

const PAGE_SIZE = 30;

/**
 * Execution log table + filter bar + detail drawer.
 *
 * Filters live in component state; page advances via the pagination
 * controls. Each filter / page change re-fires `listExecutions`. Row click
 * pops a `LogDrawer` that lazy-loads the full detail (with events).
 */
export const LogsPage: React.FC = () => {
  const { t } = useTranslation();
  const [filters, setFilters] = useState<ListExecutionsParams>({ page: 1, limit: PAGE_SIZE });
  const [data, setData] = useState<ExecutionListResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const statusOptions = useMemo<Array<{ value: string; label: string }>>(
    () => [
      { value: '', label: t('settings:logs.page.statusAll') },
      { value: 'PENDING', label: 'PENDING' },
      { value: 'RUNNING', label: 'RUNNING' },
      { value: 'COMPLETED', label: 'COMPLETED' },
      { value: 'FAILED', label: 'FAILED' },
    ],
    [t],
  );

  const phaseOptions = useMemo<Array<{ value: string; label: string }>>(
    () => [
      { value: '', label: t('settings:logs.page.phaseAll') },
      { value: 'submitting', label: 'submitting' },
      { value: 'submitted', label: 'submitted' },
      { value: 'polling', label: 'polling' },
      { value: 'completed', label: 'completed' },
      { value: 'failed', label: 'failed' },
    ],
    [t],
  );

  const reload = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    listExecutions(filters)
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((err: unknown) => {
        if (!cancelled) toast.error(err instanceof Error ? err.message : t('settings:common.loadFailed'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [filters, t]);

  useEffect(() => reload(), [reload]);

  const updateFilter = (patch: Partial<ListExecutionsParams>) => {
    setFilters((prev) => ({ ...prev, ...patch, page: 1 }));
  };

  const goPage = (p: number) => {
    if (p < 1) return;
    setFilters((prev) => ({ ...prev, page: p }));
  };

  return (
    <div style={pageStyle}>
      <header style={headerStyle}>
        <h1 style={titleStyle}>{t('settings:logs.page.title')}</h1>
        <button type="button" onClick={reload} style={refreshBtnStyle} title={t('settings:logs.page.refreshTitle')}>
          <RefreshCw size={14} />
          <span>{t('settings:logs.page.refresh')}</span>
        </button>
      </header>

      <div style={filterBarStyle}>
        <FilterSelect
          value={filters.status ?? ''}
          options={statusOptions}
          onChange={(v) => updateFilter({ status: (v || undefined) as ExecutionStatus | undefined })}
        />
        <FilterSelect
          value={filters.phase ?? ''}
          options={phaseOptions}
          onChange={(v) => updateFilter({ phase: (v || undefined) as ExecutionPhase | undefined })}
        />
        <FilterText
          placeholder={t('settings:logs.page.modelNamePlaceholder')}
          value={filters.modelName ?? ''}
          onChange={(v) => updateFilter({ modelName: v || undefined })}
        />
        <FilterText
          placeholder={t('settings:logs.page.modelSkuPlaceholder')}
          value={filters.modelSku ?? ''}
          onChange={(v) => updateFilter({ modelSku: v || undefined })}
        />
      </div>

      <div style={tableWrapStyle}>
        {loading && !data && <div style={emptyStyle}>{t('settings:common.loading')}</div>}
        {data && data.items.length === 0 ?
          <div style={emptyStyle}>{t('settings:logs.page.emptyMatch')}</div>
        : null}
        {data && data.items.length > 0 ?
          <table style={tableStyle}>
            <thead>
              <tr>
                <Th>{t('settings:logs.page.thId')}</Th>
                <Th>{t('settings:logs.page.thTime')}</Th>
                <Th>{t('settings:logs.page.thModel')}</Th>
                <Th>{t('settings:logs.page.thKind')}</Th>
                <Th>{t('settings:logs.page.thStatus')}</Th>
                <Th>{t('settings:logs.page.thPhase')}</Th>
                <ThNum>{t('settings:logs.page.thLatency')}</ThNum>
                <ThNum>{t('settings:logs.page.thUnit')}</ThNum>
                <Th>{t('settings:logs.page.thError')}</Th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((row: ExecutionRow) => (
                <LogRow key={row.id} row={row} onClick={() => setOpenId(row.id)} />
              ))}
            </tbody>
          </table>
        : null}
      </div>

      {data && (
        <footer style={paginationStyle}>
          <div style={{ color: '#888', fontSize: 12 }}>
            {t('settings:logs.page.paginationSummary', {
              total: data.meta.total,
              page: data.meta.page,
              totalPages: Math.max(data.meta.totalPages, 1),
            })}
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              type="button"
              style={pageBtnStyle(data.meta.page <= 1)}
              disabled={data.meta.page <= 1}
              onClick={() => goPage(data.meta.page - 1)}
            >
              {t('settings:logs.page.prevPage')}
            </button>
            <button
              type="button"
              style={pageBtnStyle(data.meta.page >= data.meta.totalPages)}
              disabled={data.meta.page >= data.meta.totalPages}
              onClick={() => goPage(data.meta.page + 1)}
            >
              {t('settings:logs.page.nextPage')}
            </button>
          </div>
        </footer>
      )}

      <LogDrawer executionId={openId} onClose={() => setOpenId(null)} />
    </div>
  );
};

const Th: React.FC<{ children: React.ReactNode }> = ({ children }) => <th style={thStyle}>{children}</th>;
const ThNum: React.FC<{ children: React.ReactNode }> = ({ children }) => <th style={thNumStyle}>{children}</th>;

const FilterSelect: React.FC<{
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (v: string) => void;
}> = ({ value, options, onChange }) => (
  <select value={value} onChange={(e) => onChange(e.target.value)} style={selectStyle}>
    {options.map((o) => (
      <option key={o.value} value={o.value}>
        {o.label}
      </option>
    ))}
  </select>
);

const FilterText: React.FC<{
  value: string;
  placeholder: string;
  onChange: (v: string) => void;
}> = ({ value, placeholder, onChange }) => (
  <input
    type="text"
    value={value}
    placeholder={placeholder}
    onChange={(e) => onChange(e.target.value)}
    style={inputStyle}
  />
);

// ---- styles ---------------------------------------------------------------

const pageStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 16 };
const headerStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between' };
const titleStyle: React.CSSProperties = { margin: 0, fontSize: 20, fontWeight: 600, color: '#fff' };
const refreshBtnStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  background: '#1a1a1a',
  border: '1px solid #2a2a2a',
  color: '#ccc',
  padding: '6px 12px',
  borderRadius: 6,
  fontSize: 12,
  cursor: 'pointer',
};

const filterBarStyle: React.CSSProperties = { display: 'flex', gap: 8, flexWrap: 'wrap' };
const selectStyle: React.CSSProperties = {
  background: '#1a1a1a',
  border: '1px solid #2a2a2a',
  color: '#ccc',
  padding: '6px 10px',
  borderRadius: 6,
  fontSize: 12,
  outline: 'none',
};
const inputStyle: React.CSSProperties = {
  ...selectStyle,
  minWidth: 180,
};

const tableWrapStyle: React.CSSProperties = {
  background: '#141414',
  border: '1px solid #1f1f1f',
  borderRadius: 10,
  overflow: 'hidden',
};
const tableStyle: React.CSSProperties = { width: '100%', borderCollapse: 'collapse' };
const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '10px 12px',
  fontWeight: 500,
  fontSize: 11,
  color: '#888',
  background: '#0f0f0f',
  borderBottom: '1px solid #1f1f1f',
  textTransform: 'uppercase',
  letterSpacing: 0.4,
};
const thNumStyle: React.CSSProperties = { ...thStyle, textAlign: 'right' };

const paginationStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  paddingTop: 4,
};
const pageBtnStyle = (disabled: boolean): React.CSSProperties => ({
  background: disabled ? '#0f0f0f' : '#1a1a1a',
  border: '1px solid #2a2a2a',
  color: disabled ? '#444' : '#ccc',
  padding: '6px 12px',
  borderRadius: 6,
  fontSize: 12,
  cursor: disabled ? 'not-allowed' : 'pointer',
});

const emptyStyle: React.CSSProperties = { color: '#666', fontSize: 13, padding: '40px 0', textAlign: 'center' };
