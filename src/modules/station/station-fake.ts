import type { ComponentProps, ComponentType } from 'react';

import { ROADMAP_ALL_TOPIC } from '@/modules/live-bus';
import { CardStageView } from '@/modules/station/CardStage';
import { shelfFor, WALK_FOCUS, WALK_STAGE } from '@/modules/station/fake/cards';
import { CONVERSATION_FAKE, CONVERSATION_STATES } from '@/modules/station/fake/conversation';
import { CORNER_FAKE, CORNER_STATES } from '@/modules/station/fake/corner';
import { DOCK_FAKE, DOCK_STATES } from '@/modules/station/fake/dock';
import { HEAD_FAKE, HEAD_STATES } from '@/modules/station/fake/head';
import { NEEDS_FAKE, NEEDS_STATES } from '@/modules/station/fake/needs';
import { HOME_CHAT_STAGE, HOME_FOCUS, ROADMAP_PICTURES, SESSIONS_FAKE, SESSIONS_STATES } from '@/modules/station/fake/sessions';
import { WAITING_FEATURE } from '@/modules/station/fake/stage';
import { STRIP_FAKE, STRIP_STATES } from '@/modules/station/fake/strip';
import { TALK_FAKE, TALK_STATES } from '@/modules/station/fake/talk';
import type { StationFocus } from '@/shared/station-types';
import type { StationSlot } from '@/shared/types';

/*
 * FAKE STATION PICTURES, for the prototype only: the station's own views drawn on fixture data, so every state of
 * the screen can be mounted and photographed beside the live one. Nothing in the app imports this file (as nothing
 * imports `companion-fake.ts`); `.verify/kaylee-station-shots.mjs` does.
 *
 * FOUR PICTURES: `home` (the chat he pressed on the left rail, on the stage), `waiting` (a feature whose Accept
 * stands open on its plan card), `walkthrough` (her walk at item 4 of 15 on the stage) and `empty` (nothing on the
 * stage, and every region in its own empty state). A picture is a data condition, never a mode: the live station is
 * in the `waiting` picture when what the house holds says so. Each picture also says what the LIVE BUS holds in it
 * (`bus`), which the probe publishes before it draws.
 *
 * A DRAWING IS `{ view, props }`: a region's VIEW component and the props it draws one picture with. The shots probe
 * draws a slot as `createElement(view, { ...props, tier, density })`, and the stage as `StationStageView` holding
 * `FAKE_STAGE`'s drawing, so it draws any region without knowing it. The stage's drawing carries her cards' shelf
 * (`shelf`, from `fake/cards.ts`: a pinned list card and a diff in `home`, one plan card in `waiting`, none elsewhere),
 * which the probe draws above the stage's head.
 *
 * EACH REGION ADDS ITS OWN SLICES, in a file of its own, `fake/<slot>.ts`, exporting `<SLOT>_FAKE`: one drawing per
 * picture (null where the region draws nothing in it), each drawing's props `satisfies Omit<ComponentProps<typeof
 * TheView>, 'tier' | 'density'>`. The region's one line goes in `REGION_FAKES` below. The stage's own data is `fake/stage.ts`.
 * A picture at compact density is the same drawing handed `density: 'compact'` (`.verify/kaylee-station-density.mjs`); a
 * region drawn there in a form its pictures do not carry exports it beside them (the talk control's halves, `TALK_COMPACT`).
 *
 * A REGION'S STATES THAT NO PICTURE SHOWS (a fold opened, a read still out, a read that failed) are `<SLOT>_STATES` in the
 * same file, drawings by name, and its one line in `REGION_STATES`: the probe draws each over the `home` picture with that
 * slot's drawing in its place, so a region's every state is photographed without a fifth picture.
 */

/** The four named pictures. */
type StationPicture = 'home' | 'waiting' | 'walkthrough' | 'empty';

/** One drawing: a VIEW component and the props it draws one picture with. */
type StationDrawing = { view: ComponentType<any>; props: Record<string, unknown> };

/** What the live bus holds in a picture, topic by topic: the probe publishes each into its bus before the station draws. */
type StationBus = { topic: string; payload: unknown }[];

