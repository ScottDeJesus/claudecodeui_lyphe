// The scheduler: turns the probes center defines into the results it stores.
//
// Center pushes the node's whole set of probes as `checks.set { version, probes }` — in `welcome`
// when the warden's version is behind, as a frame of its own whenever a definition changes. Each
// application REPLACES the schedule and is answered with `checks.ack { version }`, the receipt that
// tells center which definition this node now runs.
//
//   TIMERS    one per probe, every `every` seconds, the first run after a random 0–`every` delay so a
//             node's probes do not all fire in one second. A probe whose spec is unchanged by a new
//             set keeps its timer, its memory and its run in flight: editing one definition must not
//             open a hole in the cadence of every other probe.
//   OVERLAP   a probe never runs against itself — a turn that finds its run still going is skipped.
//   RUN NOW   `probe.run { probe }` (center's recheck after a fix) runs that probe once, now, and sends its
//             result at once; one already running finishes, then runs once more, so the answer is never the
//             read that began before the fix. The cadence of its timer is not touched.
//   RESULTS   a simple kind yields one result keyed by the probe; a health_doc yields its own check
//             plus one result per component. They wait in a batch that goes out as reliable `result`
//             frames after a second, or at once at 500. A frame holds at most 500 results and
//             4 MiB (center closes a socket on a frame past 8 MiB); a result alone over 1 MiB is
//             sent as a refusal sentence instead of its content.
//   PREVAT    each result carries the `at` of that check's previous result, which is how center tells
//             a quiet stretch from a lapse. It is stamped at flush from `previousAt`, which the daemon
//             seeds with what center had acked before the last stop (`chain.mjs`), so a restart bridges
//             to it; a check whose results were dropped — by an overflowed outbox, or by a frame
//             that could not be queued — is forgotten (null), since center never judges a `prevAt`
//             against what it stored: a chain that names a lost result reads as an unbroken stretch.
//
// What a probe says is the kind's affair (`probe-kinds/*`); this file only schedules, wraps and sends.
import { log } from './log.mjs';
import { killLiveProcesses, MAX_TIMER_MS } from './probe-support.mjs';
import { run as runExec } from './probe-kinds/exec.mjs';
import { run as runFileAge } from './probe-kinds/file-age.mjs';
import { run as runHealthDoc } from './probe-kinds/health-doc.mjs';
import { run as runHttp } from './probe-kinds/http.mjs';
import { run as runSql } from './probe-kinds/sql.mjs';
import { run as runTcp } from './probe-kinds/tcp.mjs';

// A Map, so a kind named "constructor" cannot find itself on a prototype.
const KIND_RUNNERS = new Map([
  ['health_doc', runHealthDoc],
  ['http', runHttp],
  ['tcp', runTcp],
  ['exec', runExec],
  ['file_age', runFileAge],
  ['sql', runSql],
]);

const FLUSH_AFTER_MS = 1000;
const BATCH_LIMIT = 500;
// Center's gateway closes a socket on a frame past 8 MiB (`MAX_FRAME_BYTES`, warden-gateway.ts) and
// the frame at the head of the outbox is resent on every reconnect, so one oversize frame would
// silence the node for good. Half the cap leaves room for the envelope and the `prevAt` stamps.
const FRAME_BYTES_LIMIT = 4 * 1024 * 1024;
const RESULT_BYTES_LIMIT = 1024 * 1024;

function isWholeSeconds(value) {
  return Number.isInteger(value) && value >= 1;
}

/** A spec as a string that is equal exactly when the two specs are, whatever order center listed the fields in. */
function specFingerprint(spec) {
  return JSON.stringify(Object.entries(spec).sort(([left], [right]) => (left < right ? -1 : 1)));
}

/** What `fire` says for a probe it could not run, in words that carry nothing from the error itself. */
function failedRun(sentence, error) {
  return { status: 'failing', value: sentence, data: { error }, tookMs: 0 };
}

/** One kind-built outcome as the results it stands for, before `prevAt`. */
function resultsOf(spec, outcome, now) {
  const wire = (fields) => ({
    check: spec.key, source: spec.key, at: now, fetchedAt: now, status: null, docStatus: null,
    value: null, data: null, tookMs: null, prevAt: null, ...fields,
  });
  if (!outcome.own) return [wire(outcome)];
  const own = wire(outcome.own);
  const components = (outcome.components ?? []).map((component) => wire({ ...component, tookMs: null }));
  return [own, ...components];
}

