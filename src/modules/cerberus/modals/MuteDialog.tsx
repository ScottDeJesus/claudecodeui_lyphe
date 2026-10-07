import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useCerberus } from '@/modules/cerberus/context/CerberusContext';
import { DialogFrame } from '@/modules/cerberus/modals/DialogFrame';
import { hm, sameLocalDay } from '@/modules/cerberus/utils/cerberusTime';
import type { CerberusCheckView } from '@/shared/cerberus-types';
import { useReturnFocus } from '@/shared/hooks/useReturnFocus';
import { Button, Chip, Field, TextArea } from '@/shared/ui';

/**
 * How long a mute lasts, as the chips offer it: 15 min, 1 hour, 4 hours, or until the next 08:00 local —
 * today's while it is still to come, else tomorrow's. Turned into the mute's `until` by `liftsAt`.
 */
type CerberusMuteDuration = 'min15' | 'hour1' | 'hours4' | 'morning';

/** The chips, in the order they are offered: the three spans, then the next morning. */
const DURATIONS: readonly CerberusMuteDuration[] = ['min15', 'hour1', 'hours4', 'morning'];

/** The server's own limit on a reason (`mutes.service.ts`), met as it is typed. */
const REASON_MAX = 500;

/** One minute in ms: the unit of the spans below, and of the clock's turn that moves "Lifts on its own at". */
const MINUTE_MS = 60_000;

/** How long each of the three spans lasts. The fourth chip is a clock time, not a span. */
const SPAN_MS: Record<Exclude<CerberusMuteDuration, 'morning'>, number> = {
  min15: 15 * MINUTE_MS,
  hour1: 60 * MINUTE_MS,
  hours4: 240 * MINUTE_MS,
};

/** The hour a mute that lasts "until morning" lifts, local time. */
const MORNING_HOUR = 8;

/**
 * The longest a mute may last: a minute short of the server's 24 hours (`mutes.service.ts`), so a browser
 * clock a little ahead of center's is not refused at the bound.
 */
const MAX_LIFT_MS = 24 * 60 * MINUTE_MS - MINUTE_MS;

/**
 * The moment a duration lifts, counted from `from`: a span added to it, or the next 08:00 local. 08:00
 * is today's while it is still to come and tomorrow's from 08:00 on, which the dialog says aloud. The
 * date is set by calendar rather than by adding 24 h, so a day with a clock change still lands on 08:00.
 * The one exception is the hour after 08:00 on the day before a clock change that adds an hour, when
 * the next 08:00 is more than the server's 24 hours away: the mute then lifts at the bound, and the
 * chip, the line under it and the button all say that time instead of 08:00.
 */
function liftsAt(choice: CerberusMuteDuration, from: number): number {
  if (choice !== 'morning') return from + SPAN_MS[choice];
  const morning = new Date(from);
  morning.setHours(MORNING_HOUR, 0, 0, 0);
  if (morning.getTime() <= from) morning.setDate(morning.getDate() + 1);
  return Math.min(morning.getTime(), from + MAX_LIFT_MS);
}

/**
 * A check's name as it reads after "Mute": its first letter lowered, so "Session is valid" reads "Mute
 * *session is valid*". A first word with a second capital in it is an acronym or a brand and keeps its
 * capitals: "Mute *SMTP answers*", "Mute *CompanyCam polls are succeeding*".
 */
function lowerFirst(label: string): string {
  return /^\p{Lu}[^\p{Lu}\s]*(?:\s|$)/u.test(label) ? label.charAt(0).toLowerCase() + label.slice(1) : label;
}

type MuteDialogProps = {
  /** Whether the dialog is up. Closed, nothing of it is mounted, so it opens clean every time. */
  open: boolean;
  /** The check to mute, the one whose Mute was pressed. `null` draws nothing. */
  check: CerberusCheckView | null;
  /** Cancel, the ✕, Escape and the backdrop, and a mute that landed. */
  onClose: () => void;
};

/**
 * MUTE A CHECK: it stops asking for you, keeps running and recording, and lifts on its own
 * (`design/cerberus/Cerberus Tab.dc.html` :538-559).
 *
 * The question reads top to bottom: what is muted (the title, then the raw line with what the check
 * says now), what a mute does, for how long — four chips, with the moment it lifts under them — and
 * why, which is shown next to the mute until it lifts. The button says when it ends: "Mute until 18:07".
 *
 * Nothing is optimistic. A mute that lands closes the dialog, and the provider's toast says "Muted until
 * 18:07 · <label> keeps running and recording."; a refusal keeps it open with what was typed, beside the
 * provider's toast. While the write is out the chips and the field hold still, and Cancel, the ✕,
 * Escape and the backdrop wait for its answer.
 *
 * For the cerberus module's `CerberusPanel`, which hosts one and opens it from a Needs-you card's Mute
 * and from the check sheet's.
 */
export function MuteDialog({ open, check, onClose }: MuteDialogProps) {
  if (!open || check === null) return null;
  // Keyed by the check, so a dialog sent straight to another check starts over.
  return <MuteForm key={`${check.node}/${check.key}`} check={check} onClose={onClose} />;
}

