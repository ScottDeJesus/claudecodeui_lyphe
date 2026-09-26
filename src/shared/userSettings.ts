import { api } from '@/shared/api';
import type { ClaudeSettings } from '@/shared/types';

/**
 * The one reader and writer for the settings that used to live in browser
 * localStorage and now live in `auth.db`.
 *
 * The server is the source of truth — that is what makes a setting follow the
 * user from a laptop to a phone. localStorage keeps a mirror of the last known
 * server state purely so the very first paint is synchronous: without it the
 * app would flash the default light theme, the default language and a
 * collapsed sidebar on every load while the fetch was in flight.
 *
 * Reads are therefore synchronous against the mirror, and writes go to the
 * mirror immediately and to the server on a short debounce.
 */

/** Every setting the server stores for a user. */
export type UserPreferences = {
  theme: 'light' | 'dark';
  userLanguage: string;
  tasksEnabled: boolean;
  projectSortOrder: 'name' | 'date';
  claudePermissions: unknown;
  cursorPermissions: unknown;
  codexPermissions: unknown;
  opencodePermissions: unknown;
  uiPreferences: unknown;
  selectedProvider: string;
  simpleChatList: boolean;
  simpleChatProjectId: string | null;
  themeFollowsSun: boolean;
  /** The transcript's reading size in px. See `useChatFontSize`. */
  chatFontSize: number;
  /** The Runner tab's memory, a blob merged by its two writers: `{ collapsedCards: string[], dismissedEndings: {run_id, ended_at}[] }`. See `modules/dispatcher/dismissedEndings.ts` and `shared/hooks/useCardFold.ts`. */
  dispatcher: unknown;
  /** Composer toggle: every sent message rides under the `/plain` command. See `usePlainModePreference`. */
  plainMode: boolean;
  /** Where each chat-gutter widget sits and whether it is open, per chat, plus the fallback a chat
   *  with no arrangement of its own opens with. See `modules/chat-gutters/hooks/useGutterPlacements.ts`. */
  chatGutters: unknown;
};

export type UserPreferenceKey = keyof UserPreferences;

/** Fired after any preference changes, from a local write or from a hydrate. */
export const USER_PREFERENCES_CHANGED_EVENT = 'user-preferences:changed';

/** The single localStorage blob mirroring the server's copy. */
const MIRROR_STORAGE_KEY = 'user-preferences';

/**
 * Long enough to collapse a burst of edits (dragging the font-size select,
 * toggling several switches) into one request, short enough that closing the
 * tab right after a change almost never loses it.
 */
const SERVER_WRITE_DEBOUNCE_MS = 400;

/**
 * The localStorage keys each preference was read from before this module.
 *
 * Kept so an existing install does not lose its settings on upgrade: on the
 * first hydrate, any key the server has never seen is seeded from its legacy
 * location and pushed up. Removing an entry here silently resets that setting
 * for every user who has not opened the app since the migration.
 *
 * A `null` entry means the preference was born after this migration existed —
 * there is no legacy localStorage key to seed it from.
 */
const LEGACY_STORAGE_KEYS: Record<UserPreferenceKey, string | null> = {
  theme: 'theme',
  userLanguage: 'userLanguage',
  tasksEnabled: 'tasks-enabled',
  projectSortOrder: 'claude-settings',
  claudePermissions: 'claude-settings',
  cursorPermissions: 'cursor-tools-settings',
  codexPermissions: 'codex-settings',
  opencodePermissions: 'opencode-settings',
  uiPreferences: 'uiPreferences',
  selectedProvider: 'selected-provider',
  simpleChatList: null,
  themeFollowsSun: null,
  simpleChatProjectId: null,
  chatFontSize: null,
  dispatcher: null,
  plainMode: null,
  chatGutters: null,
};

const PREFERENCE_KEYS = Object.keys(LEGACY_STORAGE_KEYS) as UserPreferenceKey[];

type PreferenceRecord = Partial<Record<UserPreferenceKey, unknown>>;

const listeners = new Set<() => void>();

