import { Button } from '@/shared/ui/Button';

type EmptyStateProps = {
  title?: string;
  message?: string;
  /** Renders the action button. Without it the state is a statement, not an invitation. */
  actionLabel?: string;
  onAction?: () => void;
};

/**
 * What a list, panel or pane shows when it is genuinely empty.
 *
 * Used by the file-manager module (Phase 8) for an empty folder and by the task-master module
 * (Phase 16) for an empty board — both mean "there is nothing here yet", and a dashed frame
 * around a serif line says that without either of them inventing a way to.
 *
 * "Empty" is not "we don't know" and not "zero": this belongs where the app has looked and
 * found nothing. A pane that is still loading, or that failed to read, says its own thing.
 */
export function EmptyState({ title = 'Nothing here yet', message, actionLabel, onAction }: EmptyStateProps) {
  return (
    <div className="vv-empty flex flex-col items-center justify-center">
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
