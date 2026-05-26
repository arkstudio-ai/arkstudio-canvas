import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type * as HttpType from 'http';
import type * as HttpsType from 'https';
import { HttpProxyAgent } from 'http-proxy-agent';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { PrismaService } from '../prisma/prisma.service';

// TypeScript 的 `import * as http from 'http'` 在 esModuleInterop 下会
// 把 module 转成 namespace object, getter 保留但 setter 被剥掉; 在
// Node 22 上跑 `http.globalAgent = newAgent` 就会
// "Cannot set property globalAgent of #<Object> which has only a getter".
// 用 CJS require 拿原始 module exports, setter 在 — 直接赋值就 OK.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const http: typeof HttpType = require('http');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const https: typeof HttpsType = require('https');

/**
 * Network proxy settings — admin-managed, applied **globally** to every
 * outbound HTTP/S call in this process.
 *
 * Design: one app-wide toggle, no per-vendor opt-ins.
 *
 *   - When proxy is configured, EVERY axios request (and any other
 *     `http(s).request` caller that doesn't override `agent`) goes
 *     through it. DashScope, Volcengine, OpenAI, connectivity tests,
 *     upload mirrors, asset library — all the same path.
 *   - When proxy is disabled / unset, NO request uses any proxy.
 *   - Providers MUST NOT pass `proxy: false` or `proxy: {...}` per call.
 *     If they do, that overrides this global policy and breaks the
 *     "one toggle" promise.
 *
 * How "global" is implemented:
 *
 *   1. Replace `http.globalAgent` + `https.globalAgent` with proxy
 *      agents (or plain keepalive agents when proxy disabled). axios's
 *      http adapter uses these when no explicit `httpAgent` /
 *      `httpsAgent` is passed — which is our default path.
 *   2. Mirror to `process.env.HTTP(S)_PROXY` so third-party SDKs that
 *      read env vars (aliyun-oss, @volcengine/tos-sdk, anything using
 *      `proxy-from-env`) see the same setting. Both sources stay in
 *      sync; admin updates trigger a re-apply of both.
 *   3. Replace, don't mutate: each apply creates fresh Agent instances,
 *      so prior connection pools are dropped on the floor. Avoids the
 *      stale-pool / "ERR_ASSERTION: protocol mismatch" issue when the
 *      proxy toggle flips at runtime.
 *
 * Authoritative storage: `global_configs` rows
 *   - `network.httpProxy`  : string (e.g. `http://127.0.0.1:7890`)
 *   - `network.httpsProxy` : string
 *   - `network.disabled`   : boolean (force-direct, overrides URLs)
 *
 * Out of scope: NO_PROXY whitelist, per-vendor routing, SOCKS support.
 */

const KEY_HTTP_PROXY = 'network.httpProxy';
const KEY_HTTPS_PROXY = 'network.httpsProxy';
const KEY_DISABLED = 'network.disabled';

const CACHE_TTL_MS = 30_000;

interface CachedValue<T> {
  value: T;
  expiresAt: number;
}