let preferences: PreferenceRecord = {};
let pendingServerWrites: PreferenceRecord = {};
let serverWriteTimer: ReturnType<typeof setTimeout> | null = null;
let hasHydrated = false;

const isRecord = (value: unknown): value is Record<string, unknown> => (
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
);

function readMirror(): PreferenceRecord {
  try {
    const raw = localStorage.getItem(MIRROR_STORAGE_KEY);
    if (!raw) {
      return {};
    }

    const parsed: unknown = JSON.parse(raw);
    return isRecord(parsed) ? (parsed as PreferenceRecord) : {};
  } catch {
    return {};
  }
}

function writeMirror(): void {
  try {
    localStorage.setItem(MIRROR_STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // A full or unavailable localStorage costs the first-paint optimization,
    // not the setting itself — the server copy is authoritative.
  }
}

function notifyListeners(): void {
  for (const listener of listeners) {
    listener();
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(USER_PREFERENCES_CHANGED_EVENT));
  }
}

/**
 * How long a save that could not be sent waits before it is tried again, doubled per failure and
 * capped — the shape `chatDrafts.ts` already uses. A preference whose wire value names only what it
 * changed (see `writeUserPreference`) cannot be re-sent by the next write, so a lost message has to
 * keep itself; a server that stays down must still not be asked every five seconds forever.
 */
const SERVER_WRITE_RETRY_MS = 5_000;
const SERVER_WRITE_RETRY_MAX_MS = 60_000;
/** Consecutive failed saves, for the backoff; cleared by a save that lands. */
let failedServerWrites = 0;
/** Bumped on sign-out, so a retry scheduled for the previous user is dropped rather than re-sent. */
let storeGeneration = 0;
/** A failure worth retrying: the network, the server restarting, or rate limiting — not a refusal. */
const isRetryableStatus = (status: number | null): boolean => (
  status === null || status >= 500 || status === 429 || status === 408
);

/**
 * Folds a queued save into the one already waiting. Every key but `chatGutters` replaces: the newest
 * value of a setting is the setting. A gutter message names ONE chat (or, for a chat not sent yet,
 * only the fallback), so replacing it would drop the chat the earlier message carried — two arranges
 * inside the debounce window is enough — and the queue must keep the promise the wire value makes:
 * a message never asserts a chat it did not touch.
 *
 * Three shapes can arrive here, and the third is why this is not simply a union. A message with a
 * record `sessions` names that chat; a message that is only `{ fallback }` names no chat; and an
 * older build's flat record (`{ runner, memory, subagents }` — no `fallback`, no `sessions`) IS the
 * fallback it means, which is how the server reads it too. Folding that one like the others would
 * throw its arrangement away, so it becomes the fallback over whatever chats are pending.
 */
function foldServerWrite(key: UserPreferenceKey, pending: unknown, incoming: unknown): unknown {
  if (key !== 'chatGutters' || !isRecord(pending) || !isRecord(incoming)) {
    return incoming;
  }

  const sessionsOf = (value: Record<string, unknown>) => (isRecord(value.sessions) ? value.sessions : {});
  const orderOf = (value: Record<string, unknown>) => (Array.isArray(value.order) ? value.order : []);
  const legacy = (value: Record<string, unknown>) => !('fallback' in value) && !('sessions' in value);

  const fallback = legacy(incoming) ? incoming : incoming.fallback ?? (legacy(pending) ? pending : pending.fallback);
  const sessions = { ...sessionsOf(pending), ...sessionsOf(incoming) };
  const order = [
    ...orderOf(pending).filter((id) => !orderOf(incoming).includes(id)),
    ...orderOf(incoming),
  ];
  return { fallback, sessions, order };
}

/**
 * The message to retry, rebuilt from what the store holds NOW rather than from what was sent.
 *
 * A save that fails late — the request timeout is 30 s — would otherwise put the value it carried
 * back on the wire five seconds later, over anything the user changed in the meantime that already
 * landed: the screen and the server would disagree until the next change. `chatDrafts.ts` retries
 * the current value for the same reason.
 *
 * For `chatGutters` that means the current arrangement of the chats THIS message named, and no
 * others — the retry must keep the wire's promise that a message never asserts a chat it did not
 * touch. A chat the store has since forgotten is dropped from it.
 */
