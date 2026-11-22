import { useSyncExternalStore } from 'react';
import { RND_ALL_TOPIC, useLiveTopic } from '@/modules/live-bus';
import type { RndPicture } from '@/shared/rnd-types';

/**
 * THE FEED'S TWO FACTS BESIDE THE PICTURE. The picture itself is on the live bus (RND_ALL_TOPIC, published by RndFeed); what the
 * bus cannot hold is the sentence the last read of GET /api/rnd failed with, and the feed's own read, which Try again runs. Both
 * are kept here, once for the app, because RndFeed is mounted once (App.tsx) and the panel is mounted only while it is shown.
 */
let failure: string | null = null;
let reread: (() => void) | null = null;
const listeners = new Set<() => void>();

/** Said by RndFeed: the sentence its read failed with, or null once a read or a frame has answered. */
export function sayFeedFailure(next: string | null): void {
  if (next === failure) return;
  failure = next;
  listeners.forEach((listener) => listener());
}

/** Registered by RndFeed while it is mounted: the read Try again runs. Answers the unregister. */
export function registerReread(seed: () => void): () => void {
  reread = seed;
  return () => {
    if (reread === seed) reread = null;
  };
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const readFailure = (): string | null => failure;
const retry = (): void => reread?.();

/**
 * The R&D picture the feed holds (null until the first read lands), the sentence a failed read answered with (null while reads
 * answer), and Try again. Read by RndPanel.
 */
export function useRnd(): { picture: RndPicture | null; failure: string | null; retry: () => void } {
  const topic = useLiveTopic<RndPicture>(RND_ALL_TOPIC);
  const said = useSyncExternalStore(subscribe, readFailure);
  return { picture: topic?.payload ?? null, failure: said, retry };
}
