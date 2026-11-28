/**
 * The engine's last known state. Only a `--version` answer sets it ok (the run at module load, and the
 * one started after a run that exits 0 while the state is not ok); a header alone sets nothing, since an
 * engine can die after writing one. Each failure a call records sets it not ok. Nothing polls.
 * The first known state, and every change between ok and not ok after it, logs one `[transcript-engine]` line.
 */
import type { TranscriptEngineStatus } from './transcript-engine.types.js';

let current: TranscriptEngineStatus = {
  ok: false,
  version: null,
  protocol: null,
  error: 'the engine has not answered yet',
};
let isKnown = false;
/** Rises with every recorded failure, so a `--version` answer that predates a failure is known for stale. */
let failureGeneration = 0;
let isLearningVersion = false;
const recoveryListeners: Array<() => void> = [];

export function transcriptEngineStatus(): TranscriptEngineStatus {
  return { ...current };
}

/** A `--version` run starts; its answer is handed back with the generation returned here. */
export function beginVersionLearn(): number {
  isLearningVersion = true;
  return failureGeneration;
}

/** `--version` answered with the door's protocol. Dropped when a failure was recorded after that run started. */
export function recordEngineVersion(version: string, protocol: number, learnedAtGeneration: number): void {
  isLearningVersion = false;
  if (learnedAtGeneration !== failureGeneration) {
    return;
  }
  settle({ ok: true, version, protocol, error: null });
}

/** A run exited 0. While the state is not ok, that asks the recovery listeners (one `--version` run) to confirm it. */
export function recordEngineCompleted(): void {
  if (current.ok || isLearningVersion) {
    return;
  }
  for (const listener of recoveryListeners) {
    listener();
  }
}

/** The engine could not be run, is stale, is misconfigured, or died on its own. */
export function recordEngineBroken(error: string): void {
  failureGeneration += 1;
  isLearningVersion = false;
  settle({ ok: false, version: null, protocol: null, error });
}

export function onEngineRecovered(listener: () => void): void {
  recoveryListeners.push(listener);
}

function settle(next: TranscriptEngineStatus): void {
  const isFlip = !isKnown || next.ok !== current.ok;
  current = next;
  isKnown = true;
  if (!isFlip) {
    return;
  }
  if (next.ok) {
    console.log(`[transcript-engine] ready: version ${next.version ?? 'unknown'}, protocol ${next.protocol ?? 'unknown'}`);
  } else {
    console.warn(`[transcript-engine] not available: ${next.error}`);
  }
}
