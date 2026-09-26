import { HeartPulseIcon, PlugZapIcon, SettingsIcon } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { HealActions } from '@/modules/heal/HealActions';
import { HealCardList } from '@/modules/heal/HealCardList';
import { HealCycleList } from '@/modules/heal/HealCycleList';
import { HealKindList } from '@/modules/heal/HealKindList';
import { HealPills } from '@/modules/heal/HealPills';
import { HealSettingsDialog } from '@/modules/heal/HealSettingsDialog';
import { useHeal } from '@/modules/heal/context/HealContext';
import type { HealPillKey } from '@/modules/heal/healTypes';
import { Badge, Button, EmptyState, ScrollArea, Spinner, Tooltip } from '@/shared/ui';

/**
 * Where each pill carries the reader: the section its number counted, or — for the two pills that
 * are statements about a SETTING (what is ignored, today's spend against the cap) — the settings
 * dialog that holds it.
 */
const PILL_TARGET: Record<HealPillKey, string | 'settings'> = {
  friction: 'heal-kinds',
  ignored: 'settings',
  lastHeal: 'heal-heals',
  spend: 'settings',
  cycle: 'heal-heals',
};

/**
 * The Heal tab: what hurt since the last heal, and what the reflex did about it.
 *
 * ORDERED THE WAY A READER TRIAGES. The header is the house panel header — the mark, the title, and
 * one cog for the settings. Under it the toolbar (`HealActions`): the model and the cycle's Start/Stop,
 * the verbs a reader arrives for. Then the vitals (the pills — five numbers, each in the tone that
 * says whether to act), then friction BY KIND with any regression at the top, and — in the heals
 * column — the CYCLES above the heals: what last night did is the question, and a heal is one line
 * of a cycle's answer.
 *
 * THE DESKTOP IS NOT A PHONE. Once the PANEL is 48rem wide the body is two columns — friction by kind on the wider left
 * (3fr), heals on the right (2fr) — each its own scroll region, so a long kind list never pushes the
 * heals off screen; the pills span both above them. Narrower, everything stacks in one scroll, the
 * shape a phone needs. The query is the panel's own width (`container-type` on the root), never the
 * window's: a 1024px window minus the sidebar leaves a panel too narrow for two columns, and a
 * viewport breakpoint split it anyway and clipped the kind rows.
 *
 * THREE NON-LIST STATES, EACH ITS OWN FACT. Not asked yet is a spinner; a ledger that could not be
 * read is a plug-out with the reason under it and the way back; a ledger that answered with nothing
 * is the pills over an empty list — the cog still live, because a reader with no friction may still
 * have a cap to set or a refusal to ignore.
 */
