import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import {
  access,
  lstat,
  mkdir,
  readFile,
  readdir,
  open as openFile,
  readlink,
  realpath,
  stat,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

import type { NextFunction, Request, RequestHandler, Response } from 'express';

import { parseFrontMatter } from '@/shared/frontmatter.js';
import type {
  AnyRecord,
  ApiSuccessShape,
  AppErrorOptions,
  NormalizedMessage,
  ProviderCurrentActiveModel,
  ProviderModelsDefinition,
  ProviderSkillSource,
  DispatcherModelChoice,
  QueuedChatMessage,
  SubagentActivity,
  WorkspacePathValidationResult,
} from '@/shared/types.js';

//----------------- ENVIRONMENT UTILITIES ------------
/**
 * Indicates whether the backend is running in hosted Platform mode rather than
 * self-hosted OSS mode. The server bootstrap, Agent, Auth, and Browser Use
 * modules use this shared flag to keep environment-dependent behavior aligned.
 * Environment variables must be loaded before this module is evaluated.
 */
export const IS_PLATFORM = process.env.VITE_IS_PLATFORM === 'true';

/**
 * This server's own origin on the loopback interface, for a child of this box that calls back into
 * its API. It answers the port the RUNNING process listens on — `SERVER_PORT`, then the house
 * default, the very expression the listener reads (`server/index.ts`) — and reads the environment at
 * every call, so a server started on another port by a probe hands its children its own origin and
 * never the operator's. It names no `PORT`: the server never listens on one, and the `cloudcli` CLI,
 * the one place that accepts `PORT`, copies it into `SERVER_PORT` before the server starts, so an
 * origin built from `PORT` could only point at a port nothing here listens on. Consumed by
 * `kanban-metis.module.ts`, `browser-use.service.ts` and the toolsets module.
 */
export function loopbackApiOrigin(): string {
  return `http://127.0.0.1:${process.env.SERVER_PORT || '3001'}`;
}

// ---------------------------
//----------------- NORMALIZED MESSAGE HELPER INPUT TYPES ------------
/**
 * Input payload accepted by `createNormalizedMessage`.
 *
 * Callers provide provider-specific fields plus the required `kind/provider`
 * pair; this helper fills missing envelope fields (`id`, `sessionId`,
 * `timestamp`) in a consistent way.
 */
type NormalizedMessageInput =
  {
    kind: NormalizedMessage['kind'];
    provider: NormalizedMessage['provider'];
    id?: string | null;
    sessionId?: string | null;
    timestamp?: string | null;
  } & Record<string, unknown>;

// ---------------------------
//----------------- HTTP HANDLER UTILITIES ------------
/**
 * Wraps arbitrary data in the standard API success envelope.
 *
 * Use this helper in route handlers to keep successful JSON responses consistent
 * across endpoints.
 */
export function createApiSuccessResponse<TData>(
  data: TData,
): ApiSuccessShape<TData> {
  return {
    success: true,
    data,
  };
}

/**
 * Converts an async Express handler into a standard `RequestHandler` and routes
 * rejected promises to Express error middleware.
 *
 * Use this to avoid repeating `try/catch(next)` in every async route.
 */
export function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
): RequestHandler {
  return (req, res, next) => {
    void Promise.resolve(handler(req, res, next)).catch(next);
  };
}

/**
 * The account an authenticated request acts for, or the app's own 401 `USER_REQUIRED`.
 *
 * It REFUSES where a `Number()` coercion would quietly act for account 0 (`Number(null)`, `Number('')` and
 * `Number([])` are all `0`): a row written for the wrong account is worse than a row not written. Mounted
 * behind `authenticateToken`, which sets `request.user` to the account row whose `id` is the table's own
 * positive integer, so it refuses nothing a real session can send. Consumed by `notes.routes.ts` and
 * `followups.routes.ts`, the two lanes whose rows belong to one account.
 */
export function readAuthenticatedUserId(request: Request): number {
  const userId = (request as Request & { user?: { id?: number | string } }).user?.id;
  if (typeof userId !== 'number' || !Number.isInteger(userId) || userId <= 0) {
    throw new AppError('Authenticated user is required.', {
      code: 'USER_REQUIRED',
      statusCode: 401,
    });
  }
  return userId;
}

// ---------------------------
//----------------- QUEUED CHAT MESSAGE UTILITIES ------------
/**
 * Reads a stored queued chat message (the parsed JSON of `session_drafts.queued_message`), or returns null when it
 * has nothing to send: no text and no attachments.
 *
 * Used by the Database module's drafts repository, which appends a follow-up to the waiting message, and by the
 * Scheduled Messages dispatcher, which sends it. Both must read a stored message the same way, or a merge could keep
 * what the dispatcher then ignores. Rows from before attachments existed hold image-only descriptors in `images`;
 * they are read as `attachments`. `options` is kept only when it is a plain object, `id` only when it is a
 * non-empty string.
 */
export function readQueuedChatMessage(value: unknown): QueuedChatMessage | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const content = typeof record.content === 'string' ? record.content : '';
  const attachments = Array.isArray(record.attachments)
    ? record.attachments
    : Array.isArray(record.images)
      ? record.images
      : [];
  if (!content.trim() && attachments.length === 0) {
    return null;
  }
  const options = record.options && typeof record.options === 'object' && !Array.isArray(record.options)
    ? record.options as Record<string, unknown>
    : undefined;
  const id = typeof record.id === 'string' && record.id ? record.id : undefined;
  return { ...(id ? { id } : {}), content, ...(options ? { options } : {}), attachments };
}

// ---------------------------
//----------------- ROUTE PARAMETER PARSING ------------
/**
 * Reads one Express route parameter as a string.
 *
 * A parameter arrives as a string for a plain `:name` segment and as an array
 * for a repeatable one, so both shapes are accepted here and anything else is
 * a 400 — a route never has to test the shape itself. Consumed by
 * `provider.routes.ts` (every parser below and its other path parsers) and
 * `session-user-state.routes.ts`.
 */
export const readPathParam = (value: unknown, name: string): string => {
  if (typeof value === 'string') {
    return value;
  }

  if (Array.isArray(value) && typeof value[0] === 'string') {
    return value[0];
  }

  throw new AppError(`${name} path parameter is invalid.`, {
    code: 'INVALID_PATH_PARAMETER',
    statusCode: 400,
  });
};

/**
 * Allowed shape of a session id: a bounded run of id-safe characters, never a
 * path. Consumed by `parseSessionId` below on behalf of `provider.routes.ts` and
 * `session-user-state.routes.ts`.
 */
export const SESSION_ID_PATTERN = /^[a-zA-Z0-9._-]{1,120}$/;

/**
 * Validates one session id route parameter.
 *
 * Session ids reach the filesystem and the database as identifiers, so they are
 * bounded to id-safe characters before any caller uses them. Throws a 400
 * rather than sanitizing: a malformed id is the client's bug, and quietly
 * trimming it would address a different session. Consumed by
 * `provider.routes.ts` and `session-user-state.routes.ts`.
 */
export const parseSessionId = (value: unknown): string => {
  const sessionId = readPathParam(value, 'sessionId').trim();
  if (!SESSION_ID_PATTERN.test(sessionId)) {
    throw new AppError('Invalid sessionId.', {
      code: 'INVALID_SESSION_ID',
      statusCode: 400,
    });
  }

  return sessionId;
};

