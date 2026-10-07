import {
  cerberusCatalogDb,
  cerberusDefinitionsDb,
  cerberusRunsDb,
  type CerberusRunLineRow,
  type CerberusRunRow,
} from '@/modules/database/index.js';
import type { CerberusProbeRunBody } from '@/shared/cerberus-types.js';

import { sendRunOutput } from './cerberus-broadcast.js';
import { endRun, hintRun } from './run-ending.js';
import { wardenLinks } from './warden-links.js';

/**
 * What a warden says about a run it was asked to start: `run.accepted`, `run.refused`, `run.output`,
 * `run.end` — each stored, then told to the screens — and the recheck a good end asks for.
 *
 * THE RUN IS CENTER'S, THE FRAME IS A CLAIM. Every frame names a `runId`; it is honoured only when
 * center holds that run AND asked THIS node to start it, so one warden can never move, end or feed lines
 * to another node's run. A frame that fails either test, or whose body is not the shape it was sent in,
 * is logged once per run and ignored — and still acked by the link, because a frame that was never going
 * to be understood would otherwise be resent for ever.
 *
 * WRITES AND TELLING. Each write is followed by `hintChanged` naming the run's check (coalesced to a
 * second, like every hint). `run.output` is additionally a PICTURE: once the batch is stored it goes to
 * every open browser as one `cerberus_run_output` frame, uncoalesced, so a line appears as it arrives.
 * A batch that stored nothing (every line a resend) is told to no one.
 *
 * TIMES ARE CENTER'S CLOCK. A warden reports `startedAt` and `endedAt` on its own clock; they are
 * stored shifted by the node's clock offset, never later than the moment they were heard and never
 * earlier than the run was asked for (or, for an end, accepted). So every comparison the read model
 * makes between a run's moments, and with now, needs no correction — and a warden whose clock is five
 * seconds behind, or reads a million years ahead, cannot reorder the feed or keep a run on a need for
 * ever. A refusal carries no time, so it ends at center's own.
 *
 * THE RECHECK. A run that ends `ok`, on an entry that asks for it (`recheck`) or as a diagnosis's one-off
 * (always: it was proposed for this very check, and a person pressing it wants to see the answer), sends
 * `probe.run` for the probe that reports the run's check — so the check moves within seconds of the fix
 * instead of at its next cadence. Only that check's own probe (one check, one fix: neither starts
 * another), and only on `ok`: a run that failed, timed out or was refused changed nothing worth
 * measuring. A node that has no link by then simply reads the check at its next scheduled run.
 *
 * Consumers: `runs.service.ts` (`registerRunFrames`, at the module's start).
 */

const RESULTS_OF_AN_END: readonly string[] = ['ok', 'failed', 'timed_out'];

/** The runs a frame has been refused for, so one bad run is logged once and not once per frame. */
const refusalsLogged = new Set<string>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function logRefusalOnce(node: string, type: string, runId: unknown, reason: string): void {
  const signature = `${node}/${type}/${String(runId)}: ${reason}`;
  if (refusalsLogged.has(signature)) return;
  if (refusalsLogged.size >= 500) refusalsLogged.clear(); // a stuck warden must not grow this for ever
  refusalsLogged.add(signature);
  console.warn(`[Cerberus] ignored a "${type}" frame of node ${node}: ${reason} (run ${JSON.stringify(runId)})`);
}

/** The run a frame is about and its body, or null (logged) when the body is not an object or the run is not this node's. */
function runOfFrame(node: string, type: string, body: unknown): { run: CerberusRunRow; body: Record<string, unknown> } | null {
  if (!isRecord(body) || typeof body.runId !== 'string') {
    logRefusalOnce(node, type, isRecord(body) ? body.runId : undefined, 'it names no run');
    return null;
  }
  const run = cerberusRunsDb.get(body.runId);
  if (!run) {
    logRefusalOnce(node, type, body.runId, 'center holds no such run');
    return null;
  }
  if (run.node !== node) {
    logRefusalOnce(node, type, body.runId, `the run belongs to node ${run.node}`);
    return null;
  }
  return { run, body };
}

function isWholeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

/** A time the warden reported, on center's clock: shifted by the node's offset, then held between `floor` and now. */
function onCenterClock(node: string, wardenTime: number, floor: number): number {
  return Math.min(Math.max(wardenTime + wardenLinks.clockOffsetMs(node), floor), Date.now());
}

