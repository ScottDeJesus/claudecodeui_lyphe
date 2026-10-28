import { api, attemptWrite } from '@/shared/api';
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
 * THE TEXT AND THE QUEUED MESSAGE TRAVEL SEPARATELY. Text is saved on a debounce and never carries
 * the queue. The queued message belongs to the server: queueing appends to it there, editing or
 * deleting it clears it there, and the server's dispatcher sends it. The copy kept here is only what
 * this page last heard, which can already be out of date (sent, or added to from another tab), so it
 * is never written back — a keystroke must never put back a queued message that was already sent,
 * which is what sent it twice, nor replace one another tab added to.
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

/**
 * Why the server did not accept a message to queue. `code` is the server's machine-readable
 * `error.code` when it sent one (`QUEUED_MESSAGE_NOT_COMBINABLE` for a slash command), so the
 * composer can say it in the reader's language; `null` for a failure with no answer at all.
 */
export class QueueRefusedError extends Error {
  readonly code: string | null;

  constructor(message: string, code: string | null) {
    super(message);
    this.name = 'QueueRefusedError';
    this.code = code;
  }
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

const listeners = new Set<() => void>();

let drafts = new Map<string, DraftRecord>();
/** Scopes whose text was changed here and whose save has not left the browser yet. */
const pendingScopes = new Set<string>();
/**
 * Per scope, how many text saves have left but not been confirmed. A hydrate must not replace the
 * text of such a scope either: the server may simply not have it yet, or the save may be failing.
 */
const inFlightTextSaves = new Map<string, number>();

/** How long a failed save first waits before it is sent again; doubled per failure, capped. */
const SAVE_RETRY_DELAY_MS = 5_000;
const SAVE_RETRY_MAX_DELAY_MS = 60_000;
/** Consecutive failed saves per scope, for the backoff; cleared by a save that lands. */
const failedSaves = new Map<string, number>();

/** Bumped on sign-out, so a retry scheduled for the previous user is dropped. */
let storeGeneration = 0;

/** A failure worth retrying: the network, the server restarting, or rate limiting — not a refusal. */
const isRetryable = (status: number | null): boolean => status === null || status >= 500 || status === 429 || status === 408;

const isTextProtected = (scope: string): boolean => (
  pendingScopes.has(scope) || (inFlightTextSaves.get(scope) ?? 0) > 0
);

function markTextSaveInFlight(scope: string, delta: 1 | -1): void {
  const next = (inFlightTextSaves.get(scope) ?? 0) + delta;
  if (next > 0) inFlightTextSaves.set(scope, next);
  else inFlightTextSaves.delete(scope);
}
let serverWriteTimer: ReturnType<typeof setTimeout> | null = null;

// Counts this page's changes to each scope's queued message, so a hydrate that was already in
// flight when one happened does not put back the older copy.
const queueRevisions = new Map<string, number>();
// The last queue request (append or clear) made for each scope, settled once the server has
// answered it. The next one waits for it, so the server applies them in the order they were made:
// a clear that reached the server before an append made earlier would otherwise miss it, and one
// that reached it after a later append would delete that too.
const queueRequests = new Map<string, Promise<void>>();

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
  const scopes = [...pendingScopes];
  pendingScopes.clear();

  for (const scope of scopes) {
    // Text only: the server keeps the scope's queued message as it is, and drops the row itself
    // once neither text nor a queued message is left.
    const text = drafts.get(scope)?.text ?? '';

    // Protected from hydrates until the server confirms it. A save that fails is sent again, and
    // never surfaces as an unhandled rejection out of a timer callback.
    markTextSaveInFlight(scope, 1);
    const generation = storeGeneration;
    let status: number | null = null;
    void Promise.resolve()
      .then(() => api.user.saveDraft(scope, { text }))
      .then((response) => {
        if (!response.ok) {
          status = response.status;
          throw new Error(`HTTP ${response.status}`);
        }
      })
      .then(
        () => {
          markTextSaveInFlight(scope, -1);
          failedSaves.delete(scope);
        },
        (error: unknown) => {
          markTextSaveInFlight(scope, -1);
          if (!isRetryable(status)) {
            console.error('Failed to save chat draft:', error);
            return;
          }
          console.error('Failed to save chat draft; retrying:', error);
          // Re-queued at once, so the text stays protected from hydrates while it waits, and not
          // re-sent from here: the retry carries the text as it is THEN, so an edit made
          // meanwhile is what lands.
          if (generation === storeGeneration) {
            const failures = (failedSaves.get(scope) ?? 0) + 1;
            failedSaves.set(scope, failures);
            const delay = Math.min(SAVE_RETRY_DELAY_MS * 2 ** (failures - 1), SAVE_RETRY_MAX_DELAY_MS);
            queueServerWrite(scope, delay);
          }
        },
      );
  }
}

