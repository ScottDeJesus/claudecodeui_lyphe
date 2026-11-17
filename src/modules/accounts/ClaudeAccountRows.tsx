import { AccountRowView, CandidateRow } from '@/modules/accounts/ClaudeAccountRowViews';
import { useMinuteTick } from '@/modules/accounts/hooks/useMinuteTick';
import { Switch } from '@/shared/ui';
import type { ClaudeAccountSwitch, ClaudeAccounts } from '@/shared/types';
import { formatShortDate } from '@/shared/utils';

/** The automatic switch's whole sentence: its accessible name, which the short visible label stands for. */
const AUTO_SWITCH_WORDS = 'Switch automatically when the account in use fills';

/**
 * The door could not answer. One calm line and never a banner: nothing on this screen is wrong —
 * the server simply could not read the accounts, so which ones can sign in is unknown.
 */
const DOOR_UNREACHABLE_LINE = 'The server could not read the accounts — which ones can sign in is unknown.';

/** The default for a caller that passes no act (the fakes' fixture): a press with no handler must do nothing at all. */
const NO_ACT = () => undefined;

/**
 * The last switch in one line: when, and its reason whole ("Switched Oct 30, 11:41 pm · weekly is at its ceiling …", the day only
 * when it was not today). It names no account: it is said on the row it switched to.
 */
function lastSwitchInWords(lastSwitch: ClaudeAccountSwitch, nowMs: number): string {
  const why = typeof lastSwitch.why === 'string' && lastSwitch.why.trim() ? lastSwitch.why.trim() : null;
  // `at` is wire input like every reading's stamp: a row relayed without a readable time has no
  // clock to state, and `new Date(NaN).toISOString()` throws in render — taking the whole app down
  // over one line. The switch is still a fact; say it without the time.
  const at = new Date(lastSwitch.at * 1000);
  if (Number.isNaN(at.getTime())) return why === null ? 'Switched' : `Switched · ${why}`;
  const clock = at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).toLowerCase();
  const day = formatShortDate(at.toISOString());
  const sameDay = at.toDateString() === new Date(nowMs).toDateString();
  const when = sameDay || day === null ? clock : `${day}, ${clock}`;
  return why === null ? `Switched ${when}` : `Switched ${when} · ${why}`;
}

type ClaudeAccountRowsProps = {
  /** The accounts lane's answer, or `null` before its first answer. Absent renders nothing. */
  picture?: ClaudeAccounts | null;
  busy?: boolean;
  /** The panel's clock, epoch milliseconds. Passed, the section shares the popover's minute instead of ticking a second one. */
  nowMs?: number;
  onUse?: (slug: string) => void;
  onSetAuto?: (on: boolean) => void;
  onRemove?: (slug: string) => void;
  onSetup?: (slug: string) => void;
};

/**
 * The account section of the account panel: one row per account in slug order, the identities the
 * box is signed in to but the store does not hold, and the automatic switch, with nothing under it.
 * The last switch and its reason are the hover of "In use" on the account it switched to.
 *
 * Used by the accounts module's AccountPanelBody, after the meters and the balances; the fakes beside
 * it (`claude-accounts-fake.ts`) draw every state without a server, so a state is reviewable before
 * the door answers one.
 *
 * Given no picture it renders nothing (the lane has not answered yet); a picture whose door could
 * not answer draws that calm line instead.
 */
export function ClaudeAccountRows(props: ClaudeAccountRowsProps) {
  // A clock handed in is the panel's own, so the section shares the panel body's minute rather than
  // keeping a second interval. Composed alone (the fakes' fixture), it keeps its own.
  return props.nowMs === undefined
    ? <SelfTickingAccountRows {...props} />
    : <AccountRowsBody {...props} nowMs={props.nowMs} />;
}

/** The section with its own minute, for a caller that has no clock to hand it. */
function SelfTickingAccountRows(props: ClaudeAccountRowsProps) {
  // The panel is open only while this is mounted, so this tick costs one interval and nothing behind
  // a closed panel; it is what keeps the rings' countdowns and the last switch's clock true while it is open.
  const nowMs = useMinuteTick();
  return <AccountRowsBody {...props} nowMs={nowMs} />;
}

/** The composition itself. `nowMs` drives the rings' countdowns, the token notices and the last switch's clock. */
function AccountRowsBody({
  picture = null,
  busy = false,
  nowMs,
  onUse = NO_ACT,
  onSetAuto = NO_ACT,
  onRemove = NO_ACT,
  onSetup = NO_ACT,
}: ClaudeAccountRowsProps & { nowMs: number }) {
  if (picture === null) return null;

  if (!picture.reachable) {
    return (
      <p className="text-xs leading-relaxed text-muted-foreground">{DOOR_UNREACHABLE_LINE}</p>
    );
  }

  const accounts = [...picture.accounts].sort((left, right) => left.slug.localeCompare(right.slug));
  const candidates = [...picture.candidates].sort((left, right) => left.slug.localeCompare(right.slug));
  const auto = picture.auto;
  const held = picture.held;
  // The last switch's reason, whole and dated, in one place: the hover of "In use" on the account it switched to. A reason's
  // figures are that day's, so it is never written out on a row as if it were current.
  const lastSwitch = picture.last_switch === null ? null : lastSwitchInWords(picture.last_switch, nowMs);

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2" role="heading" aria-level={3}>
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-faint">Accounts</span>
        <span aria-hidden="true" className="h-px flex-1 bg-border" />
      </div>

      {accounts.length === 0 && candidates.length === 0 ? (
        <p className="py-1 text-xs leading-relaxed text-muted-foreground">No accounts are set up yet.</p>
      ) : (
        <ul className="flex flex-col">
          {accounts.map((account) => (
            <AccountRowView
              key={account.digest}
              account={account}
              nowMs={nowMs}
              busy={busy}
              held={held}
              switched={lastSwitch !== null && picture.last_switch?.to === account.digest ? lastSwitch : null}
              onUse={onUse}
              onSetup={onSetup}
              onRemove={onRemove}
            />
          ))}
          {candidates.map((candidate) => (
            <CandidateRow key={candidate.digest} slug={candidate.slug} email={candidate.email ?? null} nowMs={nowMs} busy={busy} onSetup={onSetup} />
          ))}
        </ul>
      )}

      {accounts.length > 0 && (
        <div className="flex items-center justify-between gap-3 pt-1">
          {/* Short to the eye; the switch's accessible name keeps the whole sentence. Nothing is written under it. */}
          <span className="text-[13px] text-foreground">Auto-switch when full</span>
          <Switch checked={auto} onChange={onSetAuto} label={AUTO_SWITCH_WORDS} disabled={busy} />
        </div>
      )}
    </div>
  );
}
