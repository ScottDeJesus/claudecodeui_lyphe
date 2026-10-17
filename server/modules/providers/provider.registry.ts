import { ClaudeProvider } from '@/modules/providers/list/claude/claude.provider.js';
import { CodexProvider } from '@/modules/providers/list/codex/codex.provider.js';
import { CursorProvider } from '@/modules/providers/list/cursor/cursor.provider.js';
import { OpenCodeProvider } from '@/modules/providers/list/opencode/opencode.provider.js';
import type { IProvider } from '@/shared/interfaces.js';
import type { LLMProvider, ProviderRuntimePermissionGateway } from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';

let providers: Record<LLMProvider, IProvider> | undefined;

/**
 * The four providers, built on the first call that needs one — never when this module is evaluated.
 * A provider's own files import services that import this registry (`provider-models.service`,
 * `session-synchronizer.service`, …), so building them at evaluation time made the module graph
 * order-dependent: entered through the registry or through any provider file, the import ended
 * `ReferenceError: Cannot access 'providerRegistry' / 'ClaudeProvider' before initialization` (ten
 * modules of `providers/` failed a cold import in a fresh process), while the server's own entry
 * order happened to work.
 */
function allProviders(): Record<LLMProvider, IProvider> {
  providers ??= {
    claude: new ClaudeProvider(),
    codex: new CodexProvider(),
    cursor: new CursorProvider(),
    opencode: new OpenCodeProvider(),
  };
  return providers;
}

/**
 * The holders of asks the APP raised itself, beside the ones a provider's run raises — registered at
 * startup (`registerPermissionGateway`) and never removed but by their own unregister.
 */
const appPermissionGateways = new Set<ProviderRuntimePermissionGateway>();

/**
 * Central registry for resolving concrete provider implementations by id.
 */
export const providerRegistry = {
  listProviders(): IProvider[] {
    return Object.values(allProviders());
  },

  /**
   * EVERY holder of an ask waiting on a person: each provider runtime's own permission gateway, then
   * each gateway the app registered for a prompt it raises itself (the dispatcher's plan prompts —
   * `dispatcher-asks.service.ts`). The one list every reader of pending asks walks — the chat
   * subscribe's `pendingPermissions`, an answer from the phone, the sidebar's yellow dot — so a
   * prompt that IS pending in a chat is answered, listed and marked by the very doors a tool
   * approval is. THE DISPATCHER'S GATEWAY IS THE EXCEPTION: it settles the phone's taps on a plan's
   * prompt and lists nothing at all, because a plan's prompt is pending in no chat — the card in the
   * Roadmap tab's In flight face and the phone are where it is answered.
   */
  listPermissionGateways(): ProviderRuntimePermissionGateway[] {
    const runtimes = Object.values(allProviders())
      .map((provider) => provider.runtime.permissions)
      .filter((gateway): gateway is ProviderRuntimePermissionGateway => gateway !== undefined);
    return [...runtimes, ...appPermissionGateways];
  },

  resolveProvider(provider: string): IProvider {
    const key = provider as LLMProvider;
    const resolvedProvider = allProviders()[key];
    if (!resolvedProvider) {
      throw new AppError(`Unsupported provider "${provider}".`, {
        code: 'UNSUPPORTED_PROVIDER',
        statusCode: 400,
      });
    }

    return resolvedProvider;
  },
};

// Used by the dispatcher module so a phone's tap on a plan's prompt goes through the same doors as a
// tool approval (`listPermissionGateways`) — a gateway that answers and recalls, and lists NOTHING,
// since a plan's prompt is pending in no chat. Answers the unregister, which the module's `stop` calls.
export function registerPermissionGateway(gateway: ProviderRuntimePermissionGateway): () => void {
  appPermissionGateways.add(gateway);
  return () => {
    appPermissionGateways.delete(gateway);
  };
}
