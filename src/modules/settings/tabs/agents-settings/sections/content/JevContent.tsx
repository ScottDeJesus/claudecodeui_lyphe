import { useTranslation } from 'react-i18next';

import { JEV_SCOPES, useJevSwitches } from '@/shared/hooks/useJevSwitches';
import type { JevScopeName } from '@/shared/hooks/useJevSwitches';
import { Button } from '@/shared/ui';
import SettingsCard from '@/modules/settings/SettingsCard';
import SettingsRow from '@/modules/settings/SettingsRow';
import SettingsToggle from '@/modules/settings/SettingsToggle';

/**
 * How many consumers the net line names before it stops, and the count the line below it carries.
 *
 * The list is sorted by value descending, so a cut at five lands on the tail — and the tail is where
 * the NEGATIVE consumers live, the ones that added text to sessions. Those are exactly the rows a
 * reader needs to reconcile the net line with the rows printed under it: without the "and N more"
 * line the five rows can sum to more than the net above them with nothing on the panel to say why.
 */
const TOP_CONSUMERS = 5;

/**
 * One narrower opt-in's words: the four states its row can be drawn in — the description it carries
 * while it counts, and the two it carries while the master holds it, split by whether its stored
 * value is on, because a stored on under an off master is the pairing the master row warns about.
 */
type ScopeRow = {
  label: string;
  description: string;
  gatedOn: string;
  gatedOff: string;
};

/** A signed character count, as `jev stats` prints one: a `+` on what a consumer kept out of sessions. */
function signedChars(value: number): string {
  return `${value > 0 ? '+' : ''}${value.toLocaleString()}`;
}

/**
 * Rendered by AgentCategoryContentSection directly under `RunnerModelContent`, in Claude's
 * "account" panel: the house switches for Jev, TypeSafe's cheap semantic judgment that scripts and
 * hooks may ask for.
 *
 * It sits under the model switch because that is the order of blast radius — which model a builder
 * runs on, then whether anything at all may leave this machine to answer a question. The files it
 * writes are read by Python at call time (`~/.claude/hooks/jev_client.py`), so a flip here reaches
 * the next hook or script with nothing restarted on either side.
 *
 * The scope rows are drawn from `JEV_SCOPES` and the table below rather than written out one by one,
 * so a scope the server gains is one entry here and nothing else: every row's gating, its press and
 * the master's warning follow from the list. The read, the writes, the re-read and the ledger all
 * live in `useJevSwitches`.
 */