// ---------------------------
//----------------- SHARED ERROR UTILITIES ------------
/**
 * Shared application error with HTTP status and machine-readable code metadata.
 *
 * Throw this from service/route layers when the caller should receive a
 * controlled error response rather than a generic 500.
 */
export class AppError extends Error {
  readonly code: string;
  readonly statusCode: number;
  readonly details?: unknown;

  constructor(message: string, options: AppErrorOptions = {}) {
    super(message);
    this.name = 'AppError';
    this.code = options.code ?? 'INTERNAL_ERROR';
    this.statusCode = options.statusCode ?? 500;
    this.details = options.details;
  }
}

// ---------------------------
//----------------- HOST FLAG FILE UTILITIES ------------
/**
 * Python's `str.strip()`, both ends — spelled out, because neither of JavaScript's two trims is it. `\s` is
 * the wrong set in both directions: it lacks the C0 separators `\x1c`–`\x1f` and NEL (`\u0085`), which
 * `strip()` takes, and it holds the byte-order mark `\uFEFF`, which `strip()` keeps. The separators are written
 * as ESCAPES, never as the bytes: a literal control character in a source file is invisible and an editor can drop it.
 */
const FLAG_TRIM = new RegExp(
  '^[\\t\\n\\v\\f\\r\\x1c-\\x1f \\u0085\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000]+'
  + '|[\\t\\n\\v\\f\\r\\x1c-\\x1f \\u0085\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000]+$',
  'g',
);

/**
 * Python's `str.strip()` on a string, by the set `FLAG_TRIM` spells out. Consumed by the voice module's env-file
 * reader (`gemini-key.ts`), which must read the house `.env` line for line as `~/.claude/scripts/gemini-image` does.
 */
export function pythonStrip(text: string): string {
  return text.replace(FLAG_TRIM, '');
}

/** The ONE leading BOM the Python side's `utf-8-sig` decode takes off, and no other: a BOM anywhere else stays in the word, as it does there. */
const LEADING_BOM = /^\uFEFF/;

/**
 * One flag file's single word, trimmed the way Python's `str.strip()` trims, or `null` when the file
 * cannot be trusted to hold one: absent, unreadable, not a regular file, or larger than `maxBytes`.
 * `maxBytes` is the dispatcher's or pacer's own bound on that file, kept identical on both sides so a
 * file past it reads the default in both languages. A FIFO or a directory at the path is `null` rather
 * than a read that never returns. The caller decides what `null` means (a default) and what grammar the
 * word must be in; this never throws.
 *
 * Used by `planner-lanes.ts` (the dispatcher's planner-lane dial) and `weekly-stop.ts` (the pacer's
 * weekly stop), whose readers agree with their Python counterparts clause for clause.
 */
export async function readFlagWord(filePath: string, maxBytes: number): Promise<string | null> {
  try {
    const info = await stat(filePath);
    if (!info.isFile() || info.size > maxBytes) return null;
    return (await readFile(filePath, 'utf8')).replace(LEADING_BOM, '').replace(FLAG_TRIM, '');
  } catch {
    return null;
  }
}

// ---------------------------
//----------------- WORKSPACE PATH VALIDATION UTILITIES ------------
/**
 * Root directory that all workspace/project paths must stay under.
 *
 * This is resolved from `WORKSPACES_ROOT` when configured; otherwise it falls
 * back to the current user's home directory.
 */
export const WORKSPACES_ROOT = process.env.WORKSPACES_ROOT || os.homedir();

/**
 * System-critical paths that must never be used as workspace roots.
 *
 * The validation helper blocks these values directly and also blocks paths
 * nested under them (with explicit allow-list exceptions where necessary).
 */
export const FORBIDDEN_WORKSPACE_PATHS = [
  // Unix
  '/',
  '/etc',
  '/bin',
  '/sbin',
  '/usr',
  '/dev',
  '/proc',
  '/sys',
  '/var',
  '/boot',
  '/root',
  '/lib',
  '/lib64',
  '/opt',
  '/tmp',
  '/run',
  // Windows
  'C:\\Windows',
  'C:\\Program Files',
  'C:\\Program Files (x86)',
  'C:\\ProgramData',
  'C:\\System Volume Information',
  'C:\\$Recycle.Bin',
];

function stripWindowsLongPathPrefix(inputPath: string): string {
  if (inputPath.startsWith('\\\\?\\UNC\\')) {
    return `\\\\${inputPath.slice('\\\\?\\UNC\\'.length)}`;
  }

  if (inputPath.startsWith('\\\\?\\')) {
    return inputPath.slice('\\\\?\\'.length);
  }

  return inputPath;
}

function shouldUseWindowsPathNormalization(inputPath: string): boolean {
  if (process.platform === 'win32') {
    return true;
  }

  return inputPath.startsWith('\\\\') || /^[a-zA-Z]:([\\/]|$)/.test(inputPath);
}

/**
 * Canonicalizes project/workspace paths for stable DB keys and comparisons.
 *
 * Normalization rules:
 * - trim whitespace
 * - strip Windows long-path prefixes (`\\?\` and `\\?\UNC\`)
 * - normalize path separators and dot segments
 * - trim trailing separators except for filesystem roots
 */
export function normalizeProjectPath(inputPath: string): string {
  if (typeof inputPath !== 'string') {
    return '';
  }

  const trimmed = inputPath.trim();
  if (!trimmed) {
    return '';
  }

  const withoutLongPrefix = stripWindowsLongPathPrefix(trimmed);
  const useWindowsPathRules = shouldUseWindowsPathNormalization(withoutLongPrefix);
  const normalized = useWindowsPathRules
    ? path.win32.normalize(withoutLongPrefix)
    : path.posix.normalize(withoutLongPrefix);

  if (!normalized) {
    return '';
  }

  const parser = useWindowsPathRules ? path.win32 : path.posix;
  const root = parser.parse(normalized).root;
  if (normalized === root) {
    return normalized;
  }

  return normalized.replace(/[\\/]+$/, '');
}

/**
 * Validates that a user-supplied workspace path is safe to use.
 *
 * Call this before any filesystem mutation that creates or registers projects.
 * The function resolves symlinks, enforces `WORKSPACES_ROOT` containment, and
 * blocks known system directories.
 */
