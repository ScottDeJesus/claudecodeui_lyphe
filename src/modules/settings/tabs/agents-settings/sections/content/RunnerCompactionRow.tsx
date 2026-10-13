import { Shrink } from 'lucide-react';
import { Trans, useTranslation } from 'react-i18next';

import SettingsToggle from '@/modules/settings/SettingsToggle';
import { useCustomCompactionSwitch } from '@/shared/hooks/useCustomCompactionSwitch';
import { Button, SettingRow, WholeWords } from '@/shared/ui';

/**
 * WHO WRITES A CHAT'S COMPACTION. This is CloudCLI's own switch, `~/.claude/state/custom_compaction.flag`,
 * drawn directly under the DeepSeek row because it asks that row's question of a chat: which small model
 * does a big model's chore. On, a chat's compaction is written by the launch table's `[summarizer]` words
 * instead of by the chat's own model — when the operator presses Compact or types `/compact`, at a turn's
 * end past half the context window, and after 54 idle minutes holding 200K tokens or more — and the chat
 * carries on in a new session seeded with the summary, wherever its CLI runs: a chat placed on a node is
 * taken over like any other. Off, the CLI compacts as it always has.
 *
 * Its own file, as `RunnerParkAtPeakRow` is, and in the card's grammar: the unknown state in words, the retry
 * in the control's slot, a switch never disabled while a write is in flight. The Dactyls switch, which asks
 * the same question of Hephaestus's edits, is drawn in Edit Agent Chains beside the words its children run on
 * (`AgentLaunchDactylField`), because it is one soul's and not the host's.
 *
 * THE POSITION AND THE READINESS ARE TWO FACTS. The position is the operator's word. The readiness is the
 * installed Claude Code's, derived from its binary at every ask. A switch that is on while the CLI cannot
 * serve the summarizer is armed, not broken: chats compact as before until it can. So "Waiting" is said in
 * the warn tone in either position, with the status call's own sentence. A readiness that could not be read
 * is said in plain words, and never drawn as waiting.
 *
 * It wears `Shrink`, the glyph on the composer's own Compact button, so the press its first case names
 * carries the same shape here; no other row on this card wears it.
 *
 * Used by `RunnerModelContent`, which draws it directly under the DeepSeek row.
 */
export default function RunnerCompactionRow() {
  const { t } = useTranslation('settings');

  // ── The wires: the read and its two acts. Everything below them is composition. ──
  const { enabled, unreadable, model, effort, ready, why, setEnabled, refresh } = useCustomCompactionSwitch();
  const onToggle = (next: boolean): void => void setEnabled(next);
  const onRetry = (): void => void refresh();

  const label = t('agents.runnerCompaction.label', { defaultValue: 'Custom compaction' });
  // No position is not OFF, and the lie cuts both ways: drawn off while on, it promises chats compacted by
  // their own model; drawn on while off, a summarizer that is not coming.
  const unknown = enabled === null;

  // What on means, lead first. The model and the effort are the status call's, interpolated as data. When
  // that call failed, the sentence is said without them rather than with a guess.
  const lead = model !== null && effort !== null
    ? (
      <Trans
        t={t}
        i18nKey="agents.runnerCompaction.description"
        values={{ model, effort }}
        // A model id is one word: broken at its hyphen, `claude-` and `haiku-5-5` read as two.
        components={{ model: <span className="whitespace-nowrap" /> }}
        defaults="On: a chat’s compaction is written by <model>{{model}}</model> at {{effort}} effort instead of by the chat’s own model, in three cases:"
      />
    )
    : t('agents.runnerCompaction.descriptionBare', {
        defaultValue: 'On: a chat’s compaction is written by the summarizer instead of by the chat’s own model, in three cases:',
      });

  // The readiness, said one of three ways. Ready adds nothing. Not ready says "Waiting" with the status
  // call's own sentence. Anything else is said unread: the call failed, or it answered not ready without
  // a reason, which the status contract never does.
  const waiting = ready === false && why ? why : null;
  const readinessUnread = ready !== true && waiting === null;

  return (
    <SettingRow
      data-runner-compaction={unknown ? 'unknown' : enabled ? 'on' : 'off'}
      icon={<Shrink className="h-4 w-4" />}
      label={label}
      description={unknown
        ? unreadable
          ? t('agents.runnerCompaction.unreadable', {
              defaultValue: 'The switch could not be read from the server, so its position is unknown — this is not the same as off. It is retried whenever this page regains focus.',
            })
          : t('status.loading', { ns: 'common', defaultValue: 'Loading...' })
        : (
          <>
            <p>{lead}</p>
            {/* The three moments, in the order a chat meets them: three lines scan faster than one
                sentence of semicolons, and each ends on the word that bounds it. */}
            <ul className="mt-1 list-disc space-y-0.5 pl-4" data-compaction-cases="">
              <li>{t('agents.runnerCompaction.whenPressed', { defaultValue: 'when you press Compact or type /compact;' })}</li>
              <li>
                {t('agents.runnerCompaction.atTurnEnd', {
                  defaultValue: 'at the end of a turn that leaves the chat past half its context window — never in the middle of work;',
                })}
              </li>
              <li>
                {t('agents.runnerCompaction.whenIdle', {
                  // A number keeps its unit on its line: a no-break space (`\u00a0`), as the locale file holds it.
                  defaultValue: 'when the chat has sat idle for 54\u00a0minutes holding 200K\u00a0tokens or more, in place of the CLI’s own idle compaction.',
                })}
              </li>
            </ul>
            <p className="mt-1">
              {t('agents.runnerCompaction.after', {
                defaultValue: 'The chat moves to a new session seeded with the summary and its latest messages, and keeps its own model and effort. The CLI’s auto-compact stays on as the net. Chats placed on a node are compacted the same way. A flip reaches each chat at its next message.',
              })}
            </p>
            {waiting !== null && (
              // Pending, so the warn tone, with its glyph and its word: the switch keeps the operator's
              // word, and the first compaction after the CLI can serve the summarizer takes it.
              <p data-tone="warn" data-compaction-waiting="" className="mt-1.5 flex items-start gap-1.5 text-tone-ink">
                <span aria-hidden="true">▲</span>
                <span className="min-w-0">
                  <Trans
                    t={t}
                    i18nKey="agents.runnerCompaction.waiting"
                    values={{ why: waiting }}
                    components={{ why: <WholeWords /> }}
                    defaults="Waiting: <why>{{why}}</why>. Chats compact as before until it can."
                  />
                </span>
              </p>
            )}
            {readinessUnread && (
              // Unknown is not waiting: no reason came back, so the row draws no tone it cannot back.
              <p data-compaction-unread="" className="mt-1.5">
                {t('agents.runnerCompaction.readinessUnread', {
                  defaultValue: 'Whether this Claude Code can serve the summarizer could not be read.',
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
