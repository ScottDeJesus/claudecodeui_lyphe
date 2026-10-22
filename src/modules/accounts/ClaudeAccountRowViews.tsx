import { MoreHorizontal } from 'lucide-react';

import { accountInitials } from '@/modules/accounts/utils/accountInitials';
import { ActionMenu, Avatar } from '@/shared/ui';
import type { ClaudeAccountRow } from '@/shared/types';
import { formatRelativeTime, formatShortDate } from '@/shared/utils';

/** A reading older than this says when it was taken; below it, the figures read as current. */
const READING_STALE_MS = 3 * 60_000;

/** The two windows each row states, in points (the door's fractions ×100), in the door's own order. */
function figuresInPoints(reading: ClaudeAccountRow['reading']): string {
  if (reading === null) return '5h — · wk —';
  return `5h ${Math.round(reading.five * 100)}% · wk ${Math.round(reading.week * 100)}%`;
}

/** How old a row's figures are, in words — only once they are old enough that "current" would be a lie. */
function readingAgeInWords(reading: ClaudeAccountRow['reading'], nowMs: number): string | null {
  if (reading === null) return null;
  const takenAtMs = reading.at * 1000;
  if (nowMs - takenAtMs <= READING_STALE_MS) return null;
  return `as of ${formatRelativeTime(new Date(takenAtMs).toISOString())}`;
}

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

/** The day a saved token stops working. A past date says `expired`, because "valid until" a past day is false. */
function tokenDateInWords(expiresAt: number | null, nowMs: number): string | null {
  if (expiresAt === null) return null;
  const date = formatShortDate(new Date(expiresAt * 1000).toISOString());
  if (date === null) return null;
  return expiresAt * 1000 < nowMs ? `expired ${date}` : `valid until ${date}`;
}

type AccountRowViewProps = {
  account: ClaudeAccountRow;
  /** One per row, so two accounts never read alike. */
  hue: number;
  nowMs: number;
  busy: boolean;
  /** The chosen record's why, passed only to the account in use when the last choice was automatic. */
  autoWhy: string | null;
  /** Whether the chosen record waits for room; only the account in use can say so. */
  held: boolean;
  onUse: (slug: string) => void;
  onSetup: (slug: string) => void;
  onRemove: (slug: string) => void;
};

/**
 * One account the store holds: its name, its two windows, its token, and the one act it is owed.
 * Used by the accounts module's ClaudeAccountRows, one per account in slug order.
 */
export function AccountRowView({ account, hue, nowMs, busy, autoWhy, held, onUse, onSetup, onRemove }: AccountRowViewProps) {
  const refused = account.wall?.kind === 'refused';
  // A checked token is one click from being in use; a refused or absent one needs Set up first, and
  // "checking" is not a verdict yet.
  const canUse = account.token === 'saved' && !refused && !account.in_use;
  const needsSetup = account.token === 'none' || refused;
  const age = readingAgeInWords(account.reading, nowMs);
  // A refused token's saved expiry promises what the amber line below denies. The row shows the
  // wall, not the date; `checking` keeps its date, qualified by its own state word.
  const tokenDate = refused ? null : tokenDateInWords(account.expires_at, nowMs);
  // The in-use row says why it waits instead, so it does not repeat the same fact twice.
  const noRoom = account.token === 'saved' && !refused && !account.room && !(account.in_use && held);
  // A press still works — it chooses an account that waits for room (the held case) — but the cue
  // says so rather than promising a switch that will not happen yet.
  const useCue = noRoom ? 'Use anyway' : 'Use';

  const details = (
    <>
      <span className="flex min-w-0 items-center gap-1.5">
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground" title={account.slug}>{account.slug}</span>
        {account.in_use && <span className="flex-none text-xs text-accent-ink">✓ in use now</span>}
        {canUse && <span className="flex-none text-xs text-accent-ink">{useCue}</span>}
      </span>
      <span className="block text-xs text-muted-foreground">
        {figuresInPoints(account.reading)}
        {age !== null && <span className="text-ink-faint"> · {age}</span>}
      </span>
      {tokenDate !== null && <span className="block text-xs text-ink-faint">{tokenDate}</span>}
      {refused && (
        <span data-tone="warn" className="block text-xs leading-relaxed text-tone-ink">
          sign-in token refused — set it up again
        </span>
      )}
      {account.token === 'checking' && <span className="block text-xs text-ink-faint">checking</span>}
      {noRoom && (
        <span className="block text-xs leading-relaxed text-muted-foreground">
          {`no room now — ${withoutOwnName(account.why, account.slug)}`}
        </span>
      )}
      {account.in_use && held && (
        <span className="block text-xs leading-relaxed text-ink-faint">stays chosen until it has room again</span>
      )}
      {account.in_use && autoWhy !== null && (
        <span className="block text-xs leading-relaxed text-ink-faint">{autoWhy}</span>
      )}
      {needsSetup && (
        <button
          type="button"
          disabled={busy}
          onClick={() => onSetup(account.slug)}
          aria-label={`Set up ${account.slug}`}
          title={`Set up ${account.slug}`}
          className="mt-0.5 rounded-md px-2 py-1.5 text-left text-xs text-accent-ink transition-colors hover:bg-primary/10 disabled:opacity-60"
        >
          Set up
        </button>
      )}
    </>
  );

  return (
    <div
      data-account-slug={account.slug}
      className={`flex items-start gap-1 rounded-lg ${account.in_use ? 'bg-primary/10' : ''}`}
    >
      {canUse ? (
        <button
          type="button"
          disabled={busy}
          aria-label={noRoom ? `Use ${account.slug} anyway` : `Use ${account.slug}`}
          onClick={() => onUse(account.slug)}
          className="flex min-w-0 flex-1 items-start gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-muted/60 disabled:opacity-60"
        >
          <Avatar initials={accountInitials(account.slug)} hue={hue} size={24} />
          <span className="min-w-0 flex-1">{details}</span>
        </button>
      ) : (
        <div className="flex min-w-0 flex-1 items-start gap-2.5 px-2 py-1.5">
          <Avatar initials={accountInitials(account.slug)} hue={hue} size={24} />
          <span className="min-w-0 flex-1">{details}</span>
        </div>
      )}
      <ActionMenu
        label={`Account actions for ${account.slug}`}
        iconOnly
        icon={MoreHorizontal}
        variant="ghost"
        size="icon"
        className="flex-none"
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
  );
}

/**
 * A live identity the store does not hold yet: the same Set up row, with no figures and no menu.
 * Used by the accounts module's ClaudeAccountRows, one per live identity the store does not hold.
 */
export function CandidateRow({ slug, hue, busy, onSetup }: { slug: string; hue: number; busy: boolean; onSetup: (slug: string) => void }) {
  return (
    <div data-account-candidate={slug} className="flex items-start gap-2.5 px-2 py-1.5">
      <Avatar initials={accountInitials(slug)} hue={hue} size={24} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium text-foreground" title={slug}>{slug}</span>
        <span className="block text-xs leading-relaxed text-ink-faint">signed in on this box — not set up yet</span>
        <button
          type="button"
          disabled={busy}
          onClick={() => onSetup(slug)}
          aria-label={`Set up ${slug}`}
          title={`Set up ${slug}`}
          className="mt-0.5 rounded-md px-2 py-1.5 text-left text-xs text-accent-ink transition-colors hover:bg-primary/10 disabled:opacity-60"
        >
          Set up
        </button>
      </span>
    </div>
  );
}
