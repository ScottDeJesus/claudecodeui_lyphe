import {
  expireAuthSession,
  getStoredAuthToken,
  storeAuthToken,
} from '@/shared/authToken';
import type { AuthTraceEvent, CerberusEnrollInput, CerberusLabelInput, CerberusMuteInput, CerberusPromoteInput, ClaudeApiKeySave, DeepseekRange, DispatcherAsk, DispatcherEpicsWord, DispatcherModelChoice, DispatcherQueueMove, FileLinePatch, JevRange, NoteInput, NtfySettingsInput, SimpleListItemRef, SimpleListPosition, SubagentTranscriptResult, VoiceProvider, VoiceSettingsPatch, WriteAttempt } from '@/shared/types';
import type { AgentLaunchDefaultsChange, AgentLaunchRowChange } from '@/shared/agent-launch-types';
import type { MarkRequest, MissedRequest, Queue, ReadRequest, ThresholdRequest, UnderstandingMarkRequest } from '@/shared/affected-areas-types';
import type { CerberusCatalogEntryInput } from '@/shared/cerberus-types';
import type { CompanionSettings } from '@/shared/companion-types';
import type { ClaudeUpdateApplyRequest } from '@/shared/claude-update-types';
import type { RoadmapWriteBody } from '@/shared/roadmap-types';
import { IS_PLATFORM, companionClientId, recordingFileName } from '@/shared/utils';
import { readVoiceConfig, voiceConfigHeaders } from '@/shared/voiceConfig';

// Headers are a plain record rather than the full `HeadersInit` union so the
// defaults below can be merged with a caller's headers by spreading.
export type ApiRequestOptions = Omit<RequestInit, 'headers'> & {
  headers?: Record<string, string>;
  /** Overrides `REQUEST_TIMEOUT_MS`. `0` waits forever, for a caller that means to. */
  timeoutMs?: number;
};

/**
 * The ceiling on a whole request — headers AND body, because `AbortSignal.timeout` is a
 * wall-clock deadline on the entire exchange, not a first-byte one.
 *
 * A browser does NOT time these out on its own: when the API restarts under a keep-alive
 * socket — a dev-supervisor bounce, a tab woken after sleep — the request the page sends is
 * written into a connection nobody will ever answer, and `fetch` waits on it forever. That is
 * what left the app sitting on "Loading authentication state…" with no way out but a manual
 * reload, since the boot gate awaits exactly such a request.
 *
 * Since it covers the body, anything whose length belongs to the WORK rather than to the
 * network opts out with `NO_REQUEST_TIMEOUT` — an install that shells out to npm, a
 * self-update, a file whose bytes take longer than this to arrive over a slow link.
 */
export const REQUEST_TIMEOUT_MS = 30_000;

/** Opt-out for a request whose length is the work's, not the network's. */
export const NO_REQUEST_TIMEOUT = 0;

/**
 * The gate's own, much shorter deadline: nothing is on screen but a spinner until these two
 * answer, and AuthContext retries them — with a LONGER deadline each attempt, so a cold or
 * loaded server gets waited out rather than declared unreachable at four seconds while six
 * abandoned requests pile onto it.
 */
export const BOOT_REQUEST_TIMEOUTS_MS = [4_000, 8_000, 12_000] as const;

/**
 * The whole gate's wall clock, not one request's. The ladder above is ~25s per request and the
 * gate makes TWO in sequence, so without a shared budget the spinner could stand for ~50s while
 * the code claimed 25 — the retries stop when this is spent, whichever request is in hand.
 */
export const BOOT_TOTAL_BUDGET_MS = 25_000;

/**
 * The least any single boot request may be given, even with the shared budget nearly spent.
 * The gate's second request would otherwise inherit whatever milliseconds the first left it and
 * "fail" instantly, which reported an unreachable server that had just answered.
 */
export const BOOT_REQUEST_FLOOR_MS = 3_000;

/**
 * A signal that aborts on the deadline — unless the caller brought its own (it owns
 * cancellation then) or the body is an upload, whose duration belongs to the file.
 *
 * `AbortSignal.timeout` is absent on older WebKit (iOS 15), which this app can be installed on
 * as a PWA. Its absence has to cost the DEADLINE, not the request: calling it there throws
 * synchronously inside the auth boot, and the user was then told the server could not be
 * reached while it was answering perfectly.
 */
const supportsTimeoutSignal = () => typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function';

export const requestTimeoutSignal = (timeoutMs: number): AbortSignal | undefined => (
  supportsTimeoutSignal() ? AbortSignal.timeout(timeoutMs) : undefined
);

const timeoutSignal = ({ signal, body, timeoutMs = REQUEST_TIMEOUT_MS }: ApiRequestOptions) => {
  if (signal || body instanceof FormData || timeoutMs <= 0) {
    return signal;
  }
  return requestTimeoutSignal(timeoutMs);
};

// Utility function for authenticated API calls
export const authenticatedFetch = (
  url: string,
  options: ApiRequestOptions = {},
): Promise<Response> => {
  const token = getStoredAuthToken();

  const defaultHeaders: Record<string, string> = {};

  // Only set Content-Type for non-FormData requests
  if (!(options.body instanceof FormData)) {
    defaultHeaders['Content-Type'] = 'application/json';
  }

  if (!IS_PLATFORM && token) {
    defaultHeaders['Authorization'] = `Bearer ${token}`;
  }

  const { timeoutMs: _timeoutMs, ...requestInit } = options;

  return fetch(url, {
    ...requestInit,
    signal: timeoutSignal(options),
    headers: {
      ...defaultHeaders,
      ...options.headers,
    },
  }).then((response) => {
    const refreshedToken = response.headers.get('X-Refreshed-Token');
    if (refreshedToken) {
      storeAuthToken(refreshedToken, { trigger: 'refresh-header', url, method: requestInit.method ?? 'GET', status: response.status });
    }
    const authError = response.headers.get('X-Auth-Error');
    if (authError) {
      expireAuthSession({ trigger: 'request-verdict', token, url, method: requestInit.method ?? 'GET', status: response.status, authError });
    }
    return response;
  });
};

// ─── Request helpers ────────────────────────────────────────────────────────
// Every endpoint below goes through these so verb, JSON encoding and query
// serialization stay consistent across the whole frontend.

type QueryValue = string | number | boolean | null | undefined;

// Serializes a query object into `?a=1&b=2` (or an empty string). Empty and
// `false` values are dropped so optional flags can be passed unconditionally.
const query = (params: Record<string, QueryValue>): string => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined || value === '' || value === false) {
      continue;
    }
    search.set(key, String(value));
  }
  const serialized = search.toString();
  return serialized ? `?${serialized}` : '';
};

/**
 * The server's own sentence, out of whatever the envelope put in `error` or `details`.
 *
 * Two shapes arrive on this wire. A route that refuses by hand answers a plain string
 * (`{ error: 'An attachment needs a file.' }`); the error middleware answers an object
 * (`{ error: { code, message, details } }`). Both reach the reader through the same toast, and an
 * object rendered as a string is `[object Object]` — a sentence that says nothing and buries the
 * one the server wrote.
 *
 * Exported for the callers that read a REFUSAL out of a body they had to inspect themselves —
 * `readApiJson` is the whole story only where the status is not the caller's business, and a
 * 422 whose words are the entire point is not.
 */
export function errorMessage(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() === '' ? null : value;
  if (value !== null && typeof value === 'object') {
    const message = (value as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim() !== '') return message;
  }
  return null;
}

/**
 * Reads a `{ success, error, details }` envelope response, throwing the server's
 * message when the request failed.
 *
 * Endpoints return a bare Response, so call sites unwrap it themselves. Most do
 * so in ways that differ deliberately (bare casts where the caller inspects the
 * payload, abort-aware reads in the git panel); this is the shared form for
 * callers that want a failed request to throw.
 */
export async function readApiJson<T>(response: Response): Promise<T> {
  const data = await response.json();
  if (!response.ok || data.success === false) {
    throw new Error(
      errorMessage(data.error) ?? errorMessage(data.details) ?? `Request failed (${response.status})`
    );
  }
  return data as T;
}

/**
 * The server's own sentence out of a refusal body, or `null` when the body carried none — or was
 * not JSON at all. Both envelope shapes `errorMessage` reads arrive here: a route's plain `error`
 * string, and the error middleware's `{ error: { code, message } }`. For the writers that answer
 * the person with a toast and keep the server's words under it (the notes and the Cerberus
 * providers), where `readApiJson` would throw the sentence away with the status.
 */
export async function refusalSentence(response: Response): Promise<string | null> {
  try {
    const body: unknown = await response.json();
    if (body === null || typeof body !== 'object') return null;
    const envelope = body as { error?: unknown; details?: unknown };
    return errorMessage(envelope.error) ?? errorMessage(envelope.details);
  } catch {
    return null;
  }
}

/**
 * One write, judged: lands (a 2xx) or does not, and when it does not, the server's own sentence and
 * machine-readable code if it sent them. A refusal, an unanswered request and a thrown fetch are all
 * "did not land" — the caller raises its own toast over the verdict, which is why this never throws.
 * For the writers that keep the person's text when a write fails (the notes' autosave and delete).
 */
export async function attemptWrite(request: () => Promise<Response>): Promise<WriteAttempt> {
  try {
    const response = await request();
    if (response.ok) return { landed: true, response };
    // The code first: it reads a clone, so the sentence below can still read the body.
    const code = await refusalCode(response);
    return { landed: false, sentence: await refusalSentence(response), code };
  } catch {
    // No answer at all — this app's own network — so there is no server sentence or code to carry.
    return { landed: false, sentence: null, code: null };
  }
}

/**
 * The machine-readable `error.code` of a refusal body (`PROJECT_NODE_NOT_COLOCATED`), or `null` when
 * the body carries none or is not JSON. For the writers that treat one particular refusal as an answer
 * of their own rather than a failure. It reads a CLONE, so `refusalSentence` can still read the body
 * of the response it was given.
 */
export async function refusalCode(response: Response): Promise<string | null> {
  try {
    const body: unknown = await response.clone().json();
    if (body === null || typeof body !== 'object') return null;
    const error = (body as { error?: unknown }).error;
    if (error === null || typeof error !== 'object') return null;
    const code = (error as { code?: unknown }).code;
    return typeof code === 'string' ? code : null;
  } catch {
    return null;
  }
}

const get = (url: string, options: ApiRequestOptions = {}) => authenticatedFetch(url, options);

const withBody =
  (method: string) =>
    (url: string, body?: unknown, options: ApiRequestOptions = {}) =>
      authenticatedFetch(url, {
        method,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        ...options,
      });

const post = withBody('POST');
const put = withBody('PUT');
const patch = withBody('PATCH');
const del = withBody('DELETE');

/** The request options every companion call carries: this page's name for her, in the header she reads it from. */
const companionOptions = (): ApiRequestOptions => ({ headers: { 'x-companion-client': companionClientId() } });

// ─── URL builders ───────────────────────────────────────────────────────────
// Exported for the consumers that cannot go through `authenticatedFetch`:
// `EventSource` and `XMLHttpRequest` need a bare URL.

/**
 * Persisted messages for one session. Omitting `limit` requests the whole
 * transcript; passing one always pairs it with an explicit offset so automatic
 * refreshes can never accidentally become an unbounded transcript request.
 */
export const sessionMessagesUrl = (
  sessionId: string,
  { limit = null, offset = 0 }: { limit?: number | null; offset?: number } = {},
): string => {
  const base = `/api/providers/sessions/${encodeURIComponent(sessionId)}/messages`;
  return limit === null || limit === undefined
    ? base
    : `${base}${query({ limit, offset: offset ?? 0 })}`;
};

const fileContentPath = (projectId: string, filePath: string) =>
  `/api/file-tree/projects/${projectId}/files/content${query({ path: filePath })}`;

