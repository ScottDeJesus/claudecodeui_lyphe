import { memo, type KeyboardEvent } from 'react';
import { X } from 'lucide-react';

import { useElapsed } from '@/shared/hooks/useElapsed';
import { LLMProviderLogo } from '@/shared/ui';
import type { SoulLaunchSnapshot } from '@/shared/types';
import { formatSubagentFinishTime } from '@/modules/chat/utils/subagentSummary';

/**
 * One launcher soul as a row, drawn beside the `Agent`-tool agents.
 *
 * Read by the chat module's pinned strip (`PinnedSubagents.tsx`), which draws it above the chat box
 * when the desktop gutters are not showing, and by `subagents/SubagentWidgetBody.tsx`, the gutter's
 * Subagents widget, which draws the same rows while they are.
 *
 * It is a SECOND KIND OF ROW IN THE SAME STRIP, and it is drawn to be indistinguishable in shape
 * from the agent rows next to it — same left rule, same two lines, the same place for the status
 * and the figures — because the reader is looking at one thing: what is working for them right
 * now. What marks it apart is the MARK: a `/dispatch` hand carries the icon of the provider that
 * is actually paying for it (the DeepSeek whale, or Claude's when the switch is off or a refused
 * key sent the soul back), where an `Agent`-tool subagent carries the robot.
 *
 * WHAT IT SAYS AND WHY IT CAN SAY IT. A launcher soul is a detached child, so nothing streams into
 * this transcript: its status, its elapsed and its cost are read off its launch directory by the
 * server's lane and joined here by launch id (`src/modules/dispatch-souls/`). Elapsed is the
 * running row's; the cost, the tokens and how long it took are the receipt's, and they are absent
 * — not zero — until that lands.
 */

type SoulLaunchPinRowProps = {
  launch: SoulLaunchSnapshot;
  onDismiss: (id: string) => void;
  /**
   * Opens this row's transcript. Optional, and for the same reason as the agent row's: the strip
   * above the chat box has nowhere to open it TO, the gutter's Subagents widget does. Given, the
   * row becomes a button — mouse and keyboard both.
   */
  onOpen?: () => void;
  /** What the row announces as a button, naming which soul it opens. */
  openLabel?: string;
};

/** The soul slug as a name: `hephaestus` → `Hephaestus`. The shims are lowercase; a pin is not. */
function soulName(agent: string): string {
  if (!agent) return 'Soul';
  return agent.charAt(0).toUpperCase() + agent.slice(1);
}

/**
 * What the founding cost reads as. Two decimals, the runner card's own spelling (`RunCard.tsx`),
 * so the strip and the Runner tab quote the same figure the same way; the exact charge is on the
 * tooltip for the reader who wants it.
 */
function costLabel(costUsd: number | null): string {
  return costUsd === null ? '' : `$${costUsd.toFixed(2)}`;
}

