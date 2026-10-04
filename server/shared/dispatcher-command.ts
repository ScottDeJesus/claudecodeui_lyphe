import { execFile } from 'node:child_process';
import os from 'node:os';
import { promisify } from 'node:util';

/**
 * Running the dispatcher's own command: the one subprocess every lane that talks to the dispatcher
 * goes through — a relayed verb (`runDispatcherCommand`) or a JSON document it printed
 * (`readDispatcherJson`). What a command MEANS is the caller's; this file spawns, classifies how the
 * process ended and carries back what the dispatcher said.
 *
 * The argv array is the security boundary. No shell parses any of this: the binary and its arguments
 * reach the kernel as separate strings, so a name, a title or a reason is one argument the dispatcher
 * matches against its own rules rather than a second command. The caller ALSO checks what it hands
 * over at its own route, because two fences is what keeps the inner one honest when a new caller
 * appears.
 *
 * Nothing in `runDispatcherCommand` throws. A refusal is a RESULT — the operator needs the dispatcher's
 * own sentence, not a 500 — and the cases where the dispatcher never got to answer come back as a
 * one-word `reason`. THE DISPATCHER REFUSES ON STDOUT, unlike almost every command on this host:
 * `REFUSED <verb> <name>: <reason>` with exit 2, and a not-found line with exit 1 — `no plan <bare>`
 * from a plan-only verb, or `no plan or arc <bare>` from one of the four an arc's name also reaches,
 * whose caller may have meant either kind (`hooks/dispatcher/cli.py`). So `stdout` is the field a
 * reader must look at FIRST, and a refusal travels whole in it, untouched including any path or plan
 * name the dispatcher chose to print. Never sanitize that field: it is the answer.
 *
 * `readDispatcherJson` is the other shape: a document, and every failure of it is a THROW carrying the
 * dispatcher's own words, because "it did not answer" and "it answered a refusal" are facts the journal
 * has to tell apart, and its callers' contract is to keep the last good picture rather than to guess.
 */

const execFileAsync = promisify(execFile);

/**
 * How much the dispatcher may say to a relayed command. Every verb prints a line or two, so this is
 * roughly a thousand times the real output; it is stated rather than left to the default so the number
 * is visible beside the classification that has to reason about overflowing it.
 */
const VERB_MAX_BUFFER = 1024 * 1024;

/** How much of the dispatcher's own line a refusal carries: one line names the cause, and the rest is a traceback's tail. */
const FAILURE_LINE_CHARS = 200;

/**
 * What the dispatcher is run with: the lane's one composition, built once by its module and handed in.
 * Consumed by the dispatcher module (its verb relay and its status read) and by the roadmap module (its
 * writes, its picture read and its cases read), all of which build it from the same environment rules.
 */
export type DispatcherCommandDependencies = {
  /**
   * The door's entry point, absolute — the dispatcher's `~/.claude/scripts/dispatcher` unless
   * `DISPATCHER_BIN` moved it, or the roadmap's cases door `~/.claude/scripts/cases` unless `CASES_BIN` did.
   */
  bin: string;
  /**
   * The name a failure of `readDispatcherJson` leads with ("dispatcher status --json exited 1: …"),
   * which is the door's own: absent reads `dispatcher`, so every dispatcher caller's sentence is
   * unchanged, and the cases door names itself (`cases`) instead of a verb the dispatcher lacks.
   */
  door?: string;
  /** Wall-clock ceiling for one command. A verb may kick the daemon and print its answer once that has been asked for. */
  timeoutMs: number;
  /** The child's environment, composed once by the lane's module — the dispatcher's own wake path looks `systemctl --user` up on `PATH`, and this server's unit may have been handed none. */
  env: NodeJS.ProcessEnv;
};

/**
 * What one run of the dispatcher's command did. A refusal is a RESULT, not an error: `stdout` carries
 * the dispatcher's own first line whole and the reader never gets our paraphrase. `reason` is present
 * only when the dispatcher never got to answer: it timed out, or its binary could not be spawned.
 * Consumed by the dispatcher module (`DispatcherVerbResult` is this plus the verb and the plan) and by
 * the roadmap module (`RoadmapWriteResult` is this plus the act and the name).
 */