const pluginAssetPath = (pluginName: string, assetFile: string) =>
  `/api/plugins/${encodeURIComponent(pluginName)}/assets/${encodeURIComponent(assetFile)}`;

// ─── The board's Metis transcript ───────────────────────────────────────────

/**
 * One Metis transcript, read and unwrapped: `/api/kanban-metis/sessions/:sessionId/transcript`.
 *
 * DEFINED ONCE, NAMED TWICE, because two callers ask for it in their own vocabulary — the fleet
 * group below (`kanbanMetis.transcript`) and the transcript-reader family
 * (`subagentTranscripts.metis`), which addresses every subagent by a target kind. One route and
 * one unwrap, so the two names cannot drift into two spellings of a path.
 *
 * THE BOARD MINTS THE SESSION ID, so the id IS the mapping: there is no launch-id translation to
 * perform. Two ways for it to come back empty-handed, and they are different news: an id the
 * registry does not hold is a 404, which the caller reads as a failed request; a session the
 * registry knows whose transcript is not yet on disk is a `found: false` RESULT — the reader falls
 * back to scanning the projects root, and a board Metis having no sessions row of her own is
 * exactly that case.
 */
const readKanbanMetisTranscript = async (sessionId: string): Promise<SubagentTranscriptResult> =>
  readApiJson<SubagentTranscriptResult>(
    await get(`/api/kanban-metis/sessions/${encodeURIComponent(sessionId)}/transcript`),
  );

/**
 * The lesson index's ceiling, as the route states it (`learning.routes.ts` — a larger `limit` is
 * REFUSED there, not clamped, so this is as much of the corpus as one read can carry).
 *
 * It is exported because the index answers with rows and no total: a caller that receives exactly
 * this many rows cannot tell a corpus of this size from a cut one, and the only honest thing to say
 * about the list is then "at least this many". The reader that says it lives in
 * `memory-intake/hooks/useLessonReview.ts`; the number lives here, beside the call that sends it.
 */
export const LESSON_LIST_LIMIT = 500;

/** The deadline of an Edit Agent Chains write: the relay's own 90 s for the CLI, with the network's margin. */
const AGENT_LAUNCH_WRITE_TIMEOUT_MS = 95_000;

// ─── API endpoints ──────────────────────────────────────────────────────────
// Every `/api/...` path the frontend talks to is declared here; components
// import a named method instead of assembling URLs of their own.