function onAccepted(node: string, frame: unknown): void {
  const held = runOfFrame(node, 'run.accepted', frame);
  if (!held) return;
  if (typeof held.body.startedAt !== 'number' || !Number.isFinite(held.body.startedAt)) {
    logRefusalOnce(node, 'run.accepted', held.run.id, '`startedAt` is not a time');
    return;
  }
  if (cerberusRunsDb.markStarted(held.run.id, onCenterClock(node, held.body.startedAt, held.run.requested_at))) hintRun(held.run);
}

function onRefused(node: string, frame: unknown): void {
  const held = runOfFrame(node, 'run.refused', frame);
  if (!held) return;
  const reason = typeof held.body.reason === 'string' && held.body.reason.trim() !== '' ? held.body.reason : 'The warden refused the run.';
  endRun(held.run, 'refused', null, Date.now(), reason);
}

/** The well-formed lines of a batch; a malformed one is dropped and logged, never the whole batch (`insertOutput` throws on one). */
function wellFormedLines(node: string, runId: string, lines: unknown): CerberusRunLineRow[] {
  if (!Array.isArray(lines)) {
    logRefusalOnce(node, 'run.output', runId, '`lines` is not a list');
    return [];
  }
  const kept: CerberusRunLineRow[] = [];
  for (const line of lines) {
    const wellFormed =
      isRecord(line) &&
      isWholeNumber(line.n) &&
      line.n >= 0 &&
      typeof line.t === 'number' &&
      Number.isFinite(line.t) &&
      (line.stream === 'out' || line.stream === 'err') &&
      typeof line.line === 'string';
    if (wellFormed) kept.push({ n: line.n as number, t: line.t as number, stream: line.stream as 'out' | 'err', line: line.line as string });
    else logRefusalOnce(node, 'run.output', runId, 'a line is malformed');
  }
  return kept;
}

function onOutput(node: string, frame: unknown): void {
  const held = runOfFrame(node, 'run.output', frame);
  if (!held) return;
  const lines = wellFormedLines(node, held.run.id, held.body.lines);
  // Zero written: every line was a resend. The screens were told of them the first time.
  if (cerberusRunsDb.insertOutput(held.run.id, lines) === 0) return;
  hintRun(held.run);
  sendRunOutput(held.run.id, lines);
}

/** The probe that reports the run's check — a health document's component's document, or the check's own probe — or null. */
function reportingProbeOf(run: CerberusRunRow): string | null {
  const check = cerberusDefinitionsDb.activeChecks(run.node).find((candidate) => candidate.key === run.check_key);
  return check?.reporting_probe ?? null;
}

/** Asks the warden to run the check's probe now, when the run's entry asked for it or the run is a diagnosis's one-off. */
function recheck(run: CerberusRunRow): void {
  const entry = run.entry === null ? null : cerberusCatalogDb.get(run.entry);
  if (run.diagnosis === null && entry?.recheck !== 1) return;
  const probe = reportingProbeOf(run);
  if (probe === null) {
    console.warn(`[Cerberus] run ${run.id} ended ok but no probe reports ${run.node}/${run.check_key}, so it is not rechecked`);
    return;
  }
  wardenLinks.send(run.node, 'probe.run', { probe } satisfies CerberusProbeRunBody);
}

function onEnd(node: string, frame: unknown): void {
  const held = runOfFrame(node, 'run.end', frame);
  if (!held) return;
  const { result, endedAt } = held.body;
  const exit = held.body.exit ?? null; // JSON drops an `undefined`: absent reads as "no exit code"
  if (typeof result !== 'string' || !RESULTS_OF_AN_END.includes(result)) {
    logRefusalOnce(node, 'run.end', held.run.id, `result ${JSON.stringify(result)} is not an end`);
    return;
  }
  if (exit !== null && !isWholeNumber(exit)) {
    logRefusalOnce(node, 'run.end', held.run.id, '`exit` is not a whole number or null');
    return;
  }
  // A warden that sends no usable time still ended the run: center's own moment stands in.
  const at =
    typeof endedAt === 'number' && Number.isFinite(endedAt)
      ? onCenterClock(node, endedAt, held.run.started_at ?? held.run.requested_at)
      : Date.now();
  if (!endRun(held.run, result as 'ok' | 'failed' | 'timed_out', exit, at, null)) return;
  if (result === 'ok') recheck(held.run);
}

/**
 * Registers the four frames with the link registry. Called once at the module's start, before the
 * gateway binds: a second registration throws, a mistake to hear about at boot.
 */
export function registerRunFrames(): void {
  wardenLinks.registerHandler('run.accepted', onAccepted);
  wardenLinks.registerHandler('run.refused', onRefused);
  wardenLinks.registerHandler('run.output', onOutput);
  wardenLinks.registerHandler('run.end', onEnd);
}
