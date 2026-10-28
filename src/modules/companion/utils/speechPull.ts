import type { PcmPlayer } from '@/modules/companion/utils/pcmPlayer';
import { api } from '@/shared/api';
import type { CompanionLogEntry, CompanionPicture } from '@/shared/companion-types';
import type { CompanionSentenceRef } from '@/shared/types';

/** A sentence asked for and not yet sounding: its request may be in flight, or (`enqueued`) its body already handed to the player, queued behind the one playing. */
type Pending = { turnId: string; index: number; controller: AbortController; enqueued: boolean };

/** Where the pull stands in one turn. `stopped` ends it for the turn (a refusal, a cut, a floor that moved), never for the next turn. */
type Pull = { turnId: string | null; next: number; stopped: boolean; pending: Pending | null };

/** The smallest index at or after `from` that the turn's log holds a sentence for, or null: the next sentence whose frame has arrived. */
function nextSentenceIndex(log: CompanionLogEntry[], turnId: string, from: number): number | null {
  let found: number | null = null;
  for (const entry of log) {
    if (entry.role !== 'kaylee' || entry.turnId !== turnId || entry.index === null || entry.index < from) continue;
    if (found === null || entry.index < found) found = entry.index;
  }
  return found;
}

/** Whether a response says it carries her voice: the speech door's `audio/l16; rate=24000; channels=1`. */
function isPcm(response: Response): boolean {
  return (response.headers.get('content-type') ?? '').toLowerCase().startsWith('audio/l16');
}

/** The turn of the newest sentence in the log, or null when it holds none. */
function newestSentenceTurn(log: CompanionLogEntry[]): string | null {
  for (let at = log.length - 1; at >= 0; at -= 1) {
    const entry = log[at];
    if (entry.role === 'kaylee' && entry.turnId !== null && entry.index !== null) return entry.turnId;
  }
  return null;
}

/** One past the highest sentence index the log holds for `turnId`: where a page that joins the turn begins. */
function afterLastSentence(log: CompanionLogEntry[], turnId: string): number {
  let after = 0;
  for (const entry of log) {
    if (entry.role === 'kaylee' && entry.turnId === turnId && entry.index !== null) after = Math.max(after, entry.index + 1);
  }
  return after;
}

/**
 * Used by this module's useCompanionVoice, which makes one per page and drives it: THE PULL, off the page. It asks the speech
 * door for one sentence at a time and hands each body to the player. Plain closures over the player and the status setter,
 * so the async answers and the player's events (the loop's only clocks) never see a stale render.
 *
 * Sentence k is asked for as soon as its frame (a kaylee row of the picture's log) has arrived and nothing is asked for and
 * waiting to sound: at once when the player is idle, otherwise when k-1 starts. A page that joins a turn mid-way starts with
 * the next sentence whose frame arrives. A 204 and any 5xx are skipped; a 409 (refused, or not the floor), a 404 and any other
 * refusal end the pull for the turn; a new running turn resets it; a re-seeded picture leaves it where it was. While his mic is
 * open (from `cutOff` to `release`) nothing is asked for.
 */