function refreshForRetry(key: UserPreferenceKey, sent: unknown): unknown {
  const current = preferences[key];
  if (key !== 'chatGutters') {
    return current === undefined ? sent : current;
  }
  if (!isRecord(current) || !isRecord(sent)) {
    return sent;
  }

  const named = isRecord(sent.sessions) ? Object.keys(sent.sessions) : [];
  if (named.length === 0) {
    // A chat that had no id yet: the message only ever carried the fallback, and the store's copy of
    // it is the value the operator just set.
    return { fallback: current.fallback ?? (isRecord(sent) ? sent.fallback : undefined) };
  }

  const held = isRecord(current.sessions) ? current.sessions : {};
  const sessions: Record<string, unknown> = {};
  for (const sessionId of named) {
    if (sessionId in held) sessions[sessionId] = held[sessionId];
  }
  // No `fallback`: this message names chats, and the copy of the fallback beside them is exactly as
  // stale as the sections the narrowing exists to keep off the wire. The fallback travels only in the
  // message that carries nothing else, above.
  return { sessions, order: Object.keys(sessions) };
}

function flushServerWrites(): void {
  serverWriteTimer = null;
  const updates = pendingServerWrites;
  pendingServerWrites = {};

  if (Object.keys(updates).length === 0) {
    return;
  }

  // A save that fails must never surface as an unhandled rejection out of a timer callback. A
  // failure worth retrying is put back at the front of the queue: the mirror holds the value, but
  // for a key whose message names only what it changed, no later write would carry this one's part.
  // A REFUSAL (a 4xx that is not 408 or 429) is logged and dropped — re-sending it cannot help.
  const generation = storeGeneration;
  let status: number | null = null;

  const keep = (error: unknown) => {
    if (!isRetryableStatus(status)) {
      console.error('Failed to save user preferences; the server refused it:', error);
      return;
    }
    console.error('Failed to save user preferences; retrying:', error);
    // A sign-out moved the generation on: this message belongs to whoever was signed in when it was
    // built, and sending it now would write their values into the row of whoever is signed in next.
    if (generation !== storeGeneration) return;

    for (const [key, value] of Object.entries(updates) as Array<[UserPreferenceKey, unknown]>) {
      const current = refreshForRetry(key, value);
      pendingServerWrites[key] = key in pendingServerWrites
        ? foldServerWrite(key, current, pendingServerWrites[key])   // the newer write is the incoming one
        : current;
    }
    failedServerWrites += 1;
    const delay = Math.min(SERVER_WRITE_RETRY_MS * 2 ** (failedServerWrites - 1), SERVER_WRITE_RETRY_MAX_MS);
    if (serverWriteTimer !== null) clearTimeout(serverWriteTimer);
    serverWriteTimer = setTimeout(flushServerWrites, delay);
  };

  try {
    // `authenticatedFetch` resolves for every answer the server gives, so a 500 or a 401 reaches
    // this store only by reading the response: without this, every HTTP failure was silent.
    void api.user.savePreferences(updates as Record<string, unknown>)
      .then((response) => {
        if (!response.ok) {
          status = response.status;
          throw new Error(`HTTP ${response.status}`);
        }
        failedServerWrites = 0;
      })
      .catch(keep);
  } catch (error) {
    keep(error);
  }
}

function queueServerWrite(updates: PreferenceRecord): void {
  const merged: PreferenceRecord = { ...pendingServerWrites };
  for (const [key, value] of Object.entries(updates) as Array<[UserPreferenceKey, unknown]>) {
    merged[key] = key in merged ? foldServerWrite(key, merged[key], value) : value;
  }
  pendingServerWrites = merged;

  if (serverWriteTimer !== null) {
    clearTimeout(serverWriteTimer);
  }
  serverWriteTimer = setTimeout(flushServerWrites, SERVER_WRITE_DEBOUNCE_MS);
}

