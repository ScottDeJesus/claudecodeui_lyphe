/**
 * The object the SDK is handed in place of a child process. One shape serves both modes, so a
 * fallback turn and a keepalive turn differ in exactly one thing: where the CLI lives.
 *
 * Three rules this file exists to keep:
 * - `kill` and `end_input` are SWALLOWED while the API is exiting (D-10). The SDK registers a
 *   global reaper on its first spawn that SIGTERMs every process it spawned when the API's
 *   `exit` fires; forwarding that to a host would end every session on every `tsx watch`
 *   restart — the exact defect this package exists to cure. The listeners below are registered
 *   at module import, which is strictly before that reaper exists.
 * - stdin writes that arrive before the transport is ready are BUFFERED, never dropped. The
 *   SDK writes its `initialize` control_request the instant `spawnClaudeCodeProcess` returns,
 *   and a unix socket to a tmux-exec'd host takes tens of milliseconds to accept.
 * - `exit` is emitted only after stdout has drained. The turn's `result` is the last line the
 *   CLI writes; announcing the exit ahead of it would lose the one frame that ends the run.
 *
 * consumer: spawner.ts
 */

import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import type { Readable } from 'node:stream';

import type { SpawnOptions, SpawnedProcess } from '@anthropic-ai/claude-agent-sdk';

// A consumer that stopped reading would never let stdout finish; the turn still has to end.
const EXIT_DRAIN_TIMEOUT_MS = 2_000;

let apiExiting = false;
const markApiExiting = (): void => {
  apiExiting = true;
};
process.once('exit', markApiExiting);
process.on('SIGTERM', markApiExiting);
process.on('SIGINT', markApiExiting);

/** consumer: spawner.ts — a socket that closes while this is set is a detach, not a CLI exit. */
export const isApiExiting = (): boolean => apiExiting;

/**
 * The two turn-state bits the meta persists. `ack: false` writes them WITHOUT retiring an
 * unacked result: sent when a message joins the running process, where no result is
 * outstanding and the D-3 cursor must not move.
 */
export type TurnBits = {
  turnCompleteSent: boolean;
  heldForBackgroundWork: boolean;
  /** The tool-call ids whose work is still outstanding — what `heldForBackgroundWork` counts. */
  deferredTools?: string[];
  ack?: false;
};

/** Whatever is actually carrying this turn: a host socket, or a local child process. */
export type HostTransport = {
  write(chunk: Buffer): void;
  endInput(): void;
  kill(signal: NodeJS.Signals): void;
  note(bits: TurnBits): void;
};

export type Facade = SpawnedProcess & {
  attach(transport: HostTransport): void;
  pipeStdoutFrom(source: Readable): void;
  pushLine(line: string): void;
  settleExit(code: number | null, signal: NodeJS.Signals | null): void;
  emitError(error: Error): void;
  note(bits: TurnBits): void;
  readonly settled: boolean;
  readonly attached: boolean;
};

/**
 * Builds the process object before anything is running behind it. The caller attaches a
 * transport once it has one — which may be several hundred milliseconds later, or never (the
 * fallback attaches a local child instead).
 */
