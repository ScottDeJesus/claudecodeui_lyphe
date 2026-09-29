/**
 * The installed Claude CLI's own model catalog: read once per CLI version, kept on disk.
 *
 * The read. An SDK `query` started in streaming-input mode, with a prompt that yields nothing, spawns
 * the CLI and leaves it waiting for a first message that never comes. It answers control requests in
 * that state, so `supportedModels()` returns the catalog without starting a turn: measured 2026-09-28
 * on Claude Code 2.1.284 at 633-901 ms, no request to the API and no transcript written. The query is
 * then closed.
 *
 * No settings source is loaded (`settingSources: []`). Left out, the SDK loads every one — user,
 * project and local, the project being the read's cwd — so each read ran the user's SessionStart and
 * SessionEnd hooks (four of them, traced 2026-09-28) and any `.claude/settings.json` someone else left
 * in that folder, as the server's user. The catalog does not depend on them: the answer with no source
 * loaded is byte-identical to the one with all of them (12 entries, measured the same day).
 *
 * When. The catalog changes only when the CLI does, so it is keyed on the server's ONE cached reading
 * of the installed binary (`readInstalledCliVersion`, which re-probes the moment an install rewrites
 * the file) and never on a `--version` of its own. A reading that differs from the one the catalog
 * was read for is a new read. The answer is kept on disk beside that version, because the dev server
 * hands over to a fresh process on every save under `server/`: each new process finds the catalog for
 * the version already installed and spawns nothing. A reading with no version (`null`: the CLI is
 * picked from PATH when a run starts, or `--version` failed) is "not heard", never a new install: it is
 * served whatever catalog is kept under a real version, in memory or on disk, and neither spawns the
 * CLI nor replaces that record. Only when nothing keyed exists (a CLI never named by path) is it read,
 * once per process.
 *
 * When the read fails. The last good catalog on disk is served, whatever version it was read on; with
 * none, the family-named fallback list (`CLAUDE_FALLBACK_MODELS`). One log line says which. The failed
 * version is not asked again for `FAILED_READ_RETRY_MS`, so a broken CLI costs one spawn per window
 * rather than one per request.
 *
 * consumer: claude-models.provider.ts (ClaudeProviderModels.getSupportedModels)
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { query } from '@anthropic-ai/claude-agent-sdk';
import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';

import { readInstalledCliVersion } from '@/modules/cli-version/index.js';
import { userFacingEnv } from '@/shared/child-env.js';
import { resolveClaudeCodeExecutablePath } from '@/shared/claude-cli-path.js';
import type { ProviderModelsDefinition } from '@/shared/types.js';

import { CLAUDE_FALLBACK_MODELS, buildClaudeModelsDefinition } from './claude-model-options.js';

/** The CLI is started on Haiku: the read sends nothing, and if a future CLI ever did, it would be Haiku's usage. */
const CATALOG_READ_MODEL = 'claude-haiku-4-5-20251001';

/** One read's ceiling. A CLI that has not answered by then will not, and its process is closed. */
const CATALOG_READ_TIMEOUT_MS = 20_000;

/**
 * How long a caller waits for a read in flight before being served what is already known.
 *
 * `getSupportedModels` sits on the send path (effort validation), so a message must never wait out a
 * CLI that will not answer. Three seconds covers the measured read with room; a caller that runs out
 * gets the catalog being replaced (or the last good one), and the read lands for the next caller.
 */
const CATALOG_WAIT_MS = 3_000;

/** How long a failed read stands before the same CLI version is asked again. */
const FAILED_READ_RETRY_MS = 10 * 60_000;

/** What is kept on disk: the CLI's own answer, not the picker built from it, so a rule change here applies without a re-read. */
type StoredCatalog = {
  cliVersion: string | null;
  readAt: string;
  models: unknown[];
};

/** The catalog this process serves, and the installed-version reading it was resolved for. */
type ServedCatalog = {
  cliVersion: string | null;
  definition: ProviderModelsDefinition;
  /** Set when `definition` is a fallback served because the read for `cliVersion` failed. */
  failedAt: number | null;
};

