import { Hand } from 'lucide-react';
import { Children, type ReactNode } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import SettingsToggle from '@/modules/settings/SettingsToggle';
import { useDactylsFake } from '@/modules/settings/tabs/agents-settings/sections/content/dactyls-fake';
import { Button, SettingRow } from '@/shared/ui';

/**
 * The status call's sentence with each hyphenated word held whole: a model id, a version or a time split
 * at a hyphen (`claude-haiku-4-5-` / `20251001`) reads as two things. Drawn as the waiting line's `<why>`,
 * which hands it the interpolated sentence as its children.
 */
function WholeWords({ children }: { children?: ReactNode }) {
  return (
    <>
      {Children.toArray(children).map((child, at) =>
        typeof child !== 'string'
          ? child
          : child.split(/(\s+)/).map((word, index) =>
              word.includes('-') ? <span key={`${at}-${index}`} className="whitespace-nowrap">{word}</span> : word,
            ),
      )}
    </>
  );
}

/**
 * WHETHER A BUILDER ON CLAUDE HANDS ITS CODE EDITS TO DACTYLS. This is the runner's own switch,
 * `~/.claude/state/dactyls.flag`. It is drawn directly under the DeepSeek row because it takes that
 * row's question one step further: which hands a builder's edits are made by. On, a builder on Claude
 * reads, decides and verifies, and every edit is one dactyl's: a child on the launch table's `[dactyl]`
 * words that sees only its brief and the one file. A builder on DeepSeek Flash is untouched, and a
 * flip reaches the next builder launched.
 *
 * Its own file, as `RunnerParkAtPeakRow` is: `RunnerModelContent` is past what it should hold, and a
 * row whose read, write and re-read are its own hook has nothing to share with the rows around it
 * except their grammar — the unknown state in words, the retry in the control's slot.
 *
 * THE POSITION AND THE READINESS ARE TWO FACTS. The position is the operator's word. The readiness is
 * the installed Claude Code's, derived from its binary at every ask. A switch that is on while the CLI
 * cannot serve a dactyl is armed, not broken: builders work as before until it can. So "Waiting" is
 * said in the warn tone in either position, with the status call's own sentence. A readiness that
 * could not be read is said in plain words, and never drawn as waiting.
 *
 * It wears `Hand`: a dactyl is one pair of hands for one file (its own system prompt says so), and
 * no other row on this card wears that shape.
 *
 * Used by `RunnerModelContent`, which draws it directly under the DeepSeek row.
 */
export default function RunnerDactylsRow() {
  const { t } = useTranslation('settings');

  // ── The wires: the read and its two acts. Everything below them is composition. ──
  const { enabled, unreadable, model, effort, ready, why } = useDactylsFake(); // FILL: state
  const onToggle = (_next: boolean): void => {}; // FILL: onToggle
  const onRetry = (): void => {}; // FILL: onRetry

  const label = t('agents.runnerDactyls.label', { defaultValue: 'Dactyls' });
  // No position is not OFF, and the lie cuts both ways: drawn off while on, it promises builders that
  // make their own edits; drawn on while off, dactyls that are not coming.
  const unknown = enabled === null;

  // What on means. The model and the effort are the status call's, interpolated as data. When that call
  // failed, the sentence is said without them rather than with a guess.
  const meaning = model !== null && effort !== null
    ? (
      <Trans
        t={t}
        i18nKey="agents.runnerDactyls.description"
        values={{ model, effort }}
        // A model id is one word: broken at its hyphen, `claude-` and `haiku-5-5` read as two.
        components={{ model: <span className="whitespace-nowrap" /> }}
        defaults="On: a builder on Claude reads, decides and verifies; every code edit is made by a dactyl — a <model>{{model}}</model> child at {{effort}} effort that sees only its brief and the one file. A builder on DeepSeek Flash is untouched. Takes effect on the next builder."
      />
    )
    : t('agents.runnerDactyls.descriptionBare', {
        defaultValue: 'On: a builder on Claude reads, decides and verifies; every code edit is made by a dactyl — a child that sees only its brief and the one file. A builder on DeepSeek Flash is untouched. Takes effect on the next builder.',
      });

  // The readiness, said one of three ways. Ready adds nothing. Not ready says "Waiting" with the status
  // call's own sentence. Anything else is said unread: the call failed, or it answered not ready without
  // a reason, which the status contract never does.
  const waiting = ready === false && why ? why : null;
  const readinessUnread = ready !== true && waiting === null;

  return (
    <SettingRow
      data-runner-dactyls={unknown ? 'unknown' : enabled ? 'on' : 'off'}
      icon={<Hand className="h-4 w-4" />}
      label={label}
      description={unknown
        ? unreadable
          ? t('agents.runnerDactyls.unreadable', {
              defaultValue: 'The switch could not be read from the server, so its position is unknown — this is not the same as off. It is retried whenever this page regains focus.',
            })
          : t('status.loading', { ns: 'common', defaultValue: 'Loading...' })
        : (
          <>
            <p>{meaning}</p>
            {waiting !== null && (
              // Pending, so the warn tone, with its glyph and its word: the switch keeps the operator's
              // word, and the first builder launched after the CLI can serve takes it.
              <p data-tone="warn" data-dactyls-waiting="" className="mt-1.5 flex items-start gap-1.5 text-tone-ink">
                <span aria-hidden="true">▲</span>
                <span className="min-w-0">
                  <Trans
                    t={t}
                    i18nKey="agents.runnerDactyls.waiting"
                    values={{ why: waiting }}
                    components={{ why: <WholeWords /> }}
                    defaults="Waiting: <why>{{why}}</why>. Builders work as before until it can."
                  />
                </span>
              </p>
            )}
            {readinessUnread && (
              // Unknown is not waiting: no reason came back, so the row draws no tone it cannot back.
              <p data-dactyls-unread="" className="mt-1.5">
                {t('agents.runnerDactyls.readinessUnread', {
                  defaultValue: 'Whether this Claude Code can serve a dactyl could not be read.',
                })}
              </p>
            )}
          </>
        )}
    >
      {unknown ? (
        // A switch with nothing to point at cannot be moved: the slot holds the one act that can be
        // honoured, ask again.
        <Button variant="outline" size="sm" onClick={onRetry}>
          {t('buttons.retry', { ns: 'common', defaultValue: 'Try again' })}
        </Button>
      ) : (
        <SettingsToggle
          checked={enabled === true}
          onChange={onToggle}
          ariaLabel={label}
          // Never disabled while a write is in flight. Chromium blurs a control the instant a real
          // `disabled` lands, eating a keyboard user's next press. The hook refuses the second write.
          disabled={enabled === null}
        />
      )}
    </SettingRow>
  );
}
