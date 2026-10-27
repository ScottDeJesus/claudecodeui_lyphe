import { sessionCompactionsDb } from '@/modules/database/index.js';
import type { ProviderRuntimeGateway } from '@/modules/websocket/index.js';
import type { AnyRecord, ChatCompactionHooks, CompactionFacts, LLMProvider } from '@/shared/types.js';

import { createAutoTrigger } from './auto-trigger.js';
import { completeFrame } from './compaction-frames.js';
import { logDecision } from './compaction-log.js';
import { compactionMode, takesOver } from './compaction-mode.js';
import { taskLedgerUnlisted } from './node-task-ledger.js';
import { compact } from './compaction-procedure.js';
import { flightOf, lastTurnContext, stopFlightsBeforeSeed } from './compaction-registry.js';

/**
 * What the decorator wraps: the provider runtime service as the gateway sees it, plus the two members
 * the runtime seams added to it (`useChatCompaction`, `activity`). The service also carries members the
 * gateway type does not name (`recallApproval`, `getRunner`, ...); they ride through the wrapper untouched.
 */
export type CompactionInnerRuntime = ProviderRuntimeGateway & {
  useChatCompaction(hooks: ChatCompactionHooks): void;
  markIdleCheck(provider: LLMProvider, appSessionId: string, tries: number): boolean;
};

/** `/compact` alone, or `/compact` and then the operator's words (the summarizer's instructions). */
const COMPACT_COMMAND = /^\/compact(?:\s+([\s\S]*))?$/;

/**
 * The compaction this run asks for, or null when it is anyone else's run. A Claude `/compact` that is
 * not an edit: an edit replaces a message and resumes partway (`resumeAnchorId`) or starts over
 * (`resumeFromScratch`), and an edit that replaces a message with `/compact` is still an edit.
 *
 * An edit that starts over is a run of its own to this module (`optionsOfRun`): in a chat whose
 * compaction stored a seed, it carries that seed again.
 */
function compactionRequestOf(
  provider: LLMProvider,
  command: string,
  options: AnyRecord,
): { sessionId: string; instructions: string | null; trigger: CompactionFacts['trigger'] } | null {
  if (provider !== 'claude') return null;
  const match = COMPACT_COMMAND.exec(command.trim());
  if (!match) return null;
  if (options.resumeAnchorId || options.resumeFromScratch === true) return null;
  if (typeof options.sessionId !== 'string' || options.sessionId === '') return null;
  const words = match[1]?.trim() ?? '';
  const trigger = options.compactionTrigger === 'auto' || options.compactionTrigger === 'idle' ? options.compactionTrigger : 'manual';
  return { sessionId: options.sessionId, instructions: words === '' ? null : words, trigger };
}

/**
 * The send options only this module puts on a run. The chat gateway spreads a client's send options into
 * the runtime's, so a client could name them: a `transcriptAppend` would ride into a transcript, and a
 * `compactionSeed` would silence a turn's push and its report. They are removed from every Claude run
 * this decorator handles, before anything else reads the options — the way `node` is the gateway's own.
 */
const MODULE_OWNED_OPTIONS = ['transcriptAppend', 'compactionSeed'] as const;

/**
 * The options a Claude run goes on with: the caller's, without what only this module may set, and — for
 * a start-over in a chat whose latest compaction stored a seed — with that seed as `transcriptAppend`.
 *
 * Why a start-over carries the seed again: when the operator's first message after a compaction joined
 * the seed append's live process, no assistant row precedes it — only the append and its attachments —
 * so `resolveEditAnchor` answers "start over", and the new session would start empty, knowing nothing
 * the compaction kept. Started over with the seed appended again, the session holds exactly the seed
 * and the edited message, and the session it replaces is filed as an edit's rewind like any start-over.
 * (`resolveEditAnchor` stays as it is: an attachment's uuid is refused as a resume point, so no anchor
 * could make the edited message a sibling under one parent.) When the CLI resumed from disk instead, its
 * placeholder row precedes the message and the anchor rule resumes through it — not a start-over. A
 * record with no stored seed (a NULL column) gives none: nothing is appended.
 *
 * The procedure's step 7 calls the inner service directly, so its own append never passes through here.
 */
function optionsOfRun(provider: LLMProvider, command: string, options: AnyRecord): AnyRecord {
  if (provider !== 'claude') return options;
  const cleaned: AnyRecord = { ...options };
  for (const key of MODULE_OWNED_OPTIONS) delete cleaned[key];
  if (cleaned.resumeFromScratch !== true || COMPACT_COMMAND.test(command.trim())) return cleaned;
  if (typeof cleaned.sessionId !== 'string' || cleaned.sessionId === '') return cleaned;
  const seed = sessionCompactionsDb.latestCompaction(cleaned.sessionId)?.seed ?? null;
  return seed === null ? cleaned : { ...cleaned, transcriptAppend: seed };
}

