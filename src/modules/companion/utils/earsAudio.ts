// The sound under her ears, pure (no `@/` import, no browser API, so the capture worklet, the worker and the Node replay of the
// ears all run this very code): the audio context's own samples made into 16 kHz frames, the ring that remembers the last few
// seconds of them, and the WAV a name press uploads.

/** What Silero VAD and Moonshine are fed at, and what the clip is written in. */
const ENGINE_RATE = 16_000;
/** One frame is 512 samples: 32 ms at 16 kHz, the size Silero VAD reads at a time. The machine's `EARS.frameMs` is this length. */
export const EARS_FRAME_SAMPLES = 512;

/** How many zero crossings of the low-pass the resampler keeps on each side of an output sample. */
const FILTER_LOBES = 8;
/** The kernel table's resolution, in entries per input sample; between entries the kernel is interpolated linearly. */
const KERNEL_STEPS = 256;
/** The low-pass edge as a share of the OUTPUT's Nyquist (8 kHz): 7.2 kHz keeps speech whole and leaves the transition band room below the aliases. */
const CUTOFF_SHARE = 0.9;

/**
 * Turns the audio context's own samples, at its own rate, into complete 16 kHz frames of 512 samples. The worklet and the Node
 * replay both use it, so the replay feeds the machine what the page feeds it. `push` takes samples of any length (a render
 * quantum is 128) and answers the frames that completed, each its own `Int16Array`, oldest first; a part-frame waits for the
 * next push. At 16 kHz the samples pass straight through; any other rate is low-passed (a windowed sinc, normalised to unit
 * gain at every phase) and read at its 16 kHz positions, so 44.1 and 48 kHz take one path.
 */
export function createFrameMaker(rate: number): { push(samples: Float32Array): Int16Array[] } {
  if (!Number.isFinite(rate) || rate <= 0) throw new RangeError(`The sample rate ${String(rate)} is not a positive number.`);
  // Input samples per output sample, and the low-pass: a sinc whose zero crossings sit `1 / cutoff` input samples apart.
  const passthrough = rate === ENGINE_RATE;
  const step = rate / ENGINE_RATE;
  const cutoff = Math.min(1, 1 / step) * CUTOFF_SHARE;
  const halfWidth = passthrough ? 0 : FILTER_LOBES / cutoff;
  const kernel = new Float32Array(passthrough ? 0 : Math.ceil(halfWidth * KERNEL_STEPS) + 2);
  for (let entry = 0; entry < kernel.length; entry += 1) {
    const distance = entry / KERNEL_STEPS;
    const phase = Math.PI * cutoff * distance;
    const sinc = distance === 0 ? 1 : Math.sin(phase) / phase;
    const window = 0.42 + 0.5 * Math.cos((Math.PI * distance) / halfWidth) + 0.08 * Math.cos((2 * Math.PI * distance) / halfWidth);
    kernel[entry] = distance > halfWidth ? 0 : cutoff * sinc * window;
  }

  // The input not yet used up: `held[0]` is input sample number `base` (counted from the stream's first), `filled` of them are real.
  let held = new Float32Array(0);
  let base = 0;
  let filled = 0;
  // How many output samples have been made, and the frame being filled with them.
  let made = 0;
  let frame = new Int16Array(EARS_FRAME_SAMPLES);
  let framed = 0;

  const toInt16 = (value: number) => Math.round(Math.max(-1, Math.min(1, value)) * (value < 0 ? 32768 : 32767));

  return {
    push(samples) {
      if (held.length < filled + samples.length) {
        const grown = new Float32Array(Math.max(held.length * 2, filled + samples.length));
        grown.set(held.subarray(0, filled));
        held = grown;
      }
      held.set(samples, filled);
      filled += samples.length;

      const frames: Int16Array[] = [];
      for (;;) {
        // Output sample `made` sits at input position `made * step`; it needs every input within `halfWidth` of it.
        const center = made * step;
        if (Math.floor(center + halfWidth) >= base + filled) break;
        let value: number;
        if (passthrough) {
          value = held[made - base];
        } else {
          let sum = 0;
          let weights = 0;
          for (let at = Math.max(Math.ceil(center - halfWidth), 0); at <= center + halfWidth; at += 1) {
            const position = Math.abs(at - center) * KERNEL_STEPS;
            const entry = Math.floor(position);
            const weight = kernel[entry] + (kernel[entry + 1] - kernel[entry]) * (position - entry);
            sum += held[at - base] * weight;
            weights += weight;
          }
          value = sum / weights;
        }
        frame[framed] = toInt16(value);
        framed += 1;
        made += 1;
        if (framed === EARS_FRAME_SAMPLES) {
          frames.push(frame);
          frame = new Int16Array(EARS_FRAME_SAMPLES);
          framed = 0;
        }
      }

      // Drop the input no later output reaches back to.
      const keepFrom = Math.max(Math.ceil(made * step - halfWidth), base);
      if (keepFrom > base) {
        held.copyWithin(0, keepFrom - base, filled);
        filled -= keepFrom - base;
        base = keepFrom;
      }
      return frames;
    },
  };
}

