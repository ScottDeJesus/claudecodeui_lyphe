import { appConfigDb, sessionsDb, userDb } from '@/modules/database/index.js';
import { createNotificationEvent, forgetPendingAction, notifyUserIfEnabled } from '@/modules/notifications/index.js';
import { registerPermissionGateway } from '@/modules/providers/index.js';
import type { DispatcherAsk, DispatcherCardAnswer, DispatcherPlan, DispatcherStateEvent, ProviderPermissionDecision } from '@/shared/types.js';

import { carryReply } from './dispatcher-answer.service.js';
import { runDispatcherAsk, runDispatcherCommand } from './dispatcher-ask.transport.js';
import { createDispatcherAsks } from './dispatcher-asks.service.js';
import type { AskChat } from './dispatcher-asks.service.js';
import { createDispatcherRaiser } from './dispatcher-raise.service.js';
import { readDispatcherState } from './dispatcher-state.service.js';

/**
 * The prompts a plan owes the operator, put up in its owning chat — the composition of the raise
 * (`dispatcher-raise.service.ts`: a landing that owes his word has its ask recorded by the dispatcher's
 * own `ask` verb), the projection of every open ask onto the question panel, the phone and the
 * sidebar's mark (`dispatcher-asks.service.ts`), and the doors his answer goes back through
 * (`dispatcher-answer.service.ts`).
 *
 * A composition root of its own, under `dispatcher.module.ts`, for the reason that file's head gives:
 * this is where the database, the notification orchestrator and the provider registry are named, so
 * everything beneath takes them as arguments. The lane's own root hands down the three things it
 * owns — the dispatcher command, the socket broadcast, and the journal.
 */

/** The `app_config` key holding each plan's newest LANDING already raised for — durable for the endings' reason (`dispatcher-endings.service.ts`), per plan for the raise's (`dispatcher-raise.service.ts`). */
const RAISED_THROUGH_KEY = 'dispatcher_raised_through';

/**
 * The orchestrator is JavaScript, so TypeScript reads `dedupeKey = null` and `sessionId = null` as
 * parameters that accept only `null` — too narrow to be cast to directly, hence through `unknown`. This
 * alias states the contract it implements for the push a raised prompt earns: the same event a
 * provider's own `AskUserQuestion` raises.
 */
const buildPromptEvent = createNotificationEvent as unknown as (input: {
  provider: string;
  sessionId: string;
  kind: 'action_required';
  code: 'permission.required';
  meta: Record<string, unknown>;
  severity: 'warning';
  requiresUserAction: true;
  dedupeKey: string;
}) => object;

export type DispatcherPromptsDependencies = {
  /** The dispatcher command as every verb of the lane runs it: its binary, its ceiling, its environment. */
  commands: { bin: string; timeoutMs: number; env: NodeJS.ProcessEnv };
  /** One frame to every open socket. */
  broadcast: (frame: object) => void;
  /** The lane's once-per-message journal (`dispatcher.module.ts`). */
  log: (message: string) => void;
};

