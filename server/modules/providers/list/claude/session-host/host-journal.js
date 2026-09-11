/**
 * The journal, the replay cursor and the meta file of one session host.
 *
 * Two rules this file exists to keep:
 * - Nothing here may touch the CLI's stdin. A client socket closing is a DETACH, never EOF
 *   (D-10), so the journal outlives every API process that reads from it.
 * - The "acked" cursor is min(deliveredSeq, pendingResults[0] - 1). A `result` line the API
 *   has not yet confirmed with a `note` MUST be replayed: a SIGKILL landing between that
 *   line's delivery and the provider processing it would otherwise wedge the turn forever,
 *   while a re-delivered stream delta is merely cosmetic (D-3).
 */

import fs from 'node:fs';
import path from 'node:path';

/** A CLI line that is not JSON is simply "not a result"; the bytes are forwarded either way. */
function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// writeMeta's write->rename window is microseconds, so a temp older than this cannot belong
// to a live host and is unambiguously garbage from a SIGKILL that landed inside that window.
const STALE_TEMP_MS = 24 * 60 * 60 * 1000;

/**
 * Removes meta temps a SIGKILLed host left behind. The boot sweep deletes the three real
 * names only, so without this nothing ever reclaims a `<hostId>.json.tmp`.
 * consumer: host.js
 */
export function sweepStaleMetaTemps(sessionsDir) {
  const cutoff = Date.now() - STALE_TEMP_MS;
  let entries;
  try {
    entries = fs.readdirSync(sessionsDir);
  } catch {
    return 0;
  }
  let removed = 0;
  for (const name of entries) {
    if (!name.endsWith('.json.tmp')) continue;
    const target = path.join(sessionsDir, name);
    try {
      if (fs.statSync(target).mtimeMs >= cutoff) continue;
      fs.rmSync(target, { force: true });
      removed += 1;
    } catch {
      // Raced with its own host, or vanished under us; either way it is not ours to chase.
    }
  }
  return removed;
}

/**
 * Opens (and truncates) the journal + meta pair for one host.
 * consumer: host.js
 */
export function createJournal({ hostId, sessionsDir }) {
  const journalPath = path.join(sessionsDir, `${hostId}.ndjson`);
  const metaPath = path.join(sessionsDir, `${hostId}.json`);
  const metaTmpPath = `${metaPath}.tmp`;

  // ONE counter for the journal and the wire: a second counter could drift, and a replayed
  // frame whose seq disagrees with the live stream's would break the cursor arithmetic.
  let nextSeq = 1;

  const meta = {
    hostId,
    appSessionId: null,
    userId: null,
    cwd: null,
    startedAt: Date.now(),
    pid: null,
    turnCompleteSent: false,
    heldForBackgroundWork: false,
    deferredTools: [],
    profile: null,
    deliveredSeq: 0,
    pendingResults: [],
    exited: null
  };

  function writeMeta(patch) {
    if (patch) Object.assign(meta, patch);
    // Atomic rename: a boot sweep or a re-adopting API never reads a half-written meta.
    // 0600 is set on the temp file, because rename carries the mode across with it.
    fs.writeFileSync(metaTmpPath, JSON.stringify(meta), { mode: 0o600 });
    fs.renameSync(metaTmpPath, metaPath);
  }

  function append(frame) {
    fs.appendFileSync(journalPath, `${JSON.stringify(frame)}\n`);
    return frame;
  }

  return {
    meta,
    journalPath,
    metaPath,
    writeMeta,

    metaTmpPath,

    /**
     * Discards any file left by an earlier host that happened to share this id, and creates
     * the journal 0600: it holds the whole CLI transcript, prompts and tool output included.
     */
    start(fields) {
      fs.rmSync(journalPath, { force: true });
      fs.writeFileSync(journalPath, '', { mode: 0o600 });
      writeMeta(fields);
    },

    appendOut(line) {
      return append({ t: 'out', seq: nextSeq++, at: Date.now(), line });
    },

    appendExit(code, signal) {
      const at = Date.now();
      const frame = append({ t: 'exit', seq: nextSeq++, at, code, signal });
      writeMeta({ exited: { code, signal, at } });
      return frame;
    },

    /**
     * Records that `frame` actually reached a client socket. An unacked `result` seq is the
     * only thing that can hold the cursor back, so the meta is refreshed exactly when that
     * set changes; deliveredSeq alone is authoritative in memory and interests no one else.
     */
    markDelivered(frame) {
      if (!frame || typeof frame.seq !== 'number' || frame.seq <= 0) return;
      if (frame.seq > meta.deliveredSeq) meta.deliveredSeq = frame.seq;
      if (frame.t !== 'out' || parseJson(frame.line)?.type !== 'result') return;
      if (meta.pendingResults.includes(frame.seq)) return;
      meta.pendingResults.push(frame.seq);
      meta.pendingResults.sort((a, b) => a - b);
      writeMeta();
    },

    /**
     * D-4: one note per handled result — the ack and both turn bits land in ONE rename.
     * FIFO is the only correlation available: the host's seq never reaches the provider (the
     * facade hands the SDK raw lines), so a note can only mean "the oldest unacked result is
     * done". A note with nothing outstanding is a duplicate; it records the bits and retires
     * nothing, and says so rather than silently moving the D-3 cursor.
     */
    note({ turnCompleteSent, heldForBackgroundWork, deferredTools, ack }) {
      if (ack === false) {
        // A message joined the running process: the bits change, the cursor does not.
      } else if (meta.pendingResults.length === 0) {
        console.warn(`[keepalive] host ${hostId}: note with no unacked result; nothing retired`);
      } else {
        meta.pendingResults.shift();
      }
      writeMeta({
        turnCompleteSent: turnCompleteSent === true,
        heldForBackgroundWork: heldForBackgroundWork === true,
        ...(Array.isArray(deferredTools) ? { deferredTools: deferredTools.filter((id) => typeof id === 'string') } : {})
      });
    },

    /** `fromSeq` is a number, or "acked" for the D-3 cursor. */
    cursorFor(fromSeq) {
      if (fromSeq !== 'acked') {
        const asked = Number(fromSeq);
        return Number.isInteger(asked) && asked > 0 ? asked : 0;
      }
      const oldestUnacked =
        meta.pendingResults.length > 0 ? meta.pendingResults[0] - 1 : meta.deliveredSeq;
      return Math.min(meta.deliveredSeq, oldestUnacked);
    },

    /** Streams the journal's own bytes back, so a replayed frame is never re-serialized. */
    replayFrom(fromSeq, write) {
      if (fromSeq >= nextSeq - 1) return 0;
      let raw;
      try {
        raw = fs.readFileSync(journalPath, 'utf8');
      } catch (err) {
        if (err.code === 'ENOENT') return 0;
        throw err;
      }
      let replayed = 0;
      for (const rawLine of raw.split('\n')) {
        if (rawLine === '') continue;
        const frame = parseJson(rawLine);
        if (!frame || typeof frame.seq !== 'number' || frame.seq <= fromSeq) continue;
        write(rawLine, frame);
        replayed += 1;
      }
      return replayed;
    }
  };
}