export async function validateWorkspacePath(requestedPath: string): Promise<WorkspacePathValidationResult> {
  try {
    const normalizedRequestedPath = normalizeProjectPath(requestedPath);
    if (!normalizedRequestedPath) {
      return {
        valid: false,
        error: 'Workspace path is required',
      };
    }

    const absolutePath = path.resolve(normalizedRequestedPath);
    const normalizedPath = normalizeProjectPath(absolutePath);

    if (FORBIDDEN_WORKSPACE_PATHS.includes(normalizedPath) || normalizedPath === '/') {
      return {
        valid: false,
        error: 'Cannot use system-critical directories as workspace locations',
      };
    }

    for (const forbiddenPath of FORBIDDEN_WORKSPACE_PATHS) {
      const normalizedForbiddenPath = normalizeProjectPath(forbiddenPath);
      if (
        normalizedPath === normalizedForbiddenPath
        || normalizedPath.startsWith(`${normalizedForbiddenPath}${path.sep}`)
      ) {
        // Allow specific user-writable folders under /var.
        if (
          normalizedForbiddenPath === '/var'
          && (normalizedPath.startsWith('/var/tmp') || normalizedPath.startsWith('/var/folders'))
        ) {
          continue;
        }

        return {
          valid: false,
          error: `Cannot create workspace in system directory: ${forbiddenPath}`,
        };
      }
    }

    let resolvedPath = normalizeProjectPath(absolutePath);
    try {
      await access(absolutePath);
      resolvedPath = normalizeProjectPath(await realpath(absolutePath));
    } catch (error) {
      const fileError = error as NodeJS.ErrnoException;
      if (fileError.code !== 'ENOENT') {
        throw fileError;
      }

      const parentPath = path.dirname(absolutePath);
      try {
        const parentRealPath = await realpath(parentPath);
        resolvedPath = normalizeProjectPath(path.join(parentRealPath, path.basename(absolutePath)));
      } catch (parentError) {
        const parentFileError = parentError as NodeJS.ErrnoException;
        if (parentFileError.code !== 'ENOENT') {
          throw parentFileError;
        }
      }
    }

    const resolvedWorkspaceRoot = normalizeProjectPath(await realpath(WORKSPACES_ROOT));
    if (
      !resolvedPath.startsWith(`${resolvedWorkspaceRoot}${path.sep}`)
      && resolvedPath !== resolvedWorkspaceRoot
    ) {
      return {
        valid: false,
        error: `Workspace path must be within the allowed workspace root: ${WORKSPACES_ROOT}`,
      };
    }

    try {
      await access(absolutePath);
      const pathStats = await lstat(absolutePath);
      if (pathStats.isSymbolicLink()) {
        const symlinkTarget = await readlink(absolutePath);
        const resolvedSymlinkPath = path.resolve(path.dirname(absolutePath), symlinkTarget);
        const realSymlinkPath = await realpath(resolvedSymlinkPath);
        if (
          !realSymlinkPath.startsWith(`${resolvedWorkspaceRoot}${path.sep}`)
          && realSymlinkPath !== resolvedWorkspaceRoot
        ) {
          return {
            valid: false,
            error: 'Symlink target is outside the allowed workspace root',
          };
        }
      }
    } catch (error) {
      const fileError = error as NodeJS.ErrnoException;
      if (fileError.code !== 'ENOENT') {
        throw fileError;
      }
    }

    return {
      valid: true,
      resolvedPath,
    };
  } catch (error) {
    return {
      valid: false,
      error: `Path validation failed: ${(error as Error).message}`,
    };
  }
}

/**
 * Resolves a caller-supplied path against a project root and refuses anything outside it.
 *
 * Consumed by both File Tree services — `file-tree.service.ts` (read, write, rename,
 * delete, upload) and `file-tree-listing.service.ts` (listing and preview) — so every
 * path a client names is contained by the same rule.
 *
 * A relative path is joined to the root; an absolute one is accepted only when it already
 * resolves under the root. Containment is decided on the RESOLVED string, so `../` cannot
 * climb out. The project root ITSELF is rejected — callers that legitimately address the
 * root (uploading into it, listing it) special-case an empty path before calling this.
 *
 * ⚠ Symlinks are NOT followed: a link inside the project whose target lives elsewhere
 * resolves to its own path and passes. For READS that is the reach the project's files
 * already had (`…/file` and `…/files/content` follow such a link today). For LISTING it is
 * WIDER reach than the module used to have — `listDirectory` will enumerate whatever
 * directory an in-project link points at, where the recursive tree walker never descended
 * one (it reads `Dirent.isDirectory()`, which is false for a link). So anyone who can write
 * a symlink into a project can browse outside it. `validateWorkspacePath` is the
 * symlink-aware check, and it guards workspace ROOTS, not these per-request paths.
 *
 * The thrown 403 deliberately names neither the requested nor the resolved path: the
 * message reaches the browser, and an absolute server path is not the client's business.
 */
export function resolvePathInsideProject(projectRoot: string, targetPath: string): string {
  const resolvedPath = path.isAbsolute(targetPath)
    ? path.resolve(targetPath)
    : path.resolve(projectRoot, targetPath);
  const normalizedProjectRoot = path.resolve(projectRoot) + path.sep;

  if (!resolvedPath.startsWith(normalizedProjectRoot)) {
    throw new AppError('Path must be under project root', {
      statusCode: 403,
      code: 'PATH_OUTSIDE_PROJECT',
    });
  }

  return resolvedPath;
}

/**
 * Resolves caller-supplied path SEGMENTS under a fixed root, or null when any of them
 * could step outside it.
 *
 * THE repository's containment predicate for a root this server owns outright — the
 * global chat-assets folder and, now, a card's attachment folder. It is the same
 * separator-and-resolve double gate twice over: every segment is refused if it is blank
 * or carries a separator, a `..` or a backslash (so nothing the caller spells can name
 * another directory), and the joined result must resolve to a path strictly under the
 * root (so a symlink-free `path.resolve` can never land elsewhere).
 *
 * It lives here rather than in either caller because a security predicate with two
 * copies is a predicate that gets fixed once: `image-assets.service.ts`'s
 * `resolveImageAssetFile` was the first copy and this is that function, moved unchanged
 * with its segment as the only argument.
 */
export function resolveUnderRoot(root: string, ...segments: string[]): string | null {
  const resolvedRoot = path.resolve(root);
  const parts: string[] = [];

  for (const segment of segments) {
    const trimmed = typeof segment === 'string' ? segment.trim() : '';
    if (!trimmed || trimmed.includes('/') || trimmed.includes('\\') || trimmed.includes('..')) {
      return null;
    }
    parts.push(trimmed);
  }

  // No segment at all would resolve to the root itself, which is a directory, not a file.
  if (parts.length === 0) return null;

  const resolved = path.resolve(resolvedRoot, ...parts);
  if (!resolved.startsWith(resolvedRoot + path.sep)) return null;

  return resolved;
}

// ---------------------------
//----------------- NORMALIZED PROVIDER MESSAGE UTILITIES ------------
/**
 * Generates a stable unique id for normalized provider messages.
 */
export function generateMessageId(prefix = 'msg'): string {
  return `${prefix}_${randomUUID()}`;
}

/**
 * Creates a normalized provider message and fills the shared envelope fields.
 *
 * Provider adapters and live SDK handlers pass through provider-specific fields,
 * while this helper guarantees every emitted event has an id, session id,
 * timestamp, and provider marker.
 */
export function createNormalizedMessage(fields: NormalizedMessageInput): NormalizedMessage {
  return {
    ...fields,
    id: fields.id || generateMessageId(fields.kind),
    sessionId: fields.sessionId || '',
    timestamp: fields.timestamp || new Date().toISOString(),
    provider: fields.provider,
  };
}

/**
 * Build the unified terminal `complete` lifecycle message.
 *
 * Contract: every provider run ends with exactly one `complete` (the
 * abort-session handler emits it on behalf of cancelled runs, so aborted runs
 * must NOT emit their own). The frontend treats `complete` as the only
 * terminal signal and never needs provider-specific handling:
 *
 * - `sessionId`     — the id the client knows this run by ('' if never discovered)
 * - `actualSessionId` — canonical id after the run; equals `sessionId` unless
 *                       the provider rewrote it mid-run
 * - `exitCode`      — 0 on success; a missing/null code (e.g. killed process)
 *                     is reported as failure
 * - `success`       — exitCode === 0 and not aborted
 * - `aborted`       — run was cancelled by the user
 */
