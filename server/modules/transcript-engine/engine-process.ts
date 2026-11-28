/**
 * The one place the transcript engine's binary is run: the spawn helper every verb of the door goes
 * through, and the `--version` run that teaches engine-status.ts the engine's state.
 *
 * The binary is TRANSCRIPT_ENGINE_BIN, else <app root>/rust/target/release/transcript-engine;
 * TRANSCRIPT_ENGINE_THREADS, when set, is passed as --threads. Both are read at each call, so neither
 * needs an .env line and a rebuilt binary is live at the next call.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { Readable } from 'node:stream';

import type { AnyRecord } from '@/shared/types.js';
import { AppError, findApplicationRoot, getModuleDirectory } from '@/shared/utils.js';

import { beginVersionLearn, recordEngineBroken, recordEngineCompleted, recordEngineVersion } from './engine-status.js';
import type { TranscriptEngineVerb } from './transcript-engine.types.js';

/** Changes together with `PROTOCOL` in rust/transcript-engine/src/main.rs whenever a verb's input or output changes. */
export const TRANSCRIPT_ENGINE_PROTOCOL = 1;

const ENGINE_NAME = 'transcript-engine';
const BUILD_HINT = 'Build it with `npm run build:engine`.';
const VERSION_TIMEOUT_MS = 10_000;
/** Twin of MAX_THREADS in rust/transcript-engine/src/main.rs: a wider pool never finishes starting. */
const TRANSCRIPT_ENGINE_MAX_THREADS = 256;
const VERSION_LINE = /^transcript-engine (\S+) protocol (\d+)$/;
/** Exits that refuse one call's input (2: the job, 3: the file usage reads); they say nothing against the engine itself. */
const INPUT_REFUSAL_EXITS = new Set([2, 3]);
const APP_ROOT = findApplicationRoot(getModuleDirectory(import.meta.url));

type EngineExit = { code: number | null; signal: NodeJS.Signals | null; spawnError: Error | null };

/** One run of a verb. `next` is called by one reader at a time, never concurrently. */
export type EngineRun = {
  /** The next record after the header; null once the engine has written its last one and exited 0. */
  next(): Promise<AnyRecord | null>;
  /** Sends SIGTERM when the child still runs; safe to call twice. */
  end(): void;
};

export type EngineRunOptions = { args?: string[]; input?: unknown; signal?: AbortSignal };

