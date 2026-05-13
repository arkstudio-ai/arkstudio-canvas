import React from 'react';
import { LucideIcon } from 'lucide-react';
import '../../styles/canvas.css';

export interface ToolbarAction {
  id: string;
  label?: string;
  icon?: React.ReactNode | LucideIcon;
  onClick: (e: React.MouseEvent) => void;
  className?: string; // For custom styling (e.g. green text/icon)
  title?: string;
}

interface ActionToolbarProps {
  actions: ToolbarAction[];
  className?: string;
  style?: React.CSSProperties;
  visible?: boolean;
}

export const ActionToolbar: React.FC<ActionToolbarProps> = ({ 
  actions, 
  className = '', 
  style,
  visible = true 
}) => {
  if (!visible || actions.length === 0) return null;

  return (
    <div 
      className={`canvas-node-toolbar ${className}`}
      style={style}
      onMouseDown={(e) => e.stopPropagation()} // Prevent drag/selection of node when clicking toolbar
    >
      {actions.map((action) => {
        const Icon = action.icon as any;
        
        return (
          <button
            key={action.id}
            className={`canvas-node-toolbar-item ${action.className || ''}`}
            onClick={action.onClick}
            title={action.title || action.label}
          >
            {action.icon && (
              <span className="toolbar-item-icon">
                {/* Handle both component instance and component type */}
                {React.isValidElement(action.icon) ? action.icon : <Icon size={14} />}
              </span>
            )}
            {action.label && <span className="toolbar-item-label">{action.label}</span>}
          </button>
        );
      })}
    </div>
  );
};


