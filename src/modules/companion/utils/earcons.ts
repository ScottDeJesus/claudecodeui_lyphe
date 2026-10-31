/** How long one note sounds, in seconds; the second note starts as the first ends. */
const NOTE_SECONDS = 0.11;
/** The rise at a note's start and the fall at its end, in seconds, so a note never clicks. */
const NOTE_RAMP_SECONDS = 0.01;
/** A note's peak gain: a quiet cue, not an alert. */
const NOTE_GAIN = 0.12;

/** The two notes of each cue, in Hz: her name opened a recording (A4, then E5, rising) and a recording closed (E5, then A4, falling). */
const NOTES = { opened: [440, 659], closed: [659, 440] } as const;

/**
 * Used by `useEars`: the tone that tells him her name opened a recording (`opened`, rising) and that one closed, however it
 * closed (`closed`, falling). Two sine notes on the ears' own AudioContext, straight to its destination: they never pass
 * through her player, whose analyser moves her mouth, and her voice switch does not silence them (they are the page's cue,
 * not her speech).
 */
export function playEarcon(context: AudioContext, kind: 'opened' | 'closed'): void {
  const startsAt = context.currentTime;
  NOTES[kind].forEach((frequency, index) => {
    const noteStart = startsAt + index * NOTE_SECONDS;
    const noteEnd = noteStart + NOTE_SECONDS;
    const oscillator = context.createOscillator();
    const envelope = context.createGain();
    oscillator.type = 'sine';
    // `value`, not `setValueAtTime`: the note's pitch is its own from the moment it is made.
    oscillator.frequency.value = frequency;
    envelope.gain.setValueAtTime(0, noteStart);
    envelope.gain.linearRampToValueAtTime(NOTE_GAIN, noteStart + NOTE_RAMP_SECONDS);
    envelope.gain.setValueAtTime(NOTE_GAIN, noteEnd - NOTE_RAMP_SECONDS);
    envelope.gain.linearRampToValueAtTime(0, noteEnd);
    oscillator.connect(envelope);
    envelope.connect(context.destination);
    oscillator.start(noteStart);
    oscillator.stop(noteEnd);
  });
}
