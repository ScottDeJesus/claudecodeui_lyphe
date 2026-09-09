import { UsageMeters } from '@/modules/accounts/UsageMeters';
import { accountInitials } from '@/modules/accounts/utils/accountInitials';
import { useMinuteTick } from '@/modules/accounts/hooks/useMinuteTick';
import { weeklyResetInWords } from '@/modules/accounts/utils/weeklyReset';
import { Avatar, Banner, Button, Card } from '@/shared/ui';
import type { DescentAccounts, DescentSlot, DescentUsage } from '@/shared/types';

/** The line that closes the switcher, because "will this lose my work?" is the only question a switch actually raises. */
const SWITCH_REASSURANCE =
  'Switching changes only which account signs the requests. Your projects, conversations and running work stay exactly as they are — open conversations keep their history and resume on the new account.';

/**
 * What the date on a row means, said once so no row has to imply it.
 *
 * Descent calls `expiresAt` "a freshness clock, not a secret" (`account_store.py:148`) and
 * renders no warning from it anywhere in its own switcher. It is the provider's expiry inside the
 * COPY Descent holds, read from that slot's own file — so the date is the age of the copy and
 * nothing more. On the live store, two of three sit in the past.
 *
 * It says what the date IS and draws no contrast, deliberately. Every clause that sorted the rows
 * into "the one in use" and "the rest" turned out false: nothing refreshes a copy on a clock, so
 * the active slot's stamp passes like any other; and a switch writes the OUTGOING slot fresh
 * first (`account_store.py:316-331`), so a just-docked copy carries a future date for hours.
 * `savedCopyFreshness` below has a future-tense branch for exactly that row. A sentence that
 * merely names the field cannot be contradicted by any row beneath it.
 *
 * Kept to ONE line's worth of words on purpose. It sits above the rows (which is where it has
 * to be — every row below carries the phrase it disarms), so every line it costs pushes the
 * switcher and "+ Add another account" further down a panel that already scrolls.
 */
const DATE_MEANING = 'A date in the past is normal — it is the expiry on the copy Descent holds.';

/** Said in words, because an empty switcher would otherwise read as "you have no accounts". */
const UNREACHABLE_LINE = 'Descent is not reachable — accounts and usage are unknown.';

/** The panel's own id, so the trigger can point at it with `aria-controls`. */
export const ACCOUNT_PANEL_ID = 'account-panel';

/**
 * The freshness of a saved copy, as a fact and never as a verdict.
 *
 * `expiresAt` is epoch MILLISECONDS — handed to `new Date` with no conversion. The tense
 * follows the clock so the sentence stays true, and that is ALL it does: no mark, no amber, no
 * button. A stamp in the past is the normal condition of a docked account, so treating it as
 * an alarm made an alarm that is always on, which is not an alarm.
 */
