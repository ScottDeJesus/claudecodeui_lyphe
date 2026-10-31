// Her ears' worker: where the page decides, for itself, whether a sentence opens with her name. Nothing leaves the browser
// before it does. The capture worklet hands it 16 kHz frames through a MessagePort; for each one it keeps the last
// `EARS.ringSeconds` of sound in memory (overwritten as it goes), asks Silero VAD for the frame's speech probability, and steps
// the pure machine (`earsMachine.ts`). The machine asks for words where a decision needs them, and Moonshine base writes them.
//
// ONE INFERENCE AT A TIME. One onnxruntime WebAssembly instance serves both models, so every frame, every check and every
// message from the page goes through ONE queue, in arrival order. A check's audio is copied out of the ring (or the open press)
// when the check is asked, and transcribed in its turn; at every job's end the ring and the machine have seen the same frames.
//
// EVERY BYTE FROM CLOUDCLI'S OWN SERVER. transformers.js is set to load only local models, from the ears' files route on the
// page's origin with the page's sign-in header, with no browser cache of its own (the route's immutable header and the HTTP
// cache keep the one copy), and its WebAssembly runtime from the app's own build, never a CDN. The route is handed to it as a
// ROOT-RELATIVE path, not the absolute URL: a local path that is a full URL is never asked about by the pipeline's own
// look-up of what the model repository holds (it asks only of local PATHS, or of remote hosts), so with remote models off it
// finds no tokenizer and no processor and its first call throws (measured 2026-10-30 in Chromium).
//
// A failure of any job is one `failed` with a sentence; the worker then does nothing more until the next `arm`. The engine
// (`earsEngine.ts`) ends the worker at that `failed` and starts a fresh one for the next arm, so a press open at the failure
// gets no `closed` (`earsProtocol.ts` says so).

import { AutoModel, env, pipeline, Tensor } from '@huggingface/transformers';
import type { PretrainedConfig } from '@huggingface/transformers';
import ortFactoryUrl from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url';
import ortWasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url';

import { createSoundRing, EARS_FRAME_SAMPLES, encodeWav } from '@/modules/companion/utils/earsAudio';
import { createEarsMachine, EARS } from '@/modules/companion/utils/earsMachine';
import type { EarsAction } from '@/modules/companion/utils/earsMachine';
import type { EarsFromWorker, EarsToWorker } from '@/modules/companion/utils/earsProtocol';

const SILERO_REPO = 'onnx-community/silero-vad';
const MOONSHINE_REPO = 'onnx-community/moonshine-base-ONNX';
/** A name or a phrase is a few words; this bounds a recognizer that runs on over noise. */
const MAX_NEW_TOKENS = 48;
/** The samples per second of every frame, and so of the clip. */
const SAMPLES_PER_MS = 16;

type Vad = (inputs: { input: Tensor; sr: Tensor; state: Tensor }) => Promise<{ output: Tensor; stateN: Tensor }>;
type Transcriber = (audio: Float32Array, options: { max_new_tokens: number }) => Promise<{ text: string } | { text: string }[]>;
type Models = { vad: Vad; transcribe: Transcriber };
/** The frames of one arming: the models it runs, its machine, ring, Silero's state, the channel it reads, and the samples of the press that is open. */
type Session = Models & {
  machine: ReturnType<typeof createEarsMachine>;
  ring: ReturnType<typeof createSoundRing>;
  vadState: Tensor;
  frames: MessagePort;
  press: { start: number; chunks: Int16Array[] } | null;
};

// The one queue, and whether the last job failed (every job but an arm or a disarm is skipped until the next arm).
let queue: Promise<void> = Promise.resolve();
let broken = false;
// The models, loaded once by the first arm and kept across disarms; the arming now (null between a disarm and an arm); the sign-in token the files route is asked with.
let models: Promise<Models> | null = null;
let session: Session | null = null;
let token: string | null = null;

const post = (message: EarsFromWorker, transfer: Transferable[] = []) => self.postMessage(message, { transfer });

/** Adds a job to the queue. A throw becomes the one `failed`; `always` jobs (arm, disarm) run even after a failure. */
function enqueue(job: () => Promise<void> | void, always = false): void {
  queue = queue.then(async () => {
    if (broken && !always) return;
    try {
      await job();
    } catch (error) {
      console.error('[ears] worker job failed', error);
      broken = true;
      post({ kind: 'failed', sentence: `Her ears stopped: ${error instanceof Error ? error.message : String(error)}.` });
    }
  });
}

/** Points transformers.js at the ears' files route and the app's own runtime, then loads both models. */
async function loadModels(filesBase: string): Promise<Models> {
  const base = new URL(filesBase, self.location.href);
  if (base.origin !== self.location.origin) throw new Error(`the files route ${base.href} is not on the page's own origin`);
  env.allowLocalModels = true;
  env.allowRemoteModels = false;
  env.localModelPath = base.pathname;
  env.useBrowserCache = false;
  // The one fetch it uses: the sign-in header goes only to the files route, never with a request for the runtime.
  env.fetch = (input, init) => {
    const headers = new Headers(init?.headers);
    if (token !== null && new URL(String(input), self.location.href).href.startsWith(base.href)) headers.set('Authorization', `Bearer ${token}`);
    return fetch(input, { ...init, headers });
  };
  const wasm = env.backends.onnx.wasm;
  if (wasm === undefined) throw new Error('the WebAssembly runtime is missing from this build');
  wasm.wasmPaths = { mjs: ortFactoryUrl, wasm: ortWasmUrl };
  wasm.numThreads = 1;

  const build = pipeline as unknown as (task: string, model: string, options: object) => Promise<Transcriber>;
  const [vad, transcribe] = await Promise.all([
    // Silero is no architecture the library knows: `custom` hands the session's own inputs and outputs through untouched.
    AutoModel.from_pretrained(SILERO_REPO, { config: { model_type: 'custom' } as PretrainedConfig, dtype: 'fp32', device: 'wasm' }),
    build('automatic-speech-recognition', MOONSHINE_REPO, { dtype: 'q8', device: 'wasm' }),
  ]);
  return { vad: vad as unknown as Vad, transcribe };
}

