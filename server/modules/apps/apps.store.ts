import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { AppEntry, DividerEntry } from '@/shared/app-types.js';
import { AppError, findApplicationRoot, getModuleDirectory } from '@/shared/utils.js';

import { DEFAULT_APPS } from './apps.seed.js';

/**
 * The application registry as a FILE, and the rules that keep the operator's list his.
 *
 * One consumer: `apps.service.ts`, which holds every judgement about what a caller may send. What
 * lives here is only the file — where it is, how it is created, how it is read, how it is written
 * — and the three rules below are the whole of its character:
 *
 * 1. **Created when absent, never repaired.** `ensureAppsFile()` writes the seed and NOTHING else.
 *    A file that exists is never rewritten by a read, whatever is in it: the file is the
 *    operator's own list, and re-seeding it over one stray comma is how a list disappears.
 * 2. **Read on every call, never cached.** A few hundred bytes, and no watcher, no restart: a
 *    builder who appends a row with a text editor sees it on the next `GET`.
 * 3. **Written atomically**, to a scratch name in the SAME directory, then `renameSync` onto the
 *    real one — a half-written registry is never observable. Two live servers read this path
 *    (see the create below), so the scratch name would gain a pid
 *    (`<path>.<pid>.tmp`, the shape `server/modules/providers/.../readopt.ts:147` uses) the day
 *    two writers race here in earnest; the plan named this one, and the window is a `renameSync`.
 */
const APPS_FILE_NAME = 'apps.local.json';

/**
 * Where the registry lives: `APPS_FILE` when the environment sets it, else the APPLICATION root.
 *
 * `findApplicationRoot(getModuleDirectory(import.meta.url))` and never `process.cwd()` — the dev
 * supervisor and systemd do not agree on a working directory, so a relative path would name one
 * file under `tsx` and another under a compiled install. It is the idiom this server already uses
 * to find its own root from inside a module (`server/modules/deepseek/index.ts:31`).
 *
 * Read on every call rather than captured in a constant, so the environment that is set when the
 * process starts is the environment that is honored, probes included.
 */
export function resolveAppsFile(): string {
  const override = process.env.APPS_FILE;
  if (override) return override;
  return path.join(findApplicationRoot(getModuleDirectory(import.meta.url)), APPS_FILE_NAME);
}

/** The registry file as JSON text, two-space indented and newline-terminated — the seed's shape too. */
function serializeApps(entries: Array<AppEntry | DividerEntry>): string {
  return `${JSON.stringify(entries, null, 2)}\n`;
}

/**
 * Creates the registry with the seed if it is not there yet, and leaves it alone if it is.
 *
 * `flag: 'wx'` and not `existsSync` followed by a write: the operator's own server is running
 * against this same path and hot-restarts on every save under `server/`, so the gap between a
 * check and a write is a real race with a real second writer. `wx` makes the create itself the
 * test, and the ONE answer it can give that is not a failure — `EEXIST` — is swallowed: losing
 * that race means somebody else created the file, which is the outcome this call wanted.
 */
export function ensureAppsFile(): void {
  const appsFile = resolveAppsFile();
  try {
    writeFileSync(appsFile, serializeApps(DEFAULT_APPS), { flag: 'wx' });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return;
    throw error;
  }
}

/**
 * An entry is a row of three non-empty strings, and an optional `description` that is a string when
 * present. Anything else is a broken row, not a row.
 */
function isAppEntry(value: unknown): value is AppEntry {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === 'string' &&
    candidate.id.length > 0 &&
    typeof candidate.name === 'string' &&
    candidate.name.length > 0 &&
    typeof candidate.url === 'string' &&
    candidate.url.length > 0 &&
    (candidate.description === undefined || typeof candidate.description === 'string')
  );
}

/** A divider is an id and a title string (blank allowed), and no address. */
export function isDividerEntry(value: unknown): value is DividerEntry {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.id === 'string' && candidate.id.length > 0 && typeof candidate.divider === 'string'
    && candidate.url === undefined;
}

/**
 * The registry, as the file holds it — apps and dividers in file order, with no sorting and no
 * defaults filled in.
 *
 * A file that cannot be read as a registry is a 500 and is NEVER overwritten with the seed: the
 * operator has a list, and the one thing this module must never do is trade his rows for a clean
 * boot. The two messages below are the two ways a file stops being a registry — it is not valid
 * JSON at all (a parse error, or a root that is not an array), or one row in it is not a row.
 *
 * The id PATTERN is deliberately not re-applied on read, only the fact that the three fields are
 * non-empty strings: the pattern is the contract for an id a caller POSTs, while a row the
 * operator typed by hand is his to name, and a capital letter there must not 500 the whole list.
 */
export function readEntries(): Array<AppEntry | DividerEntry> {
  ensureAppsFile();

  const appsFile = resolveAppsFile();
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(appsFile, 'utf8'));
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new AppError('apps registry is not valid JSON', {
        code: 'APPS_REGISTRY_INVALID_JSON',
        statusCode: 500,
        details: { path: appsFile },
      });
    }
    throw error;
  }

  if (!Array.isArray(parsed)) {
    throw new AppError('apps registry is not valid JSON', {
      code: 'APPS_REGISTRY_INVALID_JSON',
      statusCode: 500,
      details: { path: appsFile },
    });
  }

  const entries: Array<AppEntry | DividerEntry> = [];
  for (const [index, value] of parsed.entries()) {
    if (!isAppEntry(value) && !isDividerEntry(value)) {
      const label = typeof (value as { id?: unknown })?.id === 'string'
        ? String((value as { id: unknown }).id)
        : String(index);
      throw new AppError(`apps registry holds an invalid entry: ${label}`, {
        code: 'APPS_REGISTRY_INVALID_ENTRY',
        statusCode: 500,
        details: { path: appsFile, index },
      });
    }
    entries.push(value);
  }

  return entries;
}

/** The registry, replaced wholesale — the file is the order, so a caller hands back the whole list. */
export function writeEntries(entries: Array<AppEntry | DividerEntry>): void {
  const appsFile = resolveAppsFile();
  const scratch = `${appsFile}.tmp`;
  writeFileSync(scratch, serializeApps(entries));
  renameSync(scratch, appsFile);
}
