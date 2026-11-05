import type { PcmPlayer } from '@/modules/companion/utils/pcmPlayer';
import { api } from '@/shared/api';
import type { CompanionLogEntry, CompanionPicture } from '@/shared/companion-types';
import type { CompanionSentenceRef } from '@/shared/types';

/** A sentence asked for and not yet sounding: its request may be in flight, or (`enqueued`) its body already handed to the player, queued behind the one playing. */
type Pending = { turnId: string; index: number; controller: AbortController; enqueued: boolean };

/** Where the pull stands in one turn. `stopped` ends it for the turn (a refusal, a cut, a floor that moved), never for the next turn. `asked` is true once any sentence of it has been asked for. */
type Pull = { turnId: string | null; next: number; stopped: boolean; pending: Pending | null; asked: boolean };

/** A turn waiting behind the one being heard, and the index its first sentence to speak has (a turn put back before it was begun keeps the place it was joined at). */
type Queued = { turnId: string; from: number };

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

/** How old the newest sentence of a turn the page never saw begin may be and still be owed to it: a socket that was down for a restart or a flap owes what she said meanwhile, a page that slept an hour owes nothing. */
const OWED_MAX_AGE_MS = 60_000;

/**
 * The turns `after` (the log the page holds now) owes it a sentence of that it has not been given, oldest first, each with the index to
 * speak from, and whose newest owed sentence is at most `OWED_MAX_AGE_MS` old on the page's clock at `now`. Two kinds:
 *  - a turn `before` (the log the page held a moment ago) holds no row of, from its first sentence: it began and ended, or began,
 *    without the page seeing it begin. A re-seed after a socket gap is how that happens, and so is a turn's start, sentences and end
 *    folding into one render. A turn is told apart by its id, so a Clear (which empties the log) never makes an old turn look new.
 *  - a turn the pull moved on from while it ran (`resumable`: turn → the index still owed), from that index: the page heard part of it,
 *    and the rest reached the picture only with the re-seed.
 */
