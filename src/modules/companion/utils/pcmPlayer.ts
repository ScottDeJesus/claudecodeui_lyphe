// The floor page's player for her voice: raw PCM (24 kHz, mono, signed 16-bit little-endian, no container) arrives as
// streams, one per sentence, and leaves as sound, sentence after sentence with no gap.
//
// THE GRAPH. One AudioContext per player, made or resumed by `unlock()` inside the page's first gesture (browsers refuse
// audio before one). Every source runs through ONE GainNode and ONE AnalyserNode into the speakers; the analyser is what
// `level()` reads for the avatar's mouth. The context is made at 24 kHz so a buffer plays with no resampling (a buffer
// resampled one chunk at a time glitches at every chunk edge) and the browser converts the finished mix to the device once.
//
// THE CLOCK. Chunks are placed on the audio clock, never on a timer: each starts where the one before it ends, counted in
// whole samples from the moment the run began (a running sum of floats would drift). Only when nothing is playing, or the
// stream has fallen behind what has already played, does a new run begin, a little ahead of `currentTime`.
//
// THE EVENTS. The audio clock reports them too. A silent one-sample marker is scheduled at each sentence's first chunk, and
// its `ended` is the sentence's `start`; the `ended` of its last real buffer is the `end`. Both are queued by the audio thread
// at the scheduled moment, so a join between two sentences reads as the same instant, and nothing polls. (They fire when the
// audio thread renders the moment, which is the output latency before it is audible: a few tens of milliseconds early.)
// `drain()` is the one place events go out, in the order the sentences were enqueued, `start` before `end`, whichever order
// the browser delivered the callbacks in.

import type { CompanionSoundProgress } from '@/shared/types';

/** Her voice's sample rate, fixed by the speech route. */
const PCM_SAMPLE_RATE = 24_000;
/** How far past `currentTime` a new run begins: time for the audio thread to take the schedule, and a small cushion for the next chunk. */
const RESTART_LEAD_SECONDS = 0.05;
/** A chunk that finds less than this left of what is scheduled starts a new run: a start time already past would play late and overlap the tail. */
const JOIN_GUARD_SECONDS = 0.01;
/** 1024 samples are 43 ms: short enough for a mouth to follow syllables, long enough to read a steady level. */
const ANALYSER_FFT_SIZE = 1024;
/** Web Audio renders in blocks of this many frames: a source stopped now is silent from the next block, not from this instant. */
const RENDER_QUANTUM_FRAMES = 128;

type SentenceEvent = { turnId: string; index: number; phase: 'start' | 'end' };

/**
 * Used by this module's CompanionProvider and its voice hooks: the provider holds the page's one player, the pull loop
 * (`useCompanionVoice`) feeds it each sentence's body and follows its events, the talk press (`useTalkPress`) stops it and reads
 * what was heard, the panel's log marks the playing sentence, and the avatar's mouth reads `level()` and `progress()`.
 */
export type PcmPlayer = {
  /** Plays the sentence after those already enqueued, reading `body` as it arrives; a chunk may end mid-sample. */
  enqueue(turnId: string, index: number, body: ReadableStream<Uint8Array>): void;
  /** Synchronously silences every scheduled source, cancels every body being read and empties the queue; no event follows. */
  stop(): void;
  /** The sentence sounding now, or null between sentences and after `stop()`. */
  playing(): { turnId: string; index: number } | null;
  /** The last sentence that sounded to its end (a stopped one did not, nor one whose body brought no audio); it survives `stop()`. */
  lastEnded(): { turnId: string; index: number } | null;
  /** The analyser's RMS over its last 43 ms, 0..1; 0 when nothing sounds, and 0 from the instant of `stop()` (the cut audio is hidden, not left to fade). */
  level(): number;
  /**
   * The sentence sounding now (`playing()`'s): `elapsed` seconds since its first sample on the audio clock, 0 until that sample is reached,
   * and its `duration` in seconds once its body has ended and every sample is scheduled, else null (still arriving). Null when no sentence
   * sounds. Read on the audio clock, like `level()`, so the two agree on what is sounding. The face's vowel is the text at `elapsed / duration`.
   */
  progress(): CompanionSoundProgress | null;
  /** Reports each sentence's `start` (its first buffer begins sounding) and `end` (its last ends); returns the unsubscribe. */
  onSentence(listener: (event: SentenceEvent) => void): () => void;
  /** Creates or resumes the AudioContext; call it inside a gesture, without awaiting anything first. */
  unlock(): Promise<void>;
};

