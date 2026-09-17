import { api } from '@/shared/api';
import type { QueuedSendOptions } from '@/shared/types';

/**
 * Unsent composer text and queued messages, stored in `auth.db` rather than in
 * the browser.
 *
 * This is what lets a message half-typed on a laptop be finished on a phone —
 * the case the composer previously could not serve at all, because a draft only
 * existed on the machine it was typed on. As with the preference store, a
 * localStorage mirror is kept purely so a reload shows the draft on the first
 * paint instead of a blank composer that fills in a moment later.
 *
 * A scope is a session id, or `project:<projectId>` for a chat that has not
 * been sent yet and so has no session. Drafts used to be keyed by project
 * alone, which meant every session in a project shared one draft.
 *
 * THE TEXT AND THE QUEUED MESSAGE TRAVEL SEPARATELY. The server dispatcher claims and sends a
 * queued message on its own, so this browser's copy of it can be stale at any moment. A save
 * therefore carries only the part that changed here, and a hydrate adopts the server's copy of
 * every part not changed here: a keystroke must never write back a queued message that was
 * already sent, which is what sent it twice.
 */

/** A queued message as it is stored: text plus the send options it was composed under. */
export type StoredQueuedMessage = {
  /** See `QueuedDraft.id`. */
  id?: string;
  content: string;
  options?: QueuedSendOptions;
  /** Legacy image-only descriptors retained for queued draft compatibility. */
  images?: unknown[];
  /**
   * JSON-safe descriptors returned by POST /api/assets/files. Unlike browser
   * File objects, they can follow a queued message across session switches.
   */
  attachments?: unknown[];
};

/**
 * A fresh queued-message id. `crypto.getRandomValues`, not `randomUUID`: the app is reached over
 * plain HTTP on a tailnet address, which is not a secure context, and `randomUUID` does not exist
 * there.
 */
export function createQueuedMessageId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

type DraftRecord = {
  text: string;
  queuedMessage: StoredQueuedMessage | null;
};

/** Fired after any draft changes, from a local write or from a hydrate. */
export const CHAT_DRAFTS_CHANGED_EVENT = 'chat-drafts:changed';

const MIRROR_STORAGE_KEY = 'chat-drafts';

/**
 * Longer than the preference debounce: this fires on every keystroke, and a
 * draft is only ever read back on a reload or a device switch, so trading a
 * little latency for far fewer requests is the right side of the trade.
 */
const SERVER_WRITE_DEBOUNCE_MS = 1_000;

const EMPTY_DRAFT: DraftRecord = { text: '', queuedMessage: null };

type DraftPart = 'text' | 'queuedMessage';

const listeners = new Set<() => void>();

let drafts = new Map<string, DraftRecord>();
/** Per scope, the parts changed here whose save has not left the browser yet. */
const pendingParts = new Map<string, Set<DraftPart>>();
/**
 * Per scope, how many saves of each part have left but not been confirmed. A hydrate must not
 * replace such a part either: the server may simply not have it yet, or the save may be failing.
 */
const inFlightParts = new Map<string, Map<DraftPart, number>>();

/** How long a failed save first waits before it is sent again; doubled per failure, capped. */
const SAVE_RETRY_DELAY_MS = 5_000;
const SAVE_RETRY_MAX_DELAY_MS = 60_000;
/** Consecutive failed saves per scope, for the backoff; cleared by a save that lands. */
const failedSaves = new Map<string, number>();

/** Bumped on sign-out, so a retry scheduled for the previous user is dropped. */
let storeGeneration = 0;

/** A failure worth retrying: the network, the server restarting, or rate limiting — not a refusal. */
const isRetryable = (status: number | null): boolean => status === null || status >= 500 || status === 429 || status === 408;

const isProtected = (scope: string, part: DraftPart): boolean => (
  Boolean(pendingParts.get(scope)?.has(part)) || (inFlightParts.get(scope)?.get(part) ?? 0) > 0
);

function markInFlight(scope: string, parts: Set<DraftPart>, delta: 1 | -1): void {
  const counts = inFlightParts.get(scope) ?? new Map<DraftPart, number>();
  for (const part of parts) {
    const next = (counts.get(part) ?? 0) + delta;
    if (next > 0) counts.set(part, next);
    else counts.delete(part);
  }
  if (counts.size > 0) inFlightParts.set(scope, counts);
  else inFlightParts.delete(scope);
}
let serverWriteTimer: ReturnType<typeof setTimeout> | null = null;

const isRecord = (value: unknown): value is Record<string, unknown> => (
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
);

const isEmptyDraft = (draft: DraftRecord): boolean => (
  draft.text === '' && draft.queuedMessage === null
);

