import { AccountRowView, CandidateRow } from '@/modules/accounts/ClaudeAccountRowViews';
import { useMinuteTick } from '@/modules/accounts/hooks/useMinuteTick';
import { Switch } from '@/shared/ui';
import type { ClaudeAccountSwitch, ClaudeAccounts } from '@/shared/types';
import { formatShortDate } from '@/shared/utils';

/**
 * The line that closes the section. A switch raises one question — "will this lose my work?" — and
 * this answers it: work already running finishes on its account, and an open chat moves at its next message.
 */
const SWITCHING_IN_WORDS =
  'Switching sets where new chats and plan runs start. Running work stays on its account; an open chat moves at its next message.';

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
 * The last switch in two parts: who and when ("Switched to sdjesus89 · Oct 30, 11:41 pm", the day only when it was not
 * today), and its reason, whole. `why` is `null` when the door gave none.
 */
function lastSwitchInWords(lastSwitch: ClaudeAccountSwitch, nowMs: number): { lead: string; why: string | null } {
  const why = typeof lastSwitch.why === 'string' && lastSwitch.why.trim() ? lastSwitch.why.trim() : null;
  // `at` is wire input like every reading's stamp: a row relayed without a readable time has no
  // clock to state, and `new Date(NaN).toISOString()` throws in render — taking the whole app down
  // over one line. The switch is still a fact; say it without the time.
  const at = new Date(lastSwitch.at * 1000);
  if (Number.isNaN(at.getTime())) return { lead: `Switched to ${lastSwitch.to_slug}`, why };
  const clock = at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).toLowerCase();
  const day = formatShortDate(at.toISOString());
  const sameDay = at.toDateString() === new Date(nowMs).toDateString();
  const when = sameDay || day === null ? clock : `${day}, ${clock}`;
  return { lead: `Switched to ${lastSwitch.to_slug} · ${when}`, why };
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
 * box is signed in to but the store does not hold, the automatic switch, the last switch and why,
 * and the one sentence that says what a switch does to work already running.
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
      <div className="flex flex-col gap-1.5">
        <div className="text-[11px] uppercase tracking-[0.14em] text-ink-faint">Accounts</div>
        <p className="px-2 text-xs leading-relaxed text-muted-foreground">{DOOR_UNREACHABLE_LINE}</p>
      </div>
    );
  }

  const accounts = [...picture.accounts].sort((left, right) => left.slug.localeCompare(right.slug));
  const candidates = [...picture.candidates].sort((left, right) => left.slug.localeCompare(right.slug));
  const auto = picture.auto;
  const held = picture.held;
  // The one place the last switch's reason is stated, whole and dated: no row repeats it, because a reason's
  // figures are that day's and a row would present them as current.
  const lastSwitch = picture.last_switch === null ? null : lastSwitchInWords(picture.last_switch, nowMs);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="text-[11px] uppercase tracking-[0.14em] text-ink-faint">{`Accounts · ${accounts.length + candidates.length}`}</div>

      <div className="flex flex-col gap-0.5">
        {accounts.map((account, index) => (
          <AccountRowView
            key={account.digest}
            account={account}
            hue={index}
            nowMs={nowMs}
            busy={busy}
            held={held}
            onUse={onUse}
            onSetup={onSetup}
            onRemove={onRemove}
          />
        ))}
        {candidates.map((candidate, index) => (
          <CandidateRow
            key={candidate.digest}
            slug={candidate.slug}
            email={candidate.email ?? null}
            hue={accounts.length + index}
            busy={busy}
            onSetup={onSetup}
          />
        ))}
        {accounts.length === 0 && candidates.length === 0 && (
          <p className="px-2 text-xs leading-relaxed text-muted-foreground">No accounts are set up yet.</p>
        )}
      </div>

      {accounts.length > 0 && (
        <div className="mt-0.5 flex items-center justify-between gap-3 px-2">
          {/* Short to the eye; the switch's accessible name keeps the whole sentence. */}
          <span className="text-xs leading-relaxed text-muted-foreground">Auto-switch when full</span>
          <Switch checked={auto} onChange={onSetAuto} label={AUTO_SWITCH_WORDS} disabled={busy} />
        </div>
      )}

      {!auto && accounts.length > 0 && (
        <p className="px-2 text-xs leading-relaxed text-ink-faint">Off: the account in use stays chosen even when full.</p>
      )}

      {lastSwitch !== null && (
        <p className="px-2 text-xs leading-relaxed text-ink-faint">
          <span className="block text-muted-foreground">{lastSwitch.lead}</span>
          {lastSwitch.why}
        </p>
      )}

      {accounts.length > 0 && (
        <p className="px-2 pt-0.5 text-xs leading-relaxed text-ink-faint">{SWITCHING_IN_WORDS}</p>
      )}
    </div>
  );
}
