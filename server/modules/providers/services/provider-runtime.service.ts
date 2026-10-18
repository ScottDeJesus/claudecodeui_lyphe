import { providerRegistry } from '@/modules/providers/provider.registry.js';
import { providerModelsService } from '@/modules/providers/services/provider-models.service.js';
import { sessionsService } from '@/modules/providers/services/sessions.service.js';
import type { IProvider } from '@/shared/interfaces.js';
import type { ChatToolsetHooks, ToolsetSyncOutcome } from '@/shared/toolset-types.js';
import type {
  AnyRecord,
  ChatCompactionHooks,
  ChatProcessActivity,
  LLMProvider,
  ProviderPermissionDecision,
  ProviderRuntimePermissionGateway,
  ProviderRuntimeRecalledPrompt,
  ProviderRunFunction,
  ProviderRuntimeContext,
  ProviderRuntimeWriter,
} from '@/shared/types.js';

type ProviderRuntimeServiceDependencies = {
  listPermissionGateways(): ProviderRuntimePermissionGateway[];
  resolveProvider(provider: string): IProvider;
  resolveProviderSessionId(sessionId: string | null | undefined): string | null;
  resolveResumeModel(
    provider: LLMProvider,
    sessionId: string | undefined,
    requestedModel?: string | null,
  ): Promise<string | undefined>;
  getProviderModels: typeof providerModelsService.getProviderModels;
};

const defaultDependencies: ProviderRuntimeServiceDependencies = {
  listPermissionGateways: () => providerRegistry.listPermissionGateways(),
  resolveProvider: (provider) => providerRegistry.resolveProvider(provider),
  resolveProviderSessionId: (sessionId) => sessionsService.resolveProviderSessionId(sessionId),
  resolveResumeModel: (provider, sessionId, requestedModel) =>
    providerModelsService.resolveResumeModel(provider, sessionId, requestedModel),
  getProviderModels: (provider) => providerModelsService.getProviderModels(provider),
};

// What a chat is answered when custom compaction has registered nothing, or its runtime keeps no
// process to ask about: the CLI compacts as it always has, and nobody is waiting on anything.
const NOT_TAKEN_OVER_HOOKS: ChatCompactionHooks = {
  takesOver: async () => false,
  turnEnded: () => {},
  turnRestored: () => {},
  activityChanged: () => {},
};
const NOT_LIVE_ACTIVITY: ChatProcessActivity = { live: false, busy: false, why: null };

// What a chat is answered while the toolsets module has registered nothing: no variables, no
// servers, no prompt line, so its launch is today's. Every call answers a FRESH object, so no caller
// can change an answer another one will read.
const INERT_TOOLSET_HOOKS: ChatToolsetHooks = {
  launchFor: async () => ({ env: {}, servers: null, promptLine: null }),
};

/**
 * Creates the application-facing provider runtime dispatcher.
 *
 * The provider registry owns each concrete runtime. This service supplies the
 * registry-backed model/session lookups at execution time so runtime adapters
 * never import services that resolve back through the registry.
 */
