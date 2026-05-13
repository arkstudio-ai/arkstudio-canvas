import React, { useState } from 'react';
import { ChevronRight, LucideIcon } from 'lucide-react';
import '../../styles/canvas.css';

export interface MenuAction {
  id: string;
  label: string;
  icon: LucideIcon | React.ElementType;
}

interface NodeEmptyStateProps {
  title?: string;
  items: MenuAction[];
  onAction: (action: string) => void;
}

export const NodeEmptyState: React.FC<NodeEmptyStateProps> = ({ title = '尝试：', items, onAction }) => {
  const [hoveredAction, setHoveredAction] = useState<string | null>(null);

  return (
    <div className="cf-node-empty-state">
      <div className="cf-node-empty-title">{title}</div>
      <div className="cf-node-empty-menu">
        {items.map((item) => {
          const isHovered = hoveredAction === item.id;
          const Icon = item.icon;

          return (
            <div 
              key={item.id}
              className={`cf-menu-item ${isHovered ? 'hovered' : ''}`}
              onMouseEnter={() => setHoveredAction(item.id)}
              onMouseLeave={() => setHoveredAction(null)}
              onClick={(e) => {
                e.stopPropagation();
                onAction(item.id);
              }}
            >
              <span className="cf-menu-item-icon">
                <Icon size={14} />
              </span>
              <span className="cf-menu-item-label">{item.label}</span>
              {isHovered && (
                <span className="cf-menu-item-arrow">
                  <ChevronRight size={14} />
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};













