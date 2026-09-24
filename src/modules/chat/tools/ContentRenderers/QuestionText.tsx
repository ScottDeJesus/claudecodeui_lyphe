import React, { useMemo } from 'react';

import { MarkdownContent } from '@/modules/chat/tools/ContentRenderers/MarkdownContent';
import { cn } from '@/shared/utils';

/** A line that opens a markdown list item: `1.`, `1)`, `-`, `*` or `+`, at most three spaces in. */
const LIST_ITEM_LINE = /^ {0,3}(?:\d{1,9}[.)]|[-*+])\s/;
const FENCE_LINE = /^ {0,3}(```|~~~)/;

/**
 * Gives a question's lists the blank lines a model leaves out.
 *
 * Questions arrive written line by line — a title, `1. …` to `8. …`, then `Run it? · lock:…` — with
 * single newlines only. Markdown reads that last line as a LAZY CONTINUATION of item 8, so the
 * closing question would render inside the list; and a list opening at anything but `1.` cannot
 * interrupt the paragraph above it. So a blank line goes in wherever an unindented plain line meets
 * a list, on either side. An indented line is left alone — that one really does continue its item —
 * and nothing inside a code fence is touched.
 */
function separateListBoundaries(text: string): string {
  const out: string[] = [];
  let inFence = false;
  let inList = false;
  let previousBlank = true;
  for (const line of text.split('\n')) {
    if (FENCE_LINE.test(line)) inFence = !inFence;
    const blank = line.trim() === '';
    if (!inFence && !blank) {
      const isItem = LIST_ITEM_LINE.test(line);
      const indented = /^\s/.test(line);
      if (isItem && !inList && !previousBlank) out.push('');
      if (!isItem && inList && !indented) out.push('');
      if (isItem) inList = true;
      else if (!indented) inList = false;
    }
    if (blank) inList = false;
    out.push(line);
    previousBlank = blank;
  }
  return out.join('\n');
}

const QUESTION_BODY_SIZE = { '--chat-font-size': '1rem' } as React.CSSProperties;

type QuestionTextProps = {
  text: string;
  className?: string;
};

/**
 * The words of an AskUserQuestion question, through the same markdown renderer as every tool
 * body: lists are real lists with a hanging indent, inline code is code, and each line the model
 * wrote stays its own line. Used by chat's AskUserQuestionPanel (pending) and AnsweredQuestion
 * (answered), so a question reads the same before and after it is answered.
 */
export const QuestionText: React.FC<QuestionTextProps> = ({ text, className }) => {
  const markdown = useMemo(() => separateListBoundaries(text), [text]);
  return (
    // `--chat-font-size` pinned to the root size: MarkdownContent sizes a tool body at 7/8 of the
    // reader's chat text, which at a large reading size drew the question half again as big as the
    // option rows under it. The card is one body size — the question reads, the options answer.
    <div data-question-text className={className} style={QUESTION_BODY_SIZE}>
      <MarkdownContent
        content={markdown}
        breaks
        className={cn(
          'prose prose-sm max-w-none text-foreground dark:prose-invert',
          // Body copy, not a heading: the question is read, the options are chosen.
          'prose-p:my-1.5 prose-ol:my-1.5 prose-ul:my-1.5 prose-li:my-0.5 [&>:first-child]:mt-0 [&>:last-child]:mb-0',
        )}
      />
    </div>
  );
};
