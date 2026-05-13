import { Injectable, Logger } from '@nestjs/common';
import { StorageConfigService } from '../canvas-config/storage-config.service';

export interface SignedUrlResult {
  signedUrl: string;
  expires: number;
}

/**
 * Thin facade over the COS SDK that always reads its credentials from
 * `StorageConfigService` (i.e. the DB), not from env directly. The SDK
 * client is built lazily and cached inside StorageConfigService so admin
 * saves take effect on the next request without a backend restart.
 *
 * Constructor side effects: none. Missing credentials are surfaced as a
 * `StorageNotConfiguredError` from the call site, not on boot, so the
 * backend keeps starting in "fresh open-source clone" mode where the
 * operator hasn't filled the admin UI yet.
 */
@Injectable()
export class CosService {
  private readonly logger = new Logger(CosService.name);

  constructor(private readonly storageConfig: StorageConfigService) {}

  /**
   * Generate a PUT signed URL for direct browser → COS uploads.
   *
   * `accelerate` region is hard-coded to use Tencent's global accelerate
   * endpoint -- this matches the legacy behaviour and avoids a per-region
   * tuning knob most operators don't need. If a custom domain is set we
   * rewrite the host post-sign because the SDK occasionally hands back
   * the canonical `*.cos.<region>.myqcloud.com` host even when `Domain`
   * is supplied.
   */
  async getUploadSignedUrl(
    fileKey: string,
    _contentType?: string, // intentionally unsigned -- see legacy comment above
  ): Promise<SignedUrlResult> {
    const creds = await this.storageConfig.getCredentials();
    const cos = await this.storageConfig.getCosClient();

    return new Promise((resolve, reject) => {
      const options: any = {
        Bucket: creds.bucket,
        Region: 'accelerate',
        Key: fileKey,
        Method: 'PUT',
        Expires: creds.signExpires,
        Sign: true,
      };

      if (creds.customDomain) {
        options.Domain = creds.customDomain;
      }

      cos.getObjectUrl(options, (err: Error | null, data: { Url: string }) => {
        if (err) {
          this.logger.error(`生成上传签名失败: ${err.message}`);
          reject(err);
          return;
        }

        let signedUrl = data.Url;

        if (creds.customDomain) {
          const url = new URL(signedUrl);
          const originalHost = url.hostname;
          if (originalHost.includes('.cos.') && originalHost.includes('.myqcloud.com')) {
            signedUrl = signedUrl.replace(
              `https://${originalHost}`,
              `https://${creds.customDomain}`,
            );
          }
        }

        this.logger.debug(
          `生成上传签名成功: key=${fileKey}, domain=${creds.customDomain || 'default'}`,
        );
        resolve({ signedUrl, expires: creds.signExpires });
      });
    });
  }

  /** Stable read-back URL for a stored object (custom-domain aware). */
  async getPublicUrl(fileKey: string): Promise<string> {
    const creds = await this.storageConfig.getCredentials();
    if (creds.customDomain) {
      return `https://${creds.customDomain}/${fileKey}`;
    }
    return `https://${creds.bucket}.cos.${creds.region}.myqcloud.com/${fileKey}`;
  }

  /** Diagnostic-only -- safe to call without throwing when unconfigured. */
  async getBucketInfo(): Promise<{
    bucket: string | null;
    region: string;
    customDomain: string | null;
    configured: boolean;
  }> {
    try {
      const creds = await this.storageConfig.getCredentials();
      return {
        bucket: creds.bucket,
        region: creds.region,
        customDomain: creds.customDomain,
        configured: true,
      };
    } catch {
      return { bucket: null, region: 'ap-hongkong', customDomain: null, configured: false };
    }
  }
}
