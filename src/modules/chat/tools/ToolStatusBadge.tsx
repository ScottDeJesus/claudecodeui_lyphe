import { Badge } from '@/shared/ui';
import { cn } from '@/shared/utils';
import type { Tone, ToolStatus } from '@/shared/types';


const STATUS_CONFIG: Record<ToolStatus, { label: string; tone: Tone }> = {
  running: { label: 'Running', tone: 'info' },
  completed: { label: 'Completed', tone: 'positive' },
  error: { label: 'Error', tone: 'danger' },
  denied: { label: 'Denied', tone: 'warn' },
};

type ToolStatusBadgeProps = {
  status: ToolStatus;
  className?: string;
};

/**
 * Used by chat's ToolRenderer, BashCommandDisplay and OneLineDisplay to label a
 * tool call's pending, running, error or denied state. The same compact pill as
 * ToolOutcomeBadge, so a row's rightmost mark has one shape whichever badge fills it.
 */
export function ToolStatusBadge({ status, className }: ToolStatusBadgeProps) {
  const config = STATUS_CONFIG[status];
  return (
    <Badge tone={config.tone} className={cn('vv-badge--compact', className)}>
      {config.label}
    </Badge>
  );
}
