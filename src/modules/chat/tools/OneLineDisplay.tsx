import React, { useState } from 'react';

import { cn, copyTextToClipboard } from '@/shared/utils';
import { ToolStatusBadge } from '@/modules/chat/tools/ToolStatusBadge';
import { ToolOutcomeBadge } from '@/modules/chat/tools/ToolOutcomeBadge';
import { ToolRowIcon } from '@/modules/chat/tools/ToolRowIcon';
import type { ToolOutcome } from '@/modules/chat/tools/toolOutcome';
import {
  TOOL_ROW_FRAME,
  TOOL_ROW_HEADER,
  TOOL_ROW_LABEL,
  TOOL_ROW_SEPARATOR,
} from '@/modules/chat/tools/toolRow';
import { useIsExportingTranscript } from '@/modules/chat/context/TranscriptRenderContext';
import type { ToolStatus } from '@/shared/types';

type ActionType = 'copy' | 'open-file' | 'jump-to-results' | 'none';

type OneLineDisplayProps = {
  toolName: string;
  icon?: string;
  label?: string;
  value: string;
  secondary?: string;
  action?: ActionType;
  onAction?: () => void;
  wrapText?: boolean;
  colorScheme?: {
    primary?: string;
    secondary?: string;
    background?: string;
    icon?: string;
  };
  resultId?: string;
  toolResult?: any;
  toolId?: string;
  status?: ToolStatus;
  /** What the row can say happened to it, in words; null while there is nothing positive to say. */
  outcome?: ToolOutcome | null;
  /** The call's result when nothing else draws it (a Read's file text), opened by clicking the row. */
  detail?: string;
};

/**
 * Unified one-line row for simple tool inputs: icon, label, `/`, value, then the
 * copy button and line count, with the outcome rightmost. When the call's result is
 * drawn nowhere else, clicking the row opens it inline.
 * Used by: Read, Grep/Glob, WebSearch/WebFetch, PowerShell, TodoRead, etc.
 *
 * Rendered by chat's ToolRenderer for tools configured as single-line.
 */
export const OneLineDisplay: React.FC<OneLineDisplayProps> = ({
  toolName,
  icon,
  label,
  value,
  secondary,
  action = 'none',
  onAction,
  wrapText = false,
  colorScheme = {
    primary: 'text-foreground',
    secondary: 'text-muted-foreground',
    background: '',
    icon: 'text-muted-foreground',
  },
  toolResult,
  toolId,
  status,
  outcome = null,
  detail,
}) => {
  const [copied, setCopied] = useState(false);
  const trimmedDetail = (detail || '').replace(/\s+$/, '');
  const canExpand = trimmedDetail.length > 0;
  const detailLineCount = canExpand ? trimmedDetail.split('\n').length : 0;
  // A document has nothing to click, so an export shows the detail open.
  const isExporting = useIsExportingTranscript();
  const [openState, setOpen] = useState(false);
  const open = canExpand && (openState || isExporting);

  const toggle = () => {
    if (canExpand) {
      setOpen((prev) => !prev);
    }
  };

  const handleAction = async (event: React.MouseEvent) => {
    event.stopPropagation();
    if (action === 'copy' && value) {
      const didCopy = await copyTextToClipboard(value);
      if (!didCopy) return;
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } else if (onAction) {
      onAction();
    }
  };

  const stopKey = (event: React.KeyboardEvent) => event.stopPropagation();

  const body = action === 'open-file'
    ? (
      <button
        onClick={handleAction}
        onKeyDown={stopKey}
        className="min-w-0 truncate text-left font-mono text-xs text-primary transition-colors hover:text-primary/80 hover:underline"
        title={value}
      >
        {value.split('/').pop() || value}
      </button>
    )
    : (
      <>
        <span className={cn('min-w-0 flex-1 font-mono text-xs', wrapText ? 'whitespace-pre-wrap break-all' : 'truncate', colorScheme.primary)}>
          {value}
        </span>
        {secondary && (
          <span className={cn('flex-shrink-0 text-[11px] italic', colorScheme.secondary || 'text-muted-foreground/60')}>
            {secondary}
          </span>
        )}
      </>
    );

  return (
    <div className={TOOL_ROW_FRAME}>
      <div
        role={canExpand ? 'button' : undefined}
        tabIndex={canExpand ? 0 : undefined}
        aria-expanded={canExpand ? open : undefined}
        onClick={toggle}
        onKeyDown={(event) => {
          if (canExpand && (event.key === 'Enter' || event.key === ' ')) {
            event.preventDefault();
            toggle();
          }
        }}
        className={cn(
          TOOL_ROW_HEADER,
          'group outline-none',
          colorScheme.background,
          canExpand && 'cursor-pointer focus-visible:ring-1 focus-visible:ring-ring',
        )}
      >
        <ToolRowIcon icon={icon} className={colorScheme.icon} />
        <span className={TOOL_ROW_LABEL}>{label || toolName}</span>
        <span className={TOOL_ROW_SEPARATOR}>/</span>
        {body}

        <span className="ml-auto flex flex-shrink-0 items-center gap-2 pl-2">
          {action === 'jump-to-results' && toolResult && (
            <a
              href={`#tool-result-${toolId}`}
              onClick={(event) => event.stopPropagation()}
              className="flex flex-shrink-0 items-center gap-0.5 text-[11px] text-primary transition-colors hover:text-primary/80"
            >
              <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </a>
          )}
          {action === 'copy' && (
            <button
              onClick={handleAction}
              onKeyDown={stopKey}
              className="flex-shrink-0 text-muted-foreground/40 opacity-0 transition-all hover:text-muted-foreground group-hover:opacity-100"
              title="Copy to clipboard"
              aria-label="Copy to clipboard"
            >
              {copied ? (
                <svg className="h-3 w-3 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
              )}
            </button>
          )}
          {canExpand && !open && (
            <span className="text-[10px] tabular-nums text-muted-foreground/70">
              {detailLineCount} {detailLineCount === 1 ? 'line' : 'lines'}
            </span>
          )}
          {/* The outcome is always the row's rightmost mark. */}
          {status && <ToolStatusBadge status={status} />}
          {outcome && <ToolOutcomeBadge outcome={outcome} />}
        </span>
      </div>

      {open && (
        <div className="settings-content-enter border-t border-border/50 bg-background/50">
          <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-all px-3 py-2 font-mono text-xs leading-relaxed text-muted-foreground">
            {trimmedDetail}
          </pre>
        </div>
      )}
    </div>
  );
};
