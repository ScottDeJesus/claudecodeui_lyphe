import type { ComponentProps, ComponentType } from 'react';

import { CardStageView } from '@/modules/station/CardStage';
import { SHIPPED_FEATURE, WAITING_FEATURE } from '@/modules/station/fake/stage';
import { FocusFallbackView } from '@/modules/station/FocusFallback';
import type { StationFocus } from '@/shared/station-types';
import type { StationSlot } from '@/shared/types';

/*
 * FAKE STATION PICTURES, for the prototype only: the station's own views drawn on fixture data, so every state of
 * the screen can be mounted and photographed beside the live one. Nothing in the app imports this file (as nothing
 * imports `companion-fake.ts`); `.verify/kaylee-station-shots.mjs` does.
 *
 * FOUR PICTURES: `home` (a shipped feature on the stage, in the roadmap's facts), `waiting` (a feature whose Accept
 * stands open on its plan card), `walkthrough` (her walk on the stage, drawn by the fallback until the cards plan
 * draws it) and `empty` (nothing on the stage, and every region in its own empty state). A picture is a data
 * condition, never a mode: the live station is in the `waiting` picture when what the house holds says so.
 *
 * A DRAWING IS `{ view, props }`: a region's VIEW component and the props it draws one picture with. The shots probe
 * draws a slot as `createElement(view, { ...props, tier })`, and the stage as `StationStageView` holding
 * `FAKE_STAGE`'s drawing, so it draws any region without knowing it.
 *
 * EACH REGION ADDS ITS OWN SLICES, in a file of its own, `fake/<slot>.ts`, exporting `<SLOT>_FAKE`: one drawing per
 * picture (null where the region draws nothing in it), each drawing's props `satisfies Omit<ComponentProps<typeof
 * TheView>, 'tier'>`. The region's one line goes in `REGION_FAKES` below. The stage's own data is `fake/stage.ts`.
 */

/** The four named pictures. */
type StationPicture = 'home' | 'waiting' | 'walkthrough' | 'empty';

/** One drawing: a VIEW component and the props it draws one picture with. */
type StationDrawing = { view: ComponentType<any>; props: Record<string, unknown> };

/** One picture of the station: the focus on its stage, and each filled slot's drawing (`{ view, props }`). */
export type StationFixture = { focus: StationFocus | null; slots: Partial<Record<StationSlot, unknown>> };

/** The stage's drawing in one picture: the focus's view with its props, and whether the back-stack holds a focus. */
type StationStageDrawing = StationDrawing & { canGoBack: boolean };

/**
 * THE REGIONS' SLICES, one line per region (`<slot>: <SLOT>_FAKE`, from `fake/<slot>.ts`). Empty until the region
 * plans land theirs; a slot with no line draws nothing in any picture, as the live layout does.
 */
const REGION_FAKES: Partial<Record<StationSlot, Record<StationPicture, StationDrawing | null>>> = {};

/** `home`: a shipped feature he pressed on the roadmap, which the dispatcher no longer holds. */
const HOME_FOCUS: Extract<StationFocus, { kind: 'card' }> = { kind: 'card', plan: SHIPPED_FEATURE.name, label: SHIPPED_FEATURE.title };
/** `waiting`: the feature whose Accept he pressed on the right rail. */
const WAITING_FOCUS: Extract<StationFocus, { kind: 'card' }> = {
  kind: 'card', plan: WAITING_FEATURE.name, label: 'What needs you: the right rail and the waiting-on-you state',
};
/** `walkthrough`: her walk of the Kanban lane review, which she put on the stage. */
const WALK_FOCUS: Extract<StationFocus, { kind: 'walk' }> = { kind: 'walk', label: 'Kanban lane review' };

/** A press a picture never makes: the shots photograph, they do not press. */
const NO_PRESS = () => {};

/** The stage's drawing per picture: nothing for `empty`, whose stage draws its own empty state. */
export const FAKE_STAGE: Record<StationPicture, StationStageDrawing | null> = {
  home: {
    view: CardStageView,
    props: {
      focus: HOME_FOCUS,
      found: { kind: 'feature', feature: SHIPPED_FEATURE, picture: null, cases: null },
      onPutAway: NO_PRESS,
      onWriteGoal: NO_PRESS,
      onSelectFeature: NO_PRESS,
    } satisfies ComponentProps<typeof CardStageView>,
    canGoBack: true,
  },
  waiting: {
    view: CardStageView,
    props: {
      focus: WAITING_FOCUS,
      found: { kind: 'plan', plan: WAITING_FEATURE, waitsOn: WAITING_FEATURE.waits_on },
      onPutAway: NO_PRESS,
      onWriteGoal: NO_PRESS,
      onSelectFeature: NO_PRESS,
    } satisfies ComponentProps<typeof CardStageView>,
    canGoBack: true,
  },
  walkthrough: {
    view: FocusFallbackView,
    props: { focus: WALK_FOCUS, gone: false, onOpen: NO_PRESS } satisfies ComponentProps<typeof FocusFallbackView>,
    canGoBack: false,
  },
  empty: null,
};

/** A picture's slots: each region's drawing for it, from the table; a region that draws nothing there is left out. */
function slotsOf(picture: StationPicture): StationFixture['slots'] {
  const slots: StationFixture['slots'] = {};
  for (const [slot, fake] of Object.entries(REGION_FAKES) as [StationSlot, Record<StationPicture, StationDrawing | null>][]) {
    const drawing = fake[picture];
    if (drawing !== null) slots[slot] = drawing;
  }
  return slots;
}

/** The four pictures: each one's focus, and its slots from the regions' slices. */
export const FAKE_STATION: Record<StationPicture, StationFixture> = {
  home: { focus: HOME_FOCUS, slots: slotsOf('home') },
  waiting: { focus: WAITING_FOCUS, slots: slotsOf('waiting') },
  walkthrough: { focus: WALK_FOCUS, slots: slotsOf('walkthrough') },
  empty: { focus: null, slots: slotsOf('empty') },
};
