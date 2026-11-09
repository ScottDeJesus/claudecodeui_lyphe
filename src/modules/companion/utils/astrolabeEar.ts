// Her face's ear: what a voice is doing, one frame at a time, heard from a Web Audio AnalyserNode — loudness, three bands, pitch
// and hard-consonant onsets. Ported from the Astrolabe design system's signal (and the visualizer before it) with its constants
// unchanged: bands are gain-normalised against the voice itself (a slow automatic gain), a noise gate keeps room tone out, onsets
// are spectral flux above a running threshold, and pitch is YIN on a decimated window.
//
// One ear per analyser, shared: two faces on a page (her button and the station's portrait) read the same frame, and the work is
// done once per animation frame however many read it.

import type { AstrolabeVoiceFrame } from '@/shared/types';

/** A frame read again within this many ms returns the frame already worked out (two faces in one animation frame). */
const SAME_FRAME_MS = 5;
/** YIN's threshold: the first dip of the normalised difference below this is the period. */
const YIN_THRESHOLD = 0.15;
/** The samples YIN compares per lag: 13 ms at 24 kHz, enough for a voice down to 72 Hz on the decimated window. */
const YIN_WINDOW = 320;

const clamp = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const ease = (current: number, target: number, dt: number, tau: number) => current + (target - current) * (1 - Math.exp(-dt / Math.max(1e-4, tau)));
/** An envelope follower: a fast attack and a slower release, as the instrument's meters move. */
const follow = (current: number, target: number, dt: number, attack: number, release: number) => ease(current, target, dt, target > current ? attack : release);

type Pitch = { f0: number; confidence: number };

