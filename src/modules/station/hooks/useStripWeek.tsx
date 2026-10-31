import { cloneElement, isValidElement, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import type { StationDensity } from '@/shared/types';
import { isDrawn } from '@/shared/utils';

/**
 * What the arrangement asks of the strip's region: its density, the week it opens and shuts (`SinceYouLastLooked`'s `week`), and
 * for the line, its count form (`countOnly`: the phone on its side, where the line stands at the top row's end).
 */
type StripLook = { density?: StationDensity; week: { open: boolean; onOpen: (open: boolean) => void }; countOnly?: boolean };

/** The strip's region as the arrangement draws it: its own element, handed what the arrangement asks of it (as the sections do their regions). */
function stripAs(node: ReactNode, look: StripLook): ReactNode {
  return isValidElement<StripLook>(node) ? cloneElement(node, look) : null;
}

/** The strip as a one-column arrangement draws it: its folded line, and its whole week while he holds it open (null while shut). */
type StripWeek = { line: ReactNode; week: ReactNode };

/**
 * THE STRIP'S WEEK in a one-column arrangement, compact's and the phone's: the strip's region drawn twice from the shell's `strip`
 * slot, its folded line (`line`) and, while he holds it open, its whole week (`week`, the region at full density: its timeline),
 * which the arrangement lays over its body. Consumed by both arrangements' wrappers, which draw the two where their views ask.
 *
 * - OPENED by the line's fold and SHUT by the week's own fold or a landing he puts on the stage: both ends reach the region by its
 *   `week` input, whatever the columns' `stripCollapsed` says, and neither writes that pref. Not remembered: a reload starts with
 *   the line.
 * - THE FOCUS FOLLOWS THE PRESS when the press lost it. Opening makes the line inert under the week (compact lays the week over
 *   it), and shutting removes the week: either way the press that did it had the focus on a control now gone from the tab order,
 *   and the browser drops the focus to the page. So the focus goes to the other fold (`data-strip-fold`), but only when it was
 *   lost: a focus he has already put elsewhere is his.
 *
 * `countOnly` draws the line in the strip's count form ("<n> new" or "Nothing new" and its fold: the phone on its side); the week
 * is always the whole timeline. A strip slot with nothing in it draws neither.
 */
export function useStripWeek(strip: ReactNode, { countOnly = false }: { countOnly?: boolean } = {}): StripWeek {
  // Whether he holds the strip's whole week open over the body. State: the arrangement draws the week from it.
  const [weekOpen, setWeekOpen] = useState(false);
  // The boxes the line and the week stand in, which the focus is handed between. Refs: only the effect below looks inside them.
  const lineBox = useRef<HTMLDivElement>(null);
  const weekBox = useRef<HTMLDivElement>(null);
  // Whether the week was open at the effect's last run, so it acts on a change of it and never on the mount or an unrelated render.
  const weekWas = useRef(false);

  useLayoutEffect(() => {
    if (weekWas.current === weekOpen) return;
    weekWas.current = weekOpen;
    const held = document.activeElement;
    const lost = held === null || held === document.body || (weekOpen && lineBox.current?.contains(held) === true);
    if (lost) (weekOpen ? weekBox : lineBox).current?.querySelector<HTMLElement>('[data-strip-fold]')?.focus();
  }, [weekOpen]);

  if (!isDrawn(strip)) return { line: null, week: null };
  return {
    line: <div ref={lineBox} className="contents">{stripAs(strip, { week: { open: weekOpen, onOpen: setWeekOpen }, countOnly })}</div>,
    // The week is the strip's region drawn at full density, its timeline, and open: the fold in it shuts it.
    week: weekOpen ? <div ref={weekBox} className="contents">{stripAs(strip, { density: 'full', week: { open: true, onOpen: setWeekOpen } })}</div> : null,
  };
}
