import { useTranslation } from 'react-i18next';

import { deepseekPeakStatus, deepseekRateChangeInWords } from '@/shared/deepseekPeakHours';
import { useDeepSeekFlashSwitch } from '@/shared/hooks/useDeepSeekFlashSwitch';
import { useRateChangeTick } from '@/shared/hooks/useRateChangeTick';
import { Chip, ClaudeCodeMark, LLMProviderLogo } from '@/shared/ui';

/**
 * Used by ChatComposer, immediately beside the Plain chip: the DeepSeek Flash switch the plan
 * runner re-reads at every spawn, where the operator can see which side it is on and flip it
 * without opening Settings.
 *
 * A pressed chip rather than an icon, for the reason the Plain chip beside it is one: the state
 * has to be readable at a glance from the strip, and "on" is a fill.
 *
 * The mark names where builds run, so each position wears its own: ON is DeepSeek's whale, with
 * DeepSeek's price in the outline; OFF is Claude Code's pixel mascot, with the plain default
 * border and the word "Claude", because nothing DeepSeek bills is being spent. UNKNOWN keeps the
 * whale, dashed. The switch has not been read, so there is no Claude side to claim yet.
 *
 * `vv-chip--compact` is the phone form — a 32px square wearing the mark alone, the footprint of
 * the icon buttons it sits among — because this is the tightest row on the screen and the ordinary
 * chip's word makes it half a pill wider. From `sm` up there is room for the word, so it rides
 * beside the mark: a reader who has never flipped this before learns the two faces once and reads
 * the mark alone from then on.
 *
 * On a narrow row it stands down, and where it stands down is measured rather than guessed. The
 * footer's strip must hold the same controls at every width except for two things: the model pill's
 * label — capped at 80px of text, so 106px of pill — and whether the voice button is in the row,
 * which is another 36px with its gap. Forcing this chip into the row and shrinking the viewport
 * gives the boundaries exactly: the widest label the pill can ever show keeps one line down to
 * 348px with the chip in the row, and the widest of the operator's own chip labels (Haiku 4.5, 54px
 * of text, an 80px pill) down to 322px. The chip's own footprint is 36px, and those numbers are the
 * whole rule. 352px is four above the worst case the pill can produce — any label, any of the
 * locales' translated words in this strip — and the voice button takes 36px of the row, so it moves
 * to 388px when the mic is there.
 *
 * `yieldsToVoice` is the composer's own answer to that second question — the same expression that
 * renders the voice button — because a width rule cannot see what is beside it, and a chip that
 * guessed "the mic is probably there" is the guess that hid it from a voice-off phone at 354px. The
 * switch is still in Settings wherever it stands down.
 */
type Props = {
  /**
   * True when the composer is rendering the voice button in this same row. Passed in rather than
   * inferred: the mic is not on every account — with voice off the composer renders no voice button
   * and those 36px are the chip's.
   */
  yieldsToVoice: boolean;
};

export default function ComposerDeepSeekSwitch({ yieldsToVoice }: Props) {
  const { t } = useTranslation('chat');
  const { enabled, unreadable, saving, setEnabled, refresh } = useDeepSeekFlashSwitch();

  // Not "off": the server has not said where the switch is. A press here is not a flip — there is
  // nothing to flip from — so it asks again instead, which is the only press that can be honoured.
  const unknown = enabled === null;
  // The last position the server confirmed, never an assumed one.
  const on = enabled === true;
  // Builds run on Claude. The chip wears Claude's mark and none of DeepSeek's price.
  const off = enabled === false;

  // While ON, the chip's outline is DeepSeek's price right now: green while it bills half, amber at
  // peak — the warning sits on the very control that is spending the money. OFF (operator,
  // 2026-09-21) the outline is the plain border: the chip wears Claude's mark then, and a DeepSeek
  // price on it would claim money nothing is spending. The rate's other channels, the peak glyph
  // and the tooltip's first sentence, go with it.
  const now = useRateChangeTick();
  const { peak, changesAt } = deepseekPeakStatus(now);
  const changes = deepseekRateChangeInWords(now, changesAt);
  const rateInWords = peak
    ? t('input.deepseekFlashPeak', { defaultValue: 'Peak hours right now: DeepSeek is full price until {{time}}.', time: changes })
    : t('input.deepseekFlashOffPeak', { defaultValue: 'Off-peak right now: DeepSeek is half price until {{time}}.', time: changes });
  const flashInWords = t('input.deepseekFlashTooltip', {
    // The fallback is the shipped English string verbatim: a missing key must not quietly render a
    // DIFFERENT sentence than the one every locale was translated from.
    defaultValue: "While this is on, the plan runner's build souls — the builder, its fix-pass and Athena — run on DeepSeek Flash. Prometheus and the scouts stay on Claude.",
  });

  return (
    <Chip
      size="sm"
      className={`vv-chip--compact hidden h-8 shrink-0 ${yieldsToVoice ? 'min-[388px]:inline-flex' : 'min-[352px]:inline-flex'}`}
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
        void setEnabled(!on);
      }}
      // The state channel is `aria-pressed` (Chip's own, and `mixed` while unknown), so this name
      // stays the name and does not repeat on/off — a button announcing both would say it twice.
      ariaLabel={t('input.deepseekFlash', { defaultValue: 'DeepSeek Flash' })}
      title={
        unknown
          ? unreadable
            // The one case the reader has to be told about: the control is drawn dashed with no
            // fill, and this is what says why and what to do about it.
            ? t('input.deepseekFlashUnreadable', { defaultValue: 'The switch could not be read — press to try again.' })
            : t('input.deepseekFlashReading', { defaultValue: 'Reading the switch…' })
          // Off, the sentence that says what pressing does: turning Flash on moves the build souls.
          : on
            ? `${rateInWords} ${flashInWords}`
            : flashInWords
      }
    >
      {off ? (
        <ClaudeCodeMark className="h-4 w-4 shrink-0" />
      ) : (
        // Through the shared provider logo rather than DeepSeekLogo directly: it is the door that
        // branches on a provider name, and the mark's own file records it as the only one.
        <LLMProviderLogo provider="deepseek" className="h-4 w-4 shrink-0" />
      )}
      {/* The rate's second channel: green and amber are one grey to a red-green colour-blind
          reader, so peak also wears the warn tone's own glyph. Off-peak wears none — the mark to
          notice is the expensive one. NOT ON A PHONE (operator, 2026-09-20): below `sm` the chip is
          the mark alone, and the glyph beside it read as damage rather than as a price. The same
          breakpoint the word uses, so the narrow chip is one mark and nothing else. */}
      {on && peak && <span aria-hidden="true" className="hidden text-[10px] leading-none sm:inline">▲</span>}
      {/* The word names the side the builds are on, beside the mark that says the same. A Claude
          mark beside "Flash" would contradict itself. */}
      <span className="hidden sm:inline">
        {off
          ? t('input.deepseekFlashOffShort', { defaultValue: 'Claude' })
          : t('input.deepseekFlashShort', { defaultValue: 'Flash' })}
      </span>
    </Chip>
  );
}