export function createCompleteMessage(opts: {
  provider: NormalizedMessage['provider'];
  sessionId?: string | null;
  actualSessionId?: string | null;
  exitCode?: number | null;
  aborted?: boolean;
}): NormalizedMessage {
  const exitCode = typeof opts.exitCode === 'number' ? opts.exitCode : 1;
  const aborted = Boolean(opts.aborted);

  return createNormalizedMessage({
    kind: 'complete',
    provider: opts.provider,
    sessionId: opts.sessionId || null,
    actualSessionId: opts.actualSessionId || opts.sessionId || null,
    exitCode,
    success: exitCode === 0 && !aborted,
    aborted,
  });
}

// ---------------------------
//----------------- SUBAGENT TIMELINE UTILITIES ------------
/**
 * Longest tool output kept on one subagent activity.
 *
 * A subagent's timeline is nested inside a collapsed panel, so it is a preview
 * of what the agent did, never the primary place its output is read. Sending
 * every child command's full output made the history payload of an
 * agent-heavy session grow by megabytes for content almost nobody expands.
 */
const MAX_SUBAGENT_ACTIVITY_CONTENT = 4000;

function truncateForPreview(value: string | undefined): string | undefined {
  if (typeof value !== 'string' || value.length <= MAX_SUBAGENT_ACTIVITY_CONTENT) {
    return value;
  }
  const omitted = value.length - MAX_SUBAGENT_ACTIVITY_CONTENT;
  return `${value.slice(0, MAX_SUBAGENT_ACTIVITY_CONTENT)}\n… ${omitted} more characters`;
}

/**
 * Trims one subagent activity down to what its nested preview can show.
 *
 * Used by both provider session adapters so a Claude agent's timeline and a
 * Codex agent's timeline cost the same to transport.
 */
export function truncateSubagentActivity(activity: SubagentActivity): SubagentActivity {
  const truncatedContent = truncateForPreview(activity.content);
  const truncatedResult = activity.toolResult
    ? { ...activity.toolResult, content: truncateForPreview(activity.toolResult.content) }
    : activity.toolResult;

  if (truncatedContent === activity.content && truncatedResult === activity.toolResult) {
    return activity;
  }

  return { ...activity, content: truncatedContent, toolResult: truncatedResult };
}

// ---------------------------
//----------------- CONVERSATION HISTORY PAGINATION UTILITIES ------------
/**
 * Slices one page from the END of a chronologically ordered message list.
 *
 * This is the single pagination contract for conversation history across all
 * providers: `offset = 0` returns the most recent `limit` items, increasing
 * offsets walk backwards in time (for "scroll up to load older" UIs), and a
 * `null` limit returns everything. Items must already be sorted oldest-first;
 * the returned page preserves that order.
 *
 * Every provider history reader must use this helper instead of slicing
 * manually so `offset`/`limit` query params behave identically regardless of
 * which provider produced the session.
 */
export function sliceTailPage<T>(
  items: T[],
  limit: number | null,
  offset: number,
): { page: T[]; hasMore: boolean } {
  const total = items.length;
  const normalizedOffset = Math.max(0, offset);

  if (limit === null) {
    // A null limit returns the full list; offset still trims newest entries
    // so "everything before the page I already have" stays expressible.
    const end = Math.max(0, total - normalizedOffset);
    return {
      page: items.slice(0, end),
      hasMore: false,
    };
  }

  const end = Math.max(0, total - normalizedOffset);
  const start = Math.max(0, end - Math.max(0, limit));
  return {
    page: items.slice(start, end),
    hasMore: start > 0,
  };
}

// ---------------------------
//----------------- MCP CONFIG PARSING UTILITIES ------------
/**
 * Safely narrows an unknown value to a plain object record.
 *
 * This deliberately rejects arrays, `null`, and primitive values so callers can
 * treat the returned value as a JSON-style object map without repeating the same
 * defensive shape checks at every config read site.
 */
export const readObjectRecord = (value: any): AnyRecord | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  return value as AnyRecord;
};

/**
 * Reads an optional string from unknown input and normalizes empty or whitespace-only
 * values to `undefined`.
 *
 * This is useful when parsing config files where a field may be missing, present
 * with the wrong type, or present as an empty string that should be treated as
 * "not configured".
 */
export const readOptionalString = (value: unknown): string | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
};

/**
 * Reads an optional string array from unknown input.
 *
 * Non-array values are ignored, and any array entries that are not strings are
 * filtered out. This lets provider config readers consume loosely shaped JSON/TOML
 * data without failing on incidental invalid members.
 */
export const readStringArray = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value)) {
    return undefined;
  }

  return value.filter((entry): entry is string => typeof entry === 'string');
};

/**
 * Reads an optional string-to-string map from unknown input.
 *
 * The function first ensures the source value is a plain object, then keeps only
 * keys whose values are strings. If no valid entries remain, it returns `undefined`
 * so callers can distinguish "no usable map" from an empty object that was
 * intentionally authored downstream.
 */
export const readStringRecord = (value: unknown): Record<string, string> | undefined => {
  const record = readObjectRecord(value);
  if (!record) {
    return undefined;
  }

  const normalized: Record<string, string> = {};
  for (const [key, entry] of Object.entries(record)) {
    if (typeof entry === 'string') {
      normalized[key] = entry;
    }
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined;
};

// ---------------------------
//----------------- PROVIDER MODEL LOOKUP UTILITIES ------------
/**
 * Builds the standard "default current model" result used when a provider
 * cannot resolve a session-backed active model.
 *
 * Provider model adapters should call this after loading their supported model
 * catalog so the fallback stays aligned with the provider's current `DEFAULT`
 * selection instead of drifting to a hard-coded duplicate.
 */
export function buildDefaultProviderCurrentActiveModel(
  models: ProviderModelsDefinition,
): ProviderCurrentActiveModel {
  return {
    model: models.DEFAULT,
  };
}

// ---------------------------
//----------------- WEBSOCKET PAYLOAD PARSING UTILITIES ------------
/**
 * Parses one websocket message payload into a plain JSON object record.
 *
 * Use this in realtime handlers that receive raw websocket payloads as `string`,
 * `Buffer`, `ArrayBuffer`, or chunk arrays. The helper converts supported
 * payload formats to UTF-8 text, parses JSON, and returns only object payloads.
 * Primitive/array/invalid payloads return `null` so callers can handle bad input
 * without throwing from deeply nested message handlers.
 */
export const parseIncomingJsonObject = (payload: unknown): AnyRecord | null => {
  let text: string | null = null;

  if (typeof payload === 'string') {
    text = payload;
  } else if (Buffer.isBuffer(payload)) {
    text = payload.toString('utf8');
  } else if (payload instanceof ArrayBuffer) {
    text = Buffer.from(payload).toString('utf8');
  } else if (Array.isArray(payload)) {
    const buffers = payload
      .map((entry) => {
        if (Buffer.isBuffer(entry)) {
          return entry;
        }

        if (entry instanceof ArrayBuffer) {
          return Buffer.from(entry);
        }

        if (ArrayBuffer.isView(entry)) {
          return Buffer.from(entry.buffer, entry.byteOffset, entry.byteLength);
        }

        return null;
      })
      .filter((entry): entry is Buffer => entry !== null);

    if (buffers.length > 0) {
      text = Buffer.concat(buffers).toString('utf8');
    }
  }

  if (typeof text !== 'string' || text.trim().length === 0) {
    return null;
  }

  try {
    const parsed = JSON.parse(text) as unknown;
    return readObjectRecord(parsed);
  } catch {
    return null;
  }
};

/**
 * Reads a JSON config file and guarantees a plain object result.
 *
 * Missing files are treated as an empty config object so provider-specific MCP
 * readers can operate against first-run environments without special-case file
 * existence checks. If the file exists but contains invalid JSON, the parse error
 * is preserved and rethrown.
 */
export const readJsonConfig = async (filePath: string): Promise<Record<string, unknown>> => {
  try {
    const content = await readFile(filePath, 'utf8');
    const parsed = JSON.parse(content) as Record<string, unknown>;
    return readObjectRecord(parsed) ?? {};
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return {};
    }

    throw error;
  }
};

