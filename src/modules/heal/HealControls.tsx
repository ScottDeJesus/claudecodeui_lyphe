import { PlusIcon } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { useHeal } from '@/modules/heal/context/HealContext';
import { agoWord } from '@/modules/heal/healState';
import type { HealCycleSwitch, HealSwitches, IgnoreRow } from '@/modules/heal/healTypes';
import { api, readApiJson } from '@/shared/api';
import { Badge, Button, Field, Input, Stepper, Switch } from '@/shared/ui';

/**
 * `10:00 UTC · 03:00 AM local` — the slot as the worker keeps it and as the reader's own clock will
 * show it. Both, always: a bare UTC hour reads as mid-morning to an operator in PDT whose cycle in
 * fact opens at three in the night. Today's date, so daylight saving is the reader's real offset.
 * The hour is the flag's UTC hour; the local time is display only and is never written.
 */
function hourWord(hour: number): string {
  const today = new Date();
  const slot = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), hour));
  const local = slot.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return `${String(hour).padStart(2, '0')}:00 UTC · ${local} local`;
}

/** The schedule door's `{enabled, hour}` as the payload's `{on, hour}`, or null for a body that is not one. */
function scheduleOf(body: unknown): HealCycleSwitch | null {
  if (typeof body !== 'object' || body === null) return null;
  const { enabled, hour } = body as { enabled?: unknown; hour?: unknown };
  if (typeof enabled !== 'boolean' || typeof hour !== 'number' || !Number.isInteger(hour)) return null;
  return { on: enabled, hour };
}

/**
 * The operator's settings and the ignore table. Every switch is a file the worker RE-READS on its
 * next trigger, so a flip here reaches the next ending with nothing restarted.
 *
 * THE SCHEDULE ROW is `state/heal_cycle.flag`, read off its own door when the dialog opens and
 * written back through it; what it draws is always the file's answer, never the press. Its shape is
 * the swarm row's (`RunnerModelContent.tsx`):
 * the hour stepper beside the toggle, both live whether the schedule is on or off, so an hour chosen
 * while off is carried by the next ON press. A stepper and not a number field, because the reader is
 * choosing a slot on a 24-step scale, which is a press and not a figure to type. The daily cap IS a
 * figure to type.
 */
