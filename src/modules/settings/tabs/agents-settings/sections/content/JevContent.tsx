import { useTranslation } from 'react-i18next';

import { useJevSwitches } from '@/shared/hooks/useJevSwitches';
import { Button } from '@/shared/ui';
import SettingsCard from '@/modules/settings/SettingsCard';
import SettingsRow from '@/modules/settings/SettingsRow';
import SettingsToggle from '@/modules/settings/SettingsToggle';

/**
 * Rendered by AgentCategoryContentSection directly under `RunnerModelContent`, in Claude's
 * "account" panel: the two house switches for Jev, TypeSafe's cheap semantic judgment that scripts
 * and hooks may ask for.
 *
 * It sits under the model switch because that is the order of blast radius — which model a builder
 * runs on, then whether anything at all may leave this machine to answer a question. The two files
 * it writes are read by Python at call time (`~/.claude/hooks/jev_client.py`), so a flip here
 * reaches the next hook or script with nothing restarted on either side.
 *
 * The read, the two writes, the re-read and the ledger line all live in `useJevSwitches`.
 */
export default function JevContent() {
  const { t } = useTranslation('settings');
  const { state, stats, unreadable, saving, setMaster, setPrompts, refresh } = useJevSwitches();

  const masterLabel = t('agents.jev.master.label', { defaultValue: 'Jev semantic judgment' });
  const promptsLabel = t('agents.jev.prompts.label', {
    defaultValue: 'Let hooks send my prompt text to Jev',
  });
  // A switch drawn off for a switch that is on is the one thing these rows must never do, and they
  // cannot draw a third state the way the composer's chip can. So when there is no position the rows
  // say so in words, in the place a reader comes to when they want to be sure.
  //
  // `state === null` is TWO windows, and both are unknown: the first read still on the wire, and the
  // read that failed. Drawing either as OFF is the same lie — and the first is not brief, because the
  // app's own request timeout is 30 s and the hook asks a second time after it, so a stalled
  // connection draws it for up to a minute. Only the SENTENCE differs: still asking, or asked and
  // unanswered. The composer's chip carries the same pair ("Reading the switch…" / "could not be
  // read").
  const unknown = state === null;
  const unknownDescription = unreadable
    ? t('agents.jev.unreadable', {
        defaultValue: 'The switches could not be read from the server, so their position is unknown — this is not the same as off. They are retried whenever this page regains focus.',
      })
    : t('status.loading', { ns: 'common', defaultValue: 'Loading...' });
  const masterOn = state?.master === true;
  // The prompt opt-in's STORED value, which is shown even while the master gates it. It is what makes
  // the master row dangerous: the pair is live the instant both files say on, so a press on the
  // master row in THIS state starts sending prompt text.
  const promptsStored = state?.prompts === true;
  const promptsGated = state !== null && !masterOn;

  // The ledger is read-only furniture under the rows, and it is allowed to be absent: a failed
  // stats read draws nothing rather than a wrong total. Zero calls is its own state — the house has
  // never asked Jev anything — and it is said as such rather than as four zeros.
  const ledgerLine = stats === null
    ? null
    : !stats.present
      ? t('agents.jev.statsEmpty', { defaultValue: 'Jev ledger: no calls recorded yet.' })
      : t('agents.jev.stats', {
          defaultValue: 'Jev ledger: {{calls}} calls · {{tokens}} Jev tokens spent · {{linesIn}} lines filtered → {{linesKept}} kept',
          calls: stats.calls.toLocaleString(),
          tokens: stats.tokens.toLocaleString(),
          linesIn: stats.linesIn.toLocaleString(),
          linesKept: stats.linesKept.toLocaleString(),
        });

  // The master row's description. The warning takes the slot over the normal text rather than sitting
  // beside it: the press this row is about to receive is the one that arms prompt sending, and the
  // consequence has to be read before it, not below it. It is shown only while the master is OFF —
  // with the master already on, nothing is "about to start", it is already happening.
  const masterDescription = unknown
    ? unknownDescription
    : promptsGated && promptsStored
      ? t('agents.jev.master.armsPrompts', {
          defaultValue: 'Turning this on also starts sending prompt text to Jev: the prompt opt-in below is stored on. Nothing is sent to Jev while this is off.',
        })
      : t('agents.jev.master.description', {
          defaultValue: 'Scripts and sessions may ask TypeSafe’s Jev for a yes/no, a pick-one, or to filter a large output before reading it. Off: nothing leaves this machine.',
        });

  // The prompt row's description. While the master is off the row says which switch is holding it —
  // the static text would otherwise read as a plain off, which is the opposite of what a stored on
  // means. Both gated states are named, because the row is drawn differently in each.
  const promptsDescription = unknown
    ? unknownDescription
    : promptsGated && promptsStored
      ? t('agents.jev.prompts.gatedOn', {
          defaultValue: 'Held off by the master switch above — but this opt-in is stored on, so turning Jev on sends prompt text immediately. Off: the hook matches the word only.',
        })
      : promptsGated
        ? t('agents.jev.prompts.gatedOff', {
            defaultValue: 'Held off by the master switch above: turn Jev on to change this. Off: the hook matches the word only.',
          })
        : t('agents.jev.prompts.description', {
            defaultValue: 'The artifact-routing hook may send the text of a prompt containing the word ‘artifact’ to decide whether to add its routing note. Off: the hook matches the word only.',
          });

  return (
    <SettingsCard divided>
      <SettingsRow label={masterLabel} description={masterDescription}>
        {unknown ? (
          // The press a control with no position can honour: ask again. Without it a persistent read
          // failure left both rows dead until Settings was closed and reopened.
          <Button variant="outline" size="sm" onClick={() => void refresh()}>
            {t('buttons.retry', { ns: 'common', defaultValue: 'Try again' })}
          </Button>
        ) : (
          <SettingsToggle
            checked={masterOn}
            onChange={(next) => void setMaster(next)}
            ariaLabel={masterLabel}
            // Disabled only when there is no position to set, or while the OTHER row's write is in
            // flight — that write would swallow a press here and the row would read as broken. Not
            // disabled for its own write: `Switch` renders a real `disabled` attribute, Chromium
            // blurs the element the instant one lands, and the second Space a keyboard user presses
            // would go to the document. The hook refuses that second write itself.
            disabled={state === null || saving === 'prompts'}
          />
        )}
      </SettingsRow>

      {/* Subordinate to the row above by indentation and a muted ground, because it is not a second
          setting but a narrowing of the first: it counts only while the master is on. It keeps
          showing its stored value while the master is off — the file is untouched. */}
      <SettingsRow
        label={promptsLabel}
        description={promptsDescription}
        className="bg-muted/30 pl-8"
      >
        {unknown ? null : (
          // Gated in ONE direction only. A stored on can always be parked off with the master off —
          // the narrowing act must never require widening the blast radius first (master on, prompt
          // text already leaving, then off again). Enabling is what the master gates, so that is what
          // this row refuses until the master is on.
          <SettingsToggle
            checked={promptsStored}
            onChange={(next) => void setPrompts(next)}
            ariaLabel={promptsLabel}
            disabled={state === null || saving === 'master' || (promptsGated && !promptsStored)}
          />
        )}
      </SettingsRow>

      {ledgerLine && (
        <div className="px-4 py-3 text-xs text-muted-foreground">{ledgerLine}</div>
      )}
    </SettingsCard>
  );
}