export function createFacade(): Facade {
  const events = new EventEmitter();
  const stdout = new PassThrough();

  let transport: HostTransport | null = null;
  let pendingStdin: Buffer[] = [];
  let endInputWanted = false;
  let killWanted: NodeJS.Signals | null = null;
  let killed = false;
  let exitCode: number | null = null;
  let settled = false;

  function requestEndInput(): void {
    // D-10: at API exit the CLI's stdin must stay open, so the host keeps the turn running.
    if (apiExiting) return;
    if (transport) transport.endInput();
    else endInputWanted = true;
  }

  const stdin = new Writable({
    write(chunk: Buffer | string, _encoding, done) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      if (transport) transport.write(bytes);
      else pendingStdin.push(bytes);
      done();
    },
    final(done) {
      requestEndInput();
      done();
    }
  });

  function attach(next: HostTransport): void {
    if (transport || settled) return;
    transport = next;
    for (const chunk of pendingStdin) next.write(chunk);
    pendingStdin = [];
    // Both were requested against a transport that did not exist yet; the D-10 guard is asked
    // again here because the API may have started exiting during the connect.
    if (endInputWanted && !apiExiting) next.endInput();
    endInputWanted = false;
    if (killWanted && !apiExiting) next.kill(killWanted);
    killWanted = null;
  }

  function settleExit(code: number | null, signal: NodeJS.Signals | null): void {
    if (settled) return;
    settled = true;
    exitCode = code;
    let emitted = false;
    const emit = (): void => {
      if (emitted) return;
      emitted = true;
      events.emit('exit', code, signal);
    };
    const guard = setTimeout(emit, EXIT_DRAIN_TIMEOUT_MS);
    guard.unref();
    stdout.end(() => {
      clearTimeout(guard);
      // One more turn of the loop so readline delivers the lines already in the buffer.
      setImmediate(emit);
    });
  }

  const facade: Facade = {
    stdin,
    stdout,
    get killed() {
      return killed;
    },
    get exitCode() {
      return exitCode;
    },
    get settled() {
      return settled;
    },
    get attached() {
      return transport !== null;
    },
    kill(signal: NodeJS.Signals) {
      // D-10 again, and the reason this whole object exists: the SDK's reaper calls this for
      // every spawned process when the API goes down.
      if (apiExiting) return false;
      killed = true;
      if (transport) transport.kill(signal);
      else killWanted = signal;
      return true;
    },
    on: events.on.bind(events),
    once: events.once.bind(events),
    off: events.off.bind(events),
    attach,
    pipeStdoutFrom(source: Readable) {
      // `end: false` because settleExit owns the end of this stream, not the source.
      source.pipe(stdout, { end: false });
    },
    pushLine(line: string) {
      if (settled) return;
      stdout.write(`${line}\n`);
    },
    settleExit,
    emitError(error: Error) {
      // An EventEmitter with no 'error' listener throws on emit, which would take the API
      // down over a CLI that failed to start.
      if (events.listenerCount('error') > 0) events.emit('error', error);
      else console.warn(`[keepalive] spawn error with no listener: ${error.message}`);
    },
    note(bits: TurnBits) {
      // No transport means the turn's own spawn has not landed yet, and no `result` can
      // precede a spawn — so there is nothing this note could be acking.
      transport?.note(bits);
    }
  };

  return facade;
}

/**
 * The fallback: the SDK's own default spawn, wrapped in the same object.
 *
 * `stdio`, `signal`, `env` and `windowsHide` are copied verbatim from the SDK's
 * `spawnLocalProcess` (sdk.mjs), so a turn that falls back behaves exactly as it does today.
 *
 * One deliberate narrowing: the SDK opens stderr as a pipe (and forwards it) when
 * `DEBUG_CLAUDE_AGENT_SDK` is set or an `stderr` callback was passed, whereas this always
 * discards it, per D-7's `stdio:['pipe','pipe','ignore']`. Neither condition holds here today —
 * the provider passes no `stderr` and the var is unset — but anyone who sets that var to chase
 * a fallback failure should know this is the one path that will not honour it.
 * consumer: spawner.ts
 */
export function attachLocalSpawn(facade: Facade, options: SpawnOptions): void {
  let child;
  try {
    child = spawn(options.command, options.args, {
      cwd: options.cwd,
      stdio: ['pipe', 'pipe', 'ignore'],
      signal: options.signal,
      env: options.env,
      windowsHide: true
    });
  } catch (err) {
    facade.emitError(err instanceof Error ? err : new Error(String(err)));
    facade.settleExit(null, 'SIGTERM');
    return;
  }

  // Wrapping the child means its stdin errors are ours to absorb: a CLI that has already gone
  // gives EPIPE on the next write, which is not a reason to take the API down.
  child.stdin?.on('error', (err: Error) => {
    console.warn(`[keepalive] fallback stdin write failed: ${err.message}`);
  });
  if (child.stdout) facade.pipeStdoutFrom(child.stdout);
  child.on('error', (err: Error) => facade.emitError(err));
  child.on('exit', (code, signal) => facade.settleExit(code, signal));

  facade.attach({
    write: (chunk) => {
      child.stdin?.write(chunk);
    },
    endInput: () => {
      child.stdin?.end();
    },
    kill: (signal) => {
      child.kill(signal);
    },
    // There is no host and no meta file in this mode: the bits die with the API, which is
    // exactly what falling back means.
    note: () => {}
  });
}
