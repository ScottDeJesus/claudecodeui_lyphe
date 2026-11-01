/**
 * How one sentence's audio is cut into pieces for Rhubarb as it arrives from Gemini. PURE: no I/O, no clock.
 *
 * Rhubarb's phonetic recognizer costs about 0.9 s plus 0.13 s per second of speech, so a whole sentence would be analysed only
 * after it ends; a piece of about 1.4 s is analysed the moment the cutter completes it, while the page still plays the
 * sentence before it. A piece ends at one of her pauses (where a cut costs the recognizer nothing), never inside a word if
 * the audio gives a choice. The audio is 24 kHz mono signed 16-bit little-endian, judged in 20 ms windows by RMS.
 *
 * THE RULES, in `PIECE_RULES`' words:
 *   - a window is quiet when its RMS is under 0.02 of full scale;
 *   - a piece at least 1.2 s long ends in the middle of its first 100 ms of quiet (five quiet windows in a row), the moment
 *     that 100 ms is complete. The piece's length is where it ENDS, so a pause already under way when the piece reaches 1.2 s
 *     counts from the first window that lets the cut land at 1.2 s, and not from where it began;
 *   - a piece that reaches 3.0 s with no such pause ends after its quietest window between 0.8 s and 3.0 s (the earliest
 *     of equals); the audio after that window opens the next piece, which is scanned at once, since up to 2.2 s of it is
 *     already here;
 *   - at the end, what is left is the last piece, unless it is under 0.25 s and quiet throughout.
 *
 * Windows are aligned to the SENTENCE's first sample, not to a piece's, so a window is judged once and keeps its verdict
 * across the cut that lands inside it. A chunk may end mid-sample: the odd byte waits for the next.
 *
 * Consumer: `mouth-follow.ts` (one cutter per sentence). The showing is `.verify/kaylee-mouth-replay.ts`.
 */

/** How a sentence's audio (24 kHz mono, signed 16-bit little-endian) is cut into pieces as it arrives, judged in 20 ms windows. Consumed by `mouth-follow.ts` (the sample rate, to turn samples into seconds). */
export const PIECE_RULES = { sampleRate: 24_000, windowMs: 20, quietRms: 0.02, pauseMs: 100, shortestS: 1.2, longestS: 3.0, earliestS: 0.8, droppedTailS: 0.25 } as const;

/** One piece: its span in samples of the sentence and its audio. Consumed by `mouth-follow.ts`, which hands the audio to Rhubarb. */
export type AudioPiece = { from: number; to: number; pcm: Buffer };

const BYTES_PER_SAMPLE = 2;
const samplesOf = (seconds: number): number => Math.round(seconds * PIECE_RULES.sampleRate);

const WINDOW_SAMPLES = samplesOf(PIECE_RULES.windowMs / 1000);
const PAUSE_SAMPLES = samplesOf(PIECE_RULES.pauseMs / 1000);
const SHORTEST_SAMPLES = samplesOf(PIECE_RULES.shortestS);
const LONGEST_SAMPLES = samplesOf(PIECE_RULES.longestS);
const EARLIEST_SAMPLES = samplesOf(PIECE_RULES.earliestS);
const DROPPED_TAIL_SAMPLES = samplesOf(PIECE_RULES.droppedTailS);

/** Where, from a piece's start, its quiet run must begin for the cut in the middle of it to land no sooner than `shortestS`. */
const FIRST_PAUSE_OFFSET = SHORTEST_SAMPLES - PAUSE_SAMPLES / 2;

/** The RMS, in fractions of full scale, of `count` samples of `audio` from sample `first` (fewer when the audio ends first). */
function rmsOf(audio: Buffer, first: number, count: number): number {
  const available = Math.min(count, (audio.length >> 1) - first);
  if (available <= 0) return 0;
  let sumOfSquares = 0;
  for (let sample = 0; sample < available; sample += 1) {
    const level = audio.readInt16LE((first + sample) * BYTES_PER_SAMPLE) / 32768;
    sumOfSquares += level * level;
  }
  return Math.sqrt(sumOfSquares / available);
}

