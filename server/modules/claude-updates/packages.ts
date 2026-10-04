/**
 * The two packages the update pipeline knows, and what is on disk for each of them right now.
 *
 * One table, one home: the npm names, the labels, the scopes and the two changelog URLs are facts
 * about the world that the check, the runner and the report all read, so they are spelled here
 * rather than again in each of them. `cli` comes first on purpose — every report is `[cli, sdk]`,
 * in that order.
 *
 * The readers answer the three DIFFERENT questions the report needs, and none of them is inferred
 * from another:
 * - `readSdkVersionOnDisk()` — the SDK's package.json, found through the module resolver, i.e. the
 *   package this repository actually installed.
 * - `LOADED_SDK_VERSION` — what THIS API process imported, taken once as this module is evaluated.
 * - `readCliUpdatable()` — whether the CLI this server spawns is one `npm -g` owns, decided from
 *   the ONE resolver (`claude-cli-path.ts`) rather than a second rule of our own (MAN-502 rule 1).
 */

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { promisify } from 'node:util';

import { resolveSpawnedClaudeBinaryPath } from '@/shared/claude-cli-path.js';
import type { ClaudeUpdatePackageKey } from '@/shared/claude-update-types.js';

const execFileAsync = promisify(execFile);

const CLI_PACKAGE_NAME = '@anthropic-ai/claude-code';
const SDK_PACKAGE_NAME = '@anthropic-ai/claude-agent-sdk';

/** `npm root -g` answers in milliseconds; the ceiling is for a registry that hangs, not a slow one. */
const NPM_ROOT_TIMEOUT_MS = 30_000;

/** One package's fixed row: where it comes from, what it is called, and where its changelog lives. */
type UpdatePackageRow = {
  key: ClaudeUpdatePackageKey;
  name: string;
  label: string;
  /** `global` is installed by `npm -g`, `repo` is pinned in this repository's package.json. */
  scope: 'global' | 'repo';
  changelogRawUrl: string;
  changelogUrl: string;
};

/** The two rows, cli first. Read by the check, the runner and the report; never re-named anywhere. */
export const CLAUDE_UPDATE_PACKAGES: readonly UpdatePackageRow[] = [
  {
    key: 'cli',
    name: CLI_PACKAGE_NAME,
    label: 'Claude Code',
    scope: 'global',
    changelogRawUrl: 'https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md',
    changelogUrl: 'https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md',
  },
  {
    key: 'sdk',
    name: SDK_PACKAGE_NAME,
    label: 'Claude Agent SDK',
    scope: 'repo',
    changelogRawUrl: 'https://raw.githubusercontent.com/anthropics/claude-agent-sdk-typescript/main/CHANGELOG.md',
    changelogUrl: 'https://github.com/anthropics/claude-agent-sdk-typescript/blob/main/CHANGELOG.md',
  },
];

/**
 * One row by key. The key type is the table's own two keys, so the throw is unreachable from typed
 * code and exists only for a key that reached here off a wire without being validated first.
 */
export function packageRow(key: ClaudeUpdatePackageKey): UpdatePackageRow {
  const row = CLAUDE_UPDATE_PACKAGES.find((entry) => entry.key === key);
  if (!row) throw new Error(`no package row for '${key}'`);
  return row;
}

const moduleRequire = createRequire(import.meta.url);

/** A `package.json` as this file reads one. Unknown fields are ignored, and so is everything else. */
type PackageManifest = { name?: unknown; version?: unknown };

/** The manifest at `file`, or null when it is absent, unreadable or not JSON — one answer for a walk. */
function readManifest(file: string): PackageManifest | null {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as PackageManifest;
  } catch {
    return null;
  }
}

/**
 * The SDK version installed in this repository, or null when it cannot be read.
 *
 * The resolver lands on `sdk.mjs` — the package's exports map has no `./package.json` — so the walk
 * starts at that file's directory and goes up until it finds the package.json whose `name` is the
 * SDK's. Matching on the name rather than trusting the first manifest up is what keeps a hoisted
 * `node_modules` from answering with the wrong package's version.
 */
