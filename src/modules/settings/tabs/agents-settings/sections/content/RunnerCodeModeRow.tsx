import { RefreshCw, SquareCode } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import SettingsToggle from '@/modules/settings/SettingsToggle';
import { Button, SettingRow } from '@/shared/ui';

// FILL: state — everything from this line to the end of `FAKE_READING` is the fill's one block: the two types
// become `useCodeMode()`'s own, and the fake reading its answer, under the same four names. The fake is one
// `builders` entry, its sentence the verb's own (`KINDS["builders"]["says"]`), word for word.
//
// The hook forgets EVERY position together, as `useMainSessionDactylsSwitch`'s `forgetPosition` does, and never
// one kind's: a lost write leaves each kind's `enabled` `null` (or the whole list `null`). The card's one sentence
// for unknown speaks of all the switches, so a kind with no position beside a kind with one would make it false.

/**
 * One Code Mode switch as `code-mode --status` names it: which launches it covers (`kind`), its name, the sentence
 * that says what on means, and the week's one-line report ("" when there is nothing to count). `enabled` is the
 * flag's position, or `null` when the card holds the kind but not where its switch stands.
 */
type CodeModeKind = { kind: string; label: string; says: string; enabled: boolean | null; report: string };

/**
 * What the card draws from. `kinds` is the verb's list in the verb's order, or `null` while it has not been read;
 * `unreadable` tells a read that failed from one still on the wire. `ready` and `why` are the box's readiness (node,
 * the packages, the sandbox), each `null` when it could not be asked, which is neither ready nor not ready.
 */
type CodeModeReading = { kinds: CodeModeKind[] | null; unreadable: boolean; ready: boolean | null; why: string | null };

const FAKE_READING: CodeModeReading = {
  kinds: [
    {
      kind: 'builders',
      label: 'Builders',
      says: 'A builder or fix-pass on Claude works with two tools: one search, and one script that does the whole job with the soul\'s own tools inside it. A script\'s actions are not checked by the house\'s hooks yet. A soul with tools of its own (a browser, the connector) is not served yet. Dactyls are off for a launch Code Mode carries. Takes effect on the next launch.',
      enabled: false,
      report: '',
    },
  ],
  unreadable: false,
  ready: true,
  why: '',
};

/**
 * CODE MODE: WHICH LAUNCHES WORK WITH TWO TOOLS, one search and one script, instead of their built-in ones. The
 * switches are the operator's, one flag file a kind under `~/.claude/state/code_mode/`, written only by
 * `code-mode set`; the card holds no list of kinds and draws what the verb answers, so a kind a later plan adds
 * appears here with no change to this file.
 *
 * ONE TITLE, THEN ONE SWITCH A KIND. The title row is the card's fixed place and says what is true of the whole
 * box, once: the read still out, the positions unknown, the box not ready, the readiness unread. Ready, it says
 * nothing. Each kind is a row of its own under the title, set in to the title's words so the eye reads them as
 * its children: the kind's name, the verb's sentence, and the week's report in the body's ink once there is one.
 * No hairline is drawn inside the card, which is why its rows share one wrapper. EVERY WORD ON THE CARD STARTS AT
 * ONE EDGE, the title's first letter, and the gutter left of it holds marks only (the icon, the warn glyph), so a
 * sentence stays where it was when the state under it changes.
 *
 * NO POSITION IS NOT OFF. A switch cannot draw a third side, so a kind whose position is unknown keeps its name
 * and its sentence and draws no switch, and the title row says so and holds the one act that can be honoured,
 * ask again. With no list at all the title row stands alone with the same sentence, and so it does with an empty
 * one: a verb that named no kind has not told the card where any switch stands.
 *
 * THE POSITION AND THE READINESS ARE TWO FACTS, as on the row above. A switch that is on while the box cannot
 * run Code Mode is armed, not broken: agents work as before until it can. So "Waiting" is said in the warn tone
 * in either position, and the switches stay live under it. The reason is the verb's own sentence and may end in
 * a path, so it is left free to break anywhere.
 *
 * It wears `SquareCode`: the script in its box. No other row on this card wears that shape.
 *
 * Used by `RunnerModelContent`, which draws it directly under `RunnerMainSessionDactylsRow`: both ask whose
 * hands do the work of a launch.
 */
