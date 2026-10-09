import { useEffect, useRef } from 'react';

import { useCliVersion } from '@/shared/hooks/useCliVersion';

/**
 * Re-reads the provider model catalog when the installed Claude CLI changes under an open tab.
 *
 * The server's Claude catalog is the CLI's own list, read once per installed version, so an update
 * changes what `GET /api/providers/claude/models` serves — but the tab asked once, at mount, and
 * never again. Measured 2026-10-08: the CLI began serving Haiku 5.5 and the server's catalog file
 * named it within seconds, while an open tab went on listing only Haiku 4.5 until the page was
 * reloaded.
 *
 * The trigger is `useCliVersion().installed`, the app's one reading of the installed CLI, which its
 * shared store already pushes to every subscriber when it moves — so this adds no poll of its own.
 * Only a move from one version string to another counts: the first reading (null to a string) is
 * the picture the mount's own fetch already matches, and a null is "not heard", never a new
 * install (the same rule as the server's `cli-version-change.ts`).
 *
 * Used by `useChatProviderState`, which owns the catalog and hands in the loader that replaces it.
 */
export function useReloadModelsOnCliChange(reload: () => void): void {
  const { installed } = useCliVersion();
  // The last version string heard. A ref, not state: it only lets the next reading tell a move from a
  // repeat, and nothing on screen depends on it, so writing it must not re-render the composer.
  const seen = useRef<string | null>(null);

  useEffect(() => {
    if (typeof installed !== 'string') return;
    const before = seen.current;
    seen.current = installed;
    if (before !== null && before !== installed) reload();
  }, [installed, reload]);
}
