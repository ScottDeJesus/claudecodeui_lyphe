import { sessionsDb } from '@/modules/database/index.js';
import { buildCloudCliSessionName } from '@/modules/providers/index.js';
import { broadcastSessionUpserted, chatRunRegistry } from '@/modules/websocket/index.js';
import { isSayableName } from '@/shared/sayable-name.js';
import { errorReason } from '@/shared/utils.js';

import { readFirstAndLatestExchange, readFirstExchange } from './exchanges.js';
import { askHaikuForName, askHaikuToKeepOrRename } from './haiku-name.js';

/**
 * The moment every-turn relabelling landed. A chat created at or after it is relabelled at every turn; one created before keeps the
 * one-try naming, because the operator limited the change to chats created after it.
 */
const RELABEL_CHATS_CREATED_FROM = '2026-11-18T17:22:00.000Z';
const RELABEL_CHATS_CREATED_FROM_MS = Date.parse(RELABEL_CHATS_CREATED_FROM);

/** Whether a chat is of the kind relabelled at every turn. An unknown or unreadable creation time is not: it keeps the one-try naming. */
function isRelabelledChat(createdAt: string | null): boolean {
  if (createdAt === null) return false;
  const createdMs = Date.parse(createdAt);
  if (Number.isNaN(createdMs)) return false;
  return createdMs >= RELABEL_CHATS_CREATED_FROM_MS;
}

/** Whether a label is still the placeholder a new chat starts with, or no name a person could say. */
function isPlaceholderLabel(label: string | null, firstAsk: string): boolean {
  // Haiku at low effort kept such labels when asked whether to keep them (measured on the operator's chats, 2026-11-18), so the
  // data decides and the naming question is asked.
  return !isSayableName(label) || label === buildCloudCliSessionName(firstAsk);
}

