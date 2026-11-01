import type { ComponentProps } from 'react';

import { CONVERSATION_STATES, HER_PICTURES, he, house, KANBAN, picture, she, WAITING_SPEAKING } from '@/modules/station/fake/conversation';
import { avatarOf, portraitHead, presenceOf } from '@/modules/station/fake/head';
import { StationPortraitView } from '@/modules/station/StationPortrait';
import type { CompanionPicture } from '@/shared/companion-types';
import type { CompanionPresence, CompanionSentenceRef } from '@/shared/types';

/*
 * HER PORTRAIT'S FIXTURES, for `station-fake.ts`'s pictures only: her column in the portrait view, her head (`fake/head.ts`'s
 * `portraitHead`: no face, the toggle reading "Show chat") and her portrait (`StationPortraitView`) drawn from one picture each.
 * Nothing in the app imports this file.
 *
 * A portrait is two slots at once, so `PORTRAIT_STATES` holds a drawing per slot (`head`, `conversation`) under the same name, and
 * `.verify/kaylee-station-shots.mjs` (`lib/station-portrait.mjs`) draws a name by putting both in their slots' places over `home`.
 * The names carry `portrait-`, so none meets a presence of her head's or a state of her conversation's.
 *
 * - `portrait-reply`: `home`'s picture at rest, her newest turn's one sentence under her face, Idle.
 * - `portrait-speaking`: `waiting`'s picture while she speaks the last of her read-back (marked), Speaking.
 * - `portrait-streaming`: `walkthrough`'s picture, her turn running, its two sentences and the dots at their end, Walking.
 * - `portrait-thinking`: he has just sent (`CONVERSATION_STATES.answering`'s picture): the dots alone where her words go, Thinking.
 * - `portrait-long`: an answer of nine sentences, longer than her words' pane, which scrolls inside itself and follows its end.
 * - `portrait-empty`: nothing said yet, her process asleep: the words that say what she is for.
 * - `portrait-broke`: his line, then her harness's line for the turn that broke, in the banner where her words would be.
 */

/** A picture, the presence her face and head draw it at, and the sentence her voice is sounding (none unless named). */
type PortraitSource = { her: CompanionPicture; presence: CompanionPresence; speaking?: CompanionSentenceRef };

/** An answer long enough to stand past her words' pane, the sentences of one turn. */
const LONG_LOG = [
  he(2, 'Walk me through everything that landed overnight, and what is still open.'),
  she(1, 'p1', 0, 'Overnight three things landed, and I\'ll take them in the order they shipped.'),
  she(1, 'p1', 1, 'First, the Safari lane-drag fix: the kanban module\'s drag hook had no guard for a pointer that leaves the lane mid-drag, so a card dropped on the lane\'s edge kept its old place on Safari alone.'),
  she(1, 'p1', 2, 'Second, the memory corner: it opens from the rail\'s foot, holds what I have kept about you, and lets you take any line back with one press.'),
  she(1, 'p1', 3, 'Third, the strip at the top that says what landed since you last looked, which now keeps its place across a reload.'),
  she(1, 'p1', 4, 'Still open: the Restorly uploads handoff is waiting on a permission to sync the build to the box.'),
  she(1, 'p1', 5, 'And one check on eis1 is red, Session is valid, because the shadow connector\'s token expired.'),
  she(1, 'p1', 6, 'If I were you I would answer the permission first, since the handoff is the only thing blocking another chat.'),
  she(1, 'p1', 7, 'The token can wait until after lunch; nothing reads it before the next pull.'),
  she(1, 'p1', 8, 'Tell me which you want opened and I will put it on your stage.'),
];

/** The sources, by name. */
const SOURCES = {
  'portrait-reply': { her: HER_PICTURES.home, presence: presenceOf('idle') },
  'portrait-speaking': { her: HER_PICTURES.waiting, presence: presenceOf('speaking'), speaking: WAITING_SPEAKING },
  'portrait-streaming': { her: HER_PICTURES.walkthrough, presence: presenceOf('walking', { session: KANBAN, walk: { at: 4, total: 15 } }) },
  'portrait-thinking': { her: CONVERSATION_STATES.answering.props.picture as CompanionPicture, presence: presenceOf('thinking') },
  'portrait-long': { her: picture({ log: LONG_LOG }), presence: presenceOf('idle') },
  'portrait-empty': { her: HER_PICTURES.empty, presence: presenceOf('asleep') },
  'portrait-broke': {
    her: picture({ log: [he(3, 'Open the roadmap card for kaylee eyes.'), house(2, 'system', 'Kaylee\'s turn broke: the Claude CLI exited with code 1.')] }),
    presence: presenceOf('idle'),
  },
} satisfies Record<string, PortraitSource>;

/** The name of a portrait state. */
type PortraitName = keyof typeof SOURCES;

/** Her portrait in the conversation's place, drawn from a source. */
function portraitDrawing({ her, presence, speaking }: PortraitSource) {
  return {
    view: StationPortraitView,
    props: {
      picture: her, name: her.settings.name, speaking: speaking ?? null, face: avatarOf(her, presence),
    } satisfies Omit<ComponentProps<typeof StationPortraitView>, 'tier' | 'density'>,
  };
}

/** Each source's drawing by `make`, under its name. */
function byName<T>(make: (source: PortraitSource) => T): Record<PortraitName, T> {
  return Object.fromEntries(Object.entries(SOURCES).map(([name, source]) => [name, make(source)])) as Record<PortraitName, T>;
}

/** Her column in the portrait view: her head's and her portrait's drawings under each state's name. */
export const PORTRAIT_STATES = {
  head: byName(({ her, presence }) => portraitHead(her, presence)),
  conversation: byName(portraitDrawing),
};
