import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { DashscopeConfigService } from '../canvas-config/dashscope-config.service';
import { LocalStorageService } from '../storage/local-storage.service';
import type { ProviderInput } from '../providers/provider.types';

/**
 * DashScope free temporary file bucket bridge.
 *
 * Used for one specific job: re-shipping a locally stored reference
 * asset (i2i input image, i2v first-frame, etc.) to a URL the cloud
 * model can actually fetch. Open-source build keeps all permanent
 * storage on local disk via `LocalStorageService`; this service only
 * knows about the temp-bridge protocol.
 *
 * Wire protocol (per Bailian docs `/api/v1/uploads`):
 *   1. GET  ...?action=getPolicy&model=<sku>
 *      -> short-lived OSS POST policy
 *   2. POST {upload_host}  (multipart/form-data)
 *      -> file lands in DashScope's instant bucket
 *   3. Returned `oss://dashscope-instant/.../{key}` URL is passed back
 *      to the model call, which MUST set
 *      `X-DashScope-OssResourceResolve: enable` so DashScope resolves
 *      the oss:// reference.
 *
 * Hard constraints from DashScope (do NOT strip from log/error text --
 * operators need to see them when debugging upload failures):
 *   - 48-hour TTL on the uploaded file
 *   - 100 MB per file
 *   - 100 QPS per (account, model)
 *   - cn-beijing region only; intl accounts can't use it
 *   - Upload key + model-call key must be the same Aliyun account
 *
 * Policy cache: server-side policies only live ~5 min. We cache per
 * model with a 60s safety margin so back-to-back uploads share a
 * single getPolicy round trip without ever surfacing an expired cred.
 */
@Injectable()
export class DashscopeUploadService {
  private readonly logger = new Logger(DashscopeUploadService.name);
  private policyCache = new Map<
    string,
    { policy: UploadPolicy; expiresAt: number }
  >();

  constructor(
    private readonly dashscopeConfig: DashscopeConfigService,
    private readonly localStorage: LocalStorageService,
  ) {}

  /**
   * Upload a buffer and return the resulting `oss://...` URL.
   *
   * @param model        DashScope model SKU (e.g. `qwen-vl-plus`,
   *                     `wan2.7-image-pro`, `wan2.7-i2v`). The policy is scoped
   *                     to a model — using a different model when calling
   *                     later usually still works for image/video, but
   *                     it's cleaner to pass the same SKU you'll invoke.
   * @param fileName     Original file name (used to derive the extension
   *                     and to make the oss key human-greppable).
   * @param buffer       Raw bytes to upload (≤ 100 MiB).
   * @param contentType  Optional MIME type; falls back to octet-stream.
   */
  async uploadBuffer(args: {
    model: string;
    fileName: string;
    buffer: Buffer;
    contentType?: string;
  }): Promise<DashscopeUploadResult> {
    const { model, fileName, buffer, contentType } = args;

    if (buffer.byteLength > MAX_FILE_BYTES) {
      throw new DashscopeFileTooLargeError(buffer.byteLength);
    }

    const policy = await this.fetchPolicy(model);

    // Object key = `{policy.upload_dir}/{uuid}-{sanitizedName}`.
    // We add a uuid prefix so x-oss-forbid-overwrite=true never bites on
    // duplicate file names. The "upload_dir" already encodes day/account.
    const key = `${policy.upload_dir}/${uuidv4().slice(0, 8)}-${this.sanitizeName(fileName)}`;

    const fd = new FormData();
    fd.append('OSSAccessKeyId', policy.oss_access_key_id);
    fd.append('Signature', policy.signature);
    fd.append('policy', policy.policy);
    fd.append('x-oss-object-acl', policy.x_oss_object_acl);
    fd.append('x-oss-forbid-overwrite', policy.x_oss_forbid_overwrite);
    fd.append('key', key);
    fd.append(
      'file',
      new Blob([new Uint8Array(buffer)], {
        type: contentType || 'application/octet-stream',
      }),
      this.sanitizeName(fileName),
    );

    const startTime = Date.now();
    try {
      const res = await axios.post(policy.upload_host, fd, {
        // OSS POST returns 204 NO_CONTENT on success; explicit accept
        // keeps axios from misclassifying empty bodies.
        validateStatus: (s) => s >= 200 && s < 300,
        timeout: 120_000,
        // Leave Content-Type to axios (multipart boundary is auto-set);
        // setting it manually here drops the boundary param.
        maxContentLength: MAX_FILE_BYTES + 1024,
        maxBodyLength: MAX_FILE_BYTES + 1024,
      });
      const elapsed = Date.now() - startTime;
      const ossUrl = `oss://${key}`;
      this.logger.log(
        `[dashscope-upload] ✅ ${ossUrl} (${buffer.byteLength}B, ${elapsed}ms, status=${res.status})`,
      );
      return {
        ossUrl,
        // 48h is documented; we don't trust the policy's expire_in_seconds
        // here because that's the policy expiry, not the file expiry.
        expiresAt: new Date(Date.now() + FILE_TTL_MS),
        bytes: buffer.byteLength,
      };
    } catch (e) {
      const elapsed = Date.now() - startTime;
      const status = (e as { response?: { status?: number } })?.response?.status;
      const body = (
        e as { response?: { data?: { toString?: () => string } } }
      )?.response?.data?.toString?.()?.slice?.(0, 400);
      this.logger.error(
        `[dashscope-upload] ❌ failed (${elapsed}ms, status=${status}, ` +
          `code=${(e as { code?: string })?.code ?? '?'}, host=${policy.upload_host}): ` +
          `${(e as Error).message} ${body ?? ''}\n` +
          `${(e as Error).stack ?? '(no stack)'}`,
      );
      throw new DashscopeUploadFailedError((e as Error).message, status, body);
    }
  }

