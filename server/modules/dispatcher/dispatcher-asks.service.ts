import type { DispatcherAsk, DispatcherStateEvent, ProviderPermissionDecision, ProviderRuntimePermissionGateway, ProviderRuntimeRecalledPrompt } from '@/shared/types.js';

import { REWORK_OPTION, readReply } from './dispatcher-answer.service.js';
import type { AnswerDoor, AskReply } from './dispatcher-answer.service.js';
import { askedPlanOf, doorOfKey, isAskKey, keyOf, requestIdOf } from './dispatcher-ask-names.service.js';

/**
 * The prompts this lane has up in chats: a PROJECTION of the store's open asks onto the question
 * panel, the phone, and the sidebar's waiting mark.
 *
 * THE STORE HOLDS THE ASK AND NAMES IT (`dispatcher-ask-names.service.ts`); THIS FILE KEEPS A BOOK OF
 * WHAT THIS PROCESS HAS PUT UP, AND NOTHING ELSE. Every plan of the picture carries `asking` — the
 * prompt the app has put up for it and is still waiting on
 * (`hooks/dispatcher/ask.py`) — and each distinct one is shown in its plan's owning chat exactly as an
 * `AskUserQuestion` is: a `permission_request` frame to every socket, a `permission.required` push
 * (its buttons included), and a place in `chat_subscribed`'s `pendingPermissions` through the
 * permission gateway below. A restart, a handover's second server and a reopened tab all read the
 * same asks back off the store, which is what makes the prompt stay up until it is answered, whatever
 * the chat is doing: idle, mid-reply or closed.
 *
 * STANDALONE, and the client is told so on the frame: no transcript row carries this ask and no run
 * owns it, so it is drawn above the composer rather than inline, it marks no session busy, and no
 * run's `complete` retracts it (`useChatRealtimeHandlers.ts`).
 *
 * THE ASK'S NAME IS THE ASK (`keyOf`, and the panel's `requestIdOf`): the store's own record of it, the
 * `asked` event — for an Accept with its lock token, the census the operator is shown. The event is new
 * for every landing (a re-cut after a Rework rewrites phase goals the token does not digest, and its
 * fresh prompt must buzz the phone and ring the tab like the first), and an Accept's is its LEAD plan's
 * (`ask.asking`), so one arc's lock carried on every plan it names is ONE prompt; a model press or a
 * re-worded goal moves the token and is a new one too (the old is retracted, the new raised). Both
 * names are the same in every process, so a handover neither buzzes the phone (`ntfy-pushed-prompts
 * .service.ts` keys on it) nor rings the tab again (`announceOnce`), and the id a tab holds names the
 * ask in the successor as it did in the process that raised it.
 *
 * THE RAISE PUTS AN ASK UP THE MOMENT IT IS RECORDED (`show`), off the ask the dispatcher printed, so
 * the prompt reaches the chat on the tick that saw its landing; the pictures after it carry the same
 * ask under the same name. Only a picture generated AFTER an ask can say it is closed.
 *
 * ANY PROCESS ANSWERS. An answer names an ask, and the process that hears it need not be the one that
 * raised it: a click made while the socket was down is flushed from the tab's outbox onto the
 * successor's first frame, before its first picture has been read (measured 2026-09-28 18:59:54). A key
 * this book does not hold is therefore not an unknown request: the store is read NOW (`catchUp` —
 * `observe` on a fresh picture) and the answer is looked up again. An ask the store holds open is in
 * the book by then and is answered like any other; a name no open ask derives is an answer to an ask
 * that is no longer current (re-cut, answered, nothing owed), which runs nothing, says so in the
 * journal, and tells the chat that owned it (`staleAnswer`) — while that same read has already put up
 * whatever prompt IS current. A phone tap on a push this process never sent is the same read
 * (`recall`), made before its token is spent.
 *
 * AN ANSWER CLOSES THE ASK IN THE STORE — an approval, or a `tell` live for the plan (`ask.asking`) —
 * and the picture that shows it arrives up to a poll later. So a prompt answered here stays down for
 * `ANSWER_GRACE_MS` even while the picture still carries it, and one whose answer the dispatcher did
 * NOT take (a stale token, a refusal, no answer) goes straight back up on the picture in hand.
 */