export function createSpeechPull(player: PcmPlayer, setSpeaking: (sentence: CompanionSentenceRef | null) => void) {
  // Null while the page does not hold the floor with its voice on; the pull does nothing then.
  let pull: Pull | null = null;
  // The latest picture the page folded: its log is what says which sentences have arrived.
  let seen: CompanionPicture | null = null;
  // True from the talk press that opens his mic until the press that ends it: nothing is asked for while he records, so her voice
  // never goes into his clip. Held by the engine and not by a turn's pull, so a turn that begins while he records is held too.
  let held = false;

  /** Speaking ends only when the player is silent AND nothing is on its way: a sentence's `end` and the next one's `start` are two callbacks, and nulling between them would blink. */
  function settleSpeaking(): void {
    if (player.playing() === null && pull?.pending == null) setSpeaking(null);
  }

  /** Lets go of what is asked for. A request still in flight is hung up (the server stops its synthesis); a body the player already holds is the player's to stop or finish. */
  function hangUp(): void {
    if (pull?.pending == null) return;
    if (!pull.pending.enqueued) pull.pending.controller.abort();
    pull.pending = null;
  }

  /** Begins a turn's pull at `next`; whatever was asked for the turn before is hung up, what it already queued plays out. */
  function follow(turnId: string | null, next: number): void {
    hangUp();
    pull = { turnId, next, stopped: false, pending: null };
  }

  /** Reads one answer. A sentence that is not played is skipped (204, any 5xx, a request that failed); a refusal or a turn that is gone ends the pull for the turn. */
  function answer(asked: Pending, response: Response): void {
    const current = pull;
    // Hung up meanwhile (a cut, the floor moving, a new turn): the body is not wanted.
    if (current === null || current.pending !== asked) {
      void response.body?.cancel();
      return;
    }
    // A 200 that is not PCM (a proxy's or a captive portal's page) would sound as static: it is skipped like a failure.
    if (response.status === 200 && response.body !== null && isPcm(response)) {
      current.next = asked.index + 1;
      // Stays pending until the player starts it: the next sentence is asked for then, and not before.
      asked.enqueued = true;
      player.enqueue(asked.turnId, asked.index, response.body);
      return;
    }
    current.pending = null;
    if (response.status === 204 || response.status >= 500 || response.status === 200) {
      current.next = asked.index + 1;
      void response.body?.cancel();
      if (response.status !== 204) console.warn(`[Companion] Her sentence ${asked.turnId}/${asked.index} could not be spoken (${response.status}); skipping it.`);
    } else {
      // 409 COMPANION_SPEECH_REFUSED (the server has written the panel's line), 409 COMPANION_NOT_FLOOR (the floor frame is on its way),
      // 404 (the turn is over or cleared), or a refusal that would repeat for every sentence: nothing more is asked this turn.
      current.stopped = true;
      if (response.status !== 409 && response.status !== 404) console.warn(`[Companion] Her voice was refused (${response.status}); not asking for more of this turn.`);
    }
    settleSpeaking();
    pump();
  }

  function failed(asked: Pending, failure: unknown): void {
    if (pull === null || pull.pending !== asked) return;
    console.warn(`[Companion] Her sentence ${asked.turnId}/${asked.index} could not be asked for; skipping it:`, failure);
    pull.pending = null;
    pull.next = asked.index + 1;
    settleSpeaking();
    pump();
  }

  /** She is to be quiet but the page still holds the floor (Stop, Clear, a cut): what plays stops, nothing more of the turn is asked. */
  function silence(): void {
    hangUp();
    if (pull !== null) pull.stopped = true;
    player.stop();
    setSpeaking(null);
  }

  /** Asks for the next sentence when its frame has arrived and nothing is asked for and waiting to sound. */
  function pump(): void {
    if (held || pull === null || seen === null || pull.stopped || pull.turnId === null || pull.pending !== null) return;
    const index = nextSentenceIndex(seen.log, pull.turnId, pull.next);
    if (index === null) return;
    const asked: Pending = { turnId: pull.turnId, index, controller: new AbortController(), enqueued: false };
    pull.pending = asked;
    api.companion.speech(asked.turnId, asked.index, asked.controller.signal).then(
      (response) => answer(asked, response),
      (failure: unknown) => failed(asked, failure),
    );
  }

  return {
    /** The page folded a picture: a new running turn resets the pull; a sentence that arrived is asked for when it is its turn. */
    see(picture: CompanionPicture): void {
      seen = picture;
      if (pull === null) return;
      if (picture.turnId !== null) {
        if (picture.turnId !== pull.turnId) follow(picture.turnId, 0);
      } else {
        // No turn is running. One the page never followed (it began and ended while the socket was down) is not read out late.
        const newest = newestSentenceTurn(picture.log);
        if (newest !== null && newest !== pull.turnId) follow(newest, afterLastSentence(picture.log, newest));
      }
      pump();
    },

    /** The page holds the floor with its voice on. A turn already running is joined at its next frame, not its first. */
    arm(): void {
      const turnId = seen?.turnId ?? (seen === null ? null : newestSentenceTurn(seen.log));
      follow(turnId, seen === null || turnId === null ? 0 : afterLastSentence(seen.log, turnId));
      pump();
    },

    /** The floor moved on, the switch went off or the page is going: silence at once and ask for nothing. */
    disarm(): void {
      hangUp();
      pull = null;
      player.stop();
      setSpeaking(null);
    },

    silence,

    /**
     * The press that opens his mic. It holds the pull (nothing is asked for until `release`, so a turn she is still thinking
     * through does not speak into his clip). When a sentence is sounding or on its way it also stops it all and POSTs the cut:
     * `heard` is the last sentence of that turn whose playback ended, `interrupted` the one playing. Answers the POST's settling
     * (never rejecting), or null when there was nothing to cut.
     */
    cutOff(): Promise<void> | null {
      held = true;
      const playing = player.playing();
      const waiting = pull?.pending ?? null;
      if (playing === null && waiting === null) return null;
      const turnId = playing?.turnId ?? waiting?.turnId ?? pull?.turnId ?? null;
      if (turnId === null) return null;
      const ended = player.lastEnded();
      const heard = ended !== null && ended.turnId === turnId ? ended.index : null;
      const interrupted = playing !== null && playing.turnId === turnId ? playing.index : null;
      silence();
      return api.companion.cut({ turnId, heard, interrupted }).then(
        (response) => {
          if (!response.ok) console.warn(`[Companion] The cut was refused (${response.status}).`);
        },
        (failure: unknown) => console.warn('[Companion] The cut could not be sent:', failure),
      );
    },

    /**
     * The press that ends his recording (or a mic that never opened): the pull is asked again. What she said while his mic was open
     * is not read out afterwards, since he talked over it; her answer to him is a sentence whose frame arrives after this. (His
     * message may be folded into the turn she is in, so the turn is not silenced for good.)
     */
    release(): void {
      if (!held) return;
      held = false;
      if (pull !== null && pull.turnId !== null && seen !== null) pull.next = Math.max(pull.next, afterLastSentence(seen.log, pull.turnId));
      pump();
    },

    /** The player's word on a sentence: its start frees the pull to ask for the next, and the band moves to it. */
    onSentence(event: { turnId: string; index: number; phase: 'start' | 'end' }): void {
      if (event.phase === 'end') {
        settleSpeaking();
        return;
      }
      if (pull?.pending?.turnId === event.turnId && pull.pending.index === event.index) pull.pending = null;
      setSpeaking({ turnId: event.turnId, index: event.index });
      pump();
    },
  };
}