// Used by `dispatcher.module.ts`, which hands it every picture the lane broadcasts, mounts its answer
// door on the lane's router, and stops it with the lane.
export function createDispatcherPrompts(dependencies: DispatcherPromptsDependencies): {
  observe(frame: DispatcherStateEvent): void;
  stop(): void;
  /** The card's own door — the ask as the card drew it, and the operator's decision (`DispatcherAsks.answer`). */
  answer(ask: DispatcherAsk, decision: ProviderPermissionDecision): Promise<DispatcherCardAnswer>;
} {
  const { commands, log } = dependencies;

  /**
   * The raise's marks — ONE ENTRY PER PLAN, the highest landing id already answered for it — in the
   * `app_config` table. A map rather than the endings' single number because the raise's decisions are
   * per plan and a watermark is not: a landing whose answer is still coming has to stay due while the
   * plans around it are marked.
   */
  const raisedMarks = {
    read: (): Map<string, number> | null => {
      const raw = appConfigDb.get(RAISED_THROUGH_KEY);
      if (raw === null) return null;
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return null;
      }
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
      const marks = new Map<string, number>();
      for (const [plan, id] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof id === 'number' && Number.isFinite(id)) marks.set(plan, id);
      }
      return marks;
    },
    write: (marks: ReadonlyMap<string, number>): void => {
      appConfigDb.set(RAISED_THROUGH_KEY, JSON.stringify(Object.fromEntries(marks)));
    },
  };

  /**
   * The chat a plan's prompt is shown in: its owning session, resolved to this app's own. RESOLVED OR
   * NOTHING, never guessed — `plan.session_app_id` is `null` when the plan names no session, and an id
   * no row carries resolves to itself (`sessions.db.ts`'s `resolveAppSessionId`) and is caught by the
   * lookup. Either way this server cannot show the prompt, and the owning session's Stop hold keeps it.
   */
  const chatFor = (plan: DispatcherPlan): AskChat | null => {
    if (plan.session_app_id === null) return null;
    const session = sessionsDb.getSessionById(plan.session_app_id);
    if (!session || !session.provider) return null;
    return { sessionId: session.session_id, provider: session.provider, sessionName: session.custom_name };
  };

  const asks = createDispatcherAsks({
    chatFor,
    broadcast: dependencies.broadcast,
    // The push an `AskUserQuestion` gets, to every active user — a plan belongs to no login — each
    // user's own switches and channels deciding what reaches them. The key carries the user for the
    // endings' reason: the orchestrator's dedupe is process-wide.
    push: ({ provider, sessionId, meta, promptKey }) => {
      for (const userId of userDb.getActiveUserIds()) {
        try {
          notifyUserIfEnabled({
            userId,
            event: buildPromptEvent({
              provider,
              sessionId,
              kind: 'action_required',
              code: 'permission.required',
              meta,
              severity: 'warning',
              requiresUserAction: true,
              dedupeKey: `dispatcher:${userId}:${promptKey}`,
            }),
          });
        } catch (error) {
          log(`[Dispatcher] could not push a prompt to user ${userId}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    },
    forgetButtons: forgetPendingAction,
    // Each verb an answer runs is its own line, never folded by the once-per-message journal: the
    // journal is where the operator's answer is read back, command and reply.
    carry: (ask, reply, door) => carryReply({
      run: (args, stdin) => runDispatcherCommand(commands, args, stdin),
      say: (line) => console.log(line),
    }, ask, reply, door),
    // The store, read now — the same document the poll reads — for an answer or a tap that names an ask
    // this process has not raised yet (`dispatcher-asks.service.ts`, "ANY PROCESS ANSWERS").
    read: () => readDispatcherState(commands),
    log,
  });
  const unregisterAsks = registerPermissionGateway(asks.gateway);

  const raiser = createDispatcherRaiser({
    readMarks: raisedMarks.read,
    writeMarks: raisedMarks.write,
    // The chat is checked FIRST: an ask recorded for a session this server cannot show would stand
    // the owning session's Stop hold down over a prompt nobody sees.
    raise: async (plan) => {
      if (chatFor(plan) === null) {
        log(`[Dispatcher] no prompt raised for ${plan.name}: its session is not one this server knows — its Stop hold keeps whatever it owes`);
        return 'unreachable';
      }
      const answer = await runDispatcherAsk(commands, plan.name);
      if (answer.outcome === 'refused') {
        log(`[Dispatcher] ${answer.line} — its Stop hold keeps it`);
        return 'refused';
      }
      if (answer.outcome === 'nothing') return 'nothing';
      // Up in the chat the moment it is recorded — the tick that saw the landing — rather than on the
      // next picture's `asking`, which then carries the same ask.
      if (answer.ask !== null) asks.show(plan, answer.ask);
      return 'raised';
    },
    log,
  });

  return {
    // The raise is called bare because it never throws — its pass runs on a promise it logs itself —
    // and it reads the FRAME, whose outings are what it holds a landing back on. The chats' prompts
    // are a projection of the same frame's `asking`, and a fault there never costs the tabs their frame.
    observe: (frame) => {
      raiser.observe(frame);
      try {
        asks.observe(frame);
      } catch (error) {
        log(`[Dispatcher] could not show a plan's prompt: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
    stop: unregisterAsks,
    // The card's answer, straight off the asks service: this root owns the composition, the book owns
    // the lookup and the carry.
    answer: asks.answer,
  };
}
