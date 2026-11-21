import { useContext, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { createStableContext } from '@/shared/context/stableContext';
import type { HeadBackClaim } from '@/shared/types';

/** A claim as the provider holds it: the claiming page's own number, and what it claims. */
type HeldClaim = { id: number; claim: HeadBackClaim };

/** What a claim and a head do to the provider: claim and let go, and count a head that reads the claims. */
type HeadBackActions = {
  claim: (id: number, claim: HeadBackClaim) => void;
  release: (id: number) => void;
  /** A head reading the claims; returns the call that stops it reading. */
  read: () => () => void;
};

/** What the heads draw and the claimers ask: the newest claim, and how many heads are on screen to draw it. */
type HeadBackState = { top: HeldClaim | null; readers: number };

/** Where a subtree stands among the levels of its screen: whether it is shown, and the names of the levels round it, outermost first. */
type HeadLevelValue = { shown: boolean; names: string[] };

const HeadBackActionsContext = createStableContext<HeadBackActions | null>(import.meta.hot, 'HeadBackActionsContext', null);
const HeadBackStateContext = createStableContext<HeadBackState>(import.meta.hot, 'HeadBackStateContext', { top: null, readers: 0 });
const HeadLevelContext = createStableContext<HeadLevelValue>(import.meta.hot, 'HeadLevelContext', { shown: true, names: [] });

/** Each claiming page's own number, so a claim it makes again replaces its own and never another's. */
let nextClaimId = 1;

/**
 * ONE WAY BACK PER SCREEN. A page inside a screen (a carrier's pages, a bulletin's page, a tour, a panorama) does not draw a back
 * of its own under the screen's head: it claims the head's (`useClaimHeadBack`), and while it stands the head's back arrow steps up
 * to where it says and the head names it. The newest claim is the one drawn; a page that goes lets its claim go with it.
 *
 * Rendered by project-workspace's `ProjectWorkspaceShell` round every page; read by its `ScreenHead`.
 */
export function HeadBackProvider({ children }: { children: ReactNode }) {
  // Every claim standing now, the newest last: the head draws the last, and the one under it comes back when it goes.
  const [claims, setClaims] = useState<HeldClaim[]>([]);
  // How many heads are on screen to draw a claim: none, and a claiming page keeps its own way back.
  const [readers, setReaders] = useState(0);
  const actions = useMemo<HeadBackActions>(() => ({
    claim: (id, claim) => setClaims((now) => [...now.filter((each) => each.id !== id), { id, claim }]),
    release: (id) => setClaims((now) => now.filter((each) => each.id !== id)),
    read: () => {
      setReaders((count) => count + 1);
      return () => setReaders((count) => count - 1);
    },
  }), []);
  const state = useMemo<HeadBackState>(() => ({ top: claims.at(-1) ?? null, readers }), [claims, readers]);
  return (
    <HeadBackActionsContext.Provider value={actions}>
      <HeadBackStateContext.Provider value={state}>{children}</HeadBackStateContext.Provider>
    </HeadBackActionsContext.Provider>
  );
}

/**
 * A level of a screen, round the pages inside it: whether it is shown now (a page in a level that is kept mounted but hidden claims
 * nothing), and its name, which the head's eyebrow says after the screen's ("Cerberus · Bulletins"). Levels nest; a hidden level
 * hides what is inside it.
 *
 * Used by the cerberus module's `KeptView`, round each view the tab keeps mounted (Tours, Bulletins, Uploads, Scheduling).
 */
export function HeadLevel({ shown, name, children }: { shown: boolean; name: string | null; children: ReactNode }) {
  const outer = useContext(HeadLevelContext);
  const value = useMemo<HeadLevelValue>(
    () => ({ shown: outer.shown && shown, names: name === null ? outer.names : [...outer.names, name] }),
    [outer, shown, name],
  );
  return <HeadLevelContext.Provider value={value}>{children}</HeadLevelContext.Provider>;
}

/**
 * The claim a screen's head draws: its back arrow's name, where it goes, and the title and levels it says; null while no page inside
 * the screen claims it. A head that reads it counts as on screen, so a claiming page knows to leave its own way back out.
 *
 * Used by project-workspace's `ScreenHead`.
 */
export function useHeadBack(): HeadBackClaim | null {
  const actions = useContext(HeadBackActionsContext);
  const { top } = useContext(HeadBackStateContext);
  useLayoutEffect(() => actions?.read(), [actions]);
  return top?.claim ?? null;
}

/**
 * Claims the screen's head's way back for a page inside the screen while it stands (`claim` null: no claim), with the levels round it
 * prefixed to its `within`. Returns whether a head draws it now: when it does, the page draws neither its own back nor its own title;
 * when no head is there (a page drawn on its own), it draws both, as it always did.
 *
 * Used by the carrier-bulletins module's `CarrierPages` and `PageScreen` and the affected-areas module's `TourScreen` and `PanoScreen`.
 */
export function useClaimHeadBack(claim: HeadBackClaim | null): boolean {
  const actions = useContext(HeadBackActionsContext);
  const { top, readers } = useContext(HeadBackStateContext);
  const level = useContext(HeadLevelContext);
  // This page's own number for as long as it is mounted.
  const [id] = useState(() => nextClaimId++);
  // The newest way back, read when the arrow is pressed: a page's handler changes every render, and a claim made again for it would
  // move the page's claim to the top of the stack.
  const onBackRef = useRef(claim?.onBack);
  useLayoutEffect(() => {
    onBackRef.current = claim?.onBack;
  });
  const label = claim?.label;
  const title = claim?.title;
  // The levels as one string, so a claim is made again only when what it says changes.
  const within = [...level.names, ...(claim?.within ?? [])].join('\u0000');
  const active = claim !== null && level.shown && actions !== null;
  useLayoutEffect(() => {
    if (!active || actions === null || label === undefined) return undefined;
    actions.claim(id, { label, title, within: within === '' ? [] : within.split('\u0000'), onBack: () => onBackRef.current?.() });
    return () => actions.release(id);
  }, [active, actions, id, label, title, within]);
  return active && readers > 0 && top?.id === id;
}