export const SoulLaunchPinRow = memo(({ launch, onDismiss, onOpen, openLabel }: SoulLaunchPinRowProps) => {
  const running = launch.state === 'running';
  // `null` for a finished launch: the hook then holds NO interval at all, so a strip of a dozen
  // ended souls costs nothing per second rather than a dozen timers.
  const elapsed = useElapsed(running ? launch.started_at : null);
  const finishTime = formatSubagentFinishTime(
    launch.ended_at === null ? null : new Date(launch.ended_at * 1000).toISOString(),
  );
  const cost = costLabel(launch.cost_usd);

  // Spread onto the root only when the row opens something; without `onOpen` every value is
  // `undefined`, so React omits the attributes and the drawn row is what the strip drew before.
  const openProps = {
    role: onOpen ? ('button' as const) : undefined,
    tabIndex: onOpen ? 0 : undefined,
    'aria-label': openLabel,
    onClick: onOpen,
    onKeyDown: onOpen
      ? (event: KeyboardEvent<HTMLDivElement>) => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          onOpen();
        }
      : undefined,
  };

  return (
    <div
      {...openProps}
      data-testid="pinned-soul-row"
      data-status={launch.state}
      data-launch-id={launch.launch_id}
      data-provider={launch.provider}
      // Square on the left, rounded on the right: a rounded corner under a 2px left border draws
      // it as an arc, which reads as a stray mark rather than a rule.
      className={`flex flex-col gap-0.5 rounded-r-lg border-l-2 px-2 py-1 text-xs ${onOpen ? 'cursor-pointer ' : ''}${
        running
          ? 'border-l-purple-500 dark:border-l-purple-400'
          : launch.state === 'failed'
            ? 'border-l-red-500 dark:border-l-red-400'
            : launch.state === 'stopped'
              ? 'border-l-amber-500 dark:border-l-amber-400'
              : 'border-l-emerald-500 dark:border-l-emerald-400'
      } text-muted-foreground`}
    >
      <div className="flex items-center gap-1.5">
        <LLMProviderLogo provider={launch.provider} className="h-3.5 w-3.5 flex-shrink-0" />
        <span className="flex-shrink-0 font-medium text-foreground">{soulName(launch.agent)}</span>
        {launch.role && (
          <>
            <span className="flex-shrink-0 text-[10px] text-muted-foreground/40">/</span>
            <span className="min-w-0 flex-1 truncate">{launch.role}</span>
          </>
        )}
        {running ? (
          // "running" AND the clock, never the clock alone: a bare "3m 12s" beside a finished
          // agent's timestamp reads as the same kind of fact, and this one has to say which it is.
          <span className="ml-auto flex flex-shrink-0 items-center gap-1 text-[11px] text-purple-600 dark:text-purple-300">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-purple-500 dark:bg-purple-400" />
            running
            {elapsed && <span className="tabular-nums text-muted-foreground/70">· {elapsed}</span>}
          </span>
        ) : (
          <span className="ml-auto flex flex-shrink-0 items-center gap-1.5 text-[11px]">
            <span
              className={
                launch.state === 'failed'
                  ? 'text-red-600 dark:text-red-400'
                  : launch.state === 'stopped'
                    ? 'text-amber-700 dark:text-amber-400'
                    : 'text-emerald-700 dark:text-emerald-400'
              }
            >
              {launch.state === 'failed' ? 'failed' : launch.state === 'stopped' ? 'stopped' : 'finished'}
              {finishTime && ` ${finishTime}`}
            </span>
            <button
              type="button"
              data-testid="pinned-row-dismiss"
              // The row itself may be a button; dismissing must not also open the transcript.
              onClick={(event) => {
                event.stopPropagation();
                onDismiss(launch.launch_id);
              }}
              aria-label="Dismiss this soul from the pinned strip"
              title="Dismiss"
              className="rounded p-0.5 text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        )}
      </div>
      {/* The second line: the task it was handed on the left, what it cost on the right — the same
        * two columns the agent rows keep, so the strip has one shape whatever is pinned in it. */}
      {(launch.brief || cost) && (
        <div className="flex items-baseline gap-2 pl-5 text-[11px] text-muted-foreground/80">
          {launch.brief && (
            <span className="min-w-0 flex-1 truncate font-mono" title={launch.brief}>
              {launch.brief}
            </span>
          )}
          {cost && (
            <span
              className="ml-auto flex-shrink-0 tabular-nums"
              title={
                launch.cost_usd === null
                  ? ''
                  : `${cost} — ${launch.tokens ?? 0} tokens, ${Math.round(launch.duration_s ?? 0)}s`
              }
              data-testid="pinned-soul-cost"
            >
              {cost}
            </span>
          )}
        </div>
      )}
      {/* A refused or silent endpoint is why this soul did no work, and it is the one thing a
        * reader would otherwise have to open the launch directory to learn. */}
      {launch.blocked && (
        <div className="pl-5 text-[10px] text-amber-700 dark:text-amber-400">
          DeepSeek refused or never answered — nothing ran on Claude
        </div>
      )}
    </div>
  );
});

SoulLaunchPinRow.displayName = 'SoulLaunchPinRow';

export default SoulLaunchPinRow;