export function openEngineRun(verb: TranscriptEngineVerb, options: EngineRunOptions = {}): EngineRun {
  const binary = engineBinaryPath();
  if (!fs.existsSync(binary)) {
    const refusal = unavailable(`There is no transcript engine at ${binary}.`);
    return { next: () => Promise.reject(refusal), end: () => undefined };
  }

  const threads = threadArguments();
  if (threads instanceof AppError) {
    return { next: () => Promise.reject(threads), end: () => undefined };
  }
  const child = spawn(binary, [...threads, verb, ...(options.args ?? [])], { stdio: ['pipe', 'pipe', 'pipe'] });
  let lastStderrLine = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    lastStderrLine = lastLineOf(chunk) ?? lastStderrLine;
  });
  // A child that exits before reading its job closes stdin under the write; its exit says why, so the
  // pipe's error is kept only as the stderr line when the engine wrote none.
  child.stdin.on('error', (error: Error) => {
    lastStderrLine = lastStderrLine || `its stdin closed: ${error.message}`;
  });
  child.stdin.end(options.input === undefined ? undefined : JSON.stringify(options.input));

  const exited = new Promise<EngineExit>((resolve) => {
    child.once('error', (spawnError: Error) => resolve({ code: null, signal: null, spawnError }));
    child.once('close', (code, signal) => resolve({ code, signal, spawnError: null }));
  });
  const lines = createLineQueue(child.stdout);
  let isEndRequested = false;
  let isHeaderRead = false;

  const end = (): void => {
    isEndRequested = true;
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
    }
  };
  options.signal?.addEventListener('abort', end, { once: true });
  if (options.signal?.aborted) {
    end();
  }
  void exited.then(() => options.signal?.removeEventListener('abort', end));

  const endedError = (): Error => new Error(`The transcript engine's ${verb} run was ended by its caller.`);

  async function settle(): Promise<void> {
    const exit = await exited;
    if (exit.spawnError) {
      throw spawnRefusal(binary, exit.spawnError);
    }
    if (exit.code === 0) {
      recordEngineCompleted();
      return;
    }
    if (exit.signal !== null && isEndRequested) {
      throw endedError();
    }
    const how = exit.signal !== null ? `was killed by ${exit.signal}` : `exited ${exit.code}`;
    const message = `The transcript engine's ${verb} ${how}: ${lastStderrLine || '(nothing on stderr)'}`;
    if (exit.code === null || !INPUT_REFUSAL_EXITS.has(exit.code)) {
      recordEngineBroken(message);
    }
    throw new AppError(message, {
      code: 'TRANSCRIPT_ENGINE_FAILED',
      statusCode: 503,
      details: { verb, exitCode: exit.code, signal: exit.signal, stderr: lastStderrLine },
    });
  }

  async function readHeader(): Promise<void> {
    const line = await lines.take();
    if (line === null) {
      await settle();
      throw isEndRequested ? endedError() : protocolFailure(verb, 'it wrote no header');
    }
    const header = parseJsonObject(line);
    if (header?.engine !== ENGINE_NAME || header.verb !== verb || header.protocol !== TRANSCRIPT_ENGINE_PROTOCOL) {
      end();
      throw stale(`The transcript engine at ${binary} answered ${line.slice(0, 200)}; this server speaks protocol ${TRANSCRIPT_ENGINE_PROTOCOL}.`);
    }
  }

  async function next(): Promise<AnyRecord | null> {
    if (isEndRequested) {
      throw endedError();
    }
    if (!isHeaderRead) {
      await readHeader();
      isHeaderRead = true;
    }
    const line = await lines.take();
    if (line === null) {
      await settle();
      return null;
    }
    const record = parseJsonObject(line);
    if (!record) {
      end();
      throw protocolFailure(verb, `it wrote a line that is not a JSON object: ${line.slice(0, 200)}`);
    }
    return record;
  }

  return { next, end };
}

/** Learns the engine's version and protocol from one `--version` run. Never rejects: what it learns goes to the status. */
export function learnEngineVersion(): Promise<void> {
  const binary = engineBinaryPath();
  if (!fs.existsSync(binary)) {
    unavailable(`There is no transcript engine at ${binary}.`);
    return Promise.resolve();
  }
  const generation = beginVersionLearn();
  return new Promise((resolve) => {
    // Read through spawn, not execFile: execFile's timeout destroys the unread stdout, so a boot that holds the loop past
    // VERSION_TIMEOUT_MS read an answer already waiting as "exited 0, stdout empty". Here the kill only ends a child that
    // is still running; one that has exited keeps its output, and its close event judges it.
    const child = spawn(binary, ['--version'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => { stdout += chunk; });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => { stderr += chunk; });
    const timer = setTimeout(() => child.kill('SIGKILL'), VERSION_TIMEOUT_MS);
    // A child that cannot start emits error AND then close; error alone judges it, so close cannot hide the reason.
    let hasFailedToStart = false;
    child.on('error', (error) => {
      hasFailedToStart = true;
      clearTimeout(timer);
      recordEngineBroken(`${binary} --version could not be started: ${error.message}`);
      resolve();
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      if (hasFailedToStart) {
        return;
      }
      const match = VERSION_LINE.exec(stdout.trim());
      if (!match) {
        const how = signal ? `ended by ${signal} after ${VERSION_TIMEOUT_MS} ms` : `exited ${code}`;
        recordEngineBroken(`${binary} --version did not answer (${how}); stdout ${JSON.stringify(stdout.slice(0, 200))}, stderr ${JSON.stringify(lastLineOf(stderr) ?? '')}`);
      } else if (Number(match[2]) !== TRANSCRIPT_ENGINE_PROTOCOL) {
        stale(`The transcript engine at ${binary} speaks protocol ${match[2]}; this server speaks ${TRANSCRIPT_ENGINE_PROTOCOL}.`);
      } else {
        recordEngineVersion(match[1], TRANSCRIPT_ENGINE_PROTOCOL, generation);
      }
      resolve();
    });
  });
}

