import type { EarsCloseCause } from '@/modules/companion/utils/earsMachine';

/**
 * What the page says to the ears' worker. Used by `earsEngine.ts` (which sends) and `earsWorker.ts` (which reads); a protocol
 * kept in its own file so the worker's bundle and the page's share one definition without either importing the other.
 *
 * `arm` carries no WebAssembly path: the worker resolves the runtime's two files itself, from Vite's own asset URLs of the
 * app's build, so no page code names where onnxruntime lives. `frames` is the end of the channel the capture worklet posts
 * 16 kHz `Int16Array` frames into (transferred). A first `arm` loads the models; a later one, after a `disarm`, only connects
 * the new `frames` and answers `ready` at once.
 */
export type EarsToWorker =
  | { kind: 'arm'; name: string; filesBase: string; token: string | null; frames: MessagePort }
  | { kind: 'her-voice'; sounding: boolean } | { kind: 'button'; recording: boolean } | { kind: 'finish' } | { kind: 'disarm' };

/**
 * What the worker says to the page: `ready` once the models are loaded and frames are being read, `opened` when her name
 * opens a press, `closed` with the press's clip (a 16 kHz mono 16-bit WAV, transferred) and why it closed, and `failed`
 * with a sentence for a load or an inference that went wrong. A `failed` ends the worker (the engine starts a fresh one at the
 * next arm), and a press that was open then gets no `closed`: whoever opened a door on `opened` closes it on `failed`.
 */
export type EarsFromWorker =
  | { kind: 'ready' } | { kind: 'opened' }
  | { kind: 'closed'; cause: EarsCloseCause; wav: ArrayBuffer; durationMs: number }
  | { kind: 'failed'; sentence: string };