/**
 * Reads one preference, or `fallback` when the user has never set it.
 *
 * Synchronous by design: callers include module-level initializers and
 * `useState` initial values that run before any fetch could resolve.
 */
export function readUserPreference<T>(key: UserPreferenceKey, fallback: T): T {
  const value = preferences[key];
  return value === undefined || value === null ? fallback : (value as T);
}

/**
 * Claude's tool-permission settings, stored in auth.db so the allow-list a user
 * builds up on one machine applies on the next. Read by the chat and by the
 * terminal, which seeds its own permission toggle from it — so the reader and
 * its writer below live here, where neither module has to import the other.
 *
 * `projectSortOrder` is a separate preference now, but stays on the returned
 * object because ClaudeSettings still describes the whole legacy blob.
 */
export function getClaudeSettings(): ClaudeSettings {
  const stored = readUserPreference<Partial<ClaudeSettings>>('claudePermissions', {});

  return {
    allowedTools: Array.isArray(stored.allowedTools) ? stored.allowedTools : [],
    disallowedTools: Array.isArray(stored.disallowedTools) ? stored.disallowedTools : [],
    skipPermissions: Boolean(stored.skipPermissions),
    projectSortOrder: readUserPreference<ClaudeSettings['projectSortOrder']>('projectSortOrder', 'name'),
  };
}

/** Persists Claude's tool permissions after the user grants one from the chat. */
export function saveClaudePermissions(permissions: {
  allowedTools: string[];
  disallowedTools: string[];
  skipPermissions: boolean;
}): void {
  writeUserPreference('claudePermissions', permissions);
}

/** Writes one preference through to the mirror, the listeners and the server. */
export function writeUserPreference(key: UserPreferenceKey, value: unknown, wireValue?: unknown): void {
  if (JSON.stringify(preferences[key]) === JSON.stringify(value)) {
    return;
  }

  preferences = { ...preferences, [key]: value };
  writeMirror();
  // `wireValue` is for a preference the server merges rather than replaces (`chatGutters`, whose
  // value holds a section per chat): the browser keeps the whole document, and sends only the part
  // it changed, so a section another device wrote — and this one last read hours ago — is neither
  // asserted nor reverted. Absent, the value itself goes up, which is right for every other key.
  queueServerWrite({ [key]: wireValue === undefined ? value : wireValue });
  notifyListeners();
}

/** Writes several preferences as one change, so listeners re-render once. */
export function writeUserPreferences(updates: PreferenceRecord): void {
  const changed: PreferenceRecord = {};
  for (const [key, value] of Object.entries(updates) as Array<[UserPreferenceKey, unknown]>) {
    if (JSON.stringify(preferences[key]) !== JSON.stringify(value)) {
      changed[key] = value;
    }
  }

  if (Object.keys(changed).length === 0) {
    return;
  }

  preferences = { ...preferences, ...changed };
  writeMirror();
  queueServerWrite(changed);
  notifyListeners();
}