/**
 * Writes a JSON config file with stable, human-readable formatting.
 *
 * The parent directory is created automatically so callers can persist config into
 * provider-specific folders without pre-creating the directory tree. Output always
 * ends with a trailing newline to keep the file diff-friendly.
 */
export const writeJsonConfig = async (filePath: string, data: Record<string, unknown>): Promise<void> => {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
};

// ---------------------------
//----------------- PROVIDER SKILL FILE UTILITIES ------------
async function hasGitMarker(dirPath: string): Promise<boolean> {
  try {
    const gitMarkerStats = await stat(path.join(dirPath, '.git'));
    return gitMarkerStats.isDirectory() || gitMarkerStats.isFile();
  } catch {
    return false;
  }
}

/**
 * Finds the highest git worktree root visible from a starting directory.
 *
 * Provider skill systems such as Codex and OpenCode walk upward through parent
 * folders when resolving repository/project skills. Use this helper when a
 * provider needs the topmost `.git` marker instead of only the nearest one, so
 * monorepos and nested package folders discover shared root-level skills once.
 */
export async function findTopmostGitRoot(startPath: string): Promise<string | null> {
  let currentPath = path.resolve(startPath);
  let topmostGitRoot: string | null = null;

  while (true) {
    if (await hasGitMarker(currentPath)) {
      topmostGitRoot = currentPath;
    }

    const parentPath = path.dirname(currentPath);
    if (parentPath === currentPath) {
      break;
    }

    currentPath = parentPath;
  }

  return topmostGitRoot;
}

/**
 * Adds one provider skill source after normalizing and de-duplicating its root.
 *
 * Provider skill lookup rules often point at overlapping folders (for example a
 * workspace folder can also be the git root). Use this helper while building a
 * provider's `ProviderSkillSource[]` so the shared skills scanner reads each
 * physical root once and still preserves provider-specific scope/command data.
 */
export function addUniqueProviderSkillSource(
  sources: ProviderSkillSource[],
  seenRootDirs: Set<string>,
  source: ProviderSkillSource,
): void {
  const normalizedRootDir = path.resolve(source.rootDir);
  if (seenRootDirs.has(normalizedRootDir)) {
    return;
  }

  seenRootDirs.add(normalizedRootDir);
  sources.push({ ...source, rootDir: normalizedRootDir });
}

// ---------------------------
//----------------- PROVIDER SKILL MARKDOWN UTILITIES ------------
/**
 * Finds direct child skill markdown files under a provider skill root.
 *
 * Skill systems usually store one skill per child directory, so direct mode
 * scans only `<root>/<skill-name>/SKILL.md`. Recursive mode is reserved for
 * provider sources that can nest skills arbitrarily, and it returns every
 * descendant `SKILL.md`. Missing or unreadable roots return an empty list
 * because users may not have every provider installed or configured.
 */
export async function findProviderSkillMarkdownFiles(
  rootDir: string,
  options: { recursive?: boolean } = {},
): Promise<string[]> {
  const skillFiles: string[] = [];

  const collectRecursive = async (dirPath: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(dirPath, { withFileTypes: true });
    } catch {
      return;
    }

    try {
      const skillPath = path.join(dirPath, 'SKILL.md');
      const skillStats = await stat(skillPath);
      if (skillStats.isFile()) {
        skillFiles.push(skillPath);
      }
    } catch {
      // Directories without SKILL.md are expected while walking plugin trees.
    }

    for (const entry of entries) {
      if (entry.isDirectory() || entry.isSymbolicLink()) {
        await collectRecursive(path.join(dirPath, entry.name));
      }
    }
  };

  if (options.recursive) {
    await collectRecursive(rootDir);
    return skillFiles.sort((left, right) => left.localeCompare(right));
  }

  try {
    const entries = await readdir(rootDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) {
        continue;
      }

      const skillPath = path.join(rootDir, entry.name, 'SKILL.md');
      try {
        const skillStats = await stat(skillPath);
        if (skillStats.isFile()) {
          skillFiles.push(skillPath);
        }
      } catch {
        // A partial skill directory should not block discovery of sibling skills.
      }
    }

    return skillFiles.sort((left, right) => left.localeCompare(right));
  } catch {
    return [];
  }
}

/**
 * Reads the `name` and `description` fields from a provider skill markdown file.
 *
 * The metadata is expected in markdown front matter. If a skill omits `name`, the
 * parent directory name is used as a stable fallback so providers can still
 * expose the skill. Missing descriptions are normalized to an empty string.
 */
export async function readProviderSkillMarkdownDefinition(
  skillPath: string,
): Promise<{ name: string; description: string }> {
  const content = await readFile(skillPath, 'utf8');
  return readProviderSkillMarkdownDefinitionFromContent(
    content,
    path.basename(path.dirname(skillPath)),
  );
}

/**
 * Reads the `name` and `description` fields from raw skill markdown content.
 *
 * This keeps filesystem discovery and newly uploaded skill creation aligned on
 * the same front matter parsing rules. `fallbackName` is used when the markdown
 * omits a `name` field so callers still get a stable, non-empty skill id.
 */
export function readProviderSkillMarkdownDefinitionFromContent(
  content: string,
  fallbackName: string,
): { name: string; description: string } {
  const parsed = parseFrontMatter(content);
  const data = readObjectRecord(parsed.data) ?? {};

  return {
    name: readOptionalString(data.name) ?? fallbackName,
    description: readOptionalString(data.description) ?? '',
  };
}

// ---------------------------
//----------------- SESSION SYNCHRONIZER TITLE HELPERS ------------
/**
 * Produces a compact session title suitable for UI rendering and DB storage.
 *
 * Use this when converting provider-native names into a consistent title value.
 * The helper collapses repeated whitespace, trims the result, and truncates it
 * to 120 characters so every provider writes stable and bounded metadata.
 * If the normalized input is empty, it returns the supplied fallback title.
 */
export function normalizeSessionName(rawValue: string | undefined, fallback: string): string {
  const normalized = (rawValue ?? '').replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return fallback;
  }

  return normalized.slice(0, 120);
}

// ---------------------------
//----------------- PROVIDER SESSION VALUE NORMALIZATION UTILITIES ------------
/**
 * Converts provider-native timestamps into ISO strings.
 *
 * Provider CLIs commonly persist epoch timestamps as milliseconds, seconds, or
 * already-formatted date strings. Use this helper when normalizing session
 * metadata or transcript events so every provider writes the same ISO timestamp
 * shape to API responses and database rows.
 */
export function normalizeProviderTimestamp(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    const millis = value < 1_000_000_000_000 ? value * 1000 : value;
    return new Date(millis).toISOString();
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return normalizeProviderTimestamp(parsed);
    }

    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) {
      return date.toISOString();
    }
  }

  return new Date().toISOString();
}

/**
 * Parses a JSON string or narrows an existing object into a plain record.
 *
 * Use this when provider databases store structured JSON inside text columns.
 * Invalid JSON, arrays, and primitive values return `null` so callers can skip
 * malformed optional metadata without hiding the rest of a session transcript.
 */
