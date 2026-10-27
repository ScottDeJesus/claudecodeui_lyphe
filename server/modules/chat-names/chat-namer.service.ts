import { sessionsDb } from '@/modules/database/index.js';
import { broadcastSessionUpserted, chatRunRegistry } from '@/modules/websocket/index.js';
import { errorReason } from '@/shared/utils.js';

import { readFirstExchange } from './first-exchange.js';
import { askHaikuForName } from './haiku-name.js';
import { isSayableName } from './sayable-name.js';

/**
 * Subscribes the naming pass to every run's end. Consumed by the server entrypoint (`server/index.ts`), which starts it after `listen`
 * and stops it on shutdown.
 *
 * WHY A RUN'S END. A chat's name is wanted when there is something to name it from, and the first turn ending is exactly that moment;
 * `chatRunRegistry.onRunCompleted` already announces it (the queued-message dispatcher rides the same event). Nothing sweeps the table
 * on a timer or at boot — the house names its events, it does not poll — so a chat that already holds a name nobody can say is named
 * at its next turn, not before.
 *
 * THE FIVE QUESTIONS, cheapest first, asked of a run that was not aborted. Haiku is asked only when all five pass:
 *   1. Is it an app chat that is not archived?                      (`nameFactsOf`: `appCreated`, `isArchived`)
 *   2. Is `name_given` still 0?                                      (a name a person gave is never replaced)
 *   3. Does its current name fail `isSayableName`?                   (a name he could say aloud stays)
 *   4. Is it neither in flight nor already tried by this process?    (two in-memory sets)
 *   5. Does its transcript hold a first exchange?                    (`readFirstExchange`)
 * A project's visibility is no question: a probe chat in the scratch project is named like any other. The attempted set is what keeps
 * a throwaway folder of chats from costing more than one call each; every chat gets one try per server process, and a restart allows
 * one more. The set is filled at question 5's yes — a chat with nothing to read yet is asked about again at its next turn.
 *
 * THE WRITE re-reads the row first and writes only while `name_given` is still 0 and the stored name is still the one that failed
 * question 3, so a rename made while Haiku was thinking wins. It goes through `updateSessionCustomName` — never `renameByPerson` —
 * because the mark means a person typed the name, and then `broadcastSessionUpserted`, the frame the sidebar, the simple list, the
 * floating chat's picker, the notifications and Kaylee's roster already redraw on.
 *
 * A completion the registry marks `alreadyRecorded` (a host re-adopted after a restart, whose turn ended before it) is no turn at all, so
 * the pass leaves it: nothing is named at a boot, a handover included, only at a turn.
 *
 * The listener answers synchronously and begins its work on a microtask, so a run's completion is never held. `stop()` unsubscribes,
 * aborts every pass in flight (the Haiku child ends with it) and answers once they have settled.
 */
export function createChatNamer(): { start(): void; stop(): Promise<void> } {
  /** Chats Haiku has been asked about in this process: one try each, whatever the answer. */
  const attempted = new Set<string>();
  /** Chats with a pass running now, each with the pass itself so `stop()` can wait for it. */
  const inFlight = new Map<string, Promise<void>>();
  let unsubscribe: (() => void) | null = null;
  let stopController = new AbortController();

  /** Questions 5 onward, for a chat that passed 1 to 4; `failedName` is what question 3 read and the write must still find. */
  async function nameChat(sessionId: string, failedName: string | null, signal: AbortSignal): Promise<void> {
    const exchange = await readFirstExchange(sessionId);
    if (exchange === null || signal.aborted) return;

    attempted.add(sessionId);
    const name = await askHaikuForName(exchange, signal);
    if (name === null) {
      if (!signal.aborted) console.warn(`[Chat names] ${sessionId} was not named this time; it keeps ${JSON.stringify(failedName)}`);
      return;
    }
    if (signal.aborted) return;

    // No await between this read and the write below: nothing else in this process can rename the chat in between.
    const facts = sessionsDb.nameFactsOf(sessionId);
    if (facts === null) {
      console.log(`[Chat names] ${sessionId} was deleted while Haiku was answering; ${JSON.stringify(name)} is not written`);
      return;
    }
    if (facts.nameGiven || facts.customName !== failedName) {
      console.log(`[Chat names] ${sessionId} was renamed while Haiku was answering; ${JSON.stringify(name)} is not written`);
      return;
    }
    sessionsDb.updateSessionCustomName(sessionId, name);
    console.log(`[Chat names] named ${sessionId} ${JSON.stringify(name)} (was ${JSON.stringify(failedName)})`);
    await broadcastSessionUpserted(sessionId).catch((error: unknown) => {
      console.error(`[Chat names] named ${sessionId}, but the sidebar frame could not be sent: ${errorReason(error)}`);
    });
  }

  /** Questions 1 to 4, all synchronous: they run and claim the chat in one step, so two completions never start two passes. */
  function considerChat(sessionId: string, signal: AbortSignal): void {
    if (signal.aborted) return;
    const facts = sessionsDb.nameFactsOf(sessionId);
    if (facts === null || !facts.appCreated || facts.isArchived) return;
    if (facts.nameGiven) return;
    if (isSayableName(facts.customName)) return;
    if (attempted.has(sessionId) || inFlight.has(sessionId)) return;

    const pass = nameChat(sessionId, facts.customName, signal)
      .catch((error: unknown) => {
        console.error(`[Chat names] the pass for ${sessionId} failed; the chat keeps its name: ${errorReason(error)}`);
      })
      .finally(() => {
        inFlight.delete(sessionId);
      });
    inFlight.set(sessionId, pass);
  }

  return {
    start() {
      if (unsubscribe !== null) return;
      stopController = new AbortController();
      const { signal } = stopController;
      unsubscribe = chatRunRegistry.onRunCompleted((sessionId, { aborted, alreadyRecorded }) => {
        // Not after an abort: the person pressed Stop, and there is no first exchange worth naming a chat from.
        // Not for a turn that ended before this process began: that is a restart's re-adoption, and a restart names nothing.
        if (aborted || alreadyRecorded) return;
        queueMicrotask(() => {
          try {
            considerChat(sessionId, signal);
          } catch (error) {
            console.error(`[Chat names] could not consider ${sessionId}: ${errorReason(error)}`);
          }
        });
      });
    },

    async stop() {
      unsubscribe?.();
      unsubscribe = null;
      stopController.abort();
      await Promise.allSettled([...inFlight.values()]);
    },
  };
}
