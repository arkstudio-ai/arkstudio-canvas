import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from 'lucide-react';
import { popoverManager } from '../popoverManager';

export interface ChipBaseProps {
  /** chip 上显示的内容（图标 + 文字） */
  children: React.ReactNode;

  /**
   * chip 形态:
   * - 'dropdown': 显示 ⌄ 箭头, 点击弹 popover (默认)
   * - 'action': 不显示 ⌄ 箭头, 点击弹 popover (e.g. ⚙️)
   * - 'static': 不可点击
   */
  variant?: 'dropdown' | 'action' | 'static';

  /**
   * 点击时弹出的 popover 内容; 传 null/undefined 表示不弹。
   * 可传函数形式接收 `{ close }` API, 方便内部按钮关闭 popover。
   */
  popover?: React.ReactNode | ((api: { close: () => void }) => React.ReactNode);

  /** popover 锚定方向; 默认 'top' (向上弹, 因为 chip 在浮窗底部) */
  placement?: 'top' | 'bottom';

  /** 受控展开状态(默认非受控) */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;

  disabled?: boolean;

  /** chip 标题, 用于 hover tooltip */
  title?: string;

  /** 自定义类名 */
  className?: string;

  /** 点击 chip 自身的回调; 通常不需要(由 popover 行为处理), 仅在 variant=static 时可用 */
  onClick?: () => void;
}

/**
 * 通用 chip 组件:
 * - 视觉:暗色背景 + hover 高亮 + 可选 ⌄ 箭头
 * - 交互:点击切换 popover; popover 通过 portal 渲染到 body, 避开父容器 transform 影响
 * - 唯一性:全局 popoverManager 保证一次只有一个 popover 打开
 * - 自动关闭:点击 popover 外、按 Esc、组件卸载时
 */
export const ChipBase: React.FC<ChipBaseProps> = ({
  children,
  variant = 'dropdown',
  popover,
  placement = 'top',
  open: controlledOpen,
  onOpenChange,
  disabled = false,
  title,
  className,
  onClick,
}) => {
  const reactId = useId();
  const idRef = useRef(`chip-${reactId}`);
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : uncontrolledOpen;

  const chipRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  const setOpen = useCallback(
    (next: boolean) => {
      if (!isControlled) setUncontrolledOpen(next);
      onOpenChange?.(next);
    },
    [isControlled, onOpenChange],
  );

  // 全局 popover 互斥
  useEffect(() => {
    const unsub = popoverManager.subscribe((activeId) => {
      if (activeId !== idRef.current && open) setOpen(false);
    });
    return unsub;
  }, [open, setOpen]);

  // 打开时计算位置;关闭时清理
  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const chipEl = chipRef.current;
    if (!chipEl) return;

    const updatePos = () => {
      const rect = chipEl.getBoundingClientRect();
      const popEl = popoverRef.current;
      const popHeight = popEl?.offsetHeight ?? 0;
      const popWidth = popEl?.offsetWidth ?? 200;

      let top: number;
      if (placement === 'top') {
        top = rect.top - popHeight - 8;
      } else {
        top = rect.bottom + 8;
      }

      // 横向尽量与 chip 左对齐, 但不要超出视口
      let left = rect.left;
      const margin = 8;
      const maxLeft = window.innerWidth - popWidth - margin;
      if (left > maxLeft) left = maxLeft;
      if (left < margin) left = margin;

      // 纵向若超出视口顶部, 翻转到底部
      if (placement === 'top' && top < margin) {
        top = rect.bottom + 8;
      }

      setPos({ left, top });
    };

    updatePos();
    // 二次校正(popover 内容渲染后高度可能变化)
    const raf = requestAnimationFrame(updatePos);
    window.addEventListener('resize', updatePos);
    window.addEventListener('scroll', updatePos, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', updatePos);
      window.removeEventListener('scroll', updatePos, true);
    };
  }, [open, placement]);

  // 外部点击 / Esc 关闭
  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (chipRef.current?.contains(target)) return;
      if (popoverRef.current?.contains(target)) return;
      popoverManager.close();
      setOpen(false);
    };

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        popoverManager.close();
        setOpen(false);
      }
    };

    // 使用 pointerdown 而非 click, 避免与 chip 自身 onClick 顺序冲突
    document.addEventListener('pointerdown', handlePointerDown, true);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open, setOpen]);

  // 卸载时清理全局状态
  useEffect(() => {
    const id = idRef.current;
    return () => {
      if (popoverManager.current === id) popoverManager.close();
    };
  }, []);

  const handleChipClick = useCallback(() => {
    if (disabled || variant === 'static') {
      onClick?.();
      return;
    }
    if (!popover) {
      onClick?.();
      return;
    }
    if (open) {
      popoverManager.close();
      setOpen(false);
    } else {
      popoverManager.open(idRef.current);
      setOpen(true);
    }
    onClick?.();
  }, [disabled, variant, popover, open, setOpen, onClick]);

  const closePopover = useCallback(() => {
    popoverManager.close();
    setOpen(false);
  }, [setOpen]);

  const popoverContent = open && popover
    ? typeof popover === 'function'
      ? popover({ close: closePopover })
      : popover
    : null;

  return (
    <>
      <button
        ref={chipRef}
        type="button"
        className={`cf-chip${className ? ` ${className}` : ''}${open ? ' cf-chip--open' : ''}`}
        style={chipBtnStyle(disabled || variant === 'static', open)}
        disabled={disabled}
        title={title}
        onClick={handleChipClick}
      >
        <span style={chipContentStyle}>{children}</span>
        {variant === 'dropdown' && (
          <ChevronDown
            size={12}
            style={{
              opacity: 0.6,
              transition: 'transform 0.15s',
              transform: open ? 'rotate(180deg)' : 'none',
              marginLeft: 4,
              flexShrink: 0,
            }}
          />
        )}
      </button>

      {popoverContent &&
        createPortal(
          <div
            ref={popoverRef}
            className="cf-chip-popover"
            style={{
              ...popoverStyle,
              left: pos?.left ?? -9999,
              top: pos?.top ?? -9999,
              visibility: pos ? 'visible' : 'hidden',
            }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            {popoverContent}
          </div>,
          document.body,
        )}
    </>
  );
};

// ============ 样式 ============

const chipBtnStyle = (disabled: boolean, open: boolean): React.CSSProperties => ({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '6px 10px',
  height: 30,
  borderRadius: 8,
  border: open ? '1px solid #3b82f6' : '1px solid #2a2a2a',
  background: open ? 'rgba(59, 130, 246, 0.12)' : 'rgba(255, 255, 255, 0.04)',
  color: disabled ? '#666' : '#ddd',
  fontSize: 12,
  cursor: disabled ? 'not-allowed' : 'pointer',
  whiteSpace: 'nowrap',
  transition: 'background 0.15s, border-color 0.15s, color 0.15s',
  outline: 'none',
});

const chipContentStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  lineHeight: 1,
};

const popoverStyle: React.CSSProperties = {
  position: 'fixed',
  zIndex: 9999,
  minWidth: 180,
  background: 'linear-gradient(180deg, #1a1a1a 0%, #141414 100%)',
  border: '1px solid #2a2a2a',
  borderRadius: 10,
  boxShadow: '0 8px 32px rgba(0, 0, 0, 0.6)',
  backdropFilter: 'blur(8px)',
  WebkitBackdropFilter: 'blur(8px)',
  color: '#eee',
  fontSize: 13,
  padding: 6,
};
