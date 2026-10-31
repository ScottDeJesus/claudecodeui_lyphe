import type { TFunction } from 'i18next';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';

import { STATION_NEED_KINDS } from '@/shared/constants';
import type { StationNeed } from '@/shared/station-types';
import type { LocaleWords, StationDensity, StationNeedKind } from '@/shared/types';
import { Button, Tooltip } from '@/shared/ui';
import { cn } from '@/shared/utils';

/** A red check's status word, Cerberus's own: `denied` is what its tab calls "Refused". */
const STATUS_WORDS: Readonly<Record<Extract<StationNeed, { kind: 'check' }>['status'], LocaleWords>> = {
  failing: { key: 'station.needs.status.failing', english: 'Failing' },
  denied: { key: 'station.needs.status.denied', english: 'Refused' },
};

/** `HH:MM` on his clock, 24-hour, the clock she speaks in; a day before today adds its date ("Oct 28 14:02"). */
function sinceWords(at: number): string {
  const when = new Date(at);
  const time = `${String(when.getHours()).padStart(2, '0')}:${String(when.getMinutes()).padStart(2, '0')}`;
  if (when.toDateString() === new Date().toDateString()) return time;
  return `${when.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${time}`;
}

/** What the item is about, in its weight: the feature's or epic's title, the chat's name, the check's label. */
function titleOf(need: StationNeed): string {
  switch (need.kind) {
    case 'accept':
    case 'questions':
      return need.title;
    case 'ask':
    case 'followups':
      return need.chat;
    case 'check':
      return need.label;
  }
}

/**
 * The few words after the kind: what an Accept stands on (a feature, or an epic and how many features its one word covers),
 * how many questions a round asks, an ask's tool (a permission's) and how many more wait behind it, how many follow-ups are
 * open, a red check's status word ("Red check · Failing").
 */
function factsOf(need: StationNeed, t: TFunction): string[] {
  switch (need.kind) {
    case 'accept':
      return need.epic
        ? [t('station.needs.facts.epic', { count: need.features, defaultValue_one: 'Epic · {{count}} feature', defaultValue_other: 'Epic · {{count}} features' })]
        : [t('station.needs.facts.feature', 'Feature')];
    case 'questions':
      return [t('station.needs.facts.questions', { count: need.count, defaultValue: '{{count}} to answer' })];
    case 'ask':
      return [
        ...(need.ask === 'permission' ? [need.tool] : []),
        ...(need.more > 0 ? [t('station.needs.facts.more', { count: need.more, defaultValue: '{{count}} more waiting' })] : []),
      ];
    case 'followups':
      return [t('station.needs.facts.open', { count: need.count, defaultValue: '{{count}} open' })];
    case 'check':
      return [t(STATUS_WORDS[need.status].key, STATUS_WORDS[need.status].english)];
  }
}

/**
 * The item's one line, cut on the rail and whole on the stage its press opens: the census's first line, a round's first
 * question, what an ask would do (a command whole, as the server decides on it), the newest follow-up, a check's reading
 * with its node and since when.
 */
function lineOf(need: StationNeed, t: TFunction): string {
  switch (need.kind) {
    case 'accept':
    case 'questions':
      return need.headline;
    case 'ask':
      return need.what;
    case 'followups':
      return need.newest;
    case 'check': {
      const where = need.since === null
        ? need.node
        : t('station.needs.where', { node: need.node, time: sinceWords(need.since), defaultValue: '{{node}} · since {{time}}' });
      return need.value === null ? where : `${need.value} · ${where}`;
    }
  }
}

/** A tooltip's box: as wide as its words up to 28rem, wrapping; never drawn where nothing hovers (a tap would leave it standing). */
const TIP = 'max-w-[min(28rem,calc(100vw-2rem))] whitespace-normal [overflow-wrap:anywhere] [@media(hover:none)]:hidden';

type NeedItemProps = {
  /** The thing that needs him, as the server answers it. */
  need: StationNeed;
  /** `compact`: the item on one line (its kind, its title, its act). */
  density: StationDensity;
  /** It is the thing on the stage: `aria-current`, the accent edge and the words "On the stage". */
  current: boolean;
  /** Its act, or a press anywhere on its words: its whole onto the stage. Nothing fires here. */
  onPress: () => void;
  /** The side its cut line's tooltip opens on: `left`, into the page, beside the right rail; `top` at compact density, where the item spans the column. */
  tooltipSide: 'left' | 'top';
};

/**
 * ONE THING THAT NEEDS HIM, a card of the right rail read top to bottom:
 * - its kind as its glyph AND its word ("ACCEPT · Epic · 3 features", "PERMISSION · Bash · 2 more waiting", "RED CHECK ·
 *   Failing"), the kind in the caption's capitals, the facts after it in plain words, and "On the stage" at the row's end
 *   while it is the thing on the stage;
 * - what it is about, in its weight, cut at two lines;
 * - its one line, cut at one (a permission's in mono: it is a command; a question's and a plan's are prose, in the body face);
 *   the whole of it in a `Tooltip` for a pointer, which only repeats what the stage shows whole (and is not drawn where nothing
 *   hovers, `hover:none`: a tap's compatibility mouse events would leave its bubble over the rail's head);
 * - its act as a kit `Button`. No phrase to say stands beside it: she reads an action back in her own words and judges from the
 *   conversation whether he agreed.
 * An Accept and a red check wear `data-tone="warn"`: the tone's bar down the left edge and their kind word in its ink. A
 * press on the words is the act's own press, so the whole card answers a finger; it takes no tab stop of its own, because the
 * act is the keyboard's stop, named by the title it is described by. Below 768 px both are 44 px catches (the touch law).
 *
 * AT COMPACT DENSITY the card is ONE line — the kind's glyph and word, the title cut where the line runs short, the act — with
 * "On the stage" under it, at that line's end, while it is the thing on the stage.
 * The facts and the one line are the stage's to say whole; the tip, above the item, repeats the title, the facts and the line
 * for a pointer. The warn bar, the press on the words and the act's catch are as in full.
 *
 * A pure view, drawn by `WhatNeedsYouView` (this module) once per need, in the order the server answers.
 */
