import askingUrl from '@/shared/sounds/asking.mp3';
import finishedUrl from '@/shared/sounds/finished.mp3';
import listenCloseUrl from '@/shared/sounds/listen-close.mp3';
import listenOpenUrl from '@/shared/sounds/listen-open.mp3';
import planAsksUrl from '@/shared/sounds/plan-asks.mp3';
import type { SoundName } from '@/shared/types';

/**
 * THE APP'S SOUNDS, one for each moment that makes one, all in one dark key: A, with its tritone E flat and the B flat a half step
 * above it, in one shared hall. Each was synthesized from nothing (no recording) and stored as a small MP3 beside this file:
 *   - `asking`: a question or a permission prompt waits in a chat. A grave bell on A, then a softer one on E flat over its hum.
 *   - `planAsks`: a plan on the roadmap stops on an ask. A far horn on A, then the B flat above it, sagging as it holds.
 *   - `finished`: a turn ended. A soft mallet falling down the A minor chord, E, C, A.
 *   - `listenOpen` / `listenClose`: Kaylee's name opened a recording / the recording closed. A breath and a low voice gliding up
 *     from A to E flat, then back down with a knock; short and dry, so they are over before he speaks.
 *
 * They are made by `scripts/sounds/make-sounds.py` (its recipes, then `python3 scripts/sounds/make-sounds.py src/shared/sounds`), which
 * prints the gains below; the same run gives the same files.
 *
 * EACH FILE IS STORED LOUD (its peak at -1 dBFS) AND PLAYED AT ITS OWN GAIN (`gainDb`): the gain puts it level with the sound it
 * replaced as a laptop's speakers give it (momentary loudness, K-weighted, with the lows such speakers drop cut first), the questions
 * 3 dB over the old chime, a finished turn 1 dB over it, Kaylee's cues level with the old ones. Turning one up or down is that one number.
 */
const SOUNDS: Record<SoundName, { url: string; gainDb: number }> = {
  asking: { url: askingUrl, gainDb: -23.1 },
  planAsks: { url: planAsksUrl, gainDb: -20.2 },
  finished: { url: finishedUrl, gainDb: -26.3 },
  listenOpen: { url: listenOpenUrl, gainDb: -12.8 },
  listenClose: { url: listenCloseUrl, gainDb: -11.5 },
};

/** Each sound's samples, fetched and decoded once for every context that plays it: a decoded buffer belongs to no one context. */
const decoded = new Map<SoundName, Promise<AudioBuffer | null>>();

function samplesOf(name: SoundName, context: BaseAudioContext): Promise<AudioBuffer | null> {
  const known = decoded.get(name);
  if (known !== undefined) return known;
  const samples = fetch(SOUNDS[name].url)
    .then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.arrayBuffer();
    })
    .then((bytes) => context.decodeAudioData(bytes))
    .catch((error: unknown) => {
      // Not kept: the next play asks again, so a file that failed once (offline, a server mid-restart) is not silent for good.
      decoded.delete(name);
      console.warn(`Unable to load the ${name} sound:`, error);
      return null;
    });
  decoded.set(name, samples);
  return samples;
}

/**
 * Fetches and decodes `names` ahead of their first play, so a cue that must be at once is. Used by the companion module's `useEars`
 * as Kaylee's ears get their AudioContext.
 */
export function preloadSounds(context: BaseAudioContext, ...names: SoundName[]): void {
  for (const name of names) void samplesOf(name, context);
}

/**
 * Plays `name` once on `context`, at its own level, straight to the context's destination. Resolves once it has started, or once it
 * could not (the file did not load, or the browser closed the context): a sound that cannot play costs the sound, never its caller.
 * Used by `shared/utils.ts`'s `playNotificationSound` and by the companion module's earcons.
 */
export async function playSound(context: AudioContext, name: SoundName): Promise<void> {
  const samples = await samplesOf(name, context);
  if (samples === null) return;
  try {
    const source = context.createBufferSource();
    source.buffer = samples;
    const level = context.createGain();
    level.gain.value = 10 ** (SOUNDS[name].gainDb / 20);
    source.connect(level);
    level.connect(context.destination);
    source.start();
  } catch (error) {
    console.warn(`Unable to play the ${name} sound:`, error);
  }
}