@Injectable()
export class NetworkConfigService implements OnModuleInit {
  private readonly logger = new Logger(NetworkConfigService.name);
  private httpProxyCache: CachedValue<string | null> | null = null;
  private httpsProxyCache: CachedValue<string | null> | null = null;
  private disabledCache: CachedValue<boolean> | null = null;

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    await this.applyAll();
  }

  // ---- runtime accessors --------------------------------------------------

  async getDisabled(): Promise<boolean> {
    const cached = this.readCached(this.disabledCache);
    if (cached !== undefined) return cached;
    const row = await this.prisma.globalConfig.findUnique({
      where: { key: KEY_DISABLED },
    });
    const value = this.unwrapBoolValue(row?.value);
    this.disabledCache = { value, expiresAt: Date.now() + CACHE_TTL_MS };
    return value;
  }

  async getHttpProxy(): Promise<string | null> {
    const cached = this.readCached(this.httpProxyCache);
    if (cached !== undefined) return cached;
    const row = await this.prisma.globalConfig.findUnique({
      where: { key: KEY_HTTP_PROXY },
    });
    const value = this.unwrapStringValue(row?.value);
    this.httpProxyCache = { value, expiresAt: Date.now() + CACHE_TTL_MS };
    return value;
  }

  async getHttpsProxy(): Promise<string | null> {
    const cached = this.readCached(this.httpsProxyCache);
    if (cached !== undefined) return cached;
    const row = await this.prisma.globalConfig.findUnique({
      where: { key: KEY_HTTPS_PROXY },
    });
    const value = this.unwrapStringValue(row?.value);
    this.httpsProxyCache = { value, expiresAt: Date.now() + CACHE_TTL_MS };
    return value;
  }

  // ---- admin surface ------------------------------------------------------

  async getViewPayload(): Promise<{
    httpProxy: string;
    httpsProxy: string;
    disabled: boolean;
    /**
     * What `process.env.HTTP(S)_PROXY` ACTUALLY contains at view time.
     * Reads env directly so admin can spot shell-leaked values that
     * NetworkConfigService didn't put there (e.g. shell `export
     * HTTPS_PROXY=socks5://...` that survived our unsetProxyEnv).
     */
    effective: {
      httpProxy: string | null;
      httpsProxy: string | null;
      allProxy: string | null;
    };
    /**
     * What's wired into http(s).globalAgent right now. Constructor
     * name disambiguates HttpProxyAgent vs HttpsProxyAgent vs plain
     * Agent. Used to triage "protocol mismatch" without a backend
     * restart.
     */
    globalAgent: {
      http: string;
      https: string;
    };
  }> {
    const [httpProxy, httpsProxy, disabled] = await Promise.all([
      this.getHttpProxy(),
      this.getHttpsProxy(),
      this.getDisabled(),
    ]);
    // effective.* 是 diagnostic 显示, 来自 process.env, 可能带
    // `user:pass@host` 形式的 inline 凭据 (proxy basic auth) — 经
    // maskProxy 脱敏成 `http://***:***@host` 再返. 上面的 httpProxy /
    // httpsProxy 是 DB 草稿 (admin 表单的初始值), 不能 mask, 否则
    // 用户编辑后提交的就是 *** 字符串.
    const rawHttpEffective =
      process.env.HTTP_PROXY ?? process.env.http_proxy ?? null;
    const rawHttpsEffective =
      process.env.HTTPS_PROXY ?? process.env.https_proxy ?? null;
    const rawAllEffective =
      process.env.ALL_PROXY ?? process.env.all_proxy ?? null;
    return {
      httpProxy: httpProxy ?? '',
      httpsProxy: httpsProxy ?? '',
      disabled,
      effective: {
        httpProxy: rawHttpEffective ? this.maskProxy(rawHttpEffective) : null,
        httpsProxy: rawHttpsEffective
          ? this.maskProxy(rawHttpsEffective)
          : null,
        allProxy: rawAllEffective ? this.maskProxy(rawAllEffective) : null,
      },
      globalAgent: {
        http: (http.globalAgent as { constructor: { name: string } })
          .constructor.name,
        https: (https.globalAgent as { constructor: { name: string } })
          .constructor.name,
      },
    };
  }

  /**
   * Partial update. Semantics:
   *   - undefined → field untouched
   *   - empty string '' → clear DB row
   *   - non-empty string → upsert
   *
   * After write, re-apply globalAgent + env so the very next request
   * picks up the change without a backend restart.
   */
  async updateSettings(input: {
    httpProxy?: string;
    httpsProxy?: string;
    disabled?: boolean;
  }): Promise<void> {
    if (input.httpProxy !== undefined) {
      const trimmed = input.httpProxy.trim();
      if (trimmed === '') {
        await this.prisma.globalConfig.deleteMany({
          where: { key: KEY_HTTP_PROXY },
        });
      } else {
        await this.prisma.globalConfig.upsert({
          where: { key: KEY_HTTP_PROXY },
          create: {
            key: KEY_HTTP_PROXY,
            value: trimmed,
            description: 'HTTP proxy URL (admin-set)',
          },
          update: { value: trimmed },
        });
      }
      this.httpProxyCache = null;
    }

    if (input.httpsProxy !== undefined) {
      const trimmed = input.httpsProxy.trim();
      if (trimmed === '') {
        await this.prisma.globalConfig.deleteMany({
          where: { key: KEY_HTTPS_PROXY },
        });
      } else {
        await this.prisma.globalConfig.upsert({
          where: { key: KEY_HTTPS_PROXY },
          create: {
            key: KEY_HTTPS_PROXY,
            value: trimmed,
            description: 'HTTPS proxy URL (admin-set)',
          },
          update: { value: trimmed },
        });
      }
      this.httpsProxyCache = null;
    }

    if (input.disabled !== undefined) {
      await this.prisma.globalConfig.upsert({
        where: { key: KEY_DISABLED },
        create: {
          key: KEY_DISABLED,
          value: input.disabled,
          description: 'Force direct (no proxy) — overrides http/httpsProxy',
        },
        update: { value: input.disabled },
      });
      this.disabledCache = null;
    }

    await this.applyAll();
  }

  // ---- internals ----------------------------------------------------------

  /**
   * Reflect current DB state onto http.globalAgent + https.globalAgent
   * + process.env, in that order. Disabled flag wins: if true, the
   * configured URLs are ignored and globalAgent is reset to plain
   * keepalive (no proxy).
   *
   * "Effective" proxy for axios is `httpsProxy ?? httpProxy` — most
   * users only set one of the two, and the typical target is HTTPS.
   * Both http/httpsProxy can be configured independently if the admin
   * wants split-protocol routing.
   */
  private async applyAll(): Promise<void> {
    const [httpProxy, httpsProxy, disabled] = await Promise.all([
      this.getHttpProxy(),
      this.getHttpsProxy(),
      this.getDisabled(),
    ]);

    // Tear down whatever's currently on globalAgent before installing
    // the new one — otherwise axios's keep-alive pool can hand out a
    // stale socket from the OLD agent (the classic "protocol mismatch"
    // / ERR_ASSERTION case when the previous agent was for a different
    // protocol or proxy mode).
    this.destroyExistingGlobalAgents();

    if (disabled || (!httpProxy && !httpsProxy)) {
      this.installDirectAgents();
      this.unsetProxyEnv();
      this.logSnapshot('direct', disabled);
      return;
    }

    const httpEffective = httpProxy ?? httpsProxy;
    const httpsEffective = httpsProxy ?? httpProxy;
    this.installProxyAgents(httpEffective, httpsEffective);

    if (httpEffective) {
      process.env.HTTP_PROXY = httpEffective;
      process.env.http_proxy = httpEffective;
    }
    if (httpsEffective) {
      process.env.HTTPS_PROXY = httpsEffective;
      process.env.https_proxy = httpsEffective;
    }
    // Override ALL_PROXY too — axios's bundled proxy-from-env falls
    // back to ALL_PROXY when HTTP(S)_PROXY isn't set for the target's
    // scheme. We mirror our admin proxy onto it so user-shell values
    // (esp. `socks5://...` from V2Ray/Clash) can't sneak through.
    const allEffective = httpsEffective ?? httpEffective;
    if (allEffective) {
      process.env.ALL_PROXY = allEffective;
      process.env.all_proxy = allEffective;
    }

    this.logSnapshot('proxied', false);
  }

  /**
   * Diagnostic log — prints exactly what's wired into globalAgent +
   * what's actually in process.env right now. Helpful when "protocol
   * mismatch" reappears: a single grep tells you whether the agents
   * + env match the admin UI's expectation.
   */
  private logSnapshot(mode: 'direct' | 'proxied', disabled: boolean): void {
    const httpName = (http.globalAgent as { constructor: { name: string } })
      .constructor.name;
    const httpsName = (https.globalAgent as { constructor: { name: string } })
      .constructor.name;
    const httpProto = (http.globalAgent as { protocol?: string }).protocol;
    const httpsProto = (https.globalAgent as { protocol?: string }).protocol;
    this.logger.log(
      `[network-config] applied mode=${mode}${disabled ? ' (force direct)' : ''} ` +
        `http.globalAgent=${httpName}/${httpProto} ` +
        `https.globalAgent=${httpsName}/${httpsProto} ` +
        `env={HTTP_PROXY:${process.env.HTTP_PROXY ? this.maskProxy(process.env.HTTP_PROXY) : '(unset)'},` +
        `HTTPS_PROXY:${process.env.HTTPS_PROXY ? this.maskProxy(process.env.HTTPS_PROXY) : '(unset)'},` +
        `ALL_PROXY:${process.env.ALL_PROXY ? this.maskProxy(process.env.ALL_PROXY) : '(unset)'}}`,
    );
  }

  private destroyExistingGlobalAgents(): void {
    try {
      (http.globalAgent as { destroy?: () => void }).destroy?.();
    } catch {
      /* ignore — globalAgent might already be torn down */
    }
    try {
      (https.globalAgent as { destroy?: () => void }).destroy?.();
    } catch {
      /* ignore */
    }
  }

  private installProxyAgents(
    httpProxyUrl: string | null | undefined,
    httpsProxyUrl: string | null | undefined,
  ): void {
    try {
      // Casts: Http(s)ProxyAgent extends `Agent` from `agent-base`, not
      // Node's http.Agent / https.Agent — runtime fully compatible
      // (we verified `https.globalAgent = new HttpsProxyAgent(...)`
      // works), but TS's structural check rejects the assignment. The
      // double-`unknown` cast tells TS we know what we're doing.
      if (httpProxyUrl) {
        http.globalAgent = new HttpProxyAgent(httpProxyUrl, {
          keepAlive: true,
        }) as unknown as HttpType.Agent;
      } else {
        http.globalAgent = new http.Agent({ keepAlive: true });
      }
      if (httpsProxyUrl) {
        https.globalAgent = new HttpsProxyAgent(httpsProxyUrl, {
          keepAlive: true,
        }) as unknown as HttpsType.Agent;
      } else {
        https.globalAgent = new https.Agent({ keepAlive: true });
      }
    } catch (err) {
      this.logger.error(
        `[network-config] failed to install proxy agents: ${(err as Error).message}; ` +
          `falling back to direct agents so outbound traffic doesn't stall`,
      );
      this.installDirectAgents();
    }
  }

  private installDirectAgents(): void {
    http.globalAgent = new http.Agent({ keepAlive: true });
    https.globalAgent = new https.Agent({ keepAlive: true });
  }

  private unsetProxyEnv(): void {
    delete process.env.HTTP_PROXY;
    delete process.env.http_proxy;
    delete process.env.HTTPS_PROXY;
    delete process.env.https_proxy;
    // axios's bundled proxy-from-env falls back to ALL_PROXY when
    // HTTP(S)_PROXY is missing — must clear it too or shell-exported
    // `ALL_PROXY=socks5://...` leaks through and produces axios's
    // ERR_ASSERTION "protocol mismatch" (socks5: vs http: assertion
    // inside follow-redirects). Same goes for the lowercase variant.
    delete process.env.ALL_PROXY;
    delete process.env.all_proxy;
  }

  /** Strip user:pass from a proxy URL before logging. */
  private maskProxy(url: string | null | undefined): string {
    if (!url) return '(unset)';
    try {
      const u = new URL(url);
      if (u.username || u.password) {
        u.username = u.username ? '***' : '';
        u.password = u.password ? '***' : '';
      }
      return u.toString();
    } catch {
      return '(invalid)';
    }
  }

  private readCached<T>(slot: CachedValue<T> | null): T | undefined {
    if (!slot) return undefined;
    if (slot.expiresAt < Date.now()) return undefined;
    return slot.value;
  }

  private unwrapStringValue(value: unknown): string | null {
    if (value === null || value === undefined) return null;
    if (typeof value === 'string') return value;
    if (
      typeof value === 'object' &&
      value !== null &&
      'value' in (value as Record<string, unknown>)
    ) {
      const inner = (value as Record<string, unknown>).value;
      return typeof inner === 'string' ? inner : null;
    }
    return null;
  }

  private unwrapBoolValue(value: unknown): boolean {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string')
      return value === 'true' || value === '1';
    if (
      typeof value === 'object' &&
      value !== null &&
      'value' in (value as Record<string, unknown>)
    ) {
      return this.unwrapBoolValue((value as Record<string, unknown>).value);
    }
    return false;
  }
}