export function readJsonRecord(value: unknown): AnyRecord | null {
  if (typeof value !== 'string') {
    return readObjectRecord(value);
  }

  try {
    return readObjectRecord(JSON.parse(value));
  } catch {
    return null;
  }
}

// ---------------------------
//----------------- OPENCODE SESSION STORAGE UTILITIES ------------
/**
 * Resolves the OpenCode SQLite session database path.
 *
 * OpenCode stores session, message, part, and project metadata in one shared
 * `opencode.db` file under its XDG data directory. Provider readers and
 * synchronizers should use this path for read-only access and should never store
 * it as a deletable transcript path for an individual app session row.
 */
export function getOpenCodeDatabasePath(): string {
  return path.join(os.homedir(), '.local', 'share', 'opencode', 'opencode.db');
}

/**
 * Decodes an OpenCode text payload that was persisted as a JSON string literal.
 *
 * OpenCode can store the first user prompt (and other text parts) as `"hello"`
 * instead of `hello`. Used by both the OpenCode session reader (transcript
 * history) and the OpenCode synchronizer (session titling) so a session name or
 * message body never surfaces with surrounding quote characters. Only fully
 * quoted, valid JSON string literals are unwrapped; ordinary prose that merely
 * happens to start/end with a quote is returned untouched.
 */
export function unwrapJsonStringLiteral(value: string): string {
  const trimmed = value.trim();
  if (!trimmed.startsWith('"') || !trimmed.endsWith('"')) {
    return value;
  }

  try {
    const parsed = JSON.parse(trimmed);
    return typeof parsed === 'string' ? parsed : value;
  } catch {
    return value;
  }
}

// ---------------------------
//----------------- SAFE DIRECTORY NAME UTILITIES ------------
/**
 * Validates that a user or provider supplied identifier can safely be treated
 * as one leaf directory name under an existing root folder.
 *
 * Use this before composing paths like `<root>/<session-id>/file.db>` to block
 * path traversal and accidental nested paths. The returned string is trimmed but
 * otherwise unchanged so callers can still match the provider's on-disk naming.
 */
export function sanitizeLeafDirectoryName(inputName: string, label = 'directory name'): string {
  const normalized = inputName.trim();
  if (!normalized) {
    throw new Error(`${label} is required.`);
  }

  if (
    normalized.includes('..')
    || normalized.includes(path.posix.sep)
    || normalized.includes(path.win32.sep)
    || normalized !== path.basename(normalized)
  ) {
    throw new Error(`Invalid ${label} "${inputName}".`);
  }

  return normalized;
}

// ---------------------------
//----------------- SESSION SYNCHRONIZER FILESYSTEM HELPERS ------------
/**
 * Recursively discovers files that match one extension, with optional incremental filtering.
 *
 * Provider synchronizers call this to find transcript artifacts under provider
 * home directories. Pass `lastScanAt` to include only files created after the
 * previous scan, or pass `null` to perform a full rescan. Missing directories
 * are treated as empty because not every provider exists on every machine.
 */
export async function findFilesRecursivelyCreatedAfter(
  rootDir: string,
  extension: string,
  lastScanAt: Date | null,
  fileList: string[] = []
): Promise<string[]> {
  try {
    const entries = await readdir(rootDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(rootDir, entry.name);

      if (entry.isDirectory()) {
        await findFilesRecursivelyCreatedAfter(fullPath, extension, lastScanAt, fileList);
        continue;
      }

      if (!entry.isFile() || !entry.name.endsWith(extension)) {
        continue;
      }

      if (!lastScanAt) {
        fileList.push(fullPath);
        continue;
      }

      const fileStat = await stat(fullPath);
      if (fileStat.birthtime > lastScanAt) {
        fileList.push(fullPath);
      }
    }
  } catch {
    // Missing provider folders are expected in first-run or partial setups.
  }

  return fileList;
}

/**
 * Reads file creation/update timestamps and maps them to DB-friendly ISO strings.
 *
 * Session indexers use this to persist `created_at` and `updated_at` metadata
 * when upserting sessions. If the file cannot be read, an empty object is
 * returned so indexing can continue for other files.
 */
export async function readFileTimestamps(
  filePath: string
): Promise<{ createdAt?: string; updatedAt?: string }> {
  try {
    const fileStat = await stat(filePath);
    return {
      createdAt: fileStat.birthtime.toISOString(),
      updatedAt: fileStat.mtime.toISOString(),
    };
  } catch {
    return {};
  }
}

/**
 * Returns the timestamp of the last timestamped record in a JSONL transcript.
 *
 * A transcript's mtime is not a record of conversation activity: the Claude
 * CLI appends bookkeeping records with no timestamp (`last-prompt`,
 * `permission-mode`, `cost-state`, `bridge-session`, `ai-title`, ...) while a
 * session sits open and idle, and occasionally rewrites the file with nothing
 * new in it. Session indexers use the last timestamped record instead so a
 * session's `updated_at` moves only when the transcript itself grew.
 *
 * The file is read backwards in `chunkBytes` steps. Chunks that hold no line
 * break are queued as raw bytes and decoded once, when the start of that line
 * is found, so a single oversized record (multi-megabyte tool results are
 * common) costs one pass rather than one re-decode per chunk. The scan gives
 * up after `maxScanBytes` so a transcript with no timestamped record at all
 * (truncated, corrupt, header-only) cannot cost a full read on every watcher
 * tick. Returns `undefined` when no timestamped record is found.
 */
export async function readLastTranscriptTimestamp(
  filePath: string,
  chunkBytes = 256 * 1024,
  maxScanBytes = 32 * 1024 * 1024
): Promise<string | undefined> {
  let handle: Awaited<ReturnType<typeof openFile>> | null = null;
  try {
    handle = await openFile(filePath, 'r');
    const { size } = await handle.stat();
    const floor = Math.max(0, size - maxScanBytes);
    let position = size;
    // Bytes of the not-yet-complete line at the front of the scanned region,
    // in file order, newest last.
    let pending: Buffer[] = [];

    while (position > floor) {
      const length = Math.min(position - floor, chunkBytes);
      position -= length;
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buffer, 0, length, position);
      if (bytesRead === 0) {
        // The file shrank underneath us (the CLI rewrote it); nothing more to read.
        return undefined;
      }
      position += length - bytesRead;
      const chunk = buffer.subarray(0, bytesRead);

      if (chunk.indexOf(0x0a) === -1 && position > floor) {
        pending.unshift(chunk);
        continue;
      }

      const joined = pending.length > 0 ? Buffer.concat([chunk, ...pending]) : chunk;
      let body = joined;
      pending = [];
      if (position > floor) {
        // The first segment is the tail of a line that starts in an earlier
        // chunk; hold it back until that chunk is read.
        const cut = joined.indexOf(0x0a);
        pending = [joined.subarray(0, cut)];
        body = joined.subarray(cut + 1);
      }

      const timestamp = findLastTimestamp(body.toString('utf8').split(/\r?\n/));
      if (timestamp) {
        return timestamp;
      }
    }

    return undefined;
  } catch {
    // Missing/unreadable files fall back to filesystem timestamps upstream.
    return undefined;
  } finally {
    await handle?.close();
  }
}

/**
 * Walks JSONL lines from the end and returns the first valid top-level
 * `timestamp` as an ISO string. Unparsable lines (a torn write in progress)
 * are skipped.
 */
