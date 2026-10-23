import { Gem } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useGeminiPlanCap } from '@/modules/settings/hooks/useGeminiPlanCap';
import { Button, Field, Input, SettingRow } from '@/shared/ui';

/** The field's id: its label's `htmlFor`, and the handle a verify script reads the amount by. */
const FIELD_ID = 'runner-gemini-budget-usd';

/** The row's own words, which the field points `aria-describedby` at: "USD per plan" alone names no cap. */
const ABOUT_ID = 'runner-gemini-budget-about';

/**
 * The amount as the field draws it: two decimals, so the shipped cap reads 5.00 and a moved one 12.50. More
 * only when the file holds more, because a cap of 7.125 drawn as 7.13 is an amount the file does not hold.
 */
function dollars(usd: number): string {
  const cents = usd.toFixed(2);
  return Number(cents) === usd ? cents : String(usd);
}

/**
 * THE MOST ONE PLAN MAY SPEND ON THE GEMINI API — the backend's own cap, which its gate re-reads at every
 * Gemini call (`/opt/shadow-connector/state/gemini_plan_cap.flag`, written through
 * `/api/settings/gemini-plan-cap`). One cap binds every budget on the host, each plan's and each chain's that
 * no plan owns, so it is drawn under Park at peak, among the dispatcher's host-wide dials.
 *
 * Its own file, as `RunnerPlannerLanesRow` is: a row whose read, write and re-read are its own hook
 * (`useGeminiPlanCap`) shares nothing with the rows around it except their grammar — the unknown amount said
 * in words, the retry in the control's slot.
 *
 * THE HEAL CAP'S FIELD, WITH NO BLANK. A dollar amount, saved when the field is left; Enter leaves it too.
 * The heal cap reads a blank as "no ceiling", and this cap has no off state, so a blank, a non-number or a
 * negative snaps back to the saved amount. What is typed is a draft until the field is left, and a read that
 * lands mid-type never overwrites it.
 *
 * NO AMOUNT IS NOT $5.00, AND $0.00 IS NOT UNLIMITED. Until a read answers there is no field: an amount the
 * row does not have would be a default the file may not hold. Zero is the cap every call has already met,
 * the one amount whose meaning reads backwards, so while it holds the row says so in the warn tone.
 *
 * It wears `Gem`, for Gemini; no other row on this card uses that shape.
 *
 * Used by `RunnerModelContent`, which draws it directly under `RunnerParkAtPeakRow`.
 */
export default function RunnerGeminiBudgetRow() {
  const { t } = useTranslation('settings');

  // ── The wires: the read and its two acts. Everything below them is composition. ──
  // GET /api/settings/gemini-plan-cap's amount (`null` until a read succeeds), whether the last read failed,
  // whether a write is in flight, and the two acts: `save` writes an amount and settles once the file's
  // truth is drawn, `refresh` asks again.
  const { usd, unreadable, saving, save, refresh } = useGeminiPlanCap();

  // What the operator has typed and not yet left: a draft, never the cap. `null` draws the saved amount, so a
  // read landing mid-type cannot overwrite the typing, and dropping the draft is how the field snaps back.
  const [draft, setDraft] = useState<string | null>(null);

  // The draft, trimmed. No draft (the field left untouched) sends nothing. A blank, a non-number or a
  // negative sends nothing and drops the draft, which snaps the field back to the saved amount: there is no
  // "no ceiling". Anything else is `save(Number(typed))`. When that write answers, the draft is dropped only
  // if it still holds the text this blur sent, so the field draws what the file holds (the amount read
  // back, or after a refusal the amount re-read) and a next amount typed during the write survives.
  const onBlur = (): void => {
    if (draft === null) return;
    const sent = draft;
    const typed = sent.trim();
    const amount = Number(typed);
    if (typed === '' || !Number.isFinite(amount) || amount < 0) {
      setDraft(null);
      return;
    }
    void save(amount).then(() => setDraft((now) => (now === sent ? null : now)));
  };
  const onRetry = (): void => void refresh();

  const label = t('agents.runnerGeminiBudget.label', { defaultValue: 'Gemini budget per plan' });
  // No amount is not the $5.00 default, and the row says so in words where the reader is already looking.
  const unknown = usd === null;

  return (
    <SettingRow
      data-runner-gemini-budget={unknown ? 'unknown' : 'set'}
      icon={<Gem className="h-4 w-4" />}
      label={label}
      description={unknown
        ? unreadable
          ? t('agents.runnerGeminiBudget.unreadable', {
              defaultValue: 'The cap could not be read from the server, so its amount is unknown — this is not the $5.00 default. It is retried whenever this page regains focus.',
            })
          : t('status.loading', { ns: 'common', defaultValue: 'Loading...' })
        : (
          <div id={ABOUT_ID}>
            <p>
              {t('agents.runnerGeminiBudget.description', {
                defaultValue: 'The most one plan may spend on the Gemini API — design, build, review and testing together, across all its souls. An /inline chain is a budget of its own. At the cap the backend refuses that budget’s Gemini calls. Takes effect at the next call.',
              })}
            </p>
            {usd === 0 && (
              // Zero reads as "no limit" in many places, and here it is the cap every call has already met. Said
              // in the warn tone, glyph and words, only while the file holds it.
              <p data-tone="warn" data-gemini-budget-zero="" className="mt-1.5 flex items-start gap-1.5 text-tone-ink">
                <span aria-hidden="true">▲</span>
                <span className="min-w-0">
                  {t('agents.runnerGeminiBudget.zero', {
                    defaultValue: 'Every plan’s and chain’s Gemini calls are refused at $0.00 — zero does not mean unlimited.',
                  })}
                </span>
              </p>
            )}
          </div>
        )}
    >
      {unknown ? (
        // An amount the row does not have cannot be edited: the slot holds the one act that can be honoured,
        // ask again.
        <Button variant="outline" size="sm" onClick={onRetry}>
          {t('buttons.retry', { ns: 'common', defaultValue: 'Try again' })}
        </Button>
      ) : (
        // `aria-busy` while a write is in flight. The input is never `disabled`: Chromium blurs a control the
        // instant one lands, and the operator may already be typing the next amount.
        <div aria-busy={saving}>
          <Field label={t('agents.runnerGeminiBudget.field', { defaultValue: 'USD per plan' })} htmlFor={FIELD_ID}>
            <Input
              id={FIELD_ID}
              type="number"
              inputMode="decimal"
              min={0}
              step={0.5}
              className="w-32"
              value={draft ?? dollars(usd)}
              aria-describedby={ABOUT_ID}
              onChange={(event) => setDraft(event.currentTarget.value)}
              // Enter leaves the field, so a keyboard commits through the one door a click elsewhere uses.
              onKeyDown={(event) => {
                if (event.key === 'Enter') event.currentTarget.blur();
              }}
              onBlur={onBlur}
            />
          </Field>
        </div>
      )}
    </SettingRow>
  );
}
