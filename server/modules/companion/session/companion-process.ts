import { query, type Query, type SDKMessage, type SDKUserMessage, type SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk';

import type { CompanionModel, CompanionSettings } from '@/shared/companion-types.js';
import { createIdleCloser, createPromptQueue, resolveIdleCloseMs } from '@/shared/prompt-stream.js';

import { companionQueryOptions } from './companion-launch.js';

/**
 * One launch of her CLI: the streaming-input `query()`, the prompt queue it is fed through, the idle
 * clock that closes it and the way it is stopped. It knows nothing of turns, envelopes or the panel — it
 * is the mechanism the conversation (`companion-session.ts`) is held on:
 *   - the queue never ends on its own (the SDK closes the CLI's stdin when its input iterable is
 *     exhausted, and the CLI reads that EOF as "wind down"), so it ends only when we end it;
 *   - the shared idle closer closes the process after two hours of silence since the last MESSAGE, and
 *     asks `isBusy` first: a turn in flight is never closed under;
 *   - the CLI is given a grace to answer an interrupt or to exit after the end of its input, and killed
 *     when it does not — a process that ignores a Stop would ignore the next message too.
 * Once we have ended it (`close`, `kill`, the idle closer) it reports NOTHING more: its messages are
 * drained unheard and its ending is not an event. `onEnded` fires only when the loop ended by itself.
 *
 * Consumers: `session/companion-session.ts`, one launch at a time per account.
 */

/**
 * How long the CLI is given to answer an interrupt or a model switch, or to exit after the end of its input,
 * before it is killed (an interrupt, an exit) or the switch is reported as not made (the panel's save must
 * come back, whatever her CLI is doing).
 */
const CLI_GRACE_MS = 5_000;

/** What `work` answers, or `undefined` once `ms` have passed; the timer never outlives the wait. */
async function answeredWithin<T>(work: Promise<T>, ms: number): Promise<T | undefined> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([work, new Promise<undefined>((resolve) => (timer = setTimeout(() => resolve(undefined), ms)))]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * What one launch is given. `initial` is queued before the CLI exists; `readSettings` is read once the
 * launch begins (the model and the operator's name), `tools` are the definitions her MCP server
 * carries and `resume` the CLI session to continue (`null` for a fresh conversation). `onMessage` hears
 * every message of the loop, `onEnded` the way a loop that ended BY ITSELF ended (`null` for a clean
 * end, else what it threw) and `onIdleClose` the idle closer's decision, which the owner carries out.
 */
type CompanionCliLaunch = {
  userId: number;
  initial: SDKUserMessage[];
  resume: string | null;
  readSettings(): CompanionSettings;
  tools: Array<SdkMcpToolDefinition<any>>;
  isBusy(): boolean;
  onMessage(message: SDKMessage): void;
  onEnded(thrown: unknown): void;
  onIdleClose(): void;
};

/**
 * The launch as its owner drives it. `up` is false while the options are being built (the CLI does not
 * exist yet). `push` queues a message and restarts the idle clock; `interrupt` answers the uuids still
 * queued behind the stopped turn, or `unanswered` when the CLI did not answer within the grace;
 * `setModel` applies a model to the running CLI (and throws when the CLI does not answer within the grace), or
 * remembers it for the CLI that is not up yet; `close` ends the input and waits for the exit, killing the CLI
 * after the grace; `kill` ends it now. Consumed by
 * `companion-session.ts`, which holds one per launch.
 */
export type CompanionCli = {
  readonly resume: string | null;
  readonly up: boolean;
  push(message: SDKUserMessage): void;
  interrupt(): Promise<{ stillQueued: string[] } | 'unanswered'>;
  setModel(model: CompanionModel): Promise<void>;
  close(): Promise<void>;
  kill(): void;
};

/** Consumed by `companion-session.ts`. Starts the launch at once (on the next microtask: the owner holds the handle before any callback can fire). */
export function launchCompanionCli(input: CompanionCliLaunch): CompanionCli {
  const { userId } = input;
  const queue = createPromptQueue(input.initial);
  let conversation: Query | null = null;
  // A model change that arrived before the query existed; applied as soon as it does.
  let wantedModel: CompanionModel | null = null;

  const idle = createIdleCloser({
    idleMs: resolveIdleCloseMs(undefined),
    isBusy: input.isBusy,
    onBusy: (silentForMs) => {
      console.log(`[Companion] account ${userId}: idle window reached after ${Math.round(silentForMs / 60_000)} min, but a turn is in flight; asking again in a minute`);
    },
    close: (silentForMs) => {
      console.log(`[Companion] account ${userId}: closing her idle process after ${Math.round(silentForMs / 60_000)} min without a message`);
      input.onIdleClose();
    },
  });

  async function run(): Promise<void> {
    let thrown: unknown = null;
    try {
      const settings = input.readSettings();
      const options = await companionQueryOptions(userId, settings, input.tools, input.resume);
      // Ended while its options were being built: nothing was launched, so there is nothing to wind down.
      if (queue.ended) return;
      const started = query({ prompt: queue.stream, options });
      conversation = started;
      if (wantedModel !== null && wantedModel !== settings.model) {
        started.setModel(wantedModel).catch((error: unknown) => {
          console.error(`[Companion] account ${userId}: the model change made while she woke was not applied`, error);
        });
      }
      for await (const message of started) {
        if (!queue.ended) input.onMessage(message);
      }
    } catch (error) {
      thrown = error;
    } finally {
      conversation?.close();
    }
    if (!queue.ended) input.onEnded(thrown);
  }

  const done = Promise.resolve()
    .then(run)
    .catch((error: unknown) => {
      console.error(`[Companion] account ${userId}: her loop ended in an error it could not report`, error);
    });

  return {
    resume: input.resume,
    get up() {
      return conversation !== null;
    },
    push(message) {
      queue.push(message);
      idle.touch();
    },
    async interrupt() {
      if (conversation === null) return { stillQueued: [] };
      // An older CLI answers an interrupt with no receipt at all, which is an answer; only silence or a failure is not.
      const receipt = conversation.interrupt().then(
        (answer) => ({ stillQueued: answer?.still_queued ?? [] }),
        (error: unknown) => {
          console.error(`[Companion] account ${userId}: the interrupt failed`, error);
          return undefined;
        }
      );
      return (await answeredWithin(receipt, CLI_GRACE_MS)) ?? 'unanswered';
    },
    async setModel(model) {
      if (conversation === null) {
        wantedModel = model;
        return;
      }
      // Bounded like an interrupt: the save that asked for this is an HTTP request, and a CLI that does not answer must not hold it open.
      const switched = conversation.setModel(model).then(() => true);
      if (!(await answeredWithin(switched, CLI_GRACE_MS))) {
        throw new Error(`her CLI did not answer a switch to ${model} within ${CLI_GRACE_MS / 1000} s`);
      }
    },
    async close() {
      idle.cancel();
      queue.end();
      // EOF is how the CLI is asked to wind down; one that does not is killed rather than waited on.
      await answeredWithin(done, CLI_GRACE_MS);
      conversation?.close();
    },
    kill() {
      idle.cancel();
      queue.end();
      conversation?.close();
    },
  };
}
