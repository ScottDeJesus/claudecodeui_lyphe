import { useCallback, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import { useFollowups } from '@/modules/followups';
import { SessionPanelContext, type SessionPanelValue } from '@/modules/session-panel/context/sessionPanelContext';
import { useSessionPanelVersions } from '@/modules/session-panel/hooks/useSessionPanelVersions';
import type { SessionPanelVersionHead } from '@/shared/types';

const NO_VERSIONS: readonly SessionPanelVersionHead[] = [];

/**
 * THE PANEL OF THE CHAT ON SCREEN, read once and handed to the three places that draw a part of it: the panel beside the talk
 * (`SessionPanelLayout`), its switch in the chat's head (`SessionPanelSwitch`) and the marks in the talk (`SessionPanelMark`).
 * It reads the chat's versions and its follow-ups, and holds what the reader is doing with them: which version they walked back
 * to, and on a narrow screen whether the talk or the panel is in front.
 *
 * `sessionId` is the chat's app session id, or null where no panel is drawn (no chat begun, the chat floating, another view on
 * screen): nothing is read and every part draws nothing.
 *
 * Mounted by project-workspace's `WorkspaceMain`, over the chat's head and its pane.
 */
export function SessionPanelProvider({ sessionId, children }: { sessionId: string | null; children: ReactNode }) {
  const read = useSessionPanelVersions(sessionId);
  const followups = useFollowups(sessionId);
  const versions = read ?? NO_VERSIONS;

  // The version the reader walked back to, with the chat it belongs to; null while they follow the newest. Tagged so a
  // version picked in one chat is forgotten on the way to another.
  const [picked, setPicked] = useState<{ sessionId: string; id: number } | null>(null);
  // On a narrow screen, the chat whose panel is in front; any other chat shows its talk. Tagged for the same reason.
  const [panelFront, setPanelFront] = useState<string | null>(null);

  const newest = versions.length === 0 ? null : versions[versions.length - 1];
  const pickedHere = picked !== null && picked.sessionId === sessionId ? versions.find((version) => version.id === picked.id) : undefined;
  const viewing = pickedHere ?? newest;

  const setView = useCallback((view: 'talk' | 'panel') => {
    setPanelFront(view === 'panel' ? sessionId : null);
  }, [sessionId]);

  const lookAt = useCallback((id: number | null) => {
    setPicked(id === null || sessionId === null ? null : { sessionId, id });
    if (id !== null) setPanelFront(sessionId);
  }, [sessionId]);

  const hasFollowups = (followups.items?.length ?? 0) > 0;
  // Until the versions have been read there is no telling which form the panel takes, so none is drawn: follow-ups that arrive
  // first must not stand as a narrow column for a moment and then widen under the reader.
  const form: SessionPanelValue['form'] = sessionId === null || read === null ? 'none' : newest !== null ? 'wide' : hasFollowups ? 'side' : 'none';

  const value = useMemo<SessionPanelValue>(() => ({
    versions,
    viewing,
    onLatest: viewing === newest,
    lookAt,
    followups,
    form,
    view: form !== 'none' && panelFront !== null && panelFront === sessionId ? 'panel' : 'talk',
    setView,
  }), [versions, viewing, newest, lookAt, followups, form, panelFront, sessionId, setView]);

  return <SessionPanelContext.Provider value={value}>{children}</SessionPanelContext.Provider>;
}
