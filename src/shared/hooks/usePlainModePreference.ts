import { useSyncExternalStore } from 'react';

import {
  readUserPreference,
  subscribeToUserPreferences,
  writeUserPreference,
} from '@/shared/userSettings';

/** The slash command every message is sent under while plain mode is on. */
export const PLAIN_MODE_COMMAND = '/plain';

export type PlainModePreference = {
  enabled: boolean;
  setEnabled: (next: boolean) => void;
};

/**
 * The one reader of `plainMode` in `src/`. The composer chip toggles it and
 * the send path reads it to prefix the outgoing text with `/plain`, so the
 * assistant re-applies the plain response style on every turn instead of
 * once per session.
 */
export function usePlainModePreference(): PlainModePreference {
  const enabled = useSyncExternalStore(
    subscribeToUserPreferences,
    () => readUserPreference('plainMode', false),
  );

  return {
    enabled,
    setEnabled: (next: boolean) => writeUserPreference('plainMode', next),
  };
}

/**
 * The text that actually goes to the CLI. A message that is already a slash
 * command is left alone: wrapping `/git` in `/plain` would turn a command into
 * an argument and silently not run it.
 */
export function applyPlainMode(content: string, enabled: boolean): string {
  if (!enabled) return content;
  const trimmed = content.trimStart();
  if (!trimmed || trimmed.startsWith('/')) return content;
  return `${PLAIN_MODE_COMMAND} ${content}`;
}
