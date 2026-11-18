import { useTranslation } from 'react-i18next';
import { AlertTriangle, Clock, X } from 'lucide-react';

import { Button } from '@/shared/ui';
import type { ScheduledMessage } from '@/shared/types';

type ScheduledMessageListProps = {
  scheduledMessages: ScheduledMessage[];
  onCancel: (id: string) => void;
};

/**
 * Rendered by ChatComposer above the input, so a message waiting to be sent is
 * visible in the session it will be sent to — and can be called off.
 *
 * Failed ones are shown too: a message that did not go is exactly the thing a
 * user needs to know about, and the server records why. Dismissing one goes
 * through the same cancel endpoint, so it stays gone across reloads.
 */
export function ScheduledMessageList({ scheduledMessages, onCancel }: ScheduledMessageListProps) {
  const { t } = useTranslation('chat');
  const visible = scheduledMessages.filter(
    (message) => message.status === 'pending' || message.status === 'failed',
  );

  if (visible.length === 0) {
    return null;
  }

  return (
    <div className="mx-auto mb-2 flex max-w-[var(--chat-measure,54.25rem)] flex-col gap-1.5">
      {visible.map((message) => {
        const isFailed = message.status === 'failed';

        return (
          // The same form as a queued line: a hairline and no wash. One that did not go says so in the danger ink (the tone's own,
          // `data-tone`), which is the one place here that colour means something.
          <div
            key={message.id}
            data-chat-waiting={isFailed ? 'failed' : 'scheduled'}
            data-tone={isFailed ? 'danger' : undefined}
            className="flex items-start gap-2 rounded-lg border border-border px-3 py-2 text-xs"
          >
            {isFailed ? (
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-tone-ink" />
            ) : (
              <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            )}
            <div className="min-w-0 flex-1">
              <p className={isFailed ? 'text-[11px] text-tone-ink' : 'text-[11px] text-muted-foreground'}>
                {isFailed
                  ? t('schedule.failed', { reason: message.failureReason ?? '' })
                  : t('schedule.pending', { when: new Date(message.scheduledFor).toLocaleString() })}
              </p>
              <p className="mt-0.5 truncate text-foreground">{message.content}</p>
            </div>
            <Button
              variant="outline"
              size="icon"
              className="size-8 shrink-0 finger:size-11"
              onClick={() => onCancel(message.id)}
              title={isFailed ? t('schedule.dismiss') : t('schedule.cancel')}
              aria-label={isFailed ? t('schedule.dismiss') : t('schedule.cancel')}
            >
              <X aria-hidden="true" />
            </Button>
          </div>
        );
      })}
    </div>
  );
}
