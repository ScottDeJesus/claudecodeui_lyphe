import type { CSSProperties } from 'react';

import { Meter } from '@/shared/ui';
import { WINDOW_NAMES, resetInstant, windowPercent, windowTone } from '@/modules/accounts/utils/usageWindows';
import type { ClaudeUsage, ClaudeUsagePace, ClaudeUsageWindow } from '@/shared/types';

/**
 * The server's words for a degraded reading, in the app's.
 *
 * `pending` is the one that is NOT a fault — a read is in flight and the numbers are simply
 * not here yet. An unrecognised word is quoted rather than swallowed: a new server reason
 * should reach the reader intact, not be flattened into "something went wrong".
 */
const DEGRADED_REASONS: Record<string, string> = {
  pending: 'a fresh reading is on its way',
  shape: 'the provider answered in a shape this app did not recognise',
  credentials: 'the saved login could not be read',
  expired: 'the saved login has expired and could not be renewed; sign in again with claude /login',
  auth: 'the provider refused the login',
  network: 'the provider could not be reached',
  throttled: 'the provider is limiting how often it will answer',
  upstream: 'the provider had a problem of its own',
  old: 'nothing has read this account since',
  unaged: 'this figure carries no time it was read',
};

function degradedReasonInWords(reason: string): string {
  if (!reason) return 'the provider gave no figures';
  return DEGRADED_REASONS[reason] ?? `The server reported “${reason}”`;
}

/** The server's own three words for a read it could not make, in plain English. */
function unreachableReasonInWords(reason: string): string {
  if (reason === 'timeout') return 'The server did not answer in time.';
  if (reason === 'bad-response') return 'The server answered with something this app could not read.';
  return 'The server is not reachable.';
}

/**
 * `staleSince` and `checkedAt` arrive in epoch SECONDS — the wire's own unit. The `* 1000` is what
 * keeps this line out of January 1970.
 */
