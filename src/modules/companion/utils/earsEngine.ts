// The ears' plumbing on the page, without React: one worker for as long as the caller keeps the engine (its models loaded once),
// and a capture (microphone stream -> capture worklet -> the worker's frames channel) attached and detached as arming comes and
// goes. `useEars` drives it; `.verify/kaylee-ears-engine.mjs` shows it in Chromium on its own.
//
// The worker is made by the FIRST `arm`, not by `createEarsEngine`, and lives in its own chunk (Vite follows the literal
// `new Worker(new URL(...))`), so a page whose ears are off loads none of transformers.js.

// `?worker&url` is Vite's: the linter resolves the specifier to the worklet's file, which exports nothing, and what Vite hands
// back is the URL of that file bundled with its imports.
// eslint-disable-next-line import/default
import earsWorkletUrl from '@/modules/companion/utils/earsCapture.worklet.ts?worker&url';
import type { EarsFromWorker, EarsToWorker } from '@/modules/companion/utils/earsProtocol';

/** The ears' plumbing on the page: one worker for as long as the caller keeps the engine (its models loaded once), and a capture attached and detached as arming comes and goes. Used by `useEars`. */
export type EarsEngine = {
  /**
   * Loads the models the first time and connects a fresh frames channel; resolves on `ready`, rejects with the `failed` sentence,
   * or when a `detach` or `end` lands while it loads. A `failed` ends the worker: the next `arm()` starts a fresh one and loads
   * the models again (transformers.js keeps the rejected fetches of a failed load, so the same worker could only fail again at
   * once), and a press open at that moment gets no `closed`, so the caller closes its own door on `failed`.
   */
  arm(): Promise<void>;
  /** Feeds `stream` through the capture worklet into the armed worker; resolves once its node is connected. */
  attach(stream: MediaStream): Promise<void>;
  /** Disconnects the capture and tells the worker `disarm` (an open press closes `gone`, its clip still posted). The stream is the caller's to stop. */
  detach(): void;
  /**
   * `her-voice`, `button` or `finish`, passed to the worker as they are. A worker that is not armed drops what it is told, so the
   * engine keeps the last `her-voice` and `button` state and carries it into the machine of each `arm`.
   */
  tell(message: Extract<EarsToWorker, { kind: 'her-voice' | 'button' | 'finish' }>): void;
  /**
   * Ends the worker at once. A press still open is dropped with it: no `closed` follows. A caller that wants that clip calls
   * `detach()` and ends the engine after the `closed` message.
   */
  end(): void;
};

/** What `attach` built, so `detach` can take it apart. */
type Capture = { source: MediaStreamAudioSourceNode; node: AudioWorkletNode };

/**
 * Used by `useEars` (the page's ears) and the engine's showing; `onMessage` hears every message the worker sends, `ready` and
 * `failed` included, except the `ready` of an arm that a `detach` or `end` abandoned while it loaded.
 */
