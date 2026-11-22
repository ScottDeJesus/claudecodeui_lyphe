import { useMemo, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { RND_ALL_TOPIC, useLiveTopic } from '@/modules/live-bus';
import type { RndPicture } from '@/shared/rnd-types';
import type { PlaceMark } from '@/shared/types';

/** Where the moment he last stood on the R&D place is kept, in this browser. */
const SEEN_KEY = 'rnd.lastSeenAt';

const listeners = new Set<() => void>();

/**
 * The stamp, or null when he has never stood there. A browser that refuses storage (a private window's SecurityError) has no
 * stamp to read, which is the same as never having stood there: everything filed reads as new, never as an error.
 */
function readSeen(): string | null {
  try {
    return window.localStorage.getItem(SEEN_KEY);
  } catch (error) {
    if (error instanceof DOMException) return null;
    throw error;
  }
}

/** Stamps now as the moment he last stood on the place. Called by RndPanel while it is shown, at each new picture. */
export function stampRndSeen(): void {
  try {
    window.localStorage.setItem(SEEN_KEY, new Date().toISOString());
  } catch (error) {
    if (!(error instanceof DOMException)) throw error;
    console.warn('[rnd] the moment the place was seen could not be kept:', error);
    return;
  }
  listeners.forEach((listener) => listener());
}

/** Told by this tab's own stamp, and by another tab's through the storage event. */
function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === SEEN_KEY) listener();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

/**
 * A stamp as a moment. The store writes UTC, with or without its zone and sometimes with a space for the T; read without its zone,
 * JavaScript would take it as local time and move it by the box's offset.
 */
function instantOf(stamp: string): number {
  const iso = stamp.includes('T') ? stamp : stamp.replace(' ', 'T');
  const zoned = /(?:Z|[+-]\d{2}:?\d{2})$/.test(iso) ? iso : iso + 'Z';
  return Date.parse(zoned);
}

/**
 * THE PLACE'S MARK ON THE WHEEL: lit while a candidate is proved (a yes waits for his Adopt), or one was filed after he last stood
 * there; null otherwise. Read by project-workspace's PlacesProvider.
 */
export function useRndMark(): PlaceMark | null {
  const { t } = useTranslation();
  const topic = useLiveTopic<RndPicture>(RND_ALL_TOPIC);
  const seen = useSyncExternalStore(subscribe, readSeen);
  const picture = topic?.payload ?? null;
  return useMemo(() => {
    if (picture === null) return null;
    const seenAt = seen === null ? Number.NEGATIVE_INFINITY : instantOf(seen);
    const count = picture.candidates.filter((candidate) => candidate.word === 'proved' || instantOf(candidate.filed_at) > seenAt).length;
    return count === 0 ? null : { kind: 'owed', words: t('rnd.mark', { count }) };
  }, [picture, seen, t]);
}
