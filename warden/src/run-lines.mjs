// The output of one run, turned into the `{ n, t, stream, line }` lines of `run.output` batches.
//
//   LINES    each stream is cut at newlines, a CRLF's carriage return is dropped, and what a terminal
//            would have overwritten (text before a lone `\r`) goes with it. Escape sequences and other
//            control characters are stripped: a NUL would truncate the line in center's SQLite, and an
//            escape would be drawn as noise. `n` counts from 1 across both streams, in arrival order;
//            `t` is seconds since the run started.
//   BATCHES  a batch leaves 250 ms after its first line, whatever arrives meanwhile — armed by a line, not
//            ticking: a silent run wakes nothing. `finish()` sends what is left at once.
//   BOUNDS   a command that prints without end must not grow the warden: a line is cut at `LINE_CHARS`
//            (a longer one with no newline is cut into several), and a run keeps its first `MAX_LINES`
//            lines or `MAX_CHARS` characters. What is past that is counted, and `finish()` adds one line
//            saying how many were not kept. The run itself is not touched: it still ends as it ends.
import { clip } from './probe-support.mjs';

const BATCH_MS = 250;
const LINE_CHARS = 2000;
const MAX_LINES = 5000;
const MAX_CHARS = 512 * 1024;

const ESCAPE_SEQUENCE = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b-\u001f\u007f]/g;

/** One raw line as it is kept: no trailing CR, nothing a terminal would have overwritten, no control characters, at most `LINE_CHARS`. */
function tidy(raw) {
  const noTrailingReturn = raw.replace(/\r+$/, '');
  const visible = noTrailingReturn.slice(noTrailingReturn.lastIndexOf('\r') + 1);
  const clean = visible.replace(ESCAPE_SEQUENCE, '').replace(CONTROL_CHARACTERS, '');
  return clean.length > LINE_CHARS ? `${clip(clean, LINE_CHARS)}…` : clean;
}

/**
 * @param {{ emit: (lines: { n: number, t: number, stream: 'out'|'err', line: string }[]) => void }} options `emit` receives each batch.
 * @returns {{ take(stream: 'out'|'err', chunk: string): void, finish(): void, abandon(): void }}
 */
export function createRunLines({ emit }) {
  const startedAt = performance.now();
  const partial = { out: '', err: '' }; // the text after the last newline of each stream
  let batch = [];
  let flushTimer = null;
  let number = 0;
  let characters = 0;
  let dropped = 0;
  let closed = false;

  function flush() {
    clearTimeout(flushTimer);
    flushTimer = null;
    if (batch.length === 0) return;
    const lines = batch;
    batch = [];
    emit(lines);
  }

  function addLine(stream, raw, { force = false } = {}) {
    if (closed) return;
    if (!force && (number >= MAX_LINES || characters >= MAX_CHARS)) {
      dropped += 1;
      return;
    }
    const line = tidy(raw);
    number += 1;
    characters += line.length;
    batch.push({ n: number, t: Math.round(performance.now() - startedAt) / 1000, stream, line });
    if (flushTimer === null) flushTimer = setTimeout(flush, BATCH_MS);
  }

  return {
    take(stream, chunk) {
      const pieces = (partial[stream] + chunk).split('\n');
      let rest = pieces.pop();
      for (const piece of pieces) addLine(stream, piece);
      // A stream with no newline in sight is cut into lines of its own: the rest is never allowed to grow past one.
      while (rest.length > LINE_CHARS) {
        const cut = clip(rest, LINE_CHARS);
        addLine(stream, cut);
        rest = rest.slice(cut.length);
      }
      partial[stream] = rest;
    },
    /** The run is over: the last unfinished line of each stream, the count of what was not kept, and everything still waiting, now. */
    finish() {
      for (const stream of ['out', 'err']) {
        if (partial[stream] !== '') addLine(stream, partial[stream]);
        partial[stream] = '';
      }
      if (dropped > 0) addLine('err', `${dropped} more line${dropped === 1 ? '' : 's'} not kept: a run keeps its first ${MAX_LINES}`, { force: true });
      flush();
      closed = true;
    },
    /** The warden is stopping: nothing more is sent. */
    abandon() {
      closed = true;
      clearTimeout(flushTimer);
      flushTimer = null;
      batch = [];
    },
  };
}
