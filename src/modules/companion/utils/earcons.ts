import { playSound, preloadSounds } from '@/shared/sounds';

/** Each cue's sound in the app's set: Kaylee's name opened a recording, and a recording closed. */
const CUES = { opened: 'listenOpen', closed: 'listenClose' } as const;

/**
 * Used by `useEars`: the cue that tells him Kaylee's name opened a recording (`opened`: a quick breath in and a low voice rising from A
 * to E flat) and that one closed, however it closed (`closed`: the voice falling back, a breath out, a soft knock). Both are the app's
 * sound set's (`shared/sounds`), played on the ears' own AudioContext straight to its destination: they never pass through Kaylee's
 * player, whose analyser moves the face, and the voice switch does not silence them (they are the page's cue, not speech).
 */
export function playEarcon(context: AudioContext, kind: 'opened' | 'closed'): void {
  void playSound(context, CUES[kind]);
}

/** Used by `useEars` as the ears take their AudioContext: both cues fetched and decoded ahead, so the first one sounds at once. */
export function readyEarcons(context: BaseAudioContext): void {
  preloadSounds(context, CUES.opened, CUES.closed);
}
