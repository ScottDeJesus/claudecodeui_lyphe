// The decisions of her ears, PURE: frames, Silero's probabilities and Moonshine's words go in, actions come out. Time is the
// audio's own frame count, so there is no timer here and a recorded stream replays to the same actions. The worker feeds
// it live; `.verify/ears-replay.mjs` feeds it a composed WAV. It imports nothing through `@/`, so the replay loads it as it is.
//
// Frames are numbered from 0; a range of frames is `[from, to)`, and "now" is `frame()`, how many have been stepped.
//
// WAITING. Speech starts at a frame whose probability is `startP` or more and goes on while it is `keepP` or more; a
// segment ends `endFrames` after its last such frame. A segment that begins while her voice sounds, within `herTailMs` after
// it stops, or while a button press records is not his to her and is never checked. Any other is checked once, at the earlier
// of its end or `firstCheckMs` after its start: words for the frames from `preRollMs` before it. `opensWithName` reads them:
// "yes" opens a press whose sound starts `preRollMs` before the segment; "unsure" asks again at the earlier of its end or
// `secondCheckMs` (a segment already at its end gets nothing more). A "yes" that arrives while a button press records opens nothing.
//
// OPEN. Each segment end asks a `tail` check of its last `tailCheckMs`, never reaching back before the press. "Over to you,
// <name>" closes at that segment's end (`phrase`), even when the words arrive after newer speech has begun; a hold phrase
// suspends the quiet rule until the next speech starts, for at most `holdMaxMs` after that end (so a hold whose words arrive
// after newer speech has begun suspends nothing); otherwise `quietMs` with no speech closes it (`quiet`), once no tail check of the last segment
// is out. `pressMaxMs` after its start closes it (`limit`), `finish` (his button) closes it (`press`), `disarm` (`gone`).
//
// CLOSED. The clip is the press's frames up to `keepAfterSpeechMs` after the last speech frame, never past the closing frame
// (a `phrase` close runs to the segment's end). Segments that began before the close are never checked.

// The words are shared with the server's press door, so they live in the repository's `shared/`, outside `src/`: a relative path,
// the only one `.verify/ears-replay.mjs` (plain Node) can follow.
// oxlint-disable-next-line no-restricted-imports
import { endsWithClose, endsWithHold, opensWithName } from '../../../../shared/wake-words';

/** Every number of the machine, in ms unless the name says frames. */
export const EARS = {
  frameMs: 32, startP: 0.5, keepP: 0.35, endFrames: 20, preRollMs: 320, firstCheckMs: 1600, secondCheckMs: 3200,
  tailCheckMs: 3000, quietMs: 3500, holdMaxMs: 60_000, pressMaxMs: 300_000, herTailMs: 600, keepAfterSpeechMs: 300, ringSeconds: 5,
} as const;

/** Why a press closed: `quiet` (no speech), `phrase` ("over to you"), `limit` (five minutes), `press` (his button), `gone` (the device went away). */
export type EarsCloseCause = 'quiet' | 'phrase' | 'limit' | 'press' | 'gone';

/** What the worker tells the machine: one frame with Silero's probability, Moonshine's words for a check asked earlier, her voice and the talk button's state, and the two ends. */
export type EarsInput =
  | { kind: 'frame'; p: number }
  | { kind: 'heard'; check: number; text: string }
  | { kind: 'her-voice'; sounding: boolean } | { kind: 'button'; recording: boolean }
  | { kind: 'finish' } | { kind: 'disarm' };

/** What the machine asks of the worker: words for frames `[from, to)`, a press that opened at `from`, a press that closed with its clip `[from, to)`. */
export type EarsAction =
  | { kind: 'check'; check: number; purpose: 'name' | 'tail'; from: number; to: number }
  | { kind: 'opened'; from: number }
  | { kind: 'closed'; cause: EarsCloseCause; from: number; to: number };

/** A span of speech: from its first frame to its end (null while it goes on). */
type Segment = { serial: number; start: number; end: number | null; checkable: boolean; asked: number; wantSecond: boolean };

/** Whole frames that cover `ms`, so a rule of "at least this long" never fires early. */
const framesOf = (ms: number) => Math.ceil(ms / EARS.frameMs);
const PRE_ROLL = framesOf(EARS.preRollMs);
const FIRST_CHECK = framesOf(EARS.firstCheckMs);
const SECOND_CHECK = framesOf(EARS.secondCheckMs);
const TAIL_CHECK = framesOf(EARS.tailCheckMs);
const QUIET = framesOf(EARS.quietMs);
const HOLD_MAX = framesOf(EARS.holdMaxMs);
const PRESS_MAX = framesOf(EARS.pressMaxMs);
const HER_TAIL = framesOf(EARS.herTailMs);
const KEEP_AFTER_SPEECH = framesOf(EARS.keepAfterSpeechMs);

