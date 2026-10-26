import { useSyncExternalStore } from 'react';

import { readUserPreference, subscribeToUserPreferences, writeUserPreferenceEntries } from '@/shared/userSettings';

/**
 * The folders pinned on the Files view's strip: `filesPins` is `{ pinned: string[] }`, each entry the
 * folder's absolute path, which is also its entry key. Like `dispatcher`'s lists, EVERY WRITE IS AN
 * ENTRY PATCH naming only the folder it changes, so a pin made on one device and a pin made on
 * another a minute later both stand — a write of the whole list would put back whatever the other
 * device had pinned or unpinned since.
 */

const KEY = 'filesPins' as const;

const NO_PINS: readonly string[] = [];

// The snapshot cache `useSyncExternalStore` needs: the stored list last read, and the pins read out
// of it, handed back by identity until the preference store replaces the list.
let lastRaw: unknown = undefined;
let lastPins: readonly string[] = NO_PINS;

/** The pins as stored: the string entries of `pinned`, and none when it is absent, `null`, empty or not a list. */
function readPins(): readonly string[] {
  const stored = readUserPreference<unknown>(KEY, null);
  const raw = stored !== null && typeof stored === 'object' && !Array.isArray(stored)
    ? (stored as Record<string, unknown>).pinned
    : undefined;
  if (raw === lastRaw) return lastPins;
  lastRaw = raw;
  const pins = Array.isArray(raw) ? raw.filter((entry): entry is string => typeof entry === 'string') : NO_PINS;
  lastPins = pins.length > 0 ? pins : NO_PINS;
  return lastPins;
}

/**
 * The folders pinned to the Files strip, as absolute paths in pin order. Re-renders the caller when
 * a pin is written here, or arrives with a hydrate. Exported through the file-manager barrel for the
 * project-workspace module's state provider, which matches each pin to a registered project to make
 * the strip's roots.
 */
export function useFilesPins(): readonly string[] {
  return useSyncExternalStore(subscribeToUserPreferences, readPins, readPins);
}

/** Pins a folder, by its absolute path. Used by FilesView's pin flow. */
export function pinFolder(path: string): void {
  writeUserPreferenceEntries(KEY, { pinned: { [path]: path } });
}

/** Takes a folder off the strip. Nothing on disk is touched. Used by FilesView's Unpin. */
export function unpinFolder(path: string): void {
  writeUserPreferenceEntries(KEY, { pinned: { [path]: null } });
}
