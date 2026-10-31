// The capture side of her ears: an AudioWorkletProcessor, `kaylee-ears`, that sits on the audio thread, takes the context's own
// samples at the context's own rate, makes them 16 kHz frames of 512 samples (`createFrameMaker`, the replay's very code) and
// posts each frame, transferred, through the MessagePort the page handed it. The page's `earsEngine.ts` loads this file with
// Vite's `?worker&url`, which bundles its imports into it, so it loads the same in dev and in the build.

import { createFrameMaker } from '@/modules/companion/utils/earsAudio';

// The audio worklet global scope's own names. The DOM lib the app is typed with does not declare them, and no emit follows from `declare`.
declare const sampleRate: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}
declare function registerProcessor(name: string, processor: new () => AudioWorkletProcessor): void;

class KayleeEarsProcessor extends AudioWorkletProcessor {
  /** The channel the page connects after the node is made; frames made before that (the first render quantum or two) are dropped. */
  private frames: MessagePort | null = null;
  private readonly maker = createFrameMaker(sampleRate);

  constructor() {
    super();
    this.port.onmessage = (event: MessageEvent) => {
      this.frames = event.ports[0] ?? null;
    };
  }

  /** One render quantum in; the frames it completes out. Returns true so the browser keeps the processor for as long as its input is connected. */
  process(inputs: Float32Array[][]): boolean {
    const channel = inputs[0]?.[0];
    if (channel === undefined || this.frames === null) return true;
    for (const frame of this.maker.push(channel)) this.frames.postMessage(frame, [frame.buffer]);
    return true;
  }
}

registerProcessor('kaylee-ears', KayleeEarsProcessor);
