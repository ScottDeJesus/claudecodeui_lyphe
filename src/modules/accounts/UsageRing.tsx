import { resetsLine } from '@/modules/accounts/UsageMeters';
import { WINDOW_NAMES, resetCountdown, ringTone, windowPercent, windowValue } from '@/modules/accounts/utils/usageWindows';
import type { ClaudeUsageWindow } from '@/shared/types';
import { Meter, Tooltip } from '@/shared/ui';
import { cn } from '@/shared/utils';

/** The week in two letters: the rail's label for a ring with no countdown, and the first word of a row ring's caption. */
const SHORT_NAME = 'wk';

/** The week's window key, which a ring carries as `data-usage-ring`: the handle every probe and doc finds a ring by. */
const RING_HANDLE = 'seven_day';

/** Said when the week has no figure to draw: the ring keeps its place and shows its track alone. */
const NO_READING_WORDS = 'No reading yet';

type UsageRingProps = {
  /** The week as the panel's meters draw it, or null when there is none (no reading, or the window is absent). */
  usageWindow: ClaudeUsageWindow | null;
  /** The caller's minute tick, epoch milliseconds: the clock the countdown counts down by. */
  now: number;
  /** The reading is the last one the provider gave, not a current one: the ring dims as the panel's bars do. */
  degraded?: boolean;
  /**
   * The account rows' form. A row has room under its ring and a phone has no hover, so the window's name and its
   * countdown are written under the ring ("wk · 3d") and the middle holds the figure ("92", "—" for no reading) — the
   * one visible mark that tells a week at 0% from a week nobody measured. The rail has no room for a caption, so
   * its middle holds the countdown and its window is told by its place and its hover words.
   */
  captioned?: boolean;
  /**
   * Whose week this is, for a home that draws several accounts' rings (the account rows): it opens the ring's
   * accessible name ("sdjesus89: This week. …"), so a reader moving from meter to meter hears whose week it is. The
   * rail draws the one account in use and passes none.
   */
  owner?: string;
};

/**
 * The week as a ring: fill = percent used, colour = `ringTone`'s band, the countdown to its reset, and the full
 * words ("This week. 65% used. Resets Friday 01:00 PM · about 3 days left") as its accessible name and its hover. Used by
 * the accounts module's UsageRings (the rail's ring) and ClaudeAccountRowViews (each account row's ring), so the
 * rail and the rows draw one ring, one band rule and one countdown.
 *
 * A status, not a control: no button, no tab stop. A row ring stands outside the row's Use button on purpose — a long
 * press on it is a phone's way to read its words, and must never switch the account.
 */
export function UsageRing({ usageWindow, now, degraded = false, captioned = false, owner }: UsageRingProps) {
  const percent = usageWindow === null ? null : windowPercent(usageWindow);
  const tone = ringTone(percent);

  // Name, figure, reset — the lines the meters say, from the same helpers. The week's own reset time is dropped when
  // it carries no figure: a countdown to a week nobody measured would be the only number in a "no reading" tooltip.
  const words: string[] = [WINDOW_NAMES.seven_day];
  if (percent === null) {
    words.push(NO_READING_WORDS);
  } else {
    words.push(windowValue(percent));
    const reset = resetsLine(usageWindow?.resetsAt ?? null);
    if (reset) words.push(reset);
  }

  // The countdown to the week's reset, dropped with the reset time for the same reason. A week past its reset
  // reaches here already carried (`windowPastReset`): it counts down to its next reset.
  const countdown = percent === null ? null : resetCountdown(usageWindow?.resetsAt ?? null, now);
  const label = captioned ? (percent === null ? '—' : String(percent)) : (countdown ?? SHORT_NAME);

  // `data-tone` is the whole colouring: the ring's arc takes `--tone-dot` from here (Verve README rule 4). A week with no
  // figure carries none, so the ring is its bare track. A degraded reading is old, so it dims exactly as the panel's bars do.
  const ring = (
    <div
      data-tone={tone ?? undefined}
      data-usage-ring={captioned ? undefined : RING_HANDLE}
      className={cn('grid size-8 place-items-center', degraded && 'opacity-60')}
    >
      <Meter
        variant="ring"
        percent={percent}
        label={label}
        ariaLabel={owner === undefined ? words.join('. ') : `${owner}: ${words.join('. ')}`}
        value={windowValue(percent)}
      />
    </div>
  );

  return (
    // The rail's words open beside the rail, over the page, on one line each. A row ring sits at the panel's right edge,
    // where a phone has no room to its right, so its words open to its left, over its own row — and wrap inside 11rem
    // (`max-w-44`): the popover is docked at the window's left edge, and on a 320px phone a bubble on one line (about
    // 290px) ran off the screen. `w-max` keeps the bubble its words' own width under that cap: the Tooltip sets its left
    // edge at the ring before shifting it left, and an auto width would shrink to the little room right of the ring, a
    // column of one word per line.
    <Tooltip
      position={captioned ? 'left' : 'right'}
      className={captioned ? 'w-max max-w-44 whitespace-normal' : undefined}
      content={words.map((line, index) => (
        <span key={line} className={index === 0 ? 'block font-semibold' : 'block'}>
          {line}
        </span>
      ))}
    >
      {captioned ? (
        // A fixed width, so a ring stands in the same column on every row whatever its caption says ("wk · 3d", "wk").
        <div data-usage-ring={RING_HANDLE} className="flex w-12 flex-col items-center">
          {ring}
          <span data-ring-caption className="whitespace-nowrap text-[10px] tabular-nums leading-none text-muted-foreground">
            {countdown === null ? SHORT_NAME : `${SHORT_NAME} · ${countdown}`}
          </span>
        </div>
      ) : ring}
    </Tooltip>
  );
}
