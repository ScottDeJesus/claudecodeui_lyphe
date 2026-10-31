import { Inbox } from 'lucide-react';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';

import { CompanionActionCard, useCompanion } from '@/modules/companion';
import { useStation } from '@/modules/station/context/StationContext';
import { useStationNeeds } from '@/modules/station/context/StationNeedsContext';
import { useLandOnStageControl } from '@/modules/station/hooks/useLandOnStageControl';
import { NeedItem } from '@/modules/station/NeedItem';
import { focusKey } from '@/modules/station/stationMemory';
import type { CompanionPendingAction } from '@/shared/companion-types';
import type { StationFocus, StationNeed } from '@/shared/station-types';
import type { LocaleWords, StationDensity, StationRegionProps } from '@/shared/types';
import { Badge, Banner, Button, EmptyState, ScrollArea, Spinner } from '@/shared/ui';
import { cn } from '@/shared/utils';

/** The Accepts and the rounds are one read of the dispatcher's lane: they fail together, and are said once. */
const PLANS_FAULT: LocaleWords = { key: 'station.needs.fault.plans', english: 'Couldn’t read the Accepts and design questions just now' };

/** Each kind's read that failed, said once under the rest: the rail still draws every kind that answered. */
const FAULT_LINES: Readonly<Record<StationNeed['kind'], LocaleWords>> = {
  accept: PLANS_FAULT,
  questions: PLANS_FAULT,
  ask: { key: 'station.needs.fault.ask', english: 'Couldn’t read the permissions just now' },
  followups: { key: 'station.needs.fault.followups', english: 'Couldn’t read the follow-ups just now' },
  check: { key: 'station.needs.fault.check', english: 'Couldn’t read the checks just now' },
};

/**
 * Where an item's press puts it: its whole on the stage, never fired from here. An Accept and a round go to their card (the
 * dispatcher's own `PlanCard`, its lock or round form: the one answer form, MAN-7400), named by its title; a chat's ask to
 * the ask's stage and its follow-ups to theirs, named by the chat; a red check to its check's stage, named by its label.
 */
function focusOf(need: StationNeed): StationFocus {
  switch (need.kind) {
    case 'accept':
    case 'questions':
      return { kind: 'card', plan: need.card, label: need.title };
    case 'ask':
      return { kind: 'ask', sessionId: need.sessionId, requestId: need.requestId, label: need.chat };
    case 'followups':
      return { kind: 'followups', sessionId: need.sessionId, label: need.chat };
    case 'check':
      return { kind: 'check', node: need.node, key: need.key, label: need.label };
  }
}

type WhatNeedsYouViewProps = {
  /**
   * `compact`: each item on one line, her action card unchanged. At either density the rail fills the room it is given (a
   * column, or compact's section) and scrolls inside itself.
   */
  density: StationDensity;
  /** The one action waiting for his word, as her picture holds it; null when none stands. */
  pending: CompanionPendingAction | null;
  /** Everything that needs him, in the order the server answers; null until the first read answers. */
  needs: StationNeed[] | null;
  /** The kinds whose read failed on the server: each is left out of `needs` and said under the rest. */
  faults: StationNeed['kind'][];
  /** The read itself failed: the server's sentence (or the page's, when none came), said in a warn banner with Try again, over the last good list if there is one. */
  failure: string | null;
  /** Try again: the needs read once more. */
  onReread: () => void;
  /** The one thing on the stage: the item that is it reads as current. */
  focus: StationFocus | null;
  /** An item's press: its whole onto the stage, and the keyboard to the control that fires it there. */
  onPress: (focus: StationFocus) => void;
  /** The action card's ×: the action taken off his panel, nothing done; a refusal rejects with the server's sentence. */
  onWithdraw: () => Promise<void>;
  /** Her name, for the hint on the action card's ×. */
  name: string;
  /** The rail's scroller, for the station's scroll memory; absent on a fixture. */
  scrollRef?: (node: HTMLElement | null) => void;
};

/**
 * "WHAT NEEDS YOU", the station's right rail: everything waiting on his word, read at a glance and acted on from the stage.
 *
 * THE HEAD: "What needs you" with its count (none at zero: the quiet line says it). It tells him no words to say: she reads an
 * action back in her own words and judges from the conversation whether he agreed.
 *
 * THE BODY, top to bottom:
 * - a failed read, as a warn `Banner` with Try again (amber, never red, MAN-577), over the last good list when there is one;
 * - the action waiting for his word, when one stands: her `CompanionActionCard` exactly as her panel draws it (the act and
 *   its target, the prompt or his carried words, when it lapses, the × that withdraws it; every rule of MAN-9186,
 *   his lines the last to give way), keyed by the action so a new one is a new card. In the columns the rail's scroller is
 *   a size container, as her panel is (`[container-type:size]`), so the caps her card takes as a share of its container's
 *   height are a share of the rail, not of the window;
 * - the items (`NeedItem`), in the order the server answers, each its kind in words, what it is about, one line of it and its one
 *   act; or "Reading what needs you…" until the first read answers; or "Nothing needs you." when
 *   nothing waits — folded away while her action card stands (`:has`), so a card that lapses on its own deadline gives the
 *   line back with no word from the page;
 * - each kind whose read failed, as a warn line under the rest ("▲ Couldn’t read the permissions just now").
 *
 * NOTHING FIRES FROM HERE. An item's press puts its whole on the stage, where the owner's own form fires it: the census
 * whole on the dispatcher's card, the command whole on the ask's stage.
 *
 * The head stays and the body scrolls inside the rail, in a column and in compact's section alike.
 *
 * AT COMPACT DENSITY (the one-column arrangement's "Needs you", at any tier) the rail is drawn as in the columns, its head
 * standing and its body scrolling inside the section, and each item is one line (`NeedItem`). Her
 * action card is exactly as in full: his lines are the last to give way and travel word for word (MAN-9186).
 *
 * A pure view: `WhatNeedsYou` below binds it. Drawn in the `needs` slot by `StationShell` (`stationRegions.ts`), and by
 * `.verify/kaylee-station-shots.mjs` on the fixtures' pictures (`fake/needs.ts`).
 */