/** A record the door cannot use: the engine and the door disagree, so the engine counts as not ok. */
export function protocolFailure(verb: TranscriptEngineVerb, reason: string): AppError {
  const message = `The transcript engine's ${verb} answer cannot be read: ${reason}`;
  recordEngineBroken(message);
  return new AppError(message, { code: 'TRANSCRIPT_ENGINE_FAILED', statusCode: 503, details: { verb } });
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function engineBinaryPath(): string {
  const configured = process.env.TRANSCRIPT_ENGINE_BIN?.trim();
  return configured || path.join(APP_ROOT, 'rust', 'target', 'release', ENGINE_NAME);
}

/** The server's own configuration, so a bad value is refused here and counts against the engine's health, not one call's input. */
function threadArguments(): string[] | AppError {
  const configured = process.env.TRANSCRIPT_ENGINE_THREADS?.trim();
  if (!configured) {
    return [];
  }
  if (!/^[1-9]\d*$/.test(configured) || Number(configured) > TRANSCRIPT_ENGINE_MAX_THREADS) {
    const message = `TRANSCRIPT_ENGINE_THREADS is ${JSON.stringify(configured)}, not a whole number from 1 to ${TRANSCRIPT_ENGINE_MAX_THREADS}.`;
    recordEngineBroken(message);
    return new AppError(message, { code: 'TRANSCRIPT_ENGINE_FAILED', statusCode: 503 });
  }
  return ['--threads', configured];
}

function unavailable(reason: string): AppError {
  const message = `${reason} ${BUILD_HINT}`;
  recordEngineBroken(message);
  return new AppError(message, { code: 'TRANSCRIPT_ENGINE_UNAVAILABLE', statusCode: 503 });
}

function stale(reason: string): AppError {
  const message = `${reason} ${BUILD_HINT}`;
  recordEngineBroken(message);
  return new AppError(message, { code: 'TRANSCRIPT_ENGINE_STALE', statusCode: 503 });
}

function spawnRefusal(binary: string, error: Error): AppError {
  const code = 'code' in error && typeof error.code === 'string' ? error.code : null;
  if (code === 'ENOENT' || code === 'EACCES') {
    return unavailable(`The transcript engine at ${binary} could not be started (${code}).`);
  }
  const message = `The transcript engine at ${binary} could not be started: ${error.message}`;
  recordEngineBroken(message);
  return new AppError(message, { code: 'TRANSCRIPT_ENGINE_FAILED', statusCode: 503 });
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    if (error instanceof SyntaxError) {
      return null;
    }
    throw error;
  }
  return isRecord(value) ? value : null;
}

function lastLineOf(text: string): string | null {
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
  return lines.at(-1) ?? null;
}

/**
 * The child's stdout as whole lines, read only as far as asked: the stream is paused while lines
 * wait to be taken, so a search the caller stops early leaves the engine blocked, not racing ahead.
 */
function createLineQueue(stream: Readable): { take(): Promise<string | null> } {
  const ready: string[] = [];
  let partial = '';
  let isFinished = false;
  let wake: (() => void) | null = null;

  const finish = (): void => {
    if (isFinished) {
      return;
    }
    if (partial.trim()) {
      ready.push(partial);
    }
    partial = '';
    isFinished = true;
    wake?.();
  };
  stream.setEncoding('utf8');
  stream.on('data', (chunk: string) => {
    const pieces = (partial + chunk).split('\n');
    partial = pieces.pop() ?? '';
    ready.push(...pieces.filter((piece) => piece.trim()));
    if (ready.length > 0) {
      stream.pause();
      wake?.();
    }
  });
  stream.on('end', finish);
  stream.on('close', finish);

  return {
    async take(): Promise<string | null> {
      while (ready.length === 0 && !isFinished) {
        stream.resume();
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
        wake = null;
      }
      return ready.shift() ?? null;
    },
  };
}
