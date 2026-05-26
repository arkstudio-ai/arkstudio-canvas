import { ReadStream } from 'fs';

/**
 * Storage backend abstraction.
 *
 * Open-source build defaults to `LocalStorageService` (writes under
 * `${dataDir}/<key>`, served by `StaticUploadsController` at
 * `/static/uploads/<key>`). Downstream / commercial deployments wanting
 * S3-compatible object storage (Aliyun OSS, Volcengine TOS, AWS S3) point
 * `STORAGE_BACKEND` env at `s3-compat` and provide credentials via the
 * existing `OssConfigService` settings — see `S3CompatStorageService`.
 *
 * Why minimal surface?
 *   - The 80% caller path is "put a buffer, get back a URL the browser can
 *     <img src>". Anything fancier (signed URLs, multipart resumable, etc.)
 *     is solved per-driver behind the same method.
 *   - Admin-side stats / dataDir management is local-only and lives on the
 *     concrete `LocalStorageService` class; cloud drivers ignore those.
 */
export interface StorageDriver {
  /**
   * Persist `buffer` under storage key `args.key`. Returns a `accessUrl`
   * the frontend can render directly (relative `/static/uploads/...` for
   * local, public bucket URL for cloud).
   */
  putObject(args: PutObjectArgs): Promise<PutObjectResult>;

  /**
   * Stream an object back by storage key. `null` when missing.
   */
  readObject(key: string): Promise<ReadObjectResult | null>;

  /**
   * "Is this URL one this driver knows how to read?" Used by the
   * DashScope staging helper to decide whether to ship the resource
   * to dashscope-temp before the cloud model can fetch it.
   *
   * Local driver returns true for `/static/uploads/*` and the localhost
   * absolute equivalents; cloud driver returns true for its own bucket
   * hostnames.
   */
  ownsUrl(url: string | null | undefined): boolean;

  /**
   * Read buffer back given a URL recognised by `ownsUrl`. Null on miss.
   */
  readObjectByUrl(url: string): Promise<ReadObjectByUrlResult | null>;

  /**
   * Prefix used to build `accessUrl` from a storage key. Local returns
   * `/static/uploads`, cloud driver returns the bucket's public URL prefix.
   */
  getPublicBaseUrl(): string;

  /**
   * Conventional key for a user-uploaded asset.
   * `uploads/{YYYY-MM-DD}/{uuid}-{sanitized}`
   */
  generateUploadKey(originalFileName: string): string;

  /**
   * Conventional key for a transferred AI generation result.
   * `executions/{YYYY-MM-DD}/{shortExec}-{uuid}.{ext}`
   */
  generateExecutionKey(executionId: string, ext: string): string;
}

export interface PutObjectArgs {
  key: string;
  buffer: Buffer;
  contentType: string;
}

export interface PutObjectResult {
  /** Browser-renderable URL (relative for local, absolute for cloud). */
  accessUrl: string;
  bytes: number;
}

export interface ReadObjectResult {
  stream: ReadStream | NodeJS.ReadableStream;
  bytes: number;
  contentType: string;
}

export interface ReadObjectByUrlResult {
  buffer: Buffer;
  contentType: string;
  bytes: number;
}

/**
 * DI token. All non-admin consumers should inject this token + the
 * `StorageDriver` interface type (`@Inject(STORAGE_DRIVER)`) rather than
 * the concrete `LocalStorageService` class.
 *
 * Admin / canvas-config callers that need local-specific methods (dataDir,
 * getStats, updateSettings) continue to inject `LocalStorageService`
 * directly — those calls have no meaning for cloud backends and the admin
 * UI for cloud is a separate path.
 */
export const STORAGE_DRIVER = Symbol('STORAGE_DRIVER');
