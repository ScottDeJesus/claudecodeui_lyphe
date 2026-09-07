import { Meter } from '@/shared/ui';
import type { DescentUsage, DescentUsageWindow } from '@/shared/types';

/** Amber from here up (D7). One number, written once, so the bar and the figure can never disagree about what "heavy" is. */
const HEAVY_PERCENT = 80;

/** The line that closes the block, because a blank bar has to be readable as "unknown" and not as "you have used nothing". */
const CLOSING_LINE =
  'Figures come from the provider and can lag a few minutes. A blank reading means unknown, never zero.';

/**
 * Descent's words for a degraded reading, in the app's.
 *
 * `pending` is the one that is NOT a fault — a poll is in flight and the numbers are simply
 * not here yet. An unrecognised word is quoted rather than swallowed: a new Descent reason
 * should reach the reader intact, not be flattened into "something went wrong".
 */
const DEGRADED_REASONS: Record<string, string> = {
  pending: 'a fresh reading is on its way',
  shape: 'the provider answered in a shape Descent did not recognise',
  credentials: 'the saved login could not be read',
  auth: 'the provider refused the login',
  network: 'the provider could not be reached',
  throttled: 'the provider is limiting how often it will answer',
  upstream: 'the provider had a problem of its own',
};

function degradedReasonInWords(reason: string): string {
  if (!reason) return 'the provider gave no figures';
  return DEGRADED_REASONS[reason] ?? `Descent reported “${reason}”`;
}

/** The proxy's own three words for a read it could not make, in plain English. */
function unreachableReasonInWords(reason: string): string {
  if (reason === 'timeout') return 'Descent did not answer in time.';
  if (reason === 'bad-response') return 'Descent answered with something this app could not read.';
  return 'Descent is not reachable.';
}

/**
 * `staleSince` and `checkedAt` are epoch SECONDS — Descent's own stamps, passed through the
 * proxy unconverted, unlike `DescentSlot.expiresAt`, which is already milliseconds. The
 * `* 1000` is what keeps this line out of January 1970.
 */
function secondsStampInWords(seconds: number): string {
  return new Date(seconds * 1000).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

/** The two windows this app has its own name for; everything else keeps Descent's label, which is the only place a `weekly_scoped:*` plan is named. */
function windowLabel(usageWindow: DescentUsageWindow): string {
  if (usageWindow.key === 'five_hour') return 'Current 5-hour window';
  if (usageWindow.key === 'seven_day') return 'This week';
  return usageWindow.label;
}

/**
 * The reading, rounded ONCE.
 *
 * Descent emits one decimal place (`usage_windows.py:81,123` — `round(float(pct), 1)`), so a
 * raw 79.6 used to print "80% used" over a calm green bar: the label rounded and the threshold
 * did not. Everything downstream — the figure, the tone, the bar, `aria-valuenow` — reads this
 * one integer, so the number the reader sees is the number the threshold judged.
 */
function windowPercent(usageWindow: DescentUsageWindow): number | null {
  return usageWindow.percent === null ? null : Math.round(usageWindow.percent);
}

/**
 * The figure as the reader should see it.
 *
 * `0` is a REAL reading and says "0% used" over an empty track; only `null` is an em-dash.
 * A `rolled` window keeps its real percent and says "was" — its window has already ended, and
 * draining the bar would draw a full tank nobody measured.
 *
 * No `▲` is written here: the Meter's own warn rule prepends it, and a second one would
 * double the mark.
 */
function windowValue(percent: number | null, rolled: boolean): string {
  if (percent === null) return '—';
  const figure = `${percent}% used`;
  return rolled ? `was ${figure}` : figure;
}

/**
 * Warn is a FLOOR, never a ceiling. `severity` is present only when the vendor flagged that
 * window, so its presence alone forces amber: a flagged window can read a comfortable 12 %
 * and still mean an account lock.
 */
function windowTone(usageWindow: DescentUsageWindow, percent: number | null): 'accent' | 'warn' {
  if (usageWindow.severity) return 'warn';
  return percent !== null && percent >= HEAVY_PERCENT ? 'warn' : 'accent';
}

/**
 * The heavy state, in words under the bar.
 *
 * The Meter's `▲` is CSS `::before` (`controls.css:228`), so it reaches paint and nothing
 * else — a reader on assistive tech gets "81% used" with no hint that it is the warn one.
 * Doctrine §6 asks for a mark OR a word; the mark is the library's, the word is the caller's.
 */
function heavyLine(tone: 'accent' | 'warn', sub: string | undefined): string | undefined {
  if (tone !== 'warn') return sub;
  return sub ? `Running heavy · ${sub}` : 'Running heavy';
}

/**
 * When the window turns over, and how far away that is in words.
 *
 * A weekly window is days out, so "about 133 hours left" would be arithmetic rather than
 * English; past a day this says the weekday and counts in days instead. `null` means Descent
 * has no reset time, and then the line is simply not drawn.
 */
function resetsLine(resetsAt: string | null): string | undefined {
  if (!resetsAt) return undefined;
  const at = new Date(resetsAt);
  if (Number.isNaN(at.getTime())) return undefined;

  const clock = at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const msLeft = at.getTime() - Date.now();
  if (msLeft <= 0) return `Resets at ${clock}`;

  const hoursLeft = Math.round(msLeft / 3_600_000);
  if (hoursLeft < 1) return `Resets at ${clock} · under an hour left`;
  if (hoursLeft < 24) return `Resets at ${clock} · about ${hoursLeft} hour${hoursLeft === 1 ? '' : 's'} left`;

  const daysLeft = Math.round(msLeft / 86_400_000);
  const weekday = at.toLocaleDateString([], { weekday: 'long' });
  return `Resets ${weekday} ${clock} · about ${daysLeft} day${daysLeft === 1 ? '' : 's'} left`;
}

/**
 * The one sentence a degraded reading owes the reader: how old these figures are, and why
 * there are no newer ones. `null` when the reading is healthy, and the stamp is dropped
 * rather than invented when Descent has no `staleSince` to give.
 */
function degradedLine(degraded: boolean, staleSince: number | null, reason: string): string | null {
  if (!degraded) return null;
  const why = degradedReasonInWords(reason);
  if (staleSince === null) return `${why.charAt(0).toUpperCase()}${why.slice(1)}.`;
  return `As of ${secondsStampInWords(staleSince)} — ${why}.`;
}

/** A muted line of context under the bars — the "as of" stamp and anything else said in words rather than in colour. */
function UsageNote({ children }: { children: string }) {
  return <p className="text-xs leading-relaxed text-ink-faint">{children}</p>;
}

/**
 * The usage block of the account panel (D7).
 * Used by the accounts module's AccountPopover, which is the only screen that shows usage;
 * it is a separate file because the account rows below it are a different subject and this
 * one is all about what a number does and does not mean.
 *
 * There is deliberately no flexible-spend bar: Descent reports no such window, and a third
 * bar reading "—" would invent a limit nobody set.
 */
export function UsageMeters({ usage }: { usage: DescentUsage | null }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="text-[11px] uppercase tracking-[0.14em] text-ink-faint">Usage on this account</div>
      {renderReading(usage)}
      <UsageNote>{CLOSING_LINE}</UsageNote>
    </div>
  );
}