function findLastTimestamp(lines: string[]): string | undefined {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]?.trim();
    if (!line) {
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }

    const timestamp = (parsed as Record<string, unknown> | null)?.timestamp;
    if (typeof timestamp === 'string' && !Number.isNaN(Date.parse(timestamp))) {
      return new Date(timestamp).toISOString();
    }
  }

  return undefined;
}

// ---------------------------
//----------------- SESSION SYNCHRONIZER JSONL PARSING HELPERS ------------
/**
 * Builds a first-seen key/value lookup map from a JSONL file.
 *
 * Use this for provider index files where session id -> display name metadata
 * is stored line-by-line. The first value for each key wins, preserving the
 * earliest known label while avoiding repeated map overwrites.
 */
export async function buildLookupMap(
  filePath: string,
  keyField: string,
  valueField: string
): Promise<Map<string, string>> {
  const lookup = new Map<string, string>();
  const fileStream = fs.createReadStream(filePath);
  const lineReader = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  try {
    for await (const line of lineReader) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        // A row can be half-written while the CLI is streaming into the file.
        // Skip it rather than abandoning every later entry in the file.
        continue;
      }

      // A row that parses to `null` (or any non-object) has no fields to read; indexing it would throw
      // outside the guard above and drop every later entry just as a torn row did.
      if (parsed === null || typeof parsed !== 'object') {
        continue;
      }

      const row = parsed as Record<string, unknown>;
      const key = row[keyField];
      const value = row[valueField];

      if (typeof key === 'string' && typeof value === 'string' && !lookup.has(key)) {
        lookup.set(key, value);
      }
    }
  } catch {
    // Missing or unreadable lookup files should not block session sync.
  } finally {
    // Close on every exit so a stream error cannot leak the file descriptor across repeated watcher scans.
    lineReader.close();
    fileStream.close();
  }

  return lookup;
}

/**
 * Reads a JSONL file and returns the first extracted payload that matches caller criteria.
 *
 * The caller supplies an `extractor` that validates provider-specific row
 * shapes. This helper centralizes line-by-line parsing and lets indexers stop
 * scanning as soon as one valid row is found.
 */
export async function extractFirstValidJsonlData<T>(
  filePath: string,
  extractor: (parsedJson: unknown) => T | null | undefined
): Promise<T | null> {
  const fileStream = fs.createReadStream(filePath);
  const lineReader = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  try {
    for await (const line of lineReader) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        // A row can be half-written while the CLI is streaming into the file.
        // Skip it rather than giving up before a later valid row.
        continue;
      }

      const extracted = extractor(parsed);
      if (extracted) {
        return extracted;
      }
    }
  } catch {
    // Ignore missing or unreadable artifacts so full scans keep progressing.
  } finally {
    // Close on every exit (match, no match, or stream error) so a malformed
    // artifact cannot leak the file descriptor across repeated watcher scans.
    lineReader.close();
    fileStream.close();
  }

  return null;
}

// ---------------------------
//----------------- CLI PROMPT ARGUMENT UTILITIES ------------
/**
 * Makes a prompt safe to pass as one CLI argument to `.cmd`-shimmed tools on
 * Windows (cursor-agent and opencode installed via npm-style shims).
 *
 * cmd.exe cannot carry newlines inside an argument: everything after the
 * first newline is silently dropped before the target CLI ever sees it, which
 * truncates multi-line prompts and any appended `<images_input>` block.
 * Collapsing newline runs to single spaces loses formatting but never loses
 * content, so runtimes should call this on win32 right before spawning.
 *
 * Used by the cursor and opencode spawn runtimes.
 */
export function flattenPromptForWindowsShell(prompt: string): string {
  if (process.platform !== 'win32' || typeof prompt !== 'string') {
    return prompt;
  }
  return prompt.replace(/\s*\r?\n\s*/g, ' ').trim();
}

// ---------------------------
//----------------- TERMINAL OUTPUT UTILITIES ------------
const ANSI_TERMINAL_STYLES = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
} as const;

/**
 * Applies the small, consistent ANSI style vocabulary used by backend
 * terminal output. The CLI and server bootstrap share these formatters so
 * status, warning, and startup messages use one implementation. Callers
 * should pass complete display strings and write the returned value directly
 * to stdout or stderr; the reset suffix prevents styling subsequent output.
 */
export const terminalTextStyles = {
  info: (text: string): string =>
    `${ANSI_TERMINAL_STYLES.cyan}${text}${ANSI_TERMINAL_STYLES.reset}`,
  ok: (text: string): string =>
    `${ANSI_TERMINAL_STYLES.green}${text}${ANSI_TERMINAL_STYLES.reset}`,
  warn: (text: string): string =>
    `${ANSI_TERMINAL_STYLES.yellow}${text}${ANSI_TERMINAL_STYLES.reset}`,
  error: (text: string): string =>
    `${ANSI_TERMINAL_STYLES.yellow}${text}${ANSI_TERMINAL_STYLES.reset}`,
  tip: (text: string): string =>
    `${ANSI_TERMINAL_STYLES.blue}${text}${ANSI_TERMINAL_STYLES.reset}`,
  bright: (text: string): string =>
    `${ANSI_TERMINAL_STYLES.bright}${text}${ANSI_TERMINAL_STYLES.reset}`,
  dim: (text: string): string =>
    `${ANSI_TERMINAL_STYLES.dim}${text}${ANSI_TERMINAL_STYLES.reset}`,
};

// ---------------------------
//----------------- RUNTIME PATH RESOLUTION UTILITIES ------------
/**
 * Resolves the directory containing an ES module from `import.meta.url`.
 * Backend entrypoints and feature composition roots use this instead of
 * recreating CommonJS `__dirname` logic.
 */
export function getModuleDirectory(importMetaUrl: string): string {
  return path.dirname(fileURLToPath(importMetaUrl));
}

/**
 * Walks upward to the nearest `server` directory in either source or compiled
 * output. Callers use this stable anchor for server-relative resources.
 */
export function findServerRoot(startDirectory: string): string {
  let currentDirectory = startDirectory;
  while (path.basename(currentDirectory) !== 'server') {
    const parentDirectory = path.dirname(currentDirectory);
    if (parentDirectory === currentDirectory) {
      throw new Error(`Could not resolve the backend server root from "${startDirectory}".`);
    }
    currentDirectory = parentDirectory;
  }
  return currentDirectory;
}

/**
 * Resolves the application root from a source or `dist-server/server` path so
 * package-level resources work identically before and after compilation.
 */
export function findApplicationRoot(startDirectory: string): string {
  const serverRoot = findServerRoot(startDirectory);
  const parentDirectory = path.dirname(serverRoot);
  return path.basename(parentDirectory) === 'dist-server'
    ? path.dirname(parentDirectory)
    : parentDirectory;
}

/**
 * Expands a leading `~` to this user's home directory; anywhere else it is an
 * ordinary character.
 *
 * Every module that reads a state root or a binary path out of the environment
 * needs this, because the defaults are written the way an operator writes them
 * on a shell and the server is not one. It lives here and not in each lane
 * because three byte-identical copies drift the moment one of them learns
 * something the others do not — `~` for another user, a `~user` form, a
 * trailing separator — and only one lane then honors it.
 */
export function expandHome(value: string): string {
  if (value === '~') return os.homedir();
  return value.startsWith('~/') ? path.join(os.homedir(), value.slice(2)) : value;
}

