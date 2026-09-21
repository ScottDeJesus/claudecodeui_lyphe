import {
  expireAuthSession,
  getStoredAuthToken,
  storeAuthToken,
} from '@/shared/authToken';
import type { FileLinePatch, NtfySettingsInput, SubagentTranscriptResult } from '@/shared/types';
import { IS_PLATFORM } from '@/shared/utils';
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
      storeAuthToken(refreshedToken);
    }
    if (response.headers.get('X-Auth-Error')) {
      expireAuthSession();
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
    user: (timeoutMs: number = BOOT_REQUEST_TIMEOUTS_MS[0]) => get('/api/auth/user', { timeoutMs }),
  },

  // Protected endpoints
  // config endpoint removed - no longer needed (frontend uses window.location)
  // After the projectName → projectId migration the path/query identifier is
  // the DB-assigned `projectId`; parameter names reflect that for clarity.
  projects: () => get('/api/projects'),
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
  // Moves a chat in the simple list to sit directly below `afterSessionId`, or
  // to the top of the list when that is null.
  moveSimpleListSession: (sessionId: string, afterSessionId: string | null) =>
    put(`/api/providers/sessions/${encodeURIComponent(sessionId)}/simple-list-position`, {
      afterSessionId,
    }),

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
    /** Writes only the parts given; an absent part is left as the server has it. */
    saveDraft: (scope: string, draft: { text?: string; queuedMessage?: unknown }) =>
      put('/api/user/drafts', { scope, ...draft }),
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

    // The house Jev switches, same shape of answer for the same reason: flag files on this host,
    // not per-user preferences. `saveJev` sends only the switches named, so a PUT that moves one
    // never moves another, and both calls answer with the state read back off disk.
    jev: () => get('/api/settings/jev'),
    saveJev: (patch: { master?: boolean; prompts?: boolean; toolOutput?: boolean }) =>
      put('/api/settings/jev', patch),
    jevStats: () => get('/api/settings/jev/stats'),

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
  },

  system: {
    // `git pull && npm install`, answered on completion. Aborting the WAIT never aborted the
    // update — it only told the user it had failed, inviting a second one onto the same tree.
    update: () => post('/api/system/update', undefined, { timeoutMs: NO_REQUEST_TIMEOUT }),
  },

  // The Claude account switcher and its usage meter, served by the server's own accounts module.
  // Both reads answer 200 whatever the state — the calm `{reachable:false, reason}` picture when
  // nothing can be computed — so a caller reads the BODY rather than the status. Both writes carry
  // the service's OWN status and body through, which is why they are read from the raw response and
  // never through `readApiJson`.
  accounts: {
    // `picture`, not `accounts`: the group is already named for the lane, and the panel calls this
    // body a picture everywhere it appears.
    picture: () => get('/api/accounts'),
    usage: () => get('/api/usage'),
    switchAccount: (slug: string) => post('/api/accounts/switch', { slug }),
    capture: () => post('/api/accounts/capture', {}),
  },

  // The memory-intake lane (docs/memory-intake.md): what a session PROPOSES and a person reviews.
  // The reads answer 200 with the `reachable` envelope the panel, the tab gates and the command
  // palette all branch on — it is a fact about the read now rather than about a remote server, and
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

  // The plan-runner lane (docs/plan-runner.md). The server READS the runner's state directory and
  // relays two verbs to the runner's own binary; it never writes a state file and never starts a
  // run. The reads are plain gets. The two writes are read from the RAW response, like
  // `memory.approve` above and for the same reason: a 409 here carries the runner's own
  // verdict — its refusal in its own `stderr`, with the run left exactly as it was — and putting it
  // through `readApiJson` would turn that verdict into a thrown error the caller cannot show.
  planRunner: {
    runs: () => get('/api/plan-runner/runs'),
    run: (id: string) => get(`/api/plan-runner/runs/${encodeURIComponent(id)}`),
    stop: (id: string) => post(`/api/plan-runner/runs/${encodeURIComponent(id)}/stop`, {}),
    resume: (id: string) => post(`/api/plan-runner/runs/${encodeURIComponent(id)}/resume`, {}),
  },

  // The Kanban board (docs/kanban.md). Boards are GLOBAL: the selected board is a server-side
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
    // The header's six registers in one request — four of this board, two of the whole estate —
    // and one card's plan cost, which is `null` for a card whose plan column is empty.
    vitals: (id: string) => get(`/api/kanban/boards/${encodeURIComponent(id)}/vitals`),
    cardPlanCost: (id: string) => get(`/api/kanban/cards/${encodeURIComponent(id)}/plan-cost`),

    // The lessons lane's REVIEW surface (docs/memory-intake.md; the store itself is
    // docs/kanban.md's). Every call here is a person's: STAGING a lesson is the agent's, over MCP,
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

  // The board's Metis fleet (docs/kanban.md): who this board has out working for it, the four verbs
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

  // The application registry (docs/applications.md): the rows the switcher's drawer lists, each a
  // `{host}`-templated url this reader resolves against their own hostname. Three verbs and no
  // more — `list` is read on mount and on every drawer open rather than polled, because the
  // registry changes when the operator or a builder edits the file, and a row that appears a
  // minute after the edit is a row nobody is waiting for. The shapes are `@/shared/app-types`.
  apps: {
    list: () => get('/api/apps'),
    add: (body: { id?: string; name: string; url: string; description?: string }) => post('/api/apps', body),
    describe: (id: string, description: string) => patch(`/api/apps/${encodeURIComponent(id)}`, { description }),
    move: (id: string, direction: 'up' | 'down') => post(`/api/apps/${encodeURIComponent(id)}/move`, { direction }),
    addDivider: (title: string) => post('/api/apps/dividers', { title }),
    renameDivider: (id: string, title: string) => patch(`/api/apps/dividers/${encodeURIComponent(id)}`, { title }),
    removeDivider: (id: string) => del(`/api/apps/dividers/${encodeURIComponent(id)}`),
    remove: (id: string) => del(`/api/apps/${encodeURIComponent(id)}`),
  },

  // The launcher souls a `/dispatch` started with `plan-runner soul`, read off the launcher's own
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

  // The installed Claude CLI and the version each LIVE run is on (docs/cli-version.md). It
  // answers 200 even when no version could be read — an unreadable binary is a fact in words,
  // so the caller reads the body's `installed`/`reason` rather than the status.
  cliVersion: () => get('/api/cli-version'),

  // The money left on this host's DeepSeek account (docs/deepseek-balance.md). A different account
  // from the Claude slots the switcher holds, and a different origin: the server reads it from the
  // vendor with the key it holds, so the key never reaches this side. Answers 200 always, for the
  // same reason `accounts.usage` does — no reading is a reading in words, never an error wall.
  deepseek: {
    balance: () => get('/api/deepseek/balance'),
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
 * Transcribes recorded audio, posting directly to the user's configured OpenAI-compatible
 * endpoint when one is set and otherwise going through the CloudCLI voice proxy.
 */
export function transcribeVoice(blob: Blob, filename: string): Promise<Response> {
  const config = readVoiceConfig();
  const body = new FormData();

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
