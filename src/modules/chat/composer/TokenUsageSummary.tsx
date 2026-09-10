import { memo } from 'react';
import { CoinsIcon } from 'lucide-react';

import { cn } from '@/shared/utils';

/**
 * What a surface needs to draw the count somewhere other than the composer: the session's
 * usage and the handler that opens the breakdown. ChatInterface hands one of these up to the
 * workspace so the mobile header can carry the count while the composer hides its own copy.
 */
export type TokenUsageSurface = {
  usage: Record<string, unknown> | null;
  onShow: () => void;
};

type TokenUsageSummaryProps = {
  usage: Record<string, unknown> | null;
  onClick?: () => void;
  className?: string;
};

const formatTokenCount = (value: number) => {
  if (!Number.isFinite(value) || value <= 0) {
    return '0';
  }

  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`;
  }

  if (value >= 10_000) {
    return `${Math.round(value / 1_000)}K`;
  }

  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1)}K`;
  }

  return value.toLocaleString();
};

const readUsageNumber = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

/**
 * The session's context-window usage; clicking opens the detailed token breakdown.
 * Rendered by chat's ChatComposer from `md` up and by the workspace's mobile header below it —
 * the same 768px line `useDeviceSettings` draws, so the count is in exactly one place at every
 * width and never in both.
 */
function TokenUsageSummary({ usage, onClick, className }: TokenUsageSummaryProps) {
  const breakdown =
    usage?.breakdown && typeof usage.breakdown === 'object'
      ? usage.breakdown as Record<string, unknown>
      : null;
  const inputTokens = readUsageNumber(usage?.inputTokens ?? breakdown?.input);
  const outputTokens = readUsageNumber(usage?.outputTokens ?? breakdown?.output);
  const usedTokens = readUsageNumber(usage?.used) || inputTokens + outputTokens;

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex h-8 items-center gap-1.5 rounded-lg border border-border/70 bg-background/70 px-2 text-xs text-muted-foreground shadow-sm transition-colors hover:border-primary/25 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:gap-2 sm:px-2.5',
        className,
      )}
      title={`${usedTokens.toLocaleString()} tokens used`}
      aria-label="Show token usage"
    >
      <span className="grid h-5 w-5 place-items-center rounded-md bg-primary/10 text-primary">
        <CoinsIcon className="h-3.5 w-3.5" />
      </span>
      {/* The count alone: the coin says what it counts, and the title and accessible name
          still spell it out for anyone who needs the word. */}
      <span className="font-medium text-foreground">{formatTokenCount(usedTokens)}</span>
    </button>
  );
}

/** Memoized: the composer re-renders on every keystroke and this row's numbers only move when a turn ends. */
export default memo(TokenUsageSummary);