export function createProviderRuntimeService(
  dependencyOverrides: Partial<ProviderRuntimeServiceDependencies> = {},
) {
  const dependencies = { ...defaultDependencies, ...dependencyOverrides };

  let compactionHooks: ChatCompactionHooks = NOT_TAKEN_OVER_HOOKS;
  // ONE object every context carries, reading the registered hooks at CALL time: a Claude process
  // keeps the context of the message that spawned it for its whole life, and a registration made
  // after that message (or replaced later) must still reach it.
  const compaction: ChatCompactionHooks = {
    takesOver: (input) => compactionHooks.takesOver(input),
    turnEnded: (report) => compactionHooks.turnEnded(report),
    turnRestored: (report, endedAt, idleTries) => compactionHooks.turnRestored(report, endedAt, idleTries),
    activityChanged: (appSessionId, activity) => compactionHooks.activityChanged(appSessionId, activity),
  };

  let toolsetHooks: ChatToolsetHooks = INERT_TOOLSET_HOOKS;
  // The same shape and the same reason as `compaction` above: one object every context carries,
  // reading the registered hooks at CALL time, because a Claude process keeps the context of the
  // message that spawned it for its whole life.
  const toolsets: ChatToolsetHooks = {
    launchFor: (input) => toolsetHooks.launchFor(input),
  };

  const createRuntimeContext = (
    provider: IProvider,
  ): ProviderRuntimeContext => ({
    resolveProviderSessionId: dependencies.resolveProviderSessionId,
    resolveResumeModel: (sessionId, requestedModel) =>
      dependencies.resolveResumeModel(provider.id, sessionId, requestedModel),
    getProviderModels: async () => dependencies.getProviderModels(provider.id),
    normalizeMessage: (raw, sessionId) => provider.sessions.normalizeMessage(raw, sessionId),
    async isProviderInstalled() {
      try {
        return (await provider.auth.getStatus()).installed;
      } catch {
        // Preserve the runtime's original error when installation probing fails.
        return true;
      }
    },
    compaction,
    toolsets,
  });

  const run = (
    providerName: LLMProvider,
    command: string,
    options: AnyRecord,
    writer: ProviderRuntimeWriter,
  ): Promise<unknown> => {
    const provider = dependencies.resolveProvider(providerName);
    return provider.runtime.run(command, options, writer, createRuntimeContext(provider));
  };

  return {
    run,

    // Registered once, by the custom-compaction module when the app boots; every context built
    // before or after carries it (see `compaction` above).
    useChatCompaction(hooks: ChatCompactionHooks): void {
      compactionHooks = hooks;
    },

    // Registered once, by the toolsets module when the app boots; every context built before or
    // after carries it (see `toolsets` above).
    useChatToolsets(hooks: ChatToolsetHooks): void {
      toolsetHooks = hooks;
    },

    // Pushes the chat's on-sets into its live process, asked of the provider's runtime; a provider whose
    // runtime keeps no such process, a chat with none, or a runtime that throws or rejects when asked
    // (the provider's resolution included) answers `{ live: false }`, which the next message makes good.
    async syncToolsets(providerName: LLMProvider, appSessionId: string): Promise<ToolsetSyncOutcome> {
      try {
        // Called as a method, so the runtime's `this` holds.
        const runtime = dependencies.resolveProvider(providerName).runtime;
        return (await runtime.syncToolsets?.(appSessionId)) ?? { live: false };
      } catch (error) {
        console.warn(`[provider-runtime] could not sync the tool sets of ${providerName} session ${appSessionId}:`, error);
        return { live: false };
      }
    },

    // What the chat's process is doing, asked of the provider's runtime; a provider whose runtime
    // keeps no such process (or throws when asked) answers not-live, which waits on nothing.
    activity(providerName: LLMProvider, appSessionId: string): ChatProcessActivity {
      try {
        const runtime = dependencies.resolveProvider(providerName).runtime;
        return runtime.activity?.(appSessionId) ?? { ...NOT_LIVE_ACTIVITY };
      } catch (error) {
        console.warn(`[provider-runtime] could not read the activity of ${providerName} session ${appSessionId}:`, error);
        return { ...NOT_LIVE_ACTIVITY };
      }
    },

    // Tells the chat's session host that the idle compaction check has started a compaction for the chat's last turn end;
    // a provider whose runtime keeps no host (or throws when asked) answers false, which only costs the restart its memory.
    markIdleCheck(providerName: LLMProvider, appSessionId: string, tries: number): boolean {
      try {
        return dependencies.resolveProvider(providerName).runtime.markIdleCheck?.(appSessionId, tries) ?? false;
      } catch (error) {
        console.warn(`[provider-runtime] could not record the idle check of ${providerName} session ${appSessionId}:`, error);
        return false;
      }
    },

    hasRuntime(providerName: string): boolean {
      try {
        return Boolean(dependencies.resolveProvider(providerName).runtime);
      } catch {
        return false;
      }
    },

    getRunner(provider: LLMProvider): ProviderRunFunction {
      return (command, options, writer) => run(provider, command, options, writer);
    },

    async abort(providerName: LLMProvider, sessionId: string): Promise<boolean> {
      return Boolean(await dependencies.resolveProvider(providerName).runtime.abort(sessionId));
    },

    // The first holder of the key settles it — a provider's run, or a prompt the app raised itself
    // (`providerRegistry.listPermissionGateways`). Keys cannot collide across holders: a runtime's are
    // a bare uuid or a `toolu:`/`ask:` prompt key, the dispatcher's carry its own `dispatcher:` prefix —
    // and the dispatcher claims every key of its own, holding it or not, because its asks live in the
    // store and any process can settle one. Only a key nobody claims is unknown.
    resolveToolApproval(approvalKey: string, decision: ProviderPermissionDecision): void {
      if (dependencies.listPermissionGateways().some((gateway) => gateway.resolve(approvalKey, decision))) return;
      console.warn(`[permission] decision for unknown request ${approvalKey}: no pending approval in this process`);
    },

    // What the prompt a phone tap names is NOW, asked of the gateways whose asks live in a store — the
    // one thing a process that never sent the push cannot know from its own memory. `null` for a key
    // nobody's store holds open (or a runtime's, which has no store to ask).
    async recallApproval(approvalKey: string): Promise<ProviderRuntimeRecalledPrompt | null> {
      for (const gateway of dependencies.listPermissionGateways()) {
        const recalled = await gateway.recall?.(approvalKey);
        if (recalled) return recalled;
      }
      return null;
    },

    getPendingApprovalsForSession(sessionId: string): unknown[] {
      // A gateway whose asks are pending in no chat has no `listPending` at all (the dispatcher's,
      // whose plan prompts are answered on the card and on the phone), so it lists nothing here.
      return dependencies.listPermissionGateways().flatMap((gateway) => gateway.listPending?.(sessionId) ?? []);
    },
  };
}

export const providerRuntimeService = createProviderRuntimeService();
