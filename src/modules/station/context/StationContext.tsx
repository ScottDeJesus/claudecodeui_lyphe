import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { Dispatch, ReactNode, SetStateAction } from 'react';

import { useStationWindow } from '@/modules/station/hooks/useStationWindow';
import { FOLLOWS_END, followScroll } from '@/modules/station/stationScroll';
import {
  BACK_STACK_DEPTH,
  backableFrom,
  focusKey,
  readStationRecord,
  writeStationRecord,
} from '@/modules/station/stationMemory';
import type { StationRecord } from '@/modules/station/stationMemory';
import type { StationFocus } from '@/shared/station-types';
import type { StationPrefKey, StationRegion, StationTier } from '@/shared/types';

/** The stage: the one focus on it and the focuses Back returns through, newest last. */
type StageState = { focus: StationFocus | null; stack: StationFocus[] };

type StationContextValue = {
  /** The one thing on the stage, or null for an empty stage. */
  focus: StationFocus | null;
  /**
   * Puts `next` on the stage; the focus it replaces is pushed onto the back-stack (ten deep). Pressing what is already there
   * changes nothing. `null` (the stage's ✕) empties the stage and leaves what was there on the stack: the empty stage draws no
   * Back, so it is the Back of the next, different thing staged. Staging that same thing again takes it off the stack, so a
   * Back never returns to what is already on the stage.
   */
  setFocus: (next: StationFocus | null) => void;
  /**
   * How many times `setFocus` has been handed the thing that already stands on the stage (it changes nothing there). A press on
   * what is already staged still asks to be shown it, and a focus that did not change cannot say so: the one-column station
   * reads this count to select its Stage section (`useStationSection`). Counts calls, never time; a caller that only keeps the
   * stage current (her walk moving while it stands) does not call `setFocus` with what stands, so it never counts.
   */
  restaged: number;
  /** Puts the most recent replaced focus back on the stage and pops it. Nothing when the back-stack is empty. */
  back: () => void;
  /** Whether Back has a focus to return to. */
  canGoBack: boolean;
  /** The window's arrangement: wide (≥ 1360 px), laptop (1024–1359 px) or narrow (below), read on `resize`. */
  tier: StationTier;
  /** True in a window under 768 px wide, or a touch window under 500 px tall (a phone on its side). */
  phone: boolean;
  /** True in a touch window under 500 px tall: the phone on its side, whose rows are the slimmer ones. Always inside `phone`. */
  sideways: boolean;
  /**
   * A region's scroll memory, as a ref callback for its scroller: the stored `scrollTop` is put back as the node mounts and
   * each newer one is remembered from its `scroll` events, except a place at the end of a scroller that follows its own end (the
   * conversation's log: `FOLLOWS_END`), which is no place, so a log that grew while he was away still opens at its newest line.
   * The same callback comes back for the same region.
   */
  scrollMemory: (region: StationRegion) => (node: HTMLElement | null) => void;
};

/** The regions' preferences, which `useStationPref` reads and writes. Its own context: a preference changing never re-draws what only reads the focus. */
type StationPrefs = {
  prefs: Partial<Record<StationPrefKey, unknown>>;
  setPref: (key: StationPrefKey, value: unknown) => void;
};

/** What he has typed to her at the talk control, and its setter. Its own context, as the prefs are: a keystroke re-draws the box and never what only reads the focus. */
type StationTalkText = { text: string; setText: Dispatch<SetStateAction<string>> };

const StationContext = createContext<StationContextValue | null>(null);
const StationPrefsContext = createContext<StationPrefs | null>(null);
const StationTalkTextContext = createContext<StationTalkText | null>(null);

/**
 * The station's context: the focus and its back-stack, the tier and whether the window is a phone's (and on its side), the scroll memory.
 * Used by the station's shell, bar, stage and regions, and by the doors they press. Throws outside `StationProvider`, so
 * a consumer placed wrong fails at once.
 */
export function useStation(): StationContextValue {
  const context = useContext(StationContext);
  if (!context) throw new Error('useStation must be used within a StationProvider');
  return context;
}

