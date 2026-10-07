import type { TFunction } from 'i18next';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useCerberus } from '@/modules/cerberus/context/CerberusContext';
import { hms } from '@/modules/cerberus/utils/cerberusTime';
import type { CerberusCheckView, CerberusDiagnosisView } from '@/shared/cerberus-types';
import { useReturnFocus } from '@/shared/hooks/useReturnFocus';
import { Button, Chip, DialogFrame, Field, Input, Switch } from '@/shared/ui';

/** The limits the dialog offers, in runs an hour: the prototype's three chips. */
const LIMITS = [1, 2, 4] as const;

/** The limit a promotion starts on: the prototype's middle chip. */
const DEFAULT_LIMIT = 2;

/** The window every limit chip counts runs in: an hour, in seconds, as `CerberusCatalogEntryView.limit.per` holds it. */
const PER_HOUR_S = 3_600;

/** The server's own limit on an entry's name (`catalog-entry-input.ts`), met as it is typed. */
const NAME_MAX = 100;

/** A relative window as general writes it — `15m`, `"15 min ago"`, `2h` — caught for its number and unit. */
const RELATIVE_WINDOW = /^"?(\d+)\s*(m|mins?|minutes?|h|hrs?|hours?)(?:\s+ago)?"?$/i;

/**
 * What `general` changed in the diagnosis's `cmd`: the words of each between the stretch they start with
 * and the stretch they end with, both the same. "--since 17:50" against "--since 15m" is `17:50` and `15m`.
 * A change that removed or added words alone has no span on one side; the whole command stands for it there.
 */
function changedSpans(cmd: string, general: string): { used: string; saved: string } {
  const before = cmd.trim().split(/\s+/);
  const after = general.trim().split(/\s+/);
  let head = 0;
  while (head < before.length && head < after.length && before[head] === after[head]) head += 1;
  let tail = 0;
  while (tail < before.length - head && tail < after.length - head && before[before.length - 1 - tail] === after[after.length - 1 - tail]) tail += 1;
  const used = before.slice(head, before.length - tail).join(' ');
  const saved = after.slice(head, after.length - tail).join(' ');
  return { used: used || cmd, saved: saved || general };
}

/** "the last 15 min", "the last 2 h" for a relative window; the span as written for anything else. */
function windowWords(t: TFunction, span: string): string {
  const match = RELATIVE_WINDOW.exec(span);
  if (match === null) return span;
  const unit = match[2].toLowerCase().startsWith('h') ? 'hours' : 'minutes';
  return t('cerberus.promote.last', { window: t(`cerberus.time.${unit}`, { count: Number(match[1]) }) });
}

type PromoteDialogProps = {
  /** Whether the dialog is up. Closed, nothing of it is mounted, so it opens clean every time. */
  open: boolean;
  /** The diagnosis whose Add to catalog was pressed. `null`, or one with no proposal, draws nothing. */
  diagnosis: CerberusDiagnosisView | null;
  /** The check it diagnosed, as the fleet holds it: the entry's check and the words that name it come from it. */
  check: CerberusCheckView | null;
  /** Cancel, the ✕, Escape and the backdrop: closed with nothing written. */
  onClose: () => void;
  /** The promotion landed (the provider has raised its toast and re-read the catalog): the root closes this dialog and the sheet behind it, and shows the Catalog, where the entry stands new. */
  onPromoted: () => void;
};