  /**
   * "Stage" — make every input URL something a DashScope cloud model can
   * actually fetch.
   *
   * Background: D2 collapsed all permanent storage onto local disk, so a
   * node's `data.src` is now typically `/static/uploads/...` — a relative
   * URL that only resolves against our own backend. DashScope servers in
   * cn-beijing obviously can't reach an operator's intranet, so any
   * such URL has to be re-shipped to DashScope's free 48h temp bucket
   * before the model call.
   *
   * Inputs already on `oss://` or a public `https://` host are passed
   * straight through. A local URL whose object can't be read (deleted /
   * never existed) is also passed through unchanged so the upstream
   * model returns its own clear error rather than us swallowing it.
   *
   * Throws only when DashScope itself rejects the upload, mirroring the
   * existing `uploadBuffer` contract — provider callers already catch
   * these as 502s.
   */
  async stageLocalUrlsToTemp(
    inputs: ProviderInput[],
    modelSku: string,
  ): Promise<ProviderInput[]> {
    if (!inputs?.length) return inputs ?? [];
    const out: ProviderInput[] = [];
    for (const input of inputs) {
      if (!this.localStorage.isLocalUrl(input.url)) {
        out.push(input);
        continue;
      }
      const local = await this.localStorage.readObjectByLocalUrl(input.url);
      if (!local) {
        this.logger.warn(
          `[stage] local object missing, passing original URL through: ${input.url}`,
        );
        out.push(input);
        continue;
      }
      const fileName = `${input.type}-${uuidv4().slice(0, 8)}.${this.extFromContentType(local.contentType, input.type)}`;
      const result = await this.uploadBuffer({
        model: modelSku,
        fileName,
        buffer: local.buffer,
        contentType: local.contentType,
      });
      this.logger.log(
        `[stage] ${input.url} → ${result.ossUrl} (${local.bytes}B for sku=${modelSku})`,
      );
      out.push({ type: input.type, url: result.ossUrl });
    }
    return out;
  }

  // ---- internals ----------------------------------------------------------

  private extFromContentType(contentType: string, fallback: string): string {
    const m: Record<string, string> = {
      'image/jpeg': 'jpg',
      'image/jpg': 'jpg',
      'image/png': 'png',
      'image/gif': 'gif',
      'image/webp': 'webp',
      'video/mp4': 'mp4',
      'video/webm': 'webm',
      'video/quicktime': 'mov',
      'audio/mpeg': 'mp3',
      'audio/wav': 'wav',
      'audio/mp4': 'm4a',
    };
    return m[contentType.toLowerCase()] ?? fallback;
  }

  private async fetchPolicy(model: string): Promise<UploadPolicy> {
    const cached = this.policyCache.get(model);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.policy;
    }

    const baseUrl = await this.dashscopeConfig.getBaseUrl();
    const apiKey = await this.dashscopeConfig.getApiKey(); // throws if absent
    const endpoint = `${baseUrl.replace(/\/$/, '')}/api/v1/uploads`;