/**
 * Where Claude Code keeps its settings and login: `CLAUDE_CONFIG_DIR` when set, else `~/.claude`.
 *
 * Consumers: `claude-auth.provider.ts` (where the login's credentials live),
 * `claude-account-default-model.ts` (the user settings' `model`, the account's default),
 * `claude-login-renewal.ts` (the CLI's config dir for the renewal, and where it re-reads the pass's
 * clock) and `usage.service.ts` (the credentials file the usage meter reads).
 */
export function claudeConfigDir(): string {
  return process.env.CLAUDE_CONFIG_DIR?.trim() || path.join(os.homedir(), '.claude');
}

/**
 * Whether the CLI's config directory is the default `~/.claude`, the one whose `~/.claude.json` names the
 * signed-in account. With `CLAUDE_CONFIG_DIR` pointing elsewhere the CLI keeps its identity file and its
 * tokens THERE, so a read of `~/.claude.json` would name a login other than the tokens' — a confident wrong
 * name. A reader of that file asks this first and says nothing when the answer is `false`.
 *
 * Consumers: `claude-auth.provider.ts` (the status line falls back to "Authenticated" instead of the
 * door's email) and `usage.service.ts` (the meter's account digest is `''`, "could not be told").
 */
export function claudeConfigDirIsDefault(): boolean {
  return path.resolve(claudeConfigDir()) === path.join(os.homedir(), '.claude');
}

/**
 * Where the launcher keeps its launch directories, unless the operator moved it.
 *
 * Consumers: the dispatch-souls module (its poll and its running-launchers read) and the providers
 * module (`session-soul-launches.service.ts`'s stamp scan), which all had to ask the same question
 * and answered it three times over before this.
 *
 * The launcher's own root is `hooks/plan_runner/solo/record.py:dispatch_dir()` — `dispatch-souls/`
 * under the house's state root, `~/.claude/state` unless `$DISPATCHER_HOME` moves it — so this
 * default is a COPY of a rule we do not own, and the env name is ours: a seam for pointing a probe
 * at a hermetic tree rather than a knob for moving the launcher. Set it and every reader here looks
 * somewhere else; a dispatch still writes to the launcher's own root, which is not something an env
 * var of THIS name may reach.
 *
 * Read on every call, never cached, so a probe that sets the seam after import is not answered with
 * the live root.
 */
export function dispatchSoulsStateDir(): string {
  return expandHome(process.env.DISPATCH_SOULS_STATE_DIR || '~/.claude/state/dispatch-souls');
}

// ---------------------------
//----------------- DISPATCHER MODEL WORD UTILITIES ------------

/**
 * The only words the dispatcher's own `model` verb accepts (`hooks/plan_runner/run_model.py:WORDS`,
 * unpacked by `hooks/dispatcher/model.py`, and the door's `default` that clears a row) in the order the
 * controls draw them. The routes relay a member of THIS list, never the request's own string, so the
 * argv word a verb is spawned with is always ours.
 */
const DISPATCHER_MODEL_CHOICES: readonly DispatcherModelChoice[] = ['deepseek', 'claude', 'default'];

/**
 * A model word as one of `DISPATCHER_MODEL_CHOICES`, or `null` for anything else — a missing field, another
 * casing, a word with padding. Used by the plan route (`POST /plans/:name/model`) and the arc route
 * (`POST /arcs/:name/model`) to refuse a body with a 400 before anything is spawned.
 */
export function readDispatcherModelChoice(value: unknown): DispatcherModelChoice | null {
  return DISPATCHER_MODEL_CHOICES.find((choice) => choice === value) ?? null;
}

/** The 400 sentence both model routes answer with when `readDispatcherModelChoice` finds no word. */
export function dispatcherModelChoiceError(): string {
  return `model must be one of ${DISPATCHER_MODEL_CHOICES.join(', ')}`;
}

// ---------------------------
//----------------- DISPATCHER SCHEDULE WORD UTILITIES ------------

/**
 * A strict ISO-8601 instant WITH its zone: `2026-09-23T10:00:00Z`, `2026-09-23T03:00-07:00`, seconds and a
 * fraction optional. The zone is required because the dispatcher refuses a naive time (it names no clock), and
 * the shape is anchored end to end so nothing but a timestamp can ride through to argv.
 */
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}:\d{2})$/;

/**
 * A request body's schedule word, or `null` for anything the dispatcher's `schedule` verb would not take:
 * `offpeak`, `none`, or an `ISO_INSTANT` that `Date.parse` also accepts. The dispatcher stays the final judge —
 * a time already past is ITS refusal, carried back whole. Used by `POST /plans/:name/schedule` and
 * `POST /arcs/:name/schedule` to refuse a body with a 400 before anything is spawned, so the argv word is
 * always one of these shapes and never free text.
 */
export function readDispatcherScheduleWhen(value: unknown): string | null {
  if (value === 'offpeak' || value === 'none') return value;
  if (typeof value !== 'string' || !ISO_INSTANT.test(value)) return null;
  return Number.isFinite(Date.parse(value)) ? value : null;
}

/** The 400 sentence both schedule routes answer with when `readDispatcherScheduleWhen` finds no word. */
export function dispatcherScheduleWhenError(): string {
  return 'when must be offpeak, none, or an ISO-8601 timestamp with a zone';
}


// ---------------------------
//----------------- TOKEN FIGURES ------------

/**
 * A token count as a person reads it: `94.9M`, `1M`, `12.5k`, `412`.
 *
 * The server's twin of `src/shared/spend.ts:humanizeTokens`, and both are byte-for-byte
 * `hooks/plan_runner/costs.py`'s `humanize` — the same cut at 999,950 and the same trailing-zero trim,
 * so a card and the push it earns cannot round the same figure two ways. Duplicated rather than
 * imported because the two builds each resolve `@/shared` to their OWN tree (`server/shared` here,
 * `src/shared` in the client); the pair is checked by eye, as the type mirrors are.
 */
export function humanizeTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 999_950) return `${(n / 1e3).toFixed(1).replace(/\.0$/, '')}k`;   // the same cut
  return `${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M`;
}


// ---------------------------
//----------------- ERROR WORDS ------------

/**
 * The words of whatever a `catch` caught, for a log line: an `Error`'s message, any other thrown value as a string.
 *
 * Consumed by the chat-names module (`chat-namer.service.ts`, `haiku-name.ts`), which logs why a naming pass could not run. Never throws,
 * and says nothing about the stack: a log line that needs one logs the error itself.
 */
export function errorReason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// ---------------------------
//----------------- STORED TIMESTAMP UTILITIES ------------

/** The shape `new Date().toISOString()` writes: UTC, milliseconds, fixed width, so two of them compare correctly as text. */
const STORE_STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/**
 * Whether `value` is a stamp the way the stores keep every time: a fixed-width ISO-8601 UTC instant with milliseconds that is also a
 * real date. A text comparison of two such stamps is a comparison in time, which a bare `isText` cannot promise (`''`, `'banana'` and
 * `'2026'` are text); a check that reads "after `since`" or "past `expiresAt`" must refuse anything else rather than fail open.
 *
 * Consumed by the companion module (`companion-pending.ts`, which refuses a stored action whose stamps are not this) and the companion
 * repository (`companion.db.ts`, whose `heardSince` refuses a `since` that is not this).
 */
export function isStoreStamp(value: unknown): value is string {
  return typeof value === 'string' && STORE_STAMP.test(value) && Number.isFinite(Date.parse(value));
}