/**
 * ADD TO THE CATALOG: a diagnosis's proposal becomes an entry (`design/cerberus/Cerberus Tab.dc.html`
 * :560-594; spec §3, "Promoting a diagnosis").
 *
 * It reads top to bottom as the entry it will be: where it comes from ("From the diagnosis at 17:53:14 ·
 * read-only · 3 pieces of evidence"); its Name, which starts as the proposal's and is what the fix button
 * will say; When it applies — the diagnosed check's trigger in words over its raw key and state, as the
 * Catalog spells it; what it Runs — `general`, in mono, and why that is not the very command the diagnosis
 * proposed ("The diagnosis used 17:50. It's saved as “the last 15 min” so it works next time.") or that it
 * is ("Saved exactly as the diagnosis proposed it."); whether it runs on its own — off, as every entry
 * starts — with what that means now; and its Limit, three chips, which hold whether or not it runs on its own.
 *
 * Nothing is optimistic, as in Mute: a promotion that lands raises the toast "Added to the catalog · <name> ·
 * auto-run off" and hands over to the root, which closes the dialog and shows the Catalog with the entry new at its
 * top; a refusal keeps the dialog open with what was typed, beside the provider's toast; while the write is out
 * every control and every way out waits.
 *
 * For the cerberus module's `CerberusPanel`, which hosts one between its Mute and Enroll dialogs and opens it from the
 * diagnosis's Add to catalog, in front of the sheet.
 */
export function PromoteDialog({ open, diagnosis, check, onClose, onPromoted }: PromoteDialogProps) {
  if (!open || diagnosis === null || diagnosis.proposal === null || check === null) return null;
  // Keyed by the diagnosis, so a dialog sent straight to another diagnosis starts over.
  return <PromoteForm key={diagnosis.id} diagnosis={diagnosis} proposal={diagnosis.proposal} check={check} onClose={onClose} onPromoted={onPromoted} />;
}

type PromoteFormProps = {
  diagnosis: CerberusDiagnosisView;
  proposal: NonNullable<CerberusDiagnosisView['proposal']>;
  check: CerberusCheckView;
  onClose: () => void;
  onPromoted: () => void;
};

