import { memo, useMemo, useState } from 'react';

import type { ChatMessage, ClaudePermissionSuggestion, PermissionGrantResult, LLMProvider,DiffLine,DiffStats,Project,ToolGroupItem } from '@/shared/types';
import { ToolOutcomeBadge, deriveToolOutcome, getToolConfig } from '@/modules/chat/tools';
import { ToolRowIcon } from '@/modules/chat/tools/ToolRowIcon';
import {
  TOOL_ROW_FRAME,
  TOOL_ROW_HEADER,
  TOOL_ROW_LABEL,
  TOOL_ROW_SEPARATOR,
} from '@/modules/chat/tools/toolRow';
import type { ReadToolPermissionState } from '@/modules/chat/hooks/useToolPermissionState';
import MessageComponent from '@/modules/chat/transcript/MessageComponent';
import { useIsExportingTranscript } from '@/modules/chat/context/TranscriptRenderContext';
import { DiffStatsBadge } from '@/modules/chat/tools/DiffStatsBadge';
import { parseToolPayload, summarizeDiff } from '@/modules/chat/utils/messageTransforms';

type ToolGroupContainerProps = {
  group: ToolGroupItem;
  prevMessage: ChatMessage | null;
  createDiff: (oldStr: string, newStr: string) => DiffLine[];
  getMessageKey: (message: ChatMessage) => string;
  onFileOpen?: (filePath: string, diffInfo?: unknown) => void;
  onShowSettings?: () => void;
  onGrantToolPermission?: (suggestion: ClaudePermissionSuggestion) => PermissionGrantResult | null | undefined;
  showRawParameters?: boolean;
  showThinking?: boolean;
  selectedProject?: Project | null;
  provider: LLMProvider | string;
  /** Asks whether a call in this run is blocked on a person, or was allowed by one. */
  readToolPermissionState?: ReadToolPermissionState;
};

/**
 * Totals the lines a run of file edits added and removed.
 *
 * A collapsed group hides every individual diff behind `x4`, so without this
 * the one thing the row could usefully say about a batch of edits — how big it
 * is — is the one thing it did not. Returns null for groups of tools that do
 * not render a diff at all.
 */
function useGroupDiffStats(
  toolName: string,
  messages: ChatMessage[],
  createDiff: (oldStr: string, newStr: string) => DiffLine[],
): DiffStats | null {
  return useMemo(() => {
    const config = getToolConfig(toolName).input;
    if (config.contentType !== 'diff' || !config.getContentProps) {
      return null;
    }

    let added = 0;
    let removed = 0;
    let counted = 0;

    for (const message of messages) {
      const contentProps = config.getContentProps(parseToolPayload(message.toolInput) ?? {});
      if (typeof contentProps?.oldContent !== 'string' || typeof contentProps?.newContent !== 'string') {
        continue;
      }

      const stats = summarizeDiff(createDiff(contentProps.oldContent, contentProps.newContent));
      added += stats.added;
      removed += stats.removed;
      counted += 1;
    }

    return counted > 0 ? { added, removed } : null;
  }, [createDiff, messages, toolName]);
}

/**
 * Rendered by chat's ChatMessagesPane to collapse a run of consecutive tool
 * calls into a single expandable group in the transcript. The row reads like
 * every other tool row: icon, label `xN`, diff counts, `/`, preview, then the
 * outcome rightmost. The whole row is the toggle.
 */
function ToolGroupContainer({
  group,
  prevMessage,
  createDiff,
  getMessageKey,
  onFileOpen,
  onShowSettings,
  onGrantToolPermission,
  showRawParameters,
  showThinking,
  selectedProject,
  provider,
  readToolPermissionState,
}: ToolGroupContainerProps) {
  const isExporting = useIsExportingTranscript();
  // Collapsed on screen, always open in an export: the whole point of the
  // group row is to hide detail the reader can ask for, and an exported file
  // has no way to ask.
  const [isExpanded, setIsExpanded] = useState(false);
  const showChildren = isExpanded || isExporting;
  const config = getToolConfig(group.toolName).input;
  const label = config.label || group.toolName;
  const iconClass = config.colorScheme?.icon || 'text-muted-foreground';

  const preview = group.preview;
  const groupDiffStats = useGroupDiffStats(group.toolName, group.messages, createDiff);

  // The collapsed row hides every call in the run, so the one thing it must not
  // get wrong is whether the run is finished. A single blocked call makes the
  // whole row say so; "done" needs every call to have come back.
  const states = group.messages.map(
    (message) => readToolPermissionState?.(message.toolName, message.toolInput) ?? 'idle',
  );
  const outcome = deriveToolOutcome({
    permissionState: states.includes('waiting')
      ? 'waiting'
      : states.includes('prompted') ? 'prompted' : 'idle',
    hasResult: group.messages.every((message) => Boolean(message.toolResult)),
    isError: group.messages.some((message) => Boolean(message.toolResult?.isError)),
  });

  return (
    <div className="chat-message tool px-3 sm:px-0" data-message-timestamp={group.timestamp || undefined}>
      <div className={TOOL_ROW_FRAME}>
        <button
          type="button"
          className={`${TOOL_ROW_HEADER} group w-full text-left transition-colors hover:bg-muted/60`}
          onClick={() => setIsExpanded((current) => !current)}
          aria-expanded={isExpanded}
        >
          <ToolRowIcon icon={config.icon} className={iconClass} />
          <span className={TOOL_ROW_LABEL}>{label}</span>
          <span className="flex-shrink-0 rounded-full bg-muted px-1.5 py-px text-[10px] font-medium text-muted-foreground">
            x{group.messages.length}
          </span>
          {groupDiffStats && <DiffStatsBadge stats={groupDiffStats} className="flex-shrink-0" />}
          {preview && (
            <>
              <span className={TOOL_ROW_SEPARATOR}>/</span>
              <span className={`min-w-0 truncate text-xs text-muted-foreground ${config.style === 'terminal' ? '' : 'font-mono'}`}>{preview}</span>
            </>
          )}
          {outcome && (
            // `whitespace-nowrap` because the preview beside it is greedy: without it the
            // words of "Waiting for you" break onto separate lines and the row grows a second line.
            <span className="ml-auto inline-flex flex-shrink-0 items-center whitespace-nowrap pl-2">
              <ToolOutcomeBadge outcome={outcome} />
            </span>
          )}
        </button>

        {showChildren && (
          <div className="space-y-3 border-t border-border px-3 py-3 sm:space-y-4">
            {group.messages.map((message, index) => (
              <MessageComponent
                key={getMessageKey(message)}
                message={message}
                prevMessage={index > 0 ? group.messages[index - 1] : prevMessage}
                createDiff={createDiff}
                onFileOpen={onFileOpen}
                onShowSettings={onShowSettings}
                onGrantToolPermission={onGrantToolPermission}
                showRawParameters={showRawParameters}
                showThinking={showThinking}
                selectedProject={selectedProject}
                provider={provider}
                readToolPermissionState={readToolPermissionState}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Memoized for the transcript re-renders that are not message changes — the
 * pane re-renders when isProcessing or the activity indicator flips, and the
 * group is unchanged then.
 *
 * It cannot bail during streaming: groupConsecutiveTools rebuilds every group
 * object from a fresh visibleMessages array on each 100ms tick, so `group` is a
 * new reference even when its contents are identical. Stabilizing it would mean
 * keying a cache on the whole run — first and second message identity, run
 * length and showThinking — because the preview depends on all four.
 */
export default memo(ToolGroupContainer);