export const api = {
  // Auth endpoints (no token required)
  auth: {
    // The boot gate awaits this one, so it gets a SHORTER deadline than the rest: the app is
    // showing nothing but a spinner until it answers, and AuthContext retries with a longer one.
    status: (timeoutMs: number = BOOT_REQUEST_TIMEOUTS_MS[0]) =>
      fetch('/api/auth/status', { signal: requestTimeoutSignal(timeoutMs) }),
    login: (username: string, password: string) => fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    }),
    register: (username: string, password: string) => fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    }),
    refresh: () => post('/api/auth/refresh'),
    // The page's own record of why its session ended or was kept, for the server's journal.
    clientEvents: (events: AuthTraceEvent[]) => post('/api/auth/client-events', { events }),
    user: (timeoutMs: number = BOOT_REQUEST_TIMEOUTS_MS[0]) => get('/api/auth/user', { timeoutMs }),
  },

  // Protected endpoints
  // config endpoint removed - no longer needed (frontend uses window.location)
  // After the projectName → projectId migration the path/query identifier is
  // the DB-assigned `projectId`; parameter names reflect that for clarity.
  projects: {
    list: () => get('/api/projects'),
    // Assigns a project's sessions to a node's warden, or back to this server with `null`: the next CLI a
    // chat in the project needs is spawned there. Answers 204; a node that is not on this machine is
    // refused with 409 `PROJECT_NODE_NOT_COLOCATED`.
    setNode: (projectId: string, node: string | null) =>
      put(`/api/projects/${encodeURIComponent(projectId)}/node`, { node }),
  },
  archivedProjects: () => get('/api/projects/archived'),
  projectSessions: (
    projectId: string,
    { limit = 20, offset = 0 }: { limit?: number; offset?: number } = {},
    options: ApiRequestOptions = {},
  ) =>
    get(
      `/api/projects/${encodeURIComponent(projectId)}/sessions${query({ limit, offset })}`,
      options,
    ),
  projectTaskmaster: (projectId: string) =>
    get(`/api/projects/${encodeURIComponent(projectId)}/taskmaster`),
  renameProject: (projectId: string, displayName: string) =>
    put(`/api/projects/${projectId}/rename`, { displayName }),
  restoreProject: (projectId: string) =>
    post(`/api/projects/${encodeURIComponent(projectId)}/restore`),
  // `hardDelete` => server `?force=true` (remove DB row + Claude *.jsonl + sessions rows for path).
  deleteProject: (projectId: string, hardDelete = false) =>
    del(`/api/projects/${projectId}${query({ force: hardDelete })}`),
  createProject: (projectData: unknown) => post('/api/projects/create-project', projectData),
  migrateLegacyProjectStars: (projectIds: string[]) =>
    post('/api/projects/migrate-legacy-stars', { projectIds }),
  toggleProjectStar: (projectId: string) =>
    post(`/api/projects/${encodeURIComponent(projectId)}/toggle-star`),
  // EventSource cannot send an Authorization header, so the token rides along as
  // a query parameter on the streaming endpoints below.
  cloneProjectProgressUrl: (params: Record<string, QueryValue>) =>
    `/api/projects/clone-progress${query({ ...params, token: getStoredAuthToken() })}`,
  searchConversationsUrl: (searchQuery: string, limit = 50) =>
    `/api/providers/search/sessions${query({
      q: searchQuery,
      limit,
      token: getStoredAuthToken(),
    })}`,

  // Session endpoints. Provider/project metadata are resolved by the backend
  // from the session id.
  // Session deletion mirrors project deletion:
  // - default: archive only (`isArchived = 1`)
  // - hardDelete: remove the row and, by default, its persisted transcript file
  deleteSession: (sessionId: string, hardDelete = false) =>
    del(`/api/providers/sessions/${sessionId}${query({ force: hardDelete })}`),
  getArchivedSessions: () => get('/api/providers/sessions/archived'),
  // Resolves one session (by app id or provider-native id) to its metadata and
  // owning project — used when a /session/<id> URL isn't in loaded payloads.
  sessionDetails: (sessionId: string) =>
    get(`/api/providers/sessions/${encodeURIComponent(sessionId)}`),
  runningSessions: () => get('/api/providers/sessions/running'),
  recentConversations: (
    { limit = 40, offset = 0, simpleList }: { limit?: number; offset?: number; simpleList?: boolean } = {},
  ) => get(`/api/providers/sessions/recent${query({ limit, offset, simpleList })}`),
  providerSessionId: (sessionId: string) =>
    get(`/api/providers/sessions/${encodeURIComponent(sessionId)}/provider-id`),
  restoreSession: (sessionId: string) => post(`/api/providers/sessions/${sessionId}/restore`),
  // Creates an independent session holding this one's conversation up to
  // `upToAnchorId` (all of it when omitted). The source is left untouched.
  forkSession: (sessionId: string, body: { upToAnchorId?: string; title?: string } = {}) =>
    post(`/api/providers/sessions/${encodeURIComponent(sessionId)}/fork`, body),
  renameSession: (sessionId: string, summary: string) =>
    put(`/api/providers/sessions/${sessionId}`, { summary }),
  // Sets or clears the icon a chat carries in the simple list. `null` restores
  // the default glyph.
  setSessionIcon: (sessionId: string, icon: string | null) =>
    put(`/api/providers/sessions/${encodeURIComponent(sessionId)}/icon`, { icon }),

  // The simple list's folders and the place of its rows. The feed keeps its own
  // helper (`recentConversations`) above.
  simpleList: {
    createFolder: (name: string) => post('/api/providers/simple-list/folders', { name }),
    updateFolder: (folderId: string, change: { name?: string; collapsed?: boolean }) =>
      patch(`/api/providers/simple-list/folders/${encodeURIComponent(folderId)}`, change),
    deleteFolder: (folderId: string) => del(`/api/providers/simple-list/folders/${encodeURIComponent(folderId)}`),
    move: (item: SimpleListItemRef, position: SimpleListPosition) =>
      put('/api/providers/simple-list/position', { item, folderId: position.folderId, after: position.after }),
  },

  // Scheduled messages: send a message to a session at a future time.
  scheduledMessages: {
    list: (sessionId?: string) =>
      get(`/api/scheduled-messages${sessionId ? query({ sessionId }) : ''}`),
    create: (body: { sessionId: string; content: string; scheduledFor: string; options?: unknown }) =>
      post('/api/scheduled-messages', body),
    cancel: (id: string) => del(`/api/scheduled-messages/${encodeURIComponent(id)}`),
  },

  // Workspace file tree
  readFile: (projectId: string, filePath: string) =>
    get(`/api/file-tree/projects/${projectId}/file${query({ filePath })}`),
  // Raw bytes for a workspace file. The endpoint requires the auth header, so
  // media call sites fetch a blob through here instead of using a bare `src`.
  // No deadline by default: these are raw bytes, and a large file over a slow link (Tailscale,
  // mobile) would otherwise be aborted mid-body and read as a broken file.
  readFileBlob: (projectId: string, filePath: string, options: ApiRequestOptions = {}) =>
    get(fileContentPath(projectId, filePath), { timeoutMs: NO_REQUEST_TIMEOUT, ...options }),
  getFiles: (projectId: string, options: ApiRequestOptions = {}) =>
    get(`/api/file-tree/projects/${projectId}/files${query({ respectGitignore: true })}`, options),

  // The file manager's two reads. `path` is relative to the project root; empty means the root
  // itself, which is why it goes through `query()` (it drops the empty value) rather than being
  // interpolated. Both answer `DirectoryListing` / `FilePreview`; the server clamps `lines`.
  listDirectory: (projectId: string, path: string, options: ApiRequestOptions = {}) =>
    get(`/api/file-tree/projects/${projectId}/list${query({ path })}`, options),
  // `start` is the first line of the window — 1 for the top of the file, and `line - 40` when a
  // file reference asked for a line. The server clamps it to at least 1 and answers an empty
  // window for a start past the end, so nothing here has to know how long the file is.
  previewFile: (
    projectId: string,
    path: string,
    lines = 200,
    start = 1,
    options: ApiRequestOptions = {},
  ) => get(`/api/file-tree/projects/${projectId}/preview${query({ path, lines, start })}`, options),
  // One window of whole lines read for editing, at `start` (1-based, clamped to at least 1).
  // `lines` is clamped by the server to 1-400.
  editWindow: (projectId: string, path: string, start: number, lines: number) =>
    get(`/api/file-tree/projects/${projectId}/edit-window${query({ path, start, lines })}`),
  // Replaces one contiguous range of original lines. `baseRev` is the revision the range was
  // read from; a moved file is refused with a 409 rather than overwritten.
  patchFile: (projectId: string, body: FileLinePatch) =>
    patch(`/api/file-tree/projects/${projectId}/edit`, body),

  // File operations
  createFile: (
    projectId: string,
    { path, type, name }: { path: string; type: string; name: string },
  ) => post(`/api/file-tree/projects/${projectId}/files/create`, { path, type, name }),

  renameFile: (projectId: string, { oldPath, newName }: { oldPath: string; newName: string }) =>
    put(`/api/file-tree/projects/${projectId}/files/rename`, { oldPath, newName }),

  deleteFile: (projectId: string, { path, type }: { path: string; type: string }) =>
    del(`/api/file-tree/projects/${projectId}/files`, { path, type }),

  // Uploads with a progress bar go through XMLHttpRequest, which needs the URL.
  uploadFilesUrl: (projectId: string) =>
    `/api/file-tree/projects/${encodeURIComponent(projectId)}/files/upload`,

  // Browse filesystem for project suggestions
  browseFilesystem: (dirPath: string | null = null) =>
    get(`/api/file-tree/browse-filesystem${query({ path: dirPath })}`),

  createFolder: (folderPath: string) => post('/api/file-tree/create-folder', { path: folderPath }),

  // Git READ endpoints. The `project` param carries the DB projectId post-migration.
  // There is no write helper here on purpose: the source-control panel reads, and every
  // commit or push goes through the agent run it delegates to. The server's own write
  // routes still exist and are untouched — nothing in the client calls them.
  git: {
    status: (projectId: string, options: ApiRequestOptions = {}) =>
      get(`/api/git/status${query({ project: projectId })}`, options),
    diff: (projectId: string, filePath: string, options: ApiRequestOptions = {}) =>
      get(`/api/git/diff${query({ project: projectId, file: filePath })}`, options),
    commitDiff: (projectId: string, commit: string) =>
      get(`/api/git/commit-diff${query({ project: projectId, commit })}`),
    branches: (projectId: string, options: ApiRequestOptions = {}) =>
      get(`/api/git/branches${query({ project: projectId })}`, options),
    remoteStatus: (projectId: string) =>
      get(`/api/git/remote-status${query({ project: projectId })}`),
    commits: (
      projectId: string,
      { limit }: { limit?: number } = {},
      options: ApiRequestOptions = {},
    ) => get(`/api/git/commits${query({ project: projectId, limit })}`, options),
  },

  // Provider (coding agent) endpoints — models, capabilities, sessions, MCP, skills.
  providers: {
    capabilities: () => get('/api/providers/capabilities'),
    authStatus: (provider: string) =>
      get(`/api/providers/${encodeURIComponent(provider)}/auth/status`),

    models: (provider: string) => get(`/api/providers/${provider}/models`),
    createModel: (provider: string, input: unknown) =>
      post(`/api/providers/${provider}/models`, input),
    updateModel: (provider: string, recordId: string | number, input: unknown) =>
      patch(`/api/providers/${provider}/models/${recordId}`, input),
    deleteModel: (provider: string, recordId: string | number) =>
      del(`/api/providers/${provider}/models/${recordId}`),

    createSession: (payload: {
      provider: string;
      projectPath: string;
      initialMessage?: unknown;
      simpleList?: boolean;
    }) => post('/api/providers/sessions', payload),
    sessionMessages: (
      sessionId: string,
      pagination: { limit?: number | null; offset?: number } = {},
      options: ApiRequestOptions = {},
    ) => get(sessionMessagesUrl(sessionId, pagination), options),
    sessionTokenUsage: (sessionId: string) =>
      get(`/api/providers/sessions/${encodeURIComponent(sessionId)}/token-usage`),
    sessionActiveModel: (provider: string, sessionId: string) =>
      get(`/api/providers/${provider}/sessions/${encodeURIComponent(sessionId)}/active-model`),
    setSessionActiveModel: (provider: string, sessionId: string, model: string) =>
      post(`/api/providers/${provider}/sessions/${encodeURIComponent(sessionId)}/active-model`, {
        model,
      }),
    setSessionActiveEffort: (provider: string, sessionId: string, effort: string) =>
      post(`/api/providers/${provider}/sessions/${encodeURIComponent(sessionId)}/active-effort`, {
        effort,
      }),

    mcpServers: (
      provider: string,
      { scope, workspacePath }: { scope: string; workspacePath?: string },
    ) => get(`/api/providers/${provider}/mcp/servers${query({ scope, workspacePath })}`),
    saveMcpServer: (provider: string, payload: unknown) =>
      post(`/api/providers/${provider}/mcp/servers`, payload),
    deleteMcpServer: (
      provider: string,
      serverName: string,
      { scope, workspacePath }: { scope: string; workspacePath?: string },
    ) =>
      del(
        `/api/providers/${provider}/mcp/servers/${encodeURIComponent(serverName)}${query({ scope, workspacePath })}`,
      ),
    saveGlobalMcpServer: (payload: unknown) => post('/api/providers/mcp/servers/global', payload),

    skills: (provider: string, { workspacePath }: { workspacePath?: string } = {}) =>
      get(`/api/providers/${encodeURIComponent(provider)}/skills${query({ workspacePath })}`),
    saveSkills: (provider: string, payload: unknown) =>
      post(`/api/providers/${provider}/skills`, payload),
  },

  // Slash commands
  commands: {
    // `projectPath` stays optional: a workspace without a resolved path omits
    // the field entirely, which is what the server expects.
    list: (projectPath: string | undefined) => post('/api/commands/list', { projectPath }),
    execute: (payload: unknown) => post('/api/commands/execute', payload),
  },

  // Chat attachments, stored globally under ~/.cloudcli/assets
  assets: {
    uploadFiles: (formData: FormData) =>
      authenticatedFetch('/api/assets/files', {
        method: 'POST',
        headers: {}, // Let browser set Content-Type for FormData
        body: formData,
      }),
    // No deadline by default, for the reason `readFileBlob` has none: a 200MB attachment
    // pulled over a slow link would otherwise be aborted mid-body and read as a broken file.
    file: (storedName: string, options: ApiRequestOptions = {}) =>
      get(`/api/assets/files/${encodeURIComponent(storedName)}`, { timeoutMs: NO_REQUEST_TIMEOUT, ...options }),
    image: (filename: string, options: ApiRequestOptions = {}) =>
      get(`/api/assets/images/${encodeURIComponent(filename)}`, { timeoutMs: NO_REQUEST_TIMEOUT, ...options }),
  },

  // TaskMaster endpoints — all addressed by DB projectId post-migration.
  taskmaster: {
    // Update a task
    updateTask: (projectId: string, taskId: string | number, updates: unknown) =>
      put(`/api/taskmaster/update-task/${projectId}/${taskId}`, updates),

    tasks: (projectId: string) => get(`/api/taskmaster/tasks/${encodeURIComponent(projectId)}`),
    mcpStatus: () => get('/api/taskmaster/mcp-status'),
    installationStatus: () => get('/api/taskmaster/installation-status'),

    prdFiles: (projectId: string) => get(`/api/taskmaster/prd/${encodeURIComponent(projectId)}`),
    prdFile: (projectId: string, fileName: string) =>
      get(`/api/taskmaster/prd/${encodeURIComponent(projectId)}/${encodeURIComponent(fileName)}`),
    savePrd: (projectId: string, { fileName, content }: { fileName: string; content: string }) =>
      post(`/api/taskmaster/prd/${encodeURIComponent(projectId)}`, { fileName, content }),
  },

  // User endpoints
  user: {
    gitConfig: () => get('/api/user/git-config'),
    updateGitConfig: (gitName: string, gitEmail: string) =>
      post('/api/user/git-config', { gitName, gitEmail }),
    onboardingStatus: () => get('/api/user/onboarding-status'),
    completeOnboarding: () => post('/api/user/complete-onboarding'),

    // Preferences and chat drafts live server-side so they follow the user
    // from one device to another. `savePreferences` is a merge-patch: only the
    // keys it is given are written.
    preferences: () => get('/api/user/preferences'),
    savePreferences: (updates: Record<string, unknown>) =>
      patch('/api/user/preferences', updates),
    drafts: () => get('/api/user/drafts'),
    /** Writes only the text; the scope's stored queued message is left as the server has it. */
    saveDraft: (scope: string, draft: { text: string }) =>
      put('/api/user/drafts', { scope, ...draft }),
    /** Appends to the scope's queued message on the server and answers the message that is now queued. */
    appendQueuedMessage: (scope: string, queuedMessage: unknown) =>
      post('/api/user/drafts/queued-message', { scope, queuedMessage }),
    clearQueuedMessage: (scope: string) => del('/api/user/drafts/queued-message', { scope }),
  },

  // Server-side settings: API keys, stored credentials, notifications, web push
  settings: {
    apiKeys: () => get('/api/settings/api-keys'),
    createApiKey: (keyName: string) => post('/api/settings/api-keys', { keyName }),
    deleteApiKey: (keyId: string) => del(`/api/settings/api-keys/${keyId}`),
    toggleApiKey: (keyId: string, isActive: boolean) =>
      patch(`/api/settings/api-keys/${keyId}/toggle`, { isActive }),

    credentials: (type: string) => get(`/api/settings/credentials${query({ type })}`),
    createCredential: (payload: {
      credentialName: string;
      credentialType: string;
      credentialValue: string;
      description?: string;
    }) => post('/api/settings/credentials', payload),
    deleteCredential: (credentialId: string) => del(`/api/settings/credentials/${credentialId}`),
    toggleCredential: (credentialId: string, isActive: boolean) =>
      patch(`/api/settings/credentials/${credentialId}/toggle`, { isActive }),

    notificationPreferences: () => get('/api/settings/notification-preferences'),
    saveNotificationPreferences: (preferences: unknown) =>
      put('/api/settings/notification-preferences', preferences),

    // The plan runner's DeepSeek switch — a file on this host, not a per-user preference, so it
    // is the same answer for anyone signed in and both calls return the state read back off disk.
    deepseekFlash: () => get('/api/settings/deepseek-flash'),
    saveDeepseekFlash: (enabled: boolean) => put('/api/settings/deepseek-flash', { enabled }),
    deepseekFeatures: () => get('/api/settings/deepseek-features'),
    saveDeepseekFeatures: (enabled: boolean) => put('/api/settings/deepseek-features', { enabled }),

    // The dispatcher's planner-lane dial — how many planners (designs, cuts, judgments) may be out at
    // once. A fifth flag file on this host, in the same host-wide shape and with the same read-back
    // answer: `lanes` is the whole number the file holds, at least 1, with no "all" above it.
    plannerLanes: () => get('/api/settings/planner-lanes'),
    savePlannerLanes: (state: { lanes: number }) => put('/api/settings/planner-lanes', state),

    // The usage pacer's weekly stop — where plans stop starting on the weekly window. Host-wide with the
    // same read-back answer: `percent` is the whole number the file holds, 50 to 99, 95 when none is set.
    weeklyStop: () => get('/api/settings/weekly-stop'),
    saveWeeklyStop: (state: { percent: number }) => put('/api/settings/weekly-stop', state),

    // The dispatcher's park-at-peak switch — the fourth flag file on this host, and the same shape
    // as the three above for the same reason: a file the dispatcher's own process re-reads, not a
    // preference the browser owns. On, an Accept during DeepSeek's peak window queues the plan and
    // arms the hour it lifts; off, Accept walks now. Both calls answer with the state read back off
    // disk, never with what was sent.
    parkAtPeakSwitch: () => get('/api/settings/park-at-peak'),
    saveParkAtPeakSwitch: (state: { enabled: boolean }) =>
      put('/api/settings/park-at-peak', state),

    // The Claude API keys' own door — a store on this host, host-wide like the switches above and
    // no per-user preference. The GET answers the door's picture (`claude-api status --json`):
    // which payer rides and why, both slots, the pace — never a key. The PUT takes ONE slot's save
    // (`key` only when the reader typed one) and answers a fresh picture; its 422 is the door's own
    // refusal sentence. The DELETE clears a slot and answers the same. THE BODY IS NEVER LOGGED,
    // ECHOED OR PUT IN AN ERROR: it carries a key, and a key reaches the door's stdin only.
    claudeApi: () => get('/api/settings/claude-api'),
    saveClaudeApiKey: (slot: number, body: ClaudeApiKeySave) =>
      put(`/api/settings/claude-api/${slot}`, body),
    removeClaudeApiKey: (slot: number) => del(`/api/settings/claude-api/${slot}`),

    // The plan runner's Dactyls switch — the fifth flag file in this shape: whether Hephaestus on
    // Claude hands his code edits to one-file children. The GET answers the position read off the file
    // beside the verb's readiness (`model`, `effort`, `ready`, `why`, each null when that call failed);
    // the PUT answers the same, with the position read back off the file, never what was sent.
    dactylsSwitch: () => get('/api/settings/dactyls'),
    saveDactylsSwitch: (state: { enabled: boolean }) => put('/api/settings/dactyls', state),

    // The Custom compaction switch — the sixth flag file in this shape: whether a CloudCLI chat's
    // compaction is written by the launch table's `[summarizer]` words instead of by the CLI. The GET
    // answers the position read off the file beside `summarize --status`'s details (`model`, `effort`,
    // `ready`, `why`, each null when that call failed); the PUT answers the same, with the position
    // read back off the file, never what was sent.
    customCompactionSwitch: () => get('/api/settings/custom-compaction'),
    saveCustomCompactionSwitch: (state: { enabled: boolean }) =>
      put('/api/settings/custom-compaction', state),

    // The Dactyls-for-the-main-session switch — the seventh flag file in this shape: whether a main session
    // changes a repository file only through a dactyl. The GET answers the position read off the file beside
    // `dactyl --session-status`'s details (`model`, `effort`, `ready`, `why` and the week's `hand` ledger,
    // each null when that call failed); the PUT answers the same, with the position read back off the file,
    // never what was sent.
    mainSessionDactylsSwitch: () => get('/api/settings/main-session-dactyls'),
    saveMainSessionDactylsSwitch: (state: { enabled: boolean }) =>
      put('/api/settings/main-session-dactyls', state),

    // The heal reflex's MASTER switch — the reflex's whole launching, on one word. `off` stops it
    // launching from the next ending onwards while an ending still indexes, and the typed `/heal`
    // door is never gated by it; `on` is what the flag file being absent has always meant. Same
    // host-wide shape as the two above, for the same reason: a file on this host, not a preference
    // the browser owns.
    healMaster: () => get('/api/settings/heal-master'),
    saveHealMaster: (enabled: boolean) => put('/api/settings/heal-master', { enabled }),

    // The reflex's two knob files, beside the master switch and in the shape of the switches above: the
    // nightly cycle's schedule (on/off and its UTC hour) and the day's spend ceiling. Both answer
    // the state read back off disk, never what was typed. `usd: null` is NO CEILING.
    healCycle: () => get('/api/settings/heal-cycle'),
    saveHealCycle: (state: { enabled: boolean; hour: number }) => put('/api/settings/heal-cycle', state),
    healCap: () => get('/api/settings/heal-cap'),
    saveHealCap: (usd: number | null) => put('/api/settings/heal-cap', { usd }),
    geminiPlanCap: () => get('/api/settings/gemini-plan-cap'),
    saveGeminiPlanCap: (usd: number) => put('/api/settings/gemini-plan-cap', { usd }),

    // The heal reflex's MODEL switch — which model a heal's souls run on, its own file beside the
    // chat composer's DeepSeek switch rather than the same one, so the two can disagree: the heal's
    // choice never moves the chat's, and the chat's never moves the heal's. The body is ALWAYS one of
    // the two words — the file names a side in every state, and an absent file means `deepseek`.
    healModel: () => get('/api/settings/heal-model'),
    saveHealModel: (model: 'deepseek' | 'claude') =>
      put('/api/settings/heal-model', { model }),

    // The house Jev switches, same shape of answer for the same reason: flag files on this host,
    // not per-user preferences. `saveJev` sends only the switches named, so a PUT that moves one
    // never moves another, and both calls answer with the state read back off disk.
    jev: () => get('/api/settings/jev'),
    saveJev: (patch: { master?: boolean; prompts?: boolean; toolOutput?: boolean }) =>
      put('/api/settings/jev', patch),

    push: {
      vapidPublicKey: () => get('/api/settings/push/vapid-public-key'),
      subscribe: (subscription: { endpoint?: string; keys?: unknown }) =>
        post('/api/settings/push/subscribe', subscription),
      unsubscribe: (endpoint: string) => post('/api/settings/push/unsubscribe', { endpoint }),
    },
  },

  // The ntfy phone-push channel. It sits here rather than under `settings` because its
  // routes are the notifications module's own, mounted on /api/notifications — and because
  // its topic and access token never come back: `get` answers a masked view, and `save`
  // omits what the user did not type so an untouched form cannot erase a stored token.
  notifications: {
    ntfy: {
      get: () => get('/api/notifications/ntfy'),
      save: (input: NtfySettingsInput) => put('/api/notifications/ntfy', input),
      remove: () => del('/api/notifications/ntfy'),
      test: () => post('/api/notifications/ntfy/test'),
    },
  },

  plugins: {
    list: () => get('/api/plugins'),
    install: (url: string) => post('/api/plugins/install', { url }),
    uninstall: (name: string) => del(`/api/plugins/${encodeURIComponent(name)}`),
    update: (name: string) => post(`/api/plugins/${encodeURIComponent(name)}/update`),
    toggle: (name: string, enabled: boolean) =>
      put(`/api/plugins/${encodeURIComponent(name)}/enable`, { enabled }),
    // Plugin bundles/icons are fetched with auth headers and handed to the
    // browser as blobs, so a bare asset URL is never requested unauthenticated.
    asset: (pluginName: string, assetFile: string) => get(pluginAssetPath(pluginName, assetFile)),
    // Exposed so the icon cache can key on the resolved asset path.
    assetUrl: pluginAssetPath,
    rpc: (pluginName: string, method: string, path: string, body?: unknown) =>
      authenticatedFetch(
        `/api/plugins/${encodeURIComponent(pluginName)}/rpc/${String(path).replace(/^\//, '')}`,
        {
          method: method || 'GET',
          ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        },
      ),
  },

  browserUse: {
    status: () => get('/api/browser-use/status'),
    settings: () => get('/api/browser-use/settings'),
    saveSettings: (settings: unknown) => put('/api/browser-use/settings', settings),
    sessions: () => get('/api/browser-use/sessions'),
    stopSession: (sessionId: string) => post(`/api/browser-use/sessions/${sessionId}/stop`),
    deleteSession: (sessionId: string) => del(`/api/browser-use/sessions/${sessionId}`),
    // npm install plus `playwright install chromium` behind one response: minutes of work and
    // a ~150MB download. The ceiling reported a failure over an install that was still running.
    installRuntime: () => post('/api/browser-use/runtime/install', undefined, { timeoutMs: NO_REQUEST_TIMEOUT }),
  },

  voice: {
    health: () => get('/api/voice/health'),
    transcribe: (formData: FormData, headers: Record<string, string> = {}) =>
      authenticatedFetch('/api/voice/transcribe', {
        method: 'POST',
        headers,
        body: formData,
      }),
    tts: (text: string, options: ApiRequestOptions = {}) => post('/api/voice/tts', { text }, options),
    // The account's chat-mic provider and Gemini transcription model, with the status of its one Gemini key:
    // `{ settings: VoiceSettings, key: GeminiKeyStatus }`. A save answers the same shape; the key calls answer `{ key }`.
    // The key goes out on its save and never comes back, only its status. A refusal is a 400 `VOICE_SETTINGS_INVALID`.
    settings: () => get('/api/voice/settings'),
    saveSettings: (patch: VoiceSettingsPatch) => put('/api/voice/settings', patch),
    saveGeminiKey: (key: string) => put('/api/voice/gemini-key', { key }),
    clearGeminiKey: () => del('/api/voice/gemini-key'),
  },

  // Kaylee, the voice companion. Every call names THIS page to her in `x-companion-client`: the page that last typed or
  // opened her panel holds the floor, and a chat she opens is opened on that page alone. A refusal is the app's own
  // envelope, so `refusalSentence` reads the words the panel shows. Her sentences, draft and notes come back as
  // `companion_*` frames on the socket, not as answers here; the answers carry only what the caller folds in itself.
  companion: {
    // Her whole picture: the settings, the models, the process, the activity, the draft, the walk, the notes, the log.
    picture: () => get('/api/companion', companionOptions()),
    sendText: (text: string) => post('/api/companion/messages', { text }, companionOptions()),
    // The panel opened on this page: she acts on it from now on.
    floor: () => post('/api/companion/floor', undefined, companionOptions()),
    // A partial of her settings; `register: null` restores the original register. Answers the settings as they now read.
    saveSettings: (patch: Partial<CompanionSettings> | { register: null }) => put('/api/companion/settings', patch, companionOptions()),
    editDraft: (text: string) => put('/api/companion/draft', { text }, companionOptions()),
    clearDraft: () => del('/api/companion/draft', undefined, companionOptions()),
    // His × on the card of the action waiting for his word: it comes off his panel, withdrawn. Answers 204 whether or not one was standing;
    // the provider clears that action from its picture on the 2xx (only while it still holds it), and the frame the route sends carries the pending that stands.
    cancelAction: () => del('/api/companion/action', undefined, companionOptions()),
    // Sends the draft as it stands. Answers `{ outcome: 'started' | 'folded' }`; a refused send is a 409 carrying the reason.
    sendDraft: (mode: 'turn' | 'steer') => post('/api/companion/draft/send', { mode }, companionOptions()),
    dismissNote: (id: number) => del(`/api/companion/notes/${id}`, undefined, companionOptions()),
    // Stops her own turn; the chat sessions she talks about are not touched.
    interrupt: () => post('/api/companion/interrupt', undefined, companionOptions()),
    // Wipes her conversation, log, notes, draft, walk and focus. The wind-down of her process is awaited, so it can take a while.
    clear: () => post('/api/companion/clear', undefined, { ...companionOptions(), timeoutMs: 90_000 }),
    // His talk press: the clip as multipart `audio` (named by its type, as the chat's mic names its upload) and the recorder's own
    // `durationMs` for it. Takes the floor for this page and answers 202 `{ text }` once the press has been heard and pushed to her;
    // a hearing that came to nothing is a 409 `COMPANION_SPEECH_REFUSED` or a 502 `COMPANION_SPEECH_FAILED` carrying the sentence,
    // and the system line in her log. An upload has no deadline of its own (see `timeoutSignal`).
    press: (blob: Blob, mimeType: string, durationMs: number) => {
      const body = new FormData();
      body.append('audio', blob, recordingFileName(mimeType));
      body.append('durationMs', String(Math.round(durationMs)));
      return authenticatedFetch('/api/companion/press', { method: 'POST', body, ...companionOptions() });
    },
    // One of her sentences as raw PCM (24 kHz, mono, signed 16-bit little-endian), asked by the page that holds the floor. Answers the
    // Response itself, its body still arriving, for the player to read: 200 audio, 204 nothing to say, 404 `COMPANION_NO_SENTENCE`,
    // 409 `COMPANION_NOT_FLOOR` or `COMPANION_SPEECH_REFUSED` (Google's refusal in a sentence; the server has written the panel's line),
    // 502 `COMPANION_SPEECH_FAILED`. `signal` is the request's only deadline (a sentence streams for as long as it is spoken): aborting
    // it hangs up, which stops the synthesis when no other request is reading it.
    speech: (turnId: string, index: number, signal: AbortSignal) =>
      get(`/api/companion/speech/${encodeURIComponent(turnId)}/${index}`, { ...companionOptions(), signal }),
    // The talk press while she sounds: `heard` is the last sentence of the turn whose playback ended and `interrupted` the one playing
    // at the press (`null` for none). Answers 204 once her turn has been stopped, which can take seconds; her next message opens with `<cut>`.
    cut: (input: { turnId: string; heard: number | null; interrupted: number | null }) =>
      post('/api/companion/cut', input, companionOptions()),
  },

  system: {
    // `git pull && npm install`, answered on completion. Aborting the WAIT never aborted the
    // update — it only told the user it had failed, inviting a second one onto the same tree.
    update: () => post('/api/system/update', undefined, { timeoutMs: NO_REQUEST_TIMEOUT }),
  },

  // The Claude update pipeline (MAN-7401–MAN-7404 are the check, the install/restart backend and this
  // client's own row; MAN-7408–MAN-7414 are the reference form): what the two Claude
  // packages are on, what npm has, the two presses that move them, and the switch that makes the app
  // press the first itself when no Claude work is running. The report is also what every action
  // answers with, so one read serves the tab, the cards and the sidebar row — `setAutoInstall`
  // included: its position comes back in the report's own `autoInstall` block.
  //
  // `check` opts out of the request ceiling for the same reason `system.update` does: it waits out
  // however long npm takes to answer, and a ceiling here would report a check that is still running
  // as a failed one.
  //
  // `apply` and `restart` refuse with a `ClaudeUpdateRefusal` — a 400/409 whose `message` is the
  // sentence the tab shows under the button that asked. The caller reads it off the raw response
  // rather than through `readApiJson`, because the status IS the answer.
  claudeUpdates: {
    report: () => get('/api/claude-updates'),
    check: () => post('/api/claude-updates/check', undefined, { timeoutMs: NO_REQUEST_TIMEOUT }),
    apply: (request: ClaudeUpdateApplyRequest) => post('/api/claude-updates/apply', request),
    restart: () => post('/api/claude-updates/restart'),
    setAutoInstall: (enabled: boolean) => put('/api/claude-updates/auto-install', { enabled }),
  },

  // The Claude account lane and its usage meter, served by the server's own accounts module.
  // Both reads answer 200 whatever the state — the calm `{reachable:false, reason}` when nothing
  // can be computed — so a caller reads the BODY rather than the status. Every write carries the
  // service's OWN status and body through, which is why they are read from the raw response and
  // never through `readApiJson`; a door write's refusal is a 422 whose `error` is the door's own words.
  accounts: {
    // `picture`, not `accounts`: the group is already named for the lane, and the panel calls this
    // body a picture everywhere it appears. The body is the door's own picture under `reachable`.
    picture: () => get('/api/accounts'),
    usage: () => get('/api/usage'),
    // The door's three writes: choose the account in use, turn the automatic switch on or off, and
    // remove an account with its token. Each answers the door's line on 200 or its refusal on 422.
    use: (slug: string) => post('/api/accounts/use', { slug }),
    auto: (on: boolean) => post('/api/accounts/auto', { on }),
    remove: (slug: string) => post('/api/accounts/remove', { slug }),
  },

  // The memory-intake lane (docs/MANUAL.md (memory-intake)): what a session PROPOSES and a person reviews.
  // The reads answer 200 with the `reachable` envelope the panel, the Inbox's waiting count and the
  // command palette all branch on — it is a fact about the read now rather than about a remote server, and
  // no shape moved when the lane moved here. The two writes are read from the RAW response for the
  // same reason the accounts writes are: a 422 is a VERDICT the caller reads — the cap guard
  // refusing in plain English, with the candidate left pending — never a failed request.
  memory: {
    pending: () => get('/api/memory'),
    approved: () => get('/api/memory?status=approved'),
    candidate: (id: string) => get(`/api/memory/${encodeURIComponent(id)}`),
    approve: (id: string) => post(`/api/memory/${encodeURIComponent(id)}/approve`, {}),
    reject: (id: string) => post(`/api/memory/${encodeURIComponent(id)}/reject`, {}),
  },

  // The notes lane (docs/MANUAL.md MAN-7517): one account's cards, read whole. The read answers the
  // list, newest first, which is exactly the shape the wall draws. The two saves answer the note they
  // wrote — a create's answer is read for the new note's id, which is what lets the card it was typed
  // in stay open on that note — but the list on screen still comes from the read that follows the
  // write, so a card is never drawn from an answer the server has already moved past. The two saves
  // take request options because autosave sends them `keepalive`, so a save on the way out of a page
  // outlives the page.
  notes: {
    list: () => get('/api/notes'),
    create: (input: NoteInput, options?: ApiRequestOptions) => post('/api/notes', input, options),
    update: (id: string, input: NoteInput, options?: ApiRequestOptions) => put(`/api/notes/${encodeURIComponent(id)}`, input, options),
    remove: (id: string) => del(`/api/notes/${encodeURIComponent(id)}`),
  },

  // The followups lane: one chat's next steps and known gaps, keyed on the chat's app session id. The
  // read answers the chat's items, open and done, oldest first; `setState` ticks (`done`) or unticks
  // (`open`) one and answers the item as stored. Both answer `{ success: true, data }`.
  followups: {
    list: (appSessionId: string) => get(`/api/followups?session=${encodeURIComponent(appSessionId)}`),
    setState: (id: number, state: 'open' | 'done') => patch(`/api/followups/${id}`, { state }),
  },

  // The tool-set lane (MAN-8490): which of the box's named MCP sets one chat has on.
  // Both verbs answer `{ success: true, data }` and a refusal is the app's `{ success: false, error }`
  // envelope, so a caller reads them through `readApiJson`. `read` answers the chat's `SessionToolsetsView`;
  // `set` answers the `ToolsetSwitchResult` of the switch, whose `view` is the read that would follow it,
  // so the menu draws from the answer and never asks twice. The chat is the APP's session id, and a set
  // goes by NAME only: no verb here carries a server config, and the box's file is the one place one lives.
  // The switch outlasts the default deadline by design: on a live chat the server waits up to 30 s for the
  // process to confirm the servers, and the answer that says `unconfirmed` or `failed` is the one the
  // menu exists to show, so the deadline is the `toolset` command's 45 s (bin/toolset.mjs), never 30.
  toolsets: {
    read: (sessionId: string) => get(`/api/toolsets/sessions/${encodeURIComponent(sessionId)}`),
    set: (sessionId: string, set: string, on: boolean) =>
      put(`/api/toolsets/sessions/${encodeURIComponent(sessionId)}/sets/${encodeURIComponent(set)}`, { on }, { timeoutMs: 45_000 }),
  },

  // The Cerberus lane (server/modules/cerberus/MANUAL.md): center's read model of the fleet, read
  // whole. Every read answers its wire shape BARE — not wrapped in `{ success, data }` — and a
  // refusal is the app's `{ success: false, error }` envelope. The `cerberus_changed` frame is only
  // a HINT that something moved: the screen reads again and draws the answer, never the frame. The
  // check read takes two moments — `lookup`, the instant the sentence is about, and `end`, where the
  // 60 cells and the recorded results stand; both are epoch milliseconds and both default to now.
  // The mute and the lift answer the `CerberusMute` they wrote and the label answers 204; nobody
  // draws from those answers, because the screen is drawn from the read that follows the write.
  cerberus: {
    // `options.signal` lets the one caller that must judge a hung read (the provider's stale rule) bring a deadline
    // of its own: a signal handed in replaces `REQUEST_TIMEOUT_MS`'s, which older WebKit cannot build.
    overview: (options: ApiRequestOptions = {}) => get('/api/cerberus/overview', options),
    checks: () => get('/api/cerberus/checks'),
    check: (node: string, service: string, id: string, { lookup, end }: { lookup?: number; end?: number } = {}) =>
      get(`/api/cerberus/checks/${encodeURIComponent(node)}/${encodeURIComponent(service)}/${encodeURIComponent(id)}${query({ lookup, end })}`),
    lookup: (node: string, key: string, at: number) => get(`/api/cerberus/lookup${query({ node, key, at })}`),
    // `before` is exclusive, newest first: "Show earlier" passes the `at` of the oldest line it holds.
    activity: ({ before, limit }: { before?: number; limit?: number } = {}) => get(`/api/cerberus/activity${query({ before, limit })}`),
    mute: (input: CerberusMuteInput) => post('/api/cerberus/mutes', input),
    liftMute: (id: string) => post(`/api/cerberus/mutes/${encodeURIComponent(id)}/lift`, {}),
    setLabel: (input: CerberusLabelInput) => put('/api/cerberus/labels', input),
    enroll: (input: CerberusEnrollInput) => post('/api/cerberus/enrollments', input),
    enrollment: (name: string) => get(`/api/cerberus/enrollments/${encodeURIComponent(name)}`),
    // The fixes (server/modules/cerberus/MANUAL.md): the catalog read answers every unretired entry; a write
    // answers the entry it wrote, which nobody draws from (the screen is the read that follows). `runEntry`
    // answers `{ runId }` once the warden has accepted, up to 10 s after the press; a 409 says why not
    // (`CERBERUS_RUN_ACTIVE`: the check has a run going, `CERBERUS_NODE_SILENT`: its warden is not linked,
    // `CERBERUS_NODE_UPDATING`: its warden is updating).
    // `run(id)` is one run with every line it holds, which `useRunOutput` reads before its frames append.
    catalog: (options: ApiRequestOptions = {}) => get('/api/cerberus/catalog', options),
    writeEntry: (input: CerberusCatalogEntryInput) => post('/api/cerberus/catalog', input),
    setAuto: (id: string, on: boolean) => put(`/api/cerberus/catalog/${encodeURIComponent(id)}/auto`, { on }),
    runEntry: (id: string) => post(`/api/cerberus/catalog/${encodeURIComponent(id)}/run`, {}),
    run: (id: string, options: ApiRequestOptions = {}) => get(`/api/cerberus/runs/${encodeURIComponent(id)}`, options),
    // The warden updates (server/modules/cerberus/MANUAL.md): `wardens` answers the release on offer, each node's
    // version against it and the batch running; `startUpdate` answers `{ batch, updates }` and the screen follows
    // the batch by `updateBatch` (every update of it, with its steps). A 409 says why not (`CERBERUS_UPDATE_RUNNING`:
    // a batch is already going, `CERBERUS_NO_RELEASE`: nothing is built).
    wardens: (options: ApiRequestOptions = {}) => get('/api/cerberus/wardens', options),
    startUpdate: (nodes: string[]) => post('/api/cerberus/updates', { nodes }),
    updateBatch: (batch: string, options: ApiRequestOptions = {}) => get(`/api/cerberus/updates/${encodeURIComponent(batch)}`, options),
    // The diagnosis (server/modules/cerberus/MANUAL.md): `diagnose` answers `{ id }` at once and the diagnosis runs on
    // in the background (no `model`: center picks its own; a probe passes one); `diagnosis(id)` is the whole
    // `CerberusDiagnosisView` with every step, which `useDiagnosis` reads before its `cerberus_diag_step` frames append.
    // `runProposal` answers `{ runId }` and never touches the catalog; `promote` answers the new entry and is the only
    // route that does. A 409 says why not (`CERBERUS_DIAG_RUNNING`: the check has a diagnosis going, and for a run:
    // no proposal, or its one-off has expired).
    diagnose: (input: { node: string; check: string; model?: string }) => post('/api/cerberus/diagnoses', input),
    diagnosis: (id: string, options: ApiRequestOptions = {}) => get(`/api/cerberus/diagnoses/${encodeURIComponent(id)}`, options),
    runProposal: (id: string) => post(`/api/cerberus/diagnoses/${encodeURIComponent(id)}/run`, {}),
    promote: (id: string, input: CerberusPromoteInput) => post(`/api/cerberus/diagnoses/${encodeURIComponent(id)}/promote`, input),
  },

  // The affected-areas lane (the Tours tab; wire shapes in `@/shared/affected-areas-types`): DocuSketch tours,
  // what the reader saw in each pano, and the operator's marks, forwarded to shadow-connector by CloudCLI. Every
  // answer is its wire shape BARE. A failure arrives in one of three bodies, so read `.error` AND `.detail`, never one:
  // `{ error: string }` from the lane itself (503 `no_secret` / `unreachable`, 502 `unreadable`, 422 a malformed id or
  // query value, 404 a path the lane does not forward); `{ detail: string }` or `{ detail: [...] }` from shadow-connector's
  // reader routes, passed through (404 `no such tour`, FastAPI's list-shaped 422); `{ error, detail }` (`Refusal`) from
  // its marks routes. The answer type of each verb is named beside it. Ids are encoded here, so a caller passes them as
  // it holds them.
  // The slow press, `readPano`, outlasts the default deadline by design: a read of a pano's views takes up to 120 s (the
  // lane's own deadline), and the answer that says `refused` is the one the screen shows.
  affectedAreas: {
    // → TourList
    tours: ({ q, limit }: { q?: string; limit?: number } = {}) => get(`/api/affected-areas/tours${query({ q, limit })}`),
    // → TourDetail
    tour: (tourId: string) => get(`/api/affected-areas/tours/${encodeURIComponent(tourId)}`),
    // → PanoDetail
    pano: (tourId: string, panoId: string) =>
      get(`/api/affected-areas/tours/${encodeURIComponent(tourId)}/panos/${encodeURIComponent(panoId)}`),
    // → ReadResult
    readPano: (tourId: string, panoId: string, body: ReadRequest) =>
      post(`/api/affected-areas/tours/${encodeURIComponent(tourId)}/panos/${encodeURIComponent(panoId)}/read`, body, { timeoutMs: 120_000 }),
    // The bytes of one view's JPEG, not JSON: the caller reads `.blob()`. `options.signal` lets it abort a fetch
    // whose view has since changed.
    image: (sha: string, options: ApiRequestOptions = {}) => get(`/api/affected-areas/images/${encodeURIComponent(sha)}`, options),
    // The day-one layout (wire shapes in `@/shared/affected-areas-layout-types`). `readLayout` is the layout press: six
    // views at high thinking, so it outlasts even `readPano` (the lane gives it 270 s), and `{ armed: false }` is the
    // dry run that answers `planned` with the count and the budgets and buys nothing. `buildPlan` rebuilds the plan from
    // what is stored, with no model, and spends nothing; the screen sends it once when it opens on a `stale` plan.
    // → LayoutReadResult
    readLayout: (tourId: string, panoId: string, body: ReadRequest) =>
      post(`/api/affected-areas/tours/${encodeURIComponent(tourId)}/panos/${encodeURIComponent(panoId)}/layout`, body, { timeoutMs: 270_000 }),
    // → LayoutPlanResult
    buildPlan: (tourId: string) => post(`/api/affected-areas/tours/${encodeURIComponent(tourId)}/layout/plan`, {}),
    // The bytes of one floor's drawing (`DayOneFloor.drawingSha`), an SVG, not JSON: the caller reads `.blob()`, as it does
    // for `image`. `options.signal` lets it abort a fetch whose floor has since changed.
    planDrawing: (sha: string, options: ApiRequestOptions = {}) => get(`/api/affected-areas/layout-drawings/${encodeURIComponent(sha)}`, options),
    // → Codebook
    codebook: () => get('/api/affected-areas/codebook'),
    // The marks writes (`mark`, `missed`, `markUnderstanding`, `setThreshold`) are the marks plan's. wire.py names the
    // answer of `markUnderstanding` alone; the others answer the shape the contract already holds for what they wrote.
    // → Region (the one judged, its `mark` filled)
    mark: (regionId: string, body: MarkRequest) => post(`/api/affected-areas/regions/${encodeURIComponent(regionId)}/marks`, body),
    // → Region (the new human one)
    missed: (sha: string, body: MissedRequest) => post(`/api/affected-areas/images/${encodeURIComponent(sha)}/regions`, body),
    // → UnderstandingMarkResult
    markUnderstanding: (readId: string, body: UnderstandingMarkRequest) =>
      post(`/api/affected-areas/reads/${encodeURIComponent(readId)}/marks`, body),
    // → Queue. `skip` is the region ids a walk has passed over, at most 50: they leave the items and stay in `remaining`.
    queue: ({ mode, cls, limit, skip }: { mode: Queue['mode']; cls?: string; limit?: number; skip?: string[] }) =>
      get(`/api/affected-areas/queue${query({ mode, class: cls, limit, skip: skip?.join(',') })}`),
    // → Proving
    proving: ({ model, contract }: { model?: string; contract?: string } = {}) =>
      get(`/api/affected-areas/proving${query({ model, contract })}`),
    // → ProvingClass (the class as it now stands, its line moved)
    setThreshold: (cls: string, body: ThresholdRequest) => put(`/api/affected-areas/thresholds/${encodeURIComponent(cls)}`, body),
  },

  // The carrier-bulletins lane (the Bulletins view of the Cerberus tab; wire shapes in `@/shared/carrier-bulletins-types`):
  // what Claude read in each carrier's SERVPRO bulletin and what the house settled it into, forwarded to shadow-connector
  // by CloudCLI. READ-ONLY: every verb is a GET, and no verb here writes a rule. Every JSON answer is its wire shape BARE,
  // in snake_case. A failure arrives as `affectedAreas`' do: `{ error: string }` from the lane, `{ detail: string }`
  // passed through from shadow-connector (404: no such bulletin or page). The answer of each verb is named beside it.
  // Ids are encoded here, so a caller passes them as it holds them.
  carrierBulletins: {
    // → OverviewRow[] (every carrier with a current file). The response header `X-Left-Out`, a JSON array of
    // LeftOutCarrier, names a carrier whose file could not be planned and so has no row; `useOverview` reads it.
    overview: (options: ApiRequestOptions = {}) => get('/api/carrier-bulletins/overview', options),
    // → BulletinPage[] (one bulletin's pages, in page order)
    pages: (bulletinId: string, options: ApiRequestOptions = {}) =>
      get(`/api/carrier-bulletins/bulletins/${encodeURIComponent(bulletinId)}/pages`, options),
    // → PageReading (what Claude read on one page)
    page: (bulletinId: string, page: number, options: ApiRequestOptions = {}) =>
      get(`/api/carrier-bulletins/bulletins/${encodeURIComponent(bulletinId)}/pages/${encodeURIComponent(page)}`, options),
    // The bytes of one page's PNG, not JSON: the caller reads `.blob()`. `sha` is the file's `file_sha256`. `options.signal`
    // lets it abort a fetch whose page has since changed.
    image: (sha: string, page: number, options: ApiRequestOptions = {}) =>
      get(`/api/carrier-bulletins/files/${encodeURIComponent(sha)}/pages/${encodeURIComponent(page)}/image`, options),
  },

  // The dispatcher lane (docs/MANUAL.md (dispatcher)): the plans in the dispatcher's own store, and the
  // verbs the plan cards, the arc header and In flight's queue press. The picture is `dispatcher status
  // --json` relayed whole, and the verbs are relayed to the dispatcher's own binary by argv, never by a shell.
  //
  // The verbs are read from the RAW response for one reason worth naming: the dispatcher prints its
  // refusals on STDOUT (`REFUSED schedule
  // <name>: is live — stop it first`, exit 2), not on stderr, so a 409 body carries the verdict
  // in `stdout` and the reader looks there first. Its successes are on stdout too (`UNSCHEDULED
  // <name>`), so the answer is the same field either way.
  dispatcher: {
    plans: () => get('/api/dispatcher/plans'),
    plan: (name: string) => get(`/api/dispatcher/plans/${encodeURIComponent(name)}`),
    stop: (name: string) => post(`/api/dispatcher/plans/${encodeURIComponent(name)}/stop`, {}),
    resume: (name: string) => post(`/api/dispatcher/plans/${encodeURIComponent(name)}/resume`, {}),
    park: (name: string) => post(`/api/dispatcher/plans/${encodeURIComponent(name)}/park`, {}),
    unpark: (name: string) => post(`/api/dispatcher/plans/${encodeURIComponent(name)}/unpark`, {}),
    // A plan out of the store for good (`dispatcher drop <plan>`): `DROPPED <name>`, or the
    // dispatcher's REFUSED line while a phase walks or a planner outing is live, as a 409.
    drop: (name: string) => post(`/api/dispatcher/plans/${encodeURIComponent(name)}/drop`, {}),
    // A plan's STALLED planner outing put back to work (`dispatcher planner-resume <plan>`): the
    // dispatcher reads which door from its own store — `cut`, `judge`, or a `tell` of `continue` — and
    // answers with that door's own sentence (`QUEUED cut <plan> — …`), or `REFUSED planner-resume …` as a 409.
    plannerResume: (name: string) => post(`/api/dispatcher/plans/${encodeURIComponent(name)}/planner-resume`, {}),
    // The operator's lift of the usage pacer's hold for ONE plan (`dispatcher override <plan> --by app:card`):
    // `OVERRIDDEN <plan> — …`, or the dispatcher's REFUSED line (a finished plan, one already past the pacer)
    // as a 409. `overrideOff` puts the hold back (`… --off`). The pacer's gate only — no model word moves.
    override: (name: string) => post(`/api/dispatcher/plans/${encodeURIComponent(name)}/override`, {}),
    overrideOff: (name: string) => post(`/api/dispatcher/plans/${encodeURIComponent(name)}/override-off`, {}),
    // "Accept when cut" on a DESIGNED plan (`dispatcher arm-accept <plan> --by app:card --design <stamp>`): the
    // stamp is the plan's `design_loaded_at` as the card drew it, so a press on a design that has since moved is
    // refused by the dispatcher. `disarmAccept` is its Cancel. The arc pair presses/cancels every designed (armed)
    // plan of the arc on each plan's own current design — no stamp travels.
    armAccept: (name: string, design: string) => post(`/api/dispatcher/plans/${encodeURIComponent(name)}/arm-accept`, { design }),
    disarmAccept: (name: string) => post(`/api/dispatcher/plans/${encodeURIComponent(name)}/disarm-accept`, {}),
    arcArmAccept: (name: string) => post(`/api/dispatcher/arcs/${encodeURIComponent(name)}/arm-accept`, {}),
    arcDisarmAccept: (name: string) => post(`/api/dispatcher/arcs/${encodeURIComponent(name)}/disarm-accept`, {}),
    // The operator's answer to a plan's prompt, from its card: the ask exactly as the card drew
    // it, the chosen label (or typed words) by question, and a Rework's notes by question. A
    // refusal is a RESULT (409), as for every verb.
    answer: (ask: DispatcherAsk, answers: Record<string, string>, notes?: Record<string, string>) =>
      post('/api/dispatcher/answer', { ask, answers, ...(notes ? { notes } : {}) }),
    // A plan's own DeepSeek / Claude word (`dispatcher model <plan> <word>`). The plan card's
    // control relays it; nothing is optimistic, and the next `dispatcher_state` frame reads the
    // word back. Restarts nothing — the word is read when a chain is LAUNCHED.
    model: (name: string, model: DispatcherModelChoice) => post(`/api/dispatcher/plans/${encodeURIComponent(name)}/model`, { model }),
    // The DISPATCH ARC deck's three presses (`dispatcher model|stop|resume <arc> …`), each
    // relayed to the arc's own door. Separate routes from the plan's because an arc is addressed by
    // its own door (`.arc`), never through a plan's.
    //
    // AN ARC HAS NO WALK OF ITS OWN: the dispatcher applies the PLAN verb to the arc's plans in one
    // step — `stop` over the arc's walking plans, `resume` over its stopped ones — so
    // the deck's press and one typed at a terminal are the same verb on the same set of plans. A
    // `/arcs/…` route for each is the whole reason the two surfaces cannot drift.
    arcModel: (name: string, model: DispatcherModelChoice) => post(`/api/dispatcher/arcs/${encodeURIComponent(name)}/model`, { model }),
    arcStop: (name: string) => post(`/api/dispatcher/arcs/${encodeURIComponent(name)}/stop`, {}),
    arcResume: (name: string) => post(`/api/dispatcher/arcs/${encodeURIComponent(name)}/resume`, {}),
    // An epic moved in the queue In flight runs top down (`dispatcher queue <arc> --before <arc> | --last`):
    // a drop on the queue's decks, named by a neighbour — `{ before }` or `{ last: true }` — never by an
    // index. A 409 carries the dispatcher's own refusal (an epic whose turn has ended is no longer in the
    // queue); nothing is optimistic, and the next `dispatcher_state` frame draws the order the store holds.
    arcQueue: (name: string, move: DispatcherQueueMove) =>
      post(`/api/dispatcher/arcs/${encodeURIComponent(name)}/queue`, move),
    // The epic dial's one word (`dispatcher epics <word>`): a limit of `1` to `5`, or `pause` /
    // `resume` — a BOARD verb that names no plan and no arc, so its route has no name in it.
    epics: (word: DispatcherEpicsWord) => post('/api/dispatcher/epics', { word }),
    // The board's one Start (`dispatcher start`): every plan held for its first Start let go at once, the
    // queue and the dial then ordering them. A BOARD verb like `epics`, with no name and no body.
    start: () => post('/api/dispatcher/start', {}),
    // Hide and Show (`dispatcher hide <name>…`, `dispatcher unhide <name>…`): the operator's hold on a plan and the way
    // back. BOARD verbs like `epics` and `start` — the names travel in the body, plans' and epics' alike (an epic's
    // name acts on every open, or every hidden, plan of it) — and the dispatcher's sentence is the answer, a refusal
    // (a finished plan, a plan that is not hidden) a 409. Nothing is optimistic: the next frame reads the store back.
    hide: (names: readonly string[]) => post('/api/dispatcher/hide', { names }),
    unhide: (names: readonly string[]) => post('/api/dispatcher/unhide', { names }),
    // A stopped plan's Resume at a time — `offpeak`, an ISO instant with a zone, or `none` to cancel —
    // through the server's one reader of the three shapes.
    schedule: (name: string, when: string) => post(`/api/dispatcher/plans/${encodeURIComponent(name)}/schedule`, { when }),
    // The dispatcher's next DeepSeek off-peak moment (`{ at }`, epoch seconds, or null), relayed
    // from the dispatcher's own binary.
    offpeak: () => get('/api/dispatcher/plans/offpeak'),
  },

  // The roadmap lane (`server/modules/roadmap/`): the picture `dispatcher roadmap show --json` prints,
  // read whole, and the nine writes the Roadmap tab presses — one helper per route. Read RAW like the
  // dispatcher's verbs above, for the same reason: a write the dispatcher refuses answers 409 with its
  // own sentence in the body's `stdout` (and a body the lane's fence refuses answers 400 with the
  // sentence in `error`), so the reader looks at the body whatever the status. Nothing is optimistic:
  // the picture redraws from the `roadmap_state` frame a landed write pokes.
  roadmap: {
    picture: () => get('/api/roadmap'),
    // One feature's active regression cases, read when its dialog opens (`FeatureDialog`'s Cases
    // section, through `useFeatureCases`): `{ cases }`, or 400/502 with the reason in `error`.
    cases: (feature: string) => get(`/api/roadmap/cases?feature=${encodeURIComponent(feature)}`),
    add: (body: RoadmapWriteBody) => post('/api/roadmap/add', body),
    edit: (body: RoadmapWriteBody) => post('/api/roadmap/edit', body),
    move: (body: RoadmapWriteBody) => post('/api/roadmap/move', body),
    propose: (body: RoadmapWriteBody) => post('/api/roadmap/propose', body),
    unpropose: (body: RoadmapWriteBody) => post('/api/roadmap/unpropose', body),
    block: (body: RoadmapWriteBody) => post('/api/roadmap/block', body),
    unblock: (body: RoadmapWriteBody) => post('/api/roadmap/unblock', body),
    remove: (body: RoadmapWriteBody) => post('/api/roadmap/remove', body),
    // The design door, not a roadmap verb: it sends the feature to Eupalinos (`dispatcher design`).
    promote: (body: RoadmapWriteBody) => post('/api/roadmap/promote', body),
  },

  // The heal reflex, the runner's twin lane: the worker's own summary (the tab's whole poll),
  // one kind's rows WHEN the operator opens that kind — never inside the poll — and the two hands
  // that change something, a cycle's Start/Stop and the ignore table. Its switches ride under
  // `settings` beside `healMaster`, where every flag file on this host lives.
  heal: {
    summary: () => get('/api/heal/summary'),
    byKind: (kind: string) => get(`/api/heal/kind/${encodeURIComponent(kind)}`),
    ignore: () => get('/api/heal/ignore'),
    addIgnore: (body: { tool: string; pattern: string; reason: string }) =>
      post('/api/heal/ignore', body),
    // A refusal is a 200 answer `{cycle, started: false, stage, why}`, never an error.
    cycleStart: () => post('/api/heal/cycle', {}),
    cycleStop: () => post('/api/heal/cycle/stop', {}),
  },

  // The launch table (`~/.claude/charters/launch.toml`) behind Settings → Agents → Edit Agent Chains, relayed
  // from the launch-table CLI: the census the window draws, one row's pins, and the table's defaults. Every
  // write answers with the census read back after it, so the window never holds a picture the table did not confirm.
  //
  // A write waits as long as the relay lets the CLI run (90 s: the lock, then the shims' regeneration),
  // plus a margin: at the browser's default 30 s a slow but healthy save would be called "not saved"
  // while the CLI went on to write it.
  agentLaunch: {
    census: () => get('/api/agent-launch'),
    saveRow: (name: string, change: AgentLaunchRowChange) =>
      put('/api/agent-launch/rows/' + encodeURIComponent(name), change, { timeoutMs: AGENT_LAUNCH_WRITE_TIMEOUT_MS }),
    saveDefaults: (change: AgentLaunchDefaultsChange) =>
      put('/api/agent-launch/defaults', change, { timeoutMs: AGENT_LAUNCH_WRITE_TIMEOUT_MS }),
  },

  // The API tab's Jev view: one reader answer per window, and the one thing the view can CHANGE —
  // the replay cache. Both go through the server's door, which runs `scripts/jev`; nothing in the
  // browser reads the ledger, the account file or the cache for itself. The window and the feed
  // length ride the query string, where the route holds each to a token shape before it can reach
  // an argument.
  jev: {
    summary: (range: JevRange, feed: number) => get(`/api/jev/summary?range=${range}&feed=${feed}`),
    clearCache: () => post('/api/jev/cache/clear', {}),
  },

  // The Kanban board (docs/MANUAL.md (kanban)). Boards are GLOBAL: the selected board is a server-side
  // setting, so switching projects never switches boards, and the only method here that names a
  // project is the first-mount lookup that adopts a board for the project the panel opened with.
  // Writes carry no actor — there is no per-user identity on this board yet, and the server
  // defaults every audit row to `'operator'`. `laneCards` takes a lane as a SET of statuses and
  // joins them for the wire, because which statuses compose a lane (To Do is `todo` plus
  // `questions` with autonomy off) is the panel's policy and only the panel's. A lease names an
  // `owner` rather than an actor: a lease owner is a build process, and who holds a card and who
  // wrote its audit row are different questions.
  kanban: {
    boards: () => get('/api/kanban/boards'),
    createBoard: (body: { name: string; projectId?: string | null }) => post('/api/kanban/boards', body),
    updateBoard: (id: string, body: Record<string, unknown>) =>
      patch(`/api/kanban/boards/${encodeURIComponent(id)}`, body),
    selectBoard: (id: string) => post(`/api/kanban/boards/${encodeURIComponent(id)}/select`, {}),
    lanes: (id: string) => get(`/api/kanban/boards/${encodeURIComponent(id)}/lanes`),
    // The header's six registers in one request — four of this board, two of the whole estate.
    vitals: (id: string) => get(`/api/kanban/boards/${encodeURIComponent(id)}/vitals`),

    // The lessons lane's REVIEW surface (docs/MANUAL.md (memory-intake); the store itself is
    // docs/MANUAL.md (kanban)'s). Every call here is a person's: STAGING a lesson is the agent's, over MCP,
    // and this app never writes one.
    //
    // `lessons` asks for `staged` and nothing else, at the route's own ceiling rather than its
    // default of a hundred — a review list that quietly stops at a hundred while the strip above it
    // counts the whole estate is two screens disagreeing about one number. The corpus a session
    // scans is the server's own `approvedIndex`, never a reading this client makes. `lesson` is the
    // ONE route here that carries a body: the list is lean by contract, so a row is read whole only
    // when somebody opens it.
    //
    // Both reviews are read from the RAW response, for the reason `memory.approve` above is: a 422
    // is a VERDICT — the server's own sentence naming the state the lesson is actually in — and a
    // 404 is a lesson reviewed elsewhere and now nothing. Neither is a failed request a caller
    // should have to dig a status out of an exception for.
    lessons: () => get(`/api/kanban/lessons?status=staged&limit=${LESSON_LIST_LIMIT}`),
    lesson: (lessonId: string) => get(`/api/kanban/lessons/${encodeURIComponent(lessonId)}`),
    approveLesson: (lessonId: string) =>
      post(`/api/kanban/lessons/${encodeURIComponent(lessonId)}/approve`, {}),
    rejectLesson: (lessonId: string) =>
      post(`/api/kanban/lessons/${encodeURIComponent(lessonId)}/reject`, {}),
    laneCards: (id: string, statuses: string[], cursor?: string | null, limit = 50) =>
      get(`/api/kanban/boards/${encodeURIComponent(id)}/cards?status=${encodeURIComponent(statuses.join(','))}&limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`),
    createCard: (id: string, body: Record<string, unknown>) => post(`/api/kanban/boards/${encodeURIComponent(id)}/cards`, body),
    boardForProject: (projectId: string) => get(`/api/kanban/projects/${encodeURIComponent(projectId)}/board`),
    card: (id: string) => get(`/api/kanban/cards/${encodeURIComponent(id)}`),
    updateCard: (id: string, body: Record<string, unknown>) => patch(`/api/kanban/cards/${encodeURIComponent(id)}`, body),
    moveCard: (id: string, body: Record<string, unknown>) => post(`/api/kanban/cards/${encodeURIComponent(id)}/move`, body),
    archiveCard: (id: string) => post(`/api/kanban/cards/${encodeURIComponent(id)}/archive`, {}),
    addTag: (id: string, tag: string) => post(`/api/kanban/cards/${encodeURIComponent(id)}/tags`, { tag }),
    removeTag: (id: string, tag: string) => del(`/api/kanban/cards/${encodeURIComponent(id)}/tags/${encodeURIComponent(tag)}`),
    addQuestion: (id: string, body: Record<string, unknown>) => post(`/api/kanban/cards/${encodeURIComponent(id)}/questions`, body),
    answerQuestion: (id: string, body: Record<string, unknown>) => post(`/api/kanban/questions/${encodeURIComponent(id)}/answer`, body),
    fileIssue: (id: string, body: { text: string }) => post(`/api/kanban/cards/${encodeURIComponent(id)}/issues`, body),
    resolveIssue: (id: string, body: Record<string, unknown>) => post(`/api/kanban/issues/${encodeURIComponent(id)}/resolve`, body),
    addChecklistItem: (id: string, body: Record<string, unknown>) => post(`/api/kanban/cards/${encodeURIComponent(id)}/checklist`, body),
    updateChecklistItem: (id: string, body: Record<string, unknown>) => patch(`/api/kanban/checklist/${encodeURIComponent(id)}`, body),
    approveCard: (id: string) => post(`/api/kanban/cards/${encodeURIComponent(id)}/approve`, {}),
    unapproveCard: (id: string) => post(`/api/kanban/cards/${encodeURIComponent(id)}/unapprove`, {}),

    // A card's attachment BYTES: the upload, the fetch and the removal.
    //
    // The upload is multipart on the field `file` — the route is multer's, so it cannot go through
    // `post` (which JSON-encodes a body) and the browser has to set its own boundary.
    //
    // The fetch answers raw bytes behind the bearer token. There is no URL an `<img src>` could use
    // here: the token cannot travel in one, so a caller reads the blob and mints its own object
    // URL, exactly as chat's images do. It has no deadline, for `assets.file`'s reason — an eight
    // megabyte file over a slow link would otherwise be aborted mid-body and read as a broken file.
    //
    // The removal answers `{ ok: true }`, or the 404 of an attachment that is not on the card.
    uploadAttachment: (cardId: string, file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      return authenticatedFetch(`/api/kanban/cards/${encodeURIComponent(cardId)}/attachments`, {
        method: 'POST',
        headers: {}, // Let the browser set the multipart boundary.
        body: formData,
      });
    },
    attachmentBlob: (cardId: string, attachmentId: string, options: ApiRequestOptions = {}) =>
      get(`/api/kanban/cards/${encodeURIComponent(cardId)}/attachments/${encodeURIComponent(attachmentId)}`, {
        timeoutMs: NO_REQUEST_TIMEOUT,
        ...options,
      }),
    removeAttachment: (cardId: string, attachmentId: string) =>
      del(`/api/kanban/cards/${encodeURIComponent(cardId)}/attachments/${encodeURIComponent(attachmentId)}`),

    events: (query: string) => get(`/api/kanban/events${query}`),
  },

  // The board's Metis fleet (docs/MANUAL.md (kanban)): who this board has out working for it, the four verbs
  // over a session, the nudge that wakes the driver, and the driver's own reading of the board.
  // `sessions` is the SEED — the fleet is pushed on change as a `kanban_metis_state` frame, which a
  // panel mounting between two changes would otherwise wait for with nothing on screen. `launch` is
  // a board's act and answers the session the server minted, so the panel paints the new row
  // without waiting for the frame behind it; `stop`, `resume` and `reply` answer the same shape for
  // the session they moved.
  kanbanMetis: {
    sessions: () => get('/api/kanban-metis/sessions'),
    // The driver's reading of one board: its autonomy, the dial that caps its sessions, how many are
    // live, how much work is claimable, the churn cooldown, the rate-limit hold and whether the
    // relaunch ledger still permits a spawn. The fleet panel reads it for the DIAL alone — its
    // header's figure is this board's live count against that number — while the live count itself
    // stays the fleet's own, so no two readings of one board can disagree about how many run.
    driver: (boardId: string) =>
      get(`/api/kanban-metis/boards/${encodeURIComponent(boardId)}/driver`),
    launch: (boardId: string) =>
      post(`/api/kanban-metis/boards/${encodeURIComponent(boardId)}/launch`, {}),
    // Wakes this board's driver now rather than at its next tick, and answers `{ nudged, at }` —
    // nothing about a session, because a nudge starts none: what the tick then reaps and claims is
    // its own decision, and the fleet frame that follows carries it.
    nudge: (boardId: string) =>
      post(`/api/kanban-metis/boards/${encodeURIComponent(boardId)}/nudge`, {}),
    stop: (sessionId: string) =>
      post(`/api/kanban-metis/sessions/${encodeURIComponent(sessionId)}/stop`, {}),
    resume: (sessionId: string) =>
      post(`/api/kanban-metis/sessions/${encodeURIComponent(sessionId)}/resume`, {}),
    // One person's words to a Metis whose child has stopped, as the turn she wakes up to. Answered
    // with the same `{ session }` shape `resume` gives, and refusing in the same way a 409 does
    // everywhere else on this board: `she is mid-turn — stop her first, then reply` while her child
    // is running, or the board's dial in the server's own words when there is no room for her.
    reply: (sessionId: string, text: string) =>
      post(`/api/kanban-metis/sessions/${encodeURIComponent(sessionId)}/reply`, { text }),
    transcript: readKanbanMetisTranscript,
  },

  // The application registry (docs/MANUAL.md (applications)): the rows the switcher's drawer lists, each a
  // `{host}`-templated url this reader resolves against their own hostname. `list` is read on
  // mount and on every drawer open rather than polled, because the
  // registry changes when the operator or a builder edits the file, and a row that appears a
  // minute after the edit is a row nobody is waiting for. The shapes are `@/shared/app-types`.
  apps: {
    list: () => get('/api/apps'),
    add: (body: { id?: string; name: string; url: string; description?: string; project?: string }) =>
      post('/api/apps', body),
    // Sets or clears a row's description and/or project. Only the keys given are sent, and the server
    // leaves an absent key's field alone: `{ project: '' }` unlinks, `{ description }` alone never
    // touches the project. Named `fields` because `patch` is this module's own request helper.
    update: (id: string, fields: { description?: string; project?: string }) =>
      patch(`/api/apps/${encodeURIComponent(id)}`, fields),
    move: (id: string, direction: 'up' | 'down') => post(`/api/apps/${encodeURIComponent(id)}/move`, { direction }),
    addDivider: (title: string) => post('/api/apps/dividers', { title }),
    renameDivider: (id: string, title: string) => patch(`/api/apps/dividers/${encodeURIComponent(id)}`, { title }),
    removeDivider: (id: string) => del(`/api/apps/dividers/${encodeURIComponent(id)}`),
    remove: (id: string) => del(`/api/apps/${encodeURIComponent(id)}`),
  },

  // The launcher souls a session started by hand with `plan-runner soul`, read off the launcher's own
  // state root. One plain read, for the seed the `soul_launch_state` frame cannot cover: the frame
  // is sent only on a CHANGE, so a page mounting while nothing moves has nothing to paint.
  dispatchSouls: {
    launches: () => get('/api/dispatch-souls/launches'),
  },

  // The estate map: every tracked file in the four crawled repos, with every index the crawler
  // assigned. Fetched once by the universe tab's `useUniverseMap`, and refetched only when a
  // `universe_map` frame carries a `mapId` the page does not already hold — the map is 1.4 MB, so
  // it is the one thing here that must never be polled. `get` hands back the raw Response, and the
  // hook parses the body, because nothing about the map belongs to this module's shape.
  universe: {
    map: () => get('/api/universe/map'),
  },

  // The cron registry the Schedules tab draws: every job the last sync wrote, and the one control
  // that makes the server re-read the box. `list` is a plain read of the tables — it never scans
  // anything — and `sync` runs a sync and answers with its report, whether that run succeeded or
  // not. The panel's hook POSTs the sync and then re-reads through `list`, which is why the two
  // paths are one entry here rather than a method on the panel.
  schedules: {
    list: () => get('/api/schedules'),
    sync: () => post('/api/schedules/sync'),
  },

  // The transcript of ONE subagent — an `Agent`-tool row addressed by the tool call that spawned it,
  // or a launcher soul addressed by its launch id — read on demand for the Subagents widget's
  // transcript view. Both methods resolve to a BARE `SubagentTranscriptResult`, so no hook and no
  // component knows that one route wraps its answer in the `{ success, data }` envelope and the
  // other answers raw. `get` hands back the raw Response (it is `authenticatedFetch`), so the body
  // is read and unwrapped here; a transcript that is not on disk yet is a `found: false` RESULT,
  // never a failed request.
  subagentTranscripts: {
    agent: async (sessionId: string, toolUseId: string): Promise<SubagentTranscriptResult> => {
      const path = `/api/providers/sessions/${encodeURIComponent(sessionId)}/subagents/${encodeURIComponent(toolUseId)}/transcript`;
      const body = await readApiJson<{ data: SubagentTranscriptResult }>(await get(path));
      return body.data;
    },
    soul: async (launchId: string): Promise<SubagentTranscriptResult> => readApiJson<SubagentTranscriptResult>(
      await get(`/api/dispatch-souls/launches/${encodeURIComponent(launchId)}/transcript`),
    ),
    // A board's Metis, addressed by the session id the BOARD minted. Its consumer is the kanban
    // module's fleet panel, which opens a row into the same view the other two kinds use.
    metis: readKanbanMetisTranscript,
  },

  // The installed Claude CLI and the version each LIVE run is on (docs/MANUAL.md (cli-version)). It
  // answers 200 even when no version could be read — an unreadable binary is a fact in words,
  // so the caller reads the body's `installed`/`reason` rather than the status.
  cliVersion: () => get('/api/cli-version'),

  // The money left on this host's DeepSeek account (docs/MANUAL.md (deepseek-balance)). A different account
  // from the Claude accounts the door holds, and a different origin: the server reads it from the
  // vendor with the key it holds, so the key never reaches this side. Answers 200 always, for the
  // same reason `accounts.usage` does — no reading is a reading in words, never an error wall.
  deepseek: {
    balance: () => get('/api/deepseek/balance'),

    // What this host has spent on DeepSeek and who spent it, one window at a time
    // (docs/MANUAL.md (deepseek-balance)). The server answers by running the ledger reader as a command, so
    // the whole payload is one object and the tab reads it whole — every figure it draws is already
    // in the body, and no number is derived on this side. `feed` is the newest-first tail length.
    usage: (range: DeepseekRange, feed: number) => get(`/api/deepseek/usage?range=${range}&feed=${feed}`),
  },
};

