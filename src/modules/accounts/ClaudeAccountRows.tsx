import { AccountRowView, CandidateRow } from '@/modules/accounts/ClaudeAccountRowViews';
import { useMinuteTick } from '@/modules/accounts/hooks/useMinuteTick';
import { Switch } from '@/shared/ui';
import type { ClaudeAccountSwitch, ClaudeAccountsPicture } from '@/shared/types';
import { formatShortDate } from '@/shared/utils';

/**
 * The line that closes the section. A switch raises one question — "will this lose my work?" — and
 * this answers it in the same words the old switcher used where they still apply.
 */
const SWITCHING_IN_WORDS =
  'Switching changes which account new chats and plan runs start on. Work already running finishes on its account; an open conversation moves at its next message.';

/**
 * The door could not answer. One calm line and never a banner: nothing on this screen is wrong —
 * the server simply could not read the store, so which accounts can sign in is unknown.
 */
const DOOR_UNREACHABLE_LINE = 'The account store could not be read — which accounts can sign in is unknown.';

/** The default for a caller that passes no act (the fakes' fixture): a press with no handler must do nothing at all. */
const NO_ACT = () => undefined;

/** The last switch as one sentence, naming the day only when it was not today. */
function lastSwitchInWords(lastSwitch: ClaudeAccountSwitch, nowMs: number, why = lastSwitch.why.trim()): string {
  const at = new Date(lastSwitch.at * 1000);
  const clock = at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).toLowerCase();
  const day = formatShortDate(at.toISOString());
  const sameDay = at.toDateString() === new Date(nowMs).toDateString();
  const when = sameDay || day === null ? `at ${clock}` : `on ${day} at ${clock}`;
  return why ? `Switched to ${lastSwitch.to_slug} ${when} — ${why}` : `Switched to ${lastSwitch.to_slug} ${when}.`;
}

/**
 * The why's headline — what filled, without the figures — for the visible record. The design's own
 * example of this line is exactly this: "sdjesus89's weekly reached its ceiling". The figures stay
 * in the title, where the row above also carries them.
 */
function whyHeadline(why: string): string {
  return why.split(';')[0].split(' (')[0].trim();
}

type ClaudeAccountRowsProps = {
  /** The door's picture, or the calm reason it could not answer. Absent renders nothing. */
  picture?: ClaudeAccountsPicture | { reachable: false; reason: string } | null;
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
 * Used by the accounts module's AccountPopover, after the meters and the balances and above the old
 * "Switch account" block; the fakes beside it (`claude-accounts-fake.ts`) draw every state without a
 * server, so a state is reviewable before the route that carries it exists.
 *
 * Given no picture it renders nothing (the lane has not answered yet); a picture whose door could
 * not answer draws that calm line instead.
 */
export function ClaudeAccountRows(props: ClaudeAccountRowsProps) {
  // A clock handed in is the panel's own, so the section shares the popover's minute rather than
  // keeping a second interval. Composed alone (the fakes' fixture), it keeps its own.
  return props.nowMs === undefined
    ? <SelfTickingAccountRows {...props} />
    : <AccountRowsBody {...props} nowMs={props.nowMs} />;
}

/** The section with its own minute, for a caller that has no clock to hand it. */
function SelfTickingAccountRows(props: ClaudeAccountRowsProps) {
  // The panel is open only while this is mounted, so this tick costs one interval and nothing behind
  // a closed panel; it is what keeps "as of" and the last switch's clock true while it is open.
  const nowMs = useMinuteTick();
  return <AccountRowsBody {...props} nowMs={nowMs} />;
}

/** The composition itself. `nowMs` drives the reading ages and the last switch's clock. */
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

  if ('reachable' in picture) {
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
  const chosen = picture.chosen;
  const lastSwitch = picture.last_switch;
  // The in-use row already carries this sentence in full, so the record's visible line stops at the
  // headline that says what filled; the whole sentence — figures included — stays in the title. The
  // two-line clamp is the safety net for a headline that still runs long with two long slugs at 320.
  const lastSwitchWords = lastSwitch === null ? null : lastSwitchInWords(lastSwitch, nowMs);
  const lastSwitchLine = lastSwitch === null ? null : lastSwitchInWords(lastSwitch, nowMs, whyHeadline(lastSwitch.why));

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
            autoWhy={chosen?.by === 'auto' && chosen.slug === account.slug ? chosen.why : null}
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
          <span className="text-xs leading-relaxed text-muted-foreground">
            Switch automatically when the account in use fills
          </span>
          <Switch
            checked={auto}
            onChange={onSetAuto}
            label="Switch automatically when the account in use fills"
            disabled={busy}
          />
        </div>
      )}

      {!auto && accounts.length > 0 && (
        <p className="px-2 text-xs leading-relaxed text-ink-faint">
          Automatic switching is off — the account in use stays chosen even when it fills.
        </p>
      )}

      {lastSwitchLine !== null && (
        <p className="line-clamp-2 px-2 text-xs leading-relaxed text-ink-faint" title={lastSwitchWords ?? undefined}>{lastSwitchLine}</p>
      )}

      {accounts.length > 0 && (
        <p className="px-2 pt-0.5 text-xs leading-relaxed text-ink-faint">{SWITCHING_IN_WORDS}</p>
      )}
    </div>
  );
}
