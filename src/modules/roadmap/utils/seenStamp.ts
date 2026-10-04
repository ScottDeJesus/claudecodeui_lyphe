import { isLater, seenStampOf } from '@/modules/roadmap/utils/celebrationMoments';
import { api } from '@/shared/api';
import { readUserPreference, writeUserPreferenceEntries } from '@/shared/userSettings';

// The user's seen stamp for each roadmap (`roadmapSeen`): the last completion that played for them. The
// preference mirror in the browser is hydrated ONCE, at sign-in, so a page signed in hours ago holds the
// stamp as it stood then, while a phone or another tab may have moved it since. Reading or moving the
// stamp off the mirror alone would replay what the other device played, or write it backward over the
// other device's newer one (the entry patch replaces and does not compare). So both reads here ask the
// SERVER's copy too and take the newer. Used by `hooks/useCelebrations.ts`.

/** `newer(a, b)`: the later of two stamps, either of which may be absent. */
function newer(first: string | null, second: string | null): string | null {
  if (first === null || second === null) return first ?? second;
  return isLater(second, first) ? second : first;
}

/** The stamp the server holds for `roadmapName`, or `null` when it has none or cannot be asked (the mirror then stands alone). */
async function serverStamp(roadmapName: string): Promise<string | null> {
  try {
    const response = await api.user.preferences();
    if (!response.ok) return null;
    const payload = (await response.json()) as { preferences?: { roadmapSeen?: unknown } };
    return seenStampOf(payload.preferences?.roadmapSeen, roadmapName);
  } catch (error) {
    console.warn('[roadmap] the server\'s seen stamp could not be read; this device\'s copy stands', error);
    return null;
  }
}

/** The stamp to measure a return against: the newer of this device's copy and the server's, or `null` when neither has one (a first visit). */
export async function currentSeenStamp(roadmapName: string): Promise<string | null> {
  return newer(seenStampOf(readUserPreference<unknown>('roadmapSeen', null), roadmapName), await serverStamp(roadmapName));
}

// Stamp writes run one after another: each reads the stamp before it writes, so two in flight at once
// could land the older `at` last.
let writes: Promise<void> = Promise.resolve();

/**
 * Moves the roadmap's stamp to `at`, never backward: it writes only when `at` is later than the newer of
 * this device's copy and the server's, read at that moment.
 */
export function rememberSeen(roadmapName: string, at: string): void {
  if (Number.isNaN(Date.parse(at))) return;
  writes = writes
    .then(async () => {
      const stamp = await currentSeenStamp(roadmapName);
      if (stamp !== null && !isLater(at, stamp)) return;
      writeUserPreferenceEntries('roadmapSeen', { seen: { [roadmapName]: { name: roadmapName, at } } });
    })
    .catch((error) => console.warn(`[roadmap] the seen stamp for ${roadmapName} could not be moved to ${at}`, error));
}
