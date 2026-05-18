// OpenAI-compat image sizing 纯函数测试.
//
// resolveSize 跟 clampSeed 在 provider 里被业务路径 (i2i + t2i + edits)
// 共用, 任何边界 bug 直接挂用户. 是 0 Nest 依赖的 pure func, 单跑很轻.

import {
  clampSeed,
  resolveFamily,
  resolveSize,
  SEED_MAX,
} from './openai-compat-image-sizing';

describe('openai-compat-image-sizing', () => {
  describe('resolveFamily', () => {
    it('routes gpt-image-2* to gpt-image-2 bucket', () => {
      expect(resolveFamily('gpt-image-2')).toBe('gpt-image-2');
      expect(resolveFamily('gpt-image-2-mini')).toBe('gpt-image-2');
      expect(resolveFamily('GPT-IMAGE-2')).toBe('gpt-image-2'); // case-insensitive
    });
    it('routes gpt-image-1 / 1.5 to gpt-image-1 bucket', () => {
      expect(resolveFamily('gpt-image-1')).toBe('gpt-image-1');
      expect(resolveFamily('gpt-image-1.5')).toBe('gpt-image-1');
    });
    it('falls back to dalle for unknown / dall-e SKUs', () => {
      expect(resolveFamily('dall-e-3')).toBe('dalle');
      expect(resolveFamily('dall-e-2')).toBe('dalle');
      expect(resolveFamily('mystery-model')).toBe('dalle');
    });
  });

  describe('resolveSize', () => {
    it('returns undefined when no aspectRatio + no explicit size', () => {
      expect(resolveSize({}, 'dalle')).toBeUndefined();
      expect(resolveSize({}, 'gpt-image-2')).toBeUndefined();
    });

    it("'auto' is gpt-image-* only, dropped for dall-e", () => {
      expect(resolveSize({ aspectRatio: 'auto' }, 'gpt-image-2')).toBe('auto');
      expect(resolveSize({ aspectRatio: 'auto' }, 'gpt-image-1')).toBe('auto');
      expect(resolveSize({ aspectRatio: 'auto' }, 'dalle')).toBeUndefined();
    });

    it('explicit size wins over aspectRatio', () => {
      expect(
        resolveSize({ size: '1234x5678', aspectRatio: '16:9' }, 'gpt-image-2'),
      ).toBe('1234x5678');
    });

    it('dall-e 16:9 → fixed 1792x1024 enum (closest supported)', () => {
      expect(resolveSize({ aspectRatio: '16:9' }, 'dalle')).toBe('1792x1024');
    });

    it('gpt-image-2 flexible sizing produces multiples of 16', () => {
      // 16:9 @ 2k budget — width/height should both be 16-aligned
      const size = resolveSize(
        { aspectRatio: '16:9', resolution: '2k' },
        'gpt-image-2',
      );
      expect(size).toMatch(/^\d+x\d+$/);
      const [w, h] = size!.split('x').map(Number);
      expect(w % 16).toBe(0);
      expect(h % 16).toBe(0);
      // 16:9 means w/h ≈ 1.78
      expect(w / h).toBeCloseTo(16 / 9, 1);
    });

    it('gpt-image-1 caps total pixels at its 1.5M cap regardless of 4k request', () => {
      // 4k 想要 8M, 但 gpt-image-1 上限 1.5M, 应该收到不超过 cap.
      const size = resolveSize(
        { aspectRatio: '1:1', resolution: '4k' },
        'gpt-image-1',
      );
      const [w, h] = size!.split('x').map(Number);
      expect(w * h).toBeLessThanOrEqual(1_572_864); // FAMILY_MAX_PIXELS['gpt-image-1']
    });

    it('returns undefined for malformed ratio strings', () => {
      expect(
        resolveSize({ aspectRatio: 'not-a-ratio' }, 'gpt-image-2'),
      ).toBeUndefined();
      expect(
        resolveSize({ aspectRatio: '0:0' }, 'gpt-image-2'),
      ).toBeUndefined();
    });
  });

  describe('clampSeed', () => {
    it('returns undefined for missing / empty / non-numeric', () => {
      expect(clampSeed(undefined)).toBeUndefined();
      expect(clampSeed(null)).toBeUndefined();
      expect(clampSeed('')).toBeUndefined();
      expect(clampSeed('not-a-number')).toBeUndefined();
      expect(clampSeed(NaN)).toBeUndefined();
    });

    it('passes through valid seed within range', () => {
      expect(clampSeed(0)).toBe(0);
      expect(clampSeed(42)).toBe(42);
      expect(clampSeed(SEED_MAX)).toBe(SEED_MAX);
    });

    it('floors fractional inputs (OpenAI accepts ints only)', () => {
      expect(clampSeed(42.7)).toBe(42);
      expect(clampSeed('3.99')).toBe(3);
    });

    it('clamps negative → 0', () => {
      expect(clampSeed(-1)).toBe(0);
      expect(clampSeed(-99999)).toBe(0);
    });

    it('clamps above SEED_MAX → SEED_MAX', () => {
      expect(clampSeed(SEED_MAX + 1)).toBe(SEED_MAX);
      expect(clampSeed(1e15)).toBe(SEED_MAX);
    });

    it('accepts numeric strings', () => {
      expect(clampSeed('42')).toBe(42);
      expect(clampSeed('0')).toBe(0);
    });
  });
});
