import { providerRuntimeService } from '@/modules/providers/index.js';

import { codeModeService } from './code-mode.service.js';

/**
 * Registers Code Mode's two hooks with the Claude runtime at boot. The runtime reads them at call time through its context and imports nothing from this module (MAN-8487): inert until this runs, live from then on. Whether a chat is in Code Mode is the house's answer (`~/.claude/scripts/code-mode config --chat`, its `chats` switch), so this module mounts no route and draws nothing.
 */
export function createCodeModeModule(): void {
  providerRuntimeService.useChatCodeMode({ launchFor: codeModeService.launchFor, serversChanged: codeModeService.serversChanged });
}
