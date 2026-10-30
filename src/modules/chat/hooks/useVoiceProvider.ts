import { useSyncExternalStore } from 'react';

import { api } from '@/shared/api';
import { AUTH_TOKEN_REFRESHED_EVENT } from '@/shared/authToken';
import type { VoiceProvider } from '@/shared/types';
import { VOICE_CONFIG_SYNC_EVENT } from '@/shared/voiceConfig';

// The account's provider as the server last answered it, shared by every caller on the page. A module value rather than
// per-caller state because each message row mounts a caller and they must all agree on one answer from one request.
// 'openai' (today's behavior) until a read answers; a read that fails leaves the last answer as it was.
let currentProvider: VoiceProvider = 'openai';
// Set by the first caller to subscribe, never cleared: the page asks once on its own, then on the sync event and when it is returned to.
let firstReadStarted = false;
// True while a GET is on the wire, so reads run one at a time and never answer out of order.
let reading = false;
// When the last read began. Reads asked for sooner than MIN_READ_GAP_MS after it wait out the gap, so an event fired on
// every keystroke (the voice fields do) costs a few reads, not one per key.
let lastReadStartedAt = 0;
// The one read waiting out that gap; it reads the newest state, so a request that finds it pending has nothing to add.
let pendingReadTimer: number | null = null;
// Set by a read requested while another was out: that answer may predate the change that asked, so one more read follows it.
let readAgain = false;
// The mounted callers' re-render callbacks, called when the provider changes.
const listeners = new Set<() => void>();

/** The least time between the starts of two reads. */
const MIN_READ_GAP_MS = 400;

/** The provider in the settings answer, or null when the body is not one (a restart's `{ success: false }` envelope parses too). */
function providerOf(body: unknown): VoiceProvider | null {
  if (typeof body !== 'object' || body === null) return null;
  const settings = (body as { settings?: unknown }).settings;
  if (typeof settings !== 'object' || settings === null) return null;
  const provider = (settings as { provider?: unknown }).provider;
  return provider === 'openai' || provider === 'gemini' ? provider : null;
}

/** One GET of the account's provider; null when it could not be read. */
async function fetchProvider(): Promise<VoiceProvider | null> {
  try {
    const response = await api.voice.settings();
    return response.ok ? providerOf(await response.json()) : null;
  } catch {
    return null;
  }
}

/**
 * Reads the provider and tells the callers if it changed. A read asked for while one is out is run after it, once. A read
 * that fails changes nothing: the page returning from sleep asks while the network is still down, and a mic that drew a
 * moment ago must not vanish because that one answer never came.
 */
async function readProvider(): Promise<void> {
  if (reading) {
    readAgain = true;
    return;
  }
  reading = true;
  try {
    do {
      readAgain = false;
      lastReadStartedAt = Date.now();
      const answered = await fetchProvider();
      const next = answered ?? currentProvider;
      if (next !== currentProvider) {
        currentProvider = next;
        listeners.forEach((notify) => notify());
      }
    } while (readAgain);
  } finally {
    reading = false;
  }
}

/** Asks for a read now, or, inside the gap after the last one, for one when the gap ends (a second ask in the gap adds nothing). */
function requestRead(): void {
  if (pendingReadTimer !== null) return;
  const wait = lastReadStartedAt + MIN_READ_GAP_MS - Date.now();
  if (wait <= 0) {
    void readProvider();
    return;
  }
  pendingReadTimer = window.setTimeout(() => {
    pendingReadTimer = null;
    void readProvider();
  }, wait);
}

/**
 * The page's single listener for the sync event that Settings dispatches after a provider change, and that the voice
 * fields dispatch on every edit: a typing burst is at most one read per MIN_READ_GAP_MS.
 */
function onVoiceConfigSync(): void {
  requestRead();
}

/**
 * The events after which an earlier read may have failed or may be old: the page coming back into view (a tab left behind
 * for an hour, a laptop woken), the window taking focus, the network returning, and a sign-in (`AUTH_TOKEN_REFRESHED_EVENT`,
 * which a refresh raises too; another account's provider is not this one's). One return raises several of them at once, so
 * a read is asked for only when none began inside the gap: that read has seen the newest state. A read that began EARLIER and
 * is still out may have gone out while the network was down, so the return is not dropped: `readProvider` runs one more
 * after it, once.
 */
function onPageReturn(): void {
  if (document.visibilityState !== 'visible' || pendingReadTimer !== null) return;
  if (Date.now() - lastReadStartedAt < MIN_READ_GAP_MS) return;
  void readProvider();
}

/** Adds or removes the page-return listeners, with the sync one: they live as long as a caller is mounted. */
function listenForReturn(on: boolean): void {
  const returns: ReadonlyArray<readonly [EventTarget, string]> = [
    [document, 'visibilitychange'],
    [window, 'focus'],
    [window, 'online'],
    [window, AUTH_TOKEN_REFRESHED_EVENT],
  ];
  for (const [target, type] of returns) {
    if (on) target.addEventListener(type, onPageReturn);
    else target.removeEventListener(type, onPageReturn);
  }
}

function subscribe(notify: () => void): () => void {
  listeners.add(notify);
  if (listeners.size === 1) {
    window.addEventListener(VOICE_CONFIG_SYNC_EVENT, onVoiceConfigSync);
    listenForReturn(true);
  }
  if (!firstReadStarted) {
    firstReadStarted = true;
    void readProvider();
  }
  return () => {
    listeners.delete(notify);
    if (listeners.size === 0) {
      window.removeEventListener(VOICE_CONFIG_SYNC_EVENT, onVoiceConfigSync);
      listenForReturn(false);
      if (pendingReadTimer !== null) {
        window.clearTimeout(pendingReadTimer);
        pendingReadTimer = null;
      }
    }
  };
}

/** For a caller that needs no re-render: `useVoiceProvider(false)` subscribes to nothing, so it asks the server nothing. */
const subscribeToNothing = (): (() => void) => () => {};

const readCurrentProvider = (): VoiceProvider => currentProvider;

/**
 * Which speech-to-text backend the account's chat mic uses: the server-side setting behind Settings > Voice's picker.
 * Used by the chat module's `useVoiceAvailable`, which draws the composer's mic whenever voice input is on when it says
 * 'gemini'.
 *
 * `active` says whether this caller needs the answer. One `GET /api/voice/settings` per page serves every active
 * caller, made by the first to mount and asked again when `VOICE_CONFIG_SYNC_EVENT` fires (Settings does after a
 * provider change, so an open composer follows the picker in the same tab) and when the page is returned to: it
 * becomes visible, takes focus, comes back online or signs in (`onPageReturn`). An inactive caller (voice off, or
 * read-aloud, which stays on the OpenAI-compatible backend whatever the provider) subscribes to nothing, so a page with
 * no use for the answer never asks for it. The answer is 'openai' until the server has answered; a read that fails
 * leaves the last answer, and the next return reads again.
 */
export function useVoiceProvider(active: boolean): VoiceProvider {
  return useSyncExternalStore(active ? subscribe : subscribeToNothing, readCurrentProvider, () => 'openai');
}

/**
 * The provider as last read, for code that acts on it at one moment and draws nothing from it: `useVoiceInput`, which
 * sends a clip down the matching path when the recording ends. The composer's `useVoiceAvailable('dictate')` keeps the
 * answer fresh for as long as the mic is drawn.
 */
export function currentVoiceProvider(): VoiceProvider {
  return currentProvider;
}
