import { MoreHorizontal } from 'lucide-react';

import { UsageRing } from '@/modules/accounts/UsageRing';
import { accountInitials } from '@/modules/accounts/utils/accountInitials';
import { rowWeek } from '@/modules/accounts/utils/accountInUseUsage';
import { ActionMenu, Avatar } from '@/shared/ui';
import type { ClaudeAccountRow } from '@/shared/types';
import { cn, formatShortDate } from '@/shared/utils';

/**
 * A row's one act — Use, Set up — as a press: the accent word with the accent wash under the pointer, the panel's
 * `↻ Re-login` press. As tall as the state slot it stands in (32px), so a finger has the whole line to land on; pulled
 * left by its own padding, so its word starts under the name.
 */
const ROW_ACT_CLASS =
  '-ml-2 rounded-md px-2 py-2 text-left text-xs text-accent-ink transition-colors hover:bg-primary/10 disabled:opacity-60';

/**
 * A line under a row that says something is wrong with the account: one short line, in the warn tone. Kept off the
 * row's right edge, which the ring's column runs to.
 */
const WARN_LINE_CLASS = 'pr-2 text-xs leading-relaxed text-tone-ink';

/** A token is worth a line only this close to its expiry: further out, its date is a fact nobody has to act on yet. */
const TOKEN_NOTICE_MS = 30 * 86_400_000;

/**
 * The rule's why names the account; the row already does, so drop the leading name and keep the
 * words and figures (`room.py`'s `scottdejesus's weekly is at its ceiling (…)`).
 */
function withoutOwnName(why: string, slug: string): string {
  for (const lead of [`${slug}'s `, `${slug} `]) {
    if (why.startsWith(lead)) return why.slice(lead.length);
  }
  return why;
}

/**
 * The saved token's expiry, said only when someone has to act on it: within `TOKEN_NOTICE_MS` of the day, or past it.
 * `null` otherwise, and for an expiry that names no day — an absent or unreadable `expires_at`, on which
 * `new Date(NaN).toISOString()` throws before the row can draw.
 */
function tokenNoticeInWords(expiresAt: number | null, nowMs: number): string | null {
  if (expiresAt === null) return null;
  const expiresAtMs = expiresAt * 1000;
  const instant = new Date(expiresAtMs);
  if (Number.isNaN(instant.getTime())) return null;
  if (expiresAtMs - nowMs > TOKEN_NOTICE_MS) return null;
  const date = formatShortDate(instant.toISOString());
  if (date === null) return null;
  return expiresAtMs < nowMs ? `sign-in token expired ${date}` : `sign-in token expires ${date}`;
}

type AccountRowViewProps = {
  account: ClaudeAccountRow;
  /** One per row, so two accounts never read alike. */
  hue: number;
  nowMs: number;
  busy: boolean;
  /** Whether the chosen record waits for room; only the account in use can say so. */
  held: boolean;
  onUse: (slug: string) => void;
  onSetup: (slug: string) => void;
  onRemove: (slug: string) => void;
};

/**
 * One account the store holds: its name, then its state and its act on the left and its usage ring on the right, then
 * a warn line only when something needs the reader. Used by the accounts module's ClaudeAccountRows, one per account in
 * slug order.
 *
 * THE RINGS LINE UP DOWN THE LIST. Every row draws its ring at the right end of its second line, in a cell of one fixed
 * width: the rings of every account stand in one column, so the accounts compare in one look. It is the rail's ring
 * (`UsageRing`), with the window's name and countdown written under it, because a phone has no hover.
 *
 * The ring stands outside every press: the act is its own small button (`Use`, `Set up`), never the whole row, so a
 * long press that reads the ring's words cannot switch the account.
 */
