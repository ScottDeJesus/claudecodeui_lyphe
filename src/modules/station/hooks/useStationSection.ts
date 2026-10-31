import { useLayoutEffect, useRef } from 'react';

import { useStation, useStationPref } from '@/modules/station/context/StationContext';
import { focusKey } from '@/modules/station/stationMemory';
import type { StationCompactSection } from '@/shared/types';

/** Where the one column opens on a device that has never chosen, and where it falls back when the stage empties with nothing held aside. */
const HOME_SECTION: StationCompactSection = 'conversation';

/**
 * The one-column station's section and the stage's pull on it. Consumed by compact's arrangement and the phone's.
 *
 * `offersEmptyStage` is the arrangement's own answer to "is Stage a section with nothing on it?". Compact offers Stage only while
 * a thing stands there, so by default a `stage` with no focus is released. The phone's bar always draws Stage (the talk control
 * keeps the center), so its press on an empty stage is his to rest on: the stage's own words ("Nothing on the stage") show.
 *
 * THE SECTION is the station pref `compactSection`, per device: his switch writes it, and it comes back across a reload.
 *
 * THE STAGE'S PULL is the rule that a thing put on the stage is a thing he must see, wherever he was looking. It selects `stage`
 * when the focus changes to a different thing, whoever put it there (his press on a row or a need, her card, her open, a landing in
 * the strip), and when a press is made on the thing that already stands (the context counts it, `restaged`: a focus that did not
 * change cannot say so, and the row is drawn as what is on the stage while the stage is out of view). The section he was in is held
 * aside (the pref `compactSectionAside`, so it outlives a remount: the window dragged across 1024 px and back, his switch flipped,
 * a reload); clearing the stage returns him to it. Back is a change to a different thing too, so it keeps `stage`.
 *
 * What it reads is the focus's CHANGE and the presses made after the hook mounted: a focus already standing as the column opens (a
 * reload, a window that grew narrow) is the section's own business and pulls nothing. A stored `stage` with no focus (the stage
 * emptied in another window) is released the same way, so the switch never rests on a section it does not offer, unless the
 * arrangement offers the empty stage: then only a stage that was emptied under him (its ✕, Back's end) sends him back, and a
 * stage he asked for while it was empty stays.
 *
 * THE KEYBOARD GOES WITH THE PULL. The section he pulled from is hidden and inert, and a focus left in it falls to `<body>`, where a
 * screen reader stands on nothing. So when the pull finds the focus in a section that is now inert, the focus goes to the stage's
 * heading (`data-station-stage-label`, which takes a programmatic focus and no Tab stop): the stage is what he asked for. A control
 * the rail's press then lands the keyboard on (`useLandOnStageControl`) takes it from the heading after; a focus that stood outside
 * the sections (her head, the strip) is not moved.
 *
 * It follows the focus's change and the press count and nothing else: no timer, no poll. LAYOUT effects, so the pull lands before
 * the paint of the render that brought the focus, and the column never shows the old section for a frame.
 */
export function useStationSection({ offersEmptyStage = false } = {}): [StationCompactSection, (next: StationCompactSection) => void] {
  const { focus, restaged } = useStation();
  const [section, setSection] = useStationPref<StationCompactSection>('compactSection', HOME_SECTION);
  const [aside, setAside] = useStationPref<StationCompactSection | null>('compactSectionAside', null);
  const standing = focus === null ? null : focusKey(focus);

  // The thing on the stage and the press count as the section last answered them. Refs: the effect compares against them to tell a
  // different thing, or a new press, from a re-run of the same render, and nothing is drawn from them. They start as the focus and
  // the count the column opens on, so those pull nothing.
  const answered = useRef(standing);
  const answeredPresses = useRef(restaged);
  // Whether the keyboard is owed to the stage: set by a pull, spent by the effect below once `stage` is the section drawn (the pull's
  // own state change lands a render after the effect that decides it).
  const keyboardOwed = useRef(false);

  useLayoutEffect(() => {
    const arrived = standing !== null && standing !== answered.current;
    const pressed = standing !== null && restaged !== answeredPresses.current;
    // A thing stood on the stage and is gone: the stage emptied under him, as against a stage he asked for while it was empty.
    const emptied = standing === null && answered.current !== null;
    answered.current = standing;
    answeredPresses.current = restaged;
    if (arrived || pressed) {
      // Already on the stage (a press on the stage itself, Back): the section held aside is still the one he came from.
      if (section !== 'stage') {
        keyboardOwed.current = true;
        setAside(section);
        setSection('stage');
      }
      return;
    }
    if (standing !== null) return;
    if (section === 'stage' && (emptied || !offersEmptyStage)) setSection(aside ?? HOME_SECTION);
    if (aside !== null) setAside(null);
  }, [standing, restaged, section, aside, offersEmptyStage, setSection, setAside]);

  useLayoutEffect(() => {
    if (section !== 'stage' || !keyboardOwed.current) return;
    keyboardOwed.current = false;
    // Inert is what the section he left is by now, and the focus fixup that drops its focus on `<body>` runs after this commit. A
    // focus already on `<body>` was nowhere to begin with, and an arrival nobody pressed does not take it.
    const stranded = document.activeElement?.closest('[inert]') != null;
    if (stranded) document.querySelector<HTMLElement>('[data-station-section="stage"] [data-station-stage-label]')?.focus();
  }, [section]);

  return [section, setSection];
}
