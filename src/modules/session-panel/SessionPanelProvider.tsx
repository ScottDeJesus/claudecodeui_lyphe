import { useCallback, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import { useFollowups } from '@/modules/followups';
import { SessionPanelContext, type SessionPanelValue } from '@/modules/session-panel/context/sessionPanelContext';
import { useSessionPanelVersions } from '@/modules/session-panel/hooks/useSessionPanelVersions';
import { useSetUiPreference, useUiPreferences } from '@/shared/context/UiPreferencesContext';
import type { SessionPanelVersionHead } from '@/shared/types';

const NO_VERSIONS: readonly SessionPanelVersionHead[] = [];

/**
 * THE PANEL OF THE CHAT ON SCREEN, read once and handed to the places that draw a part of it: the panel in the talk's place
 * (`SessionPanelLayout`), its switch in the chat's head (`SessionPanelSwitch`), the marks in the talk (`SessionPanelMark`), the
 * follow-ups' own switch beside the panel's (`SessionFollowupsSwitch`) and the follow-ups in the chat's side column
 * (`SessionFollowups`). It reads the chat's versions and its follow-ups, and holds what the reader is doing with them: which
 * version they walked back to, whether the talk or the panel is in front, and whether the follow-ups are on show.
 *
 * `sessionId` is the chat's app session id, or null where no panel is drawn (no chat begun, the chat floating, another view on
 * screen): nothing is read and every part draws nothing.
 *
 * THE FOLLOW-UPS ARE NEVER ON THE PANEL: they have a switch of their own. `followupsApart` says the page keeps a place for them
 * beside the talk (the chat's side column at a desk): the switch then shows and hides them there, and the choice is remembered
 * (the `showChatFollowups` preference). Where the page keeps none, the switch opens them as a window over the chat, which is
 * shut again on the way to another chat.
 *
 * Mounted by project-workspace's `WorkspaceMain`, over the chat's head and its pane.
 */
export function SessionPanelProvider({ sessionId, followupsApart = false, children }: { sessionId: string | null; followupsApart?: boolean; children: ReactNode }) {
  const read = useSessionPanelVersions(sessionId);
  const followups = useFollowups(sessionId);
  const versions = read ?? NO_VERSIONS;

  // The version the reader walked back to, with the chat it belongs to; null while they follow the newest. Tagged so a
  // version picked in one chat is forgotten on the way to another.
  const [picked, setPicked] = useState<{ sessionId: string; id: number } | null>(null);
  // The chat whose panel is in front; any other chat shows its talk. Tagged for the same reason.
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

  const form: SessionPanelValue['form'] = sessionId === null || read === null || newest === null ? 'none' : 'shown';

  // In their column the follow-ups are shown until the reader puts them away, and that is remembered. As a window they are open
  // only in the chat they were opened in. Tagged, as the two above are.
  const { showChatFollowups } = useUiPreferences();
  const setPreference = useSetUiPreference();
  const [windowFor, setWindowFor] = useState<string | null>(null);
  const followupsOpen = followupsApart ? showChatFollowups : sessionId !== null && windowFor === sessionId;
  const setFollowupsOpen = useCallback((open: boolean) => {
    if (followupsApart) setPreference('showChatFollowups', open);
    else setWindowFor(open ? sessionId : null);
  }, [followupsApart, sessionId, setPreference]);

  const value = useMemo<SessionPanelValue>(() => ({
    versions,
    viewing,
    onLatest: viewing === newest,
    lookAt,
    followups,
    form,
    followupsApart,
    followupsOpen,
    setFollowupsOpen,
    view: form !== 'none' && panelFront !== null && panelFront === sessionId ? 'panel' : 'talk',
    setView,
  }), [versions, viewing, newest, lookAt, followups, form, followupsApart, followupsOpen, setFollowupsOpen, panelFront, sessionId, setView]);

  return <SessionPanelContext.Provider value={value}>{children}</SessionPanelContext.Provider>;
}
