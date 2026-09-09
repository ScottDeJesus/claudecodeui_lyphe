import { useSyncExternalStore } from 'react';

import {
  readUserPreference,
  subscribeToUserPreferences,
  writeUserPreference,
} from '@/shared/userSettings';

/**
 * The reading size of the chat transcript, in px, as the person reading it chose.
 *
 * A number, so it cannot live in `uiPreferences` — that store parses every value it holds as
 * a boolean. It follows `useSimpleChatListPreferences`: its own key in the preference store,
 * which means the size follows the user from their laptop to their phone.
 */

/** Small enough to fit a long reply on a laptop, large enough to read a serif at arm's length. */
export const CHAT_FONT_SIZE_MIN = 13;
export const CHAT_FONT_SIZE_MAX = 22;
/** 16px — the browser's own reading size, and what the transcript rendered at before this. */
export const CHAT_FONT_SIZE_DEFAULT = 16;

/** A stored size can be anything a hand-edited preference blob holds; this is the gate. */
export const clampChatFontSize = (value: unknown): number => {
  const size = typeof value === 'number' ? Math.round(value) : Number.NaN;
  if (!Number.isFinite(size)) return CHAT_FONT_SIZE_DEFAULT;
  return Math.min(CHAT_FONT_SIZE_MAX, Math.max(CHAT_FONT_SIZE_MIN, size));
};

export type ChatFontSizeControls = {
  size: number;
  setSize: (next: number) => void;
  increase: () => void;
  decrease: () => void;
  canIncrease: boolean;
  canDecrease: boolean;
};

/** Read by the transcript (which paints at this size) and by the Appearance settings stepper. */
export function useChatFontSize(): ChatFontSizeControls {
  const stored = useSyncExternalStore(
    subscribeToUserPreferences,
    () => readUserPreference<number>('chatFontSize', CHAT_FONT_SIZE_DEFAULT),
  );
  const size = clampChatFontSize(stored);

  const setSize = (next: number) => writeUserPreference('chatFontSize', clampChatFontSize(next));

  return {
    size,
    setSize,
    increase: () => setSize(size + 1),
    decrease: () => setSize(size - 1),
    canIncrease: size < CHAT_FONT_SIZE_MAX,
    canDecrease: size > CHAT_FONT_SIZE_MIN,
  };
}
