import type { ComponentType } from 'react';

import { Button } from '@/shared/ui/Button';
import { cn } from '@/shared/utils';

type EmptyStateProps = {
  title?: string;
  message?: string;
  /**
   * A glyph above the title. Optional because an empty state is a sentence first: the icon
   * says WHICH kind of nothing this is — an empty inbox and an unreachable service are two
   * different pieces of news that a dashed frame alone draws identically.
   */
  icon?: ComponentType<{ className?: string; 'aria-hidden'?: boolean | 'true' | 'false' }>;
  /** Renders the action button. Without it the state is a statement, not an invitation. */
  actionLabel?: string;
  onAction?: () => void;
  /**
   * `sm`: one quiet line, for a place that keeps its room while it holds nothing yet — the title alone, at the body's small
   * size in the muted ink (4.5:1 on both canvases), in a slimmer frame. Measured by the station's draft dock, whose line
   * stands between her conversation and the talk control and must not outshout either.
   */
  size?: 'default' | 'sm';
};

/**
 * What a list, panel or pane shows when it is genuinely empty.
 *
 * Used across the app: the affected-areas, app-switcher, carrier-bulletins, cerberus, chat, chat-host, companion,
 * deepseek-spend, dispatcher, document-preview, file-manager, followups, git-panel, heal, jev, kanban, memory-intake, notes,
 * roadmap, runner-tab, schedules, shell, sidebar, standalone-shell, station, task-master and universe modules and the shared
 * KanbanLane — an empty folder, an empty board, a queue with nothing waiting, a History with nothing in it yet, and (at `sm`)
 * the station's draft dock while she holds no draft. Each means "there is nothing here yet", and a dashed frame around a serif
 * line says that without any of them inventing a way to.
 *
 * "Empty" is not "we don't know" and not "zero": this belongs where the app has looked and
 * found nothing. A pane that is still loading, or that failed to read, says its own thing.
 * Its action is a 44 px catch under a finger (a touch screen, or a window under 768 px), the house's touch floor.
 */
export function EmptyState({ title = 'Nothing here yet', message, icon: Icon, actionLabel, onAction, size = 'default' }: EmptyStateProps) {
  return (
    <div className={cn('vv-empty flex flex-col items-center justify-center', size === 'sm' && 'vv-empty--sm')}>
      {Icon && (
        <span className="vv-empty__icon">
          <Icon className="h-5 w-5" aria-hidden="true" />
        </span>
      )}
      <div className="vv-empty__title">{title}</div>
      {message && <p className="vv-empty__message">{message}</p>}
      {actionLabel && (
        <Button variant="tonal" className="mt-2 finger:h-11" onClick={onAction}>
          {actionLabel}
        </Button>
      )}
    </div>
  );
}
