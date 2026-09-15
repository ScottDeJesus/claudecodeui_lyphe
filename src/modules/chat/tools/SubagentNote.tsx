import { memo } from 'react';
import { Brain, MessageSquareText } from 'lucide-react';

import type { SubagentActivity } from '@/shared/types';
import { cn } from '@/shared/utils';

/**
 * One prose or reasoning entry from the agent's own narration — the `text` and `thinking` entries
 * of a subagent's recorded timeline, as opposed to the tool calls `ToolRenderer` draws.
 *
 * Read by the chat module's `tools/SubagentPanel.tsx`, which draws that timeline inline under the
 * tool call that spawned the agent, and by `subagents/SubagentTranscriptView.tsx`, the Subagents
 * widget's read-on-demand transcript of the same agent. Moved here VERBATIM from `SubagentPanel.tsx`
 * when that second consumer arrived: same markup, same classes, so the panel and the widget cannot
 * disagree about what an agent's own words look like.
 */
export const SubagentNote = memo(({ activity }: { activity: SubagentActivity }) => {
  const isThinking = activity.kind === 'thinking';
  const Icon = isThinking ? Brain : MessageSquareText;

  return (
    <div className="flex gap-2 py-1">
      <Icon className={cn('mt-0.5 h-3 w-3 flex-shrink-0', isThinking ? 'text-muted-foreground/50' : 'text-muted-foreground/70')} />
      <div
        className={cn(
          'min-w-0 flex-1 whitespace-pre-wrap break-words text-xs leading-relaxed',
          isThinking ? 'italic text-muted-foreground/70' : 'text-muted-foreground',
        )}
      >
        {activity.content}
      </div>
    </div>
  );
});
SubagentNote.displayName = 'SubagentNote';