function secondsStampInWords(seconds: number): string {
  return new Date(seconds * 1000).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

/** The window this app has its own name for; everything else keeps the provider's label, which is the only place a `weekly_scoped:*` plan is named. */
function windowLabel(usageWindow: ClaudeUsageWindow): string {
  return usageWindow.key === 'seven_day' ? WINDOW_NAMES.seven_day : usageWindow.label;
}

/**
 * A dial's figure in words, for a reader that cannot see it: the percent, and the heavy state beside it.
 *
 * The dial's `▲` is CSS `::before`, so it reaches paint and nothing else — a reader on assistive tech would get "81%" with no hint
 * that it is the warn one. Doctrine §6 asks for a mark OR a word; the mark is the library's, the word is the caller's.
 */
function figureInWords(percent: number | null, tone: 'accent' | 'warn'): string {
  if (percent === null) return 'unknown';
  return tone === 'warn' ? `${percent}%, running heavy` : `${percent}%`;
}

/**
 * When the window turns over, short enough to read at a glance under a dial: "Resets 4:00 PM" today, "Resets Fri 4:00 PM" any other
 * day. Rounded to the minute for the reason `resetsLine` gives. `undefined` when the window names no reset: the line is not drawn.
 */
function resetsShort(resetsAt: string | null): string | undefined {
  if (!resetsAt) return undefined;
  const at = new Date(Math.round(resetInstant(resetsAt) / 60_000) * 60_000);
  if (Number.isNaN(at.getTime())) return undefined;
  const clock = at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (at.toDateString() === new Date().toDateString()) return `Resets ${clock}`;
  return `Resets ${at.toLocaleDateString([], { weekday: 'short' })} ${clock}`;
}

/**
 * When the window turns over, and how far away that is in words.
 *
 * A weekly window is days out, so "about 133 hours left" would be arithmetic rather than
 * English; past a day this says the weekday and counts in days instead. `null` means the meter
 * has no reset time, and then the line is simply not drawn.
 *
 * The instant comes from `resetInstant`, the one reader this module has, so the countdown here
 * and the carry past a reset (`windowPastReset`) describe the same moment.
 *
 * Said as each dial's hover, and in each usage ring's words (`UsageRing`, on the rail and in the account rows).
 */
export function resetsLine(resetsAt: string | null): string | undefined {
  if (!resetsAt) return undefined;
  const at = new Date(resetInstant(resetsAt));
  if (Number.isNaN(at.getTime())) return undefined;

  // Rounded to the nearest minute before it is printed. The provider computes `resets_at` as
  // "now + remaining", so the same boundary arrives as 13:59:59.6 on one reading and 14:00:00.4 on
  // the next; `toLocaleTimeString` TRUNCATES, so the untouched stamp made one reset read
  // "01:59 PM" and "02:00 PM" on alternating reads. The countdown below still measures from the
  // real instant — only the clock face is rounded.
  const clock = new Date(Math.round(at.getTime() / 60_000) * 60_000)
    .toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const msLeft = at.getTime() - Date.now();
  if (msLeft <= 0) return `Resets at ${clock}`;

  // Rounded UP, as `resetCountdown` rounds the rings' countdown, so the words and the ring name one number.
  const hoursLeft = Math.ceil(msLeft / 3_600_000);
  if (msLeft < 3_600_000) return `Resets at ${clock} · under an hour left`;
  if (hoursLeft < 24) return `Resets at ${clock} · about ${hoursLeft} hour${hoursLeft === 1 ? '' : 's'} left`;

  const daysLeft = Math.ceil(msLeft / 86_400_000);
  const weekday = at.toLocaleDateString([], { weekday: 'long' });
  return `Resets ${weekday} ${clock} · about ${daysLeft} day${daysLeft === 1 ? '' : 's'} left`;
}

/**
 * The one sentence a degraded reading owes the reader: how old these figures are, and why
 * there are no newer ones. `null` when the reading is healthy, and the stamp is dropped
 * rather than invented when the meter has no `staleSince` to give.
 */
function degradedLine(degraded: boolean, staleSince: number | null, reason: string): string | null {
  if (!degraded) return null;
  const why = degradedReasonInWords(reason);
  if (staleSince === null) return `${why.charAt(0).toUpperCase()}${why.slice(1)}.`;
  return `As of ${secondsStampInWords(staleSince)} — ${why}.`;
}

/** A muted line of context under the dials — the "as of" stamp and anything else said in words rather than in colour. */
function UsageNote({ children }: { children: string }) {
  return <p className="text-xs leading-relaxed text-ink-faint">{children}</p>;
}

const NO_PACE = { tickAt: null, markAt: null, caption: null } as const;

/** The pacer's two annotations for ONE usage window, and the sentence the This week dial carries as its hover. Every other window — and every dial on a reading with no pace — gets none. */
function paceForWindow(key: string, pace: ClaudeUsagePace | null): { tickAt: number | null; markAt: number | null; caption: string | null } {
  if (!pace || key !== 'seven_day') return NO_PACE;
  // `typeof`: the wire is untrusted, and a pace whose `words` is no string keeps its tick and mark and draws no
  // caption — never a throw in render.
  const words = typeof pace.words === 'string' ? pace.words.trim() : '';
  return { tickAt: pace.ceiling7, markAt: pace.projected7, caption: words || null };
}

/** From three dials up they step down, so a five-hour limit, on an account that has one, stands in the same row as the two weeks. */
const DIAL_PX = { few: 132, many: 86 } as const;

/**
 * The usage block of the account panel (D7): ONE DIAL FOR EACH WINDOW the provider measures on the account in use. An account has
 * its week, usually a week for one model, and sometimes a five-hour limit; the row draws as many as there are and invents none.
 * Used by the accounts module's AccountPanelBody, which the account switcher and the Accounts widget both draw.
 *
 * A DIAL SAYS THREE THINGS AND NO MORE: the figure and its percent sign in the middle, the window's name under it, and when it
 * resets under that, short and never cut ("Resets Fri 4:00 PM"). The whole sentence ("about 3 days left") is the dial's hover.
 *
 * There is deliberately no flexible-spend dial: the provider reports no such window, and one reading "—" would invent a limit
 * nobody set.
 *
 * THE PACER'S PICTURE SITS ON THE WEEK'S DIAL: a ceiling tick across its arc and a projected-end mark outside it (`usage.pace`), with
 * the pacer's own sentence as that dial's hover. The figures arrive as percents from the usage route, which converts them once, so the
 * dial does no arithmetic. An absent pace draws none of it.
 *
 * A reading that cannot be drawn is said in one line where the dials would stand: nothing asked yet, the server out of reach, a poll
 * in flight, a shape this app could not read. A degraded reading keeps its dials, dimmed, over the line that says how old they are.
 */
export function UsageMeters({ usage }: { usage: ClaudeUsage | null }) {
  // The pacer's projection as the usage route attached it, in percent; an unreachable answer has no
  // key of its own, and an absent one draws the dials exactly as they are without it.
  const pace = usage !== null && usage.reachable ? usage.pace ?? null : null;
  return <div data-usage-dials="" className="flex flex-col gap-2">{renderReading(usage, pace)}</div>;
}

function renderReading(usage: ClaudeUsage | null, pace: ClaudeUsagePace | null) {
  // Nothing has been asked yet. An em-dash, not a spinner: the first reading normally lands
  // before the panel is ever opened, and a dial sweeping in from zero would say "none used".
  if (!usage) return <UsageNote>—</UsageNote>;

  if (!usage.reachable) {
    return <UsageNote>{`Usage is unknown — ${unreachableReasonInWords(usage.reason)}`}</UsageNote>;
  }

  const asOf = degradedLine(usage.degraded, usage.staleSince, usage.reason);

  // `Array.isArray`: a reachable body with no `windows` is the same calm silence as an empty list, not a TypeError in render.
  if (!Array.isArray(usage.windows) || usage.windows.length === 0) {
    // Three different silences: a read in flight is calm, a reading the meter could not parse
    // KNOWS why it is empty, and a degraded read has surrendered.
    if (usage.reason === 'pending') return <UsageNote>A fresh reading is on its way.</UsageNote>;
    if (usage.reason === 'shape') {
      const why = degradedReasonInWords(usage.reason);
      return <UsageNote>{`${why.charAt(0).toUpperCase()}${why.slice(1)}.`}</UsageNote>;
    }
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

  const side = usage.windows.length > 2 ? DIAL_PX.many : DIAL_PX.few;

  return (
    <>
      {/* Muted while degraded: the dials are the LAST figures, not the current ones, and the
          "as of" line under them is what says so. Opacity rather than a tone, because these
          numbers are not a warning — they are simply old. */}
      <div
        className={`flex flex-wrap items-start justify-center gap-x-4 gap-y-3${usage.degraded ? ' opacity-60' : ''}`}
        style={{ '--vv-dial': `${side}px` } as CSSProperties}
      >
        {usage.windows.map((usageWindow) => {
          // Rounded once, here, and read by the figure, the tone, the arc and aria alike.
          const percent = windowPercent(usageWindow);
          const tone = windowTone(usageWindow, percent);
          const paceMarks = paceForWindow(usageWindow.key, pace);
          // The whole of it for a pointer that rests on the dial: the long reset line, then the pacer's sentence.
          const hover = [resetsLine(usageWindow.resetsAt), paceMarks.caption].filter(Boolean).join(' · ');
          return (
            <div key={usageWindow.key} data-usage-dial={usageWindow.key} title={hover || undefined}>
              <Meter
                variant="dial"
                percent={percent}
                tone={tone}
                label={windowLabel(usageWindow)}
                value={figureInWords(percent, tone)}
                sub={resetsShort(usageWindow.resetsAt)}
                tickAt={paceMarks.tickAt}
                markAt={paceMarks.markAt}
              />
              {/* The pacer's sentence, for a reader that has no hover to rest on the dial. */}
              {paceMarks.caption && <span data-usage-pace-caption="" className="sr-only">{paceMarks.caption}</span>}
            </div>
          );
        })}
      </div>
      {asOf && <UsageNote>{asOf}</UsageNote>}
    </>
  );
}
