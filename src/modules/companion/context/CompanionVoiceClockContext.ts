import { useContext } from 'react';

import { createStableContext } from '@/shared/context/stableContext';
import type { CompanionSoundProgress } from '@/shared/types';

/**
 * The page's voice as a clock for the words on screen: whether this page sounds the companion's sentences at all (`active`: its
 * voice switch is on and it holds the floor), where the sounding sentence's audio has reached (`progress`, the player's own,
 * one function for the page's life) and whether a press has just cut the voice off (`cut`, the status line's Cut).
 */
export type CompanionVoiceClock = { active: boolean; cut: boolean; progress: () => CompanionSoundProgress | null };

/** Null where no provider stands (a fixture's drawing, a preview): the words then keep their own time. */
export const CompanionVoiceClockContext = createStableContext<CompanionVoiceClock | null>(import.meta.hot, 'CompanionVoiceClockContext', null);

/**
 * Used by this module's CompanionReply, which brings a sentence's words in as the voice says them. Provided by CompanionProvider.
 * Unlike `useCompanion` it does not throw without a provider: the reply is also drawn on fixtures, where it returns null.
 */
export function useCompanionVoiceClock(): CompanionVoiceClock | null {
  return useContext(CompanionVoiceClockContext);
}
