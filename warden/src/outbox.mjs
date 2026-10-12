// The outbox: what the warden has said that center has not yet acknowledged.
//
// Center acks a `result` frame by its `seq` (`cerberus-types.ts`, `ack`), and answers a reconnect's
// `welcome` with `ackedUpto`, the highest it holds, so the warden resends only what is above it.
// Two promises make that safe, and this file is where both are kept:
//
//   A SEQUENCE NUMBER IS NEVER HANDED OUT TWICE, not even across a restart or a crash. Center
//   treats a seq at or below what it has acked as a resend and answers without storing, so a repeat
//   would silently lose a batch. The number is therefore RESERVED on disk before it is used:
//   `state.json` holds `seqFloor`, a ceiling every number handed out stays below; to hand out a
//   number at or past it, the number about to be handed out `+ 1000` is written (and fsynced) first. After a restart the
//   counter starts at the persisted floor, so it skips what the last run might have used. Center's
//   `ackedUpto` raises it further (`ack`): were `state.json` lost, the counter, and any frame
//   already queued under a number center holds, end above everything center holds.
//
//   NOTHING GROWS WITHOUT BOUND while center is away. Frames queue until acked; once the results
//   inside them pass `maxResults`, new results stop becoming frames and `keepLatest` holds the newest
//   one per check instead (its `prevAt` forced to null — the chain before it is gone, and a lapse is
//   what center should be told). When acks drain the queue below the cap, what was kept goes out as
//   ONE frame and normal queuing resumes. The caller reads `overflowing` and chooses `push` or
//   `keepLatest`; the outbox does not guess which results a frame holds.
//
// The queue lives in memory: a restart forgets unacked frames (the floor is the only thing persisted),
// and the probes that produced them simply run again.
import { log } from './log.mjs';
import { homeDir, readState, writeState } from './state.mjs';

/** How many sequence numbers one write to `state.json` reserves. */
const FLOOR_STEP = 1000;

/** The results a frame carries (only `result` frames carry any). */
function resultsIn(frame) {
  return frame.type === 'result' ? frame.body.results.length : 0;
}

/**
 * @param {{ home?: string, maxResults?: number }} options
 * @returns {{
 *   push(type: string, body: object): number,
 *   pending(afterSeq: number): { seq: number, type: string, body: object }[],
 *   ack(upto: number): void,
 *   keepLatest(result: object): void,
 *   readonly overflowing: boolean, readonly size: number, readonly queuedResults: number, readonly ackedUpto: number,
 * }}
 */
export function createOutbox({ home = homeDir(), maxResults = 20000 } = {}) {
  let seqFloor = readState(home).seqFloor;
  // The first number is 1 (center refuses seq < 1); after a restart it is the floor itself.
  let nextSeq = Math.max(seqFloor, 1);
  const frames = []; // in seq order, oldest first
  const kept = new Map(); // check key → the newest result held back while overflowing
  let queuedResults = 0;
  let overflowing = false;
  let ackedUpto = 0; // the highest sequence center has said it holds

  /** Hands out the next number, reserving it on disk first when it reaches the floor. */
  function takeSeq() {
    if (nextSeq >= seqFloor) {
      const reserved = nextSeq + FLOOR_STEP;
      writeState({ seqFloor: reserved }, home); // throws on a full disk, before any number has left
      seqFloor = reserved;
    }
    return nextSeq++;
  }

  function push(type, body) {
    // Refused before anything is numbered or queued: a half-pushed frame would poison every later ack.
    if (type === 'result' && !Array.isArray(body?.results)) throw new TypeError('a result frame needs a results array');
    const seq = takeSeq();
    frames.push({ seq, type, body });
    queuedResults += resultsIn(frames[frames.length - 1]);
    if (!overflowing && queuedResults > maxResults) {
      overflowing = true;
      log(`outbox holds ${queuedResults} unacked results; keeping only the latest per check until center acks`);
    }
    return seq;
  }

  /** The queue is back under the cap: what was kept goes out as one frame and queuing resumes. */
  function release() {
    overflowing = false;
    if (kept.size === 0) return;
    const results = [...kept.values()].sort((a, b) => a.at - b.at);
    try {
      push('result', { results });
    } catch (error) {
      overflowing = true; // the floor could not be reserved: keep holding, try again at the next ack
      throw error;
    }
    kept.clear();
    log(`outbox drained; ${results.length} kept results queued as one frame`);
  }

  /**
   * Center holds numbers this counter never reached, so the floor was lost (`state.json` deleted or
   * restored from a backup). Everything queued so far was numbered from the lost counter and has
   * never been sent — nothing goes out before a `welcome`, and a `welcome` raises the counter — so
   * it is renumbered above what center holds instead of being trimmed as already stored.
   */
  function renumberAbove(upto) {
    log(`center holds results up to #${upto}, past this warden's sequence; renumbering ${frames.length} queued frame(s) above it`);
    const counterBefore = nextSeq;
    nextSeq = upto + 1;
    try {
      const numbers = frames.map(takeSeq); // all taken before any is assigned: a failed floor write leaves the order intact
      frames.forEach((frame, index) => {
        frame.seq = numbers[index];
      });
    } catch (error) {
      nextSeq = counterBefore; // and the counter where it was, or the next welcome would find nothing to renumber and trim these as stored
      throw error;
    }
  }

  function ack(upto) {
    if (!Number.isSafeInteger(upto) || upto < 0) return;
    ackedUpto = Math.max(ackedUpto, upto);
    if (upto >= nextSeq && frames.length > 0) renumberAbove(upto);
    let acked = 0;
    while (acked < frames.length && frames[acked].seq <= upto) {
      queuedResults -= resultsIn(frames[acked]);
      acked += 1;
    }
    frames.splice(0, acked);
    // Whatever center holds, the next number must be above it; below it, center would take a new
    // batch for a resend and drop it.
    if (upto >= nextSeq) nextSeq = upto + 1;
    if (overflowing && queuedResults < maxResults) release();
  }

  function keepLatest(result) {
    const held = kept.get(result.check);
    if (held && held.at > result.at) return;
    kept.set(result.check, { ...result, prevAt: null });
  }

  return {
    push,
    pending: (afterSeq) => frames.filter((frame) => frame.seq > afterSeq),
    ack,
    keepLatest,
    get overflowing() {
      return overflowing;
    },
    get size() {
      return frames.length;
    },
    get ackedUpto() {
      return ackedUpto;
    },
    get queuedResults() {
      return queuedResults;
    },
  };
}