/**
 * One region's remembered preference: the stored value, else `initial`, and the setter that stores a new one on this device. The
 * seven keys (`StationPrefKey`) and their readers: `stripCollapsed` (`SinceYouLastLooked`), `cornerOpen` (`MemoryCorner`), `compact` (the
 * shell's switch, and `CheckStage`, which places its sheet by the arrangement), `asleepOpen` and `completeOpen` (`WhereThingsStand`),
 * `compactSection` and `compactSectionAside` (`useStationSection`).
 */
export function useStationPref<T>(key: StationPrefKey, initial: T): [T, (next: T) => void] {
  const context = useContext(StationPrefsContext);
  if (!context) throw new Error('useStationPref must be used within a StationProvider');
  const { prefs, setPref } = context;
  // A stored value is whatever the region wrote under its own key, so it is read back as the type that region asked for.
  const stored = prefs[key] as T | undefined;
  const set = useCallback((next: T) => setPref(key, next), [key, setPref]);
  return [stored === undefined ? initial : stored, set];
}

/**
 * The words he has typed to her in the talk control's box, and the setter that changes them: held by the station, not by the box,
 * so they are still there after the Compact switch has mounted another arrangement's tree. Used by this module's `StationTalk`,
 * which hands them to the composer. Throws outside `StationProvider`.
 */
export function useStationTalkText(): [string, Dispatch<SetStateAction<string>>] {
  const context = useContext(StationTalkTextContext);
  if (!context) throw new Error('useStationTalkText must be used within a StationProvider');
  return [context.text, context.setText];
}

/**
 * THE STATION'S PROVIDER, mounted by `StationRoute` above her provider, whose `onOpen` is a press on this stage.
 *
 * THE FOCUS lives here, beside the back-stack it is pushed onto: a station has one thing on its stage, and every region
 * that can put a thing there (a press on a session, a need, a card) reaches the stage through `setFocus`.
 *
 * THE MEMORY is one record per device under `kaylee-station`: the focus and the back-stack, each registered region's scroll
 * and the regions' preferences. It is read once as the station mounts, so a reload puts the stage back as it was, and it is
 * written when the focus or a preference changes and when the page is hidden or leaves (`pagehide`,
 * `visibilitychange` → hidden), which is where the scroll is carried. No timer writes it.
 *
 * HIS TYPED WORDS to her (`useStationTalkText`) live here too, in memory only: each arrangement mounts its own tree, so the box's own
 * state would be lost to the Compact switch. They are not in the record, so a reload starts with an empty box.
 */