/**
 * The result as it will be sent, and its size in bytes. A result alone over `RESULT_BYTES_LIMIT`
 * (a component whose `data` or `reason` is a document of its own) is refused with a sentence and a
 * `failing` status: Cerberus is told it could not be read, not handed a frame that closes the link.
 */
function measured(result) {
  const bytes = Buffer.byteLength(JSON.stringify(result));
  if (bytes <= RESULT_BYTES_LIMIT) return { result, bytes };
  const refused = {
    ...result,
    status: 'failing',
    value: `The result was too large to send (${(bytes / (1024 * 1024)).toFixed(1)} MB)`,
    data: { error: 'oversize', bytes },
  };
  return { result: refused, bytes: Buffer.byteLength(JSON.stringify(refused)) };
}

/** Waits `ms` in steps `setTimeout` can store, then calls `then`; `entry.timer` is always the live step, so one `clearTimeout` cancels the wait. */
function waitFor(entry, ms, then) {
  const step = Math.min(ms, MAX_TIMER_MS);
  entry.timer = setTimeout(() => (ms > step ? waitFor(entry, ms - step, then) : then()), step);
}

/**
 * @param {{ link: {
 *   on(type: string, handler: (body: object) => void): unknown,
 *   send(type: string, body: object, options?: { reliable?: boolean }): unknown,
 *   outbox?: { overflowing: boolean, keepLatest(result: object): void },
 * }, previousAt?: Map<string, number> }} options `link` is the warden's link, or anything with `on` and `send`; `outbox` is read through it when it has one.
 *   `previousAt` (check key → the `at` of its last result) is the chain the daemon keeps across restarts; absent, a fresh one.
 */