/** Int16 samples as the floats the models read. */
function toFloats(samples: Int16Array): Float32Array {
  const floats = new Float32Array(samples.length);
  for (let at = 0; at < samples.length; at += 1) floats[at] = samples[at] / 32768;
  return floats;
}

/** The chunks as one run of samples. */
function joinChunks(chunks: Int16Array[]): Int16Array {
  const joined = new Int16Array(chunks.length * EARS_FRAME_SAMPLES);
  chunks.forEach((chunk, index) => joined.set(chunk, index * EARS_FRAME_SAMPLES));
  return joined;
}

/** The samples of frames `[from, to)`: from the open press when it holds them, else from the ring. */
function samplesOf(target: Session, from: number, to: number): Int16Array {
  if (target.press !== null && from >= target.press.start) return joinChunks(target.press.chunks.slice(from - target.press.start, to - target.press.start));
  return target.ring.since(from).subarray(0, Math.max(to - from, 0) * EARS_FRAME_SAMPLES);
}

/** Carries out what the machine asked: tells the page of an open or a close (with the clip), and queues each check's transcription. */
function carryOut(target: Session, actions: EarsAction[]): void {
  for (const action of actions) {
    if (action.kind === 'opened') {
      const held = target.ring.since(action.from);
      const chunks: Int16Array[] = [];
      for (let at = 0; at < held.length; at += EARS_FRAME_SAMPLES) chunks.push(held.subarray(at, at + EARS_FRAME_SAMPLES));
      target.press = { start: action.from, chunks };
      post({ kind: 'opened' });
    } else if (action.kind === 'closed') {
      const clip = samplesOf(target, action.from, action.to);
      target.press = null;
      const wav = encodeWav(clip);
      post({ kind: 'closed', cause: action.cause, wav, durationMs: Math.round(clip.length / SAMPLES_PER_MS) }, [wav]);
    } else {
      const audio = toFloats(samplesOf(target, action.from, action.to));
      enqueue(async () => {
        if (session !== target) return;
        const answer = await target.transcribe(audio, { max_new_tokens: MAX_NEW_TOKENS });
        const text = (Array.isArray(answer) ? answer[0]?.text : answer.text) ?? '';
        carryOut(target, target.machine.step({ kind: 'heard', check: action.check, text }));
      });
    }
  }
}

/** One frame: into the ring (and the open press), through Silero with its state carried, then the machine. */
async function onFrame(target: Session, frame: Int16Array): Promise<void> {
  if (session !== target) return;
  target.ring.push(frame);
  target.press?.chunks.push(frame);
  const result = await target.vad({
    input: new Tensor('float32', toFloats(frame), [1, EARS_FRAME_SAMPLES]),
    sr: new Tensor('int64', [16_000n], []),
    state: target.vadState,
  });
  target.vadState = result.stateN;
  carryOut(target, target.machine.step({ kind: 'frame', p: Number(result.output.data[0]) }));
}

/** The first arm loads the models; every arm connects its frames and answers `ready`. */
async function arm(message: Extract<EarsToWorker, { kind: 'arm' }>): Promise<void> {
  broken = false;
  token = message.token;
  models ??= loadModels(message.filesBase);
  let loaded: Models;
  try {
    loaded = await models;
  } catch (error) {
    // A failed load is final for this worker: transformers.js keeps the rejected fetches of the model files, so another try here
    // would fail at once with the same sentence and ask for nothing (measured 2026-10-30 in Chromium). The engine ends a worker
    // at its `failed`, and the next `arm` meets a fresh one.
    throw new Error(`the models could not be loaded (${error instanceof Error ? error.message : String(error)})`);
  }
  session?.frames.close();
  const target: Session = {
    ...loaded,
    machine: createEarsMachine(message.name),
    ring: createSoundRing(EARS.ringSeconds),
    vadState: new Tensor('float32', new Float32Array(2 * 128), [2, 1, 128]),
    frames: message.frames,
    press: null,
  };
  session = target;
  target.frames.onmessage = (event: MessageEvent<Int16Array>) => enqueue(() => onFrame(target, event.data));
  post({ kind: 'ready' });
}

/**
 * Closes an open press (`gone`, its clip still posted), closes the frames port and drops the ring. It is a job like any other, so
 * a disarm that arrives while an arm is still loading models waits for that arm and then undoes it, and a frame that arrives
 * after it finds no session.
 */
function disarm(): void {
  enqueue(() => {
    const target = session;
    if (target === null) return;
    if (!broken) carryOut(target, target.machine.step({ kind: 'disarm' }));
    target.frames.onmessage = null;
    target.frames.close();
    session = null;
  }, true);
}

/** Hands the page's word on her voice, the button or its end to the machine, in its turn in the queue. */
function tell(message: Exclude<EarsToWorker, { kind: 'arm' | 'disarm' }>): void {
  enqueue(() => {
    if (session !== null) carryOut(session, session.machine.step(message));
  });
}

self.addEventListener('message', (event: MessageEvent<EarsToWorker>) => {
  const message = event.data;
  if (message.kind === 'arm') enqueue(() => arm(message), true);
  else if (message.kind === 'disarm') disarm();
  else tell(message);
});
