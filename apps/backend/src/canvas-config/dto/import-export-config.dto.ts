import {
  IsObject,
  IsOptional,
  IsString,
  IsIn,
  IsNotEmpty,
} from 'class-validator';
import type { NodeDefinitionInput } from './save-config.dto';

/**
 * Wire format for `GET /api/canvas-flow/config/export` and the body of
 * `POST /api/canvas-flow/config/import`.
 *
 * The envelope wraps the same `config` payload that the runtime API
 * already returns / accepts (`token + style + nodeDefinitions`), but
 * adds three pieces of provenance metadata so future format upgrades
 * stay sane:
 *
 *   - `$schema`           — frozen "canvas-flow.config/v1" string. If we
 *                           ever bump the schema we change *this string*
 *                           and write a new accept-and-migrate branch in
 *                           CanvasConfigService; old exports keep working.
 *   - `exportedAt`        — ISO8601 UTC; useful in audits / file pickers.
 *   - `exportedFromVersion` — the source instance's `config_version`. If
 *                           the importer wants to detect "you're moving
 *                           backwards" or "looks like the same v as ours"
 *                           it has the data point.
 *
 * Deliberately NOT in the envelope:
 *
 *   - DashScope / OpenAI api keys (deployment secrets)
 *   - storage.local.* / history.* (deployment-scoped operations knobs)
 *   - config_version itself (target instance owns its own version stream)
 *
 * The whole envelope is the file users save / share / commit to git.
 */
export const CONFIG_EXPORT_SCHEMA = 'canvas-flow.config/v1';

export interface ConfigExportEnvelope {
  $schema: typeof CONFIG_EXPORT_SCHEMA;
  exportedAt: string;
  exportedFromVersion: number;
  config: {
    token?: string;
    style?: { background?: string };
    nodeDefinitions: NodeDefinitionInput[];
  };
}

/**
 * Two-step import flow.
 *
 *   - mode = 'preview' → validate + diff against current DB, return
 *                        summary + warnings, do NOT write.
 *   - mode = 'apply'   → run the same flow as PUT /config, version bump
 *                        included.
 *
 * The body shape is the same for both modes; the UI just toggles `mode`
 * after the operator clicks "确认导入" in the preview dialog.
 */
export class ImportConfigDto {
  @IsObject()
  @IsNotEmpty()
  envelope!: {
    $schema?: string;
    exportedAt?: string;
    exportedFromVersion?: number;
    config: {
      token?: string;
      style?: { background?: string };
      nodeDefinitions: NodeDefinitionInput[];
    };
  };

  @IsString()
  @IsIn(['preview', 'apply'])
  mode!: 'preview' | 'apply';

  /** Optional caller tag (audit trail), forwarded to saveConfig.modifiedBy. */
  @IsOptional()
  @IsString()
  modifiedBy?: string;
}

/** Returned by both preview and apply; `version` is null in preview. */
export interface ImportConfigResponse {
  version: number | null;
  summary: {
    nodesAdded: number;
    nodesUpdated: number;
    nodesDeleted: number;
    nodesUnchanged: number;
  };
  warnings: string[];
  /** `true` when no actual write happened (preview mode). */
  dryRun: boolean;
}

// Re-export for callers that want the canonical type without circular imports.
export type { NodeDefinitionInput };

/** Envelope-validation helper; internal but exported for unit tests. */
export interface NormalizedEnvelope {
  schemaVersion: string;
  config: ConfigExportEnvelope['config'];
  warnings: string[];
}

// Lightweight runtime guards. We intentionally don't use class-validator
// recursion on the deeply-nested NodeDefinitionInput / ModelEntryInput
// trees — at this layer we only enforce the envelope shape; the inner
// catalog is then handed to saveConfig() which already trusts the same
// shape it returns from getConfig().
export function normalizeImportEnvelope(
  raw: ImportConfigDto['envelope'],
): NormalizedEnvelope {
  const warnings: string[] = [];
  if (!raw || typeof raw !== 'object') {
    throw new Error('envelope 必须是对象');
  }
  if (!raw.config || typeof raw.config !== 'object') {
    throw new Error('envelope.config 缺失');
  }
  if (!Array.isArray(raw.config.nodeDefinitions)) {
    throw new Error('envelope.config.nodeDefinitions 必须是数组');
  }
  const schema = typeof raw.$schema === 'string' ? raw.$schema : '';
  if (!schema) {
    warnings.push('envelope 未带 $schema 字段，按当前版本宽松解析');
  } else if (schema !== CONFIG_EXPORT_SCHEMA) {
    warnings.push(
      `envelope.$schema = "${schema}"，与当前 "${CONFIG_EXPORT_SCHEMA}" 不一致；尝试按当前版本解析（可能丢字段）`,
    );
  }
  // Surface duplicate node types early so the operator sees them in the
  // preview instead of getting half a transaction in apply.
  const seen = new Set<string>();
  for (const node of raw.config.nodeDefinitions) {
    if (!node || typeof node.type !== 'string' || !node.type) {
      throw new Error('nodeDefinitions[*].type 必填且为字符串');
    }
    if (seen.has(node.type)) {
      throw new Error(`nodeDefinitions 中存在重复 type: "${node.type}"`);
    }
    seen.add(node.type);
  }
  return {
    schemaVersion: schema || CONFIG_EXPORT_SCHEMA,
    config: raw.config,
    warnings,
  };
}
