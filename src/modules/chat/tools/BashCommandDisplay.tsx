import React, { useEffect, useRef, useState } from 'react';
import { Copy, Check } from 'lucide-react';

import { cn,copyTextToClipboard } from '@/shared/utils';
import { ToolStatusBadge } from '@/modules/chat/tools/ToolStatusBadge';
import { ToolOutcomeBadge } from '@/modules/chat/tools/ToolOutcomeBadge';
import type { ToolOutcome } from '@/modules/chat/tools/toolOutcome';
import { ToolRowIcon } from '@/modules/chat/tools/ToolRowIcon';
import {
  TOOL_ROW_FRAME,
  TOOL_ROW_HEADER,
  TOOL_ROW_LABEL,
  TOOL_ROW_SEPARATOR,
} from '@/modules/chat/tools/toolRow';
import { useIsExportingTranscript } from '@/modules/chat/context/TranscriptRenderContext';
import type { ToolStatus } from '@/shared/types';

type BashCommandDisplayProps = {
  /** The tool's name as the row shows it. */
  label?: string;
  command: string;
  description?: string;
  /** Combined stdout/stderr from the tool result (empty while running). */
  output?: string;
  isError?: boolean;
  status?: ToolStatus;
  /** What the row can say happened to it, in words; null while there is nothing positive to say. */
  outcome?: ToolOutcome | null;
  defaultOpen?: boolean;
};

/**
 * One shell run as a compact row that leads with what it is doing: the
 * model's description is the headline, and the command line itself sits
 * behind the chevron with the output. A run with no description falls back to
 * the command as its headline. Theme-integrated surfaces keep it clean in both
 * light and dark mode; consecutive runs stack tightly into a clean list.
 *
 * Rendered by chat's ToolRenderer for shell tools (Bash and friends).
 */
export const BashCommandDisplay: React.FC<BashCommandDisplayProps> = ({
  label = 'Bash',
  command,
  description,
  output,
  isError = false,
  status,
  outcome = null,
  defaultOpen = false,
}) => {
  const trimmedOutput = (output || '').replace(/\s+$/, '');
  const hasOutput = trimmedOutput.length > 0;
  const outputLineCount = hasOutput ? trimmedOutput.split('\n').length : 0;
  const isRunning = status === 'running';
  const headline = (description || '').trim();
  // With a description in the header, the command is hidden detail too, so the
  // row expands even before any output has come back.
  const canExpand = hasOutput || Boolean(headline && command);
  // `open` is raised by an effect once output arrives (below). A document is
  // rendered without effects, so it would show every command and no output.
  const isExporting = useIsExportingTranscript();
  const [openState, setOpen] = useState(false);
  const open = openState || isExporting;
  const [copied, setCopied] = useState(false);

  // Output often arrives after this component first mounts, so apply the
  // auto-open intent once when there is finally something to show. After that
  // the user is in control of the toggle. Errors intentionally do NOT
  // auto-expand — the red border and status badge already signal the failure,
  // and the output stays one click away.
  const autoAppliedRef = useRef(false);
  useEffect(() => {
    if (!autoAppliedRef.current && hasOutput && defaultOpen) {
      autoAppliedRef.current = true;
      setOpen(true);
    }
  }, [hasOutput, defaultOpen]);

  const toggle = () => {
    if (canExpand) {
      setOpen((prev) => !prev);
    }
  };

  const handleCopy = async (event: React.MouseEvent) => {
    event.stopPropagation();
    const didCopy = await copyTextToClipboard(command);
    if (!didCopy) return;
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      className={cn(
        'group/cmd backdrop-blur-sm transition-all duration-200',
        TOOL_ROW_FRAME,
        isError && 'border-red-500/30',
        canExpand && !open && 'hover:border-border hover:bg-muted/60',
        open && 'bg-muted/50 shadow-sm',
      )}
    >
      {/* Header — clickable when there is detail to expand */}
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
          'outline-none',
          canExpand && 'cursor-pointer focus-visible:ring-1 focus-visible:ring-ring',
        )}
      >
        <ToolRowIcon icon="terminal" className="text-emerald-500 dark:text-emerald-400" />
        <span className={TOOL_ROW_LABEL}>{label}</span>
        <span className={TOOL_ROW_SEPARATOR}>/</span>
        {/* Not a <code> tag: the global `.chat-message code` rule forces
            `white-space: pre-wrap !important`, which would defeat `truncate`
            and render collapsed multi-line commands in full. */}
        {headline ? (
          <span className="min-w-0 flex-1 truncate text-xs text-foreground">{headline}</span>
        ) : (
          <span
            className={cn(
              'min-w-0 flex-1 font-mono text-xs text-foreground',
              open ? 'whitespace-pre-wrap break-all' : 'truncate',
            )}
          >
            {command}
          </span>
        )}

        {isRunning && (
          <span className="h-2.5 w-2.5 flex-shrink-0 animate-spin rounded-full border-[1.5px] border-muted-foreground/30 border-t-emerald-400" />
        )}
        <button
          onClick={handleCopy}
          onKeyDown={(event) => event.stopPropagation()}
          className="flex-shrink-0 rounded p-0.5 text-muted-foreground/60 opacity-0 transition-all hover:bg-foreground/10 hover:text-foreground focus:opacity-100 group-hover/cmd:opacity-100"
          title="Copy command"
          aria-label="Copy command"
        >
          {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
        </button>

        {!open && hasOutput && !isRunning && (
          <span className="flex-shrink-0 text-[10px] tabular-nums text-muted-foreground/70">
            {outputLineCount} {outputLineCount === 1 ? 'line' : 'lines'}
          </span>
        )}

        {/* The outcome is always the row's rightmost mark. */}
        {status && status !== 'running' && <ToolStatusBadge status={status} className="flex-shrink-0" />}
        {outcome && (
          <span className="flex flex-shrink-0 items-center">
            <ToolOutcomeBadge outcome={outcome} />
          </span>
        )}
      </div>

      {/* Expanded detail: the command (when the header showed the description), then the output */}
      {open && canExpand && (
        <div className="settings-content-enter border-t border-border/50 bg-background/50">
          {headline && command && (
            <div
              className={cn(
                'whitespace-pre-wrap break-all px-3 pt-2 font-mono text-xs text-foreground',
                !hasOutput && 'pb-2',
              )}
            >
              <span className="select-none font-semibold text-emerald-500 dark:text-emerald-400">$ </span>
              {command}
            </div>
          )}
          {hasOutput && (
            <pre
              className={cn(
                'max-h-80 overflow-auto whitespace-pre-wrap break-all px-3 py-2 font-mono text-xs leading-relaxed',
                isError ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground',
              )}
            >
              {trimmedOutput}
            </pre>
          )}
        </div>
      )}
    </div>
  );
};
