import { useCallback, useEffect, useState } from 'react';

import type { LLMProvider, PermissionMode } from '@/shared/types';
import {
  readUserPreference,
  subscribeToUserPreferences,
  writeUserPreferences,
} from '@/shared/userSettings';

/**
 * The server-synced blob holding one provider's permission settings. Only the
 * edit mode is read here; the rest belongs to Settings and is written back
 * untouched so the two surfaces cannot overwrite each other.
 */
type ProviderPermissionsPreference = Record<string, unknown> & { permissionMode?: PermissionMode };

/** The one preference key the composer and Settings both keep the edit mode in. */
const permissionsPreferenceKey = (provider: LLMProvider) => `${provider}Permissions` as const;

/**
 * Keys the previous build wrote — one per provider plus one per session, none of
 * which any code reads any more. Swept once per load rather than left to rot,
 * because "no reader" is not the same as "gone" for the person whose browser
 * still holds a key per conversation they ever opened.
 */
function sweepRetiredModeKeys(): void {
  try {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('permissionMode-')) localStorage.removeItem(key);
    }
  } catch {
    // A blocked or full localStorage costs a cleanup, never a working app.
  }
}

/**
 * How edits happen for the active provider — the ONE store, read live.
 *
 * Used by chat's useChatProviderState, which hands the value to the composer
 * chip and sends it with the next turn.
 *
 * It SUBSCRIBES rather than reading once: Settings writes the same preference,
 * and a composer holding a stale mode would send the next turn under a rule the
 * user believes they changed. That is the whole promise of one store, and a
 * reload is not an acceptable price for it.
 */
export function useProviderPermissionMode(
  provider: LLMProvider,
  getPermissionModesForProvider: (provider: LLMProvider) => PermissionMode[],
  getDefaultPermissionModeForProvider: (provider: LLMProvider) => PermissionMode,
) {
  // The mode the next turn runs under. Held as state rather than read during
  // render because it has to survive a re-render caused by anything else, and
  // because the store notifies imperatively.
  const [permissionMode, setPermissionMode] = useState<PermissionMode>('default');

  useEffect(() => {
    const adopt = () => {
      const validModes = getPermissionModesForProvider(provider);
      const storedMode = readUserPreference<ProviderPermissionsPreference>(
        permissionsPreferenceKey(provider),
        {},
      ).permissionMode;
      setPermissionMode(
        storedMode && validModes.includes(storedMode)
          ? storedMode
          : getDefaultPermissionModeForProvider(provider),
      );
    };

    adopt();
    // One subscription covers a write from Settings in this tab, a write from
    // this composer, and a copy hydrated from the server — the store notifies
    // synchronously in the writing tab too.
    return subscribeToUserPreferences(adopt);
  }, [provider, getDefaultPermissionModeForProvider, getPermissionModesForProvider]);

  useEffect(sweepRetiredModeKeys, []);

  const selectPermissionMode = useCallback((nextMode: PermissionMode) => {
    setPermissionMode(nextMode);

    // Merged into the blob rather than replacing it: Settings owns the other
    // fields under this key and writes the whole object back when it saves.
    const key = permissionsPreferenceKey(provider);
    writeUserPreferences({
      [key]: {
        ...readUserPreference<ProviderPermissionsPreference>(key, {}),
        permissionMode: nextMode,
      },
    });
  }, [provider]);

  const cyclePermissionMode = useCallback(() => {
    const modes = getPermissionModesForProvider(provider);
    const nextIndex = (modes.indexOf(permissionMode) + 1) % modes.length;
    selectPermissionMode(modes[nextIndex]);
  }, [permissionMode, provider, getPermissionModesForProvider, selectPermissionMode]);

  return { permissionMode, selectPermissionMode, cyclePermissionMode };
}