function createEar(analyser: AnalyserNode): () => AstrolabeVoiceFrame {
  const sampleRate = analyser.context.sampleRate;
  const timeData = new Float32Array(analyser.fftSize);
  const freqData = new Float32Array(analyser.frequencyBinCount);
  const previousMagnitudes = new Float32Array(analyser.frequencyBinCount);
  const decimated = new Float32Array(1024);
  const difference = new Float32Array(512);
  // The slow automatic gain each band is read against, so a quiet voice still fills the instrument.
  const gain = { low: 0.02, mid: 0.02, high: 0.004, rms: 0.04 };
  let fluxAverage = 0;
  let fluxVariance = 0;
  let lastOnsetAt = 0;
  let noiseFloor = 0.002;
  let frameCount = 0;
  let lastPitch: Pitch | null = null;
  let lastReadAt = 0;
  const frame: AstrolabeVoiceFrame = { rms: 0, low: 0, mid: 0, high: 0, f0: 0, voicing: 0, onsets: 0, onsetAmp: 0 };

  /** YIN on the window decimated by two when the rate allows (a voice needs nothing above 8 kHz to find its period). */
  const pitch = (): Pitch => {
    const factor = sampleRate > 32000 ? 2 : 1;
    const count = Math.min(decimated.length, Math.floor(timeData.length / factor));
    for (let i = 0; i < count; i++) decimated[i] = factor === 2 ? 0.5 * (timeData[2 * i] + timeData[2 * i + 1]) : timeData[i];
    const rate = sampleRate / factor;
    const minLag = Math.max(2, Math.floor(rate / 420));
    const maxLag = Math.min(Math.floor(rate / 72), count - YIN_WINDOW - 2, difference.length - 2);
    let runningSum = 0;
    let best = -1;
    difference[0] = 1;
    for (let lag = 1; lag <= maxLag + 1; lag++) {
      let sum = 0;
      for (let j = 0; j < YIN_WINDOW; j++) {
        const delta = decimated[j] - decimated[j + lag];
        sum += delta * delta;
      }
      runningSum += sum;
      difference[lag] = runningSum > 0 ? (sum * lag) / runningSum : 1;
    }
    for (let lag = minLag; lag <= maxLag; lag++) {
      if (difference[lag] < YIN_THRESHOLD) {
        while (lag + 1 <= maxLag && difference[lag + 1] < difference[lag]) lag++;
        best = lag;
        break;
      }
    }
    if (best < 0) {
      let lowest = 1;
      let lowestLag = -1;
      for (let lag = minLag; lag <= maxLag; lag++) {
        if (difference[lag] < lowest) {
          lowest = difference[lag];
          lowestLag = lag;
        }
      }
      if (lowest < 0.3 && lowestLag > 0) best = lowestLag;
      else return { f0: 0, confidence: clamp(1 - lowest, 0, 1) * 0.5 };
    }
    const a = difference[best - 1];
    const b = difference[best];
    const c = difference[best + 1];
    const denominator = a + c - 2 * b;
    const shift = Math.abs(denominator) > 1e-9 ? (0.5 * (a - c)) / denominator : 0;
    return { f0: rate / (best + clamp(shift, -1, 1)), confidence: clamp(1 - b, 0, 1) };
  };

  return () => {
    const now = performance.now();
    if (now - lastReadAt < SAME_FRAME_MS) return frame;
    const dt = clamp((now - (lastReadAt || now - 16)) / 1000, 0.001, 0.1);
    lastReadAt = now;

    analyser.getFloatTimeDomainData(timeData);
    let sumOfSquares = 0;
    for (let i = 0; i < timeData.length; i++) sumOfSquares += timeData[i] * timeData[i];
    const rms = Math.sqrt(sumOfSquares / timeData.length);

    analyser.getFloatFrequencyData(freqData);
    const binHz = sampleRate / analyser.fftSize;
    let low = 0;
    let mid = 0;
    let high = 0;
    let flux = 0;
    for (let i = 1; i < freqData.length; i++) {
      const decibels = freqData[i];
      const magnitude = decibels > -160 ? Math.pow(10, decibels / 20) : 0;
      const hz = i * binHz;
      if (hz >= 70 && hz < 350) low += magnitude * magnitude;
      else if (hz >= 350 && hz < 2500) mid += magnitude * magnitude;
      else if (hz >= 3500 && hz < 10000) high += magnitude * magnitude;
      if (hz >= 2500) {
        const rise = magnitude - previousMagnitudes[i];
        if (rise > 0) flux += rise;
      }
      previousMagnitudes[i] = magnitude;
    }
    low = Math.sqrt(low);
    mid = Math.sqrt(mid);
    high = Math.sqrt(high);

    const decay = Math.exp(-dt / 4);
    gain.low = Math.max(gain.low * decay, low, 1e-4);
    gain.mid = Math.max(gain.mid * decay, mid, 1e-4);
    gain.high = Math.max(gain.high * decay, high, 1e-5);
    gain.rms = Math.max(gain.rms * decay, rms, 0.01);
    noiseFloor = rms < noiseFloor ? lerp(noiseFloor, rms, 0.2) : lerp(noiseFloor, rms, 0.002);
    const gate = clamp((rms - noiseFloor * 1.8) / (noiseFloor * 4 + 0.004), 0, 1);
    const dbfs = 20 * Math.log10(rms + 1e-9);
    const targetRms = clamp(0.5 * clamp((dbfs + 58) / 46, 0, 1) + 0.5 * (rms / gain.rms), 0, 1) * gate;
    const targetLow = clamp(low / gain.low, 0, 1) * gate;
    const targetMid = clamp(mid / gain.mid, 0, 1) * gate;
    const targetHigh = clamp(high / gain.high, 0, 1) * gate;

    fluxAverage = lerp(fluxAverage, flux, 0.08);
    fluxVariance = lerp(fluxVariance, (flux - fluxAverage) * (flux - fluxAverage), 0.08);
    const threshold = fluxAverage + 2.2 * Math.sqrt(fluxVariance) + 1e-4;
    if (flux > threshold && gate > 0.3 && now - lastOnsetAt > 85) {
      lastOnsetAt = now;
      frame.onsets += 1;
      frame.onsetAmp = clamp((flux - threshold) / (threshold + 1e-6), 0.25, 1);
    }

    // Pitch every other frame: the period moves slower than the envelope does.
    frameCount += 1;
    if (frameCount % 2 === 0 || lastPitch === null) lastPitch = pitch();
    const targetF0 = lastPitch.f0 > 0 && gate > 0.2 ? lastPitch.f0 : 0;

    frame.rms = follow(frame.rms, targetRms, dt, 0.016, 0.075);
    frame.low = follow(frame.low, targetLow, dt, 0.028, 0.12);
    frame.mid = follow(frame.mid, targetMid, dt, 0.02, 0.09);
    frame.high = follow(frame.high, targetHigh, dt, 0.008, 0.05);
    if (targetF0 > 0) frame.f0 = frame.f0 > 0 ? ease(frame.f0, targetF0, dt, 0.028) : targetF0;
    frame.voicing = follow(frame.voicing, targetF0 > 0 ? lastPitch.confidence : 0, dt, 0.02, 0.07);
    return frame;
  };
}

// One ear per analyser for the analyser's life, so every face on the page reads the same frame.
const earsByAnalyser = new WeakMap<AnalyserNode, () => AstrolabeVoiceFrame>();

/** Used by this module's CompanionAvatar: the frame its instrument draws, heard from `analyser` (her player's tap, or the ears' microphone tap). */
export function hearVoice(analyser: AnalyserNode): AstrolabeVoiceFrame {
  let ear = earsByAnalyser.get(analyser);
  if (!ear) {
    ear = createEar(analyser);
    earsByAnalyser.set(analyser, ear);
  }
  return ear();
}
