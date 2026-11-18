import { useMemo, useSyncExternalStore } from 'react';

import { isLater } from '@/modules/roadmap/utils/celebrationMoments';
import type { RoadmapFeature } from '@/shared/roadmap-types';
import { readUserPreference, subscribeToUserPreferences, writeUserPreferenceEntries } from '@/shared/userSettings';

// WHAT IS FINISHED STAYS ON THE RING UNTIL IT IS DISMISSED. The roadmap's picture keeps every shipped feature for
// ever, so "finished and not dismissed" needs two things of the operator's own, both kept in the `roadmapSeen`
// preference beside the seen stamp, each a list written by entry patch (so a dismissal made on the phone is not
// erased by the desktop's older copy, and neither stamp is ever rewound: the key is forward-only):
//
// - `ringFrom`, per roadmap `{ name, at }`: what shipped at or before `at` is off the ring. It is where the ring
//   starts counting, set once from the seen stamp on a first visit (so the ring does not open on every feature the
//   roadmap ever shipped), and moved forward by dismissals.
// - `ringDismissed`, per feature `{ name, at }`: this feature's finish at `at` was dismissed. A feature that ships
//   again later carries a later `shipped_at` and stands on the ring again.
//
// A DISMISSAL TIDIES AFTER ITSELF. Once everything older than the oldest finish still standing has been dismissed,
// `ringFrom` moves up to just under that finish and the dismissals it now covers are dropped, so the list holds only
// the dismissals that sit among finishes still standing and never nears the entry cap.

type Stamp = { name: string; at: string };

const isStamp = (value: unknown): value is Stamp => (
  value !== null && typeof value === 'object'
  && typeof (value as Stamp).name === 'string'
  && typeof (value as Stamp).at === 'string' && !Number.isNaN(Date.parse((value as Stamp).at))
);

/** One of the document's two lists, by name. */
function stampsOf(document: unknown, list: 'ringFrom' | 'ringDismissed'): Map<string, string> {
  const held = document !== null && typeof document === 'object' ? (document as Record<string, unknown>)[list] : undefined;
  return new Map((Array.isArray(held) ? held : []).filter(isStamp).map((entry) => [entry.name, entry.at] as const));
}

const readDocument = () => readUserPreference<unknown>('roadmapSeen', null);

/** What the operator has put off the ring: where a roadmap's ring starts counting (`null` before a first visit set it), and each dismissed finish by feature. */
export type RingFinished = { from: string | null; dismissed: ReadonlyMap<string, string> };

/** Whether a shipped feature stands on the ring: it shipped after the ring started counting and that finish has not been dismissed. */
export function standsFinished(feature: RoadmapFeature, held: RingFinished): boolean {
  if (feature.word !== 'shipped' || feature.shipped_at === null || held.from === null) return false;
  if (!isLater(feature.shipped_at, held.from)) return false;
  const dismissed = held.dismissed.get(feature.name);
  return dismissed === undefined || isLater(feature.shipped_at, dismissed);
}

/**
 * The operator's ring record for one roadmap, re-read when the preference changes (a dismissal here, or a sign-in's hydrate).
 * Used by `stack/StackOf`, which lays the ring out from it.
 */
export function useRingFinished(roadmapName: string): RingFinished {
  // The stored document keeps one identity between writes, which is what `useSyncExternalStore` compares.
  const document = useSyncExternalStore(subscribeToUserPreferences, readDocument, readDocument);
  return useMemo(() => ({
    from: stampsOf(document, 'ringFrom').get(roadmapName) ?? null,
    dismissed: stampsOf(document, 'ringDismissed'),
  }), [document, roadmapName]);
}

/** A first visit: the ring starts counting from `at`. Never moves an existing start back (the key is forward-only). */
export function startRingFrom(roadmapName: string, at: string): void {
  if (Number.isNaN(Date.parse(at))) return;
  writeUserPreferenceEntries('roadmapSeen', { ringFrom: { [roadmapName]: { name: roadmapName, at } } });
}

/**
 * Dismisses one finished feature off the ring, and tidies: `features` is every feature of the roadmap, read to find
 * what still stands. Used by `stack/StackAct`'s Dismiss.
 */
export function dismissFinished(roadmapName: string, feature: RoadmapFeature, features: readonly RoadmapFeature[]): void {
  if (feature.shipped_at === null) return;
  const document = readDocument();
  const from = stampsOf(document, 'ringFrom').get(roadmapName) ?? null;
  const dismissed = new Map(stampsOf(document, 'ringDismissed')).set(feature.name, feature.shipped_at);
  const after: RingFinished = { from, dismissed };
  const standing = features.filter((item) => standsFinished(item, after)).map((item) => Date.parse(item.shipped_at ?? ''));
  const shipped = features.filter((item) => item.shipped_at !== null).map((item) => Date.parse(item.shipped_at ?? '')).filter((at) => !Number.isNaN(at));
  // Just under the oldest finish still standing; with none standing, the newest finish there is.
  const upTo = standing.length > 0 ? Math.min(...standing) - 1000 : Math.max(...shipped);
  const moves = Number.isFinite(upTo) && (from === null || upTo > Date.parse(from));
  const patch: Record<string, Stamp | null> = { [feature.name]: { name: feature.name, at: feature.shipped_at } };
  if (moves) {
    // What the new start covers needs no entry of its own. Only this roadmap's features are read: the list holds every roadmap's.
    for (const item of features) {
      if (dismissed.has(item.name) && item.shipped_at !== null && Date.parse(item.shipped_at) <= upTo) patch[item.name] = null;
    }
  }
  writeUserPreferenceEntries('roadmapSeen', {
    ...(moves ? { ringFrom: { [roadmapName]: { name: roadmapName, at: new Date(upTo).toISOString() } } } : {}),
    ringDismissed: patch,
  });
}