export function StationProvider({ children }: { children: ReactNode }) {
  const { tier, phone, sideways } = useStationWindow();
  // The record this device held as the station mounted: the starting point of the three pieces of state below, read once.
  const [initial] = useState<StationRecord>(readStationRecord);
  // The stage as React draws it. State, so a focus change re-draws the stage and every region that reads it; mirrored by
  // `stageRef` so two presses inside one event still see each other.
  const [stage, setStage] = useState<StageState>({ focus: initial.focus, stack: initial.stack });
  // The regions' preferences. State, because a region draws from its preference and a change must re-draw it.
  const [prefs, setPrefs] = useState<StationRecord['prefs']>(initial.prefs);
  // How many presses have been made on what already stood on the stage. State, because the one-column station's section must
  // answer each press; the stage itself does not change, so nothing else would re-draw it.
  const [restaged, setRestaged] = useState(0);
  // What he has typed in the talk control's box. State, because it must outlive an arrangement's tree: the Compact switch unmounts
  // the box one arrangement drew and mounts the other's, which would start empty from a box's own state. Memory only: a reload starts empty.
  const [talkText, setTalkText] = useState('');

  // The stage as the last press left it: the truth `setFocus` and `back` decide from, so they never decide from a render
  // that predates the previous press.
  const stageRef = useRef(stage);
  // The newest scroll of each region, written by the scroll listeners and carried into the record. A ref: scrolling is
  // too frequent to render from and nothing is drawn from it.
  const scrollRef = useRef<StationRecord['scroll']>(initial.scroll);
  // One ref callback per region, so a region's callback keeps its identity across renders and React does not detach and
  // re-attach its scroller on each one.
  const binders = useRef(new Map<StationRegion, (node: HTMLElement | null) => void>());
  // What the page-hide listeners write: the record as of the last change, with the scroll read fresh at write time.
  const latest = useRef<Pick<StationRecord, 'focus' | 'stack' | 'prefs'>>({ focus: stage.focus, stack: stage.stack, prefs });

  const commit = useCallback((next: StageState) => {
    stageRef.current = next;
    // A different thing starts at the top: the stage's remembered place was the previous one's.
    delete scrollRef.current.stage;
    setStage(next);
  }, []);

  const setFocus = useCallback((next: StationFocus | null) => {
    const held = stageRef.current;
    const same = next === null ? held.focus === null : held.focus !== null && focusKey(held.focus) === focusKey(next);
    if (same) {
      if (next !== null) setRestaged((count) => count + 1);
      return;
    }
    const pushed = held.focus === null ? held.stack : [...held.stack, held.focus].slice(-BACK_STACK_DEPTH);
    commit({ focus: next, stack: backableFrom(pushed, next) });
  }, [commit]);

  const back = useCallback(() => {
    const { stack } = stageRef.current;
    if (stack.length === 0) return;
    const returned = stack[stack.length - 1];
    commit({ focus: returned, stack: backableFrom(stack.slice(0, -1), returned) });
  }, [commit]);

  const setPref = useCallback((key: StationPrefKey, value: unknown) => {
    setPrefs((held) => (Object.is(held[key], value) ? held : { ...held, [key]: value }));
  }, []);

  const scrollMemory = useCallback((region: StationRegion) => {
    const held = binders.current.get(region);
    if (held !== undefined) return held;
    let release: (() => void) | null = null;
    const bind = (node: HTMLElement | null) => {
      release?.();
      release = node === null ? null : followScroll(node, scrollRef.current[region] ?? 0, (top) => {
        if (top === null) delete scrollRef.current[region];
        else scrollRef.current[region] = top;
      }, FOLLOWS_END.has(region));
    };
    binders.current.set(region, bind);
    return bind;
  }, []);

  // The record is written when the focus or a preference changes.
  useEffect(() => {
    latest.current = { focus: stage.focus, stack: stage.stack, prefs };
    writeStationRecord({ ...latest.current, scroll: scrollRef.current });
  }, [stage, prefs]);

  // And when the page is hidden or leaves, which is when the scroll the listeners have kept is carried into it. The station
  // is also left by the app's own router (a phone's and the home-screen app's doors navigate in the same window, so no
  // `pagehide` comes): the provider's unmount writes it too.
  useEffect(() => {
    const write = () => writeStationRecord({ ...latest.current, scroll: scrollRef.current });
    const writeWhenHidden = () => { if (document.visibilityState === 'hidden') write(); };
    window.addEventListener('pagehide', write);
    document.addEventListener('visibilitychange', writeWhenHidden);
    return () => {
      window.removeEventListener('pagehide', write);
      document.removeEventListener('visibilitychange', writeWhenHidden);
      write();
    };
  }, []);

  const value = useMemo<StationContextValue>(
    () => ({ focus: stage.focus, setFocus, restaged, back, canGoBack: stage.stack.length > 0, tier, phone, sideways, scrollMemory }),
    [stage, setFocus, restaged, back, tier, phone, sideways, scrollMemory],
  );
  const prefsValue = useMemo<StationPrefs>(() => ({ prefs, setPref }), [prefs, setPref]);
  const talkTextValue = useMemo<StationTalkText>(() => ({ text: talkText, setText: setTalkText }), [talkText]);

  return (
    <StationContext.Provider value={value}>
      <StationPrefsContext.Provider value={prefsValue}>
        <StationTalkTextContext.Provider value={talkTextValue}>{children}</StationTalkTextContext.Provider>
      </StationPrefsContext.Provider>
    </StationContext.Provider>
  );
}
