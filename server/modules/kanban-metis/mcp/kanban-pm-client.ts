/**
 * The board's HTTP client — the only way this process reaches the board — and the environment it
 * is configured from.
 *
 * The MCP server is a SEPARATE PROCESS: a stdio child of the CLI with no server in it and no
 * database handle, so every tool is one or more calls to the routes the board already serves —
 * reached through the `/api/kanban-pm` door, whose guard takes the derived session credential this
 * process carries in `KANBAN_PM_TOKEN`. The operator's own `/api/kanban` mount refuses that
 * credential by design: it authenticates a user token behind `authenticateToken`, and this process
 * has no user. Nothing here imports `server/modules/kanban/` and nothing opens SQLite.
 *
 * A non-2xx answer becomes a `KanbanPmHttpError` carrying the status and the response body, and it
 * is never swallowed into a success shape: a tool that reported a refused write as done would tell
 * the model the board holds something it does not.
 */

/**
 * Where this process talks and what it answers to, all of it from the four variables its spawner
 * sets and nothing else.
 *
 * `apiUrl` is the running server's OWN origin, resolved at spawn from the port that server is
 * actually listening on — never a constant. Two servers share one database on this box, and a
 * child pointed at the other one writes the right rows through the wrong process, whose websocket
 * frames reach nobody.
 *
 * `owner` is the lease owner: sixteen lowercase hex, derived from the session id by the spawner.
 * It is the same sixteen characters every time that session is seen, by any process, after any
 * restart — a minted token would live only in the process that minted it, and a re-adopted
 * session would come back unable to refresh the leases it already holds.
 */
export type KanbanPmConfig = {
  apiUrl: string;
  token: string;
  boardId: string;
  owner: string;
};

const REQUIRED_VARIABLES = [
  'KANBAN_PM_API_URL',
  'KANBAN_PM_TOKEN',
  'KANBAN_PM_BOARD_ID',
  'KANBAN_PM_OWNER',
] as const;

const LEASE_OWNER_PATTERN = /^[0-9a-f]{16}$/;

/**
 * Reads the four variables, and refuses to start when one is missing.
 *
 * Refusing loudly is the whole point: a child that started without them would answer every tool
 * with a request to `undefined` or a bearer of `undefined`, and the model would read a wall of
 * failures as a broken board rather than as a spawn that was never configured.
 */
export function readKanbanPmConfig(environment: NodeJS.ProcessEnv = process.env): KanbanPmConfig {
  const values = new Map<string, string>();
  const missing: string[] = [];

  for (const name of REQUIRED_VARIABLES) {
    const value = environment[name]?.trim();
    if (!value) {
      missing.push(name);
      continue;
    }
    values.set(name, value);
  }

  if (missing.length > 0) {
    throw new Error(
      `kanban-pm-mcp cannot start: ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} not set.`
    );
  }

  const owner = values.get('KANBAN_PM_OWNER') as string;
  if (!LEASE_OWNER_PATTERN.test(owner)) {
    throw new Error(
      'kanban-pm-mcp cannot start: KANBAN_PM_OWNER must be sixteen lowercase hex characters ' +
        `(the derived lease owner), got "${owner}".`
    );
  }

  return {
    // A trailing slash on the origin would double into `//cards/...` on every path this builds.
    apiUrl: (values.get('KANBAN_PM_API_URL') as string).replace(/\/+$/, ''),
    token: values.get('KANBAN_PM_TOKEN') as string,
    boardId: values.get('KANBAN_PM_BOARD_ID') as string,
    owner,
  };
}

/** One refused or failed board call, with enough of the answer to say what the board objected to. */
export class KanbanPmHttpError extends Error {
  readonly method: string;
  readonly path: string;
  readonly status: number;
  readonly body: string;

  constructor(method: string, path: string, status: number, body: string) {
    super(`${method} ${path} failed with ${status}: ${body || '(empty response)'}`);
    this.name = 'KanbanPmHttpError';
    this.method = method;
    this.path = path;
    this.status = status;
    this.body = body;
  }
}

export type KanbanPmClient = KanbanPmConfig & {
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body?: unknown): Promise<T>;
  patch<T>(path: string, body?: unknown): Promise<T>;
  del<T>(path: string): Promise<T>;
};

/** A local board answers in milliseconds; this is the ceiling past which the board is not answering. */
const REQUEST_TIMEOUT_MS = 30_000;

/**
 * Where the board's routes are mounted. `KANBAN_PM_API_URL` is the server's ORIGIN, not this path:
 * the spawner resolves the port the server is listening on, and which mount the routes hang off is
 * this process's business.
 *
 * It is the `/api/kanban-pm` door, and it is the only one that accepts the credential this process
 * was handed: `kanbanMetisSecretGuard` checks the derived per-session bearer, while the operator's
 * own `/api/kanban` mount runs `authenticateToken` and refuses that credential by design. Sent to
 * the user mount, every tool call here answers 401 while the session still reads `running` — which
 * is exactly what a launch measured before this constant moved.
 */
const KANBAN_API_MOUNT = '/api/kanban-pm';

export function createKanbanPmClient(config: KanbanPmConfig): KanbanPmClient {
  const request = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    const url = `${config.apiUrl}${KANBAN_API_MOUNT}${path}`;
    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${config.token}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    const text = await response.text();
    if (!response.ok) {
      throw new KanbanPmHttpError(method, path, response.status, text);
    }
    if (text.trim() === '') {
      return null as T;
    }

    try {
      return JSON.parse(text) as T;
    } catch (error) {
      throw new KanbanPmHttpError(
        method,
        path,
        response.status,
        `${text.slice(0, 500)} (not JSON: ${error instanceof Error ? error.message : String(error)})`
      );
    }
  };

  return {
    ...config,
    get: <T>(path: string) => request<T>('GET', path),
    post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
    patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
    del: <T>(path: string) => request<T>('DELETE', path),
  };
}