function readMirror(): Map<string, DraftRecord> {
  try {
    const raw = localStorage.getItem(MIRROR_STORAGE_KEY);
    if (!raw) {
      return new Map();
    }

    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) {
      return new Map();
    }

    const restored = new Map<string, DraftRecord>();
    for (const [scope, value] of Object.entries(parsed)) {
      if (!isRecord(value)) {
        continue;
      }
      restored.set(scope, {
        text: typeof value.text === 'string' ? value.text : '',
        queuedMessage: isRecord(value.queuedMessage)
          ? (value.queuedMessage as StoredQueuedMessage)
          : null,
      });
    }
    return restored;
  } catch {
    return new Map();
  }
}

function writeMirror(): void {
  try {
    localStorage.setItem(MIRROR_STORAGE_KEY, JSON.stringify(Object.fromEntries(drafts)));
  } catch {
    // A full localStorage costs the first-paint restore, not the draft: the
    // server copy is authoritative and arrives on hydrate.
  }
}

function notifyListeners(): void {
  for (const listener of listeners) {
    listener();
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(CHAT_DRAFTS_CHANGED_EVENT));
  }
}

function flushServerWrites(): void {
  serverWriteTimer = null;
  const pending = [...pendingParts];
  pendingParts.clear();

  for (const [scope, parts] of pending) {
    const draft = drafts.get(scope) ?? EMPTY_DRAFT;
    // Only what changed here. The server drops the row once both parts are empty.
    const body: { text?: string; queuedMessage?: StoredQueuedMessage | null } = {};
    if (parts.has('text')) body.text = draft.text;
    if (parts.has('queuedMessage')) body.queuedMessage = draft.queuedMessage;

    // Protected from hydrates until the server confirms it. A save that fails is sent again —
    // it is often a queued message, which only exists once the server holds it — and never
    // surfaces as an unhandled rejection out of a timer callback.
    markInFlight(scope, parts, 1);
    const generation = storeGeneration;
    let status: number | null = null;
    void Promise.resolve()
      .then(() => api.user.saveDraft(scope, body))
      .then((response) => {
        if (!response.ok) {
          status = response.status;
          throw new Error(`HTTP ${response.status}`);
        }
      })
      .then(
        () => {
          markInFlight(scope, parts, -1);
          failedSaves.delete(scope);
        },
        (error: unknown) => {
          markInFlight(scope, parts, -1);
          if (!isRetryable(status)) {
            console.error('Failed to save chat draft:', error);
            return;
          }
          console.error('Failed to save chat draft; retrying:', error);
          // Re-queued at once, so the part stays protected from hydrates while it waits, and not
          // re-sent from here: the retry carries the part's CURRENT value, so an edit made
          // meanwhile is what lands. A failure can hide a save that did land and was already sent;
          // the server ignores a queued message whose id it has sent, so the retry cannot resend it.
          if (generation === storeGeneration) {
            const failures = (failedSaves.get(scope) ?? 0) + 1;
            failedSaves.set(scope, failures);
            const delay = Math.min(SAVE_RETRY_DELAY_MS * 2 ** (failures - 1), SAVE_RETRY_MAX_DELAY_MS);
            queueServerWrite(scope, [...parts], delay);
          }
        },
      );
  }
}

function queueServerWrite(scope: string, parts: DraftPart[], delayMs = SERVER_WRITE_DEBOUNCE_MS): void {
  const scopeParts = pendingParts.get(scope) ?? new Set<DraftPart>();
  for (const part of parts) scopeParts.add(part);
  pendingParts.set(scope, scopeParts);

  // A retry waits its backoff only when nothing is due sooner: it must not push back another
  // scope's save already on its short debounce. That flush sends the retry along, early.
  if (serverWriteTimer !== null) {
    if (delayMs > SERVER_WRITE_DEBOUNCE_MS) {
      return;
    }
    clearTimeout(serverWriteTimer);
  }
  serverWriteTimer = setTimeout(flushServerWrites, delayMs);
}

function flushServerWritesNow(): void {
  if (serverWriteTimer !== null) {
    clearTimeout(serverWriteTimer);
    serverWriteTimer = null;
  }
  flushServerWrites();
}

/** A queued message's value, independent of key order and of an absent vs empty attachment list. */
function queuedIdentity(message: StoredQueuedMessage | null): string {
  if (!message) return 'null';
  const attachments = message.attachments ?? message.images ?? [];
  return JSON.stringify([message.id ?? null, message.content, message.options ?? null, attachments]);
}

