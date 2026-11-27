import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { RND_WEEKDAYS, weekdayName } from '@/modules/rnd/scheduleWords';
import type { RndFrequency, RndSchedule, RndScheduleChange, RndWeekday } from '@/shared/rnd-types';
import { Field, Input, Rule, SegmentedControl } from '@/shared/ui';

const FREQUENCIES: readonly RndFrequency[] = ['off', 'daily', 'weekly', 'monthly'];
const FREQUENCY_WORDS: Record<RndFrequency, string> = {
  off: 'rnd.settings.frequencyOff',
  daily: 'rnd.settings.frequencyDaily',
  weekly: 'rnd.settings.frequencyWeekly',
  monthly: 'rnd.settings.frequencyMonthly',
};
/** The last day of the month a monthly scout may take: every month has a 28th, so none is skipped. */
const MONTH_DAY_LAST = 28;
/** HH:MM on a 24-hour clock, what a time field hands back once a whole time is in it. */
const CLOCK_TIME = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;

type RndScheduleSectionProps = {
  schedule: RndSchedule;
  /** A change made in the sheet is out: every control waits. */
  busy: boolean;
  onSchedule: (change: RndScheduleChange) => void;
};

/**
 * Used by the R&D settings sheet: how often the scout goes out by itself. The frequency, then the day where one applies (a
 * weekday for weekly, 1 to 28 for monthly) and the time; each change saves as it is made, like the sheet's other controls.
 * A typed day or time saves when the field is left or Enter is pressed, so a half-typed value never moves the crontab line.
 * A press made while a save is out (a frequency pressed straight after typing a time, whose blur sent that save) is held and
 * sent when the save ends, never dropped: the kit's SegmentedControl has no disabled state to show that it waits.
 */
export function RndScheduleSection({ schedule, busy, onSchedule }: RndScheduleSectionProps) {
  const { t, i18n } = useTranslation();
  const headingId = useId();
  const dayId = useId();
  const timeId = useId();
  const [held, setHeld] = useState<RndScheduleChange | null>(null);
  const change = (next: RndScheduleChange) => {
    if (busy) setHeld((before) => ({ ...before, ...next }));
    else onSchedule(next);
  };
  useEffect(() => {
    if (busy || held === null) return;
    setHeld(null);
    onSchedule(held);
  }, [busy, held, onSchedule]);
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3" data-rnd-frequency={schedule.frequency}>
      <Rule id={headingId}>{t('rnd.settings.frequency')}</Rule>
      <p className="text-xs leading-relaxed text-muted-foreground">{t('rnd.settings.frequencyAbout')}</p>
      <SegmentedControl<RndFrequency>
        label={t('rnd.settings.frequency')}
        options={FREQUENCIES.map((value) => ({ value, label: t(FREQUENCY_WORDS[value]) }))}
        value={schedule.frequency}
        onChange={(next) => {
          if (next !== schedule.frequency) change({ frequency: next });
        }}
      />
      {schedule.frequency === 'weekly' && (
        <Field label={t('rnd.settings.weekday')}>
          <SegmentedControl<RndWeekday>
            label={t('rnd.settings.weekday')}
            options={RND_WEEKDAYS.map((value) => ({ value, label: weekdayName(value, i18n.language, 'short') }))}
            value={schedule.day}
            onChange={(next) => {
              if (next !== schedule.day) change({ day: next });
            }}
          />
        </Field>
      )}
      {schedule.frequency === 'monthly' && (
        <MonthDayField key={schedule.day} id={dayId} day={schedule.day} busy={busy} onCommit={(day) => change({ day })} />
      )}
      {schedule.frequency !== 'off' && (
        <TimeField key={schedule.time} id={timeId} time={schedule.time} busy={busy} onCommit={(time) => change({ time })} />
      )}
    </section>
  );
}

type MonthDayFieldProps = { id: string; day: number; busy: boolean; onCommit: (day: number) => void };

/** Keyed by the stored day, so a saved change remounts it; a refused one leaves the stored day as it was, so the draft is put back when the save ends. */
function MonthDayField({ id, day, busy, onCommit }: MonthDayFieldProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(String(day));
  useEffect(() => {
    if (!busy) setDraft(String(day));
  }, [busy, day]);
  const typed = Number(draft);
  const isValid = Number.isInteger(typed) && typed >= 1 && typed <= MONTH_DAY_LAST;
  return (
    <Field label={t('rnd.settings.monthDay')} htmlFor={id} helper={t('rnd.settings.monthDayHelper')} error={isValid ? undefined : t('rnd.settings.monthDayHelper')}>
      <Input
        id={id}
        type="number"
        inputMode="numeric"
        min={1}
        max={MONTH_DAY_LAST}
        value={draft}
        disabled={busy}
        invalid={!isValid}
        aria-describedby={`${id}-helper`}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          if (isValid && typed !== day) onCommit(typed);
        }}
        onKeyDown={(event) => {
          // An Enter that ends an IME composition is the composition's, not a save.
          if (event.key === 'Enter' && !event.nativeEvent.isComposing) event.currentTarget.blur();
        }}
      />
    </Field>
  );
}

type TimeFieldProps = { id: string; time: string; busy: boolean; onCommit: (time: string) => void };

/** Keyed by the stored time, and put back to it when a refused save ends, like MonthDayField. */
function TimeField({ id, time, busy, onCommit }: TimeFieldProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(time);
  useEffect(() => {
    if (!busy) setDraft(time);
  }, [busy, time]);
  const isValid = CLOCK_TIME.test(draft);
  return (
    <Field label={t('rnd.settings.time')} htmlFor={id} helper={t('rnd.settings.timeHelper')} error={isValid ? undefined : t('rnd.settings.timeInvalid')}>
      <Input
        id={id}
        type="time"
        value={draft}
        disabled={busy}
        invalid={!isValid}
        aria-describedby={`${id}-helper`}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          if (isValid && draft !== time) onCommit(draft);
        }}
        onKeyDown={(event) => {
          // An Enter that ends an IME composition is the composition's, not a save.
          if (event.key === 'Enter' && !event.nativeEvent.isComposing) event.currentTarget.blur();
        }}
      />
    </Field>
  );
}
