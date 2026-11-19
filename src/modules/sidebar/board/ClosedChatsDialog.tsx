import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { api } from '@/shared/api';
import { Button, DialogFrame, Spinner } from '@/shared/ui';
import type { ArchivedSessionListItem } from '@/shared/types';

type ClosedChatsDialogProps = {
  onDismiss: () => void;
};

/**
 * The sessions home's Closed list: every chat put away by Close or by the sleeping-chat auto-close, newest first, each
 * with a Reopen. The same two routes the sidebar's Closed filter reads (`getArchivedSessions`, `restoreSession`); a
 * reopened chat drops out of this list here, and the board puts it back on its own when the server's
 * `session_archive_changed` lands. Mounted only while open, so each opening reads the list fresh.
 */
export function ClosedChatsDialog({ onDismiss }: ClosedChatsDialogProps) {
  const { t } = useTranslation(['sidebar', 'common']);
  const [chats, setChats] = useState<ArchivedSessionListItem[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [reopening, setReopening] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const response = await api.getArchivedSessions();
        if (!response.ok) throw new Error(String(response.status));
        const payload = (await response.json()) as { data?: { sessions?: ArchivedSessionListItem[] } };
        const sessions = Array.isArray(payload.data?.sessions) ? payload.data.sessions : [];
        const when = (chat: ArchivedSessionListItem) => Date.parse(chat.lastActivity ?? chat.updatedAt ?? chat.createdAt ?? '') || 0;
        if (live) setChats([...sessions].sort((a, b) => when(b) - when(a)));
      } catch {
        if (live) setFailed(true);
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  const reopen = useCallback(async (sessionId: string) => {
    setReopening(sessionId);
    try {
      const response = await api.restoreSession(sessionId);
      if (!response.ok) throw new Error(String(response.status));
      setChats((current) => (current ?? []).filter((chat) => chat.sessionId !== sessionId));
    } catch {
      alert(t('messages.reopenSessionFailed', 'Failed to reopen session. Please try again.'));
    } finally {
      setReopening(null);
    }
  }, [t]);

  return (
    <DialogFrame size="md" data-board-closed-dialog title={t('archived.title', 'Closed')} onDismiss={onDismiss}>
      {failed ? (
        <p className="text-sm text-muted-foreground">{t('messages.reopenSessionError', 'Error reopening session. Please try again.')}</p>
      ) : chats === null ? (
        <div className="flex justify-center py-6"><Spinner /></div>
      ) : chats.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('archived.emptyTitle', 'Nothing closed')}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {chats.map((chat) => (
            <li key={chat.sessionId} data-board-closed-chat className="flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-muted/50">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm text-foreground">{chat.sessionTitle}</div>
                <div className="truncate text-xs text-muted-foreground">{chat.projectDisplayName}</div>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="finger:h-11"
                disabled={reopening !== null}
                onClick={() => void reopen(chat.sessionId)}
              >
                {t('archived.reopen', 'Reopen')}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </DialogFrame>
  );
}
