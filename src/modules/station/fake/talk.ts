import type { ComponentProps } from 'react';

import { HER_PICTURES } from '@/modules/station/fake/conversation';
import { StationTalkView } from '@/modules/station/StationTalk';
import type { CompanionPicture } from '@/shared/companion-types';
import type { TalkPress } from '@/shared/types';

/*
 * THE TALK CONTROL'S FIXTURES, for `station-fake.ts`'s pictures only: `StationTalkView` drawn from her picture in each of the
 * station's four (`fake/conversation.ts`'s `HER_PICTURES`), the page's press idle in each, and the bound control as her
 * settings name it: F8 in `home` and `walkthrough`, the mouse's back button in `waiting`, none in `empty` ("Bind a key in
 * Settings"). Nothing in the app imports this file.
 *
 * `TALK_STATES` are the press's states no picture shows, drawn over `home` in the slot's place: Listening (lit, "Stop and
 * send"), Transcribing (the spinner, "press to talk again"), a press that failed on the page (`refused`: the sentence the
 * press says when its clip could not be sent, in the binding's place) and no picture yet (`loading`: the box not ready).
 *
 * AT COMPACT DENSITY the control is drawn in halves (`part`), each with the probe's `density: 'compact'`: `TALK_COMPACT` is its
 * button alone in each picture, 44 px, as the compact head draws it; `TALK_COMPACT_STATES` its box alone over `home`, as the
 * Conversation section draws it, and the button alone in each of the press's states.
 */

/** A press a picture never makes: the shots photograph, they do not press. */
const NO_PRESS = () => {};
/** A send a picture never makes. */
const NO_SEND = () => Promise.resolve();

/** The halves a drawing holds: both, as her column's foot draws them, unless compact draws one. */
type Part = ComponentProps<typeof StationTalkView>['part'];

/** The talk control drawn from `her` (null: no picture yet), the page's press idle unless `press` says otherwise. */
function drawing(her: CompanionPicture | null, press: Partial<TalkPress> = {}, part: Part = 'both') {
  return {
    view: StationTalkView,
    props: {
      part,
      talk: { state: 'idle', toggle: NO_PRESS, error: null, ...press },
      name: her?.settings.name ?? 'Kaylee',
      bindingLabel: her?.settings.talkBinding?.label ?? null,
      onSend: NO_SEND,
      ready: her !== null,
    } satisfies Omit<ComponentProps<typeof StationTalkView>, 'density'>,
  };
}

/** The talk control in each of the four pictures. */
export const TALK_FAKE = {
  home: drawing(HER_PICTURES.home),
  waiting: drawing(HER_PICTURES.waiting),
  walkthrough: drawing(HER_PICTURES.walkthrough),
  empty: drawing(HER_PICTURES.empty),
};

/** The press's states no picture shows, each drawn by the shots probe over the `home` picture. */
export const TALK_STATES = {
  listening: drawing(HER_PICTURES.home, { state: 'listening' }),
  transcribing: drawing(HER_PICTURES.home, { state: 'transcribing' }),
  refused: drawing(HER_PICTURES.home, { error: 'Your recording could not be sent.' }),
  loading: drawing(null),
};

/** The talk control's button alone in each picture, as the compact head draws it (the probe hands `density: 'compact'`). */
export const TALK_COMPACT = {
  home: drawing(HER_PICTURES.home, {}, 'button'),
  waiting: drawing(HER_PICTURES.waiting, {}, 'button'),
  walkthrough: drawing(HER_PICTURES.walkthrough, {}, 'button'),
  empty: drawing(HER_PICTURES.empty, {}, 'button'),
};

/** At compact density over `home`: the box alone (the Conversation section's half), and the button alone in each of the press's states. */
export const TALK_COMPACT_STATES = {
  composer: drawing(HER_PICTURES.home, {}, 'composer'),
  listening: drawing(HER_PICTURES.home, { state: 'listening' }, 'button'),
  transcribing: drawing(HER_PICTURES.home, { state: 'transcribing' }, 'button'),
  refused: drawing(HER_PICTURES.home, { error: 'Your recording could not be sent.' }, 'button'),
  loading: drawing(null, {}, 'button'),
};