export function AccountRowView({ account, hue, nowMs, busy, held, onUse, onSetup, onRemove }: AccountRowViewProps) {
  const refused = account.wall?.kind === 'refused';
  // A checked token is one press from being in use; a refused or absent one needs Set up first, and
  // "checking" is not a verdict yet.
  const canUse = account.token === 'saved' && !refused && !account.in_use;
  const needsSetup = account.token === 'none' || refused;
  // The week as every surface draws it: one whose reset has passed with no reading since is the week that began
  // there — 0%, counting down to its next reset — so the ring never shows a closed week's figure.
  const week = rowWeek(account, nowMs);
  // A refused token's saved expiry promises what the warn line denies: the row shows the wall, not the date.
  const tokenNotice = refused ? null : tokenNoticeInWords(account.expires_at, nowMs);
  // The in-use row says why it waits instead, so it does not repeat the same fact twice.
  const noRoom = account.token === 'saved' && !refused && !account.room && !(account.in_use && held);
  const name = account.email ?? account.slug;

  return (
    <div
      data-account-slug={account.slug}
      className={cn('flex items-start gap-2.5 rounded-lg py-1.5 pl-2', account.in_use && 'bg-primary/10')}
    >
      <Avatar initials={accountInitials(account.slug)} hue={hue} size={24} />
      <div className="min-w-0 flex-1">
        {/* The name and the row's menu. The state and the ring stand under the name, so only a name wider than the
            row ends in an ellipsis. The menu stands over the ring's column: its 28px trigger sits 10px in from the
            row's edge, centred on the 48px ring cell below it (`UsageRing`'s `w-12`). */}
        <div className="flex items-center gap-1">
          <div className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground" title={name}>{name}</div>
          <ActionMenu
            label={`Account actions for ${account.slug}`}
            iconOnly
            icon={MoreHorizontal}
            variant="ghost"
            size="icon"
            className="-my-1 mr-2.5 flex-none"
            triggerClassName="h-7 w-7"
            disabled={busy}
            items={[
              {
                key: 'remove',
                label: 'Remove',
                isDanger: true,
                onSelect: () => onRemove(account.slug),
              },
            ]}
          />
        </div>
        <div className="flex items-start justify-between gap-2">
          {/* The state and the one act, level with the ring's middle. */}
          <div className="flex min-h-8 min-w-0 flex-wrap items-center gap-x-1.5">
            {account.in_use && <span className="text-xs font-medium text-accent-ink">✓ In use</span>}
            {canUse && (
              // A press still works on a full account — it chooses an account that waits for room (the held case) —
              // but the act says so rather than promising a switch that will not happen yet.
              <button
                type="button"
                disabled={busy}
                onClick={() => onUse(account.slug)}
                aria-label={noRoom ? `Use ${account.slug} anyway` : `Use ${account.slug}`}
                className={ROW_ACT_CLASS}
              >
                {noRoom ? 'Use anyway' : 'Use'}
              </button>
            )}
            {needsSetup && (
              <button
                type="button"
                disabled={busy}
                onClick={() => onSetup(account.slug)}
                aria-label={`Set up ${account.slug}`}
                title={`Set up ${account.slug}`}
                className={ROW_ACT_CLASS}
              >
                Set up
              </button>
            )}
            {account.token === 'checking' && <span className="text-xs text-ink-faint">checking sign-in</span>}
          </div>
          <div className="flex flex-none items-start">
            {/* `owner`: three rows draw three "This week" rings, and a screen reader must hear whose each one is. */}
            <UsageRing usageWindow={week} now={nowMs} captioned owner={account.slug} />
          </div>
        </div>
        {refused && <p data-tone="warn" className={WARN_LINE_CLASS}>sign-in token refused</p>}
        {tokenNotice !== null && <p data-tone="warn" className={WARN_LINE_CLASS}>{tokenNotice}</p>}
        {noRoom && <p data-tone="warn" className={WARN_LINE_CLASS}>{`no room now — ${withoutOwnName(account.why, account.slug)}`}</p>}
        {account.in_use && held && <p data-tone="warn" className={WARN_LINE_CLASS}>stays chosen until it has room again</p>}
      </div>
    </div>
  );
}

/**
 * A live identity the store does not hold yet: the same Set up act, with no ring and no menu.
 * Used by the accounts module's ClaudeAccountRows, one per live identity the store does not hold.
 */
export function CandidateRow({ slug, email, hue, busy, onSetup }: { slug: string; email: string | null; hue: number; busy: boolean; onSetup: (slug: string) => void }) {
  return (
    <div data-account-candidate={slug} className="flex items-start gap-2.5 px-2 py-1.5">
      <Avatar initials={accountInitials(slug)} hue={hue} size={24} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-medium text-foreground" title={email ?? slug}>{email ?? slug}</div>
        <div className="flex min-h-8 flex-wrap items-center gap-x-1.5">
          <button
            type="button"
            disabled={busy}
            onClick={() => onSetup(slug)}
            aria-label={`Set up ${slug}`}
            title={`Set up ${slug}`}
            className={ROW_ACT_CLASS}
          >
            Set up
          </button>
          <span className="text-xs text-ink-faint">signed in here, not set up yet</span>
        </div>
      </div>
    </div>
  );
}