export function createEarsEngine(input: {
  context: AudioContext;
  name: string;
  filesBase: string;
  token: string | null;
  onMessage: (message: EarsFromWorker) => void;
}): EarsEngine {
  const { context, name, filesBase, token, onMessage } = input;
  // Made by the first `arm`; null until then and after `end`.
  let worker: Worker | null = null;
  // The arm waiting on its `ready` (or its `failed`), so a second call while one is out gets the same answer.
  let arming: { promise: Promise<void>; settle: { resolve(): void; reject(error: Error): void } } | null = null;
  // How many `arm` messages the worker has not yet answered with `ready`. It answers them in the order they were sent, so only the
  // answer that brings this to 0 is for the arming now waiting; an earlier one belongs to an arming a `detach` abandoned.
  let unanswered = 0;
  // Her voice and the talk button as last told. A worker that is not armed (or not made yet) drops what it is told, so each `arm` replays these.
  let herSounding = false;
  let buttonRecording = false;
  // The worklet's end of the frames channel an `arm` made, until `attach` hands it to the capture node.
  let framesForCapture: MessagePort | null = null;
  // Counts every `detach` and `end`, so an `attach` still waiting on the worklet's module can tell it was undone while it waited and connect nothing.
  let undone = 0;
  // What `attach` connected, until `detach`.
  let capture: Capture | null = null;
  // The capture worklet's module, added to the context once: a context keeps a module for its life.
  let workletAdded: Promise<void> | null = null;

  const failArm = (sentence: string) => {
    const waiting = arming;
    arming = null;
    waiting?.settle.reject(new Error(sentence));
  };

  /**
   * Ends the worker for good, so the next `arm` starts a clean one, and rejects the arm waiting on it. Done at every `failed` and
   * at a script that would not load: transformers.js keeps the rejected fetches of a failed load (measured 2026-10-30: the next
   * arm of the same worker failed in 68 ms with the old sentence and asked for nothing), and a Worker whose script never loaded
   * never answers anything.
   */
  const discardWorker = (sentence: string) => {
    worker?.terminate();
    worker = null;
    unanswered = 0;
    failArm(sentence);
  };

  const startWorker = (): Worker => {
    const started = new Worker(new URL('./earsWorker.ts', import.meta.url), { type: 'module' });
    // A message or error from a worker that has since been discarded or ended is the past's: nothing of it reaches the page.
    started.onmessage = (event: MessageEvent<EarsFromWorker>) => {
      if (worker !== started) return;
      const message = event.data;
      if (message.kind === 'failed') {
        discardWorker(message.sentence);
      } else if (message.kind === 'ready') {
        unanswered -= 1;
        // Not the last arm's answer, or nobody waits on it (a `detach` abandoned that arm): the caller was told nothing of this arming, so is told nothing now.
        const waiting = arming;
        if (unanswered > 0 || waiting === null) return;
        arming = null;
        waiting.settle.resolve();
      }
      onMessage(message);
    };
    // A worker that never started (its script or one of its imports did not load) is a failure the page must hear of in words.
    started.onerror = (event) => {
      if (worker !== started) return;
      const sentence = `Her ears could not start (${event.message || 'the worker failed to load'}).`;
      discardWorker(sentence);
      onMessage({ kind: 'failed', sentence });
    };
    return started;
  };

  const send = (message: EarsToWorker, transfer: Transferable[] = []) => worker?.postMessage(message, transfer);

  const takeCaptureApart = () => {
    undone += 1;
    if (capture === null) return;
    capture.source.disconnect();
    capture.node.disconnect();
    capture.node.port.close();
    capture = null;
  };

  return {
    arm() {
      if (arming !== null) return arming.promise;
      worker ??= startWorker();
      framesForCapture?.close();
      const channel = new MessageChannel();
      framesForCapture = channel.port1;
      let settle!: { resolve(): void; reject(error: Error): void };
      const promise = new Promise<void>((resolve, reject) => {
        settle = { resolve, reject };
      });
      arming = { promise, settle };
      unanswered += 1;
      send({ kind: 'arm', name, filesBase, token, frames: channel.port2 }, [channel.port2]);
      // The machine this arm builds starts with her silent and no button pressed: what was told before it (or while detached) is told again.
      if (herSounding) send({ kind: 'her-voice', sounding: true });
      if (buttonRecording) send({ kind: 'button', recording: true });
      return promise;
    },

    async attach(stream) {
      const frames = framesForCapture;
      if (frames === null) throw new Error('Her ears are not armed: there is no frames channel to capture into.');
      takeCaptureApart();
      const attachedAt = undone;
      try {
        workletAdded ??= context.audioWorklet.addModule(earsWorkletUrl);
        await workletAdded;
      } catch (error) {
        workletAdded = null;
        throw error;
      }
      // Detached (or ended) while the module loaded: the channel was closed with it, and nothing is connected.
      if (undone !== attachedAt) return;
      // Mono, mixed down by the browser: the worklet reads channel 0. No output: nothing of the microphone is ever played.
      const node = new AudioWorkletNode(context, 'kaylee-ears', { numberOfInputs: 1, numberOfOutputs: 0, channelCount: 1, channelCountMode: 'explicit' });
      node.port.postMessage(null, [frames]);
      framesForCapture = null;
      const source = context.createMediaStreamSource(stream);
      source.connect(node);
      capture = { source, node };
      // A context made before the page's first touch is suspended; it plays on at the touch, and nothing here waits for it.
      if (context.state === 'suspended') context.resume().catch((error: unknown) => console.warn('[ears] the audio context would not resume', error));
    },

    detach() {
      takeCaptureApart();
      framesForCapture?.close();
      framesForCapture = null;
      // An arm still loading is abandoned: the worker finishes it and then runs the `disarm` below, which undoes it. Its caller is told
      // so, and `arming` is freed, so the next `arm()` posts an arm of its own instead of sharing one that is about to be undone.
      failArm('Her ears were disarmed before they were ready.');
      send({ kind: 'disarm' });
    },

    tell(message) {
      if (message.kind === 'her-voice') herSounding = message.sounding;
      else if (message.kind === 'button') buttonRecording = message.recording;
      send(message);
    },

    end() {
      takeCaptureApart();
      framesForCapture?.close();
      framesForCapture = null;
      failArm('Her ears were ended before they were ready.');
      worker?.terminate();
      worker = null;
      unanswered = 0;
    },
  };
}