function owedTurns(after: CompanionLogEntry[], before: CompanionLogEntry[], resumable: ReadonlyMap<string, number>, now: number): Queued[] {
  const known = new Set<string>();
  for (const entry of before) {
    if (entry.turnId !== null) known.add(entry.turnId);
  }
  const turns = new Map<string, { from: number; firstId: number; newestAt: number }>();
  for (const entry of after) {
    if (entry.role !== 'kaylee' || entry.turnId === null || entry.index === null) continue;
    const from = known.has(entry.turnId) ? resumable.get(entry.turnId) : 0;
    if (from === undefined || entry.index < from) continue;
    const at = Date.parse(entry.at);
    const owedTurn = turns.get(entry.turnId);
    // An unreadable stamp counts as old: a sentence the page cannot date is not read out late.
    turns.set(entry.turnId, {
      from,
      firstId: Math.min(owedTurn?.firstId ?? entry.id, entry.id),
      newestAt: Math.max(owedTurn?.newestAt ?? 0, Number.isFinite(at) ? at : 0),
    });
  }
  return [...turns]
    .filter(([, turn]) => now - turn.newestAt <= OWED_MAX_AGE_MS)
    .sort(([, left], [, right]) => left.firstId - right.firstId)
    .map(([turnId, turn]) => ({ turnId, from: turn.from }));
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

/** The id of the turn's first sentence in the log, which orders turns as she said them; `Infinity` for a turn the log holds no sentence of yet (a running one), which is later than any that has. */
function firstSentenceId(log: CompanionLogEntry[], turnId: string): number {
  let first = Infinity;
  for (const entry of log) {
    if (entry.role === 'kaylee' && entry.turnId === turnId && entry.index !== null) first = Math.min(first, entry.id);
  }
  return first;
}

/**
 * Used by this module's useCompanionVoice, which makes one per page and drives it: THE PULL, off the page. It asks the speech
 * door for one sentence at a time and hands each body to the player. Plain closures over the player and the status setter,
 * so the async answers and the player's events (the loop's only clocks) never see a stale render.
 *
 * Sentence k is asked for as soon as its frame (a kaylee row of the picture's log) has arrived and nothing is asked for and
 * waiting to sound: at once when the player is idle, otherwise when k-1 starts. A page that joins a turn mid-way starts with
 * the next sentence whose frame arrives. A 204 and any 5xx are skipped; a 409 (refused, or not the floor), a 404 and any other
 * refusal end the pull for the turn. A turn that begins while another is being heard (an alert pushed while she speaks) is
 * QUEUED, never followed at once: the heard turn's remaining sentences are asked for first, and the queued turn is spoken
 * from its first sentence after the heard one's last, so a turn ending, or a 404/409 ending it, hands the pull on to the
 * queue. Only a cut, Stop, Clear, the floor moving or the switch going off empties the queue. A re-seeded picture leaves the
 * pull where it was and owes the page the turns it holds that the page never saw begin, and the rest of a turn the pull moved on
 * from before it was finished (a restart's successor answers inside the socket's 3 s reconnect, and a socket that moves to the
 * successor mid-drain gets the retiring server's turn with the re-seed), so what she said in the gap is spoken in the order she said
 * it and never twice: a turn older than the one being heard goes ahead of it while nothing of that one has been asked for, any other
 * waits behind it, and each sentence is asked for once, by its turn and index. While his mic is open (from `cutOff` to `release`) nothing is asked for.
 */
export function createSpeechPull(player: PcmPlayer, setSpeaking: (sentence: CompanionSentenceRef | null) => void) {
  // Null while the page does not hold the floor with its voice on; the pull does nothing then.
  let pull: Pull | null = null;
  // The latest picture the page folded: its log is what says which sentences have arrived.
  let seen: CompanionPicture | null = null;
  // True from the talk press that opens his mic until the press that ends it: nothing is asked for while he records, so her voice
  // never goes into his clip. Held by the engine and not by a turn's pull, so a turn that begins while he records is held too.
  let held = false;
  // The turns that began while the pull's turn is still being spoken, oldest first: each is followed from its first sentence once the one before has nothing left to ask.
  const queued: Queued[] = [];
  // The turns the pull moved on from while the page still believed them running, each with the index it still owed: a picture that later holds more of such a turn (the page's socket moved to a server that does not know the turn runs, and the re-seed brings the rest) owes the page those sentences. Emptied by whatever empties the queue.
  const resumable = new Map<string, number>();

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

  /** Moves the pull onto a turn at `next`: called once the turn before has nothing left to ask, or to skip what landed while his mic was open. A request still in flight for the turn before is hung up, what the player already holds plays out. */
  function follow(turnId: string | null, next: number): void {
    hangUp();
    if (turnId !== null) resumable.delete(turnId);
    pull ={ turnId, next, stopped: false, pending: null, asked: false };
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
      // 404 (the sentence is unknown, cleared or too old to speak), or a refusal that would repeat for every sentence: nothing more is asked this turn.
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

  /**
   * She is to be quiet but the page still holds the floor (Stop, Clear, a cut): what plays stops, the queue is emptied and nothing
   * more of the turn is asked. A turn running other than the pull's is the one his Stop or press interrupts, so the pull hops
   * onto it stopped and its sentences are not read out either.
   */
  function silence(): void {
    hangUp();
    queued.length = 0;
    resumable.clear();
    if (pull !== null) {
      const running = seen?.turnId ?? null;
      if (running !== null && running !== pull.turnId) pull = { turnId: running, next: 0, stopped: true, pending: null, asked: false };
      else pull.stopped = true;
    }
    player.stop();
    setSpeaking(null);
  }

  /**
   * Asks for the next sentence of the pull's turn when its frame has arrived and nothing is asked for and waiting to sound. When
   * that turn is spoken to its end (or stopped for good) the pull moves on to the oldest queued turn, from its first sentence.
   */
  function pump(): void {
    if (held || pull === null || seen === null || pull.pending !== null) return;
    if (!pull.stopped && pull.turnId !== null) {
      const index = nextSentenceIndex(seen.log, pull.turnId, pull.next);
      if (index !== null) {
        const asked: Pending = { turnId: pull.turnId, index, controller: new AbortController(), enqueued: false };
        pull.pending = asked;
        pull.asked = true;
        api.companion.speech(asked.turnId, asked.index, asked.controller.signal).then(
          (response) => answer(asked, response),
          (failure: unknown) => failed(asked, failure),
        );
        return;
      }
      // Still running: its next frame is on its way, and a queued turn waits for it.
      if (seen.turnId === pull.turnId) return;
    }
    const next = queued.shift();
    if (next === undefined) return;
    // The turn left behind may still be running where the page cannot see it: what it says later is owed from here (`resumable`).
    if (pull.turnId !== null && !pull.stopped) resumable.set(pull.turnId, pull.next);
    follow(next.turnId, next.from);
    pump();
  }

  /**
   * A turn the page is owed, spoken from sentence `from`: placed in the queue where she said it (by its first sentence's id in `log`, a turn
   * with none yet last). One that is older than the turn being heard, when nothing of that turn has been asked for yet (it was followed from
   * its start frame, and the sentences that came before it arrived with a re-seed), goes ahead of it: that turn is put back at the place
   * it was joined and the pull moves onto the older one, so the page speaks them in the order she did.
   */
  function owe(turnId: string, log: CompanionLogEntry[], from = 0): void {
    if (pull === null || pull.turnId === turnId || queued.some((entry) => entry.turnId === turnId)) return;
    resumable.delete(turnId);
    const first = firstSentenceId(log, turnId);
    if (pull.turnId !== null && !pull.asked && !pull.stopped && first < firstSentenceId(log, pull.turnId)) {
      queued.unshift({ turnId: pull.turnId, from: pull.next });
      follow(turnId, from);
      return;
    }
    const at = queued.findIndex((entry) => firstSentenceId(log, entry.turnId) > first);
    queued.splice(at === -1 ? queued.length : at, 0, { turnId, from });
  }

  return {
    /**
     * The page folded a picture: a new running turn is queued behind the one being heard, and a sentence that arrived is asked for when it is its turn.
     * A turn the page never saw begin but whose sentences the picture holds (it began and ended while the socket was down, and the re-seed brought it) is owed
     * too, and so is the rest of a turn the pull moved on from before it was finished (`owedTurns`): queued where she said it, oldest first, and spoken from
     * its first sentence or from the one still owed. One that is old (`OWED_MAX_AGE_MS`) is not read out late.
     */
    see(picture: CompanionPicture): void {
      const before = seen;
      seen = picture;
      if (pull === null) return;
      if (before !== null) {
        for (const owed of owedTurns(picture.log, before.log, resumable, Date.now())) owe(owed.turnId, picture.log, owed.from);
      }
      if (picture.turnId !== null) owe(picture.turnId, picture.log);
      pump();
    },

    /** The page holds the floor with its voice on. A turn already running is joined at its next frame, not its first. */
    arm(): void {
      queued.length = 0;
      resumable.clear();
      const turnId = seen?.turnId ?? (seen === null ? null : newestSentenceTurn(seen.log));
      follow(turnId, seen === null || turnId === null ? 0 : afterLastSentence(seen.log, turnId));
      pump();
    },

    /** The floor moved on, the switch went off or the page is going: silence at once and ask for nothing. */
    disarm(): void {
      hangUp();
      queued.length = 0;
      resumable.clear();
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
     * is not read out afterwards, since he talked over it, a turn that began meanwhile included: the pull lands on the newest
     * turn after its last sentence, and her answer to him is a sentence whose frame arrives after this. (His message may be
     * folded into the turn she is in, so the turn is not silenced for good.)
     */
    release(): void {
      if (!held) return;
      held = false;
      const last = queued.length > 0 ? queued[queued.length - 1].turnId : (pull?.turnId ?? null);
      queued.length = 0;
      resumable.clear();
      if (pull !== null && seen !== null && last !== null) {
        if (last !== pull.turnId) follow(last, afterLastSentence(seen.log, last));
        else pull.next = Math.max(pull.next, afterLastSentence(seen.log, last));
      }
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
