import { useTranslation } from 'react-i18next';

import { useHeal } from '@/modules/heal/context/HealContext';
import { deepseekPeakStatus, deepseekRateChangeInWords } from '@/shared/deepseekPeakHours';
import { useHealModelSwitch } from '@/shared/hooks/useHealModelSwitch';
import { useRateChangeTick } from '@/shared/hooks/useRateChangeTick';
import { Chip, ClaudeCodeMark, LLMProviderLogo } from '@/shared/ui';

/**
 * The Heal tab's own model switch — WHICH MODEL A HEAL'S SOULS RUN ON — drawn in the tab's toolbar
 * (`HealActions`) beside the cycle's Start/Stop, and again as the fourth row of Settings → Agents.
 *
 * IT IS THE COMPOSER'S CHIP AND NOT THE COMPOSER'S SWITCH. The shape is the composer's on purpose —
 * the whale with DeepSeek's own price while DeepSeek is the side, the Claude Code mascot and the word
 * "Claude" while Claude is, so one shape means one thing on both surfaces — but the file behind it is
 * `heal_model.flag`, the composer's is `deepseek_flash.flag`, and NOTHING HERE READS OR WRITES THAT
 * ONE: the operator's own words are "if I press that button I don't want flash to turn off for my
 * chat". Two files, two switches, and a press on either leaves the other exactly where it was.
 *
 * THE SIDE IS THE PAYLOAD'S, NOT THIS HOOK'S. `switches.model` is the worker's own reading of its own
 * flag — through the same function its parks, its ledger column and its chain read, so the mark here
 * can never disagree with the model the next ending will really use — and the file names a side in
 * every state, an absent one meaning `deepseek`. There is therefore no caption to explain a third
 * state: the chip is always one of the two models, and it says which.
 *
 * Pressing writes the OTHER WORD explicitly, so the switch is a flip of the heal's own file and never
 * a change to anybody's default. Claude carries no cap and no dollar figure — it is the operator's
 * subscription — which the sentence behind the chip says outright.
 */
