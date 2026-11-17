import React, { useState } from 'react';

import { cn } from '@/shared/utils';
import { Markdown } from '@/modules/chat/transcript/Markdown';

type ToolErrorDisplayProps = {
  /** Full error text; rendered as markdown when expanded. */
  content: string;
  /** Localized "Error" label shown in the header. */
  label: string;
};

/**
 * Collapsed-by-default error row for non-Bash tool results, matching the
 * command-row (`BashCommandDisplay`) look: a compact header with a one-line
 * preview; clicking the row expands it to the full error content. Errors are
 * signalled by the red styling — the details stay one click away.
 *
 * Rendered by chat's MessageComponent for failed tool results.
 */
export const ToolErrorDisplay: React.FC<ToolErrorDisplayProps> = ({ content, label }) => {
  const trimmedContent = content.trim();
  const hasContent = trimmedContent.length > 0;
  const [open, setOpen] = useState(false);

  const toggle = () => {
    if (hasContent) {
      setOpen((prev) => !prev);
    }
  };

  return (
    <div
      className={cn(
        'mt-2 overflow-hidden rounded-lg border border-[var(--danger-dot)] bg-[var(--danger-soft)] transition-all duration-200',
        open && 'shadow-sm',
      )}
    >
      <div
        role={hasContent ? 'button' : undefined}
        tabIndex={hasContent ? 0 : undefined}
        aria-expanded={hasContent ? open : undefined}
        onClick={toggle}
        onKeyDown={(event) => {
          if (hasContent && (event.key === 'Enter' || event.key === ' ')) {
            event.preventDefault();
            toggle();
          }
        }}
        className={cn(
          'flex items-center gap-2 px-2.5 py-1.5 outline-none',
          hasContent && 'cursor-pointer focus-visible:ring-1 focus-visible:ring-ring',
        )}
      >
        <svg
          className="h-3.5 w-3.5 flex-shrink-0 text-[var(--danger-ink)]"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
        <span className="flex-shrink-0 text-xs font-medium text-[var(--danger-ink)]">{label}</span>
        {!open && hasContent && (
          /* Not a <code>/<pre> tag: the global `.chat-message code` rule forces
             `white-space: pre-wrap !important`, which would defeat `truncate`. */
          <span className="min-w-0 flex-1 truncate text-xs text-[var(--danger-ink)]">
            {trimmedContent}
          </span>
        )}
      </div>

      {open && hasContent && (
        <div className="settings-content-enter border-t border-[var(--danger-dot)] px-3 py-2 text-sm text-[var(--danger-ink)]">
          <Markdown className="prose prose-sm prose-red max-w-none font-serif dark:prose-invert">
            {trimmedContent}
          </Markdown>
        </div>
      )}
    </div>
  );
};
