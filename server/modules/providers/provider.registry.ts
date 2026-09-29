import { ClaudeProvider } from '@/modules/providers/list/claude/claude.provider.js';
import { CodexProvider } from '@/modules/providers/list/codex/codex.provider.js';
import { CursorProvider } from '@/modules/providers/list/cursor/cursor.provider.js';
import { OpenCodeProvider } from '@/modules/providers/list/opencode/opencode.provider.js';
import type { IProvider } from '@/shared/interfaces.js';
import type { LLMProvider, ProviderRuntimePermissionGateway } from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';

const providers: Record<LLMProvider, IProvider> = {
  claude: new ClaudeProvider(),
  codex: new CodexProvider(),
  cursor: new CursorProvider(),
  opencode: new OpenCodeProvider(),
};

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
    return Object.values(providers);
  },

  /**
   * EVERY holder of an ask waiting on a person: each provider runtime's own permission gateway, then
   * each gateway the app registered for a prompt it raises itself (the dispatcher's plan prompts —
   * `dispatcher-asks.service.ts`). The one list every reader of pending asks walks — the chat
   * subscribe's `pendingPermissions`, an answer from the panel or the phone, the sidebar's yellow
   * dot — so a prompt the app raised is answered, listed and marked by the very doors a tool
   * approval is.
   */
  listPermissionGateways(): ProviderRuntimePermissionGateway[] {
    const runtimes = Object.values(providers)
      .map((provider) => provider.runtime.permissions)
      .filter((gateway): gateway is ProviderRuntimePermissionGateway => gateway !== undefined);
    return [...runtimes, ...appPermissionGateways];
  },

  resolveProvider(provider: string): IProvider {
    const key = provider as LLMProvider;
    const resolvedProvider = providers[key];
    if (!resolvedProvider) {
      throw new AppError(`Unsupported provider "${provider}".`, {
        code: 'UNSUPPORTED_PROVIDER',
        statusCode: 400,
      });
    }

    return resolvedProvider;
  },
};

// Used by the dispatcher module to put the plan prompts it raises in chats behind the same doors as a
// tool approval (`listPermissionGateways`). Answers the unregister, which the module's `stop` calls.
export function registerPermissionGateway(gateway: ProviderRuntimePermissionGateway): () => void {
  appPermissionGateways.add(gateway);
  return () => {
    appPermissionGateways.delete(gateway);
  };
}
