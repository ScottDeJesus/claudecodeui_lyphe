import type { CompanionMouthPiece } from '@/shared/companion-types.js';

import { pieceCues } from './mouth-cues.js';
import { createPieceCutter, PIECE_RULES, type AudioPiece } from './mouth-pieces.js';
import { rhubarbBinary, runRhubarb, type RhubarbAnswer } from './rhubarb.js';

/**
 * Follows one sentence's audio as it streams from Gemini and announces its timed shapes piece by piece: the seam between the
 * speech door and her exact mouth. HER VOICE NEVER WAITS FOR IT: the door pushes each chunk here after it is in the speech
 * cache and moves on; nothing here is awaited and a defect here is logged and ends this sentence's mouth, never her audio.
 *
 * Each piece the cutter completes (`mouth-pieces.ts`) is analysed at once (`rhubarb.ts`, four at a time server-wide), and its
 * cues (`mouth-cues.ts`) are announced the moment its run ends, in whatever order the pieces finish: an event, never a poll.
 * A piece Rhubarb could not answer is left unannounced, and the page fills that stretch with the level mouth.
 *
 * `end(true)` cuts and analyses what is left. `end(false)` (a cut, a hang-up, a stream that failed) analyses nothing more,
 * announces nothing more and cancels the runs still going. The sentence's own signal and the service's `stopMouth` both
 * cancel every run of a sentence, waiting or running.
 *
 * LOG LINES. One per sentence whose audio ended whole, once its last piece settles:
 * `[companion] mouth <turn>/<index>: <n> of <m> pieces in <ms> ms of Rhubarb, the last <ms> ms after its audio ended`
 * (`<ms> ms of Rhubarb` is the sum of its runs; the last is how long after `end` the final piece settled, 0 when it settled
 * before). A piece that failed or timed out says why, on its own line. Once per PROCESS, for a binary that is not there:
 * `[companion] mouth: Rhubarb is not installed at <path>; her mouth follows her voice level`, and no per-sentence line then.
 *
 * Consumers: `companion-speech.ts` (one follower per synthesized sentence; `service.stopAll` calls `stopMouth`) and
 * `.verify/kaylee-mouth-replay.ts`.
 */

/** What a sentence's follower is made with. `announce` is also told how long the piece's Rhubarb run took, which the speech door ignores and the showing prints. */
type FollowInput = { label: string; signal: AbortSignal; announce(piece: CompanionMouthPiece, rhubarbMs: number): void };

// Every sentence's run controller while its follower lives, so the service's stop reaches them all.
const livingRuns = new Set<AbortController>();

// Whether the "not installed" line was said yet: once per process.
let notInstalledSaid = false;

function sayNotInstalledOnce(): void {
  if (notInstalledSaid) return;
  notInstalledSaid = true;
  console.error(`[companion] mouth: Rhubarb is not installed at ${rhubarbBinary()}; her mouth follows her voice level`);
}

const reasonOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** Follows one sentence's audio as it streams, and announces its timed shapes piece by piece. Consumed by `companion-speech.ts` and the showing. */
export function followMouth({ label, signal, announce }: FollowInput): { push(pcm: Buffer): void; end(complete: boolean): void } {
  const cutter = createPieceCutter();
  // This sentence's runs answer to one controller: the sentence's own signal, `stopMouth` and `end(false)` all abort it.
  const runs = new AbortController();
  livingRuns.add(runs);
  const relayAbort = (): void => runs.abort();
  if (signal.aborted) runs.abort();
  else signal.addEventListener('abort', relayAbort, { once: true });

  // 'streaming' until `end`; then 'complete' (the audio ended whole: settle what is out and say so) or 'abandoned'.
  let phase: 'streaming' | 'complete' | 'abandoned' = 'streaming';
  let piecesCut = 0;
  let piecesAnnounced = 0;
  let piecesPending = 0;
  let rhubarbMs = 0;
  let audioEndedAt = 0;
  let lastSettledAt = 0;
  let binaryMissing = false;
  // Set when the cutter or an announcement threw: this sentence's mouth ends there, her audio does not.
  let broken = false;

  function release(): void {
    livingRuns.delete(runs);
    signal.removeEventListener('abort', relayAbort);
  }

  function sayWhenDone(): void {
    if (phase !== 'complete' || piecesPending > 0) return;
    release();
    if (runs.signal.aborted || binaryMissing || piecesCut === 0) return;
    const afterAudioMs = Math.max(0, lastSettledAt - audioEndedAt);
    console.log(`[companion] mouth ${label}: ${piecesAnnounced} of ${piecesCut} pieces in ${rhubarbMs} ms of Rhubarb, the last ${afterAudioMs} ms after its audio ended`);
  }

  function announcePiece(piece: AudioPiece, answer: Extract<RhubarbAnswer, { ok: true }>): void {
    const timed = pieceCues(answer.answer, piece.from / PIECE_RULES.sampleRate, piece.to / PIECE_RULES.sampleRate);
    if (timed === null) {
      console.error(`[companion] mouth ${label}: Rhubarb's answer for the piece at ${piece.from / PIECE_RULES.sampleRate} s was not usable; her mouth follows her voice level there`);
      return;
    }
    // A cut, a hang-up or the service's stop landed while the run ended: nothing more is announced.
    if (runs.signal.aborted || phase === 'abandoned' || broken) return;
    try {
      announce(timed, answer.ms);
      piecesAnnounced += 1;
    } catch (error) {
      broken = true;
      console.error(`[companion] mouth ${label}: a piece could not be announced`, error);
    }
  }

  function settle(piece: AudioPiece, answer: RhubarbAnswer): void {
    piecesPending -= 1;
    lastSettledAt = Date.now();
    if (answer.ok) {
      rhubarbMs += answer.ms;
      announcePiece(piece, answer);
    } else if (answer.reason === 'missing') {
      binaryMissing = true;
      sayNotInstalledOnce();
    } else if (answer.reason !== 'stopped') {
      console.error(`[companion] mouth ${label}: the piece at ${piece.from / PIECE_RULES.sampleRate} s was left to her voice level: ${answer.sentence}`);
    }
    sayWhenDone();
  }

  /** Starts the piece's run at once; its answer is settled whenever it lands. */
  function analyse(piece: AudioPiece): void {
    piecesCut += 1;
    piecesPending += 1;
    runRhubarb(piece.pcm, runs.signal)
      .then((answer) => settle(piece, answer))
      .catch((error) => {
        // `runRhubarb` answers its failures as values and `settle` guards its announcement: reaching here is a defect, and a rejection nobody reads would stop the server.
        broken = true;
        console.error(`[companion] mouth ${label}: a piece's run threw`, error);
      });
  }

  function analyseAll(pieces: AudioPiece[]): void {
    for (const piece of pieces) analyse(piece);
  }

  return {
    push(pcm) {
      if (phase !== 'streaming' || broken || runs.signal.aborted) return;
      try {
        analyseAll(cutter.push(pcm));
      } catch (error) {
        broken = true;
        console.error(`[companion] mouth ${label}: the audio could not be cut into pieces: ${reasonOf(error)}`);
      }
    },

    end(complete) {
      if (phase !== 'streaming') return;
      if (!complete || broken || runs.signal.aborted) {
        phase = 'abandoned';
        runs.abort();
        release();
        return;
      }
      phase = 'complete';
      audioEndedAt = Date.now();
      try {
        analyseAll(cutter.end());
      } catch (error) {
        broken = true;
        console.error(`[companion] mouth ${label}: the end of the audio could not be cut into pieces: ${reasonOf(error)}`);
      }
      sayWhenDone();
    },
  };
}

/** Cancels every run waiting or running: the service's stop. Consumed by `companion.service.ts`. */
export function stopMouth(): void {
  for (const runs of [...livingRuns]) runs.abort();
  livingRuns.clear();
}
