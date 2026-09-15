import React from 'react';

import { Markdown } from '@/modules/chat/transcript/Markdown';
import { MARKDOWN_CARDS_CLASS } from '@/shared/constants';
import { cn } from '@/shared/utils';

type MarkdownContentProps = {
  content: string;
  className?: string;
};

/**
 * Renders markdown content with proper styling
 * Used by: exit_plan_mode, long text results, etc.
 *
 * Rendered by chat's ToolRenderer, PlanDisplay and SubagentPanel as the
 * markdown body of a tool result.
 */
export const MarkdownContent: React.FC<MarkdownContentProps> = ({
  content,
  className = 'mt-1 prose prose-sm max-w-none dark:prose-invert'
}) => {
  return (
    // `text-chat-tool` is the tool body's base size — 7/8 of the reader's chat text size, the same
    // ratio `prose-sm` drew at the default 16px, but following the setting when it changes.
    <Markdown className={cn(className, MARKDOWN_CARDS_CLASS, 'text-chat-tool')}>
      {content}
    </Markdown>
  );
};
