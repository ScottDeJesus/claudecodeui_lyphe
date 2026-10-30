import { onSessionsDeleted } from '@/modules/database/index.js';

import type { CompanionService } from '../companion.service.js';

/**
 * Her focus ends with its chat: when a chat row is deleted (the sidebar's delete, the synchronizer pruning a transcript that
 * vanished from disk, a project's delete), every account whose focus is that chat drops it (`companion.service.ts`,
 * `chatDeleted`) and its pages hear `companion_focus` null. It rides the table's own announcement
 * (`database/repositories/session-deletion.ts`), so nothing polls and nothing here has to know which door deleted the chat.
 *
 * Without it the focus kept naming a chat nobody could open: her header read "Focus · <name>", the focus feed waited on runs that
 * would never come, and the only thing that emptied it was her Clear, which wipes her whole conversation.
 *
 * Consumers: `companion.module.ts` (`startDeletedChatFeed`); `stop` is what the module's own `stop()` calls first.
 */
export function startDeletedChatFeed(service: CompanionService): () => void {
  return onSessionsDeleted((sessionIds) => {
    for (const sessionId of sessionIds) service.chatDeleted(sessionId);
  });
}