function queueServerWrite(scope: string, delayMs = SERVER_WRITE_DEBOUNCE_MS): void {
  pendingScopes.add(scope);

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

/** A queued message's value, independent of key order and of an absent vs empty attachment list. */
function queuedIdentity(message: StoredQueuedMessage | null): string {
  if (!message) return 'null';
  const attachments = message.attachments ?? message.images ?? [];
  return JSON.stringify([message.id ?? null, message.content, message.options ?? null, attachments]);
}

/** Applies a change to this page's copy of a draft; returns whether anything changed. */
function setLocalDraft(scope: string, update: Partial<DraftRecord>): boolean {
  const current = drafts.get(scope) ?? EMPTY_DRAFT;
  const next: DraftRecord = { ...current, ...update };

  // Compared by value: the composer rebuilds an identical queued message from storage every time a
  // session opens, and that is not a change.
  const sameQueued = next.queuedMessage === current.queuedMessage
    || queuedIdentity(next.queuedMessage) === queuedIdentity(current.queuedMessage);
  if (next.text === current.text && sameQueued) {
    return false;
  }

  const nextDrafts = new Map(drafts);
  if (isEmptyDraft(next)) {
    nextDrafts.delete(scope);
  } else {
    nextDrafts.set(scope, next);
  }
  drafts = nextDrafts;

  writeMirror();
  notifyListeners();
  return true;
}

function noteQueueChanged(scope: string): void {
  queueRevisions.set(scope, (queueRevisions.get(scope) ?? 0) + 1);
}

/**
 * Sends a scope's queue request once the previous one has been answered, or at once when none is
 * outstanding (a clear must still beat the dispatcher's poll).
 */
function sendQueueRequest<T>(scope: string, send: () => Promise<T>): Promise<T> {
  const previous = queueRequests.get(scope);
  let request: Promise<T>;
  if (previous) {
    request = previous.then(send);
  } else {
    try {
      request = send();
    } catch (error) {
      request = Promise.reject(error);
    }
  }
  const settled = request.then(() => undefined, () => undefined);
  queueRequests.set(scope, settled);
  void settled.then(() => {
    if (queueRequests.get(scope) === settled) {
      queueRequests.delete(scope);
    }
  });
  return request;
}

/** Reads one scope's composer text, synchronously, for the first render. */
export function readDraftText(scope: string): string {
  return drafts.get(scope)?.text ?? '';
}

export function writeDraftText(scope: string, text: string): void {
  if (setLocalDraft(scope, { text })) {
    queueServerWrite(scope);
  }
}

/** A stored queued message in the shape the composer sends, or null when it has nothing to send. */
function normalizeQueuedMessage(queued: StoredQueuedMessage | null): StoredQueuedMessage | null {
  if (!queued || typeof queued.content !== 'string') {
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

export function readQueuedMessage(scope: string): StoredQueuedMessage | null {
  return normalizeQueuedMessage(drafts.get(scope)?.queuedMessage ?? null);
}

/**
 * Queues a message to send when the session is next idle, after anything already queued for it,
 * and resolves with the message that is now queued.
 *
 * The append happens on the server, against the stored message rather than this page's copy of it:
 * if the dispatcher has already taken the earlier message to send, the new one is queued on its
 * own, so nothing is sent twice and nothing is lost. A clear made on this page goes to the server
 * in order with the appends around it. Rejects with a `QueueRefusedError` when the server did not
 * accept the message, so the composer can keep it instead of showing a card that will never be
 * sent.
 */
export async function appendQueuedMessage(
  scope: string,
  message: StoredQueuedMessage,
): Promise<{ queuedMessage: StoredQueuedMessage; appended: boolean }> {
  const result = await sendQueueRequest(scope, async () => {
    const attempt = await attemptWrite(() => api.user.appendQueuedMessage(scope, message));
    if (!attempt.landed) {
      throw new QueueRefusedError(attempt.sentence ?? 'The server did not answer', attempt.code);
    }

    const payload = (await attempt.response.json().catch(() => null)) as {
      queuedMessage?: unknown;
      appended?: unknown;
    } | null;
    const queuedMessage = normalizeQueuedMessage(
      isRecord(payload?.queuedMessage) ? (payload?.queuedMessage as StoredQueuedMessage) : null,
    );
    if (!queuedMessage) {
      throw new Error('The server returned no queued message');
    }
    return { queuedMessage, appended: payload?.appended === true };
  });

  noteQueueChanged(scope);
  setLocalDraft(scope, { queuedMessage: result.queuedMessage });
  return result;
}

/**
 * What the server answered to a clear: `landed` when it applied it, `removed` the message it took
 * off the queue (null when nothing was waiting: already sent, or cleared elsewhere), `sentence`
 * the server's words when it did not apply it.
 */
export type QueueClearResult = {
  landed: boolean;
  removed: StoredQueuedMessage | null;
  sentence: string | null;
};

/**
 * Removes a scope's queued message (edited back into the composer or deleted) and resolves with
 * the message the server removed, which is what the caller hands back to the user: it can hold
 * more than this page's card shows, because another tab may have added to it since the card was
 * last refreshed.
 *
 * This page's copy goes only once the server has said it applied the clear. A clear that did not
 * land leaves the queued message in place — the server still holds it and will send it — so the
 * card must stay, and the caller says so, rather than showing a message as gone that is not. The
 * request is sent at once unless an append is still being answered: editing or cancelling must
 * beat the server's next dispatcher poll.
 */
export async function clearQueuedMessage(scope: string): Promise<QueueClearResult> {
  const result = await sendQueueRequest(scope, async (): Promise<QueueClearResult> => {
    const attempt = await attemptWrite(() => api.user.clearQueuedMessage(scope));
    if (!attempt.landed) {
      return { landed: false, removed: null, sentence: attempt.sentence };
    }
    const payload = (await attempt.response.json().catch(() => null)) as { queuedMessage?: unknown } | null;
    const removed = normalizeQueuedMessage(
      isRecord(payload?.queuedMessage) ? (payload?.queuedMessage as StoredQueuedMessage) : null,
    );
    return { landed: true, removed, sentence: null };
  });

  if (result.landed) {
    noteQueueChanged(scope);
    setLocalDraft(scope, { queuedMessage: null });
  }
  return result;
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
 * Text changed here whose save has not been confirmed is kept: the user is looking at that composer
 * right now, and replacing it with a staler server copy would delete what they are in the middle
 * of writing. A queued message this page changed while the request was in flight (or is still
 * changing) is kept for the same reason. Every other queued message — above all one the server has
 * since sent — is the server's, even for a scope being typed into.
 */
export async function hydrateChatDrafts(): Promise<void> {
  let serverDrafts: Array<{ scope?: unknown; text?: unknown; queuedMessage?: unknown }> = [];
  const queueRevisionsAtRequest = new Map(queueRevisions);

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

  // Local changes the snapshot cannot contain yet win over it, field by field. Every other
  // missing scope was deleted remotely and must also disappear from the mirror.
  const queueIsChangingHere = (scope: string) => (
    (queueRevisions.get(scope) ?? 0) !== (queueRevisionsAtRequest.get(scope) ?? 0)
    || queueRequests.has(scope)
  );
  const locallyChangedScopes = new Set([
    ...pendingScopes,
    ...inFlightTextSaves.keys(),
    ...queueRevisions.keys(),
    ...queueRequests.keys(),
  ]);
  for (const scope of locallyChangedScopes) {
    const local = drafts.get(scope) ?? EMPTY_DRAFT;
    const server = merged.get(scope) ?? EMPTY_DRAFT;
    const next: DraftRecord = {
      text: isTextProtected(scope) ? local.text : server.text,
      queuedMessage: queueIsChangingHere(scope) ? local.queuedMessage : server.queuedMessage,
    };
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
  pendingScopes.clear();
  inFlightTextSaves.clear();
  failedSaves.clear();
  queueRevisions.clear();
  queueRequests.clear();
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
