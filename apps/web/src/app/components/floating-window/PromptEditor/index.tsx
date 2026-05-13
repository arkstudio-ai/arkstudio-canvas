import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { AtMenu, AtMenuRef, MentionCandidate } from './AtMenu';

/**
 * PromptEditor v2:
 *   - 数据层是纯字符串 (textarea), 引用语义在素材条; `@label` 仅为快捷打字 + 高亮
 *   - Mirror 与 textarea 必须用完全一致的排版规则, mention 只用 color/bg, 不改变字宽 (无 padding/fontWeight)
 *   - 原生 capture keydown: ←/→/Backspace/Delete 将合法 `@label` 视为整块跳转/删除 (与 IME 共存)
 */

export interface PromptEditorProps {
  value: string;
  onChange: (value: string) => void;
  mentionCandidates: MentionCandidate[];
  placeholder?: string;
  minRows?: number;
  onSubmit?: () => void;
  autoFocus?: boolean;
  className?: string;
}

// ============ 共享 mention 正则 & 区间 (高亮 / 键盘共用) ============

export interface MentionRange {
  /** `@` 下标 */
  start: number;
  /** `@label` 之后第一个字符的下标 ([start,end) 为整块 mention 文本) */
  end: number;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 候选 label 非空时用; glob 不包含 `@`, 匹配的是 `@图片1` 整段 */
function buildMentionPattern(candidates: MentionCandidate[]): RegExp | null {
  if (!candidates.length) return null;
  const sorted = [...candidates].sort((a, b) => b.label.length - a.label.length);
  const inner = sorted.map((c) => escapeRegExp(c.label)).join('|');
  if (!inner) return null;
  return new RegExp(`@(?:${inner})`, 'g');
}

export function computeMentionRanges(value: string, candidates: MentionCandidate[]): MentionRange[] {
  const pattern = buildMentionPattern(candidates);
  if (!pattern) return [];
  const ranges: MentionRange[] = [];
  pattern.lastIndex = 0;
  for (const m of value.matchAll(pattern)) {
    const start = m.index!;
    const full = m[0];
    ranges.push({ start, end: start + full.length });
  }
  return ranges;
}

/** caret ∈ (start, end]: 整块内部或紧贴右边界,一次 ← 跳到 start */
function findMentionContainingCaret(ranges: MentionRange[], caret: number): MentionRange | null {
  for (const r of ranges) {
    if (caret > r.start && caret <= r.end) return r;
  }
  return null;
}

function findMentionWithCaretBefore(ranges: MentionRange[], caret: number): MentionRange | null {
  // caret ∈ [start,end) → 整块内或左边界 (↑→ 整块越过)
  for (const r of ranges) {
    if (caret >= r.start && caret < r.end) return r;
  }
  return null;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildMirrorHTML(value: string, candidates: MentionCandidate[]): string {
  const ranges = computeMentionRanges(value, candidates);
  if (ranges.length === 0) return escapeHtml(value) + '\u200B';

  let out = '';
  let last = 0;
  for (const r of ranges) {
    out += escapeHtml(value.slice(last, r.start));
    out += `<span class="cf-prompt-token-valid">${escapeHtml(value.slice(r.start, r.end))}</span>`;
    last = r.end;
  }
  out += escapeHtml(value.slice(last));
  return out + '\u200B';
}

interface AtState {
  startIdx: number;
  cursorIdx: number;
}

export const PromptEditor: React.FC<PromptEditorProps> = ({
  value,
  onChange,
  mentionCandidates,
  placeholder = '描述你想要生成的内容,使用 @ 引用素材...',
  minRows = 3,
  onSubmit,
  autoFocus = false,
  className,
}) => {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const mirrorRef = useRef<HTMLDivElement | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const atMenuRef = useRef<AtMenuRef | null>(null);
  const isComposingRef = useRef(false);

  const valueRef = useRef(value);
  valueRef.current = value;
  const candidatesRef = useRef(mentionCandidates);
  candidatesRef.current = mentionCandidates;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const [atState, setAtState] = useState<AtState | null>(null);
  const [menuPos, setMenuPos] = useState<{ left: number; top: number } | null>(null);
  const [highlightedIndex, setHighlightedIndex] = useState(0);

  const mirrorHTML = useMemo(() => buildMirrorHTML(value, mentionCandidates), [value, mentionCandidates]);

  const syncScroll = useCallback(() => {
    const ta = textareaRef.current;
    const mr = mirrorRef.current;
    if (!ta || !mr) return;
    mr.scrollTop = ta.scrollTop;
    mr.scrollLeft = ta.scrollLeft;
  }, []);

  useLayoutEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${ta.scrollHeight}px`;
    syncScroll();
  }, [value, syncScroll]);

  const mentionQuery = useMemo(() => {
    if (!atState) return null;
    if (atState.cursorIdx < atState.startIdx + 1) return null;
    return value.slice(atState.startIdx + 1, atState.cursorIdx);
  }, [atState, value]);

  const filteredCandidates = useMemo(() => {
    if (mentionQuery === null) return [];
    if (mentionQuery === '') return mentionCandidates;
    const q = mentionQuery.toLowerCase();
    return mentionCandidates.filter((c) => c.label.toLowerCase().includes(q));
  }, [mentionQuery, mentionCandidates]);

  useEffect(() => {
    setHighlightedIndex(0);
  }, [filteredCandidates.length]);

  const checkAndExitMention = useCallback(
    (newValue: string, cursor: number) => {
      if (!atState) return;
      if (newValue[atState.startIdx] !== '@') {
        setAtState(null);
        return;
      }
      if (cursor <= atState.startIdx) {
        setAtState(null);
        return;
      }
      const between = newValue.slice(atState.startIdx + 1, cursor);
      if (/\s/.test(between)) {
        setAtState(null);
        return;
      }
      const maxLabelLen = mentionCandidates.reduce((m, c) => Math.max(m, c.label.length), 8);
      if (between.length > maxLabelLen + 4) {
        setAtState(null);
        return;
      }
      setAtState({ startIdx: atState.startIdx, cursorIdx: cursor });
    },
    [atState, mentionCandidates],
  );

  const recomputeMenuPos = useCallback(() => {
    if (!atState) return;
    const ta = textareaRef.current;
    if (!ta) return;

    const measureEl = document.createElement('div');
    const cs = window.getComputedStyle(ta);
    measureEl.style.position = 'absolute';
    measureEl.style.visibility = 'hidden';
    measureEl.style.whiteSpace = cs.whiteSpace || 'pre-wrap';
    measureEl.style.wordBreak = cs.wordBreak || 'break-word';
    measureEl.style.overflowWrap = cs.overflowWrap || 'break-word';
    measureEl.style.fontFamily = cs.fontFamily;
    measureEl.style.fontSize = cs.fontSize;
    measureEl.style.fontWeight = cs.fontWeight;
    measureEl.style.lineHeight = cs.lineHeight;
    measureEl.style.letterSpacing = cs.letterSpacing;
    measureEl.style.padding = cs.padding;
    measureEl.style.border = cs.border;
    measureEl.style.boxSizing = cs.boxSizing;
    measureEl.style.width = `${ta.clientWidth}px`;

    const before = value.slice(0, atState.startIdx);
    const marker = document.createElement('span');
    marker.textContent = '@';
    measureEl.textContent = '';
    measureEl.appendChild(document.createTextNode(before));
    measureEl.appendChild(marker);
    measureEl.appendChild(document.createTextNode('\u200B'));

    document.body.appendChild(measureEl);
    const taRect = ta.getBoundingClientRect();
    const markerRect = marker.getBoundingClientRect();
    const measureRect = measureEl.getBoundingClientRect();
    document.body.removeChild(measureEl);

    const relLeft = markerRect.left - measureRect.left;
    const relTop = markerRect.top - measureRect.top;
    const lh = parseFloat(cs.lineHeight || '20') || 20;

    setMenuPos({
      left: taRect.left + relLeft - ta.scrollLeft,
      top: taRect.top + relTop - ta.scrollTop + lh + 4,
    });
  }, [atState, value]);

  useLayoutEffect(() => {
    if (atState) recomputeMenuPos();
    else setMenuPos(null);
  }, [atState, recomputeMenuPos]);

  /**
   * AtMenu 用 position:fixed + 绝对坐标; 页面/任意祖先滚动后须重算,否则弹窗会「粘在」旧视口位置。
   * - window capture scroll: 捕获所有元素上的 scroll (scroll 不冒泡)
   * - visualViewport: 移动端地址栏 / 缩放
   */
  useLayoutEffect(() => {
    if (!atState) return;

    let rafId = 0;
    const scheduleReposition = () => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => recomputeMenuPos());
    };

    window.addEventListener('scroll', scheduleReposition, true);
    window.addEventListener('resize', scheduleReposition);
    const vv = window.visualViewport;
    vv?.addEventListener('scroll', scheduleReposition);
    vv?.addEventListener('resize', scheduleReposition);

    scheduleReposition();

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('scroll', scheduleReposition, true);
      window.removeEventListener('resize', scheduleReposition);
      vv?.removeEventListener('scroll', scheduleReposition);
      vv?.removeEventListener('resize', scheduleReposition);
    };
  }, [atState, recomputeMenuPos]);

  /** 整块 mention 的 ←/→/删: capture 早于默认; 仅用 ref 读最新 prompt */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (isComposingRef.current) return;
      if (e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.defaultPrevented) return;

      const el = textareaRef.current;
      if (!el || document.activeElement !== el) return;

      const selStart = el.selectionStart ?? 0;
      const selEnd = el.selectionEnd ?? 0;
      if (selStart !== selEnd) return;

      const v = valueRef.current;
      const ranges = computeMentionRanges(v, candidatesRef.current);
      const caret = selStart;

      if (e.key === 'ArrowLeft') {
        const hit = findMentionContainingCaret(ranges, caret);
        if (hit && caret !== hit.start) {
          e.preventDefault();
          requestAnimationFrame(() => {
            const t2 = textareaRef.current;
            if (!t2) return;
            t2.setSelectionRange(hit!.start, hit!.start);
          });
        }
        return;
      }

      if (e.key === 'ArrowRight') {
        const hit = findMentionWithCaretBefore(ranges, caret);
        if (hit && caret !== hit.end) {
          e.preventDefault();
          requestAnimationFrame(() => {
            const t2 = textareaRef.current;
            if (!t2) return;
            t2.setSelectionRange(hit!.end, hit!.end);
          });
        }
        return;
      }

      if (e.key === 'Backspace') {
        const hit = ranges.find((r) => r.start < caret && caret <= r.end);
        if (hit) {
          e.preventDefault();
          const next = v.slice(0, hit.start) + v.slice(hit.end);
          const s = hit.start;
          onChangeRef.current(next);
          requestAnimationFrame(() => {
            const t2 = textareaRef.current;
            if (!t2) return;
            t2.setSelectionRange(s, s);
          });
        }
        return;
      }

      if (e.key === 'Delete') {
        const hit = ranges.find((r) => caret >= r.start && caret < r.end);
        if (hit) {
          e.preventDefault();
          const next = v.slice(0, hit.start) + v.slice(hit.end);
          const s = hit.start;
          onChangeRef.current(next);
          requestAnimationFrame(() => {
            const t2 = textareaRef.current;
            if (!t2) return;
            t2.setSelectionRange(s, s);
          });
        }
      }
    };

    /** ref 就绪后再挂 listener (首轮 effect 若在 ref commit 竞态下兜底) */
    const taNow = textareaRef.current;
    if (!taNow) return;
    taNow.addEventListener('keydown', handler, true);
    return () => taNow.removeEventListener('keydown', handler, true);
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    const cursor = e.target.selectionStart ?? newValue.length;
    onChange(newValue);

    if (isComposingRef.current) return;

    if (!atState && cursor > 0 && newValue[cursor - 1] === '@') {
      const prev = cursor - 2 >= 0 ? newValue[cursor - 2] : '';
      if (prev === '' || /\s/.test(prev)) {
        setAtState({ startIdx: cursor - 1, cursorIdx: cursor });
        setHighlightedIndex(0);
        return;
      }
    }
    if (atState) checkAndExitMention(newValue, cursor);
  };

  const handleSelect = () => {
    const ta = textareaRef.current;
    if (!ta || !atState) return;
    const cursor = ta.selectionStart;
    checkAndExitMention(ta.value, cursor);
  };

  const insertMention = (item: MentionCandidate) => {
    const ta = textareaRef.current;
    if (!ta || !atState) return;
    const before = value.slice(0, atState.startIdx);
    const after = value.slice(atState.cursorIdx);
    const inserted = `@${item.label} `;
    const newValue = before + inserted + after;
    onChange(newValue);
    setAtState(null);

    requestAnimationFrame(() => {
      const ta2 = textareaRef.current;
      if (!ta2) return;
      const pos = before.length + inserted.length;
      ta2.focus();
      ta2.setSelectionRange(pos, pos);
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      onSubmit?.();
      return;
    }

    if (atState && filteredCandidates.length > 0) {
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'Enter' || e.key === 'Tab') {
        const handled = atMenuRef.current?.onKeyDown(e.nativeEvent);
        if (handled) {
          e.preventDefault();
          return;
        }
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setAtState(null);
      }
    }
  };

  useEffect(() => {
    if (!atState) return;
    const onClickOutside = (ev: MouseEvent) => {
      const wrapper = wrapperRef.current;
      const target = ev.target as Node;
      if (wrapper?.contains(target)) return;
      const el = ev.target as HTMLElement;
      if (el?.closest?.('.cf-at-menu-portal')) return;
      setAtState(null);
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [atState]);

  useEffect(() => {
    if (autoFocus) textareaRef.current?.focus();
  }, [autoFocus]);

  return (
    <div
      ref={wrapperRef}
      className={className ?? 'cf-prompt-editor'}
      style={{
        ...wrapperStyle,
        ['--cf-min-rows' as string]: String(minRows),
        ['--cf-plh' as string]: LINE_HEIGHT,
      }}
    >
      <div
        ref={mirrorRef}
        className="cf-prompt-mirror"
        aria-hidden
        dangerouslySetInnerHTML={{ __html: mirrorHTML }}
      />
      <textarea
        ref={textareaRef}
        className="cf-prompt-textarea"
        value={value}
        placeholder={placeholder}
        onChange={handleChange}
        onSelect={handleSelect}
        onKeyDown={handleKeyDown}
        onScroll={syncScroll}
        onCompositionStart={() => {
          isComposingRef.current = true;
        }}
        onCompositionEnd={(ev) => {
          isComposingRef.current = false;
          const ta = ev.currentTarget;
          const cursor = ta.selectionStart;
          if (!atState && cursor > 0 && ta.value[cursor - 1] === '@') {
            const prev = cursor - 2 >= 0 ? ta.value[cursor - 2] : '';
            if (prev === '' || /\s/.test(prev)) {
              setAtState({ startIdx: cursor - 1, cursorIdx: cursor });
              setHighlightedIndex(0);
            }
          }
        }}
        spellCheck={false}
      />

      {/* 强制 mirror / textarea 排版一致 */}
      <style>{`
        .cf-prompt-editor {
          position: relative;
          width: 100%;
        }
        .cf-prompt-editor .cf-prompt-mirror,
        .cf-prompt-editor .cf-prompt-textarea {
          font-family: ${FONT_STACK} !important;
          font-size: ${FONT_SIZE} !important;
          font-weight: 400 !important;
          line-height: var(--cf-plh) !important;
          letter-spacing: normal !important;
          padding: ${PADDING} !important;
          border: 0 solid transparent !important;
          box-sizing: border-box !important;
          white-space: pre-wrap !important;
          word-break: break-word !important;
          overflow-wrap: break-word !important;
          margin: 0 !important;
          width: 100%;
        }
        .cf-prompt-editor .cf-prompt-mirror {
          position: absolute;
          inset: 0;
          pointer-events: none;
          overflow: hidden;
          color: #eee;
          min-height: calc(var(--cf-min-rows) * var(--cf-plh));
        }
        .cf-prompt-editor .cf-prompt-textarea {
          position: relative;
          min-height: calc(var(--cf-min-rows) * var(--cf-plh));
          background: transparent;
          color: transparent;
          caret-color: #fff;
          resize: none;
          outline: none;
          overflow: hidden;
        }
        .cf-prompt-editor .cf-prompt-token-valid {
          color: #6b9fff;
          background: rgba(59, 130, 246, 0.14);
          /* 禁止 padding / border-radius / 字重变更,否则与 textarea 占位宽度漂移 */
        }
      `}</style>

      {atState && menuPos
        ? createPortal(
            <div
              className="cf-at-menu-portal"
              style={{
                position: 'fixed',
                left: menuPos.left,
                top: menuPos.top,
                zIndex: 10000,
              }}
            >
              <AtMenu
                ref={atMenuRef}
                items={filteredCandidates}
                highlightedIndex={highlightedIndex}
                onHighlightedIndexChange={setHighlightedIndex}
                onSelect={insertMention}
              />
            </div>,
            document.body,
          )
        : null}
    </div>
  );
};

const FONT_STACK =
  'ui-sans-serif, system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", "Segoe UI", Roboto, sans-serif';
const FONT_SIZE = '13px';
const LINE_HEIGHT = '20px';
const PADDING = '8px 10px';

const wrapperStyle: React.CSSProperties = {
  position: 'relative',
  width: '100%',
};
