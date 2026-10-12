/**
 * The one mechanism behind every list the installed Claude CLI advertises about itself — its models,
 * its commands — read once per CLI version and kept on disk.
 *
 * The read. An SDK `query` started in streaming-input mode, with a prompt that yields nothing, spawns
 * the CLI and leaves it waiting for a first message that never comes. It answers control requests in
 * that state, so `supportedModels()` / `supportedCommands()` return the list without starting a turn:
 * measured 2026-09-28 on Claude Code 2.1.284 at 633-901 ms (models) and 2026-10-08 on 2.1.295 at 695 ms
 * (55 commands), no request to the API and no transcript written. The query is then closed.
 *
 * No settings source is loaded (`settingSources: []`). Left out, the SDK loads every one — user,
 * project and local, the project being the read's cwd — so each read ran the user's SessionStart and
 * SessionEnd hooks (four of them, traced 2026-09-28) and any `.claude/settings.json` someone else left
 * in that folder, as the server's user. The model list does not depend on them: the answer with no source
 * loaded is byte-identical to the one with all of them (12 entries, measured the same day). The command
 * list read this way is the engine's own commands alone — skills, custom commands, plugins and MCP
 * prompts are not in it, which is why it can be keyed on the CLI version and nothing else.
 *
 * When. A list changes only when the CLI does, so it is keyed on the server's ONE cached reading of the
 * installed binary (`readInstalledCliVersion`, which re-probes the moment an install rewrites the file)
 * and never on a `--version` of its own. A reading that differs from the one the list was read for is a
 * new read. The answer is kept on disk beside that version, because the dev server hands over to a fresh
 * process on every save under `server/`: each new process finds the list for the version already
 * installed and spawns nothing. A reading with no version (`null`: the CLI is picked from PATH when a
 * run starts, or `--version` failed) is "not heard", never a new install: it is served whatever list is
 * kept under a real version, in memory or on disk, and neither spawns the CLI nor replaces that record.
 * Only when nothing keyed exists (a CLI never named by path) is it read, once per process.
 *
 * When the read fails. The last good list on disk is served, whatever version it was read on; with
 * none, the catalog's own fallback. One log line says which. The failed version is not asked again for
 * `FAILED_READ_RETRY_MS`, so a broken CLI costs one spawn per window rather than one per request.
 *
 * Beside its records a catalog may keep `extras`: further keys of the same file that belong to the same
 * CLI version but arrive by another road than the read (the command catalog's terminal-only set rides a
 * chat's `init` frame). A fresh read starts a version's extras empty; `keepExtras` fills them in.
 *
 * consumers: claude-model-catalog.ts (the model picker's list), claude-command-catalog.ts (the
 * palette's Claude Code group) — each builds one `EngineCatalog` from its own spec.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { query } from '@anthropic-ai/claude-agent-sdk';
import type { Query, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';

import { readInstalledCliVersion } from '@/modules/cli-version/index.js';
import { userFacingEnv } from '@/shared/child-env.js';
import { resolveClaudeCodeExecutablePath } from '@/shared/claude-cli-path.js';

/** The CLI is started on Haiku: the read sends nothing, and if a future CLI ever did, it would be Haiku's usage. */
const CATALOG_READ_MODEL = 'claude-haiku-4-5-20251001';

/** One read's ceiling. A CLI that has not answered by then will not, and its process is closed. */
const CATALOG_READ_TIMEOUT_MS = 20_000;

/**
 * How long a caller waits for a read in flight before being served what is already known.
 *
 * The model catalog sits on the send path (effort validation), so a message must never wait out a
 * CLI that will not answer, and the palette must always open. Three seconds covers the measured read
 * with room; a caller that runs out gets the list being replaced (or the last good one), and the read
 * lands for the next caller.
 */
const CATALOG_WAIT_MS = 3_000;

/** How long a failed read stands before the same CLI version is asked again. */
const FAILED_READ_RETRY_MS = 10 * 60_000;

/**
 * What one catalog is made of; everything the mechanism does not decide for itself. The model catalog and
 * the command catalog (claude-model-catalog.ts, claude-command-catalog.ts) each hand `EngineCatalog` an
 * object of this shape, naming their own file, their own question to the CLI, the value they serve from
 * the records, and the fallback.
 */
type EngineCatalogSpec<Value> = {
  /** Log prefix, without brackets: `Claude models`. */
  logTag: string;
  /** What the list is called in a log line: `model catalog`. */
  noun: string;
  /** The words after "offered no" when a read comes back with nothing the catalog can use: `model the picker can show`. */
  usableEntry: string;
  /** Where the list is kept. Called on every use, so a probe that redirects an env var gets its own file. */
  storePath: () => string;
  /** The key the CLI's records sit under in that file (`models`, `commands`). */
  recordsKey: string;
  /** The question put to the idle CLI: `(instance) => instance.supportedModels()`. */
  read: (instance: Query) => Promise<readonly unknown[]>;
  /** The value served, built from kept records and extras — or null when they hold nothing usable. */
  build: (records: unknown[], extras: Record<string, unknown>) => Value | null;
  /** The success log line's tail: what was read, in a few words. */
  describe: (value: Value) => string;
  /** Served when nothing was ever read. */
  fallback: Value;
  /** The fallback in the words of a failure's log line: `the built-in family list`. */
  fallbackName: string;
};