export function readSdkVersionOnDisk(): string | null {
  try {
    let dir = path.dirname(moduleRequire.resolve(SDK_PACKAGE_NAME));
    for (;;) {
      const manifest = readManifest(path.join(dir, 'package.json'));
      if (manifest?.name === SDK_PACKAGE_NAME && typeof manifest.version === 'string') return manifest.version;
      const parent = path.dirname(dir);
      if (parent === dir) return null; // the filesystem root: no package.json up there claimed the name
      dir = parent;
    }
  } catch {
    return null; // not installed here, or not resolvable from this file: both mean "not known"
  }
}

/**
 * The SDK this process imported, read once as this module is evaluated at boot. That is exactly what
 * makes it the LOADED version rather than the installed one: a restart is the only thing that moves
 * it, and the report says so in words when the two differ.
 */
export const LOADED_SDK_VERSION: string | null = readSdkVersionOnDisk();

/** The real path of `file`, or the path itself when it cannot be resolved — a gone file still gets
 *  the containment test. This is what makes an npm-global `bin/claude` symlink answer as the package
 *  file it points into, which is the file inside `npm root -g` the test below is about. */
function realpathOrSelf(file: string): string {
  try {
    return fs.realpathSync(file);
  } catch {
    return file;
  }
}

/** The first line of a child's failure that says anything, as plain words for a person. */
function firstLineOf(error: unknown): string {
  const stderr = (error as { stderr?: unknown } | null)?.stderr;
  const printed = typeof stderr === 'string' ? stderr : Buffer.isBuffer(stderr) ? stderr.toString('utf8') : '';
  const source = printed.trim() || (error instanceof Error ? error.message : String(error));
  return source.split('\n').map((line) => line.trim()).find((line) => line.length > 0) ?? 'it said nothing';
}

/**
 * Whether the CLI this server spawns can be updated here, and — when it cannot — why, in plain words.
 *
 * The test is a containment test on the file a run actually spawns: its real path has to lie inside
 * `<npm root -g>/@anthropic-ai/claude-code/`. npm owns that tree, so `npm install -g` is the way to
 * move it; anything else (a version manager, a curl install, a wrapper script) has to be updated the
 * way it was installed, and this says so rather than running a command that would install a SECOND
 * CLI beside the one in use.
 *
 * The path comes from `resolveSpawnedClaudeBinaryPath()` and nowhere else (MAN-502 rule 1): a second
 * resolution rule would drift, and an update aimed at a binary nothing runs is worse than no update.
 * A null path is that resolver saying it cannot know before a run starts — which is a reason, not a
 * failure, and it is why this returns words instead of throwing.
 */
export async function readCliUpdatable(): Promise<{ updatable: boolean; reason: string | null }> {
  const spawnPath = resolveSpawnedClaudeBinaryPath();
  if (spawnPath === null) {
    return {
      updatable: false,
      reason: 'the Claude CLI is chosen when a run starts, so which install to update is not known',
    };
  }

  let npmRoot: string;
  try {
    const { stdout } = await execFileAsync('npm', ['root', '-g'], { timeout: NPM_ROOT_TIMEOUT_MS });
    npmRoot = stdout.trim();
  } catch (error) {
    return { updatable: false, reason: `npm could not say where its global packages live: ${firstLineOf(error)}` };
  }

  const realPath = realpathOrSelf(spawnPath);
  const globalCliDir = path.join(npmRoot, CLI_PACKAGE_NAME);
  if (realPath === globalCliDir || realPath.startsWith(globalCliDir + path.sep)) {
    return { updatable: true, reason: null };
  }

  return {
    updatable: false,
    reason:
      `the Claude CLI this server spawns (${spawnPath}) was not installed with npm -g — ` +
      'update it the way it was installed',
  };
}