export type DispatcherCommandResult = {
  ok: boolean;
  exit: number | null;
  stdout: string;
  stderr: string;
  reason?: 'timeout' | 'spawn-failed';
};

/**
 * What is said when the dispatcher itself said nothing, because it never ran or never finished.
 *
 * The `timeout` sentence covers both ways a signal arrives — our own ceiling and a kill from outside
 * this process — because from here they are the same fact: the command ran and was torn down before
 * it said anything. It deliberately does NOT claim nothing changed: the verbs act before they print,
 * so a teardown that lands late can land after the thing it named — a plan, a roadmap, a feature — has
 * already moved. `stdout` is where it goes, and not `stderr`, because on a relayed command stdout is
 * the field a reader reads.
 */
const NO_ANSWER: Record<'timeout' | 'spawn-failed', string> = {
  timeout: "the dispatcher was stopped before it answered — read the feature's state before retrying, since a verb acts before it prints",
  'spawn-failed': 'the dispatcher command could not be started on this host',
};

/** A child stream as a string. `execFile` answers `string` here, but a Buffer would render as "[object Object]". */
function readOutput(value: unknown): string {
  return typeof value === 'string' ? value : Buffer.isBuffer(value) ? value.toString('utf8') : '';
}

/** The dispatcher's own exit code, or `null` when it was killed or never started. */
function readExitCode(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** A non-blank string, or `null`. */
function readText(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

/** The first non-blank line of a child's output, trimmed and capped: the part of it that names a cause. */
function firstLine(value: unknown): string {
  const text = readText(value);
  if (text === null) return '';
  const line = text.split('\n').map((entry) => entry.trim()).find((entry) => entry.length > 0) ?? '';
  return line.slice(0, FAILURE_LINE_CHARS);
}

/**
 * Runs the dispatcher with one argv and answers how it ended — never throws.
 *
 * `cwd` is the home directory rather than this repository: the dispatcher resolves its own store from
 * `DISPATCHER_HOME`/`$HOME` (`hooks/dispatcher/store.py:home`), and a command must never be interpreted
 * against whatever working tree the server happens to have been started in.
 *
 * Consumed by the dispatcher module's verb relay (`runDispatcherVerb`, which adds the verb and the plan
 * to the answer) and by the roadmap module's writes (which add the act and the name).
 */
export async function runDispatcherCommand(
  argv: readonly string[],
  dependencies: DispatcherCommandDependencies,
): Promise<DispatcherCommandResult> {
  try {
    const result = await execFileAsync(dependencies.bin, [...argv], {
      timeout: dependencies.timeoutMs,
      maxBuffer: VERB_MAX_BUFFER,
      env: dependencies.env,
      cwd: os.homedir(),
    });
    return {
      ok: true,
      exit: 0,
      stdout: readOutput(result.stdout),
      stderr: readOutput(result.stderr),
    };
  } catch (error) {
    const failure = error as { code?: unknown; signal?: unknown; stdout?: unknown; stderr?: unknown };
    const stdout = readOutput(failure.stdout);
    const stderr = readOutput(failure.stderr);

    // A NUMERIC code means the dispatcher ran and decided: that is a verdict, and it travels whole.
    // Exit 2 carries a refusal on stdout and exit 1 a not-found line nobody can draw (the two
    // wordings the head states) — both are the dispatcher's own words, and the route turns them
    // into a status rather than an error.
    const exit = readExitCode(failure.code);
    if (exit !== null) {
      return { ok: false, exit, stdout, stderr };
    }

    // Everything else is the dispatcher never answering, and `signal` is what separates the two
    // kinds. MEASURED on this host: our own ceiling and a kill from outside both arrive as a SIGNAL
    // with `code` null, a missing binary as the string `ENOENT`, an output overflow as the string
    // `ERR_CHILD_PROCESS_STDIO_MAXBUFFER`. `killed` is the wrong test — it is false for the outside
    // kill, which would then be reported as "could not be started" about a command that ran.
    //
    // Residue, named: an output overflow has no signal and so lands on `spawn-failed`, the one
    // string-code case where something DID start. The vocabulary is sealed at two and mirrored
    // client-side; `VERB_MAX_BUFFER` is what keeps that case out of reach rather than merely unlikely.
    const reason = typeof failure.signal === 'string' ? 'timeout' : 'spawn-failed';
    return {
      ok: false,
      exit: null,
      // Whatever the dispatcher managed to print first still counts; our own sentence stands in only
      // when it printed nothing, so the reader is never handed a blank refusal.
      stdout: stdout || NO_ANSWER[reason],
      stderr,
      reason,
    };
  }
}

/**
 * What the dispatcher did instead of answering `command`, in one sentence.
 *
 * The dispatcher's own words come first when it left any — a refusal on STDOUT (a not-found line,
 * exit 1: `no plan <bare>`, or `no plan or arc <bare>` from one of the four verbs an arc's own name
 * also reaches), a traceback on stderr — because
 * they name the cause better than an exit code does. The ways it can fail without a code read
 * differently on purpose: a SIGNAL is our own ceiling or a kill from outside, a string `code` is a
 * missing binary — "was stopped" and "did not answer" are different facts, and neither claims the
 * read changed anything.
 */
function describeFailure(door: string, command: string, error: unknown): string {
  const failure = error as { code?: unknown; stdout?: unknown; stderr?: unknown; signal?: unknown };
  const said = firstLine(failure.stderr) || firstLine(failure.stdout);
  if (typeof failure.code === 'number' && Number.isFinite(failure.code)) {
    return `${door} ${command} exited ${failure.code}${said ? `: ${said}` : ''}`;
  }
  if (typeof failure.signal === 'string') {
    return `${door} ${command} was stopped before it answered (${failure.signal})`;
  }
  const because = error instanceof Error ? firstLine(error.message) : '';
  return `${door} ${command} did not answer${said ? `: ${said}` : because ? `: ${because}` : ''}`;
}

/**
 * One command that prints a JSON document (`status --json`, `roadmap show --json`, the cases door's
 * `list … --json`), as the parsed body. A failure is a THROW whose sentence names `<door> <argv joined
 * by spaces>` — the door is `dependencies.door`, `dispatcher` unless a lane names another — so
 * `status --json` still reads "dispatcher status --json exited 1: …".
 *
 * `cwd` is the home directory rather than this repository, for `runDispatcherCommand`'s reason, and
 * `maxBuffer` is the caller's because only the caller knows how heavy its document runs: stated by each
 * lane rather than left to `execFile`'s default, so the ceiling is a number written beside the lane
 * that lives under it. A document past it is NOT named as such: `execFile` fails with the string code
 * `ERR_CHILD_PROCESS_STDIO_MAXBUFFER` and the partial `stdout`, and `describeFailure` prefers the first
 * line of that `stdout` to the error's own message — so the journal reads "did not answer: " and then
 * the document's own opening, capped at 200 characters, with no word about the buffer. A journal line
 * that quotes a document's opening is a ceiling too low. Such a document is printed whole by a process
 * that then exits, so there is no file a live writer may be replacing at this instant and no torn read
 * to be patient with. `env` comes from the caller — each lane's module is the one place that reads the
 * environment.
 *
 * Consumed by the dispatcher module's state read and the roadmap module's picture read and cases read.
 */
export async function readDispatcherJson(
  argv: readonly string[],
  dependencies: DispatcherCommandDependencies,
  maxBuffer: number,
): Promise<unknown> {
  const command = argv.join(' ');
  const door = dependencies.door ?? 'dispatcher';
  let stdout: string;
  try {
    const answer = await execFileAsync(dependencies.bin, [...argv], {
      timeout: dependencies.timeoutMs,
      maxBuffer,
      env: dependencies.env,
      cwd: os.homedir(),
    });
    stdout = readOutput(answer.stdout);
  } catch (error) {
    throw new Error(describeFailure(door, command, error));
  }
  try {
    return JSON.parse(stdout);
  } catch {
    throw new Error(`${door} ${command} did not answer JSON`);
  }
}
