import React, { useState, useRef, useEffect } from 'react';
import { Plus, PenLine, Image as ImageIcon, Video, Music, Upload } from 'lucide-react';
import { StandardNodeType } from '../types/nodes';

/**
 * Free-form menu entry rendered ABOVE the node-type list, separated by a
 * 1px divider. Reserved for navigation / app-level shortcuts that aren't
 * "spawn a node here" — e.g. the editor's "go to workspace" entry.
 *
 * Why distinct from `availableTypes`:
 *   - `availableTypes` items go through `onAddNode(type)` and the type
 *     string is forwarded to the canvas's node-creation pipeline. A
 *     navigation item has no node to spawn, so it owns its own onClick
 *     and never touches that pipeline.
 *   - This keeps the menu reusable from `CanvasEditor` (drag-from-edge
 *     spawn menu) which intentionally does NOT pass customItems — drag
 *     spawning a "navigate to workspace" entry would be nonsense.
 */
export interface FloatingMenuCustomItem {
  id: string;
  label: string;
  icon?: React.ReactNode;
  onClick: () => void;
}

export interface FloatingNodeMenuProps {
  /** 点击菜单项时的回调 */
  onAddNode: (type: string) => void;
  /** 点击"上传"后选择文件的回调（由应用层实现上传 + 创建对应节点） */
  onUploadNode?: (file: File) => void;
  /** 可选：自定义显示的节点类型列表，默认为标准 4 种 + 上传 */
  availableTypes?: Array<{ type: string; label: string; icon?: React.ReactNode }>;
  /** Optional app-level shortcuts shown above the node list, with a
   *  divider between this group and the node-type group. */
  customItems?: FloatingMenuCustomItem[];
  /** 如果提供位置，则作为弹出菜单显示在指定位置，不显示悬浮按钮 */
  position?: { x: number; y: number };
  /** 弹出菜单模式下的关闭回调 */
  onClose?: () => void;
}

/**
 * Fallback icon when the caller (e.g. useCanvasConnection) builds menu
 * items from `config.nodeDefinitions` and does not carry an `icon` field.
 * Keeps the look consistent with DEFAULT_NODE_TYPES below.
 */
const DEFAULT_ICONS: Record<string, React.ReactNode> = {
  [StandardNodeType.TEXT]: <PenLine size={16} />,
  [StandardNodeType.IMAGE]: <ImageIcon size={16} />,
  [StandardNodeType.VIDEO]: <Video size={16} />,
  [StandardNodeType.AUDIO]: <Music size={16} />,
};

const DEFAULT_NODE_TYPES = [
  { type: StandardNodeType.TEXT, label: '文本', icon: DEFAULT_ICONS[StandardNodeType.TEXT] },
  { type: StandardNodeType.IMAGE, label: '图片', icon: DEFAULT_ICONS[StandardNodeType.IMAGE] },
  { type: StandardNodeType.VIDEO, label: '视频', icon: DEFAULT_ICONS[StandardNodeType.VIDEO] },
  { type: StandardNodeType.AUDIO, label: '音频', icon: DEFAULT_ICONS[StandardNodeType.AUDIO] },
];

const UPLOAD_ITEM = { type: '__upload__', label: '上传', icon: <Upload size={16} /> };

export const FloatingNodeMenu: React.FC<FloatingNodeMenuProps> = ({
  onAddNode,
  onUploadNode,
  availableTypes = DEFAULT_NODE_TYPES,
  customItems,
  position,
  onClose
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isContextMenuMode = !!position;
  const showMenu = isContextMenuMode || isOpen;

  useEffect(() => {
    if (isContextMenuMode && onClose) {
      const handleClickOutside = (event: MouseEvent) => {
        if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
          onClose();
        }
      };
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isContextMenuMode, onClose]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && onUploadNode) {
      onUploadNode(file);
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (!isContextMenuMode) setIsOpen(false);
    onClose?.();
  };

  const handleItemClick = (type: string) => {
    if (type === '__upload__') {
      fileInputRef.current?.click();
      return;
    }
    onAddNode(type);
    if (!isContextMenuMode) setIsOpen(false);
    onClose?.();
  };

  const allItems = onUploadNode
    ? [...availableTypes, UPLOAD_ITEM]
    : availableTypes;

  const dividerStyle: React.CSSProperties = {
    height: 1,
    margin: '4px 4px',
    background: 'rgba(255,255,255,0.10)',
  };

  const menuStyle: React.CSSProperties = isContextMenuMode ? {
    position: 'fixed',
    left: position!.x,
    top: position!.y,
    background: '#222',
    border: '1px solid #444',
    borderRadius: 8,
    padding: 8,
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    boxShadow: '0 4px 20px rgba(0,0,0,0.6)',
    zIndex: 1000,
    minWidth: 140
  } : {
    position: 'absolute',
    left: 84,
    top: '50%',
    transform: 'translateY(-50%)',
    background: '#222',
    border: '1px solid #444',
    borderRadius: 8,
    padding: 8,
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    boxShadow: '0 4px 20px rgba(0,0,0,0.6)',
    zIndex: 100,
    minWidth: 140
  };

  const handleCustomClick = (item: FloatingMenuCustomItem) => {
    item.onClick();
    if (!isContextMenuMode) setIsOpen(false);
    onClose?.();
  };

  const renderItemRow = (key: string, icon: React.ReactNode, label: string, onClick: () => void) => (
    <div
      key={key}
      onClick={onClick}
      style={{
        padding: '8px 12px',
        borderRadius: 4,
        cursor: 'pointer',
        color: '#eee',
        fontSize: 14,
        transition: 'background 0.2s',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = '#444')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
    >
      {icon}
      <span>{label}</span>
    </div>
  );

  const hasCustom = !!(customItems && customItems.length > 0);

  const renderMenu = () => (
    <div ref={menuRef} style={menuStyle}>
      {hasCustom && customItems!.map((it) =>
        renderItemRow(`custom:${it.id}`, it.icon, it.label, () => handleCustomClick(it)),
      )}
      {hasCustom && <div style={dividerStyle} />}
      {allItems.map((item) => {
        const icon = item.icon ?? DEFAULT_ICONS[item.type];
        return renderItemRow(item.type, icon, item.label, () => handleItemClick(item.type));
      })}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,video/*,audio/*"
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />
    </div>
  );

  if (isContextMenuMode) {
    return renderMenu();
  }

  return (
    <>
      <div
        style={{
          position: 'absolute',
          left: 24,
          top: '50%',
          transform: 'translateY(-50%)',
          width: 48,
          height: 48,
          borderRadius: '50%',
          background: isOpen ? '#666' : '#333',
          border: '1px solid #444',
          color: '#fff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
          zIndex: 100,
          transition: 'all 0.2s'
        }}
        onClick={() => setIsOpen(!isOpen)}
        onMouseEnter={(e) => e.currentTarget.style.background = isOpen ? '#666' : '#444'}
        onMouseLeave={(e) => e.currentTarget.style.background = isOpen ? '#666' : '#333'}
        title="Add Node"
      >
        <Plus 
          size={24} 
          style={{ 
            transform: isOpen ? 'rotate(45deg)' : 'none', 
            transition: 'transform 0.2s' 
          }} 
        />
      </div>

      {showMenu && renderMenu()}
    </>
  );
};