// ---------------------------

//----------------- VOICE TRANSCRIPTION AND SPEECH ------------

/**
 * Builds a URL against the user's own OpenAI-compatible voice endpoint. Private to the
 * voice helpers below, which bypass the CloudCLI proxy when a base URL is configured.
 */
function voiceDirectUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/$/, '')}${path}`;
}

/**
 * Serializes the active voice configuration so callers can detect a settings change and
 * drop cached synthesized audio.
 */
export function voiceConfigSignature(): string {
  return JSON.stringify(readVoiceConfig());
}

/**
 * Transcribes recorded audio. With the 'openai' provider (the default), it posts directly to the user's configured
 * OpenAI-compatible endpoint when one is set and otherwise goes through the CloudCLI voice proxy. With 'gemini' it
 * always goes through the proxy, which transcribes on the server's Gemini key: the browser's own endpoint is never
 * reached and none of its `x-voice-*` headers (its OpenAI-compatible key and model) ride along. Callers pass the
 * account's provider from the chat module's `useVoiceProvider`.
 */
export function transcribeVoice(blob: Blob, filename: string, provider: VoiceProvider = 'openai'): Promise<Response> {
  const body = new FormData();

  if (provider === 'gemini') {
    body.append('audio', blob, filename);
    return api.voice.transcribe(body);
  }

  const config = readVoiceConfig();
  if (config.baseUrl.trim()) {
    body.append('file', blob, filename);
    body.append('model', config.sttModel || 'whisper-1');
    return fetch(voiceDirectUrl(config.baseUrl.trim(), '/audio/transcriptions'), {
      method: 'POST',
      headers: config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {},
      body,
    });
  }

  body.append('audio', blob, filename);
  return api.voice.transcribe(body, voiceConfigHeaders());
}

/**
 * Synthesizes speech for the given text, using the user's configured OpenAI-compatible
 * endpoint when one is set and otherwise the CloudCLI voice proxy.
 */
export function synthesizeVoice(text: string, signal: AbortSignal): Promise<Response> {
  const config = readVoiceConfig();

  if (config.baseUrl.trim()) {
    return fetch(voiceDirectUrl(config.baseUrl.trim(), '/audio/speech'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: config.ttsModel || 'tts-1',
        voice: config.ttsVoice || 'alloy',
        input: text,
        ...(config.ttsFormat.trim() ? { response_format: config.ttsFormat.trim() } : {}),
      }),
      signal,
    });
  }

  return api.voice.tts(text, { headers: voiceConfigHeaders(), signal });
}