/**
 * The last `seconds` of 16 kHz sound, overwritten as it goes; `since(frame)` copies what it still holds from that frame on.
 * Frames are numbered from 0 in the order they were pushed, and `frame()` is how many have been: the number the next one
 * gets. A frame that has been overwritten is gone: `since` starts at the oldest one held, so the answer is shorter than asked.
 */
export function createSoundRing(seconds: number): { push(frame: Int16Array): void; since(frame: number): Int16Array; frame(): number } {
  const capacity = Math.ceil((seconds * ENGINE_RATE) / EARS_FRAME_SAMPLES);
  const store = new Int16Array(capacity * EARS_FRAME_SAMPLES);
  let pushed = 0;
  return {
    push(frame) {
      if (frame.length !== EARS_FRAME_SAMPLES) throw new RangeError(`A frame of the ring is ${EARS_FRAME_SAMPLES} samples, not ${frame.length}.`);
      store.set(frame, (pushed % capacity) * EARS_FRAME_SAMPLES);
      pushed += 1;
    },
    since(frame) {
      const first = Math.max(Math.floor(frame), pushed - capacity, 0);
      const count = Math.max(pushed - first, 0);
      const copy = new Int16Array(count * EARS_FRAME_SAMPLES);
      for (let offset = 0; offset < count; offset += 1) {
        const slot = ((first + offset) % capacity) * EARS_FRAME_SAMPLES;
        copy.set(store.subarray(slot, slot + EARS_FRAME_SAMPLES), offset * EARS_FRAME_SAMPLES);
      }
      return copy;
    },
    frame: () => pushed,
  };
}

/**
 * 16 kHz mono 16-bit PCM in a 44-byte RIFF header: the clip a name press uploads as audio/wav. The samples go in as the
 * platform stores them, and every platform a page runs on is little-endian (WebAssembly itself requires it).
 */
export function encodeWav(samples: Int16Array): ArrayBuffer {
  const dataBytes = samples.length * 2;
  const wav = new ArrayBuffer(44 + dataBytes);
  const header = new DataView(wav);
  const writeTag = (at: number, tag: string) => {
    for (let index = 0; index < tag.length; index += 1) header.setUint8(at + index, tag.charCodeAt(index));
  };
  writeTag(0, 'RIFF');
  header.setUint32(4, 36 + dataBytes, true);
  writeTag(8, 'WAVE');
  writeTag(12, 'fmt ');
  header.setUint32(16, 16, true);
  header.setUint16(20, 1, true); // PCM
  header.setUint16(22, 1, true); // mono
  header.setUint32(24, ENGINE_RATE, true);
  header.setUint32(28, ENGINE_RATE * 2, true);
  header.setUint16(32, 2, true);
  header.setUint16(34, 16, true);
  writeTag(36, 'data');
  header.setUint32(40, dataBytes, true);
  new Int16Array(wav, 44, samples.length).set(samples);
  return wav;
}
