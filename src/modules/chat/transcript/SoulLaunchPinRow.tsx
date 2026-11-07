import { memo, type KeyboardEvent } from 'react';
import type { TFunction } from 'i18next';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useElapsed } from '@/shared/hooks/useElapsed';
import { spendText } from '@/shared/spend';
import { LLMProviderLogo } from '@/shared/ui';
import type { SoulLaunchSnapshot } from '@/shared/types';
import { cn } from '@/shared/utils';
import { soulName } from '@/modules/chat/subagents/subagentRow';
import { formatSubagentFinishTime } from '@/modules/chat/utils/subagentSummary';

/**
 * One launcher soul as a row, drawn beside the `Agent`-tool agents.
 *
 * Read by the chat module's pinned strip (`PinnedSubagents.tsx`), which draws it above the chat box
 * when the desktop gutters are not showing, and by `subagents/SubagentWidgetBody.tsx`, the gutter's
 * Subagents widget, which draws the same rows while they are.
 *
 * It is a SECOND KIND OF ROW IN THE SAME STRIP, and it is drawn to be indistinguishable in shape
 * from the agent rows next to it — same centred mark, same two lines, the same place for the status
 * and the figures — because the reader is looking at one thing: what is working for them right
 * now. Its mark is that of the provider actually paying for it (the DeepSeek whale, or Claude's
 * mascot when the switch is off or a refused key sent the soul back); an `Agent`-tool subagent
 * carries its own provider's mark the same way.
 *
 * WHAT IT SAYS AND WHY IT CAN SAY IT. A launcher soul is a detached child, so nothing streams into
 * this transcript: its status, its elapsed and its cost are read off its launch directory by the
 * server's lane and joined here by launch id (`src/modules/dispatch-souls/`). Elapsed is the
 * running row's; the cost, the tokens and how long it took are the receipt's, and they are absent
 * — not zero — until that lands.
 */

type SoulLaunchPinRowProps = {
  launch: SoulLaunchSnapshot;
  /** The name a person calls the model the soul ran on (`Opus 5.5`), drawn after its name. Absent while its launch records name no model, or one nothing names. */
  modelLabel?: string | null;
  onDismiss: (id: string) => void;
  /** Opens this row's transcript — in place in the gutter's widget, in a dialog from the strip. */
  onOpen: () => void;
  /** What the row announces as a button, naming which soul it opens. */
  openLabel: string;
};

/**
 * What the founding cost reads as, through the one spelling of it (`spend.ts`), and A
 * SPEND FIGURE IS DOLLARS **OR** TOKENS, BY WHO WAS USED (operator rule, 2026-09-24): a soul
 * DeepSeek billed reads the PAID figure labelled by that vendor (`$0.28 DeepSeek`) and NO tokens,
 * and one that rode the operator's Claude subscription reads `1.2M in · 48k out` and no `$` at all.
 * The two halves are settled on the record the lane serves — the tokens are `null` throughout on a
 * vendor's receipt (`soul-launch.service.ts:receiptTokens`) — so this row draws whichever half the
 * soul actually spent, and `''` while the launch is still out.
 *
 * THE VENDOR IS THE PIN'S OWN. A pin is its chat's own launch — the dispatcher files its launches out
 * of a chat's lists (`dispatcher-work.service.ts`) — and a chat's own launches ride no API key, so a
 * DeepSeek-painted pin names `DeepSeek` and a Claude one names no vendor (its figure is tokens alone).
 */
function costLabel(launch: SoulLaunchSnapshot, t: TFunction): string {
  return spendText(
    t,
    launch.cost_usd,
    launch.tokens_in,
    launch.tokens_out,
    launch.tokens,
    launch.provider === 'deepseek' ? 'DeepSeek' : '',
  );
}

