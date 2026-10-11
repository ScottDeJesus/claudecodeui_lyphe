import { Pointer } from 'lucide-react';
import { Trans, useTranslation } from 'react-i18next';

import SettingsToggle from '@/modules/settings/SettingsToggle';
import { useMainSessionDactylsSwitch } from '@/shared/hooks/useMainSessionDactylsSwitch';
import { Button, SettingRow, WholeWords } from '@/shared/ui';

/**
 * WHETHER THE MAIN SESSION CHANGES A REPOSITORY FILE ONLY THROUGH A DACTYL. This is CloudCLI's own switch,
 * `~/.claude/state/main_session_dactyls.flag`, and it is host-wide: it governs every main session on the box, a
 * chat here and a terminal session alike. It is drawn directly under Custom compaction because it asks that row's
 * question of a chat: which small model does a big model's chore. On, a session told so changes a repository file
 * only through a dactyl, a child on the launch table's `[dactyl]` words that sees only its brief and the files it
 * is given; it may hand a file to one to read, and a /tweak lands through one. A session that cannot reach a dactyl
 * keeps its own hands.
 *
 * It is not the Dactyls switch. That one takes a builder's hands, belongs to one soul, and is drawn in Edit Agent
 * Chains beside the words both switches' children run on (`AgentLaunchDactylField`).
 *
 * Its own file, in `RunnerCompactionRow`'s grammar: the unknown state in words, the retry in the control's slot,
 * a switch never disabled while a write is in flight.
 *
 * THE POSITION AND THE READINESS ARE TWO FACTS. The position is the operator's word. The readiness is the
 * installed Claude Code's, derived from its binary at every ask. A switch that is on while the CLI cannot serve a
 * dactyl is armed, not broken: sessions keep their own hands until it can. So "Waiting" is said in the warn tone in
 * either position, with the status call's own sentence. A readiness that could not be read is said in plain words,
 * and never drawn as waiting.
 *
 * THE SPEND LINE is the week's hand ledger: the dactyls launched under no plan's launch, reads and edits apart, in
 * tokens and never dollars. It is said once there is something to count, in either position, because a hand
 * dactyl needs no switch: the read verb answers whoever calls it.
 *
 * It wears `Pointer`: a dactyl is a finger (the Greek word), and with this on the main session changes a file by
 * pointing one at it. No other row on this card wears that shape.
 *
 * Used by `RunnerModelContent`, which draws it directly under `RunnerCompactionRow`.
 */