function renderReading(usage: DescentUsage | null) {
  // Nothing has been asked yet. An em-dash, not a spinner: the first reading normally lands
  // before the panel is ever opened, and a bar animating in from zero would say "none used".
  if (!usage) return <UsageNote>—</UsageNote>;

  if (!usage.reachable) {
    return <UsageNote>{`Usage is unknown — ${unreachableReasonInWords(usage.reason)}`}</UsageNote>;
  }

  const asOf = degradedLine(usage.degraded, usage.staleSince, usage.reason);

  if (usage.windows.length === 0) {
    // Two different silences: a poll in flight is calm, a degraded read has surrendered.
    if (usage.reason === 'pending') return <UsageNote>A fresh reading is on its way.</UsageNote>;
    if (usage.degraded) {
      return (
        <>
          <UsageNote>No figures are available under this account.</UsageNote>
          {asOf && <UsageNote>{asOf}</UsageNote>}
        </>
      );
    }
    return <UsageNote>—</UsageNote>;
  }

  return (
    <>
      {/* Muted while degraded: the bars are the LAST figures, not the current ones, and the
          "as of" line under them is what says so. Opacity rather than a tone, because these
          numbers are not a warning — they are simply old. */}
      <div className={`flex flex-col gap-3${usage.degraded ? ' opacity-60' : ''}`}>
        {usage.windows.map((usageWindow) => {
          // Rounded once, here, and read by the figure, the tone, the bar and aria alike.
          const percent = windowPercent(usageWindow);
          const tone = windowTone(usageWindow, percent);
          return (
            // A rolled window is dimmed on its own: its percent is real but its window has
            // already ended, so it reads as history beside the bars that are still running.
            <div key={usageWindow.key} className={usageWindow.rolled ? 'opacity-60' : undefined}>
              <Meter
                percent={percent}
                tone={tone}
                label={windowLabel(usageWindow)}
                value={windowValue(percent, Boolean(usageWindow.rolled))}
                sub={heavyLine(tone, resetsLine(usageWindow.resetsAt))}
              />
            </div>
          );
        })}
      </div>
      {asOf && <UsageNote>{asOf}</UsageNote>}
    </>
  );
}
