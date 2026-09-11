import { FileText, Globe, Pencil, Search, Terminal, Wrench, type LucideIcon } from 'lucide-react';

import { cn } from '@/shared/utils';

/** The mark each registry `icon` name stands for (toolConfigs.ts). */
const TOOL_ROW_ICONS: Record<string, LucideIcon> = {
  terminal: Terminal,
  file: FileText,
  pencil: Pencil,
  search: Search,
  globe: Globe,
};

/**
 * The tool's mark, drawn after the caret and before the label so every row's label
 * starts in the same column. A tool the registry gives no icon draws the neutral wrench.
 *
 * Used by BashCommandDisplay, OneLineDisplay, ToolRenderer's framed collapsible and
 * ToolGroupContainer.
 */
export function ToolRowIcon({ icon, className }: { icon?: string; className?: string }) {
  const Icon = (icon && TOOL_ROW_ICONS[icon]) || Wrench;
  return <Icon aria-hidden className={cn('h-3.5 w-3.5 flex-shrink-0 text-muted-foreground', className)} />;
}