export default function RunnerMainSessionDactylsRow() {
  const { t } = useTranslation('settings');

  // ── The wires: the read and its two acts. Everything below them is composition. ──
  const { enabled, unreadable, model, effort, ready, why, hand, setEnabled, refresh } = useMainSessionDactylsSwitch();
  const onToggle = (next: boolean): void => void setEnabled(next);
  const onRetry = (): void => void refresh();

  const label = t('agents.runnerMainSessionDactyls.label', { defaultValue: 'Dactyls for the main session' });
  // No position is not OFF, and the lie cuts both ways: drawn off while on, it promises sessions their own
  // hands; drawn on while off, dactyls that are not coming.
  const unknown = enabled === null;

  // What on means, lead first. The model and the effort are the status call's, interpolated as data. When that
  // call failed, the sentence is said without them rather than with a guess.
  const lead = model !== null && effort !== null
    ? (
      <Trans
        t={t}
        i18nKey="agents.runnerMainSessionDactyls.description"
        values={{ model, effort }}
        // A model id is one word: broken at its hyphen, `claude-` and `haiku-5-5` read as two.
        components={{ model: <span className="whitespace-nowrap" /> }}
        defaults="On: the main session — a chat here or a terminal session — changes a repository file only through a dactyl, a <model>{{model}}</model> child at {{effort}} that sees only its brief and the files it is given."
      />
    )
    : t('agents.runnerMainSessionDactyls.descriptionBare', {
        defaultValue: 'On: the main session — a chat here or a terminal session — changes a repository file only through a dactyl, a child that sees only its brief and the files it is given.',
      });

  // The readiness, said one of three ways. Ready adds nothing. Not ready says "Waiting" with the status call's
  // own sentence. Anything else is said unread: the call failed, or it answered not ready without a reason,
  // which the status contract never does.
  const waiting = ready === false && why ? why : null;
  const readinessUnread = ready !== true && waiting === null;

  // The week's hand ledger, said once there is something to count. Every count carries its own plural key, is
  // digit-grouped for the reader's locale (a busy week runs to four digits) and keeps its noun on its line; the
  // spend is the verb's own rendering, so it is data and never a key, and a week with no token counted ends the
  // line at the edits rather than drawing an empty figure.
  const handLine = hand !== null && hand.count > 0
    ? (
      <Trans
        t={t}
        i18nKey={hand.spend ? 'agents.runnerMainSessionDactyls.hand.line' : 'agents.runnerMainSessionDactyls.hand.lineWithoutSpend'}
        values={{
          days: t('agents.runnerMainSessionDactyls.hand.days', { count: hand.days, defaultValue_one: '{{count, number}}\u00a0day', defaultValue_other: '{{count, number}}\u00a0days' }),
          dactyls: t('agents.runnerMainSessionDactyls.hand.dactyls', { count: hand.count, defaultValue_one: '{{count, number}}\u00a0dactyl', defaultValue_other: '{{count, number}}\u00a0dactyls' }),
          reads: t('agents.runnerMainSessionDactyls.hand.reads', { count: hand.reads, defaultValue_one: '{{count, number}}\u00a0read', defaultValue_other: '{{count, number}}\u00a0reads' }),
          edits: t('agents.runnerMainSessionDactyls.hand.edits', { count: hand.edits, defaultValue_one: '{{count, number}}\u00a0edit', defaultValue_other: '{{count, number}}\u00a0edits' }),
          spend: hand.spend,
        }}
        // The spend is one figure: broken at a space, `212.4k` and `in` read as two.
        components={{ spend: <span className="whitespace-nowrap" /> }}
        defaults={hand.spend
          ? 'Last {{days}}: {{dactyls}} by hand — {{reads}}, {{edits}} · <spend>{{spend}}</spend>'
          : 'Last {{days}}: {{dactyls}} by hand — {{reads}}, {{edits}}'}
      />
    )
    : null;

  return (
    <SettingRow
      data-runner-main-session-dactyls={unknown ? 'unknown' : enabled ? 'on' : 'off'}
      icon={<Pointer className="h-4 w-4" />}
      label={label}
      description={unknown
        ? unreadable
          ? t('agents.runnerMainSessionDactyls.unreadable', {
              defaultValue: 'The switch could not be read from the server, so its position is unknown — this is not the same as off. It is retried whenever this page regains focus.',
            })
          : t('status.loading', { ns: 'common', defaultValue: 'Loading...' })
        : (
          <>
            {/* Seven sentences in three breaths: what on means, what the session's hands do now, and how the
                switch behaves. Three short paragraphs are scanned; one of seven sentences is read or skipped. */}
            <p>{lead}</p>
            <p className="mt-1">
              {t('agents.runnerMainSessionDactyls.hands', {
                defaultValue: 'Its own Edit and Write into repository files are refused, and so are its shell writes there; files outside any repository (scratch in /tmp), git-ignored files and /remember are untouched. Shell dumps of a repository file’s body (cat, head, tail, sed) are refused too: what a file says comes through dactyl --read, so its body never enters its context, and the Read tool keeps exact lines. A /tweak lands through a dactyl, and rail 2 logs it on the chain the file belongs to.',
              })}
            </p>
            <p className="mt-1">
              {t('agents.runnerMainSessionDactyls.after', {
                defaultValue: 'A session that cannot reach a dactyl keeps its own hands. A flip reaches each session at its next message. The dactyl’s words are edited in Edit Agent Chains.',
              })}
            </p>
            {waiting !== null && (
              // Pending, so the warn tone, with its glyph and its word: the switch keeps the operator's word, and
              // each session takes it at its next message once the CLI can serve a dactyl.
              <p data-tone="warn" data-main-session-dactyls-waiting="" className="mt-1.5 flex items-start gap-1.5 text-tone-ink">
                <span aria-hidden="true">▲</span>
                <span className="min-w-0">
                  <Trans
                    t={t}
                    i18nKey="agents.runnerMainSessionDactyls.waiting"
                    values={{ why: waiting }}
                    components={{ why: <WholeWords /> }}
                    defaults="Waiting: <why>{{why}}</why>. Sessions keep their own hands until it can."
                  />
                </span>
              </p>
            )}
            {readinessUnread && (
              // Unknown is not waiting: no reason came back, so the row draws no tone it cannot back.
              <p data-main-session-dactyls-unread="" className="mt-1.5">
                {t('agents.runnerMainSessionDactyls.readinessUnread', {
                  defaultValue: 'Whether this Claude Code can serve a dactyl could not be read.',
                })}
              </p>
            )}
            {handLine !== null && (
              // A count, not an explanation: drawn in the body's ink so a returning reader's eye lands on it
              // under prose it has already read.
              <p data-main-session-dactyls-hand="" className="mt-1.5 text-foreground">{handLine}</p>
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