export const SoulLaunchPinRow = memo(({ launch, modelLabel, onDismiss, onOpen, openLabel }: SoulLaunchPinRowProps) => {
  const { t } = useTranslation();
  const running = launch.state === 'running';
  // `null` for a finished launch: the hook then holds NO interval at all, so a strip of a dozen
  // ended souls costs nothing per second rather than a dozen timers.
  const elapsed = useElapsed(running ? launch.started_at : null);
  const finishTime = formatSubagentFinishTime(
    launch.ended_at === null ? null : new Date(launch.ended_at * 1000).toISOString(),
  );
  const cost = costLabel(launch, t);
  // The exact books on the tooltip for the reader who wants them: the same figure the row shows,
  // and how long the soul took. The tokens are IN the figure now, so they are not repeated here.
  const duration = launch.duration_s === null ? '' : `${Math.round(launch.duration_s)}s`;
  const detail = [cost, duration].filter(Boolean).join(' · ');

  // The row is a button, mouse and keyboard both. A key pressed on the dismiss X inside it bubbles
  // here too; only a key on the row itself opens it, so Enter on the X still dismisses.
  const openProps = {
    role: 'button' as const,
    tabIndex: 0,
    'aria-label': openLabel,
    onClick: onOpen,
    onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.target !== event.currentTarget) return;
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      onOpen();
    },
  };

  return (
    <div
      {...openProps}
      data-testid="pinned-soul-row"
      data-status={launch.state}
      data-launch-id={launch.launch_id}
      data-provider={launch.provider}
      // The mark sits beside BOTH lines, centred on the row's height; the lines stack to its right.
      className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1 text-xs text-muted-foreground"
    >
      {/* The mascot for a soul that ran on Claude, as every other row in this strip wears it. */}
      <LLMProviderLogo provider={launch.provider} claudeMark="mascot" className="h-4 w-4 flex-shrink-0" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        {/* Wraps rather than clips the role, as the agent rows do (`PinnedAgentRow.tsx`): it keeps a floor of
          * `basis-40` (10rem), so on a phone it takes a line of its own when the name and the model leave it
          * less — a finished soul's chip sits on its own line then, exactly as a finished agent's does. The `/`
          * is part of the role's own flex item, so it wraps with the role. */}
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
          <span className="flex-shrink-0 font-medium text-foreground">{soulName(launch.agent)}</span>
          {modelLabel && (
            <>
              <span className="flex-shrink-0 text-[10px] text-muted-foreground/40">·</span>
              <span className="flex-shrink-0" data-testid="pinned-soul-model">{modelLabel}</span>
            </>
          )}
          {launch.role && (
            <span className="flex min-w-0 shrink grow basis-40 items-center gap-1.5">
              <span className="flex-shrink-0 text-[10px] text-muted-foreground/40">/</span>
              <span className="min-w-0 flex-1 truncate">{launch.role}</span>
            </span>
          )}
          {running ? (
            // "running" AND the clock, never the clock alone: a bare "3m 12s" beside a finished
            // agent's timestamp reads as the same kind of fact, and this one has to say which it is.
            // On a phone the whole chip leaves the header — the word and the clock with it — and the
            // pulsing dot, lit in its colour, says "running" from the second line, where the clock joins
            // the figures. The role keeps the room the chip took, and a lone dot never wraps onto a line
            // of its own.
            <span className="ml-auto flex flex-shrink-0 items-center gap-1 text-[11px] text-purple-600 dark:text-purple-300 max-sm:hidden">
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
          * two columns the agent rows keep, so the strip has one shape whatever is pinned in it. A
          * running soul's pulsing dot leads the line and its clock joins the right column on a phone
          * only (`sm:hidden`); a wide row shows both in the header chip, so a line holding nothing but
          * those two is not drawn there. */}
        {(launch.brief || cost || running) && (
          <div className={cn('flex items-baseline gap-2 text-[11px] text-muted-foreground/80', !launch.brief && !cost && 'sm:hidden')}>
            {running && (
              <span className="h-1.5 w-1.5 flex-shrink-0 animate-pulse self-center rounded-full bg-purple-500 dark:bg-purple-400 sm:hidden" />
            )}
            {launch.brief && (
              <span className="min-w-0 flex-1 truncate font-mono" title={launch.brief}>
                {launch.brief}
              </span>
            )}
            {(elapsed || cost) && (
              // Without a cost it holds only the phone's clock, so a wide row drops it (and its gap) altogether.
              <span className={cn('ml-auto flex flex-shrink-0 items-baseline gap-1.5 tabular-nums', !cost && 'sm:hidden')}>
                {elapsed && (
                  <span className="sm:hidden" data-testid="pinned-soul-elapsed">
                    {cost ? `${elapsed} ·` : elapsed}
                  </span>
                )}
                {cost && (
                  <span title={detail} data-testid="pinned-soul-cost">
                    {cost}
                  </span>
                )}
              </span>
            )}
          </div>
        )}
        {/* A refused or silent endpoint is why this soul did no work, and it is the one thing a
          * reader would otherwise have to open the launch directory to learn. */}
        {launch.blocked && (
          <div className="text-[10px] text-amber-700 dark:text-amber-400">
            {t('runner.soulBlocked')}
          </div>
        )}
      </div>
    </div>
  );
});

SoulLaunchPinRow.displayName = 'SoulLaunchPinRow';

export default SoulLaunchPinRow;