// The triggers `withChatCompaction` built, for `stopChatCompaction`.
let activeTriggers: { stop(): void } | null = null;

/**
 * Stops the module for a process that is leaving: no deadline fires, no pending compaction starts, and a
 * compaction still waiting or summarizing is stopped (its verb gets SIGTERM) rather than orphaned. A seed
 * append already running is a run like any other and finishes with the drain.
 *
 * Consumer: index.ts, for server/index.ts's shutdown.
 */
export function stopChatCompaction(): void {
  activeTriggers?.stop();
  stopFlightsBeforeSeed();
}

/**
 * Wraps the provider runtime service so a taken-over chat's `/compact` becomes the summarizer's
 * compaction, and registers the module's hooks with it. Every other member — and every run that is not
 * such a `/compact` — is the inner service's own, unchanged, with two exceptions the module owns on a
 * Claude run: `transcriptAppend` and `compactionSeed` are removed from the options the caller sent (only
 * this module puts them on a run), and a start-over in a compacted chat — an edit of the first message
 * after the compaction — runs with the chat's stored seed as `transcriptAppend` (`optionsOfRun`).
 *
 * Consumer: index.ts, for server/index.ts.
 */
export function withChatCompaction<Inner extends CompactionInnerRuntime>(inner: Inner): Inner {
  const decorated: Inner = {
    ...inner,

    async run(provider: LLMProvider, command: string, sentOptions: AnyRecord, writer): Promise<unknown> {
      const options = optionsOfRun(provider, command, sentOptions);
      const request = compactionRequestOf(provider, command, options);
      if (request === null) return inner.run(provider, command, options, writer);

      // ONE mode read both decides (it is `takesOver`'s own test) and explains: a switch that is on while the
      // summarizer cannot be served says why below. A chat on a node is read the same way as a local one, unless
      // its node's warden lists no live tasks (`taskLedgerUnlisted`): that chat keeps the CLI's own compaction.
      const mode = await compactionMode();
      const unlisted = taskLedgerUnlisted(request.sessionId);
      if (mode.on && !unlisted) {
        return compact(inner, { ...request, options, writer });
      }
      if (request.trigger !== 'manual') {
        // An automatic run started on a snapshot of the switch that has since moved: it ends with
        // nothing done, and the CLI's own compaction is untouched.
        logDecision(
          request.sessionId,
          request.trigger,
          lastTurnContext(request.sessionId),
          inner.activity('claude', request.sessionId),
          'no longer taken over, the run ends with nothing done',
        );
        writer.send(completeFrame(request.sessionId, 0));
        return undefined;
      }
      // The operator pressed Compact with the switch on and the CLI left to do it: one line says why. With the
      // switch off `why` is null and nothing is said, so an off switch changes nothing.
      const why = unlisted ? 'the chat\'s node warden lists no live tasks' : mode.why;
      if (why) {
        logDecision(request.sessionId, request.trigger, lastTurnContext(request.sessionId), inner.activity('claude', request.sessionId), `handed to the CLI: ${why}`);
      }
      return inner.run(provider, command, options, writer);
    },

    async abort(provider: LLMProvider, sessionId: string): Promise<boolean> {
      // A compaction in flight is stopped by the procedure's own rule for the phase it is in: the guard's
      // wait ends, the verb's child gets SIGTERM, or the seed append's run is aborted like any run.
      const flight = provider === 'claude' ? flightOf(sessionId) : undefined;
      return flight ? flight.stop() : inner.abort(provider, sessionId);
    },

    async steer(provider: LLMProvider, sessionId: string, content: string): Promise<'folded' | 'not_running'> {
      // A compaction in flight owns the chat: a message pushed into its process would land in the summarized turn
      // (or between the guard and the seed), so a steer answers 'not_running' and the caller runs a turn after it.
      if (provider === 'claude' && flightOf(sessionId)) return 'not_running';
      return inner.steer(provider, sessionId, content);
    },
  };

  const triggers = createAutoTrigger({ inner, runtime: () => decorated });
  activeTriggers = triggers;
  inner.useChatCompaction({
    takesOver,
    turnEnded: triggers.turnEnded,
    turnRestored: triggers.turnRestored,
    activityChanged: triggers.activityChanged,
  });
  return decorated;
}