function updateDraft(scope: string, update: Partial<DraftRecord>): void {
  const current = drafts.get(scope) ?? EMPTY_DRAFT;
  const next: DraftRecord = { ...current, ...update };

  // Compared by value: the composer rebuilds an identical queued message from storage every time a
  // session opens, and treating that as an edit wrote a stale copy back over one the server had
  // already sent.
  const sameQueued = next.queuedMessage === current.queuedMessage
    || queuedIdentity(next.queuedMessage) === queuedIdentity(current.queuedMessage);
  if (next.text === current.text && sameQueued) {
    return;
  }

  const nextDrafts = new Map(drafts);
  if (isEmptyDraft(next)) {
    nextDrafts.delete(scope);
  } else {
    nextDrafts.set(scope, next);
  }
  drafts = nextDrafts;

  const changed: DraftPart[] = [];
  if (next.text !== current.text) changed.push('text');
  if (!sameQueued) changed.push('queuedMessage');

  writeMirror();
  queueServerWrite(scope, changed);
  notifyListeners();
}

/** Reads one scope's composer text, synchronously, for the first render. */
export function readDraftText(scope: string): string {
  return drafts.get(scope)?.text ?? '';
}

export function writeDraftText(scope: string, text: string): void {
  updateDraft(scope, { text });
}

export function readQueuedMessage(scope: string): StoredQueuedMessage | null {
  const queued = drafts.get(scope)?.queuedMessage ?? null;
  if (!queued) {
    return null;
  }

  const attachments = Array.isArray(queued.attachments)
    ? queued.attachments
    : Array.isArray(queued.images)
      ? queued.images
      : [];

  // A queued message with neither text nor attachments has nothing to send.
  return queued.content.trim() || attachments.length > 0
    ? { ...queued, attachments }
    : null;
}

export function writeQueuedMessage(scope: string, message: StoredQueuedMessage): void {
  updateDraft(scope, { queuedMessage: message });
  // Queueing is a send-like action, so persist it before the tab can close.
  flushServerWritesNow();
}

export function clearQueuedMessage(scope: string): void {
  updateDraft(scope, { queuedMessage: null });
  // Editing or cancelling must beat the server's next dispatcher poll.
  flushServerWritesNow();
}

/** Subscribes to any draft change; returns the unsubscribe function. */
export function subscribeToChatDrafts(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Loads the server's drafts and adopts them as the source of truth.
 *
 * A part changed here whose save has not left yet is kept: the user is looking at that composer
 * right now, and replacing it with a staler server copy would delete what they are in the middle
 * of writing. Every other part — above all a queued message the server has since sent — is the
 * server's.
 */
export async function hydrateChatDrafts(): Promise<void> {
  let serverDrafts: Array<{ scope?: unknown; text?: unknown; queuedMessage?: unknown }> = [];

  try {
    const response = await api.user.drafts();
    if (!response.ok) {
      return;
    }

    const payload = (await response.json()) as { drafts?: unknown };
    if (!Array.isArray(payload.drafts)) {
      return;
    }
    serverDrafts = payload.drafts as typeof serverDrafts;
  } catch (error) {
    // Keep the mirror: an offline load must still show what was typed here.
    console.error('Failed to load chat drafts:', error);
    return;
  }

  const merged = new Map<string, DraftRecord>();
  for (const draft of serverDrafts) {
    const scope = typeof draft.scope === 'string' ? draft.scope : '';
    if (!scope) {
      continue;
    }

    merged.set(scope, {
      text: typeof draft.text === 'string' ? draft.text : '',
      queuedMessage: isRecord(draft.queuedMessage)
        ? (draft.queuedMessage as StoredQueuedMessage)
        : null,
    });
  }

  // Parts edited here whose save the server has not confirmed yet win over the server snapshot,
  // part by part. Every other missing scope was deleted remotely and must also disappear from the
  // mirror.
  const protectedScopes = new Set([...pendingParts.keys(), ...inFlightParts.keys()]);
  for (const scope of protectedScopes) {
    const local = drafts.get(scope) ?? EMPTY_DRAFT;
    const next = { ...(merged.get(scope) ?? EMPTY_DRAFT) };
    if (isProtected(scope, 'text')) next.text = local.text;
    if (isProtected(scope, 'queuedMessage')) next.queuedMessage = local.queuedMessage;
    if (isEmptyDraft(next)) {
      merged.delete(scope);
    } else {
      merged.set(scope, next);
    }
  }

  drafts = merged;
  writeMirror();
  notifyListeners();
}

/** Drops every cached draft on sign-out, so the next user sees none of them. */
export function resetChatDrafts(): void {
  drafts = new Map();
  pendingParts.clear();
  inFlightParts.clear();
  failedSaves.clear();
  storeGeneration += 1;
  if (serverWriteTimer !== null) {
    clearTimeout(serverWriteTimer);
    serverWriteTimer = null;
  }
  try {
    localStorage.removeItem(MIRROR_STORAGE_KEY);
  } catch {
    // The in-memory copy is already cleared, which is what readers use.
  }
  notifyListeners();
}

// Read at module load rather than on first use, because the composer's initial
// input value is a `useState` initializer that runs before any effect.
if (typeof localStorage !== 'undefined') {
  drafts = readMirror();
}