/**
 * Subscribes the naming pass to every run's end. Consumed by the server entrypoint (`server/index.ts`), which starts it after `listen`
 * and stops it on shutdown.
 *
 * WHY A RUN'S END. A chat's name is wanted when there is something to name it from, and the first turn ending is exactly that moment;
 * `chatRunRegistry.onRunCompleted` already announces it (the queued-message dispatcher rides the same event). Nothing sweeps the table
 * on a timer or at boot — the house names its events, it does not poll — so a chat that already holds a name nobody can say is named
 * at its next turn, not before.
 *
 * THE QUESTIONS EVERY CHAT ANSWERS, cheapest first, asked of a run that was not aborted. Haiku is asked only when all three pass:
 *   1. Is it an app chat that is not archived?                     (`nameFactsOf`: `appCreated`, `isArchived`)
 *   2. Is `name_given` still 0?                                     (a name a person gave is never replaced)
 *   3. Is no pass in flight for it?                                 (claimed synchronously, so two completions never start two passes;
 *                                                                    a turn that ends during a pass is skipped)
 * A project's visibility is no question: a probe chat in the scratch project is named like any other.
 *
 * THE TWO KINDS OF CHAT, told apart by `createdAt` against `RELABEL_CHATS_CREATED_FROM`:
 *   - A chat created at or after the cutoff is asked about at every turn. While its label is a placeholder — its first message's opening
 *     words (`buildCloudCliSessionName`) or a name that fails `isSayableName` — Haiku is asked to name it from its first exchange. Once it
 *     holds a name a pass gave, Haiku reads that label, its first message and its latest exchange at low effort and answers KEEP or a new
 *     name; a keep, a name equal to the current one, or an answer that is no name writes nothing and broadcasts nothing, so a topic that
 *     has not changed costs one call and no churn.
 *   - A chat created before the cutoff keeps the one-try naming: only while its name fails `isSayableName`, from its first exchange, one
 *     Haiku try per chat per process (`attempted`, filled once a first exchange is readable). The attempted set is what keeps a
 *     throwaway folder of chats from costing more than one call each; a restart allows one more try. A chat with nothing to read yet
 *     is asked about again at its next turn.
 *
 * THE WRITE re-reads the row first and writes only while `name_given` is still 0 and the stored name is still the one read before
 * Haiku was asked, so a rename made while Haiku was thinking wins. It goes through `updateSessionCustomName` — never `renameByPerson` —
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
  /** Chats created before the cutoff that Haiku has been asked about in this process: one try each, whatever the answer. */
  const attempted = new Set<string>();
  /** Chats with a pass running now, each with the pass itself so `stop()` can wait for it. */
  const inFlight = new Map<string, Promise<void>>();
  let unsubscribe: (() => void) | null = null;
  let stopController = new AbortController();

  /**
   * Names a chat created before the cutoff, from its first exchange. `readName` is the name read before Haiku was asked, and the write
   * must still find it.
   */
  async function nameChat(sessionId: string, readName: string | null, signal: AbortSignal): Promise<void> {
    const exchange = await readFirstExchange(sessionId);
    if (exchange === null || signal.aborted) return;

    attempted.add(sessionId);
    const name = await askHaikuForName(exchange, signal);
    if (name === null) {
      if (!signal.aborted) console.warn(`[Chat names] ${sessionId} was not named this time; it keeps ${JSON.stringify(readName)}`);
      return;
    }
    if (signal.aborted) return;

    await writeName(sessionId, name, readName);
  }

  /**
   * Names a chat created at or after the cutoff whose label is still a placeholder, from its first exchange. A label a pass already gave
   * is kept or renamed from the first and latest exchanges. It records no try in `attempted`: this kind is asked at every turn, and only
   * a new name is written.
   */
  async function relabelChat(sessionId: string, currentName: string | null, signal: AbortSignal): Promise<void> {
    const exchanges = await readFirstAndLatestExchange(sessionId);
    if (exchanges === null) {
      console.log(`[Chat names] ${sessionId} has no exchange to read yet; it keeps ${JSON.stringify(currentName)}`);
      return;
    }
    if (signal.aborted) return;

    if (isPlaceholderLabel(currentName, exchanges.first.ask)) {
      const name = await askHaikuForName(exchanges.first, signal);
      if (name === null) {
        if (!signal.aborted) console.warn(`[Chat names] ${sessionId} was not named this time; it keeps ${JSON.stringify(currentName)}`);
        return;
      }
      if (signal.aborted) return;
      await writeName(sessionId, name, currentName);
      return;
    }

    const verdict = await askHaikuToKeepOrRename(currentName, exchanges.first, exchanges.latest, signal);
    if (verdict === null) {
      if (!signal.aborted) console.warn(`[Chat names] ${sessionId} was not relabelled this time; it keeps ${JSON.stringify(currentName)}`);
      return;
    }
    if (signal.aborted) return;

    if (verdict.verdict === 'keep') {
      console.log(`[Chat names] kept ${sessionId} ${JSON.stringify(currentName)}: Haiku answered KEEP`);
      return;
    }
    // Haiku repeating the label in other capitals is the same label: writing it would only churn the sidebar.
    if (currentName !== null && verdict.name.toLowerCase() === currentName.toLowerCase()) {
      console.log(`[Chat names] kept ${sessionId} ${JSON.stringify(currentName)}: Haiku answered the same name`);
      return;
    }
    await writeName(sessionId, verdict.name, currentName);
  }

  /**
   * The write, for both kinds of chat. Re-reads the row first: a rename, a person's name or a deletion made while Haiku was thinking
   * wins over the answer.
   */
  async function writeName(sessionId: string, name: string, readName: string | null): Promise<void> {
    // No await between this read and the write below: nothing else in this process can rename the chat in between.
    const facts = sessionsDb.nameFactsOf(sessionId);
    if (facts === null) {
      console.log(`[Chat names] ${sessionId} was deleted while Haiku was answering; ${JSON.stringify(name)} is not written`);
      return;
    }
    if (facts.nameGiven || facts.customName !== readName) {
      console.log(`[Chat names] ${sessionId} was renamed while Haiku was answering; ${JSON.stringify(name)} is not written`);
      return;
    }
    sessionsDb.updateSessionCustomName(sessionId, name);
    console.log(`[Chat names] named ${sessionId} ${JSON.stringify(name)} (was ${JSON.stringify(readName)})`);
    await broadcastSessionUpserted(sessionId).catch((error: unknown) => {
      console.error(`[Chat names] named ${sessionId}, but the sidebar frame could not be sent: ${errorReason(error)}`);
    });
  }

  /**
   * The questions every chat answers, then the pass its kind calls for. All synchronous: the checks and the claim happen in one step,
   * so two completions never start two passes.
   */
  function considerChat(sessionId: string, signal: AbortSignal): void {
    if (signal.aborted) return;
    const facts = sessionsDb.nameFactsOf(sessionId);
    if (facts === null || !facts.appCreated || facts.isArchived) return;
    if (facts.nameGiven) return;
    if (inFlight.has(sessionId)) return;

    let pass: Promise<void>;
    if (isRelabelledChat(facts.createdAt)) {
      pass = relabelChat(sessionId, facts.customName, signal);
    } else {
      if (isSayableName(facts.customName)) return;
      if (attempted.has(sessionId)) return;
      pass = nameChat(sessionId, facts.customName, signal);
    }
    const claimed = pass
      .catch((error: unknown) => {
        console.error(`[Chat names] the pass for ${sessionId} failed; the chat keeps its name: ${errorReason(error)}`);
      })
      .finally(() => {
        inFlight.delete(sessionId);
      });
    inFlight.set(sessionId, claimed);
  }

  return {
    start() {
      if (unsubscribe !== null) return;
      stopController = new AbortController();
      const { signal } = stopController;
      unsubscribe = chatRunRegistry.onRunCompleted((sessionId, { aborted, alreadyRecorded }) => {
        // Not after an abort: the person pressed Stop, and there is no exchange worth naming a chat from.
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