/** The dialog itself, mounted for as long as it is open. */
function PromoteForm({ diagnosis, proposal, check, onClose, onPromoted }: PromoteFormProps) {
  const { t } = useTranslation();
  const fieldId = useId();
  const { promote } = useCerberus();
  useReturnFocus();

  // The entry's name as typed. Essential: it starts as the proposal's own and the person may rename it.
  const [name, setName] = useState(proposal.name);
  // Whether the entry runs on its own. Essential: a switch the person sets; it starts off, as every entry does.
  const [auto, setAuto] = useState(false);
  // The chip chosen, in runs an hour. Essential: a choice the person makes, saved whether or not auto is on.
  const [limit, setLimit] = useState<number>(DEFAULT_LIMIT);
  // Whether the promotion is out. Essential: it holds every control and every way out until center answers, so a
  // refusal finds the dialog as it was left, with what was typed.
  const [busy, setBusy] = useState(false);
  // The press: `promote` raises its own toast (the entry added, or the server's sentence for why not). A landed one hands
  // over to the root, which shows the Catalog; a refused one opens the form again.
  const onConfirm = async () => {
    setBusy(true);
    const landed = await promote(diagnosis.id, { name: name.trim(), auto, limit: { runs: limit, per: PER_HOUR_S } });
    setBusy(false);
    if (landed) onPromoted();
  };

  // The entry's `when` is the word the server will write: the check's STORED status when the diagnosis began (a `warn` entry for a
  // check that was only near its limit, else `failing`), never its status now — a fix that worked has turned the check green by now.
  const { when } = diagnosis;
  const service = check.serviceLabel ?? check.service;
  const generalized = proposal.general !== proposal.cmd ? changedSpans(proposal.cmd, proposal.general) : null;
  const blank = name.trim() === '';
  const perHour = t('cerberus.promote.perHour', { count: limit });
  // Closing without writing: Cancel, the ✕, Escape and the backdrop. Never while the promotion is out — its answer decides.
  const dismiss = () => {
    if (!busy) onClose();
  };

  return (
    <DialogFrame
      size="lg"
      data-cerberus-dialog="promote"
      title={t('cerberus.promote.title')}
      accent={{ words: t('cerberus.promote.accent') }}
      busy={busy}
      onDismiss={dismiss}
    >
      <form
        className="flex flex-col gap-[18px]"
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy && !blank) void onConfirm();
        }}
      >
        <p className="text-[13px] text-muted-foreground">
          {t('cerberus.promote.from', { time: hms(diagnosis.startedAt), count: diagnosis.evidence.length })}
        </p>

        <Field label={t('cerberus.promote.name')} htmlFor={`${fieldId}-name`} helper={t('cerberus.promote.nameHelper')}>
          <Input
            id={`${fieldId}-name`}
            value={name}
            maxLength={NAME_MAX}
            readOnly={busy}
            invalid={blank}
            aria-describedby={`${fieldId}-name-helper`}
            onChange={(event) => setName(event.target.value)}
          />
        </Field>

        {/* Read, not set: the trigger in words over its raw key and state, as the Catalog writes the entry it becomes. */}
        <Field label={t('cerberus.promote.when')}>
          <div className="flex flex-col gap-0.5">
            <p className="text-sm text-secondary-foreground [overflow-wrap:anywhere]">
              {check.label ?? <span className="font-mono text-[13px]">{check.key}</span>}{' '}
              {t(`cerberus.catalog.trigger.${when}`, { service, node: check.node })}
            </p>
            <p className="font-mono text-[11.5px] text-muted-foreground [overflow-wrap:anywhere]">{t('cerberus.catalog.raw', { key: check.key, when })}</p>
          </div>
        </Field>

        <Field
          label={t('cerberus.promote.runs')}
          helper={generalized === null
            ? t('cerberus.promote.exact')
            : t('cerberus.promote.generalized', { used: generalized.used, saved: windowWords(t, generalized.saved) })}
        >
          <p className="rounded-[10px] bg-secondary px-3 py-2.5 font-mono text-xs text-secondary-foreground [overflow-wrap:anywhere]">
            {t('cerberus.fix.command', { cmd: proposal.general })}
          </p>
        </Field>

        <div className="flex items-start gap-3.5">
          <Switch checked={auto} onChange={setAuto} disabled={busy} label={t('cerberus.promote.auto')} />
          <div className="min-w-0">
            <p className="text-sm font-medium">{t('cerberus.promote.auto')}</p>
            <p className="text-[12.5px] text-muted-foreground">
              {auto ? t('cerberus.promote.autoOn', { context: when, limit: perHour }) : t('cerberus.promote.autoOff')}
            </p>
          </div>
        </div>

        <Field label={t('cerberus.promote.limit')} htmlFor={`${fieldId}-limit`} helper={t('cerberus.promote.limitHelper')}>
          {/* One choice of three, so a group named by the field, its helper the promise the limit keeps. */}
          <div
            id={`${fieldId}-limit`}
            role="group"
            aria-label={t('cerberus.promote.limit')}
            aria-describedby={`${fieldId}-limit-helper`}
            className="flex flex-wrap gap-2"
          >
            {LIMITS.map((runs) => (
              <Chip
                key={runs}
                selected={runs === limit}
                busy={busy}
                className="max-md:min-h-11"
                onClick={() => {
                  if (!busy) setLimit(runs);
                }}
              >
                {t('cerberus.promote.perHour', { count: runs })}
              </Chip>
            ))}
          </div>
        </Field>

        <div className="mt-1.5 flex flex-wrap justify-end gap-3">
          <Button type="button" variant="outline" className="max-md:h-11" disabled={busy} onClick={dismiss}>
            {t('cerberus.promote.cancel')}
          </Button>
          {/* `busy`, not disabled, as Mute's: a disabled button gives up the focus it holds the moment the
              write goes out. With no name it is aria-disabled: refused, and still where the focus is. */}
          <Button type="submit" className="max-md:h-11" busy={busy} aria-disabled={blank || undefined}>
            {t('cerberus.promote.confirm')}
          </Button>
        </div>
      </form>
    </DialogFrame>
  );
}
