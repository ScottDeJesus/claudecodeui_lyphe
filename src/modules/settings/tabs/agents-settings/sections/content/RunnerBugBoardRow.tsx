import { Bug, Hourglass, RefreshCw, Tags } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import {
  BUG_BOARD_AGE_DAYS_MAX,
  BUG_BOARD_AGE_DAYS_MIN,
  BUG_BOARD_THRESHOLD_MAX,
  BUG_BOARD_THRESHOLD_MIN,
  BUG_BOARD_WIDTH_CHOICES,
  useBugBoardSettings,
} from '@/modules/settings/hooks/useBugBoardSettings';
import { Button, Field, Input, Select, SettingRow } from '@/shared/ui';

/** The confidence field's id: its label's `htmlFor`, and the handle a verify script reads the number by. */
const THRESHOLD_FIELD_ID = 'runner-bug-board-threshold';

/** The confidence row's own words, which its field points `aria-describedby` at: "0.50 to 0.99" alone names no setting. */
const THRESHOLD_ABOUT_ID = 'runner-bug-board-threshold-about';

/** The retry the control's slot holds while a row has no number to draw: the one act that can be honoured. A square 44 px press under a finger. */
function Retry({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation('settings');
  const label = t('buttons.retry', { ns: 'common', defaultValue: 'Try again' });
  return (
    <Button variant="outline" size="sm" onClick={onRetry} aria-label={label} title={label} className="finger:h-11 finger:w-11 finger:px-0">
      <RefreshCw aria-hidden="true" />
      <span className="finger:hidden">{label}</span>
    </Button>
  );
}

/**
 * THE DISPATCHER'S THREE NUMBERS FOR BOARD CARDS, `~/.claude/charters/cards.toml`: how many cards it works at the same time across every
 * self-running board, how sure the sort must be before a card is taken as a bug, a UI change or a tweak, and how many days a card waits
 * in To Do for each priority it moves up.
 *
 * THREE ROWS, ONE FILE AND ONE HOOK. They are three questions, so each is a row of its own with its own sentence and its own control: a
 * reader who wants one of them reads one row. They share a file because they share a read (`useBugBoardSettings` asks for all at once),
 * and they are drawn directly under the CPU limit, which asks the first row's question of the box: how much work to start.
 *
 * DAYS BEFORE A WAITING CARD MOVES UP A PRIORITY IS A DROPDOWN OF EVERY VALUE THE FILE ACCEPTS, 0 to 30, each said with its noun, and 0
 * says Off: a number that turns the thing off is a word in the list, never a zero a reader has to know the meaning of. Every value is in
 * the list, so a number set from a terminal is always drawn as itself, and no pick can be out of bounds: the row has no "not saved" line
 * because it has no way to earn one. Its sentence says what the number does at the value it holds, and at Off says what Off means.
 * A DISPATCHER THAT DOES NOT REPORT THE NUMBER (one older than this row) is said in the row's own words, with the retry, while the two
 * rows above it draw what was read.
 *
 * CARDS WALKED AT ONCE IS A DROPDOWN, as the CPU limit and the weekly stop are: four values, each said with its noun. SORT CONFIDENCE IS A
 * TYPED NUMBER, as the Gemini budget is, because it is tuned against the numbers a card's own Sort step prints (0.93, 0.61) and six stops
 * would not land between them. It is written in that same notation, never as a percent, so the two can be compared by eye. Its bounds are
 * the field's caption, said where the number is typed, and they are written once: the caption, the field's spoken name and the line
 * below all take them from the hook's two constants. A number outside them snaps back to the saved one AND SAYS SO, in the kit's own
 * amber line under the field, until the field is typed in again: the band is narrow and a percent (80) is the likely slip, and a
 * field that silently puts back the old number reads as a save that worked.
 *
 * ALL THREE CONTROLS ARE THE CPU LIMIT'S WIDTH (`w-44`), so the four end on one edge and are one width down the card, and on a phone
 * all four drop under their sentence together: at `w-32` they stayed beside it and squeezed it into a column of 25 characters, nine
 * lines tall (measured at 390 px).
 *
 * NO NUMBER IS NOT THE DEFAULT. Until a read answers, each row says so in words and its slot holds the retry. Neither control is ever
 * `disabled` while a write is in flight (Chromium blurs a control the instant one lands): `aria-busy` tells assistive tech instead.
 *
 * The first row wears the board's own `Bug`; the second wears `Tags`, because the sort's answer is the tag a card carries; the third
 * wears `Hourglass`, because what it counts is waiting.
 *
 * Used by `RunnerModelContent`, which draws it directly under `RunnerCpuLimitRow`.
 */
export default function RunnerBugBoardRow() {
  const { t } = useTranslation('settings');

  // ── The wires: one read of both numbers, and its acts. Everything below them is composition. ──
  const { width, threshold, ageDays, unreadable, saving, thresholdText, thresholdOutOfBounds, setWidth, setAgeDays, typeThreshold, leaveThreshold, refresh } =
    useBugBoardSettings();
  const onRetry = (): void => void refresh();

  const widthLabel = t('agents.bugBoard.width.label', { defaultValue: 'Cards walked at once' });
  const thresholdLabel = t('agents.bugBoard.threshold.label', { defaultValue: 'Sort confidence' });
  // The bounds as every sentence of the confidence row prints them, from the hook's two constants and nowhere else.
  const bounds = { min: BUG_BOARD_THRESHOLD_MIN.toFixed(2), max: BUG_BOARD_THRESHOLD_MAX.toFixed(2) };
  const unknownSentence = unreadable
    ? t('agents.bugBoard.unreadable', {
        defaultValue: 'The setting could not be read from the dispatcher, so its value is unknown. It is retried whenever this page regains focus.',
      })
    : t('status.loading', { ns: 'common', defaultValue: 'Loading...' });
  const ageDaysLabel = t('agents.bugBoard.ageDays.label', { defaultValue: 'Days before a waiting card moves up a priority' });
  // The other two numbers were read and this one was not in the answer: the dispatcher is older than the row, which is its own sentence.
  const ageDaysUnknown = width !== null
    ? t('agents.bugBoard.ageDays.unreported', { defaultValue: 'This dispatcher does not report the number yet, so its value is unknown.' })
    : unknownSentence;
  const ageDaysChoices = Array.from({ length: BUG_BOARD_AGE_DAYS_MAX - BUG_BOARD_AGE_DAYS_MIN + 1 }, (_, index) => BUG_BOARD_AGE_DAYS_MIN + index);
  const ageDaysWord = (days: number): string => days === 0
    ? t('agents.bugBoard.ageDays.off', { defaultValue: 'Off' })
    : t('agents.bugBoard.ageDays.option', { count: days, defaultValue_one: '{{count}} day', defaultValue_other: '{{count}} days' });

  return (
    <>
      <SettingRow
        data-runner-bug-board-width={width === null ? 'unknown' : width}
        icon={<Bug className="h-4 w-4" />}
        label={widthLabel}
        description={width === null
          ? unknownSentence
          : t('agents.bugBoard.width.description', {
              count: width,
              defaultValue_one: 'The dispatcher works on {{count}} board card at a time, across every self-running board. The rest wait in To Do: high priority first, then the oldest. A card already being worked on is never stopped. Takes effect at the next card.',
              defaultValue_other: 'The dispatcher works on {{count}} board cards at a time, across every self-running board. The rest wait in To Do: high priority first, then the oldest. A card already being worked on is never stopped. Takes effect at the next card.',
            })}
      >
        {width === null ? (
          <Retry onRetry={onRetry} />
        ) : (
          // A BLOCK wrapper at the CPU limit's own width: `Select`'s root is a block, and as a flex item it would shrink to its text.
          <div aria-busy={saving} className="w-44">
            <Select
              options={BUG_BOARD_WIDTH_CHOICES.map((cards) => ({
                value: String(cards),
                label: t('agents.bugBoard.width.option', { count: cards, defaultValue_one: '{{count}} card', defaultValue_other: '{{count}} cards' }),
              }))}
              value={String(width)}
              onChange={(next) => void setWidth(Number(next))}
              ariaLabel={t('agents.bugBoard.width.selectLabel', { defaultValue: 'Board cards walked at once' })}
            />
          </div>
        )}
      </SettingRow>

      <SettingRow
        data-runner-bug-board-threshold={threshold === null ? 'unknown' : threshold}
        icon={<Tags className="h-4 w-4" />}
        label={thresholdLabel}
        description={threshold === null
          ? unknownSentence
          : (
            <p id={THRESHOLD_ABOUT_ID}>
              {t('agents.bugBoard.threshold.description', {
                threshold: threshold.toFixed(2),
                defaultValue: 'A new card is sorted as a bug, a UI change or a tweak when Jev, or failing that Haiku, is at least {{threshold}} sure. Below that it is worked as a bug: confirmed and traced to its cause before anything is changed. Each card’s Sort step says how sure they were. Takes effect at the next card.',
              })}
            </p>
          )}
      >
        {threshold === null ? (
          <Retry onRetry={onRetry} />
        ) : (
          // The CPU limit's width is held by the wrapper, so the "not saved" line wraps inside it and never widens the slot.
          <div aria-busy={saving} className="w-44">
            <Field
              label={t('agents.bugBoard.threshold.field', { ...bounds, defaultValue: '{{min}} to {{max}}' })}
              htmlFor={THRESHOLD_FIELD_ID}
              error={thresholdOutOfBounds
                ? t('agents.bugBoard.threshold.outOfBounds', { ...bounds, defaultValue: 'Not saved: use {{min}} to {{max}}.' })
                : undefined}
            >
              <Input
                id={THRESHOLD_FIELD_ID}
                type="number"
                inputMode="decimal"
                min={BUG_BOARD_THRESHOLD_MIN}
                max={BUG_BOARD_THRESHOLD_MAX}
                step={0.01}
                // 44 px under a finger: the kit's field is 36 px at every width, and this one is a press the phone makes.
                className="finger:h-11"
                invalid={thresholdOutOfBounds}
                value={thresholdText}
                aria-label={t('agents.bugBoard.threshold.fieldLabel', { ...bounds, defaultValue: 'Sort confidence, from {{min}} to {{max}}' })}
                aria-describedby={THRESHOLD_ABOUT_ID}
                onChange={(event) => typeThreshold(event.currentTarget.value)}
                // Enter leaves the field, so a keyboard commits through the one door a click elsewhere uses.
                onKeyDown={(event) => {
                  if (event.key === 'Enter') event.currentTarget.blur();
                }}
                onBlur={() => leaveThreshold()}
              />
            </Field>
          </div>
        )}
      </SettingRow>

      <SettingRow
        data-runner-bug-board-age-days={ageDays === null ? 'unknown' : ageDays}
        icon={<Hourglass className="h-4 w-4" />}
        label={ageDaysLabel}
        description={ageDays === null
          ? ageDaysUnknown
          : ageDays === 0
            ? t('agents.bugBoard.ageDays.descriptionOff', {
                defaultValue: 'Off: a card waiting in To Do is taken at the priority it shows, however long it has waited, so a low card can wait behind every new high one. Takes effect at the next card.',
              })
            : t('agents.bugBoard.ageDays.description', {
                count: ageDays,
                defaultValue_one: 'A card waiting in To Do is taken one priority higher for every day it has waited, up to high. A low card that has waited long enough goes ahead of a high card typed today. The priority shown on the card is never changed. Takes effect at the next card.',
                defaultValue_other: 'A card waiting in To Do is taken one priority higher for every {{count}} days it has waited, up to high. A low card that has waited long enough goes ahead of a high card typed today. The priority shown on the card is never changed. Takes effect at the next card.',
              })}
      >
        {ageDays === null ? (
          <Retry onRetry={onRetry} />
        ) : (
          <div aria-busy={saving} className="w-44">
            <Select
              options={ageDaysChoices.map((days) => ({ value: String(days), label: ageDaysWord(days) }))}
              value={String(ageDays)}
              onChange={(next) => void setAgeDays(Number(next))}
              ariaLabel={t('agents.bugBoard.ageDays.selectLabel', { defaultValue: 'Days before a waiting board card moves up a priority' })}
            />
          </div>
        )}
      </SettingRow>
    </>
  );
}