function savedCopyFreshness(expiresAt: number | null): string {
  if (expiresAt === null) return '—';
  const when = new Date(expiresAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
  return expiresAt < Date.now() ? `Saved copy expired ${when}` : `Saved copy expires ${when}`;
}

/** What the account in use says about itself: that it is in use, and how much work is riding on it right now. */
function activeMeta(liveSessions: number): string {
  if (liveSessions <= 0) return 'in use now · none proven running';
  return `in use now · ${liveSessions} session${liveSessions === 1 ? '' : 's'} running`;
}

type AccountRowProps = {
  slot: DescentSlot;
  hue: number;
  busy: boolean;
  onSwitch: (slug: string) => void;
  /** The panel's ticking clock, passed in so every row counts down from the same instant. */
  now: number;
};

/** One switchable account. The whole row is the button: there is no second control on it, so there is nothing to nest. */
function AccountRow({ slot, hue, busy, onSwitch, now }: AccountRowProps) {
  const weeklyReset = weeklyResetInWords(slot.slug, now);

  return (
    <div data-account-slug={slot.slug} className="flex items-center gap-2">
      <button
        type="button"
        data-slug={slot.slug}
        disabled={busy}
        onClick={() => onSwitch(slot.slug)}
        className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-muted/60 disabled:opacity-60"
      >
        <Avatar initials={accountInitials(slot.label)} hue={hue} size={24} />
        <span className="min-w-0 flex-1">
          {/* The label truncates at this width, so the full address lives in a `title` — the
              avatar's two letters can collide and the row must stay identifiable. */}
          <span className="block truncate text-[13px] font-medium text-foreground" title={slot.label}>{slot.label}</span>
          <span className="block text-xs text-muted-foreground">{savedCopyFreshness(slot.expiresAt)}</span>
          {weeklyReset && <span className="block text-xs text-ink-faint">{weeklyReset}</span>}
        </span>
      </button>
    </div>
  );
}

type AccountPopoverProps = {
  accounts: DescentAccounts | null;
  usage: DescentUsage | null;
  busy: boolean;
  error: string | null;
  onSwitch: (slug: string) => void;
  onAddAccount: () => void;
  onSaveLiveLogin: () => void;
};

/**
 * The account panel: what this account has used, and which account signs the next request.
 * Used by the accounts module's AccountFooterRow, which anchors it above the sidebar footer
 * and owns the open state.
 *
 * It composes Card rather than adopting the library's Menu: a Menu is a list of labelled
 * choices, and this panel carries meters, avatars and buttons. Codex is deliberately absent —
 * these are the Claude slots Descent holds, and Codex stays in Settings → Agents (D6).
 */
export function AccountPopover({
  accounts,
  usage,
  busy,
  error,
  onSwitch,
  onAddAccount,
  onSaveLiveLogin,
}: AccountPopoverProps) {
  // Advances once a minute so the reset countdowns stay true while the panel is open. The
  // interval exists only for as long as this component does, and this component is mounted
  // only while the panel is showing.
  const now = useMinuteTick();
  const picture = accounts?.reachable ? accounts : null;
  const unknown = accounts !== null && !accounts.reachable;
  // Read off `picture` rather than kept as its own binding: narrowing has to survive into the
  // rows, where the active one reads `liveSessions` from the same object.
  const slotCount = picture?.slots.length ?? 0;

  return (
    // The ceiling has to fit the space ABOVE the row this hangs from, not the viewport: the
    // panel grows upward, so a cap taller than that space pushes its top edge off screen and
    // the first meter loses its label. 70vh sits inside it at every height the app supports,
    // and the panel scrolls from a top edge the reader can see.
    <Card
      id={ACCOUNT_PANEL_ID}
      role="dialog"
      aria-label="Account and usage"
      className="absolute bottom-full left-0 right-0 z-50 mb-2 flex max-h-[70vh] flex-col gap-3 overflow-y-auto p-3"
    >
      {unknown ? <p className="text-xs leading-relaxed text-muted-foreground">{UNREACHABLE_LINE}</p> : <UsageMeters usage={usage} />}

      <div className="flex flex-col gap-1.5">
        <div className="text-[11px] uppercase tracking-[0.14em] text-ink-faint">
          {`Switch account · ${picture ? slotCount : '—'}`}
        </div>

        {/* ABOVE the rows, deliberately. This is the sentence that makes "Saved copy expired"
            read as routine rather than as a fault, and every row below it carries that phrase —
            so a reader who meets the rows first has already met the explanation. Rendered last
            it sat below the fold at every viewport height the panel was measured at. */}
        {slotCount > 0 && (
          <p className="pb-0.5 text-xs leading-relaxed text-ink-faint">{DATE_MEANING}</p>
        )}

        {/* Descent answered, but its own account store would not read. The switcher is empty
            for a reason the reader is owed in words. */}
        {picture?.unreadable && (
          <p className="text-xs leading-relaxed text-muted-foreground">
            Descent answered, but it could not read its saved accounts — none can be listed.
          </p>
        )}

        {picture?.slots.map((slot, index) => {
          if (!slot.isActive) {
            return <AccountRow key={slot.slug} slot={slot} hue={index} busy={busy} onSwitch={onSwitch} now={now} />;
          }

          const weeklyReset = weeklyResetInWords(slot.slug, now);

          return (
            <div
              key={slot.slug}
              data-account-slug={slot.slug}
              className="flex items-center gap-2.5 rounded-lg bg-primary/10 px-2.5 py-2"
            >
              <Avatar initials={accountInitials(slot.label)} hue={index} size={24} />
              <div className="min-w-0 flex-1">
                {/* The mark rides on the LABEL's line rather than at the row's right edge. Out
                    there it cost every line beneath it 20px of width, and the reset countdown —
                    the longest of them — wrapped for want of exactly that. The label truncates
                    and carries its full address in a `title`, so it is the line that can spare
                    the room. The account in use is already switched to, so it carries a mark
                    rather than a button — and the mark is a glyph, not a colour (doctrine §6). */}
                <div className="flex items-center gap-1.5">
                  <div className="truncate text-[13px] font-medium text-accent-ink" title={slot.label}>{slot.label}</div>
                  <span title="In use now" className="flex-none text-xs text-accent-ink">✓</span>
                </div>
                <div className="text-xs text-muted-foreground">{activeMeta(picture.liveSessions)}</div>
                {weeklyReset && <div className="text-xs text-ink-faint">{weeklyReset}</div>}
              </div>
            </div>
          );
        })}

        {picture && (
          <button
            type="button"
            disabled={busy}
            onClick={onAddAccount}
            className="rounded-lg px-2.5 py-2 text-left text-[13px] text-accent-ink transition-colors hover:bg-primary/10 disabled:opacity-60"
          >
            + Add another account
          </button>
        )}

        {/* The live login and its saved copy have diverged. A fact with a remedy, not an
            error: both accounts are named, because "Save it" adopts the live one. */}
        {picture?.drift && (
          <Banner
            tone="warn"
            action={
              <Button variant="tonal" size="sm" className="h-8 flex-none px-2.5 text-xs" disabled={busy} onClick={onSaveLiveLogin}>
                Save it
              </Button>
            }
          >
            <span className="text-xs">
              {`The live login (${picture.liveLabel ?? 'unnamed'}) differs from the saved copy of ${picture.activeLabel ?? 'the account in use'}`}
            </span>
          </Banner>
        )}

        {error && (
          <Banner tone="warn">
            <span className="text-xs">{error}</span>
          </Banner>
        )}

        {/* Both closing lines are about switching between accounts, so neither renders when
            there are no accounts to switch between. */}
        {slotCount > 0 && (
          <p className="px-2.5 pt-0.5 text-xs leading-relaxed text-ink-faint">{SWITCH_REASSURANCE}</p>
        )}
      </div>
    </Card>
  );
}