export function HealModelSwitch({ model }: { model: 'deepseek' | 'claude' }) {
  const { t } = useTranslation();
  const { position, unreadable, saving, setModel, refresh } = useHealModelSwitch();
  // The mark this chip wears comes off the SUMMARY, not off this hook's own position: the side is the
  // worker's own resolution of its flag, and a chip drawing the hook's answer would be a second opinion
  // about a rule only the worker settles. A write therefore has to re-read the summary as well as the
  // file, or the chip keeps the old model on its face — for up to the poll's whole minute — while the
  // file already says otherwise. The PRESS does not read the summary: it flips the hook's own
  // `position`, the same value the guard above trusts, so a mark that lagged a file moving under a
  // visible tab can never turn a press into a rewrite of the word already on disk.
  const { refresh: refreshSummary } = useHeal();

  // Not a side: the server has not said where the switch is. A press here is not a flip — there is
  // nothing to flip from — so it asks again instead, which is the only press that can be honoured.
  const unknown = position === null;
  // The side the next ending really runs on. ON is DeepSeek.
  const on = model === 'deepseek';

  // While ON, the chip's outline is DeepSeek's price right now: green while it bills half, amber at
  // peak. OFF it is the plain border and none of the rate's channels — the chip wears Claude's mark
  // then, and a DeepSeek price on it would claim money nothing is spending.
  const now = useRateChangeTick();
  const { peak, changesAt } = deepseekPeakStatus(now);
  const changes = deepseekRateChangeInWords(now, changesAt);
  const rateInWords = peak
    ? t('heal.model.peak', { defaultValue: 'Peak hours right now: DeepSeek is full price until {{time}}.', time: changes })
    : t('heal.model.offPeak', { defaultValue: 'Off-peak right now: DeepSeek is half price until {{time}}.', time: changes });
  const modelInWords = on
    ? t('heal.model.tooltip', {
      // The fallback is the shipped English string verbatim: a missing key must not quietly render a
      // DIFFERENT sentence than the one every locale was translated from.
      defaultValue: 'This heal’s souls run on DeepSeek Flash, and its spend counts against the daily cap in Heal settings. It steers the heal reflex’s souls only — the chat composer’s Flash switch is a different file and never moves with it. Press to send the next heal to Claude instead.',
    })
    : t('heal.model.tooltipClaude', {
      defaultValue: 'This heal’s souls run on Claude — your subscription, so it is capped by nothing and counts against no cap. It steers the heal reflex’s souls only — the chat composer’s Flash switch is a different file and never moves with it. Press to send the next heal to DeepSeek Flash instead.',
    });

  return (
    // The wrapper carries the handle, not the chip: what the probe and the reader look for is this
    // control, and the chip is its only node — there is no caption beside it, because there is no
    // third state to caption.
    <span className="flex shrink-0 items-center gap-1.5" data-heal-model>
      <Chip
        size="sm"
        selected={on}
        tone={on ? (peak ? 'warn' : 'positive') : undefined}
        indeterminate={unknown}
        // Busy only while a write is in flight. It refuses the press without leaving the tab order,
        // so a keyboard reader's next Enter still lands here instead of at the top of the page.
        busy={saving}
        onClick={() => {
          if (unknown) {
            void refresh();
            return;
          }
          if (saving) return;
          // The OTHER word, EXPLICITLY — and off the HOOK's own reading, not off the mark drawn above:
          // the mark is the summary's (polled, so it can lag a file that moved under the tab while it
          // stayed visible), and a press derived from it would write the word the file already holds —
          // a press that does nothing. `position` is what the guard above already trusts, so the press
          // and the guard read one value. The summary is re-read once the file answers, so the mark,
          // the pills and the Settings row all move with the one press.
          const from = position === 'claude' ? 'claude' : 'deepseek';
          void setModel(from === 'deepseek' ? 'claude' : 'deepseek').then(refreshSummary);
        }}
        // The name says WHOSE switch this is — the heal's souls, not the session chat's — and the
        // state channel is `aria-pressed` (Chip's own, `mixed` while unknown), so the side itself is
        // not repeated here. The phrase is the Settings row's own label, so the one control is named
        // one way on both surfaces.
        ariaLabel={t('heal.model.label', { defaultValue: 'Model for heal souls' })}
        title={
          unknown
            ? unreadable
              // The one case the reader has to be told about: the control is drawn dashed with no
              // fill, and this is what says why and what to do about it.
              ? t('heal.model.unreadable', { defaultValue: 'The heal’s model switch could not be read — press to try again.' })
              : t('heal.model.reading', { defaultValue: 'Reading the heal’s model switch…' })
            // On, the sentence that says what pressing does, behind the price it is paying right now.
            : on
              ? `${rateInWords} ${modelInWords}`
              : modelInWords
        }
      >
        {on ? (
          // Through the shared provider logo rather than DeepSeekLogo directly: it is the door that
          // branches on a provider name, and the mark's own file records it as the only one.
          <LLMProviderLogo provider="deepseek" className="h-4 w-4 shrink-0" />
        ) : (
          <ClaudeCodeMark className="h-4 w-4 shrink-0" />
        )}
        {/* The rate's second channel: green and amber are one grey to a red-green colour-blind
            reader, so peak also wears the warn tone's own glyph. Off-peak wears none — the mark to
            notice is the expensive one. Not on a phone: below `sm` the chip is the mark and the
            word is already dropped, and a lone glyph beside a lone mark reads as damage rather than
            as a price. The same breakpoint the word uses. */}
        {on && peak && <span aria-hidden="true" className="hidden text-[10px] leading-none sm:inline">▲</span>}
        {/* The word names the side the heal is on, beside the mark that says the same. A Claude mark
            beside "Flash" would contradict itself. */}
        <span className="hidden sm:inline">
          {on
            ? t('heal.model.short', { defaultValue: 'Flash' })
            : t('heal.model.shortClaude', { defaultValue: 'Claude' })}
        </span>
      </Chip>
    </span>
  );
}