export function NeedItem({ need, density, current, onPress, tooltipSide }: NeedItemProps) {
  const { t } = useTranslation();
  const titleId = useId();
  const kind: StationNeedKind = need.kind === 'ask' ? need.ask : need.kind;
  const look = STATION_NEED_KINDS[kind];
  const KindIcon = look.icon;
  // A cut ask's stage offers no Allow (`need.cut`, read as `AskAnswers` reads it), so its act does not promise one: it opens it, plainly.
  const act = need.kind === 'ask' && need.ask !== 'question' && need.cut !== false ? STATION_NEED_KINDS.followups.act : look.act;
  const line = lineOf(need, t);
  // The kind's own ink on a toned card, the muted one on the rest: the word is what says it, the colour only repeats it.
  const kindInk = look.warn ? 'text-tone-ink' : 'text-muted-foreground';
  const kindWord = <span className={cn('font-medium uppercase tracking-[0.14em]', kindInk)}>{t(look.word.key, look.word.english)}</span>;
  const kindGlyph = <KindIcon aria-hidden="true" className={cn('size-3.5 shrink-0', kindInk)} />;
  const actButton = (catchClass: string) => (
    <Button variant="outline" size="sm" data-station-need-act="" aria-describedby={titleId} className={cn('shrink-0 max-md:h-11', catchClass)} onClick={onPress}>
      {t(act.key, act.english)}
    </Button>
  );

  // AT COMPACT DENSITY: one line — the kind, the title, the act — and "On the stage" under it while it is the thing on the stage.
  const compactBody = (
    <>
      {/* The tip spans the line, the press and the act: it repeats what the line cuts, above the item. */}
      <Tooltip content={[titleOf(need), ...factsOf(need, t), line].join(' · ')} position="top" className={TIP}>
        <div className="flex min-w-0 items-center gap-2 py-1.5 pl-3.5 pr-2">
          <button
            type="button"
            tabIndex={-1}
            data-station-need-press=""
            onClick={onPress}
            className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-xs leading-5 max-md:min-h-11"
          >
            {kindGlyph}
            <span className="shrink-0">{kindWord}</span>
            <span aria-hidden="true" className="shrink-0 text-muted-foreground">·</span>
            <span id={titleId} className="min-w-0 truncate text-sm font-medium text-foreground">{titleOf(need)}</span>
          </button>
          {actButton('h-8')}
        </div>
      </Tooltip>
      {current && (
        <div className="-mt-0.5 flex min-w-0 items-start pb-2 pl-3.5 pr-2">
          <span className="ml-auto shrink-0 text-xs leading-snug text-accent-ink">{t('station.needs.onStage', 'On the stage')}</span>
        </div>
      )}
    </>
  );

  // In full: its kind and facts, its title, its one line, then its act.
  const fullBody = (
    <>
      <Tooltip content={line} position={tooltipSide} className={TIP}>
        <button
          type="button"
          tabIndex={-1}
          data-station-need-press=""
          onClick={onPress}
          className="flex w-full min-w-0 flex-col gap-1 pb-2 pl-4 pr-3 pt-2.5 text-left max-md:min-h-11"
        >
          <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs leading-snug">
            {kindGlyph}
            {kindWord}
            {factsOf(need, t).map((fact, at) => (
              // A fact's place is its key: a tool and a count never read alike, but the place is what stays put.
              <span key={at} className="min-w-0 break-words text-muted-foreground">
                <span aria-hidden="true">· </span>
                {fact}
              </span>
            ))}
            {current && <span className="ml-auto pl-1 text-accent-ink">{t('station.needs.onStage', 'On the stage')}</span>}
          </span>
          <span id={titleId} className="line-clamp-2 break-words text-sm font-medium leading-snug text-foreground">{titleOf(need)}</span>
          <span className={cn('block truncate text-muted-foreground', need.kind === 'ask' && need.ask === 'permission' ? 'font-mono text-[11.5px]' : 'text-xs')}>{line}</span>
        </button>
      </Tooltip>
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 pb-2.5 pl-4 pr-3">
        {actButton('')}
      </div>
    </>
  );

  return (
    <li
      data-station-need={kind}
      data-station-need-id={need.id}
      data-station-need-density={density}
      data-tone={look.warn ? 'warn' : undefined}
      aria-current={current ? 'true' : undefined}
      className={cn(
        'relative flex min-w-0 flex-col overflow-hidden rounded-[10px] border bg-card transition-colors duration-quick',
        current ? 'border-primary/60' : 'border-border hover:border-input',
      )}
    >
      {look.warn && <span aria-hidden="true" className="absolute inset-y-0 left-0 w-1 bg-tone-dot" />}
      {density === 'compact' ? compactBody : fullBody}
    </li>
  );
}
