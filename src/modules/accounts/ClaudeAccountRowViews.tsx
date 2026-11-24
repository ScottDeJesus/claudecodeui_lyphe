import { Check, KeyRound, MoreHorizontal } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { UsageRing } from '@/modules/accounts/UsageRing';
import { readingAgeWords, rowWeek } from '@/modules/accounts/utils/accountInUseUsage';
import { ActionMenu, Button } from '@/shared/ui';
import type { ClaudeAccountRow } from '@/shared/types';
import { cn, formatShortDate } from '@/shared/utils';

/** A state said in one word beside an account's name: small capitals, in the ink its tone gives (`data-tone`), else the accent's. */
const STATE_WORD_CLASS = 'font-mono text-[10px] uppercase leading-none tracking-[0.12em]';

/** A token is worth a word only this close to its expiry: further out, its date is a fact nobody has to act on yet. */
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
  return expiresAtMs < nowMs ? `Token expired ${date}` : `Token expires ${date}`;
}

/**
 * A row's one act, as the kit's small button: its word where a pointer has room for words, its icon alone under a finger, where the
 * button is a 44px square. The word is always its name for a reader.
 */
function RowAct({ icon: Icon, word, name, busy, onPress }: { icon: LucideIcon; word: string; name: string; busy: boolean; onPress: () => void }) {
  return (
    <Button variant="outline" size="sm" className="h-7 px-2.5 text-xs finger:h-11 finger:w-11 finger:px-0" disabled={busy} aria-label={name} title={name} onClick={onPress}>
      <Icon className="hidden finger:block" />
      <span className="finger:hidden">{word}</span>
    </Button>
  );
}

/** A state that needs the reader, in one warn word; the whole reason is its hover. */
function WarnWord({ children, why }: { children: string; why?: string }) {
  return <span data-tone="warn" title={why} className={cn(STATE_WORD_CLASS, 'text-tone-ink')}>{children}</span>;
}

type AccountRowViewProps = {
  account: ClaudeAccountRow;
  nowMs: number;
  busy: boolean;
  /** Whether the chosen record waits for room; only the account in use can say so. */
  held: boolean;
  /** The last switch, dated and with its reason, when it was to this account: the hover of its "In use". Null on every other row. */
  switched: string | null;
  onUse: (slug: string) => void;
  onSetup: (slug: string) => void;
  onRemove: (slug: string) => void;
};

/**
 * One account the store holds: its week as a ring, then its name over its state and its one act, then its menu. Used by the accounts
 * module's ClaudeAccountRows, one per account in slug order.
 *
 * ITS WEEK IS ITS MARK. Every row opens with its ring (`UsageRing`: the figure in the middle, the window and its countdown under it), in
 * a cell of one fixed width, so the rings of every account stand in one column and the accounts compare in one look.
 *
 * NOTHING IS SAID THAT A FIGURE, A COLOUR OR AN ACT ALREADY SAYS. The account in use says "In use"; any other says only what the reader
 * can do about it (Use, Set up) or the one word for why they cannot (Full, Sign-in refused), with the whole reason as that word's hover.
 *
 * The ring stands outside every press: the act is its own button, never the whole row, so a long press that reads the ring's words
 * cannot switch the account.
 */
export function AccountRowView({ account, nowMs, busy, held, switched, onUse, onSetup, onRemove }: AccountRowViewProps) {
  const refused = account.wall?.kind === 'refused';
  // A checked token is one press from being in use; a refused or absent one needs Set up first, and
  // "checking" is not a verdict yet.
  const canUse = account.token === 'saved' && !refused && !account.in_use;
  const needsSetup = account.token === 'none' || refused;
  // The week as every surface draws it: one whose reset has passed with no reading since is the week that began
  // there — unknown, counting down to its next reset — so the ring never shows a closed week's figure.
  const week = rowWeek(account, nowMs);
  // An old or unread figure says so; a recent one says nothing.
  const ageWords = readingAgeWords(account, nowMs);
  // A refused token's saved expiry promises what the warn word denies: the row shows the wall, not the date.
  const tokenNotice = refused ? null : tokenNoticeInWords(account.expires_at, nowMs);
  // The in-use row says why it waits instead, so it does not repeat the same fact twice.
  const noRoom = account.token === 'saved' && !refused && !account.room && !(account.in_use && held);
  const name = account.email ?? account.slug;

  return (
    <li
      data-account-slug={account.slug}
      data-in-use={account.in_use || undefined}
      className="flex items-center gap-2 border-b border-border/60 py-2 last:border-b-0"
    >
      {/* `owner`: three rows draw three "This week" rings, and a screen reader must hear whose each one is. */}
      <UsageRing usageWindow={week} now={nowMs} captioned owner={account.slug} />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="truncate text-[13px] font-medium leading-tight text-foreground" title={name}>{name}</div>
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          {account.in_use && <span className={cn(STATE_WORD_CLASS, 'text-accent-ink')} title={switched ?? undefined}>In use</span>}
          {ageWords !== null && (
            <span data-reading-age className={cn(STATE_WORD_CLASS, 'text-ink-faint')} title={account.reading ? `Last read by ${account.reading.source}` : undefined}>{ageWords}</span>
          )}
          {canUse && (
            // A press still works on a full account — it chooses an account that waits for room (the held case) —
            // but the act says so rather than promising a switch that will not happen yet.
            <RowAct
              icon={Check}
              word={noRoom ? 'Use anyway' : 'Use'}
              name={noRoom ? `Use ${account.slug} anyway` : `Use ${account.slug}`}
              busy={busy}
              onPress={() => onUse(account.slug)}
            />
          )}
          {needsSetup && <RowAct icon={KeyRound} word="Set up" name={`Set up ${account.slug}`} busy={busy} onPress={() => onSetup(account.slug)} />}
          {account.token === 'checking' && <span className={cn(STATE_WORD_CLASS, 'text-ink-faint')}>Checking</span>}
          {refused && <WarnWord>Sign-in refused</WarnWord>}
          {tokenNotice !== null && <WarnWord>{tokenNotice}</WarnWord>}
          {noRoom && <WarnWord why={withoutOwnName(account.why, account.slug)}>Full</WarnWord>}
          {account.in_use && held && <WarnWord why="Stays chosen until it has room again">Waiting for room</WarnWord>}
        </div>
      </div>
      <ActionMenu
        label={`Account actions for ${account.slug}`}
        iconOnly
        icon={MoreHorizontal}
        variant="ghost"
        size="icon"
        className="flex-none"
        triggerClassName="h-8 w-8 finger:h-11 finger:w-11"
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
    </li>
  );
}

/**
 * A live identity the store does not hold yet: an empty ring, its name and the same Set up act, with no menu.
 * Used by the accounts module's ClaudeAccountRows, one per live identity the store does not hold.
 */
export function CandidateRow({ slug, email, nowMs, busy, onSetup }: { slug: string; email: string | null; nowMs: number; busy: boolean; onSetup: (slug: string) => void }) {
  return (
    <li data-account-candidate={slug} className="flex items-center gap-2 border-b border-border/60 py-2 last:border-b-0">
      <UsageRing usageWindow={null} now={nowMs} captioned owner={slug} />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="truncate text-[13px] font-medium leading-tight text-foreground" title={email ?? slug}>{email ?? slug}</div>
        <div className="flex">
          <RowAct icon={KeyRound} word="Set up" name={`Set up ${slug}`} busy={busy} onPress={() => onSetup(slug)} />
        </div>
      </div>
    </li>
  );
}