export default function JevContent() {
  const { t } = useTranslation('settings');
  const { state, stats, unreadable, saving, setMaster, setScope, refresh } = useJevSwitches();

  const masterLabel = t('agents.jev.master.label', { defaultValue: 'Jev semantic judgment' });
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
  const gated = state !== null && !masterOn;
  // Whether ANY opt-in is stored on, which is what the master row's warning keys on: the press it is
  // about to receive arms every one of them at once, not only the first row's.
  const anyStored = JEV_SCOPES.some((scope) => state?.[scope] === true);

  const scopeRows: Record<JevScopeName, ScopeRow> = {
    prompts: {
      label: t('agents.jev.prompts.label', { defaultValue: 'Let hooks send my prompt text to Jev' }),
      description: t('agents.jev.prompts.description', {
        defaultValue: 'The artifact-routing hook may send the text of a prompt containing the word ‘artifact’ to decide whether to add its routing note. Off: the hook matches the word only.',
      }),
      gatedOn: t('agents.jev.prompts.gatedOn', {
        defaultValue: 'Held off by the master switch above — but this opt-in is stored on, so turning Jev on sends prompt text immediately. Off: the hook matches the word only.',
      }),
      gatedOff: t('agents.jev.prompts.gatedOff', {
        defaultValue: 'Held off by the master switch above: turn Jev on to change this. Off: the hook matches the word only.',
      }),
    },
    toolOutput: {
      label: t('agents.jev.toolOutput.label', {
        defaultValue: 'Let hooks send command output to Jev',
      }),
      description: t('agents.jev.toolOutput.description', {
        defaultValue: 'After a command that exited clean, a hook may send its output to decide whether it actually failed. Never sent from a no-send path (~/.claude/state/jev_no_send_paths — job-data repos by default).',
      }),
      gatedOn: t('agents.jev.toolOutput.gatedOn', {
        defaultValue: 'Held off by the master switch above — but this opt-in is stored on, so turning Jev on sends command output immediately.',
      }),
      gatedOff: t('agents.jev.toolOutput.gatedOff', {
        defaultValue: 'Held off by the master switch above: turn Jev on to change this.',
      }),
    },
  };

  // The master row's description. The warning takes the slot over the normal text rather than sitting
  // beside it: the press this row is about to receive is the one that arms every stored opt-in, and
  // the consequence has to be read before it, not below it. It is shown only while the master is OFF
  // — with the master already on, nothing is "about to start", it is already happening.
  const masterDescription = unknown
    ? unknownDescription
    : gated && anyStored
      ? t('agents.jev.master.armsPrompts', {
          defaultValue: 'Turning this on also starts sending to Jev from every opt-in stored on below. Nothing is sent to Jev while this is off.',
        })
      : t('agents.jev.master.description', {
          defaultValue: 'Scripts and sessions may ask TypeSafe’s Jev for a yes/no, a pick-one, or to filter a large output before reading it. Off: nothing leaves this machine.',
        });

  // The ledger is read-only furniture under the rows, and it is allowed to be absent: a failed
  // stats read draws nothing rather than a wrong total. Zero calls is its own state — the house has
  // never asked Jev anything — and it is said as such rather than as a row of zeros.
  const ledgerLines = stats === null ? [] : [stats.present
    ? t('agents.jev.stats', {
        defaultValue: 'Jev ledger: {{calls}} calls · {{tokens}} Jev tokens spent · {{linesIn}} lines filtered → {{linesKept}} kept',
        calls: stats.calls.toLocaleString(),
        tokens: stats.tokens.toLocaleString(),
        linesIn: stats.linesIn.toLocaleString(),
        linesKept: stats.linesKept.toLocaleString(),
      })
    : t('agents.jev.statsEmpty', { defaultValue: 'Jev ledger: no calls recorded yet.' })];

  // The meter: what this house's consumers of Jev have together kept OUT of sessions, and who did it.
  // Both numbers come off the ledger rather than being recomputed here — the panel's whole point is
  // that its figure and `jev stats`' are the same one, down to the divide-by-4 for session tokens. A
  // ledger with no `saved` line yet shows nothing extra, exactly as that command prints no NET line.
  const topConsumers = stats === null ? [] : stats.byCaller.slice(0, TOP_CONSUMERS);
  const consumerLines = topConsumers.length === 0 || stats === null
    ? []
    : [
        t('agents.jev.net', {
          defaultValue: 'Jev net: {{chars}} chars ≈ {{tokens}} session tokens (+ kept out, − added)',
          chars: signedChars(stats.netChars),
          tokens: signedChars(Math.floor(stats.netChars / 4)),
        }),
        ...topConsumers.map((consumer) => t('agents.jev.consumer', {
          defaultValue: '{{caller}}: {{chars}} chars',
          caller: consumer.caller,
          chars: signedChars(consumer.chars),
        })),
        // The rows this cut dropped, said out loud. The tail is the negatives, so a panel that
        // stopped at five would show a net its own five rows cannot add up to, with nothing saying
        // which consumers moved it — and `jev stats` is the whole list, printed the same way.
        ...(stats.byCaller.length > topConsumers.length
          ? [t('agents.jev.consumerMore', {
              defaultValue: '… and {{more}} more — `jev stats` lists every consumer.',
              more: stats.byCaller.length - topConsumers.length,
            })]
          : []),
      ];
  const meterLines = [...ledgerLines, ...consumerLines];

  return (
    <SettingsCard divided>
      <SettingsRow label={masterLabel} description={masterDescription}>
        {unknown ? (
          // The press a control with no position can honour: ask again. Without it a persistent read
          // failure left every row dead until Settings was closed and reopened.
          <Button variant="outline" size="sm" onClick={() => void refresh()}>
            {t('buttons.retry', { ns: 'common', defaultValue: 'Try again' })}
          </Button>
        ) : (
          <SettingsToggle
            checked={masterOn}
            onChange={(next) => void setMaster(next)}
            ariaLabel={masterLabel}
            // Disabled only when there is no position to set, or while ANOTHER row's write is in
            // flight — that write would swallow a press here and the row would read as broken. Not
            // disabled for its own write: `Switch` renders a real `disabled` attribute, Chromium
            // blurs the element the instant one lands, and the second Space a keyboard user presses
            // would go to the document. The hook refuses that second write itself.
            disabled={state === null || (saving !== null && saving !== 'master')}
          />
        )}
      </SettingsRow>

      {JEV_SCOPES.map((scope) => {
        const row = scopeRows[scope];
        const stored = state?.[scope] === true;
        // While the master is off the row says which switch is holding it — the static text would
        // otherwise read as a plain off, which is the opposite of what a stored on means. Both gated
        // states are named, because the row is drawn differently in each.
        const description = unknown
          ? unknownDescription
          : gated && stored
            ? row.gatedOn
            : gated
              ? row.gatedOff
              : row.description;

        return (
          // Subordinate to the row above by indentation and a muted ground, because each is not a
          // second setting but a narrowing of the first: it counts only while the master is on. It
          // keeps showing its stored value while the master is off — the file is untouched.
          <SettingsRow key={scope} label={row.label} description={description} className="bg-muted/30 pl-8">
            {unknown ? null : (
              // Gated in ONE direction only. A stored on can always be parked off with the master
              // off — the narrowing act must never require widening the blast radius first (master
              // on, that text already leaving, then off again). Enabling is what the master gates, so
              // that is what this row refuses until the master is on.
              <SettingsToggle
                checked={stored}
                onChange={(next) => void setScope(scope, next)}
                ariaLabel={row.label}
                disabled={state === null || (saving !== null && saving !== scope) || (gated && !stored)}
              />
            )}
          </SettingsRow>
        );
      })}

      {meterLines.length > 0 && (
        <div className="space-y-1 px-4 py-3 text-xs text-muted-foreground">
          {meterLines.map((line) => <div key={line}>{line}</div>)}
        </div>
      )}
    </SettingsCard>
  );
}