export function WhatNeedsYouView({
  density, pending, needs, faults, failure, onReread, focus, onPress, onWithdraw, name, scrollRef,
}: WhatNeedsYouViewProps) {
  const { t } = useTranslation();
  const headId = useId();
  const compact = density === 'compact';
  const current = focus === null ? null : focusKey(focus);

  const body = (
    <div
      data-station-needs-body=""
      // 12 px a side up to the wide tier (1360 px): on the laptop's 296 px rail her card's head stands whole at 12 and not at 16.
      // At compact, 12 at every width: the one column is not the wide rail.
      className={cn(
        'flex min-w-0 flex-col gap-3 p-3 [&:has([data-companion-action])_[data-station-needs-empty]]:hidden',
        !compact && 'min-[1360px]:p-4',
      )}
    >
      {failure !== null && (
        <Banner
          tone="warn"
          action={(
            <Button variant="outline" size="sm" className="shrink-0 finger:h-11" onClick={onReread}>
              {t('station.needs.retry', 'Try again')}
            </Button>
          )}
        >
          <p className="break-words">{failure}</p>
        </Banner>
      )}

      {pending !== null && <CompanionActionCard key={pending.id} pending={pending} name={name} onWithdraw={onWithdraw} />}

      {needs === null ? (
        failure === null && (
          <div data-station-needs-reading="" className="grid place-items-center py-8">
            <Spinner size={28} label={t('station.needs.reading', 'Reading what needs you…')} />
          </div>
        )
      ) : needs.length === 0 ? (
        <div data-station-needs-empty="" className="py-2">
          <EmptyState icon={Inbox} title={t('station.needs.empty', 'Nothing needs you.')} />
        </div>
      ) : (
        <ul aria-labelledby={headId} className={cn('flex min-w-0 flex-col', compact ? 'gap-2' : 'gap-2.5')}>
          {needs.map((need) => {
            const target = focusOf(need);
            return (
              <NeedItem
                key={need.id}
                need={need}
                density={density}
                current={focusKey(target) === current}
                tooltipSide={compact ? 'top' : 'left'}
                onPress={() => onPress(target)}
              />
            );
          })}
        </ul>
      )}

      {[...new Set(faults.map((kind) => FAULT_LINES[kind]))].map((line) => (
        <p key={line.key} data-station-needs-fault="" data-tone="warn" className="flex items-start gap-1.5 text-xs leading-snug text-tone-ink">
          <span aria-hidden="true">▲</span>
          {t(line.key, line.english)}
        </p>
      ))}
    </div>
  );

  return (
    <section
      data-station-needs={needs === null ? 'reading' : needs.length}
      aria-labelledby={headId}
      className="flex min-h-0 min-w-0 flex-1 flex-col"
    >
      <header className={cn('shrink-0 border-b border-border px-3 py-3', !compact && 'min-[1360px]:px-4')}>
        <h2 id={headId} className="flex min-w-0 items-center gap-2 font-serif text-lg font-normal leading-tight text-foreground">
          {t('station.needs.title', 'What needs you')}
          {/* A space, so the heading reads "What needs you 3" aloud; the flex row draws no gap for it. */}
          {' '}
          {needs !== null && needs.length > 0 && (
            <Badge as="span" tone="warn" data-station-needs-count="" className="font-sans tabular-nums">{needs.length}</Badge>
          )}
        </h2>
      </header>
      {/* The scroller is a size container, so her card's caps are shares of the rail or the section (her panel is one too). */}
      <ScrollArea ref={scrollRef} className="min-h-0 flex-1 [container-type:size]">{body}</ScrollArea>
    </section>
  );
}

/**
 * The rail on the page, registered for the `needs` slot in `stationRegions.ts` and drawn by `StationShell` with the window's
 * tier. It reads what needs him (`useStationNeeds`), her pending action and her name (`useCompanion`) and the stage
 * (`useStation`), and hands them to `WhatNeedsYouView`.
 *
 * AN ITEM'S PRESS puts its whole on the stage (`setFocus`) and then moves the keyboard to the control that fires it there
 * (`useLandOnStageControl`): Queue on the dispatcher's card, the ask's answers, the follow-ups' list, the check's card. It
 * fires nothing itself.
 */
export function WhatNeedsYou({ density }: StationRegionProps) {
  const { t } = useTranslation();
  const { needs, faults, failure, reread } = useStationNeeds();
  const { picture, cancelAction } = useCompanion();
  const { focus, setFocus, scrollMemory } = useStation();
  const land = useLandOnStageControl();
  const pending = picture?.pending ?? null;

  return (
    <WhatNeedsYouView
      density={density}
      pending={pending}
      needs={needs}
      faults={faults}
      failure={failure}
      onReread={reread}
      focus={focus}
      onPress={(target) => {
        setFocus(target);
        land(target);
      }}
      // The card is keyed by the action and only drawn while one stands, so `pending` is never null when the × is pressed.
      onWithdraw={() => (pending === null ? Promise.resolve() : cancelAction(pending.id))}
      // Before her picture is read she has no name of her own to show: the house's default stands in.
      name={picture?.settings.name ?? t('companion.defaultName')}
      scrollRef={scrollMemory('needs')}
    />
  );
}
