import { memo, useMemo, useState } from 'react';
import { Bot } from 'lucide-react';

import type { DiffLine, LLMProvider, Project, SubagentActivity, SubagentInfo, SubagentUsage, ToolResult } from '@/shared/types';
import { Badge, LLMProviderLogo } from '@/shared/ui';
import { cn } from '@/shared/utils';
import { SubagentNote } from '@/modules/chat/tools/SubagentNote';
import { ToolRenderer } from '@/modules/chat/tools/ToolRenderer';
import { useIsExportingTranscript } from '@/modules/chat/context/TranscriptRenderContext';
import { MarkdownContent } from '@/modules/chat/tools/ContentRenderers/MarkdownContent';
import { TOOL_ROW_FRAME, TOOL_ROW_HEADER, TOOL_ROW_LABEL, TOOL_ROW_SEPARATOR } from '@/modules/chat/tools/toolRow';
import {
  describeSubagentUsage,
  formatSubagentFinishTime,
  parseSubagentToolInput,
  readSubagentSummary,
  subagentMarkProvider,
} from '@/modules/chat/utils/subagentSummary';

type SubagentPanelProps = {
  /** Raw tool input of the call that spawned the agent, used for the prompt. */
  toolInput: unknown;
  toolResult?: ToolResult | null;
  /** When that result landed, which is when the agent finished. */
  toolResultAt?: string | number | Date;
  subagent?: SubagentInfo;
  activity?: SubagentActivity[];
  /** What the agent has spent, when its provider records usage. */
  usage?: SubagentUsage;
  /** The session's provider; with the agent's own model it decides the row's mark. */
  provider?: LLMProvider;
  /** The model the agent ran on, live or from history (`ChatMessage.subagentModel`). */
  model?: string;
  onFileOpen?: (filePath: string, diffInfo?: unknown) => void;
  createDiff: (oldStr: string, newStr: string) => DiffLine[];
  selectedProject?: Project | null;
};

/**
 * How many timeline entries are drawn before the "show more" step. A single
 * entry can expand into a diff viewer, so an agent with a long run would
 * otherwise mount hundreds of tool renderers the moment it is opened.
 */
const INITIALLY_RENDERED_ACTIVITIES = 25;

/**
 * Unwraps the block-array shape agent results sometimes arrive in
 * (`[{ type: 'text', text }]`) so the answer renders as markdown rather than
 * as JSON.
 */
function readResultText(content: unknown): string {
  if (Array.isArray(content)) {
    return content
      .filter((part) => typeof part === 'object' && part !== null && (part as { type?: string }).type === 'text')
      .map((part) => String((part as { text?: string }).text ?? ''))
      .join('\n\n');
  }

  const text = typeof content === 'string' ? content : content == null ? '' : JSON.stringify(content);
  const trimmed = text.trim();
  if (trimmed.startsWith('[')) {
    try {
      return readResultText(JSON.parse(trimmed));
    } catch {
      return text;
    }
  }
  return text;
}

/** An ended agent's outcome as the tool rows' compact pill. A Stop or an interrupt is not a failure, so it is not red. */
const ENDED_BADGE: Record<Exclude<SubagentInfo['status'], 'running'>, { label: string; tone: 'positive' | 'danger' | 'warn' }> = {
  completed: { label: 'Finished', tone: 'positive' },
  failed: { label: 'Failed', tone: 'danger' },
  stopped: { label: 'Stopped', tone: 'warn' },
};

/**
 * Rendered by chat's MessageComponent for any tool call that spawned a
 * subagent — Claude's `Agent`/`Task` and Codex's `spawn_agent` both normalize
 * to the same shape, so both render through this one panel.
 *
 * It wears the tool rows' frame (`toolRow.ts`) — the same pill, height and order as a Bash run: the
 * mark of the provider the agent ran on, its name, `/`, what it was asked to do, then its figures
 * and its outcome. The whole row toggles the timeline; there is no caret and no coloured stripe.
 *
 * The timeline is mounted only while the panel is open. The shared Collapsible
 * keeps its children mounted when closed, which for an agent that ran a
 * hundred tools would mean a hundred tool renderers on a collapsed row.
 */