/**
 * How long a prompt stays down after the dispatcher took its answer, while the store's own close of it
 * reaches the picture. A poll is two seconds (`POLL_MS`); a `tell` is live the moment it is queued.
 * Past this, an ask the picture still carries is up again: the answer went and changed nothing — a
 * designer who came back having written nothing — and his word is still owed.
 */
const ANSWER_GRACE_MS = 30_000;

/** The shape the question panel and the phone's buttons read — `AskUserQuestion`'s own input. */
type PanelQuestion = {
  question: string;
  header: string;
  multiSelect: false;
  options: Array<{ label: string; description?: string; needsNote?: true }>;
};

/** One prompt up in one chat: what the store asks, where, and this server's attempt at showing it. */
type RaisedAsk = {
  promptKey: string;
  requestId: string;
  sessionId: string;
  provider: string;
  sessionName: string | null;
  ask: DispatcherAsk;
  input: { questions: PanelQuestion[] };
  receivedAt: Date;
};

/** The chat a plan's prompt is shown in, or `null` when this server does not know it. */
export type AskChat = { sessionId: string; provider: string; sessionName: string | null };

/** The push for one raised prompt, as the notification orchestrator takes it — the composition root fans it out per user. */
export type AskPush = {
  provider: string;
  sessionId: string;
  meta: Record<string, unknown>;
  promptKey: string;
};

export type DispatcherAsksDependencies = {
  /** The chat `plan`'s prompt is shown in — the plan's owning session, resolved to this app's own. */
  chatFor: (plan: DispatcherStateEvent['plans'][number]) => AskChat | null;
  /** One frame to every open socket. */
  broadcast: (frame: Record<string, unknown>) => void;
  /** The `permission.required` push for a prompt just raised. */
  push: (push: AskPush) => void;
  /** Retires a prompt's phone buttons — it was answered, or it is gone. */
  forgetButtons: (promptKey: string) => void;
  /** Carries one reply to the plan; resolves whether the dispatcher took it (`carryReply`). */
  carry: (ask: DispatcherAsk, reply: AskReply, door: AnswerDoor) => Promise<boolean>;
  /** One fresh read of the store's plans (`readDispatcherState`) — for an answer whose ask this process has not raised. THROWS when the dispatcher did not answer. */
  read: () => Promise<Pick<DispatcherStateEvent, 'plans' | 'generated_at'>>;
  /** Injected by the composition root — this server has no logger. */
  log: (message: string) => void;
};

export type DispatcherAsks = {
  /** Reads one picture of the lane and brings the chats' prompts into line with its open asks. */
  observe(picture: Pick<DispatcherStateEvent, 'plans' | 'generated_at'>): void;
  /** Puts up the ask the raise has just recorded, a poll before any picture can carry it. */
  show(plan: DispatcherStateEvent['plans'][number], ask: DispatcherAsk): void;
  /** The door every reader of pending asks walks (`registerPermissionGateway`). */
  gateway: ProviderRuntimePermissionGateway;
};

/**
 * The panel's input for one ask. An Accept is ONE question — the census, its three answers in their
 * order, Rework taking the operator's notes (`needsNote`: the panel opens a field for them, and the
 * phone's button opens the app instead, since a button cannot carry words). A questions round is one
 * question per designer question, its options verbatim, headed with the plan's name.
 */
