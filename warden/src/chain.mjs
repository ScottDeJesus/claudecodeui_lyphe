// The `prevAt` chain, kept across a restart.
//
// Each result carries the `at` of that check's previous result, and center's reader trusts it: a
// stretch between two stored rows is "reporting" up to the later row's `prevAt` plus `staleAfter`
// (`freshness.ts`). A warden that forgot the chain at every start sent `prevAt: null` on its first
// result, so the reader could vouch for nothing past the last row it had stored — and a quiet check
// stores one only every five minutes, so a restart (every `enroll.sh --refresh`, every crash, every
// reboot) made up to five minutes before it read "No result" for a node that was reporting all along.
//
// WHAT IS KEPT is, per check, the `at` of the last result CENTER HAS ACKNOWLEDGED — never the last
// one flushed. Center does not compare a `prevAt` with what it holds, so a chain that named a result
// lost with the outbox (it lives in memory) would read as an unbroken stretch for minutes the
// center never heard. A result still in the outbox is therefore replaced by its own `prevAt`: the
// at of the result before it, which by construction left an earlier frame. Whatever cannot be known
// to be acked falls back to the older saved value; the chain only ever errs short, which costs a
// lapse, never an invented stretch.
//
// WHEN IT IS WRITTEN: on an ack, at most once per `SAVE_AFTER_MS` (an event, coalesced — an idle
// warden writes nothing), and once more at a clean stop. A crash loses at most that interval.
import { log } from './log.mjs';
import { readChain, writeChain } from './state.mjs';

const SAVE_AFTER_MS = 30_000;
/** Center allows a probe cadence up to 30 days; a check not heard from for longer is not worth a line. */
const KEEP_FOR_MS = 30 * 24 * 60 * 60 * 1000;

/** The saved chain as a Map, without any entry that cannot be a real past result (not a whole number, in the future, or older than `KEEP_FOR_MS`). */
function usableEntries(record, now) {
  const entries = new Map();
  for (const [check, at] of Object.entries(record ?? {})) {
    if (Number.isSafeInteger(at) && at <= now && at >= now - KEEP_FOR_MS) entries.set(check, at);
  }
  return entries;
}

/** The oldest result per check among the frames the outbox still holds. */
function oldestUnackedPerCheck(outbox) {
  const oldest = new Map();
  for (const frame of outbox.pending(0)) {
    if (frame.type !== 'result') continue;
    for (const result of frame.body.results) {
      const held = oldest.get(result.check);
      if (!held || result.at < held.at) oldest.set(result.check, result);
    }
  }
  return oldest;
}

/**
 * @param {{ home: string, outbox: { pending(afterSeq: number): { type: string, body: object }[] }, now?: () => number }} options
 * @returns {{ previousAt: Map<string, number>, noteAck(): void, save(): void }}
 *   `previousAt` is the live chain the scheduler stamps from and updates (seeded from what was saved);
 *   `noteAck` is called on every `ack`; `save` writes the acked chain now.
 */
export function createChain({ home, outbox, now = Date.now }) {
  let saved = new Map();
  try {
    saved = usableEntries(readChain(home), now());
  } catch (error) {
    log(`chain.json could not be read, so the first results start new chains: ${error.message}`);
  }
  const previousAt = new Map(saved);
  let timer = null;

  function save() {
    clearTimeout(timer);
    timer = null;
    const unacked = oldestUnackedPerCheck(outbox);
    const acked = new Map();
    for (const check of new Set([...saved.keys(), ...previousAt.keys(), ...unacked.keys()])) {
      const held = unacked.get(check);
      const at = held ? (held.prevAt ?? saved.get(check)) : (previousAt.get(check) ?? saved.get(check));
      if (Number.isSafeInteger(at) && at >= now() - KEEP_FOR_MS) acked.set(check, at);
    }
    try {
      writeChain(Object.fromEntries(acked), home);
      saved = acked;
    } catch (error) {
      // A full disk costs the bridge over the next restart, not the daemon.
      log(`could not write chain.json: ${error.message}`);
    }
  }

  return {
    previousAt,
    noteAck() {
      if (timer !== null) return;
      timer = setTimeout(save, SAVE_AFTER_MS);
      timer.unref(); // a pending save must never be what keeps a stopped daemon alive
    },
    save,
  };
}
