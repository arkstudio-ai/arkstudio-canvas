// 加密/解密 round-trip + 篡改检测 + 缺 key 报错的测试.
//
// 这套 util 落库前端不可见的 apiKey (DashScope / OpenAI / Volcengine 等),
// 一旦回归 = 所有用户存的凭据要么解不出 (功能挂) 要么明文落库 (隐私事故).
// 是必须覆盖的核心.

import { encrypt, decrypt, maskSecret } from './crypto.util';

// 用一把 32 字符 fixed key 跑测试, 不污染真 ENV_ENCRYPTION_KEY.
// 每个 test 自己 set/restore, 跨用例隔离.
const TEST_KEY = 'a'.repeat(32);

describe('crypto.util', () => {
  const originalKey = process.env.ENCRYPTION_KEY;

  beforeEach(() => {
    process.env.ENCRYPTION_KEY = TEST_KEY;
  });
  afterEach(() => {
    if (originalKey === undefined) delete process.env.ENCRYPTION_KEY;
    else process.env.ENCRYPTION_KEY = originalKey;
  });

  describe('encrypt + decrypt', () => {
    it('round-trips a plain ascii secret', () => {
      const plain = 'sk-1234567890abcdef';
      const ct = encrypt(plain);
      expect(ct).not.toBe(plain);
      expect(decrypt(ct)).toBe(plain);
    });

    it('round-trips Unicode / 中文 prompts', () => {
      const plain = '一个角色三视图 · 棕色卷发戴民族风首饰';
      expect(decrypt(encrypt(plain))).toBe(plain);
    });

    it('produces different ciphertext for same plaintext (IV randomization)', () => {
      // GCM 应该用随机 IV; 两次 encrypt 同样输入应得到不同密文.
      // 没这个保证 — 重放/字典攻击就成立了.
      const plain = 'sk-abc';
      const a = encrypt(plain);
      const b = encrypt(plain);
      expect(a).not.toBe(b);
      expect(decrypt(a)).toBe(plain);
      expect(decrypt(b)).toBe(plain);
    });
  });

  describe('tamper detection', () => {
    it('throws if ciphertext is corrupted (last hex char flipped)', () => {
      // GCM 自带 auth tag, 任意位 bit 翻转都应该被 decipher.final() 拒.
      // 这条挂了 = 攻击者能修改密文不被察觉 → 严重漏洞.
      const ct = encrypt('sk-victim');
      // 翻末位 hex char (0 ↔ 1)
      const tampered = ct.replace(/.$/, (c) => (c === '0' ? '1' : '0'));
      expect(() => decrypt(tampered)).toThrow();
    });

    it('throws on malformed ciphertext format', () => {
      // 单段, 缺 iv/tag → 'Invalid encrypted format'
      expect(() => decrypt('not-a-valid-ciphertext')).toThrow();
      // 两段, 缺第三段 → 'Invalid encrypted format'
      expect(() => decrypt('only:two')).toThrow();
      // 三段 shape 合法, 但 iv 不是有效 hex → createDecipheriv 拒
      expect(() => decrypt('only:two:segments-needs-three')).toThrow();
    });
  });

  describe('key management', () => {
    it('throws when ENCRYPTION_KEY is missing', () => {
      delete process.env.ENCRYPTION_KEY;
      expect(() => encrypt('x')).toThrow(/ENCRYPTION_KEY/);
      expect(() => decrypt('a:b:c')).toThrow(/ENCRYPTION_KEY/);
    });

    it('throws when ENCRYPTION_KEY is too short (< 32 chars)', () => {
      process.env.ENCRYPTION_KEY = 'short';
      expect(() => encrypt('x')).toThrow(/32 characters/);
    });

    it('decryption with WRONG key on valid ciphertext fails', () => {
      const ct = encrypt('sk-victim');
      // 换 key 后解, GCM auth tag 验证失败 → throw
      process.env.ENCRYPTION_KEY = 'b'.repeat(32);
      expect(() => decrypt(ct)).toThrow();
    });
  });

  describe('maskSecret', () => {
    it('shows first 6 + last 4 with ... separator for normal-length secrets', () => {
      // helper for admin UI display — e.g. sk-123...cdef
      const masked = maskSecret('sk-1234567890abcdef');
      expect(masked).toMatch(/^sk-123/);
      expect(masked).toMatch(/cdef$/);
      expect(masked).toContain('...');
    });

    it('returns *** for inputs too short to mask safely (≤ 11 chars)', () => {
      expect(maskSecret('short')).toBe('***');
      expect(maskSecret('exactly11ch')).toBe('***');
    });

    it('returns null for undefined / empty input', () => {
      expect(maskSecret(undefined)).toBeNull();
      expect(maskSecret(null)).toBeNull();
      expect(maskSecret('')).toBeNull();
    });
  });
});