/** The dialog itself, mounted for as long as it is open. */
function MuteForm({ check, onClose }: { check: CerberusCheckView; onClose: () => void }) {
  const { t } = useTranslation();
  const fieldId = useId();
  useReturnFocus();

  const { mute } = useCerberus();

  // The clock every time on the dialog is counted from. State, not a read at render, because a dialog left
  // open across a minute's turn must move "Lifts on its own at" and the button with it; the effect below
  // sets it again on each turn.
  const [now, setNow] = useState(() => Date.now());
  // The chip chosen. 'min15' at first: the shortest silence is the one a hand reaches for by default.
  const [duration, setDuration] = useState<CerberusMuteDuration>('min15');
  // What is typed under Why. Sent trimmed; the server stores an empty one as "No reason given".
  const [reason, setReason] = useState('');
  // True while the mute's write is out: it holds the chips, the field and every way out until the answer is in.
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // One timeout to the next minute's start, then another: the clock is read on the turn and never between.
    // A timer that fires a hair early only re-arms for the remaining milliseconds.
    let timer: number;
    const arm = () => {
      timer = window.setTimeout(() => {
        setNow(Date.now());
        arm();
      }, MINUTE_MS - (Date.now() % MINUTE_MS));
    };
    arm();
    return () => window.clearTimeout(timer);
  }, []);

  const untilOf = (choice: CerberusMuteDuration): number => liftsAt(choice, now);

  const onDuration = setDuration;
  const onReason = setReason;
  // The write counts `until` from the clock at the press, not from the minute the screen last read.
  const onConfirm = () => {
    setBusy(true);
    void mute({ node: check.node, key: check.key, until: liftsAt(duration, Date.now()), reason: reason.trim() }).then((landed) => {
      if (landed) onClose();
      else setBusy(false);
    });
  };

  const until = untilOf(duration);
  const lifts = t(sameLocalDay(until, now) ? 'cerberus.time.liftsAt' : 'cerberus.time.liftsTomorrow', { time: hm(until) });
  const service = check.serviceLabel ?? check.service;
  const raw = check.value === null
    ? t('cerberus.mute.rawNoValue', { service, key: check.key })
    : t('cerberus.mute.raw', { service, key: check.key, value: check.value });
  // Closing without writing: Cancel, the ✕, Escape and the backdrop. Never while the mute is out — its answer decides.
  const dismiss = () => {
    if (!busy) onClose();
  };

  return (
    <DialogFrame
      size="md"
      marker="mute"
      title={t('cerberus.mute.title')}
      accent={check.label === null ? { key: check.key } : { words: lowerFirst(check.label) }}
      busy={busy}
      onDismiss={dismiss}
    >
      <form
        className="flex flex-col gap-[18px]"
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy) onConfirm();
        }}
      >
        <p className="font-mono text-[11.5px] text-muted-foreground [overflow-wrap:anywhere]">{raw}</p>
        <p className="text-sm leading-[1.6] text-secondary-foreground">{t('cerberus.mute.intro')}</p>

        <Field label={t('cerberus.mute.forHowLong')} htmlFor={`${fieldId}-duration`} helper={`${lifts}. ${t('cerberus.mute.keepsRunning')}`}>
          {/* One choice of four, so a group named by the field. The moment it lifts is the helper under it. */}
          <div
            id={`${fieldId}-duration`}
            role="group"
            aria-label={t('cerberus.mute.forHowLong')}
            aria-describedby={`${fieldId}-duration-helper`}
            className="flex flex-wrap gap-2"
          >
            {DURATIONS.map((choice) => (
              <Chip
                key={choice}
                selected={choice === duration}
                busy={busy}
                className="max-md:min-h-11"
                onClick={() => {
                  if (!busy) onDuration(choice);
                }}
              >
                {choice === 'morning'
                  ? t('cerberus.mute.durations.untilTime', { time: hm(untilOf('morning')) })
                  : t(`cerberus.mute.durations.${choice}`)}
              </Chip>
            ))}
          </div>
        </Field>

        <Field label={t('cerberus.mute.why')} htmlFor={`${fieldId}-reason`} helper={t('cerberus.mute.reasonHelper')}>
          <TextArea
            id={`${fieldId}-reason`}
            rows={2}
            value={reason}
            maxLength={REASON_MAX}
            readOnly={busy}
            placeholder={t('cerberus.mute.reasonPlaceholder')}
            aria-describedby={`${fieldId}-reason-helper`}
            onChange={(event) => onReason(event.target.value)}
          />
        </Field>

        <div className="mt-1.5 flex flex-wrap justify-end gap-3">
          <Button type="button" variant="outline" className="max-md:h-11" disabled={busy} onClick={dismiss}>
            {t('cerberus.mute.cancel')}
          </Button>
          {/* aria-disabled, not disabled: a disabled button gives up the focus it holds the moment the write
              goes out, and a refusal would hand the person back a page with none. The form's own guard
              ignores a press while busy. */}
          <Button
            type="submit"
            className="aria-disabled:cursor-not-allowed aria-disabled:opacity-60 max-md:h-11"
            aria-disabled={busy || undefined}
            aria-busy={busy || undefined}
          >
            {t('cerberus.mute.confirm', { time: hm(until) })}
          </Button>
        </div>
      </form>
    </DialogFrame>
  );
}
