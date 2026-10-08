import type { ProviderRuntimeGateway } from '@/modules/websocket/index.js';
import type { AnyRecord, ChatCompactionHooks, ChatProcessActivity, CompactionFacts, LLMProvider } from '@/shared/types.js';

import { createAutoTrigger } from './auto-trigger.js';
import { completeFrame } from './compaction-frames.js';
import { logDecision } from './compaction-log.js';
import { takesOver } from './compaction-mode.js';
import { compact } from './compaction-procedure.js';
import { flightOf, lastTurnContext, stopFlightsBeforeSeed } from './compaction-registry.js';

/**
 * What the decorator wraps: the provider runtime service as the gateway sees it, plus the two members
 * the runtime seams added to it (`useChatCompaction`, `activity`). The service also carries members the
 * gateway type does not name (`recallApproval`, `getRunner`, ...); they ride through the wrapper untouched.
 */
export type CompactionInnerRuntime = ProviderRuntimeGateway & {
  useChatCompaction(hooks: ChatCompactionHooks): void;
  activity(provider: LLMProvider, appSessionId: string): ChatProcessActivity;
};

/** `/compact` alone, or `/compact` and then the operator's words (the summarizer's instructions). */
const COMPACT_COMMAND = /^\/compact(?:\s+([\s\S]*))?$/;

/**
 * The compaction this run asks for, or null when it is anyone else's run. A Claude `/compact` that is
 * not an edit: an edit replaces a message and resumes partway (`resumeAnchorId`) or starts over
 * (`resumeFromScratch`), and an edit that replaces a message with `/compact` is still an edit.
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

// The triggers `withChatCompaction` built, for `stopChatCompaction`.
let activeTriggers: { stop(): void } | null = null;

/**
 * Stops the module for a process that is leaving: no deadline fires, no pending compaction starts, and a
 * compaction still waiting or summarizing is stopped (its verb gets SIGTERM) rather than orphaned. A seed
 * turn already running is a run like any other and finishes with the drain.
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
 * such a `/compact` — is the inner service's own, unchanged.
 *
 * Consumer: index.ts, for server/index.ts.
 */
export function withChatCompaction<Inner extends CompactionInnerRuntime>(inner: Inner): Inner {
  const decorated: Inner = {
    ...inner,

    async run(provider: LLMProvider, command: string, options: AnyRecord, writer): Promise<unknown> {
      const request = compactionRequestOf(provider, command, options);
      if (request === null) return inner.run(provider, command, options, writer);

      const node = typeof options.node === 'string' && options.node ? options.node : null;
      if (await takesOver({ appSessionId: request.sessionId, node })) {
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
      return inner.run(provider, command, options, writer);
    },

    async abort(provider: LLMProvider, sessionId: string): Promise<boolean> {
      // A compaction in flight is stopped by the procedure's own rule for the phase it is in: the guard's
      // wait ends, the verb's child gets SIGTERM, or the seed turn is aborted like any turn.
      const flight = provider === 'claude' ? flightOf(sessionId) : undefined;
      return flight ? flight.stop() : inner.abort(provider, sessionId);
    },
  };

  const triggers = createAutoTrigger({ inner, runtime: () => decorated });
  activeTriggers = triggers;
  inner.useChatCompaction({ takesOver, turnEnded: triggers.turnEnded, activityChanged: triggers.activityChanged });
  return decorated;
}