/** Whether every 20 ms window of `audio`, the last one partial, is quiet. */
function quietThroughout(audio: Buffer): boolean {
  for (let first = 0; first < audio.length >> 1; first += WINDOW_SAMPLES) {
    if (rmsOf(audio, first, WINDOW_SAMPLES) >= PIECE_RULES.quietRms) return false;
  }
  return true;
}

/** Cuts one sentence's audio as it arrives: `push` answers the pieces a chunk completes (a chunk may end mid-sample), `end` the rest. Consumed by `mouth-follow.ts`. */
export function createPieceCutter(): { push(pcm: Buffer): AudioPiece[]; end(): AudioPiece[] } {
  // The audio of the open piece, from sample `from` of the sentence; it ends wherever the stream has got to.
  let audio: Buffer = Buffer.alloc(0);
  let from = 0;
  // The RMS of each complete window of the sentence, by window number: judged once, kept for the cut's replay.
  const levels: number[] = [];
  // The next window the cut rules have not read yet, and the quiet run they have followed through the windows before it.
  let nextToRead = 0;
  let quietWindows = 0;
  let quietStart = 0;
  let ended = false;

  /** The sample the quietest window of the open piece ends at, among those between `earliestS` and `longestS` of its start. */
  function quietestWindowEnd(): number {
    const first = Math.ceil((from + EARLIEST_SAMPLES) / WINDOW_SAMPLES);
    const last = Math.floor((from + LONGEST_SAMPLES) / WINDOW_SAMPLES) - 1;
    let quietest = first;
    for (let window = first + 1; window <= last; window += 1) {
      if (levels[window] < levels[quietest]) quietest = window;
    }
    return (quietest + 1) * WINDOW_SAMPLES;
  }

  /** Reads one judged window against the rules: the sample the open piece ends at, or null for no cut yet. */
  function readWindow(window: number): number | null {
    const start = window * WINDOW_SAMPLES;
    if (start >= from + FIRST_PAUSE_OFFSET && levels[window] < PIECE_RULES.quietRms) {
      if (quietWindows === 0) quietStart = start;
      quietWindows += 1;
      if (quietWindows * WINDOW_SAMPLES >= PAUSE_SAMPLES) return quietStart + PAUSE_SAMPLES / 2;
    } else {
      quietWindows = 0;
    }
    return start + WINDOW_SAMPLES - from >= LONGEST_SAMPLES ? quietestWindowEnd() : null;
  }

  /** Closes the open piece at `sample` and opens the next there. */
  function cutAt(sample: number): AudioPiece {
    const length = sample - from;
    const piece: AudioPiece = { from, to: sample, pcm: audio.subarray(0, length * BYTES_PER_SAMPLE) };
    audio = audio.subarray(length * BYTES_PER_SAMPLE);
    from = sample;
    quietWindows = 0;
    // Windows after the cut were judged under the old piece; the new one reads them again from its first whole window.
    nextToRead = Math.ceil(from / WINDOW_SAMPLES);
    return piece;
  }

  function cutPieces(): AudioPiece[] {
    const pieces: AudioPiece[] = [];
    while (nextToRead < levels.length) {
      const cut = readWindow(nextToRead);
      nextToRead += 1;
      if (cut !== null) pieces.push(cutAt(cut));
    }
    return pieces;
  }

  return {
    push(pcm) {
      if (ended || pcm.length === 0) return [];
      // `concat` copies: the caller's chunk goes on to the speech cache, and no piece may alias it.
      audio = Buffer.concat([audio, pcm]);
      const received = from + (audio.length >> 1);
      for (let window = levels.length; (window + 1) * WINDOW_SAMPLES <= received; window += 1) {
        levels.push(rmsOf(audio, window * WINDOW_SAMPLES - from, WINDOW_SAMPLES));
      }
      return cutPieces();
    },

    end() {
      if (ended) return [];
      ended = true;
      const samples = audio.length >> 1;
      if (samples === 0) return [];
      // An odd last byte is half a sample: it is dropped with the rest of nothing.
      const pcm = audio.subarray(0, samples * BYTES_PER_SAMPLE);
      if (samples < DROPPED_TAIL_SAMPLES && quietThroughout(pcm)) return [];
      return [{ from, to: from + samples, pcm }];
    },
  };
}
