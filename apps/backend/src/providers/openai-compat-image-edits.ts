// i2i path for the OpenAI-compatible image provider.
//
// Wired into the provider when (a) the SKU family is `gpt-image-*` AND
// (b) the request has at least one upstream image input. Switches the
// endpoint from `/images/generations` (JSON) to `/images/edits`
// (multipart) and handles the b64_json response that gpt-image-* returns
// by default — saves the bytes to LocalStorageService and surfaces a
// `/static/uploads/...` URL just like t2i mirroring does.
//
// dall-e-* also has an edits endpoint but the user explicitly scoped
// this round to gpt-image-* only; if dall-e i2i lands later, this
// helper is the right place to fork on family.

import { HttpException, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

import type {
  ProviderInput,
  ProviderResource,
  ProviderUsage,
} from './provider.types';
import type { LocalStorageService } from '../storage/local-storage.service';

export interface EditsCallArgs {
  baseUrl: string;
  apiKey: string;
  timeoutMs: number;
  realSku: string;
  prompt: string;
  imageInputs: ProviderInput[];
  n: number;
  size?: string;
  quality?: string;
  seed?: number;
  requestId: string;
}

export interface EditsCallResult {
  resources: ProviderResource[];
  usage: ProviderUsage | undefined;
  raw: any;
  requestPayloadSummary: Record<string, unknown>;
}

const IMAGE_EDITS_PATH = '/images/edits';
const MAX_FETCH_BYTES = 25 * 1024 * 1024; // OpenAI hard cap per image is 25 MB.

export class OpenAICompatImageEdits {
  constructor(
    private readonly http: HttpService,
    private readonly storage: LocalStorageService,
    private readonly logger: Logger,
  ) {}

  async run(args: EditsCallArgs): Promise<EditsCallResult> {
    const buffers = await Promise.all(
      args.imageInputs.map((i) => this.fetchImage(i.url)),
    );

    const form = new FormData();
    form.append('model', args.realSku);
    form.append('prompt', args.prompt);
    form.append('n', String(args.n));
    if (args.size) form.append('size', args.size);
    if (args.quality) form.append('quality', args.quality);
    if (args.seed !== undefined) form.append('seed', String(args.seed));
    for (const b of buffers) {
      // Node 18+ Buffer extends Uint8Array, but TS Blob constructor
      // rejects Buffer-typed BlobPart due to ArrayBufferLike vs
      // ArrayBuffer mismatch. Wrap as a fresh Uint8Array view.
      form.append(
        'image[]',
        new Blob([new Uint8Array(b.buffer)], { type: b.mimeType }),
        b.filename,
      );
    }

    const url = `${args.baseUrl}${IMAGE_EDITS_PATH}`;
    const summary = {
      endpoint: 'edits',
      model: args.realSku,
      n: args.n,
      size: args.size,
      quality: args.quality,
      seed: args.seed,
      imageCount: buffers.length,
      imageBytes: buffers.reduce((acc, b) => acc + b.buffer.byteLength, 0),
    };
    this.logger.log(
      `[openai-compat-image:edits] sku=openai-image/${args.realSku} ` +
        `requestId=${args.requestId} url=${url} summary=${JSON.stringify(summary)}`,
    );

    let resp;
    try {
      resp = await firstValueFrom(
        this.http.post(url, form, {
          timeout: args.timeoutMs,
          headers: {
            Authorization: `Bearer ${args.apiKey}`,
            // Content-Type is set by axios from the FormData boundary;
            // do NOT hardcode 'multipart/form-data' here or axios skips
            // boundary insertion and upstream 400s.
          },
          maxBodyLength: Infinity,
          maxContentLength: Infinity,
        }),
      );
    } catch (e: any) {
      const data = e?.response?.data ?? null;
      this.logger.error(
        `[openai-compat-image:edits] ❌ sku=${args.realSku} ` +
          `status=${e?.response?.status ?? '?'} code=${e?.code ?? '?'} ` +
          `upstream=${JSON.stringify(data).slice(0, 600)} ` +
          `axiosMessage=${(e as Error).message}`,
      );
      const message =
        data?.error?.message ||
        data?.message ||
        e?.message ||
        'OpenAI-compat image edits failed';
      const err = new HttpException(
        { errorMessage: message, raw: data ?? null },
        e?.response?.status ?? 502,
      );
      (err as any).payloadSnippet = data ?? message;
      (err as any).message = message;
      (err as any).requestPayload = summary;
      throw err;
    }

    const data = resp.data ?? {};
    const resources = await this.extractResources(data);
    if (resources.length === 0) {
      const err = new HttpException(
        {
          errorMessage: 'OpenAI-compat image edits returned no usable image',
          raw: data,
        },
        502,
      );
      (err as any).message = 'OpenAI-compat image edits returned no usable image';
      (err as any).requestPayload = summary;
      throw err;
    }

    return {
      resources,
      usage:
        data?.usage && typeof data.usage === 'object'
          ? { imageCount: resources.length, raw: data.usage }
          : { imageCount: resources.length },
      raw: data,
      requestPayloadSummary: summary,
    };
  }

  private async fetchImage(
    url: string,
  ): Promise<{ buffer: Buffer; mimeType: string; filename: string }> {
    if (url.startsWith('data:')) {
      // Inline data URL — parse without a network hop.
      const m = url.match(/^data:([^;,]+);base64,(.+)$/);
      if (!m) throw new Error(`unsupported data URL for i2i input`);
      const mimeType = m[1] || 'image/png';
      const buffer = Buffer.from(m[2], 'base64');
      return {
        buffer,
        mimeType,
        filename: `inline.${mimeExt(mimeType)}`,
      };
    }
    // Upstream nodes that already produced a result are persisted to
    // LocalStorageService (`/static/uploads/...`). Reading those over
    // HTTP would (a) need an absolute base URL (axios throws 'Invalid
    // URL' on a bare `/static/...` path), (b) round-trip to ourselves
    // for no reason. Read straight from disk via the storage service.
    const local = await this.storage.readObjectByLocalUrl(url);
    if (local) {
      const mimeType = local.contentType.startsWith('image/')
        ? local.contentType
        : 'image/png';
      return {
        buffer: local.buffer,
        mimeType,
        filename: guessFilename(url, mimeType),
      };
    }
    const resp = await firstValueFrom(
      this.http.get(url, {
        responseType: 'arraybuffer',
        timeout: 60_000,
        maxContentLength: MAX_FETCH_BYTES,
      }),
    );
    const buffer = Buffer.from(resp.data as ArrayBuffer);
    if (buffer.byteLength > MAX_FETCH_BYTES) {
      throw new Error(
        `i2i input image too large (${buffer.byteLength}B > ${MAX_FETCH_BYTES}B): ${url}`,
      );
    }
    const ct = String(resp.headers?.['content-type'] ?? '').toLowerCase();
    const mimeType = ct.startsWith('image/') ? ct.split(';')[0] : 'image/png';
    const filename = guessFilename(url, mimeType);
    return { buffer, mimeType, filename };
  }

  /**
   * /images/edits responses:
   *   - gpt-image-2 (GA 2026-04): `data:[{url?, b64_json?}]` — url when
   *     server-side hosting is on, b64_json otherwise
   *   - gpt-image-1 / 1.5: `data:[{b64_json}]` only
   * We accept both shapes; b64 gets persisted to LocalStorageService
   * and surfaced as a `/static/...` URL so the orchestrator (which
   * already treats `/static/...` as canonical) doesn't need to know
   * the difference.
   */
  private async extractResources(data: any): Promise<ProviderResource[]> {
    const out: ProviderResource[] = [];
    const items = Array.isArray(data?.data) ? data.data : [];
    for (const it of items) {
      if (typeof it?.url === 'string' && it.url) {
        out.push({ type: 'image', url: it.url });
        continue;
      }
      if (typeof it?.b64_json === 'string' && it.b64_json) {
        const buffer = Buffer.from(it.b64_json, 'base64');
        const key = buildPersistKey('png');
        const saved = await this.storage.putObject({
          key,
          buffer,
          contentType: 'image/png',
        });
        out.push({ type: 'image', url: saved.accessUrl });
      }
    }
    return out;
  }
}

function mimeExt(mime: string): string {
  if (mime.includes('jpeg')) return 'jpg';
  if (mime.includes('png')) return 'png';
  if (mime.includes('webp')) return 'webp';
  return 'bin';
}

function guessFilename(url: string, mimeType: string): string {
  try {
    const u = new URL(url);
    const base = u.pathname.split('/').filter(Boolean).pop();
    if (base && /\.[a-z0-9]{2,5}$/i.test(base)) return base;
  } catch {
    // fall through
  }
  return `input.${mimeExt(mimeType)}`;
}

function buildPersistKey(ext: string): string {
  const d = new Date();
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const rand = Math.random().toString(36).slice(2, 10);
  return `executions/${yyyy}-${mm}-${dd}/openai-edit-${Date.now()}-${rand}.${ext}`;
}