/** What is kept on disk: the CLI's own answer, not what is built from it, so a rule change here applies without a re-read. */
type KeptCatalog = {
  readAt: string;
  records: unknown[];
  extras: Record<string, unknown>;
};

type StoredCatalog = KeptCatalog & { cliVersion: string | null };

/** The list this process serves, and the installed-version reading it was resolved for. */
type ServedCatalog<Value> = {
  cliVersion: string | null;
  value: Value;
  /** What `value` was built from; null when `value` is the fallback served because the read for `cliVersion` failed. */
  kept: KeptCatalog | null;
  /** Set when `value` is a fallback served because the read for `cliVersion` failed. */
  failedAt: number | null;
};

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));
const nameOf = (cliVersion: string | null): string => (cliVersion ? `Claude Code ${cliVersion}` : 'the Claude CLI (version not heard)');

/** Asks the CLI its question. Rejects on a spawn failure, an error answer, or no answer in time. */
async function readRecordsFromCli(ask: EngineCatalogSpec<unknown>['read']): Promise<readonly unknown[]> {
  let endPrompt: (result: IteratorResult<SDKUserMessage>) => void = () => {};
  const promptEnd = new Promise<IteratorResult<SDKUserMessage>>((resolve) => {
    endPrompt = resolve;
  });
  // Yields nothing until the read is over, then ends — so the SDK's input loop finishes rather than
  // waiting forever on a message this read never sends.
  const idlePrompt: AsyncIterable<SDKUserMessage> = {
    [Symbol.asyncIterator]: () => ({ next: () => promptEnd }),
  };

  // The same executable the chat runtime spawns (mapCliOptionsToSDK), so the list is that CLI's.
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
      ask(instance),
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

/**
 * One list the CLI advertises about itself, served from memory in the steady state.
 *
 * consumer: claude-model-catalog.ts and claude-command-catalog.ts, one instance each.
 */
export class EngineCatalog<Value> {
  private served: ServedCatalog<Value> | null = null;
  private readInFlight: Promise<void> | null = null;

  constructor(private readonly spec: EngineCatalogSpec<Value>) {}

  /**
   * The list for the installed CLI. Answers from memory in the steady state. A caller that arrives while
   * the CLI is being read waits at most `CATALOG_WAIT_MS` and is then served what is already known; the
   * read carries on and serves the next caller. Never rejects.
   */
  async serve(): Promise<Value> {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        this.syncWithInstalledCli(),
        new Promise<Value>((resolve) => {
          timer = setTimeout(() => resolve(this.served?.value ?? this.lastGood().value), CATALOG_WAIT_MS);
          timer.unref();
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Adds `extras` to the record kept for `forVersion` — the CLI version that produced them — and
   * writes the file again. Returns whether anything changed. Never rejects.
   *
   * Nothing is kept when the list served is not the one read for `forVersion` (the chat that sent
   * these extras ran on an older CLI than the one now installed, or the list could not be read):
   * extras of one version are never filed under another.
   */
  async keepExtras(forVersion: string, extras: Record<string, unknown>): Promise<boolean> {
    try {
      await this.syncWithInstalledCli();
      const served = this.served;
      if (!served?.kept || served.cliVersion !== forVersion) return false;

      const unchanged = Object.entries(extras).every(
        ([key, value]) => JSON.stringify(served.kept?.extras[key]) === JSON.stringify(value),
      );
      if (unchanged) return false;

      const kept: KeptCatalog = { ...served.kept, extras: { ...served.kept.extras, ...extras } };
      const value = this.spec.build(kept.records, kept.extras);
      if (!value) return false;
      this.served = { ...served, value, kept };
      this.save({ cliVersion: forVersion, ...kept });
      return true;
    } catch (error) {
      console.warn(`[${this.spec.logTag}] could not keep ${Object.keys(extras).join(', ')} in the ${this.spec.noun}: ${messageOf(error)}`);
      return false;
    }
  }

  /** The list on disk, or null when there is none or it is unreadable — both mean "never read". */
  private load(): StoredCatalog | null {
    try {
      const raw = JSON.parse(fs.readFileSync(this.spec.storePath(), 'utf8')) as Record<string, unknown> | null;
      if (!raw || !Array.isArray(raw[this.spec.recordsKey]) || typeof raw.readAt !== 'string') return null;
      // Whatever else the file carries beside its version, time and records is this catalog's extras.
      const { cliVersion, readAt, [this.spec.recordsKey]: records, ...extras } = raw;
      return {
        cliVersion: typeof cliVersion === 'string' ? cliVersion : null,
        readAt: readAt as string,
        records: records as unknown[],
        extras,
      };
    } catch {
      return null;
    }
  }

  /** Staged and renamed, so a process handed over mid-write never reads half a file. */
  private save(stored: StoredCatalog): void {
    const target = this.spec.storePath();
    const staged = `${target}.${process.pid}.tmp`;
    try {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      const file = {
        cliVersion: stored.cliVersion,
        readAt: stored.readAt,
        [this.spec.recordsKey]: stored.records,
        ...stored.extras,
      };
      fs.writeFileSync(staged, `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600 });
      fs.renameSync(staged, target);
    } catch (error) {
      // Served from memory for this process either way; the cost is one more read after a handover.
      console.warn(`[${this.spec.logTag}] could not keep the ${this.spec.noun} at ${target}: ${messageOf(error)}`);
    }
  }

  /** The last good list on disk, whatever version it was read on, else the fallback — and words for which. */
  private lastGood(): { value: Value; says: string } {
    const stored = this.load();
    const value = stored ? this.spec.build(stored.records, stored.extras) : null;
    if (stored && value) {
      return { value, says: `the last good catalog, read on ${nameOf(stored.cliVersion)} at ${stored.readAt}` };
    }
    return { value: this.spec.fallback, says: this.spec.fallbackName };
  }

  /** Reads the list for `cliVersion` and serves it, or serves the fallback with one line saying which. Never rejects. */
  private async readAndServe(cliVersion: string | null): Promise<void> {
    const startedAt = Date.now();
    try {
      const records = [...await readRecordsFromCli(this.spec.read)];
      const value = this.spec.build(records, {});
      if (!value) {
        throw new Error(`the catalog offered no ${this.spec.usableEntry} (${records.length} entries)`);
      }
      const kept: KeptCatalog = { readAt: new Date().toISOString(), records, extras: {} };
      this.served = { cliVersion, value, kept, failedAt: null };
      // A read with no version never lands over a record keyed on one (another process may have written
      // it while this read ran): the keyed record is the one the next real reading can match.
      if (cliVersion !== null || !this.load()?.cliVersion) {
        this.save({ cliVersion, ...kept });
      }
      console.log(
        `[${this.spec.logTag}] read the ${this.spec.noun} of ${nameOf(cliVersion)} in ${Date.now() - startedAt} ms: `
        + this.spec.describe(value),
      );
    } catch (error) {
      const fallback = this.lastGood();
      this.served = { cliVersion, value: fallback.value, kept: null, failedAt: Date.now() };
      console.warn(
        `[${this.spec.logTag}] could not read the ${this.spec.noun} of ${nameOf(cliVersion)} (${messageOf(error)}); serving ${fallback.says}`,
      );
    }
  }

  /**
   * The record on disk built into a served one: the record kept for `cliVersion`, or — with no version
   * heard (null) — whichever one is kept under a real version, served under THAT version so its return matches.
   */
  private servedFromDisk(cliVersion: string | null): ServedCatalog<Value> | null {
    const stored = this.load();
    if (!stored?.cliVersion) return null;
    if (cliVersion !== null && stored.cliVersion !== cliVersion) return null;
    const value = this.spec.build(stored.records, stored.extras);
    if (!value) return null;
    return {
      cliVersion: stored.cliVersion,
      value,
      kept: { readAt: stored.readAt, records: stored.records, extras: stored.extras },
      failedAt: null,
    };
  }

  /** Brings the served list in line with the installed CLI, reading it only when nothing kept answers. */
  private async syncWithInstalledCli(): Promise<Value> {
    try {
      const { version } = await readInstalledCliVersion();
      const retryDue = this.served !== null && this.served.failedAt !== null && Date.now() - this.served.failedAt >= FAILED_READ_RETRY_MS;
      if (this.served && this.served.cliVersion === version && !retryDue) return this.served.value;

      // "Not heard" (null) keeps what is kept under a real version: one failed `--version` must not cost a
      // spawn now and another when it answers again.
      if (version === null && this.served && this.served.cliVersion !== null) return this.served.value;
      const fromDisk = this.servedFromDisk(version);
      if (fromDisk) {
        this.served = fromDisk;
        return fromDisk.value;
      }

      // Shared: every caller arriving while the CLI is being asked waits on the same read.
      this.readInFlight ??= this.readAndServe(version).finally(() => {
        this.readInFlight = null;
      });
      await this.readInFlight;
      return this.served?.value ?? this.spec.fallback;
    } catch (error) {
      // The version reading itself threw — the same "not heard" as a null, and never the caller's error.
      console.warn(`[${this.spec.logTag}] could not check the installed CLI for its ${this.spec.noun}: ${messageOf(error)}`);
      return this.served?.value ?? this.lastGood().value;
    }
  }
}