export function HealControls({ switches, ignore }: { switches: HealSwitches; ignore: IgnoreRow[] }) {
  const { t } = useTranslation();
  // ONE WRITE AT A TIME, the swarm row's own rule: the flag file holds one line, and a second press
  // issued before the first has read back would compute its value off props that have not moved yet.
  // A press while one is crossing is DROPPED, not queued. Every write ends in `refresh()`, so what
  // these rows draw is the summary the server read back — a refused write leaves the old value
  // standing, never an optimistic flip.
  const { refresh } = useHeal();
  const writing = useRef(false);
  // The last add's swept count, null until one lands — the confirmation's whole content.
  const [swept, setSwept] = useState<number | null>(null);
  // The field is CONTROLLED off this text, so a cap the server reads back can repaint it — an
  // uncontrolled input binds once at mount and never shows the value the PUT or the poll returned.
  const [capText, setCapText] = useState(switches.daily_cap === null ? '' : String(switches.daily_cap));
  // Re-seeded whenever a DIFFERENT cap is read back — the poll's answer or a PUT's — so the box shows
  // the value the file holds and never the number that was typed at it. A poll landing mid-type is
  // left alone: the dependency does not move, and a half-typed amount was never the file's value.
  useEffect(() => {
    setCapText(switches.daily_cap === null ? '' : String(switches.daily_cap));
  }, [switches.daily_cap]);
  const save = async <T,>(work: () => Promise<Response>, what: string): Promise<T | null> => {
    if (writing.current) return null;
    writing.current = true;
    try {
      // The response is READ rather than dropped: this transport does not throw on a refusal, and a
      // 400 taken for a flip is a switch drawn on that the file never went to.
      return await readApiJson<T>(await work());
    } catch (error) {
      // The server's own sentence for the refusal; the read-back below is what the row shows.
      console.error(`Error saving ${what}:`, error);
      return null;
    } finally {
      writing.current = false;
      await refresh();
    }
  };
  // The schedule as the file last answered. The flag's own door (`GET /api/settings/heal-cycle`) is
  // read on open and every write adopts what it reads back — each answer kept WITH the payload
  // reading it was taken against, so a later poll that moved the file supersedes it on its own and
  // the row never shows an answer older than the summary.
  const polled = `${switches.cycle.on}:${switches.cycle.hour}`;
  const [answered, setAnswered] = useState<{ value: HealCycleSwitch; against: string } | null>(null);
  const schedule: HealCycleSwitch = answered !== null && answered.against === polled ? answered.value : switches.cycle;
  // The reading the dialog opened on: the open-time GET is weighed against it, and a poll that lands
  // while that GET is out supersedes the GET's answer rather than being overwritten by it.
  const openedOn = useRef(polled);
  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const read = scheduleOf(await readApiJson<unknown>(await api.settings.healCycle()));
        if (live && read !== null) setAnswered({ value: read, against: openedOn.current });
      } catch (error) {
        console.error('Error reading the nightly cycle schedule:', error);
      }
    })();
    return () => { live = false; };
  }, []);
  // The stepper and the toggle both write `{enabled, hour}` with the hour in UTC, the flag's own unit.
  const writeSchedule = (next: { enabled: boolean; hour: number }) => {
    void save<unknown>(() => api.settings.saveHealCycle(next), 'the nightly cycle').then((answer) => {
      const landed = scheduleOf(answer);
      if (landed !== null) setAnswered({ value: landed, against: polled });
    });
  };
  const onScheduleToggle = (next: boolean): void => writeSchedule({ enabled: next, hour: schedule.hour });
  const onScheduleHour = (hour: number): void => {
    if (hour < 0 || hour > 23) return;
    writeSchedule({ enabled: schedule.on, hour });
  };
  const onDailyCap = (raw: string) => {
    const typed = raw.trim();
    // BLANK IS NO CEILING, the switch's shipped state. Anything else that is not a number is refused
    // HERE, because both `Number('')` and `JSON.stringify(NaN)` reach the server as `null` and would
    // silently clear a ceiling the operator meant to set.
    const usd = typed === '' ? null : Number(typed);
    if (usd !== null && !Number.isFinite(usd)) {
      console.error(`Error saving the daily heal cap: "${raw}" is not a dollar amount`);
      setCapText(switches.daily_cap === null ? '' : String(switches.daily_cap));
      return;
    }
    void save(() => api.settings.saveHealCap(usd), 'the daily heal cap').then((landed) => {
      // A REFUSED cap snaps the box back to the value the file holds: a rejected number left standing
      // reads as a ceiling that is in force. A landed one is repainted by the refresh above.
      if (landed === null) setCapText(switches.daily_cap === null ? '' : String(switches.daily_cap));
    });
  };
  const onAddIgnore = (form: HTMLFormElement) => {
    const fields = new FormData(form);
    const tool = String(fields.get('tool') ?? '').trim();
    const pattern = String(fields.get('pattern') ?? '').trim();
    const reason = String(fields.get('reason') ?? '').trim();
    void save<{ added: number; swept: number }>(
      () => api.heal.addIgnore({ tool, pattern, reason }),
      'an ignore row',
    ).then((answer) => {
      // `null` is a dropped press or a refusal, both logged already; the table is re-read either way,
      // so an add that did not land shows the table unchanged rather than a confirmation of nothing.
      if (answer === null) return;
      setSwept(answer.swept);
      // The row is added by the read-back below, so the form is what is cleared here — and with it
      // the last add's confirmation, which is retired by this one.
      form.reset();
    });
  };

  return (
    <div className="flex min-w-0 flex-col divide-y divide-border rounded-lg border border-border" data-heal-controls>
      <ControlRow
        label={t('heal.schedule.label', { defaultValue: 'Nightly maintenance cycle' })}
        description={schedule.on
          ? t('heal.schedule.on', { defaultValue: 'Every day at {{slot}} a cycle opens on its own: Chiron ranks what hurt over the last two weeks, and heals walk his list one after another. It runs beside whatever else is walking. Takes effect at the next slot.', slot: hourWord(schedule.hour) })
          : t('heal.schedule.off', { defaultValue: 'Off: only Run a cycle now opens one. On, a cycle opens every day at the hour beside it, unless one is still open.' })}
        data-heal-schedule
      >
        <div className="flex items-center gap-3">
          <Stepper
            value={hourWord(schedule.hour)}
            onDecrease={() => onScheduleHour(schedule.hour - 1)}
            onIncrease={() => onScheduleHour(schedule.hour + 1)}
            canDecrease={schedule.hour > 0}
            canIncrease={schedule.hour < 23}
            decreaseLabel={t('heal.schedule.hourDown', { defaultValue: 'One hour earlier' })}
            increaseLabel={t('heal.schedule.hourUp', { defaultValue: 'One hour later' })}
            ariaLabel={t('heal.schedule.hourLabel', { defaultValue: 'Hour the nightly cycle opens, UTC' })}
          />
          <Switch checked={schedule.on} onChange={onScheduleToggle} label={t('heal.schedule.label', { defaultValue: 'Nightly maintenance cycle' })} />
        </div>
      </ControlRow>

      <ControlRow
        label={t('heal.cap.label', { defaultValue: 'Daily cap' })}
        description={t('heal.cap.description', { defaultValue: 'The most a day of DeepSeek heals may spend before a cycle waits until midnight instead; blank is no ceiling. It counts DeepSeek dollars only — heals on Claude, your subscription, are never counted here and never held by it.' })}
      >
        <Field label={t('heal.cap.field', { defaultValue: 'USD per day' })} htmlFor="heal-daily-cap">
          <Input
            id="heal-daily-cap"
            type="number"
            inputMode="decimal"
            min={0}
            step={0.5}
            className="w-32"
            value={capText}
            placeholder={t('heal.cap.none', { defaultValue: 'no ceiling' })}
            onChange={(event) => setCapText(event.currentTarget.value)}
            onBlur={() => onDailyCap(capText)}
          />
        </Field>
      </ControlRow>

      <IgnoreTable rows={ignore} swept={swept} onAdd={onAddIgnore} />
    </div>
  );
}