/** One picture of the station: the focus on its stage, each filled slot's drawing (`{ view, props }`), and its live bus. */
export type StationFixture = { focus: StationFocus | null; slots: Partial<Record<StationSlot, unknown>>; bus: StationBus };

/**
 * The stage's drawing in one picture: the focus's view with its props, whether the back-stack holds a focus, and her cards'
 * shelf over it (null where she has none).
 */
type StationStageDrawing = StationDrawing & { canGoBack: boolean; shelf: StationDrawing | null };

/**
 * THE REGIONS' SLICES, one line per region (`<slot>: <SLOT>_FAKE`, from `fake/<slot>.ts`), each added by its region's
 * plan; a slot with no line draws nothing in any picture, as the live layout does.
 */
const REGION_FAKES: Partial<Record<StationSlot, Record<StationPicture, StationDrawing | null>>> = {
  strip: STRIP_FAKE,
  corner: CORNER_FAKE,
  needs: NEEDS_FAKE,
  sessions: SESSIONS_FAKE,
  head: HEAD_FAKE,
  conversation: CONVERSATION_FAKE,
  talk: TALK_FAKE,
  dock: DOCK_FAKE,
};

/**
 * THE REGIONS' OWN STATES, one line per region (`<slot>: <SLOT>_STATES`, from `fake/<slot>.ts`): each a drawing of its slot
 * by the state's name, which `.verify/kaylee-station-shots.mjs` draws over the `home` picture in that slot's place.
 */
export const REGION_STATES: Partial<Record<StationSlot, Record<string, StationDrawing>>> = {
  strip: STRIP_STATES,
  corner: CORNER_STATES,
  needs: NEEDS_STATES,
  sessions: SESSIONS_STATES,
  head: HEAD_STATES,
  conversation: CONVERSATION_STATES,
  talk: TALK_STATES,
  dock: DOCK_STATES,
};

/* `home`'s focus is `fake/sessions.ts`'s `HOME_FOCUS`: the chat he pressed on the left rail. */
/** `waiting`: the feature whose Accept he pressed on the right rail. */
const WAITING_FOCUS: Extract<StationFocus, { kind: 'card' }> = {
  kind: 'card', plan: WAITING_FEATURE.name, label: 'What needs you: the right rail and the waiting-on-you state',
};
/* `walkthrough`'s focus is `fake/cards.ts`'s `WALK_FOCUS`: her walk of the Kanban lane review, which she put on the stage. */

/** A press a picture never makes: the shots photograph, they do not press. */
const NO_PRESS = () => {};

/** The stage's drawing per picture: nothing for `empty`, whose stage draws its own empty state. */
export const FAKE_STAGE: Record<StationPicture, StationStageDrawing | null> = {
  home: { ...HOME_CHAT_STAGE, shelf: shelfFor('home', HOME_FOCUS) },
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
    shelf: shelfFor('waiting', WAITING_FOCUS),
  },
  walkthrough: { ...WALK_STAGE, shelf: shelfFor('walkthrough', WALK_FOCUS) },
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

/**
 * A picture's live bus: the roadmap lane's picture holding the roadmap its left rail draws (`fake/sessions.ts`), so a hook a
 * region's view calls on the bus (the roadmap's step phrase, which names what a feature waits on) reads the picture's own data.
 */
const busOf = (picture: StationPicture): StationBus => [{ topic: ROADMAP_ALL_TOPIC, payload: ROADMAP_PICTURES[picture] }];

/** The four pictures: each one's focus, its slots from the regions' slices, and its live bus. */
export const FAKE_STATION: Record<StationPicture, StationFixture> = {
  home: { focus: HOME_FOCUS, slots: slotsOf('home'), bus: busOf('home') },
  waiting: { focus: WAITING_FOCUS, slots: slotsOf('waiting'), bus: busOf('waiting') },
  walkthrough: { focus: WALK_FOCUS, slots: slotsOf('walkthrough'), bus: busOf('walkthrough') },
  empty: { focus: null, slots: slotsOf('empty'), bus: busOf('empty') },
};