export function createProbes({ link, previousAt = new Map() }) {
  const schedule = new Map(); // probe key → { spec, fingerprint, timer }
  const memories = new Map(); // probe key → the object the kind keeps between runs
  const running = new Set(); // probe keys whose run is in flight
  const runAgain = new Set(); // probe keys asked to run now while their run was in flight
  let batch = [];
  let flushTimer = null;
  let checksVersion = null;
  let stopped = false;

  // --- the batch ----------------------------------------------------------------------------------

  function sendBatch(results) {
    const outbox = link.outbox;
    if (outbox?.overflowing) {
      // The queue is full: only the newest result per check is worth holding, and the chain before
      // it is gone, so the next results after the drain start a new one.
      for (const result of results) outbox.keepLatest(result);
      previousAt.clear();
      return;
    }
    for (const result of results) {
      result.prevAt = previousAt.get(result.check) ?? null;
      previousAt.set(result.check, result.at);
    }
    link.send('result', { results }, { reliable: true });
  }

  /** Sends what the batch holds as frames of at most `BATCH_LIMIT` results and `FRAME_BYTES_LIMIT` bytes. */
  function flush() {
    clearTimeout(flushTimer);
    flushTimer = null;
    const waiting = batch;
    batch = [];
    let frame = [];
    let frameBytes = 0;

    const sendFrame = () => {
      if (frame.length === 0) return;
      const results = frame;
      frame = [];
      frameBytes = 0;
      try {
        sendBatch(results);
      } catch (error) {
        // The outbox could not number a frame (a full disk): these results are gone. Center never
        // compares a `prevAt` with what it stored, so a chain that went on from them would read as
        // an unbroken stretch; forgetting them makes each check's next result a lapse, as it is.
        for (const result of results) previousAt.delete(result.check);
        log(`could not queue ${results.length} result(s): ${error?.code ?? error?.name ?? 'unknown'}`);
      }
    };

    for (const waitingResult of waiting) {
      let sized;
      try {
        sized = measured(waitingResult);
      } catch (error) {
        // Not JSON-serialisable: nothing a kind builds from a parsed document is, but a flush runs
        // on a timer, where a throw would end the daemon.
        previousAt.delete(waitingResult.check);
        log(`dropped a result of ${waitingResult.check}: ${error?.name ?? 'unknown'}`);
        continue;
      }
      if (frame.length >= BATCH_LIMIT || frameBytes + sized.bytes > FRAME_BYTES_LIMIT) sendFrame();
      frame.push(sized.result);
      frameBytes += sized.bytes;
    }
    sendFrame();
  }

  function enqueue(results) {
    // One at a time: `push(...results)` spreads one argument per result and overflows the stack
    // for a document of ~130 000 components, which would silence even the probe's own check.
    for (const result of results) batch.push(result);
    if (batch.length >= BATCH_LIMIT) flush();
    else if (flushTimer === null && batch.length > 0) flushTimer = setTimeout(flush, FLUSH_AFTER_MS);
  }

  // --- one run ------------------------------------------------------------------------------------

  async function fire(entry, { sendNow = false } = {}) {
    const { spec } = entry;
    if (running.has(spec.key)) return; // still going: this turn is skipped
    running.add(spec.key);
    try {
      const runner = KIND_RUNNERS.get(spec.kind);
      let outcome;
      if (!runner) {
        outcome = failedRun('This warden does not know that kind of probe', 'kind');
      } else {
        try {
          outcome = await runner(spec, memories.get(spec.key));
        } catch (error) {
          // A kind answers rather than throws; one that threw has a bug, and the probe must not go quiet for it.
          log(`probe ${spec.key} failed to run: ${error?.code ?? error?.name ?? 'unknown'}`);
          outcome = failedRun('The warden could not run this probe', 'internal');
        }
      }
      // A probe that left, or was redefined, while this run was going has nothing to say any more.
      if (stopped || schedule.get(spec.key) !== entry) return;
      enqueue(resultsOf(spec, outcome, Date.now()));
      if (sendNow) flush();
    } finally {
      running.delete(spec.key);
      const current = runAgain.delete(spec.key) && !stopped ? schedule.get(spec.key) : null;
      if (current) turn(current, { sendNow: true });
    }
  }

  // --- the schedule -------------------------------------------------------------------------------

  // `fire` is not meant to reject, but a rejection nobody awaits would end the whole daemon.
  function turn(entry, options) {
    fire(entry, options).catch((error) => log(`probe ${entry.spec.key} turn failed: ${error?.code ?? error?.name ?? 'unknown'}`));
  }

  // The first turn comes after a random 0–`every`; each turn re-arms the next before it runs, so a
  // run that outlasts `every` does not shift the cadence. Not `setInterval`: a delay past 24.8 days
  // (center allows 30) would be clamped, and `waitFor` waits it out exactly.
  function startTimer(entry) {
    const begin = () => {
      waitFor(entry, entry.spec.every * 1000, begin);
      turn(entry);
    };
    waitFor(entry, Math.random() * entry.spec.every * 1000, begin);
  }

  function usable(spec) {
    const known = typeof spec === 'object' && spec !== null && typeof spec.key === 'string' && spec.key !== '';
    if (known && isWholeSeconds(spec.every) && isWholeSeconds(spec.timeout)) return true;
    log(`ignoring a probe definition that is not usable: ${known ? spec.key : 'it has no key'}`);
    return false;
  }

  function apply(set) {
    if (stopped) return;
    if (!Number.isSafeInteger(set?.version) || !Array.isArray(set.probes)) {
      log('ignoring a checks.set without a version and a list of probes');
      return;
    }
    const wanted = new Map();
    for (const spec of set.probes) if (usable(spec)) wanted.set(spec.key, spec);

    for (const [key, entry] of schedule) {
      const spec = wanted.get(key);
      if (spec && entry.fingerprint === specFingerprint(spec)) continue; // unchanged: keeps running as it was
      clearTimeout(entry.timer); // always the live step of its wait (`waitFor`)
      schedule.delete(key);
      if (!spec) memories.delete(key);
    }
    for (const [key, spec] of wanted) {
      if (schedule.has(key)) continue;
      const entry = { spec, fingerprint: specFingerprint(spec), timer: null };
      schedule.set(key, entry);
      if (!memories.has(key)) memories.set(key, {});
      startTimer(entry);
    }

    checksVersion = set.version;
    link.send('checks.ack', { version: set.version });
    log(`now running checks version ${set.version}: ${schedule.size} probe(s)`);
  }

  /** Runs `probeKey` now (once more after the run in flight, when there is one); false when this warden does not schedule it. */
  function runNow(probeKey) {
    const entry = schedule.get(probeKey);
    if (!entry) {
      log(`ignoring probe.run for ${typeof probeKey === 'string' ? probeKey : 'a probe with no key'}: this warden does not schedule it`);
      return false;
    }
    if (running.has(probeKey)) runAgain.add(probeKey);
    else turn(entry, { sendNow: true });
    return true;
  }

  link.on('checks.set', apply);
  link.on('welcome', (welcome) => {
    if (welcome?.checks) apply(welcome.checks);
  });
  link.on('probe.run', (body) => runNow(body?.probe));

  return {
    get checksVersion() {
      return checksVersion;
    },
    get probesRunning() {
      return running.size;
    },
    get scheduled() {
      return schedule.size;
    },
    runNow,
    stop() {
      stopped = true;
      for (const entry of schedule.values()) clearTimeout(entry.timer);
      schedule.clear();
      runAgain.clear();
      killLiveProcesses();
      flush();
    },
  };
}