/**
 * One labelled setting and its control — `settings/SettingsRow`'s classes, stacked below `sm`. Not
 * that component: the boundaries lint admits another module only through its barrel, which does not
 * export the row, and a second consumer is the kit's own admission test (`@/shared/ui/index.ts`) —
 * promoting it is a change of its own, not this screen's.
 */
function ControlRow({ label, description, children, ...rest }: { label: string; description: string; children: ReactNode; 'data-heal-schedule'?: boolean }) {
  return (
    // Stacked on a phone, side by side from `sm`: a stepper and a switch beside a six-line
    // description at 390px is two columns neither of which can be read.
    <div className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-start sm:justify-between sm:gap-4" {...rest}>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-foreground">{label}</div>
        <div className="mt-1 text-xs leading-relaxed text-muted-foreground">{description}</div>
      </div>
      {/* Top-aligned, not centred: a two-line helper would drag the control down with it. */}
      <div className="flex-shrink-0 sm:pt-0.5">{children}</div>
    </div>
  );
}

/**
 * What is ignored by design, and the door for adding a row. THE TABLE IS RETROACTIVE — the
 * operator adds a row precisely when he has just seen a refusal counted as pain — so the
 * confirmation says how many EXISTING rows the new pattern swept, not just that it was added.
 * There is no remove control: un-ignoring is the operator's call at the ledger, never a cascade.
 */
function IgnoreTable({ rows, swept, onAdd }: { rows: IgnoreRow[]; swept: number | null; onAdd: (form: HTMLFormElement) => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex min-w-0 flex-col gap-3 px-4 py-4" data-heal-ignore>
      <div>
        <div className="text-sm font-medium text-foreground">{t('heal.ignore.label', { defaultValue: 'Ignored by design' })}</div>
        <div className="mt-1 text-xs leading-relaxed text-muted-foreground">
          {t('heal.ignore.description', { defaultValue: 'A row here is never counted as pain. Adding one is retroactive: every existing row it matches is ignored too, and the count is shown.' })}
        </div>
      </div>
      {/* Four columns on a desktop; on a phone each row stacks, since a regex and a reason side by side at 390px is two unreadable columns. */}
      <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
        {rows.map((row) => (
          <li key={row.id} className="grid gap-x-3 gap-y-1 px-3 py-2 text-xs sm:grid-cols-[5rem_minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-center" data-heal-ignore-row={row.id}>
            <Badge as="span" tone="neutral" className="w-fit font-mono">{row.tool}</Badge>
            <code className="min-w-0 break-all font-mono">{row.pattern}</code>
            <span className="min-w-0 break-words text-muted-foreground">{row.reason}</span>
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <Badge as="span" tone={row.added_by === 'heal' ? 'info' : 'neutral'}>{row.added_by}</Badge>
              {agoWord(row.added_at)}
            </span>
          </li>
        ))}
      </ul>
      <form
        className="grid gap-2 sm:grid-cols-[6rem_minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end"
        onSubmit={(event) => { event.preventDefault(); onAdd(event.currentTarget); }}
      >
        <Field label={t('heal.ignore.tool', { defaultValue: 'Tool' })} htmlFor="heal-ignore-tool">
          <Input id="heal-ignore-tool" name="tool" placeholder="* or Bash" />
        </Field>
        <Field label={t('heal.ignore.pattern', { defaultValue: 'Pattern (regex)' })} htmlFor="heal-ignore-pattern">
          <Input id="heal-ignore-pattern" name="pattern" className="font-mono" placeholder="crontab\s+-" />
        </Field>
        <Field label={t('heal.ignore.reason', { defaultValue: 'Reason' })} htmlFor="heal-ignore-reason">
          <Input id="heal-ignore-reason" name="reason" placeholder={t('heal.ignore.reasonHint', { defaultValue: 'why this is by design' })} />
        </Field>
        <Button type="submit" variant="secondary" size="sm" data-heal-ignore-add>
          <PlusIcon aria-hidden="true" />
          {t('heal.ignore.add', { defaultValue: 'Add ignore' })}
        </Button>
      </form>
      {swept !== null && (
        <Badge tone="positive" className="w-fit" role="status">
          {t('heal.ignore.swept', { defaultValue: 'Added · ignored {{count}} existing rows', count: swept })}
        </Badge>
      )}
    </div>
  );
}
