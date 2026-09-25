import { execFile } from 'node:child_process';
import os from 'node:os';
import { promisify } from 'node:util';

import type { DispatcherVerb, DispatcherVerbResult } from '@/shared/types.js';

/**
 * Relaying the dispatcher's own six verbs: `stop`, `resume`, `schedule` (a plan's Start — or its
 * Resume, for one already stopped — at a time), `park` (a designed plan set aside), `unpark` (handed
 * back to be cut) and `model` (a plan's or an arc's own DeepSeek / Claude word).
 *
 * FOUR OF THE SIX NAME AN ARC AS READILY AS A PLAN — `stop`, `resume`, `schedule` and `model`, each
 * resolved by the dispatcher's own door and by nothing on this side. An arc has no walk of its own:
 * `stop <arc>` is this same verb over the arc's WALKING plans and `resume <arc>` over its STOPPED
 * ones, in one transaction and one kick, and `schedule <arc>` arms the operator's one hour for each
 * of those stopped plans (INV-201 knows no arc-level timer). `park` and `unpark` are the plan card's
 * own and no arc header draws them.
 *
 * This server never touches a plan. It does not hold the dispatcher's lock, does not signal its
 * daemon and never writes the store (`hooks/dispatcher/store.py`, which no server writer may reach —
 * INV-170). It runs the dispatcher's own command and carries back what the dispatcher said. That is
 * the whole design: the dispatcher already knows what a refusal means, which plans may be paused at
 * all, and whether an hour can be armed for this one.
 *
 * The argv array is the security boundary. No shell parses any of this: the binary and its arguments
 * reach the kernel as separate strings, so a plan named `<name>.v3` is one argument the dispatcher
 * matches against its own name rule rather than a second command. The name is ALSO checked at the
 * route before it gets here (`dispatcher.routes.ts`), because two fences is what keeps the inner one
 * honest when a new caller appears.
 *
 * Nothing here throws. A refusal is a RESULT — the operator needs the dispatcher's own sentence, not
 * a 500 — and the cases where the dispatcher never got to answer come back as a one-word `reason`.
 * THE DISPATCHER REFUSES ON STDOUT, unlike almost every command on this host: `REFUSED <verb>
 * <name>.v3: <reason>` with exit 2, and a not-found line with exit 1 — `no plan <bare>` from a
 * plan-only verb, or `no plan or arc <bare>` from one of the four an arc's name also reaches, whose
 * caller may have meant either kind (`hooks/dispatcher/cli.py`).
 * So `stdout` is the field a reader must look at FIRST, and a refusal travels whole in it, untouched
 * including any path or plan name the dispatcher chose to print. Never sanitize that field: it is
 * the answer.
 */

const execFileAsync = promisify(execFile);

/**
 * How much the dispatcher may say. Every verb prints a line or two, so this is roughly a thousand
 * times the real output; it is stated rather than left to the default so the number is visible
 * beside the classification that has to reason about overflowing it.
 */
const VERB_MAX_BUFFER = 1024 * 1024;

export type DispatcherVerbDependencies = {
  /** The dispatcher's entry point, absolute — `~/.claude/scripts/dispatcher` unless `DISPATCHER_BIN` moved it. */
  bin: string;
  /** Wall-clock ceiling for one verb. A verb may kick the daemon and print its answer once that has been asked for. */
  timeoutMs: number;
  /** The child's environment, composed once by `dispatcher.module.ts` — the dispatcher's own wake path looks `systemctl --user` up on `PATH`, and this server's unit may have been handed none. */
  env: NodeJS.ProcessEnv;
};

/**
 * What is said when the dispatcher itself said nothing, because it never ran or never finished.
 *
 * The `timeout` sentence covers both ways a signal arrives — our own ceiling and a kill from outside
 * this process — because from here they are the same fact: the command ran and was torn down before
 * it said anything. It deliberately does NOT claim nothing changed: the verbs act before they print,
 * so a teardown that lands late can land after the plan it named has already moved. `stdout` is where
 * it goes, and not `stderr`, because on this lane stdout is the field a reader reads.
 */
const NO_ANSWER: Record<'timeout' | 'spawn-failed', string> = {
  timeout: "the dispatcher was stopped before it answered — read the plan's state before retrying, since a verb acts before it prints",
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

/**
 * Runs one verb against one name — a plan's, or an arc's for the four the arc's door also opens on.
 * `verbArgs` follow the name — `schedule`'s hour and `model`'s word, each already checked by the
 * route against the shapes the dispatcher accepts; `stop`, `resume`, `park` and `unpark` take none.
 *
 * `cwd` is the home directory rather than this repository: the dispatcher resolves its own store from
 * `DISPATCHER_HOME`/`$HOME` (`hooks/dispatcher/store.py:home`), and a verb must never be interpreted
 * against whatever working tree the server happens to have been started in.
 */
export async function runDispatcherVerb(
  verb: DispatcherVerb,
  plan: string,
  dependencies: DispatcherVerbDependencies,
  verbArgs: readonly string[] = [],
): Promise<DispatcherVerbResult> {
  try {
    const result = await execFileAsync(dependencies.bin, [verb, plan, ...verbArgs], {
      timeout: dependencies.timeoutMs,
      maxBuffer: VERB_MAX_BUFFER,
      env: dependencies.env,
      cwd: os.homedir(),
    });
    return {
      ok: true,
      verb,
      plan,
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
      return { ok: false, verb, plan, exit, stdout, stderr };
    }

    // Everything else is the dispatcher never answering, and `signal` is what separates the two
    // kinds. The ways this arrives were MEASURED on this host for the run lane's identical call
    // (`runner-verb.service.ts:130`): our own ceiling and a kill from outside both arrive as a
    // SIGNAL with `code` null, a missing binary as the string `ENOENT`, an output overflow as the
    // string `ERR_CHILD_PROCESS_STDIO_MAXBUFFER`. `killed` is the wrong test — it is false for the
    // outside kill, which would then be reported as "could not be started" about a verb that ran.
    //
    // Residue, named: an output overflow has no signal and so lands on `spawn-failed`, the one
    // string-code case where something DID start. The vocabulary is sealed at two and mirrored
    // client-side; `VERB_MAX_BUFFER` is what keeps that case unreachable rather than merely unlikely.
    const reason = typeof failure.signal === 'string' ? 'timeout' : 'spawn-failed';
    return {
      ok: false,
      verb,
      plan,
      exit: null,
      // Whatever the dispatcher managed to print first still counts; our own sentence stands in only
      // when it printed nothing, so the reader is never handed a blank refusal.
      stdout: stdout || NO_ANSWER[reason],
      stderr,
      reason,
    };
  }
}
