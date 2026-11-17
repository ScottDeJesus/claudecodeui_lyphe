import { useTranslation } from 'react-i18next';
import { PencilIcon, XIcon } from 'lucide-react';

import { Button } from '@/shared/ui';

type QueuedMessageCardProps = {
  content: string;
  attachmentCount?: number;
  onEdit: () => void;
  onDelete: () => void;
};

/**
 * Rendered by chat's ChatComposer to show the message queued for a busy
 * session (every follow-up queued so far, joined), with edit and delete
 * actions before it is auto-sent.
 */
export default function QueuedMessageCard({
  content,
  attachmentCount = 0,
  onEdit,
  onDelete,
}: QueuedMessageCardProps) {
  const { t } = useTranslation('chat');

  // A line of the reader's own, waiting: its words on the page's ground behind a hairline, with no wash. The two things that can be done to it
  // are buttons that look like buttons (the kit's), each its mark alone.
  return (
    <div data-chat-waiting="queued" className="settings-content-enter mx-auto mb-2 max-w-[var(--chat-measure,54.25rem)] rounded-lg border border-border px-3 py-2">
      <div className="flex items-start gap-2.5">
        <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/60" aria-hidden />

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-foreground">
            <span>{t('input.queue.label', { defaultValue: 'Queued' })}</span>
            <span className="font-sans normal-case tracking-normal text-muted-foreground">
              · {t('input.queue.willSend', { defaultValue: 'Will send when this finishes' })}
            </span>
          </div>
          {/* Follow-ups queued while one waits are joined into this message, so it scrolls instead
              of clamping: everything that will be sent stays readable, with each follow-up on its
              own lines. Focusable, so it can also be scrolled from the keyboard. */}
          <p
            tabIndex={0}
            className="mt-0.5 max-h-28 overflow-y-auto whitespace-pre-wrap break-words rounded-sm text-sm text-foreground/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {content}
          </p>
          {attachmentCount > 0 && (
            <p className="mt-0.5 text-xs text-muted-foreground">
              {attachmentCount} {attachmentCount === 1 ? 'file' : 'files'} attached
            </p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <Button
            variant="outline"
            size="icon"
            className="size-8 finger:size-11"
            onClick={onEdit}
            aria-label={t('input.queue.edit', { defaultValue: 'Edit queued message' })}
            title={t('input.queue.edit', { defaultValue: 'Edit queued message' })}
          >
            <PencilIcon aria-hidden="true" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="size-8 finger:size-11"
            onClick={onDelete}
            aria-label={t('input.queue.delete', { defaultValue: 'Delete queued message' })}
            title={t('input.queue.delete', { defaultValue: 'Delete queued message' })}
          >
            <XIcon aria-hidden="true" />
          </Button>
        </div>
      </div>
    </div>
  );
}