    let res;
    try {
      res = await axios.get(endpoint, {
        params: { action: 'getPolicy', model },
        headers: { Authorization: `Bearer ${apiKey}` },
        timeout: 15_000,
      });
    } catch (e) {
      const status = (e as { response?: { status?: number } })?.response?.status;
      const body = JSON.stringify(
        (e as { response?: { data?: unknown } })?.response?.data ?? null,
      ).slice(0, 400);
      // 把底层 error 的 code + stack 也打到 log, 方便排查 "protocol mismatch"
      // 这类 axios message 不带上下文的错. catch 里抛出去的 wrapper 只保留
      // 给用户看的 message, 调试细节走 logger 不污染前端面板.
      this.logger.error(
        `[dashscope-upload] getPolicy raw error (model=${model}, endpoint=${endpoint}, ` +
          `code=${(e as { code?: string })?.code ?? '?'}, status=${status ?? '?'}): ` +
          `${(e as Error).message}\n${(e as Error).stack ?? '(no stack)'}`,
      );
      throw new DashscopeUploadFailedError(
        `getPolicy failed (model=${model}): ${(e as Error).message}`,
        status,
        body,
      );
    }

    const data = (res.data?.data ?? null) as UploadPolicy | null;
    if (!data || !data.upload_host || !data.policy || !data.signature) {
      throw new DashscopeUploadFailedError(
        `getPolicy returned malformed payload for model=${model}`,
        res.status,
        JSON.stringify(res.data).slice(0, 400),
      );
    }

    // Cache for (expire_in_seconds - 60) so we never hand out a policy
    // that's about to die mid-upload. Server-reported expiry is in
    // seconds; floor at 30s so we don't keep a dead one if the API
    // returns something weird.
    const ttlSec = Math.max(30, (data.expire_in_seconds ?? 300) - 60);
    this.policyCache.set(model, {
      policy: data,
      expiresAt: Date.now() + ttlSec * 1000,
    });
    return data;
  }

  /**
   * Sanitize file names the same way `UploadService.sanitizeFileName`
   * does so the two upload paths produce comparable keys. Non-ASCII
   * names are replaced with a short uuid + the lowercase extension.
   */
  private sanitizeName(name: string): string {
    const dot = name.lastIndexOf('.');
    const ext = dot > 0 ? name.slice(dot).toLowerCase() : '';
    const base = dot > 0 ? name.slice(0, dot) : name;
    if (/[^\x00-\x7F]/.test(base)) {
      return uuidv4().slice(0, 8) + ext;
    }
    const safe = base
      .split('')
      .map((c) => (/[a-zA-Z0-9_\-]/.test(c) ? c : '_'))
      .join('')
      .slice(0, 50);
    return safe + ext;
  }
}

// ---- public types ----------------------------------------------------------

export interface DashscopeUploadResult {
  /** `oss://dashscope-instant/.../filename` — pass directly into the model call. */
  ossUrl: string;
  /** ~48h from now. After this the file is auto-deleted by DashScope. */
  expiresAt: Date;
  bytes: number;
}

export class DashscopeUploadFailedError extends Error {
  readonly status?: number;
  readonly body?: string;
  constructor(message: string, status?: number, body?: string) {
    super(message);
    this.name = 'DashscopeUploadFailedError';
    this.status = status;
    this.body = body;
  }
}

export class DashscopeFileTooLargeError extends Error {
  constructor(public readonly bytes: number) {
    super(
      `File ${bytes} bytes exceeds DashScope upload limit of ${MAX_FILE_BYTES} bytes (100 MiB)`,
    );
    this.name = 'DashscopeFileTooLargeError';
  }
}

/** True iff a URL was minted by `uploadBuffer`. Used by providers to
 *  decide whether to add `X-DashScope-OssResourceResolve: enable`. */
export function isDashscopeOssUrl(url: string | null | undefined): boolean {
  return !!url && url.startsWith('oss://');
}

// ---- internals -------------------------------------------------------------

interface UploadPolicy {
  policy: string;
  signature: string;
  upload_dir: string;
  upload_host: string;
  expire_in_seconds: number;
  max_file_size_mb: number;
  oss_access_key_id: string;
  x_oss_object_acl: string;
  x_oss_forbid_overwrite: string;
}

/** 100 MiB. DashScope hard caps individual uploads at this value. */
const MAX_FILE_BYTES = 100 * 1024 * 1024;
/** 48h. Documented file TTL after which DashScope deletes the object. */
const FILE_TTL_MS = 48 * 3600 * 1000;
