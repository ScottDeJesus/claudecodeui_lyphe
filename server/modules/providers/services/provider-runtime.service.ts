import { providerRegistry } from '@/modules/providers/provider.registry.js';
import { providerModelsService } from '@/modules/providers/services/provider-models.service.js';
import { sessionsService } from '@/modules/providers/services/sessions.service.js';
import type { IProvider } from '@/shared/interfaces.js';
import type {
  AnyRecord,
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
