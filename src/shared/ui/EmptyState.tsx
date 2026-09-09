import type { ComponentType } from 'react';

import { Button } from '@/shared/ui/Button';

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
};

/**
 * What a list, panel or pane shows when it is genuinely empty.
 *
 * Used by the file-manager module for an empty folder, the task-master module for an empty
 * board, and the memory-intake module for a queue with nothing waiting — all three mean "there
 * is nothing here yet", and a dashed frame around a serif line says that without any of them
 * inventing a way to.
 *
 * "Empty" is not "we don't know" and not "zero": this belongs where the app has looked and
 * found nothing. A pane that is still loading, or that failed to read, says its own thing.
 */
export function EmptyState({ title = 'Nothing here yet', message, icon: Icon, actionLabel, onAction }: EmptyStateProps) {
  return (
    <div className="vv-empty flex flex-col items-center justify-center">
      {Icon && (
        <span className="vv-empty__icon">
          <Icon className="h-5 w-5" aria-hidden="true" />
        </span>
      )}
      <div className="vv-empty__title">{title}</div>
      {message && <p className="vv-empty__message">{message}</p>}
      {actionLabel && (
        <Button variant="tonal" className="mt-2" onClick={onAction}>
          {actionLabel}
        </Button>
      )}
    </div>
  );
}
