import type { ChatMessage } from '@/shared/types';
import type { ReadToolPermissionState } from '@/modules/chat/hooks/useToolPermissionState';

/**
 * Tool calls that stay on screen with "Show work" off, because the person has to act
 * on them: a question to answer, a plan to build or revise.
 */
const TOOLS_THAT_NEED_THE_PERSON = new Set(['AskUserQuestion', 'ExitPlanMode']);

/**
 * True for a message that is the agent's work rather than the conversation — a tool
 * call, a standalone tool result, a task notice. "Show work" off hides exactly these.
 *
 * A call blocked on a permission prompt is never hidden: the person has to see what
 * they are being asked to allow.
 *
 * Used by chat's ChatMessagesPane, before grouping, so a hidden run never leaves an
 * empty group row behind.
 */
export function isHiddenWork(message: ChatMessage, readToolPermissionState?: ReadToolPermissionState): boolean {
  if (message.isToolUse) {
    if (message.toolName && TOOLS_THAT_NEED_THE_PERSON.has(message.toolName)) {
      return false;
    }
    return readToolPermissionState?.(message.toolName, message.toolInput) !== 'waiting';
  }

  return Boolean(
    message.isTaskNotification
    || message.isTaskResult
    || message.isOrphanToolResult
    || message.type === 'tool',
  );
}