export function HealPanel() {
  const { t } = useTranslation();
  // The context owns the poll — one `--status` read a minute, plus a visibilitychange — and this
  // panel draws what it last read. The state is the context's own union, never a second one here.
  const { state, refresh } = useHeal();
  const onRetry = () => void refresh();
  const [settingsOpen, setSettingsOpen] = useState(false);
  // The dialog draws the summary's switches, so it lives only on a READY state. A poll that fails
  // while it is open CLOSES it — adjusted during render, React's own pattern for state derived from a
  // prop — rather than leaving `settingsOpen` true under an unmounted dialog that the next good poll
  // would pop back open, uninvited, with focus stolen to its X.
  if (settingsOpen && state.phase !== 'ready') setSettingsOpen(false);
  // The pill last pressed, null until one is: nothing on this tab is filtered on mount, so nothing
  // may read as an applied filter.
  const [activePill, setActivePill] = useState<HealPillKey | null>(null);
  const onPillSelect = (key: HealPillKey) => {
    setActivePill(key);
    const target = PILL_TARGET[key];
    if (target === 'settings') {
      setSettingsOpen(true);
      return;
    }
    // The pill's own section, by the id `HealSection` gives it — inside its own column's scroll on a
    // desktop, inside the one scroll on a phone. Instant for a reader who asked for less motion.
    document.getElementById(target)?.scrollIntoView({
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      block: 'start',
    });
  };
  const settingsLabel = t('heal.settings.open', { defaultValue: 'Heal settings' });

  return (
    <div className="flex h-full flex-col [container-type:inline-size]" data-heal-panel>
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-primary/25 bg-primary/10 text-primary">
          <HeartPulseIcon className="h-4 w-4" aria-hidden="true" />
        </span>
        <h2 className="text-sm font-medium">{t('heal.title', { defaultValue: 'Heal' })}</h2>
        {/* The cog and nothing else: the verbs live in the toolbar under this line. Disabled until the
            ledger answers, since the dialog draws the switches the summary read. */}
        <div className="ml-auto">
          <Tooltip content={settingsLabel} position="bottom">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:text-foreground"
              aria-label={settingsLabel}
              aria-haspopup="dialog"
              disabled={state.phase !== 'ready'}
              onClick={() => setSettingsOpen(true)}
              data-heal-settings-cog
            >
              <SettingsIcon aria-hidden="true" />
            </Button>
          </Tooltip>
        </div>
      </header>

      {state.phase === 'loading' ? (
        <div className="flex flex-1 items-center justify-center px-4 py-10">
          <Spinner label={t('heal.reading', { defaultValue: 'Reading the friction ledger…' })} />
        </div>
      ) : state.phase === 'error' ? (
        <div className="flex flex-1 items-center justify-center px-4 py-10">
          <EmptyState
            icon={PlugZapIcon}
            title={t('heal.unreachable.title', { defaultValue: 'The friction ledger could not be read' })}
            message={state.reason}
            actionLabel={t('heal.unreachable.retry', { defaultValue: 'Try again' })}
            onAction={onRetry}
          />
        </div>
      ) : (
        <>
          <HealActions summary={state.summary} />
          {/* One scroll on a narrow panel; on a wide one the grid fills it exactly and each column scrolls itself. */}
          <ScrollArea className="min-h-0 flex-1">
            <div
              className="flex w-full min-w-0 flex-col gap-6 px-4 py-5 [@container(min-width:48rem)]:grid [@container(min-width:48rem)]:h-full [@container(min-width:48rem)]:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] [@container(min-width:48rem)]:grid-rows-[auto_minmax(0,1fr)] [@container(min-width:48rem)]:gap-x-8 [@container(min-width:48rem)]:gap-y-5 [@container(min-width:48rem)]:px-6"
              data-heal-body
            >
              <div className="[@container(min-width:48rem)]:col-span-2">
                <HealPills summary={state.summary} activePill={activePill} onSelect={onPillSelect} />
              </div>

              <HealSection
                id="heal-kinds"
                title={t('heal.kinds.title', { defaultValue: 'Friction by kind' })}
                hint={t('heal.kinds.hint', { defaultValue: 'the door’s own word — what a heal is scoped to' })}
              >
                <HealKindList kinds={state.summary.kinds} />
              </HealSection>

              <HealSection id="heal-heals" title={t('heal.cards.title', { defaultValue: 'Heals' })} count={state.summary.heals.length}>
                <div className="flex min-w-0 flex-col gap-4">
                  <HealCycleList cycles={state.summary.cycles} cycleState={state.summary.cycle_state} />
                  <HealCardList heals={state.summary.heals} />
                </div>
              </HealSection>
            </div>
          </ScrollArea>
          <HealSettingsDialog
            open={settingsOpen}
            onOpenChange={setSettingsOpen}
            switches={state.summary.switches}
            ignore={state.summary.ignore}
          />
        </>
      )}
    </div>
  );
}

/**
 * A titled block of the body, addressable by id so a pill can carry the reader to it. On a wide panel
 * its rows are their own scroll region under a heading that stays put; narrower, they flow in the one scroll.
 */
function HealSection({ id, title, hint, count, children }: { id: string; title: string; hint?: string; count?: number; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="flex min-w-0 scroll-mt-4 flex-col gap-3 [@container(min-width:48rem)]:min-h-0" data-heal-section={id}>
      <div className="flex flex-wrap items-baseline gap-2">
        <h3 id={`${id}-title`} className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</h3>
        {count !== undefined && count > 0 && <Badge as="span" tone="neutral">{count}</Badge>}
        {hint && <span className="text-xs text-muted-foreground">· {hint}</span>}
      </div>
      <ScrollArea className="min-w-0 [@container(min-width:48rem)]:min-h-0 [@container(min-width:48rem)]:flex-1">{children}</ScrollArea>
    </section>
  );
}
