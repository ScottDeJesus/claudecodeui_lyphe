import { companionTranscriptPath } from './companion-launch.js';
import { makeHandover, type LastWords } from './companion-handover.js';
import type { CompanionSessionDeps, HeldSession } from './companion-session-types.js';

/**
 * The refused resume: a held CLI conversation whose shape (`companion-shape.ts`: her tools and her prompt) is not the launch's own is
 * not continued. It is forgotten at once, the panel says so once, and she starts fresh; the CLI keeps a conversation's tools and prompt
 * as they were when it began, so a resume would hand her yesterday's. Two forms, by whether there is a thread to hand over:
 *   - BARE (`bare`): nothing of the conversation is on disk, so the id is forgotten and the line is said, synchronously, in the launch's own call.
 *   - WITH A HANDOVER (`withThread`, `withHandover`): her thread is on disk, so the summarizer writes a few lines of it first
 *     (`companion-handover.ts`, up to a bound), the text goes on her row, THEN the conversation is forgotten and the panel says so. In that
 *     order: a crash between the two leaves the conversation held and the next boot writes it again, never a forgotten conversation whose
 *     handover is lost. Whatever the summarizer does, the refusal is carried out; a handover that could not be written is a different
 *     sentence and a journal line. Her memory (the docstore bank) is not the conversation's and is never touched.
 * The wait for the summarizer is the gate's (`companion-handover-gate.ts`).
 *
 * Consumers: `session/companion-session.ts`, one per account's conversation.
 */

/** What her panel says when a held conversation is not resumed because its shape is not today's and there is no thread of it to hand over. */
const SHAPE_CHANGED_LINE = 'Her tools or her prompt changed, so she starts fresh; she keeps her memory.';
/** The same refusal when the summarizer wrote a handover of the thread for her first message. */
const SHAPE_CHANGED_HANDOVER_LINE = 'Her tools or her prompt changed, so she starts fresh with a handover of what you were discussing; she keeps her memory.';
/** The same refusal when a handover was tried and could not be written: the cause is in the journal. */
const HANDOVER_FAILED_LINE = 'Her tools or her prompt changed, so she starts fresh, and the handover of what you were discussing could not be written; she keeps her memory.';

/** What `createRefusal` answers; the session holds one. */
type Refusal = {
  /** The refusal with no thread to hand over: journaled, the conversation forgotten, one line on the panel. */
  bare(held: HeldSession): void;
  /** The held conversation the next launch will refuse when its thread is on disk to be handed over, else `null`. */
  withThread(): HeldSession | null;
  /** The refusal of `held` carried out with its handover; never rejects; carries out nothing when `signal` aborts (Clear, a shutdown). */
  withHandover(held: HeldSession, signal: AbortSignal): Promise<void>;
};

/**
 * `currentShape` is the shape of a launch made now, `forget` empties the held conversation (id and shape together) and `say` puts a line
 * on her panel. The rest is read from `deps`. Consumed by `companion-session.ts`.
 */
export function createRefusal(
  userId: number,
  deps: Pick<CompanionSessionDeps, 'readProviderSession' | 'readSettings' | 'writeHandover' | 'readLastWords'>,
  doing: { currentShape(): string; forget(): void; say(line: string): void }
): Refusal {
  /** The journal line of a held conversation that is not resumed because its shape is not the launch's own. */
  function journal(held: HeldSession): void {
    console.log(
      `[Companion] account ${userId}: not resuming session ${held.id}: ${held.shape === null ? 'no shape held (it began before shapes were kept)' : 'shape changed (her tools or her prompt are not what it began with)'}; she starts fresh`
    );
  }

  /** The newest exchange of her log, which the summarizer is not shown; a log that cannot be read is none, so the handover is still written. */
  function readLastWords(): LastWords | null {
    try {
      return deps.readLastWords();
    } catch (error) {
      console.error(`[Companion] account ${userId}: her newest exchange could not be read for the handover`, error);
      return null;
    }
  }

  return {
    bare(held) {
      journal(held);
      doing.forget();
      doing.say(SHAPE_CHANGED_LINE);
    },

    withThread() {
      const held = deps.readProviderSession();
      if (held === null || held.shape === doing.currentShape()) return null;
      return companionTranscriptPath(userId, held.id) === null ? null : held;
    },

    async withHandover(held, signal) {
      let stored = false;
      try {
        const settings = deps.readSettings();
        const outcome = await makeHandover({ userId, sessionId: held.id, operatorName: settings.operatorName, name: settings.name, last: readLastWords(), signal });
        if (signal.aborted) return;
        if (outcome.kind === 'written') {
          deps.writeHandover(outcome.text);
          stored = true;
        }
      } catch (error) {
        if (signal.aborted) return;
        console.error(`[Companion] account ${userId}: the handover of session ${held.id} could not be made or kept`, error);
      }
      journal(held);
      doing.forget();
      doing.say(stored ? SHAPE_CHANGED_HANDOVER_LINE : HANDOVER_FAILED_LINE);
    },
  };
}
