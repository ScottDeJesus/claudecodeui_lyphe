import { useTranslation } from 'react-i18next';

import type { PendingSteer } from '@/shared/types';

type SteeredMessageCardProps = {
  steer: PendingSteer;
  /** The provider's display name, e.g. "Claude". */
  providerLabel: string;
};

/**
 * Rendered by chat's ChatComposer for a message sent into the running turn that the agent has not read
 * yet. There is no edit or delete: the message is already in the agent's input. The card goes away when
 * the agent reads it and it appears in the transcript, where it was read.
 */
export default function SteeredMessageCard({ steer, providerLabel }: SteeredMessageCardProps) {
  const { t } = useTranslation('chat');
  const attachmentCount = steer.uploadedAttachments.length || steer.attachments.length;

  return (
    // The same form as a queued line, with no wash: its dot is the accent, breathing, because this one is already on its way in.
    <div data-chat-waiting="steered" className="settings-content-enter mx-auto mb-2 max-w-[var(--chat-measure,54.25rem)] rounded-lg border border-border px-3 py-2">
      <div className="flex items-start gap-2.5">
        <span className="mt-1.5 h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-primary" aria-hidden />

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-foreground">
            <span>{t('input.steer.label', { defaultValue: 'Steering' })}</span>
            <span className="font-sans normal-case tracking-normal text-muted-foreground" role="status">
              · {steer.status === 'sending'
                ? t('input.steer.sending', { defaultValue: 'Sending…' })
                : t('input.steer.willRead', { provider: providerLabel, defaultValue: '{{provider}} reads it at its next tool call' })}
            </span>
          </div>
          <p className="mt-0.5 max-h-28 overflow-y-auto whitespace-pre-wrap break-words text-sm text-foreground/90">
            {steer.content}
          </p>
          {attachmentCount > 0 && (
            <p className="mt-0.5 text-xs text-muted-foreground">
              {t('input.steer.attachments', { count: attachmentCount, defaultValue: '{{count}} files attached' })}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
