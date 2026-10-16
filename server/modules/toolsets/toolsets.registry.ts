import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { ToolsetDefinition, ToolsetServerConfig } from '@/shared/toolset-types.js';
import { AppError, findApplicationRoot, getModuleDirectory } from '@/shared/utils.js';

/**
 * The box's tool-set registry as a FILE, on the rules `apps.store.ts` keeps for the application list.
 *
 * One reader of what a set IS: `toolsets.service.ts` (the view and the switch) and the launch hook
 * beside it. Everything here is the file — where it is, how it is created, how it is read.
 *
 * 1. **Created when absent, never repaired.** `ensureToolsetsFile()` writes `{}` and NOTHING else. A
 *    file that exists is never rewritten by a read, whatever is in it: the operator's definitions are
 *    his, and re-seeding over one stray comma is how a set disappears.
 * 2. **Read on every call, never cached.** A few hundred bytes and no watcher: a set appended with a
 *    text editor is there for the very next chat launch and the very next switch.
 * 3. **Never written by the server otherwise.** A session can switch a set that is defined; it can
 *    never define one. No route, no command and no tool takes a server config.
 *
 * A defect is an `AppError` that names the set, the server and the rule, and the callers that must
 * not break on it (a chat's launch) catch it; the callers that must show it (the view) print it.
 */
const TOOLSETS_FILE_NAME = 'toolsets.local.json';

/**
 * What a set may be called, in the file and in every door's `set`. One pattern for both, so a name
 * the file accepts is a name a door can ask for. Consumed by this reader and by `toolsets.service.ts`,
 * which judges the name a caller sends before it looks the set up.
 */
export const SET_NAME_PATTERN = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const SERVER_NAME_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Where the registry lives: `TOOLSETS_FILE` when the environment sets it, else the APPLICATION root
 * beside `apps.local.json`. Found from the module's own directory and never `process.cwd()`, for the
 * reason `resolveAppsFile` is, and read at every call so a probe's environment is the one honored.
 * Consumed by this file, by `toolsets.service.ts` (the path the view reports) and by `ensureToolsetsFile`.
 */
export function resolveToolsetsFile(): string {
  const override = process.env.TOOLSETS_FILE;
  if (override) return override;
  return path.join(findApplicationRoot(getModuleDirectory(import.meta.url)), TOOLSETS_FILE_NAME);
}

/**
 * Creates the registry as `{}` if it is not there, and leaves it alone if it is. `flag: 'wx'` makes
 * the create itself the test, because the operator's own server is running against this path and
 * restarts on every save under `server/`: the one answer that is not a failure — `EEXIST`, somebody
 * else won the race — is swallowed. Consumed by `toolsets.module.ts` at boot.
 */
export function ensureToolsetsFile(): void {
  try {
    writeFileSync(resolveToolsetsFile(), '{}\n', { flag: 'wx' });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return;
    throw error;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isStringArray(value: unknown): boolean {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isStringRecord(value: unknown): boolean {
  return isPlainObject(value) && Object.values(value).every((item) => typeof item === 'string');
}

/**
 * The rule one server breaks, as a phrase, or null when it breaks none. The CLI reads the config
 * as written, so only the keys that decide whether it CAN start are judged; every other key passes
 * through untouched. `"sdk"` is refused with the rest: an in-process server cannot be defined in a
 * file, and a `setMcpServers` that passes one would tear down the SDK server hosting the switch.
 */
function serverDefect(server: unknown): string | null {
  if (!isPlainObject(server)) return 'a server must be a JSON object';

  const { type } = server;
  if (type === undefined || type === 'stdio') {
    if (!isNonEmptyString(server.command)) return 'a stdio server needs a command';
    if (server.args !== undefined && !isStringArray(server.args)) return 'args must be a list of strings';
    if (server.env !== undefined && !isStringRecord(server.env)) return 'env must be an object of strings';
    return null;
  }

  if (type === 'http' || type === 'sse') {
    if (!isNonEmptyString(server.url)) return `an ${type} server needs a url`;
    if (server.headers !== undefined && !isStringRecord(server.headers)) return 'headers must be an object of strings';
    return null;
  }

  return `type ${JSON.stringify(type)} is not supported (a server is stdio, http or sse)`;
}

/**
 * The registry as the file holds it: every set in file order, every server as written.
 *
 * Validation is all-or-nothing and in file order, so the first defect is the one reported and the
 * operator fixes them one at a time with the same message the view shows him. A set whose servers
 * are fine is still not offered while another set is broken: a half-read registry would let a chat
 * switch on a set from a file its owner has not finished editing.
 *
 * File order is `JSON.parse`'s key order, which puts an all-digit name (`"42"`) ahead of the rest;
 * nothing but the listing's order depends on it, and the launch merges by sorted name regardless.
 */
export function readToolsetRegistry(): { file: string; sets: ToolsetDefinition[] } {
  const file = resolveToolsetsFile();
  const defect = (message: string): AppError =>
    new AppError(message, { code: 'TOOLSETS_REGISTRY_INVALID', statusCode: 500, details: { path: file } });

  // A file deleted since boot comes back as `{}` on the first read, exactly as the apps registry
  // does; when even that cannot be written, the read below names the real problem.
  try {
    ensureToolsetsFile();
  } catch {
    // The read that follows reports the failure in the registry's own words.
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw defect(
      error instanceof SyntaxError ? `the file is not valid JSON (${reason})` : `the file could not be read (${reason})`,
    );
  }
  if (!isPlainObject(parsed)) throw defect('the file must be a JSON object whose keys are set names');

  const sets: ToolsetDefinition[] = [];
  const serverOwners = new Map<string, string>();

  for (const [name, value] of Object.entries(parsed)) {
    if (!SET_NAME_PATTERN.test(name)) {
      throw defect(
        `set ${JSON.stringify(name)}: a set name is lowercase letters, digits, "_" and "-", starting with a letter or digit, up to 32 characters`,
      );
    }
    if (!isPlainObject(value)) throw defect(`set "${name}": a set must be a JSON object`);

    let description: string | null = null;
    if (value.description !== undefined) {
      if (typeof value.description !== 'string' || value.description.trim() === '') {
        throw defect(`set "${name}": description must be a non-empty string`);
      }
      description = value.description.trim();
    }

    if (!isPlainObject(value.mcpServers) || Object.keys(value.mcpServers).length === 0) {
      throw defect(`set "${name}": mcpServers must be an object holding at least one server`);
    }

    const servers: Array<[string, ToolsetServerConfig]> = [];
    for (const [serverName, server] of Object.entries(value.mcpServers)) {
      if (!SERVER_NAME_PATTERN.test(serverName)) {
        throw defect(
          `set "${name}": server ${JSON.stringify(serverName)}: a server name is letters, digits, "_" and "-", up to 64 characters`,
        );
      }
      const owner = serverOwners.get(serverName);
      if (owner !== undefined) {
        throw defect(`set "${name}": server "${serverName}": already defined by set "${owner}" (a server name is unique on the box)`);
      }
      const rule = serverDefect(server);
      if (rule !== null) throw defect(`set "${name}": server "${serverName}": ${rule}`);

      serverOwners.set(serverName, name);
      servers.push([serverName, server as ToolsetServerConfig]);
    }

    // `fromEntries` and not an indexed write: a server named `__proto__` is a legal name here, and
    // an assignment to it would set the object's prototype instead of adding a server.
    sets.push({ name, description, mcpServers: Object.fromEntries(servers) });
  }

  return { file, sets };
}