/** One enqueued sentence, from its body on the network to its last buffer in the speakers. */
type Sentence = {
  turnId: string;
  index: number;
  reader: ReadableStreamDefaultReader<Uint8Array>;
  /** Decoded audio that has arrived but is not scheduled yet, because an earlier sentence is still being scheduled. */
  waiting: Float32Array<ArrayBuffer>[];
  /** True once the body has ended or failed: no more audio will come. */
  streamDone: boolean;
  /** How many real buffers have been scheduled for it, and how many of those have ended. */
  scheduled: number;
  ended: number;
  /** Where its first sample sits on the audio clock (context seconds; null until a buffer is scheduled) and how many samples are scheduled: `progress()` reads both. */
  firstSampleAt: number | null;
  scheduledSamples: number;
  /** Set by the audio clock; `drain()` turns them into events, in order. */
  startReached: boolean;
  endReached: boolean;
  /** Set by `stop()`: whatever a pending read or callback brings back is dropped. */
  cancelled: boolean;
};

type Graph = { context: AudioContext; gain: GainNode; analyser: AnalyserNode; silentFrame: AudioBuffer; levelWindow: Float32Array<ArrayBuffer> };

/** Two little-endian bytes as one signed 16-bit sample, in -1..1. */
function toSample(low: number, high: number): number {
  return (((high << 8) | low) << 16 >> 16) / 32768;
}

/**
 * Turns one chunk into samples. A chunk may end between the two bytes of a sample (a network read cuts anywhere): that odd
 * byte is `leftover`, to be handed back as `carried` with the next chunk.
 */
function decodePcm16(bytes: Uint8Array, carried: number | null): { samples: Float32Array<ArrayBuffer>; leftover: number | null } {
  // An empty read changes nothing: the carried byte keeps waiting for its other half.
  if (bytes.length === 0) return { samples: new Float32Array(0), leftover: carried };
  const samples = new Float32Array((bytes.length + (carried === null ? 0 : 1)) >> 1);
  let from = 0;
  let to = 0;
  if (carried !== null) {
    samples[to++] = toSample(carried, bytes[0]);
    from = 1;
  }
  for (; from + 1 < bytes.length; from += 2) samples[to++] = toSample(bytes[from], bytes[from + 1]);
  return { samples, leftover: from < bytes.length ? bytes[from] : null };
}

/** Takes a node off the graph at once; the one already ended is fine to stop again. */
function silence(node: AudioBufferSourceNode): void {
  node.onended = null;
  try {
    node.stop();
  } catch (error) {
    console.warn('[pcmPlayer] a source refused to stop; disconnecting it instead', error);
  }
  node.disconnect();
}

