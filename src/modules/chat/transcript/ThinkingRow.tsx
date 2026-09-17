import { useState, type KeyboardEvent, type MouseEvent } from 'react';
import { Brain, Check, Copy } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { MARKDOWN_CARDS_CLASS } from '@/shared/constants';
import { cn, copyTextToClipboard } from '@/shared/utils';
import { useIsExportingTranscript } from '@/modules/chat/context/TranscriptRenderContext';
import { Markdown, TRANSCRIPT_PROSE } from '@/modules/chat/transcript/Markdown';
import { TOOL_ROW_FRAME, TOOL_ROW_HEADER, TOOL_ROW_LABEL, TOOL_ROW_SEPARATOR } from '@/modules/chat/tools/toolRow';

/**
 * The first line of a thought, read as plain words: the first line with text in it, with the
 * markdown marks a heading, list, quote or emphasis would leave in a one-line preview removed.
 */
function firstLineOf(content: string): string {
  // Structure lines — a code fence, a horizontal rule — say nothing about the thought.
  const line = content
    .split('\n')
    .find((candidate) => candidate.trim() && !/^\s*(```|~~~|([-*_])\s*\2\s*\2[\s\-*_]*$)/.test(candidate)) ?? '';
  return line
    .replace(/^\s*(#{1,6}\s+|[-*+]\s+|\d+\.\s+|>\s?)/, '')
    // Emphasis only where it is paired around words, so `__init__` keeps its underscores.
    .replace(/(\*\*|`)(\S(?:.*?\S)?)\1/g, '$2')
    .trim();
}

/**
 * One block of the model's thinking, drawn as a tool row: the same frame, height and order as a
 * Bash run — brain, "Thinking", `/`, the thought's first line truncated to the row, then the copy
 * button (always shown on a touch screen, which has no hover). The whole row toggles the full
 * text; there is no caret. Collapsed by default, since a thought is a note the model wrote to
 * itself rather than part of the answer. An export has nothing to click, so it is drawn open.
 *
 * Rendered by chat's MessageComponent for thinking messages.
 */
export function ThinkingRow({ content }: { content: string }) {
  const { t } = useTranslation('chat');
  const isExporting = useIsExportingTranscript();
  const [openState, setOpen] = useState(false);
  const open = openState || isExporting;
  const [copied, setCopied] = useState(false);
  const preview = firstLineOf(content);

  const toggle = () => setOpen((previous) => !previous);

  const handleCopy = async (event: MouseEvent) => {
    event.stopPropagation();
    if (!(await copyTextToClipboard(content))) return;
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      data-testid="thinking-row"
      className={cn(
        'group/think transition-all duration-200',
        TOOL_ROW_FRAME,
        open ? 'bg-muted/50 shadow-sm' : 'hover:border-border hover:bg-muted/60',
      )}
    >
      <div
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={toggle}
        onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
          if (event.target !== event.currentTarget) return;
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          toggle();
        }}
        className={cn(TOOL_ROW_HEADER, 'cursor-pointer select-none outline-none focus-visible:ring-1 focus-visible:ring-ring')}
      >
        <Brain aria-hidden className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
        <span className={TOOL_ROW_LABEL}>{t('thinking.card', { defaultValue: 'Thinking' })}</span>
        {preview && (
          <>
            <span className={TOOL_ROW_SEPARATOR}>/</span>
            <span dir="auto" className="min-w-0 flex-1 truncate text-xs text-muted-foreground" title={preview}>
              {preview}
            </span>
          </>
        )}
        {!isExporting && (
          <button
            type="button"
            onClick={handleCopy}
            onKeyDown={(event) => event.stopPropagation()}
            className="ml-auto flex-shrink-0 rounded p-0.5 text-muted-foreground/60 opacity-0 transition-all hover:bg-foreground/10 hover:text-foreground focus:opacity-100 group-hover/think:opacity-100 [@media(hover:none)]:opacity-100"
            title={t('thinking.copy', { defaultValue: 'Copy thinking' })}
            aria-label={t('thinking.copy', { defaultValue: 'Copy thinking' })}
          >
            {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
          </button>
        )}
      </div>

      {open && (
        <div className="pb-2 pl-8 pr-2.5">
          <Markdown className={cn(TRANSCRIPT_PROSE, 'prose-gray text-sm text-muted-foreground', MARKDOWN_CARDS_CLASS)}>
            {content}
          </Markdown>
        </div>
      )}
    </div>
  );
}

export default ThinkingRow;