/** Subscribes to any preference change; returns the unsubscribe function. */
export function subscribeToUserPreferences(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Reads what a preference was stored under before this module existed.
 *
 * `claude-settings` held four settings in one blob, so `projectSortOrder` and
 * `claudePermissions` are pulled out of it separately.
 */
function readLegacyPreference(key: UserPreferenceKey): unknown {
  const legacyKey = LEGACY_STORAGE_KEYS[key];
  if (legacyKey === null) {
    return undefined;
  }

  let raw: string | null = null;
  try {
    raw = localStorage.getItem(legacyKey);
  } catch {
    return undefined;
  }

  if (raw === null) {
    return undefined;
  }

  if (key === 'theme' || key === 'userLanguage' || key === 'selectedProvider') {
    return raw;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }

  if (key === 'projectSortOrder') {
    return isRecord(parsed) ? parsed.projectSortOrder : undefined;
  }

  if (key === 'claudePermissions') {
    if (!isRecord(parsed)) {
      return undefined;
    }
    // The sort order rides along in the same legacy blob but is its own
    // preference now, so it is deliberately not copied into the permissions.
    const { allowedTools, disallowedTools, skipPermissions } = parsed;
    return { allowedTools, disallowedTools, skipPermissions };
  }

  return parsed;
}

/**
 * The read is over and brought back nothing usable, so the mirror is all there will be.
 *
 * Two things follow from that, and they are the same thing said twice. The mirror is left
 * EXACTLY as it stands — writing an empty server copy over it would throw away the theme,
 * language, sort order and permission blobs this device already had, for the rest of the
 * session. And readers are released: a read that failed is still a read that is over, so
 * anything waiting for a real preference before acting gets to act on the best value there is
 * rather than waiting forever.
 *
 * A fetch that THROWS and a response that FAILS are the same event to every caller, so they
 * land here together — the distinction is the network's, not the reader's.
 */
function settleOnTheMirrorAlone(reason: unknown): void {
  console.error('Failed to load user preferences:', reason);
  hasHydrated = true;
  notifyListeners();
}

/**
 * Loads the server's copy and adopts it as the source of truth.
 *
 * Called once the user is authenticated. Any key the server has never seen is
 * seeded from wherever it used to live in localStorage and pushed up, so the
 * settings an existing install already had survive the move.
 *
 * A 200 carrying no preferences is NOT a failure and does not come back here: a brand-new
 * account genuinely has none, and adopting that empty copy is how it gets its defaults.
 */
export async function hydrateUserPreferences(): Promise<void> {
  let serverPreferences: PreferenceRecord = {};

  try {
    const response = await api.user.preferences();
    if (!response.ok) {
      settleOnTheMirrorAlone(`HTTP ${response.status}`);
      return;
    }

    const payload = (await response.json()) as { preferences?: unknown };
    if (isRecord(payload.preferences)) {
      serverPreferences = payload.preferences as PreferenceRecord;
    }
  } catch (error) {
    settleOnTheMirrorAlone(error);
    return;
  }

  const migrated: PreferenceRecord = {};
  for (const key of PREFERENCE_KEYS) {
    if (serverPreferences[key] !== undefined) {
      continue;
    }

    const legacyValue = readLegacyPreference(key);

    if (legacyValue !== undefined) {
      migrated[key] = legacyValue;
    }
  }

  // Anything still queued for a key the server just answered for was computed
  // from pre-hydrate state and is now stale. Letting it flush would push this
  // device's start-up value over the one that was just fetched — the exact
  // shape of a preference silently resetting itself on a second device.
  for (const key of Object.keys(serverPreferences) as UserPreferenceKey[]) {
    delete pendingServerWrites[key];
  }

  preferences = { ...serverPreferences, ...migrated };
  hasHydrated = true;
  writeMirror();

  if (Object.keys(migrated).length > 0) {
    queueServerWrite(migrated);
  }

  notifyListeners();
}

/**
 * True once the preferences have SETTLED — the server's copy read, or the read attempted and
 * failed, leaving the mirror as all there will be. Either way the values are no longer
 * placeholders, so a reader may act on them.
 *
 * The distinction matters to anything DESTRUCTIVE: before this is true, a preference read
 * synchronously off a cold mirror is the DEFAULT standing in for a value still on its way.
 */
export function hasHydratedUserPreferences(): boolean {
  return hasHydrated;
}

/**
 * Drops the in-memory and mirrored copies on sign-out, so the next user on
 * this device does not start out looking at the previous user's settings.
 */
export function resetUserPreferences(): void {
  preferences = {};
  pendingServerWrites = {};
  hasHydrated = false;
  // A save still in flight belongs to the user who just left; its failure must not re-queue it.
  storeGeneration += 1;
  failedServerWrites = 0;
  if (serverWriteTimer !== null) {
    clearTimeout(serverWriteTimer);
    serverWriteTimer = null;
  }
  try {
    localStorage.removeItem(MIRROR_STORAGE_KEY);
  } catch {
    // Nothing to do: the in-memory copy is already cleared.
  }
  notifyListeners();
}

// The mirror is read at module load rather than on first use because the theme
// and language readers run during module initialization, before any component
// has mounted.
if (typeof localStorage !== 'undefined') {
  preferences = readMirror();
}