/** Used by this module's CompanionProvider, which makes the page's one player (see `PcmPlayer`). */
export function createPcmPlayer(): PcmPlayer {
  // Made by the first `unlock()` or `enqueue()`; null until then, so a page that never speaks never opens an audio context.
  let graph: Graph | null = null;
  // Who asked to hear each sentence's `start` and `end`.
  const listeners = new Set<(event: SentenceEvent) => void>();
  /** Sentences enqueued and not yet ended, in enqueue order: the head is the one sounding, or next to. */
  const queue: Sentence[] = [];
  /** Every source still scheduled or sounding, real buffers and markers: `stop()` silences them all. */
  const live = new Set<AudioBufferSourceNode>();
  // The sentence whose `start` has gone out and whose `end` has not: what `playing()` answers.
  let current: Sentence | null = null;
  // The last sentence to sound to its end: what `lastEnded()` answers, so a cut can say what was heard.
  let lastEnded: { turnId: string; index: number } | null = null;
  // Until this context time `level()` reads 0: after `stop()` the analyser's window still holds the cut audio.
  let levelHiddenUntil = 0;
  // The run being laid on the clock: where its first sample sits (context seconds) and how many samples are placed since.
  let runStart = 0;
  let runSamples = 0;
  // True while `drain()` is sending events, so a listener that enqueues or stops cannot start a second pass in the middle of the first.
  let draining = false;

  function ensureGraph(): Graph {
    if (graph) return graph;
    const Constructor =
      typeof window === 'undefined'
        ? undefined
        : window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Constructor) throw new Error('This browser has no Web Audio, so she cannot be heard here.');
    let context: AudioContext;
    try {
      context = new Constructor({ sampleRate: PCM_SAMPLE_RATE });
    } catch (error) {
      console.warn('[pcmPlayer] this browser would not make a 24 kHz context; playing at its own rate', error);
      context = new Constructor();
    }
    const gain = context.createGain();
    const analyser = context.createAnalyser();
    analyser.fftSize = ANALYSER_FFT_SIZE;
    gain.connect(analyser);
    analyser.connect(context.destination);
    const silentFrame = context.createBuffer(1, 1, PCM_SAMPLE_RATE);
    graph = { context, gain, analyser, silentFrame, levelWindow: new Float32Array(analyser.fftSize) };
    return graph;
  }

  function emit(sentence: Sentence, phase: SentenceEvent['phase']): void {
    for (const listener of [...listeners]) {
      try {
        listener({ turnId: sentence.turnId, index: sentence.index, phase });
      } catch (error) {
        // One listener's fault must not stop the others hearing it, nor the next sentence from being announced.
        console.error(`[pcmPlayer] a sentence listener threw on ${sentence.turnId}/${sentence.index} ${phase}`, error);
      }
    }
  }

  /** Sends out every event the audio clock has made due, in order. A listener may enqueue or stop: the queue is re-read after each. */
  function drain(): void {
    if (draining) return;
    draining = true;
    try {
      while (queue.length > 0) {
        const head = queue[0];
        if (current !== head) {
          if (!head.startReached) break;
          current = head;
          emit(head, 'start');
          continue;
        }
        if (!head.endReached) break;
        queue.shift();
        current = null;
        // A body that brought no audio takes its turn (the pull loop waits on its `end`) but was not heard.
        if (head.scheduled > 0) lastEnded = { turnId: head.turnId, index: head.index };
        emit(head, 'end');
      }
    } finally {
      draining = false;
    }
  }

  /** A sentence is finished once its body is over, everything it sent is scheduled and every buffer has ended. */
  function settle(sentence: Sentence): void {
    if (!sentence.streamDone || sentence.waiting.length > 0 || sentence.ended < sentence.scheduled) return;
    // A sentence with no audio still takes its turn, `start` then `end` back to back, so whoever waits on it is not left waiting.
    sentence.startReached = true;
    sentence.endReached = true;
  }

  /** Puts a source on the graph; when the audio clock ends it, `onEnded` runs and the events go out. */
  function track(source: AudioBufferSourceNode, startAt: number, onEnded: () => void): void {
    live.add(source);
    source.onended = () => {
      live.delete(source);
      source.disconnect();
      onEnded();
      drain();
    };
    source.start(startAt);
  }

  function scheduleSamples(active: Graph, sentence: Sentence, samples: Float32Array<ArrayBuffer>): void {
    const { context } = active;
    const now = context.currentTime;
    if (runStart + runSamples / PCM_SAMPLE_RATE < now + JOIN_GUARD_SECONDS) {
      // Nothing to join: begin a new run on the context's own sample grid.
      runStart = Math.ceil((now + RESTART_LEAD_SECONDS) * context.sampleRate) / context.sampleRate;
      runSamples = 0;
    }
    const startAt = runStart + runSamples / PCM_SAMPLE_RATE;
    runSamples += samples.length;
    if (sentence.firstSampleAt === null) sentence.firstSampleAt = startAt;
    sentence.scheduledSamples += samples.length;

    const buffer = context.createBuffer(1, samples.length, PCM_SAMPLE_RATE);
    buffer.copyToChannel(samples, 0);
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(active.gain);
    track(source, startAt, () => {
      sentence.ended += 1;
      settle(sentence);
    });
    if (sentence.scheduled === 0) {
      const marker = context.createBufferSource();
      marker.buffer = active.silentFrame;
      marker.connect(active.gain);
      track(marker, startAt, () => {
        sentence.startReached = true;
      });
    }
    sentence.scheduled += 1;
  }

  /** Schedules what has arrived, strictly in sentence order: a later sentence's audio waits until every earlier body is over. */
  function scheduleWaiting(): void {
    const active = ensureGraph();
    for (const sentence of queue) {
      for (const samples of sentence.waiting.splice(0)) scheduleSamples(active, sentence, samples);
      if (!sentence.streamDone) break;
      settle(sentence);
    }
    drain();
  }

  async function readSentence(sentence: Sentence): Promise<void> {
    let carried: number | null = null;
    try {
      for (;;) {
        const { done, value } = await sentence.reader.read();
        if (sentence.cancelled) return;
        if (done) break;
        const decoded = decodePcm16(value, carried);
        carried = decoded.leftover;
        if (decoded.samples.length > 0) {
          sentence.waiting.push(decoded.samples);
          scheduleWaiting();
        }
      }
    } catch (error) {
      if (sentence.cancelled) return;
      // A body that fails partway is spoken as far as it got; the sentence ends there rather than hanging the queue.
      console.error(`[pcmPlayer] ${sentence.turnId}/${sentence.index} failed while being read or scheduled; ending it where it stands`, error);
    }
    // A single byte left at the end is half a sample: nothing to play.
    sentence.streamDone = true;
    scheduleWaiting();
  }

  function cancelReader(reader: ReadableStreamDefaultReader<Uint8Array>, turnId: string, index: number): void {
    reader.cancel().catch((error: unknown) => {
      console.warn(`[pcmPlayer] cancelling the body of ${turnId}/${index} failed`, error);
    });
  }

  return {
    enqueue(turnId, index, body) {
      let reader: ReadableStreamDefaultReader<Uint8Array>;
      try {
        reader = body.getReader();
      } catch (error) {
        // A locked body, or none at all (a 204's `response.body` is null): this sentence is skipped, not thrown into the caller.
        console.error(`[pcmPlayer] ${turnId}/${index} has no readable body; skipping it`, error);
        return;
      }
      if (queue.some((sentence) => sentence.turnId === turnId && sentence.index === index)) {
        cancelReader(reader, turnId, index);
        return;
      }
      try {
        ensureGraph();
      } catch (error) {
        console.error(`[pcmPlayer] ${turnId}/${index} cannot be played`, error);
        cancelReader(reader, turnId, index);
        return;
      }
      const sentence: Sentence = {
        turnId, index, reader, waiting: [], streamDone: false, scheduled: 0, ended: 0, firstSampleAt: null, scheduledSamples: 0,
        startReached: false, endReached: false, cancelled: false,
      };
      queue.push(sentence);
      void readSentence(sentence);
    },

    stop() {
      for (const sentence of queue.splice(0)) {
        sentence.cancelled = true;
        cancelReader(sentence.reader, sentence.turnId, sentence.index);
      }
      for (const source of live) silence(source);
      live.clear();
      if (graph) levelHiddenUntil = graph.context.currentTime + (graph.analyser.fftSize + RENDER_QUANTUM_FRAMES) / graph.context.sampleRate;
      current = null;
      runStart = 0;
      runSamples = 0;
    },

    playing: () => (current ? { turnId: current.turnId, index: current.index } : null),
    lastEnded: () => lastEnded,

    level() {
      if (!graph || graph.context.state !== 'running' || graph.context.currentTime < levelHiddenUntil) return 0;
      graph.analyser.getFloatTimeDomainData(graph.levelWindow);
      let sumOfSquares = 0;
      for (const sample of graph.levelWindow) sumOfSquares += sample * sample;
      return Math.min(1, Math.sqrt(sumOfSquares / graph.levelWindow.length));
    },

    progress() {
      if (!graph || !current || current.firstSampleAt === null) return null;
      // Its length is known when nothing more can arrive: the body is over and nothing waits behind an earlier sentence.
      const lengthKnown = current.streamDone && current.waiting.length === 0;
      return {
        turnId: current.turnId,
        index: current.index,
        elapsed: Math.max(0, graph.context.currentTime - current.firstSampleAt),
        duration: lengthKnown ? current.scheduledSamples / PCM_SAMPLE_RATE : null,
      };
    },

    onSentence(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    async unlock() {
      // The context is made and `resume()` is called before the first await: both must happen inside the gesture's activation.
      const { context } = ensureGraph();
      if (context.state !== 'running') await context.resume();
    },
  };
}