export const SubagentPanel = memo(({
  toolInput,
  toolResult,
  toolResultAt,
  subagent,
  activity,
  usage,
  provider,
  model,
  onFileOpen,
  createDiff,
  selectedProject,
}: SubagentPanelProps) => {
  // Collapsed by default: an agent is a summary of work, and its detail is
  // only wanted on demand.
  const isExporting = useIsExportingTranscript();
  const [isOpen, setIsOpen] = useState(false);
  const showTimeline = isOpen || isExporting;
  // Raised by the "show more" step so a long run can be inspected in full
  // without paying for it up front.
  const [renderLimit, setRenderLimit] = useState(INITIALLY_RENDERED_ACTIVITIES);
  const effectiveRenderLimit = isExporting ? Number.POSITIVE_INFINITY : renderLimit;

  const parsedInput = useMemo(() => parseSubagentToolInput(toolInput), [toolInput]);
  const resultText = useMemo(() => readResultText(toolResult?.content), [toolResult?.content]);

  const entries = activity ?? [];
  // The same reading the pinned bar takes, so the two can never disagree about whether this
  // agent is still going. Claude names its agent presets (Explore, Plan); Codex has none, so
  // the neutral label carries and the assigned nickname shows alongside it.
  const summary = readSubagentSummary({
    toolInput,
    toolResult,
    toolResultAt,
    subagent,
    activity,
    usage,
  });
  const { status, label, nickname, description, toolCount, finishedAt } = summary;
  const finishTime = formatSubagentFinishTime(finishedAt);
  const tokens = describeSubagentUsage(summary.usage);
  const prompt = String(parsedInput.prompt ?? '');
  // The backend truncates very long timelines for transport; say so rather
  // than implying the agent stopped where the list does.
  const untransmittedCount = Math.max(0, (subagent?.activityCount ?? entries.length) - entries.length);
  const visibleEntries = entries.slice(0, effectiveRenderLimit);
  const hiddenCount = entries.length - visibleEntries.length;
  const markProvider = subagentMarkProvider(provider, model);
  // The tool count shows while running too, as the pinned row does: it is how far the agent has got.
  const toolFigure = toolCount > 0 ? `${toolCount} ${toolCount === 1 ? 'tool' : 'tools'}` : null;
  const endFigure = status !== 'running' ? finishTime || null : null;

  return (
    <div
      data-testid="subagent-row"
      data-status={status}
      data-provider={markProvider}
      className={cn(
        'subagent-row group/agent transition-all duration-200',
        TOOL_ROW_FRAME,
        isOpen ? 'bg-muted/50 shadow-sm' : 'hover:border-border hover:bg-muted/60',
      )}
    >
      <button
        type="button"
        aria-expanded={showTimeline}
        onClick={() => setIsOpen((previous) => !previous)}
        className={cn(TOOL_ROW_HEADER, 'w-full select-none text-left outline-none focus-visible:ring-1 focus-visible:ring-ring')}
      >
        {/* Defensive: a normalized message always carries its provider. The robot stands in only when
          * none is known, because `LLMProviderLogo` would otherwise dress it in Claude's mark. */}
        {markProvider ? (
          <LLMProviderLogo provider={markProvider} className="h-3.5 w-3.5 flex-shrink-0" />
        ) : (
          <Bot aria-hidden className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
        )}
        <span className={TOOL_ROW_LABEL}>{label || 'Agent'}</span>
        {description && (
          <>
            <span className={TOOL_ROW_SEPARATOR}>/</span>
            <span className="min-w-0 flex-1 truncate text-xs text-foreground">{description}</span>
          </>
        )}
        {nickname && (
          <span className="flex-shrink-0 rounded bg-muted px-1 text-[10px] text-muted-foreground/70">{nickname}</span>
        )}
        <span className="ml-auto flex flex-shrink-0 items-center gap-2 pl-2">
          {status === 'running' && (
            <span className="h-2.5 w-2.5 flex-shrink-0 animate-spin rounded-full border-[1.5px] border-muted-foreground/30 border-t-emerald-400" />
          )}
          {status === 'running' && <span className="text-[10px] text-muted-foreground/70">running</span>}
          {/* The figures give way when the ROW is narrow (`.subagent-row__figures`, a container query in
            * index.css) — not the window: at 768px the sidebar takes a third of the column. The row
            * keeps what it was asked and its outcome rather than clipping both off its own frame; the
            * pinned row still carries the figures. */}
          {(toolFigure || tokens || endFigure) && (
            <span className="subagent-row__figures text-[10px] tabular-nums text-muted-foreground/70">
              {[
                toolFigure && <span key="tools">{toolFigure}</span>,
                tokens && <span key="tokens" title={tokens.long}>{tokens.short}</span>,
                endFigure && <span key="end">{endFigure}</span>,
              ]
                .filter(Boolean)
                .flatMap((part, index) => (index === 0 ? [part] : [<span key={`sep-${index}`}> · </span>, part]))}
            </span>
          )}
          {status !== 'running' && (
            <Badge tone={ENDED_BADGE[status].tone} className="vv-badge--compact">{ENDED_BADGE[status].label}</Badge>
          )}
        </span>
      </button>

      {showTimeline && (
        <div className="settings-content-enter space-y-2 border-t border-border/50 bg-background/50 px-3 py-2">
          {subagent?.model && (
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground/50">{subagent.model}</div>
          )}

          {prompt && (
            <div className="rounded border border-border/40 bg-muted/40 p-2 text-xs text-muted-foreground">
              <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground/60">Task</div>
              <div className="line-clamp-6 whitespace-pre-wrap break-words">{prompt}</div>
            </div>
          )}

          {visibleEntries.length > 0 && (
            <div className="border-l border-border/60 pl-2">
              {visibleEntries.map((entry, index) => (
                entry.kind === 'tool' ? (
                  // Rendered through the same router the main thread uses, so a
                  // subagent's shell command or diff looks exactly like one the
                  // top-level agent ran.
                  <ToolRenderer
                    key={entry.toolId ?? `activity-${index}`}
                    toolName={entry.toolName || 'UnknownTool'}
                    toolInput={entry.toolInput}
                    toolResult={entry.toolResult}
                    toolId={entry.toolId}
                    mode="input"
                    onFileOpen={onFileOpen}
                    createDiff={createDiff}
                    selectedProject={selectedProject}
                  />
                ) : (
                  <SubagentNote key={`activity-${index}`} activity={entry} />
                )
              ))}
            </div>
          )}

          {hiddenCount > 0 && (
            <button
              type="button"
              onClick={() => setRenderLimit((previous) => previous + INITIALLY_RENDERED_ACTIVITIES * 4)}
              className="text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            >
              Show {hiddenCount} more {hiddenCount === 1 ? 'step' : 'steps'}
            </button>
          )}

          {untransmittedCount > 0 && hiddenCount === 0 && (
            <div className="text-[11px] text-muted-foreground/60">
              {untransmittedCount} earlier {untransmittedCount === 1 ? 'step is' : 'steps are'} not included
            </div>
          )}

          {resultText && (
            <div className="rounded border border-border/40 bg-muted/30 p-2">
              <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground/60">Result</div>
              <MarkdownContent content={resultText} className="prose prose-sm max-w-none dark:prose-invert" />
            </div>
          )}
        </div>
      )}
    </div>
  );
});
SubagentPanel.displayName = 'SubagentPanel';