function inputOf(ask: DispatcherAsk): { questions: PanelQuestion[] } {
  if (ask.kind === 'accept') {
    const options = ask.options.map((option, index) =>
      index === REWORK_OPTION ? { ...option, needsNote: true as const } : option);
    return { questions: [{ question: ask.question, header: ask.header, multiSelect: false, options }] };
  }
  return {
    questions: ask.questions.map((question) => ({
      question: question.text,
      header: ask.plan,
      multiSelect: false,
      options: question.options.map((label) => ({ label })),
    })),
  };
}

// Used by `dispatcher.module.ts`, which hands it every picture and registers its gateway.
export function createDispatcherAsks(dependencies: DispatcherAsksDependencies): DispatcherAsks {
  /** The prompts up right now, by the ask's own name. */
  const raised = new Map<string, RaisedAsk>();
  /** Names whose answer is being carried — down, and not to be raised again until it settles. */
  const answering = new Set<string>();
  /** Names whose answer the dispatcher took, and when — down for `ANSWER_GRACE_MS`. */
  const answered = new Map<string, number>();
  /** The newest picture, for the re-projection an answer that settled owes. */
  let last: Pick<DispatcherStateEvent, 'plans' | 'generated_at'> | null = null;

  const frameOf = (entry: RaisedAsk): Record<string, unknown> => ({
    kind: 'permission_request',
    id: `${entry.requestId}:request`,
    requestId: entry.requestId,
    promptKey: entry.promptKey,
    toolName: 'AskUserQuestion',
    input: entry.input,
    standalone: true,
    sessionId: entry.sessionId,
    provider: entry.provider,
    timestamp: entry.receivedAt.toISOString(),
  });

  /** What `chat_subscribed` lists for one prompt — the runtime's own pending shape, marked standalone. */
  const pendingOf = (entry: RaisedAsk): Record<string, unknown> => ({
    requestId: entry.requestId,
    promptKey: entry.promptKey,
    toolName: 'AskUserQuestion',
    input: entry.input,
    standalone: true,
    sessionId: entry.sessionId,
    receivedAt: entry.receivedAt,
  });

  const retract = (entry: RaisedAsk, frameKind: 'permission_resolved' | 'permission_cancelled'): void => {
    raised.delete(entry.promptKey);
    dependencies.forgetButtons(entry.promptKey);
    dependencies.broadcast({
      kind: frameKind,
      id: `${entry.requestId}:${frameKind}`,
      requestId: entry.requestId,
      sessionId: entry.sessionId,
      provider: entry.provider,
      timestamp: new Date().toISOString(),
    });
  };

  const raise = (ask: DispatcherAsk, chat: AskChat): void => {
    const promptKey = keyOf(ask);
    const entry: RaisedAsk = {
      promptKey,
      requestId: requestIdOf(ask),
      sessionId: chat.sessionId,
      provider: chat.provider,
      sessionName: chat.sessionName,
      ask,
      input: inputOf(ask),
      receivedAt: new Date(),
    };
    raised.set(promptKey, entry);
    dependencies.broadcast(frameOf(entry));
    dependencies.push({
      provider: chat.provider,
      sessionId: chat.sessionId,
      promptKey,
      // The shape a runtime's own push carries, so the copy and the phone's buttons need nothing new —
      // with the plan and the kind beside it, for a headline that names the plan.
      meta: {
        toolName: 'AskUserQuestion',
        sessionName: chat.sessionName,
        requestId: entry.requestId,
        promptKey,
        toolInput: entry.input,
        plan: ask.plan,
        askKind: ask.kind,
      },
    });
  };

  const observe = (picture: Pick<DispatcherStateEvent, 'plans' | 'generated_at'>): void => {
    // A read that finished AFTER a newer one — an answer's catch-up racing the poll — knows nothing the
    // newer did not, and would put back an ask the newer already saw closed.
    if (last !== null && picture.generated_at < last.generated_at) return;
    last = picture;
    const open = new Map<string, { ask: DispatcherAsk; chat: AskChat }>();
    for (const plan of picture.plans) {
      if (plan.asking === null) continue;
      const promptKey = keyOf(plan.asking);
      if (open.has(promptKey)) continue;              // one arc's lock, carried on every plan it names
      const chat = dependencies.chatFor(plan);
      if (chat === null) {
        dependencies.log(`[Dispatcher] ${plan.name}'s prompt is open, but its session is not one this server knows`);
        continue;
      }
      open.set(promptKey, { ask: plan.asking, chat });
    }
    const now = Date.now();
    for (const [promptKey, at] of answered) {
      if (!open.has(promptKey) || now - at >= ANSWER_GRACE_MS) answered.delete(promptKey);
    }
    // A picture generated no later than an ask's own second may predate it — the raise puts an ask
    // up the moment it is recorded (`show`), a poll before any picture carries it — so only a picture
    // generated AFTER the ask can say it is closed. Both stamps are the store's own second-grained UTC.
    for (const entry of [...raised.values()]) {
      if (!open.has(entry.promptKey) && picture.generated_at > entry.ask.asked.at) retract(entry, 'permission_cancelled');
    }
    for (const [promptKey, { ask, chat }] of open) {
      if (raised.has(promptKey) || answering.has(promptKey) || answered.has(promptKey)) continue;
      raise(ask, chat);
    }
  };

  /** The prompt in the book an answer's key names: by the ask's own name (the phone) or its request id (the panel). */
  const entryFor = (approvalKey: string): RaisedAsk | undefined =>
    raised.get(approvalKey) ?? [...raised.values()].find((candidate) => candidate.requestId === approvalKey);

  /**
   * One answer to a prompt in the book. A decision that is no answer puts the same prompt straight
   * back on the tab that sent it, which has already let it go; an answer takes the prompt down
   * everywhere and is carried to the plan.
   */
  const answer = (entry: RaisedAsk, decision: ProviderPermissionDecision, door: AnswerDoor): void => {
    const reply = readReply(entry.ask, decision);
    if (reply === null) {
      dependencies.log(`[Dispatcher] ${entry.ask.plan}: a ${door} decision carried no answer — the prompt stays up`);
      dependencies.broadcast(frameOf(entry));
      return;
    }
    answering.add(entry.promptKey);
    retract(entry, 'permission_resolved');
    void dependencies.carry(entry.ask, reply, door)
      .catch((error) => {
        dependencies.log(`[Dispatcher] ${entry.ask.plan}: the answer could not be carried: ${error instanceof Error ? error.message : String(error)}`);
        return false;
      })
      .then((took) => {
        answering.delete(entry.promptKey);
        if (took) answered.set(entry.promptKey, Date.now());
        // A refused answer's prompt — or the fresh one a stale token's census now asks — goes back up
        // on the picture in hand: a verb that changed nothing moves no frame to wait for.
        if (last !== null) observe(last);
      });
  };

  /**
   * Reads the store now and brings the book into line with it — `observe` on a fresh picture, for a
   * caller (an answer, a tap) that cannot wait for the poll's next one. Answers whether the dispatcher
   * did; when it did not, the journal says what was left undone, and the prompt comes back on the next
   * picture that reads.
   */
  const catchUp = async (undone: string): Promise<boolean> => {
    try {
      observe(await dependencies.read());
      return true;
    } catch (error) {
      dependencies.log(`[Dispatcher] ${undone}: the store could not be read (${error instanceof Error ? error.message : String(error)})`);
      return false;
    }
  };

  /**
   * An answer no open ask stands behind — re-cut (a new `asked` event, so a new name), answered already,
   * or nothing owed. NOTHING IS CARRIED: an Accept run again would approve the plan a second time and
   * undo a Queue. The journal says so, and the chat that owned the prompt is told (`staleAnswer`), so
   * the tab that sent the answer — which let its card go when it sent it — is not left believing it did
   * something. The prompt that IS current was put up by the read that found this one gone.
   */
  const dropStale = (approvalKey: string, door: AnswerDoor): void => {
    const plan = last === null ? undefined : askedPlanOf(last.plans, approvalKey);
    dependencies.log(`[Dispatcher] ${plan?.name ?? approvalKey}: a ${door} answer named an ask that is no longer open (answered, re-cut or nothing owed) — nothing was carried`);
    const chat = plan === undefined ? null : dependencies.chatFor(plan);
    // Only the panel has a card to retract; a phone tap is answered in its own HTTP reply.
    if (chat === null || door !== 'panel') return;
    dependencies.broadcast({
      kind: 'permission_cancelled',
      id: `${approvalKey}:permission_cancelled`,
      requestId: approvalKey,
      sessionId: chat.sessionId,
      provider: chat.provider,
      staleAnswer: true,
      timestamp: new Date().toISOString(),
    });
  };

  /**
   * An answer for an ask this book does not hold: the successor of the process that raised it, hearing
   * it before its first picture, or an answer to an ask that has since closed. THE STORE DECIDES WHICH:
   * a fresh picture puts every open ask in the book, so the name is found there exactly when the ask is
   * current — and is then carried as one that was there all along, its lock token re-checked by the
   * verb itself.
   */
  const answerFromStore = async (approvalKey: string, decision: ProviderPermissionDecision): Promise<void> => {
    const door = doorOfKey(approvalKey);
    if (!(await catchUp(`a ${door} answer to ${approvalKey} was not carried`))) return;
    const entry = entryFor(approvalKey);
    if (entry === undefined) dropStale(approvalKey, door);
    else answer(entry, decision, door);
  };

  /**
   * One answer, from the panel (it names the ask by its request id) or the phone (by its prompt key —
   * a push outlives the process that sent it). A key of this lane's that the book does not hold is
   * claimed all the same, and settled from the store (`answerFromStore`); any other key is left to
   * the runtimes' gateways.
   */
  const resolve = (approvalKey: string, decision: ProviderPermissionDecision): boolean => {
    const entry = entryFor(approvalKey);
    if (entry !== undefined) {
      answer(entry, decision, doorOfKey(approvalKey));
      return true;
    }
    if (!isAskKey(approvalKey)) return false;
    void answerFromStore(approvalKey, decision).catch((error) => {
      dependencies.log(`[Dispatcher] a ${doorOfKey(approvalKey)} answer to ${approvalKey} could not be settled: ${error instanceof Error ? error.message : String(error)}`);
    });
    return true;
  };

  /**
   * The prompt a phone tap names, as the store holds it now — or `null` when no open ask carries the
   * name. A tap may reach a process that has not raised the prompt yet, whose registry of answerable
   * buttons is then empty, so the book is brought up from the store first; what it holds is what the
   * push would have registered (`ntfy-action.routes.ts` registers it, then spends the token).
   */
  const recall = async (approvalKey: string): Promise<ProviderRuntimeRecalledPrompt | null> => {
    if (!isAskKey(approvalKey)) return null;
    if (entryFor(approvalKey) === undefined && !(await catchUp(`a tap on ${approvalKey} could not be checked`))) return null;
    const entry = entryFor(approvalKey);
    return entry === undefined ? null : { sessionId: entry.sessionId, toolName: 'AskUserQuestion', input: entry.input };
  };

  const show = (plan: DispatcherStateEvent['plans'][number], ask: DispatcherAsk): void => {
    const promptKey = keyOf(ask);
    if (raised.has(promptKey) || answering.has(promptKey) || answered.has(promptKey)) return;
    const chat = dependencies.chatFor(plan);
    if (chat !== null) raise(ask, chat);
  };

  const gateway: ProviderRuntimePermissionGateway = {
    resolve,
    recall,
    listPending: (sessionId) => [...raised.values()].filter((entry) => entry.sessionId === sessionId).map(pendingOf),
    listPendingSessions: () => [...new Set([...raised.values()].map((entry) => entry.sessionId))].sort(),
  };

  return { observe, show, gateway };
}
