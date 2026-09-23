import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { HealModelSwitch } from '@/modules/heal/HealModelSwitch';
import { HealStartStopButton } from '@/modules/heal/HealStartStopButton';
import type { HealSummary } from '@/modules/heal/healTypes';
import { cn } from '@/shared/utils';

/**
 * The tab's verbs as ONE toolbar, in the panel directly under the header — the reflex's model and
 * the press that starts or stops its work. They are about the reflex as a whole rather than about
 * one row of the ledger, which is why they stand above the pills and not in them.
 *
 * TWO CELLS. The model, and Start/Stop meaning "run a cycle now" / "end cycle": a cycle IS the
 * typed heal with a judge in front of it, so one press opens it and the same cell ends it.
 *
 * OUT OF THE HEADER, INTO THE PANEL. The header was one line carrying the title and every control, the
 * way a phone has to; on a desktop that squeezed them into a corner and said nothing about any of them.
 * Here each control has a cell of its own and, once the panel is 48rem wide, a caption under it that
 * says what it is set to — the state a reader would otherwise have to hover to learn. Wide, the cells
 * are a grid, so the row never wraps and the primary press keeps the far end; a caption wraps inside
 * its cell instead. Narrower, the captions go and the strip is icon-and-label, so it still fits a
 * 390px phone on one line.
 *
 * Drawn only on a READY summary — a switch shown while the ledger is unread would be a position nobody
 * read — so the panel mounts this only then.
 */
export function HealActions({ summary }: { summary: HealSummary }) {
  const { t } = useTranslation();
  const { model } = summary.switches;
  // The worker's own word on whether a cycle is open: the button draws what the summary says, never a press.
  const cycleOpen = summary.cycle_open !== null;
  const master = summary.switches.master;
  const modelCaption = model === 'deepseek'
    ? t('heal.actions.modelDeepseek', { defaultValue: 'Heals run on DeepSeek Flash, under the daily cap' })
    : t('heal.actions.modelClaude', { defaultValue: 'Heals run on Claude — your subscription, no cap' });
  const cycleCaption = !master
    ? t('heal.cycles.masterOff', { defaultValue: 'Heals are off — Settings → Agents' })
    : cycleOpen
      ? t('heal.cycles.openCaption', { defaultValue: 'A cycle is open — End cycle lets running heals finish and starts nothing new' })
      : t('heal.cycles.startCaption', { defaultValue: 'Chiron ranks the live friction, then heals walk his list' });

  return (
    <div
      role="toolbar"
      aria-label={t('heal.actions.label', { defaultValue: 'Heal actions' })}
      className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-4 py-2.5 [@container(min-width:48rem)]:grid [@container(min-width:48rem)]:grid-cols-2 [@container(min-width:48rem)]:items-start [@container(min-width:48rem)]:gap-x-8 [@container(min-width:48rem)]:px-6 [@container(min-width:48rem)]:py-3"
      data-heal-actions
    >
      <ActionCell caption={modelCaption}>
        <HealModelSwitch model={model} />
      </ActionCell>
      {/* Start keeps the far end: it is the one press a reader arrives for, where three seconds lands. */}
      <ActionCell
        className="ml-auto [@container(min-width:48rem)]:items-end [@container(min-width:48rem)]:justify-self-end [@container(min-width:48rem)]:text-right"
        caption={cycleCaption}
      >
        <HealStartStopButton master={master} cycleOpen={cycleOpen} />
      </ActionCell>
    </div>
  );
}

/** One control of the toolbar and, on a wide panel, the line under it that says what it is set to. */
function ActionCell({ caption, className, children }: { caption: string; className?: string; children: ReactNode }) {
  return (
    <div className={cn('flex min-w-0 flex-col items-start gap-1', className)}>
      {/* One control height for every cell, so the chip's caption lines up with the buttons'. A second
          child — the cycle Start's refusal — wraps under the control and grows the cell; a lone
          control is the same 36px row it always was. */}
      <div className="flex min-h-9 flex-wrap items-center gap-2">{children}</div>
      <p className="hidden max-w-72 text-xs leading-snug text-muted-foreground [@container(min-width:48rem)]:block">{caption}</p>
    </div>
  );
}
