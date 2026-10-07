/**
 * Who each MCP server a chat process runs with is signed in as, read from the store the CLI itself
 * writes — so that a sign-in made while the process runs can replace it.
 *
 * Why the launch profile needs this: a CLI decides a server "needs authentication" when it connects
 * at launch and never looks again. An MCP OAuth sign-in writes its tokens to
 * `<config dir>/.credentials.json` under `mcpOAuth` and leaves `~/.claude.json` untouched, so the
 * MCP map in the profile cannot see it, and the process keeps the server unauthenticated for as
 * long as it lives (the idle close is two hours).
 *
 * What a reading is made of, from how CLI 2.1.292 writes `mcpOAuth` (entries keyed
 * `<serverName>|<hash of the server's config>`):
 * - SIGNED IN means a non-empty `accessToken` or `refreshToken`. A tokenless stub — what an
 *   unfinished sign-in leaves, and what a sign-out that keeps the client registration leaves — reads
 *   exactly as no entry, so the CLI clearing its own stub is not a change.
 * - THE IDENTITY of a sign-in is `clientId`, `issuer` and `redirectUri`. An interactive sign-in picks
 *   a fresh loopback callback port, which re-registers the client; the CLI's own token refresh
 *   (`saveTokens`) rewrites `accessToken`, `refreshToken`, `expiresAt`, `scope` and `discoveryState`
 *   and none of these three. Those rewritten fields are left OUT on purpose: a respawn on every
 *   routine refresh would be a regression, and expiry is left out for the same reason (a token
 *   running out changes nothing a fresh process could fix).
 * - ONLY A DIGEST is kept. No token, secret or file content is ever returned or logged.
 *
 * WHICH SERVERS: the MCP map CloudCLI hands the CLI, plus the servers the CLI loads on its own and
 * the map never holds — the project's local-scope servers (`projects[cwd].mcpServers` in the CLI's
 * global config) and the `.mcp.json` of the cwd and each parent. Only NAMES are taken from those;
 * the launch arguments stay exactly what they were, so no running process is replaced by this.
 *
 * Known limit: a re-sign-in that lands on the same registration, with tokens on both sides, writes
 * nothing this reading can tell from a refresh, and goes unseen until the process is replaced.
 *
 * consumer: claude-runtime.provider.js (resolveSdkOptions — the profile taken at launch and at each message)
 */

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { resolveClaudeConfigDir } from '@/shared/claude-config-dir.js';
import { readObjectRecord, readOptionalString } from '@/shared/utils.js';

const SIGNED_OUT = 'signed-out';

/** A fault's code or name — never its message, which for a parse error quotes the file's content. */
function faultLabel(error: unknown): string {
  if (!(error instanceof Error)) return 'UnknownError';
  const { code } = error as { code?: unknown };
  return typeof code === 'string' && code ? code : error.name;
}

/**
 * The server names a JSON file holds under `mcpServers` (or under `projects[cwd]`, for the global
 * config): `[]` for a file that is absent or cannot be opened — the CLI cannot read it either — and
 * null for one that opens but does not parse, which for a file the CLI keeps rewriting is a write in
 * progress: "not heard", never "none".
 */
async function readServerNames(file: string, cwd: string | null): Promise<string[] | null> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    return error instanceof SyntaxError ? null : [];
  }
  const root = readObjectRecord(parsed);
  const scope = cwd === null ? root : readObjectRecord(readObjectRecord(root?.projects)?.[cwd]);
  return Object.keys(readObjectRecord(scope?.mcpServers) ?? {});
}

/**
 * The servers the CLI loads for this process beyond the map: the local-scope servers of `cwd` from
 * the global config (`$CLAUDE_CONFIG_DIR/.claude.json`, else `~/.claude.json` — the CLI's own rule,
 * which is not the credentials directory's) and the `.mcp.json` of `cwd` and every parent up to the
 * root. Null only when the global config could not be parsed this time; a `.mcp.json` that does not
 * parse is one the CLI cannot read either, so it names nothing.
 */
async function readCliOwnServerNames(cwd: string | undefined, env: NodeJS.ProcessEnv | undefined): Promise<string[] | null> {
  if (!cwd) return [];
  const projectDir = path.resolve(cwd);
  const projectFiles: string[] = [];
  for (let dir = projectDir; ; dir = path.dirname(dir)) {
    projectFiles.push(path.join(dir, '.mcp.json'));
    if (path.dirname(dir) === dir) break;
  }
  const [globalNames, ...projectNames] = await Promise.all([
    readServerNames(path.join(env?.CLAUDE_CONFIG_DIR?.trim() || os.homedir(), '.claude.json'), projectDir),
    ...projectFiles.map((file) => readServerNames(file, null))
  ]);
  return globalNames === null ? null : [...globalNames, ...projectNames.flatMap((names) => names ?? [])];
}

/**
 * One digest per MCP server the process runs with (see the header): `signed-out`, or a short hash of
 * the identity of every sign-in held for that name. `{}` when there are no such servers, and null when
 * the store — or the global config that names local servers — exists but cannot be read this time (a
 * write in progress): an unread store is never a reason to replace a process, the same rule as an
 * unreadable MCP config.
 *
 * A store that does not exist is a valid reading: nobody is signed in anywhere.
 */
export async function readMcpSignIn(
  mcpServers: Record<string, unknown> | undefined,
  cwd: string | undefined,
  env: NodeJS.ProcessEnv | undefined
): Promise<Record<string, string> | null> {
  const ownNames = await readCliOwnServerNames(cwd, env);
  if (ownNames === null) {
    console.warn('[Claude SDK] The CLI global config could not be parsed; sign-ins are not compared for this message');
    return null;
  }
  const names = [...new Set([...Object.keys(mcpServers ?? {}), ...ownNames])];
  if (names.length === 0) return {};

  let store: Record<string, unknown> = {};
  try {
    const raw = await readFile(path.join(resolveClaudeConfigDir(env), '.credentials.json'), 'utf8');
    store = readObjectRecord(readObjectRecord(JSON.parse(raw))?.mcpOAuth) ?? {};
  } catch (error) {
    if (faultLabel(error) !== 'ENOENT') {
      console.warn(`[Claude SDK] MCP sign-in store not readable (${faultLabel(error)}); sign-ins are not compared for this message`);
      return null;
    }
  }

  const identitiesByServer = new Map<string, string[]>(names.map((name) => [name, []]));
  for (const value of Object.values(store)) {
    const entry = readObjectRecord(value);
    const identities = identitiesByServer.get(readOptionalString(entry?.serverName) ?? '');
    if (!entry || !identities) continue;
    if (!readOptionalString(entry.accessToken) && !readOptionalString(entry.refreshToken)) continue;
    identities.push([entry.clientId, entry.issuer, entry.redirectUri].map((field) => readOptionalString(field) ?? '').join('\u0000'));
  }

  return Object.fromEntries(
    [...identitiesByServer].map(([name, identities]) => [
      name,
      identities.length === 0
        ? SIGNED_OUT
        : createHash('sha256').update(identities.sort().join('\n')).digest('hex').slice(0, 16)
    ])
  );
}