/** The machine for her name `name`. After `disarm` it is done: every later input answers no action. */
export function createEarsMachine(name: string): { step(input: EarsInput): EarsAction[]; frame(): number } {
  let phase: 'waiting' | 'open' | 'done' = 'waiting';
  let frames = 0;
  let nextCheck = 1;
  // The segment going on (null between segments), how many have started, and the last frame that was speech.
  let segment: Segment | null = null;
  let serial = 0;
  let lastSpeech = -1;
  // Her voice and the button, as the page last told it: where her voice stopped (null while it has not), and whether a button press records.
  let herSounding = false;
  let herStoppedAt: number | null = null;
  let buttonRecording = false;
  // Segments that began before this frame are never checked: the machine's frame count when the last press closed.
  let waitingSince = 0;
  // The checks out: name checks by their segment; tail checks by the segment they read and where it ended.
  const namePending = new Map<number, Segment>();
  const tailPending = new Map<number, { serial: number; end: number }>();
  // The open press's first frame, and the frame its hold lapses at (null while no hold stands).
  let pressStart = 0;
  let holdUntil: number | null = null;

  const askName = (target: Segment, to: number, actions: EarsAction[]) => {
    // A name check made while a button press records could open nothing: the segment is given up instead.
    if (buttonRecording) {
      target.checkable = false;
      return;
    }
    const check = nextCheck++;
    target.asked += 1;
    namePending.set(check, target);
    actions.push({ kind: 'check', check, purpose: 'name', from: Math.max(target.start - PRE_ROLL, 0), to });
  };

  const askTail = (target: Segment, end: number, actions: EarsAction[]) => {
    const check = nextCheck++;
    tailPending.set(check, { serial: target.serial, end });
    actions.push({ kind: 'check', check, purpose: 'tail', from: Math.max(end - TAIL_CHECK, pressStart), to: end });
  };

  const open = (target: Segment, actions: EarsAction[]) => {
    phase = 'open';
    pressStart = Math.max(target.start - PRE_ROLL, 0);
    holdUntil = null;
    namePending.clear();
    actions.push({ kind: 'opened', from: pressStart });
    // A segment that ended before its name was read (a short "Kaylee, hold on") still owes its tail words to the press.
    if (target.end !== null && target.serial === serial) askTail(target, target.end, actions);
  };

  const close = (cause: EarsCloseCause, actions: EarsAction[], segmentEnd?: number) => {
    const to = segmentEnd ?? Math.min(lastSpeech + 1 + KEEP_AFTER_SPEECH, frames);
    actions.push({ kind: 'closed', cause, from: pressStart, to: Math.max(to, pressStart) });
    phase = 'waiting';
    waitingSince = frames;
    holdUntil = null;
    namePending.clear();
    tailPending.clear();
  };

  /** The rules that close an open press by the clock alone: five minutes, a hold that has lapsed, quiet. */
  const closeIfDue = (actions: EarsAction[]) => {
    if (phase !== 'open') return;
    const last = frames - 1;
    if (last - pressStart >= PRESS_MAX) return close('limit', actions);
    if (holdUntil !== null) {
      if (frames >= holdUntil) close('quiet', actions);
      return;
    }
    const tailOut = [...tailPending.values()].some((pending) => pending.serial === serial);
    if (last - lastSpeech >= QUIET && !tailOut) close('quiet', actions);
  };

  const onFrame = (p: number, actions: EarsAction[]) => {
    const at = frames;
    frames += 1;
    let ended: Segment | null = null;
    if (segment === null) {
      if (p >= EARS.startP) {
        serial += 1;
        const herIsHeard = herSounding || (herStoppedAt !== null && at - herStoppedAt < HER_TAIL);
        segment = { serial, start: at, end: null, checkable: phase === 'waiting' && at >= waitingSince && !herIsHeard && !buttonRecording, asked: 0, wantSecond: false };
        lastSpeech = at;
        holdUntil = null;
      }
    } else if (p >= EARS.keepP) {
      lastSpeech = at;
    } else if (at - lastSpeech >= EARS.endFrames) {
      segment.end = frames;
      ended = segment;
      segment = null;
    }

    const subject = ended ?? segment;
    if (phase === 'waiting' && subject?.checkable) {
      const length = at - subject.start;
      const isOver = subject.end !== null;
      if (subject.asked === 0 && (isOver || length >= FIRST_CHECK)) askName(subject, frames, actions);
      else if (subject.asked === 1 && subject.wantSecond && (isOver || length >= SECOND_CHECK)) askName(subject, frames, actions);
    } else if (phase === 'open' && ended !== null) {
      askTail(ended, frames, actions);
    }
    closeIfDue(actions);
  };

  const onHeard = (check: number, text: string, actions: EarsAction[]) => {
    const tail = tailPending.get(check);
    if (tail !== undefined) {
      tailPending.delete(check);
      if (phase === 'open') {
        // "Over to you, <name>" closes the press at the end of the segment that held it, even if newer speech began while the
        // words were being written (a cough, his next sentence inside the recognizer's latency): the rule has no condition.
        if (endsWithClose(text, name)) return close('phrase', actions, tail.end);
        // A hold lasts only until the next speech starts, so it counts only while this is still the last segment: newer speech
        // has already started it, and a hold set now would outlive that speech and close the press `quiet` over his voice.
        if (tail.serial === serial && endsWithHold(text)) holdUntil = tail.end + HOLD_MAX;
      }
      return closeIfDue(actions);
    }
    const target = namePending.get(check);
    if (target === undefined) return;
    namePending.delete(check);
    if (phase !== 'waiting' || buttonRecording) return;
    const verdict = opensWithName(text, name);
    if (verdict === 'yes') open(target, actions);
    else if (verdict === 'unsure' && target.end === null) target.wantSecond = true;
  };

  return {
    step(input) {
      const actions: EarsAction[] = [];
      if (phase === 'done') return actions;
      switch (input.kind) {
        case 'frame':
          onFrame(input.p, actions);
          break;
        case 'heard':
          onHeard(input.check, input.text, actions);
          break;
        case 'her-voice':
          if (input.sounding) herSounding = true;
          else if (herSounding) {
            herSounding = false;
            herStoppedAt = frames;
          }
          break;
        case 'button':
          buttonRecording = input.recording;
          break;
        case 'finish':
          if (phase === 'open') close('press', actions);
          break;
        case 'disarm':
          if (phase === 'open') close('gone', actions);
          phase = 'done';
          break;
      }
      return actions;
    },
    frame: () => frames,
  };
}
