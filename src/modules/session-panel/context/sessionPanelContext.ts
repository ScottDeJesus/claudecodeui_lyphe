import { useContext } from 'react';

import type { useFollowups } from '@/modules/followups';
import { createStableContext } from '@/shared/context/stableContext';
import type { SessionPanelVersionHead } from '@/shared/types';

/**
 * What the chat's panel is, for the places that draw a part of it: the panel in the talk's place, its switch in the chat's head,
 * the marks in the talk where the chat put a thing there, and the follow-ups in the chat's side column.
 */
export type SessionPanelValue = {
  /** The chat's versions, oldest first; empty while the panel shows nothing or has not been read. */
  versions: readonly SessionPanelVersionHead[];
  /** The version on show: the one the reader walked back to, else the newest. Null while the panel shows nothing. */
  viewing: SessionPanelVersionHead | null;
  /** Whether the reader is on the newest version. */
  onLatest: boolean;
  /** Goes to a version by its id, or to the newest for null; a version asked for by its id brings the panel in front too. */
  lookAt: (id: number | null) => void;
  /** The chat's follow-ups (its next steps and known gaps), the one reading the panel's edge and the switch's count share. */
  followups: ReturnType<typeof useFollowups>;
  /**
   * What the panel has to show: `none` (no panel is drawn), `followups` (the chat's follow-ups alone) or `shown` (a thing the chat
   * put there, with the follow-ups on its edge). Follow-ups drawn apart from the panel never make one: with them alone it is `none`.
   */
  form: 'none' | 'followups' | 'shown';
  /**
   * Whether the chat's follow-ups are drawn apart from the panel: at a desk they stand in the chat's side column, under its core
   * (`SessionFollowups`), so the panel leaves them out and its switch does not count them.
   */
  followupsApart: boolean;
  /** Which of the two is in front: the talk, or the panel in its place. */
  view: 'talk' | 'panel';
  setView: (view: 'talk' | 'panel') => void;
};

/** Null outside a provider: the floating chat and an exported transcript have no panel, and each part then draws nothing. */
export const SessionPanelContext = createStableContext<SessionPanelValue | null>(import.meta.hot, 'SessionPanelContext', null);

/** The panel of the chat on screen, or null where there is none to speak of (no provider over this part of the page). Read by the module's own parts. */
export function useSessionPanel(): SessionPanelValue | null {
  return useContext(SessionPanelContext);
}