let served: ServedCatalog | null = null;
let readInFlight: Promise<void> | null = null;

/** `CLOUDCLI_CLAUDE_MODEL_CATALOG_PATH` is read on every call, so a probe that redirects it gets its own file. */
function storePath(): string {
  return process.env.CLOUDCLI_CLAUDE_MODEL_CATALOG_PATH
    || path.join(os.homedir(), '.cloudcli', 'claude-model-catalog.json');
}

/** The catalog on disk, or null when there is none or it is unreadable — both mean "never read". */
function loadStoredCatalog(): StoredCatalog | null {
  try {
    const stored = JSON.parse(fs.readFileSync(storePath(), 'utf8')) as Partial<StoredCatalog> | null;
    if (!stored || !Array.isArray(stored.models) || typeof stored.readAt !== 'string') return null;
    const cliVersion = typeof stored.cliVersion === 'string' ? stored.cliVersion : null;
    return { cliVersion, readAt: stored.readAt, models: stored.models };
  } catch {
    return null;
  }
}

/** Staged and renamed, so a process handed over mid-write never reads half a file. */
function saveStoredCatalog(stored: StoredCatalog): void {
  const target = storePath();
  const staged = `${target}.${process.pid}.tmp`;
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(staged, `${JSON.stringify(stored, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(staged, target);
  } catch (error) {
    // Served from memory for this process either way; the cost is one more read after a handover.
    console.warn(`[Claude models] could not keep the model catalog at ${target}: ${describe(error)}`);
  }
}

const describe = (error: unknown): string => (error instanceof Error ? error.message : String(error));
const nameOf = (cliVersion: string | null): string => (cliVersion ? `Claude Code ${cliVersion}` : 'the Claude CLI (version not heard)');

/** Asks the CLI for its catalog. Rejects on a spawn failure, an error answer, or no answer in time. */
async function readCatalogFromCli(): Promise<unknown[]> {
  let endPrompt: (result: IteratorResult<SDKUserMessage>) => void = () => {};
  const promptEnd = new Promise<IteratorResult<SDKUserMessage>>((resolve) => {
    endPrompt = resolve;
  });
  // Yields nothing until the read is over, then ends — so the SDK's input loop finishes rather than
  // waiting forever on a message this read never sends.
  const idlePrompt: AsyncIterable<SDKUserMessage> = {
    [Symbol.asyncIterator]: () => ({ next: () => promptEnd }),
  };

  // The same executable the chat runtime spawns (mapCliOptionsToSDK), so the catalog is that CLI's.
  const executable = resolveClaudeCodeExecutablePath(process.env.CLAUDE_CLI_PATH);
  const instance = query({
    prompt: idlePrompt,
    options: {
      model: CATALOG_READ_MODEL,
      // Nothing is read from any settings file, this folder's included — see the header. Without
      // this line the temp dir, writable by every user on the machine, would be a project whose
      // settings (hooks among them) run as the server's user.
      settingSources: [],
      // Any folder that always exists will do, since no settings source is loaded from it.
      cwd: os.tmpdir(),
      env: userFacingEnv(),
      ...(executable ? { pathToClaudeCodeExecutable: executable } : {}),
    },
  });

  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      instance.supportedModels(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error(`no answer within ${CATALOG_READ_TIMEOUT_MS / 1000} s`)),
          CATALOG_READ_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
    instance.close();
    endPrompt({ done: true, value: undefined });
  }
}

/** The last good catalog on disk, whatever version it was read on, else the fallback list — and words for which. */
function lastGoodCatalog(): { definition: ProviderModelsDefinition; says: string } {
  const stored = loadStoredCatalog();
  const definition = stored ? buildClaudeModelsDefinition(stored.models) : null;
  if (stored && definition) {
    return { definition, says: `the last good catalog, read on ${nameOf(stored.cliVersion)} at ${stored.readAt}` };
  }
  return { definition: CLAUDE_FALLBACK_MODELS, says: 'the built-in family list' };
}

/** Reads the catalog for `cliVersion` and serves it, or serves the fallback with one line saying which. Never rejects. */
async function readAndServe(cliVersion: string | null): Promise<void> {
  const startedAt = Date.now();
  try {
    const models = await readCatalogFromCli();
    const definition = buildClaudeModelsDefinition(models);
    if (!definition) {
      throw new Error(`the catalog offered no model the picker can show (${models.length} entries)`);
    }
    served = { cliVersion, definition, failedAt: null };
    // A read with no version never lands over a record keyed on one (another process may have written
    // it while this read ran): the keyed record is the one the next real reading can match.
    if (cliVersion !== null || !loadStoredCatalog()?.cliVersion) {
      saveStoredCatalog({ cliVersion, readAt: new Date().toISOString(), models });
    }
    console.log(
      `[Claude models] read the model catalog of ${nameOf(cliVersion)} in ${Date.now() - startedAt} ms: `
      + definition.OPTIONS.map((option) => option.label).join(', '),
    );
  } catch (error) {
    const fallback = lastGoodCatalog();
    served = { cliVersion, definition: fallback.definition, failedAt: Date.now() };
    console.warn(
      `[Claude models] could not read the model catalog of ${nameOf(cliVersion)} (${describe(error)}); serving ${fallback.says}`,
    );
  }
}

/** Brings the served catalog in line with the installed CLI, reading it only when nothing kept answers. */
async function syncWithInstalledCli(): Promise<ProviderModelsDefinition> {
  try {
    const { version } = await readInstalledCliVersion();
    const retryDue = served !== null && served.failedAt !== null && Date.now() - served.failedAt >= FAILED_READ_RETRY_MS;
    if (served && served.cliVersion === version && !retryDue) return served.definition;

    if (version === null) {
      // "Not heard" keeps what is kept under a real version: one failed `--version` must not cost a
      // spawn now and another when it answers again. Served under THAT version, so its return matches.
      if (served && served.cliVersion !== null) return served.definition;
      const stored = loadStoredCatalog();
      const keyed = stored?.cliVersion ? buildClaudeModelsDefinition(stored.models) : null;
      if (stored?.cliVersion && keyed) {
        served = { cliVersion: stored.cliVersion, definition: keyed, failedAt: null };
        return keyed;
      }
    } else {
      const stored = loadStoredCatalog();
      const definition = stored?.cliVersion === version ? buildClaudeModelsDefinition(stored.models) : null;
      if (definition) {
        served = { cliVersion: version, definition, failedAt: null };
        return definition;
      }
    }

    // Shared: every caller arriving while the CLI is being asked waits on the same read.
    readInFlight ??= readAndServe(version).finally(() => {
      readInFlight = null;
    });
    await readInFlight;
    return served?.definition ?? CLAUDE_FALLBACK_MODELS;
  } catch (error) {
    // The version reading itself threw — the same "not heard" as a null, and never the caller's error.
    console.warn(`[Claude models] could not check the installed CLI for its model catalog: ${describe(error)}`);
    return served?.definition ?? lastGoodCatalog().definition;
  }
}

/**
 * The Claude picker's definition, from the installed CLI's own catalog.
 *
 * Answers from memory in the steady state. A caller that arrives while the CLI is being read waits at
 * most `CATALOG_WAIT_MS` and is then served what is already known; the read carries on and serves the
 * next caller.
 *
 * consumer: claude-models.provider.ts (ClaudeProviderModels.getSupportedModels)
 */
export async function readClaudeModelsDefinition(): Promise<ProviderModelsDefinition> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      syncWithInstalledCli(),
      new Promise<ProviderModelsDefinition>((resolve) => {
        timer = setTimeout(() => resolve(served?.definition ?? lastGoodCatalog().definition), CATALOG_WAIT_MS);
        timer.unref();
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
