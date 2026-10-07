import type { TFunction } from 'i18next';
import { useId, useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import type { useCheckDetail } from '@/modules/cerberus/hooks/useCheckDetail';
import { LookupSentence, SentenceRow } from '@/modules/cerberus/sheet/LookupMoment';
import { MinuteCells } from '@/modules/cerberus/sheet/MinuteCells';
import { RecordedResults } from '@/modules/cerberus/sheet/RecordedResults';
import { UnreachableBanner } from '@/modules/cerberus/UnreachableBanner';
import { isWholeDate, isWholeTime, stampOf, stretchKey } from '@/modules/cerberus/utils/cerberusTime';
import type { CerberusCell, CerberusCheckDetail, CerberusCheckIndexEntry } from '@/shared/cerberus-types';
import { Card, Field, Input, Select } from '@/shared/ui';
import { cn } from '@/shared/utils';

/** Verve's card eyebrow, worn by the card's heading and by each section's under it. */
const EYEBROW = 'text-xs uppercase tracking-[0.14em] text-ink-faint';

/**
 * The fields' height, the small Select's own pair: 44 px below `md`, where a finger picks, and the
 * house's 36 px from `md` up. Check stands beside the moment's two fields wherever the card is wide
 * enough, so all three share a height.
 */
const FIELD_HEIGHT = 'h-11 md:h-9';

/**
 * A placeholder waits 150 ms before it fades in. A read of the local center answers in tens of
 * milliseconds, and a placeholder drawn at once would flash for that long on every switch of check.
 * Under reduced motion `index.css` takes the fade down to nothing and keeps the wait.
 */
const WAIT_THEN_FADE = 'animate-[vv-fade_200ms_ease_150ms_both]';

/** Where the check index stands: being read, unread, read and empty, or read. */
type IndexState = 'reading' | 'failed' | 'empty' | 'ready';

/** The answer well's frame: canvas ground inside the card, so the one thing the card is for stands apart. */
const WELL_FRAME = 'rounded-xl border border-border bg-background px-4 py-3.5';

type LookupCardProps = {
  /** Every active check (`GET /api/cerberus/checks`), `null` until the index answers. */
  checks: CerberusCheckIndexEntry[] | null;
  /** The index read did not answer. Nothing can be chosen until Try again reads it. */
  checksFailed: boolean;
  /** The check looked up as `<node>/<key>`, its value in the picker. `null` before one is chosen. */
  chosen: string | null;
  /** The date field's value, "YYYY-MM-DD", or "" while it is cleared. */
  date: string;
  /** The time field's value, "HH:MM:SS", or "" while it is half typed. */
  time: string;
  /** The latest answer for the chosen check at that moment, its cells and results ending there. `null` until one lands. */
  detail: CerberusCheckDetail | null;
  /** Why the latest read of the chosen check failed, as `useCheckDetail` words it. */
  failure: ReturnType<typeof useCheckDetail>['error'];
  /** The moment the view stands at. An answer whose moment is on another local day prints its date. */
  now: number;
  onCheck: (value: string) => void;
  onDate: (date: string) => void;
  onTime: (time: string) => void;
  /** A minute pressed in the strip. The time moves to it. */
  onPick: (cell: CerberusCell) => void;
  onRetry: () => void;
};

/**
 * The picker's options, "<service label> · <check label>", sorted by that text so a service's checks
 * sit together in the order a person reads them. An unnamed check gives its id, the key after the
 * service the option already names. An unnamed service gives its raw name. When two nodes run one
 * service under the same names, those options add their node to tell them apart. The value is
 * `<node>/<key>`, the way a `cerberus_changed` frame names a check.
 */
function optionsOf(t: TFunction, checks: CerberusCheckIndexEntry[], language: string | undefined) {
  const named = checks.map((entry) => {
    const service = entry.serviceLabel ?? entry.service;
    const check = entry.label ?? entry.key.slice(entry.key.indexOf('/') + 1);
    return { value: `${entry.node}/${entry.key}`, node: entry.node, service, check, label: t('cerberus.history.option', { service, check }) };
  });
  const uses = new Map<string, number>();
  for (const option of named) uses.set(option.label, (uses.get(option.label) ?? 0) + 1);
  return named
    .map(({ value, node, service, check, label }) => ({
      value,
      label: (uses.get(label) ?? 0) > 1 ? t('cerberus.history.optionOnNode', { service, check, node }) : label,
    }))
    .sort((a, b) => a.label.localeCompare(b.label, language));
}

/** What the answer well is decided from: where the index stands, and the card's own props. */
type WellInput = Pick<LookupCardProps, 'chosen' | 'failure' | 'date' | 'time' | 'now'> & {
  index: IndexState;
  answer: CerberusCheckDetail | null;
};

/**
 * What the answer well holds, keyed by what it is, so each new answer rises in. `null` means no well:
 * the card is waiting, or has only the banner to show. The prompts take the answer's own place and
 * shape. A retired check's last answer is never drawn, because it would read as the check's present.
 */
function wellOf(t: TFunction, { index, chosen, failure, answer, date, time, now }: WellInput): { key: string; content: ReactNode } | null {
  const prompt = (key: string, sentence: string, meta: string | null = null) =>
    ({ key, content: <SentenceRow size="lg" status="unknown" sentence={sentence} meta={meta} /> });
  if (index === 'empty') return prompt('empty', t('cerberus.history.noChecks'), t('cerberus.history.noChecksMeta'));
  if (index !== 'ready') return null;
  if (chosen === null) return prompt('choose', t('cerberus.history.chooseCheck'));
  if (failure === 'gone') return prompt('gone', t('cerberus.sheet.gone'), t('cerberus.history.goneMeta'));
  if (answer === null) return null;
  if (!isWholeDate(date)) return prompt('date', t('cerberus.history.pickADate'));
  if (!isWholeTime(time)) return prompt('time', t('cerberus.lookup.typeATime'));
  return {
    key: `${answer.lookup.check}@${answer.lookup.at}`,
    content: <LookupSentence size="lg" lookup={answer.lookup} check={answer.check} now={now} />,
  };
}

/** The `from` of the minute that holds the looked-up moment, which the strip outlines as the one looked up. */
const minuteOf = (cells: CerberusCell[], at: number) => cells.find((cell) => cell.from <= at && at < cell.to)?.from;

/** The answer's placeholder: a round glyph and two lines, the shape of the sentence about to land. */
function WaitingAnswer() {
  const { t } = useTranslation();
  return (
    <div className={cn('flex items-start gap-3', WAIT_THEN_FADE)}>
      <span className="sr-only">{t('cerberus.history.lookingUp')}</span>
      <div aria-hidden className="vv-skeleton size-8 flex-none rounded-full" />
      <div aria-hidden className="flex min-w-0 flex-1 flex-col gap-2 pt-1">
        <div className="vv-skeleton h-[18px] w-4/5" />
        <div className="vv-skeleton h-3 w-1/2" />
      </div>
    </div>
  );
}

/** The hour's and the results' placeholder: each block is the height of what it stands in for. */
function WaitingSections() {
  return (
    <div aria-hidden className={cn('flex flex-col gap-4', WAIT_THEN_FADE)}>
      <div className="flex flex-col gap-1.5">
        <div className="vv-skeleton h-3 w-52" />
        <div className="vv-skeleton h-[26px]" />
      </div>
      <div className="flex flex-col gap-1.5">
        <div className="vv-skeleton h-3 w-56" />
        <div className="vv-skeleton h-[34px]" />
        <div className="vv-skeleton h-[34px]" />
        <div className="vv-skeleton h-[34px]" />
      </div>
    </div>
  );
}

/**
 * "LOOK UP A CHECK": what one check was at any date and second. The answer leads, in a sentence with
 * its glyph (`LookupSentence` at its large size). Then come the hour up to that moment, where a minute
 * pressed moves the time to it, and the change rows of the 3 h up to it. The fields sit above the
 * answer: Check (every active check), Date and At, to the second.
 *
 * Every word under the fields describes the latest answer: the raw line, the sentence, the hour's and
 * the results' times. A newly typed moment keeps the last answer on screen until its own lands, and
 * that answer names its own moment, its date included whenever it is not today's (`stampOf`), so it
 * never says something untrue about the date or the time in the fields. A cleared date or a half-typed
 * time puts its prompt in the sentence's place.
 *
 * Its states: the index being read or unread, no checks at all, no check chosen, the chosen check
 * retired ("Cerberus no longer watches this check."), the answer being read, and Cerberus out of
 * reach, with the last answer still drawn under the banner when there is one.
 *
 * Used by `HistoryView`, which reads everything it draws and handles every press.
 */
export function LookupCard({ checks, checksFailed, chosen, date, time, detail, failure, now, onCheck, onDate, onTime, onPick, onRetry }: LookupCardProps) {
  const { t, i18n } = useTranslation();
  const headingId = useId();
  const dateId = useId();
  const timeId = useId();
  const language = i18n.resolvedLanguage;
  const options = useMemo(() => (checks === null ? [] : optionsOf(t, checks, language)), [checks, t, language]);

  const index: IndexState = checks === null ? (checksFailed ? 'failed' : 'reading') : checks.length === 0 ? 'empty' : 'ready';
  const answer = index === 'ready' && chosen !== null && failure !== 'gone' ? detail : null;
  const waiting = index === 'reading' || (index === 'ready' && chosen !== null && failure === null && detail === null);
  const unreachable = index === 'failed' || (index === 'ready' && chosen !== null && failure === 'unreachable');
  const well = wellOf(t, { index, chosen, failure, answer, date, time, now });
  const every = answer === null ? null : stretchKey(answer.check.every);
  const answeredAt = answer === null ? null : stampOf(answer.lookup.at, now);

  return (
    <Card role="region" aria-labelledby={headingId} className="flex min-w-0 flex-col gap-4 px-[18px] py-4">
      <h2 id={headingId} className={EYEBROW}>{t('cerberus.history.eyebrow')}</h2>
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-[2_1_260px]">
          <Field label={t('cerberus.history.check')}>
            {index === 'ready' ? (
              <Select
                size="sm"
                options={options}
                value={chosen ?? ''}
                onChange={onCheck}
                ariaLabel={t('cerberus.history.check')}
                placeholder={t('cerberus.history.choose')}
              />
            ) : (
              // Until the index answers there is nothing to pick, so the picker's place holds a field that
              // says so, the picker's height and no list to open.
              <Input
                disabled
                aria-label={t('cerberus.history.check')}
                placeholder={index === 'reading' ? t('cerberus.history.readingChecks') : undefined}
                className={FIELD_HEIGHT}
              />
            )}
          </Field>
        </div>
        {/* Date and At are the two halves of one moment, so they wrap as one: the row breaks Check over the
            moment, never leaving At alone. They part only where the pair itself is under 312 px. */}
        <div className="flex min-w-0 flex-[2_1_312px] flex-wrap items-start gap-3">
          <div className="min-w-0 flex-[1_1_150px]">
            <Field label={t('cerberus.history.date')} htmlFor={dateId}>
              <Input
                id={dateId}
                type="date"
                value={date}
                onChange={(event) => onDate(event.target.value)}
                className={cn(FIELD_HEIGHT, 'tabular-nums')}
              />
            </Field>
          </div>
          <div className="min-w-0 flex-[1_1_150px]">
            <Field label={t('cerberus.history.at')} htmlFor={timeId} helper={t('cerberus.history.atHelper')}>
              <Input
                id={timeId}
                type="time"
                step={1}
                value={time}
                onChange={(event) => onTime(event.target.value)}
                aria-describedby={`${timeId}-helper`}
                className={cn(FIELD_HEIGHT, 'tabular-nums')}
              />
            </Field>
          </div>
        </div>
      </div>

      {unreachable && <UnreachableBanner onRetry={onRetry} detail={answer === null ? undefined : t('cerberus.errors.lastAnswer')} />}

      {answer !== null && every !== null && (
        <p className="font-mono text-[11.5px] text-ink-faint [overflow-wrap:anywhere]">
          {t('cerberus.history.raw', { key: answer.check.key, node: answer.check.node, every: t(every.key, { count: every.count }) })}
        </p>
      )}

      {/* The answer well is the polite live region, and it is never unmounted: a region inserted along
          with its content goes unannounced, so the first answer after Cerberus comes back would be silent.
          With nothing to say it keeps no frame and stands out of the column's flow (`sr-only`), so the
          gap above it does not open. Each answer, prompt or placeholder remounts inside it. */}
      <div aria-live="polite" aria-atomic="true" className={waiting || well !== null ? WELL_FRAME : 'sr-only'}>
        {waiting ? <WaitingAnswer /> : well !== null && (
          <div key={well.key} className="motion-safe:animate-cerberus-line">{well.content}</div>
        )}
      </div>

      {answer !== null ? (
        <>
          <div className="flex flex-col gap-1.5">
            <h3 className={EYEBROW}>{t('cerberus.history.hour', { time: answeredAt })}</h3>
            <MinuteCells cells={answer.cells} selectedFrom={minuteOf(answer.cells, answer.lookup.at)} onPick={onPick} />
          </div>
          <div className="flex flex-col gap-1.5">
            <h3 className={EYEBROW}>{t('cerberus.history.recorded', { time: answeredAt })}</h3>
            {/* Keyed by check: "Show N more" is a choice about one check's rows, not the next one's. */}
            <RecordedResults key={chosen} rows={answer.recent} emptyText={t('cerberus.history.noChanges', { time: answeredAt })} />
          </div>
        </>
      ) : waiting ? <WaitingSections /> : null}
    </Card>
  );
}