export default function RunnerCodeModeRow() {
  const { t } = useTranslation('common');

  // ── The wires: the read and its two acts. Everything below them is composition. ──
  // FILL: state
  const { kinds, unreadable, ready, why } = FAKE_READING;
  // FILL: onToggle
  const onToggle = (_kind: string, _next: boolean): void => {};
  // FILL: onRetry
  const onRetry = (): void => {};

  const title = t('codeMode.title');
  const retry = t('buttons.retry');

  // The whole box in one word, in the order the title row must speak. No list, an empty one, or a kind with no
  // position, is unknown before anything else: a readiness said over switches nobody can vouch for answers the
  // wrong question.
  const waiting = ready === false && why ? why : null;
  const state = kinds === null
    ? unreadable ? 'unknown' : 'loading'
    : kinds.length === 0 || kinds.some((entry) => entry.enabled === null)
      ? 'unknown'
      : waiting !== null
        ? 'waiting'
        // Not ready with no reason is not waiting: the row draws no tone it cannot back.
        : ready === true ? 'ready' : 'unread';
  const askAgain = state === 'unknown' || state === 'loading';

  return (
    <div role="group" aria-label={title} data-runner-code-mode-card={state}>
      <SettingRow
        // The title's own foot closes up when kinds stand under it, so the card reads as one thing.
        className={kinds !== null && kinds.length > 0 ? 'pb-1.5' : undefined}
        icon={<SquareCode className="h-4 w-4" />}
        label={title}
        description={state === 'loading'
          ? <p className="pl-6">{t('status.loading')}</p>
          : state === 'unknown'
            ? <p data-runner-code-mode-unreadable="" className="pl-6">{t('codeMode.unreadable')}</p>
            : state === 'waiting'
              ? (
                // Pending, so the warn tone, with its glyph and its word: each switch keeps the operator's word,
                // and a launch takes it once the box can run Code Mode. The glyph takes the icon's slot and gap.
                <p data-tone="warn" data-runner-code-mode-waiting="" className="flex items-start gap-2 text-tone-ink">
                  <span aria-hidden="true" className="flex w-4 shrink-0 justify-center">▲</span>
                  <span className="min-w-0">{t('codeMode.waiting', { why: waiting })}</span>
                </p>
              )
              : state === 'unread'
                ? <p data-runner-code-mode-unread="" className="pl-6">{t('codeMode.readinessUnread')}</p>
                : undefined}
      >
        {askAgain ? (
          <Button
            variant="outline"
            size="sm"
            onClick={onRetry}
            aria-label={retry}
            title={retry}
            className="finger:h-11 finger:w-11 finger:px-0"
          >
            <RefreshCw aria-hidden="true" />
            <span className="finger:hidden">{retry}</span>
          </Button>
        ) : null}
      </SettingRow>

      {kinds?.map((entry) => (
        <SettingRow
          key={entry.kind}
          data-runner-code-mode={`${entry.kind}:${entry.enabled === null ? 'unknown' : entry.enabled ? 'on' : 'off'}`}
          // Set in by the title's icon and its gap, so the kind's name starts under the title's first letter.
          // The inset gives way before the switch does: the kit drops a control under its text once the text
          // would be narrower than 10rem, and a switch under five sentences reads as the next kind's. So the
          // inset is what the card's width leaves after that floor, the gap, the switch and the far padding,
          // never under the row's own 1rem. It is short of whole only on a 320px phone at a raised text scale.
          className="pb-2.5 pl-[clamp(1rem,calc(100%_-_12rem_-_53px),2.5rem)] pt-2.5 last:pb-4"
          label={entry.label}
          description={(
            <>
              <p>{entry.says}</p>
              {entry.report !== '' && (
                // A count, not an explanation: drawn in the body's ink so a returning reader's eye lands on it
                // under a sentence it has already read.
                <p data-runner-code-mode-report="" className="mt-1.5 text-foreground">{entry.report}</p>
              )}
            </>
          )}
        >
          {entry.enabled === null ? null : (
            // A thumb's target without moving the switch: on a touch screen the label is 44px tall and gives
            // back above and below what it took, so the 30px track stays level with the kind's name.
            <label className="flex cursor-pointer items-center finger:-my-[7px] finger:min-h-11">
              {/* Never disabled, a write in flight included: Chromium blurs a control the instant a real
                  `disabled` lands, eating a keyboard user's next press. The name carries the card's, since
                  "Builders" alone names no setting to a reader who cannot see the title above it. */}
              <SettingsToggle
                checked={entry.enabled}
                onChange={(next) => onToggle(entry.kind, next)}
                ariaLabel={t('codeMode.switchName', { label: entry.label })}
              />
            </label>
          )}
        </SettingRow>
      ))}
    </div>
  );
}
