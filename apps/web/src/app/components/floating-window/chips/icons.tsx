import React from 'react';
import {
  Bot,
  Image as ImageIcon,
  Video,
  Music,
  Upload,
  PenLine,
  Settings,
  Layers,
  Clock,
  Thermometer,
  Cpu,
  Layout,
  Link as LinkIcon,
  FileText,
  Sliders,
} from 'lucide-react';

const ICON_MAP: Record<string, React.ElementType> = {
  Bot,
  Cpu,
  Image: ImageIcon,
  Video,
  Music,
  Upload,
  PenLine,
  Settings,
  Layers,
  Layout,
  Clock,
  Thermometer,
  Link: LinkIcon,
  FileText,
  Sliders,
};

interface DynamicLucideIconProps {
  name?: string;
  size?: number;
  className?: string;
  color?: string;
}

/**
 * 按字符串名称查找 lucide-react 图标。
 * 未找到时返回 null(不画占位符)。
 */
export const DynamicLucideIcon: React.FC<DynamicLucideIconProps> = ({ name, size = 16, className, color }) => {
  if (!name) return null;
  const Icon = ICON_MAP[name];
  if (!Icon) return null;
  return <Icon size={size} className={className} color={color} />;
};
