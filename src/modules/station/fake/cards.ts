import type { ComponentProps } from 'react';

import { DIFF_LINES, INBOX_LINES, KANBAN_REVIEW_ITEMS, NOTE_LINES, PAGE_LINES, PLAN_LINES, RUN_LINES, RUNS_LINES } from '@/modules/station/fake/cardLines';
import { SESSIONS_FAKE } from '@/modules/station/fake/sessions';
import { WAITING_FEATURE } from '@/modules/station/fake/stage';
import { NoteStageView } from '@/modules/station/NoteStage';
import { StageShelfView } from '@/modules/station/StageShelf';
import { WalkStageView } from '@/modules/station/WalkStage';
import { docSpacePageUrl } from '@/modules/widgets';
import type { CompanionNote, CompanionNoteKind, CompanionNoteRef, CompanionWalk } from '@/shared/companion-types';
import type { StationFocus, StationSession } from '@/shared/station-types';

/*
 * HER CARDS' FIXTURES, for `station-fake.ts`'s pictures and the stage's own shots only. Nothing in the app imports this file.
 *
 * Every card is a `CompanionNote` as her picture holds one (its kind, its ref and its pin, as her tools now write them:
 * `server/modules/companion/eyes/card-shapes.ts`), its text as the reader writes it (`fake/cardLines.ts`); the walk is a
 * `CompanionWalk`. Card ids are above 900000, where no store has minted one, and the chats are the left rail's own fixture
 * chats (`fake/sessions.ts`), so the stage and the rail draw one chat. Times are relative to when the fixture loads.
 *
 * THE PICTURES' SHELVES (`SHELF_NOTES`): `home` a pinned list card and a diff card; `waiting` one plan card, the design of the
 * feature whose Accept stands on the stage; `walkthrough` and `empty` none, so no shelf is drawn. `walkthrough`'s stage is
 * her walk at item 4 of 15 (`WALK_STAGE`).
 *
 * THE STAGE'S OWN SHOTS (`CARDS_STAGE_FAKE`), each drawn over a picture with its own stage and shelf: each kind of card on the
 * stage (a note about a chat, the pinned list of runs, the inbox's list with its child rows, the diff, the plan page, the
 * pinned DocSpace page), a card taken down, her picture still being read, the walk at 4 of 15 and at its two ends and ended,
 * and the shelf over an empty stage with two pinned cards, her three newest and "+2". The diff's lines and the list's run ids
 * are longer than a phone is wide.
 */

const NOW = Date.now();
/** A stamp `minutes` before the fixture loads, ISO, as the wires write one. */
const ago = (minutes: number): string => new Date(NOW - minutes * 60_000).toISOString();

/** A press a picture never makes: the shots photograph, they do not press. */
const NO_PRESS = () => {};

/** The chat a picture's left rail draws by this name, so the walk and a card's ref name the rail's own chat. */
function railChat(picture: keyof typeof SESSIONS_FAKE, name: string): StationSession {
  const found = SESSIONS_FAKE[picture].props.sessions?.find((session) => session.name === name);
  if (found === undefined) throw new Error(`fake/sessions.ts draws no chat "${name}" in its ${picture} picture`);
  return found;
}

/** One card as her picture holds it, put up `minutes` ago. */
const card = (id: number, minutes: number, title: string, text: string, kind: CompanionNoteKind, ref: CompanionNoteRef | null, pinned: boolean): CompanionNote => ({
  id, at: ago(minutes), title, text, kind, ref, pinned,
});

/** The project her git reads are of, by its path. */
const PROJECT_PATH = '/home/lyphe/.claude/claudecodeui_lyphe';
/** Her memory's DocSpace page (`BANK_PAGE_ID`). */
const MEMORY_PAGE = 'page-kaylee-memory';
const UPLOADS = railChat('home', 'Restorly uploads handoff');
const KANBAN = railChat('walkthrough', 'Kanban lane review');

/** Her cards, oldest first: `list_runs recent` (pinned), a plan's design, her note, her memory's page (pinned), a diff, the inbox, a run's report. */
const RUNS = card(900401, 180, 'Runs: recent', RUNS_LINES, 'list', null, true);
const PLAN = card(900402, 120, 'kaylee station what needs you: design', PLAN_LINES, 'plan', { kind: 'card', plan: WAITING_FEATURE.name }, false);
const NOTE = card(900403, 90, 'Before you sleep', NOTE_LINES, 'note', null, false);
const PAGE = card(900404, 70, 'Kaylee\'s memory', PAGE_LINES, 'page', { kind: 'page', pageId: MEMORY_PAGE, blockId: null }, true);
const DIFF = card(900405, 25, 'claudecodeui_lyphe: uncommitted diff', DIFF_LINES, 'diff', { kind: 'project', path: PROJECT_PATH }, false);
const INBOX = card(900406, 12, 'What waits in his inbox', INBOX_LINES, 'list', null, false);
const RUN = card(900407, 3, 'Restorly uploads handoff: its run\'s report', RUN_LINES, 'note', { kind: 'chat', sessionId: UPLOADS.sessionId }, false);

/** Every card she holds in the stage's own shots: on the shelf, two pinned and her three newest, and two more in the conversation. */
const ALL_CARDS = [RUNS, PLAN, NOTE, PAGE, DIFF, INBOX, RUN];
/** `home`'s cards: the pinned list of runs, and the diff. */
const HOME_CARDS = [RUNS, DIFF];

/** Her cards on each picture's shelf: none in `walkthrough` and `empty`, which draw no shelf. */
const SHELF_NOTES: Record<'home' | 'waiting' | 'walkthrough' | 'empty', CompanionNote[]> = {
  home: HOME_CARDS,
  waiting: [PLAN],
  walkthrough: [],
  empty: [],
};

/** Her walk of the Kanban lane review, at its fourth item of fifteen. */
const WALK: CompanionWalk = {
  session: { sessionId: KANBAN.sessionId, name: KANBAN.name, project: KANBAN.project },
  items: KANBAN_REVIEW_ITEMS,
  at: 4,
  updatedAt: ago(2),
};

/** The walk's stage drawn at `walk`: undefined while her picture is read, null once she holds none. */
const walkStage = (walk: CompanionWalk | null | undefined) => ({
  view: WalkStageView,
  props: { walk, sessionName: KANBAN.name, onBack: NO_PRESS, onNext: NO_PRESS, onEnd: NO_PRESS } satisfies ComponentProps<typeof WalkStageView>,
});

/** `walkthrough`'s stage: her walk at item 4 of 15, which she put there; nothing behind it. */
export const WALK_STAGE = { ...walkStage(WALK), canGoBack: false };

/** One of her cards on the stage: `note` the card as her picture holds it (undefined while it is read, null once taken down). */
const noteStage = (focus: Extract<StationFocus, { kind: 'note' }>, note: CompanionNote | null | undefined) => ({
  view: NoteStageView,
  props: {
    focus, note, pageHref: note?.ref?.kind === 'page' ? docSpacePageUrl(note.ref.pageId, note.ref.blockId) : null,
    onPin: NO_PRESS, onDismiss: NO_PRESS, onOpenRef: NO_PRESS,
  } satisfies ComponentProps<typeof NoteStageView>,
});

/** A card's focus, as her new card or a press on the shelf puts it on the stage: its id, its title its label. */
const focusOf = (note: CompanionNote): Extract<StationFocus, { kind: 'note' }> => ({ kind: 'note', id: note.id, label: note.title });

/** The shelf over a stage holding `focus`, with `notes` her cards. */
const shelf = (notes: CompanionNote[], focus: StationFocus | null) => ({
  view: StageShelfView,
  props: { notes, focus, onOpen: NO_PRESS } satisfies ComponentProps<typeof StageShelfView>,
});

/** The walk's focus, as her walk puts it on the stage: the chat it walks names it. `walkthrough`'s focus (`station-fake.ts`). */
export const WALK_FOCUS: Extract<StationFocus, { kind: 'walk' }> = { kind: 'walk', label: KANBAN.name };

/** A card shot over `home`: the card on the stage with the chat he pressed one Back away, every card she holds on the shelf. */
const homeCard = (note: CompanionNote, notes: CompanionNote[] = ALL_CARDS) => ({
  picture: 'home' as const, focus: focusOf(note), ...noteStage(focusOf(note), note), canGoBack: true, shelf: shelf(notes, focusOf(note)),
});

/** A walk shot over `walkthrough`, its stage at `walk`, her face's place drawn beside it, no card on the shelf. */
const walkShot = (walk: CompanionWalk | null | undefined) => ({
  picture: 'walkthrough' as const, focus: WALK_FOCUS, ...walkStage(walk), canGoBack: false, shelf: null, face: true,
});

/** A card she took down while it stood on the stage: the focus still names it, her picture no longer holds it. */
const GONE_FOCUS: Extract<StationFocus, { kind: 'note' }> = { kind: 'note', id: 900399, label: 'Vendor chat mail: what she found' };

/**
 * THE STAGE'S OWN SHOTS, each a stage and a shelf drawn over a picture in the stage's place (`.verify/kaylee-station-shots.mjs`,
 * by name): `picture`, the `focus` on the stage, its `view` and `props` (no view: the empty stage), whether Back is drawn, the
 * shelf's drawing (null: no cards), and `face` where the shot shows her face's place beside the walk.
 */
export const CARDS_STAGE_FAKE = {
  'card-note': homeCard(RUN),
  'card-list': homeCard(RUNS),
  'card-inbox': homeCard(INBOX),
  // `home` with the diff on the stage: "a pinned list card on the shelf and a diff card on the stage".
  'card-diff': homeCard(DIFF, HOME_CARDS),
  // `waiting` with the plan card on the stage, the feature whose Accept it holds one Back away.
  'card-plan': { picture: 'waiting' as const, focus: focusOf(PLAN), ...noteStage(focusOf(PLAN), PLAN), canGoBack: true, shelf: shelf([PLAN], focusOf(PLAN)) },
  'card-page': homeCard(PAGE),
  'card-gone': { picture: 'home' as const, focus: GONE_FOCUS, ...noteStage(GONE_FOCUS, null), canGoBack: true, shelf: shelf(ALL_CARDS, GONE_FOCUS) },
  'card-reading': { picture: 'home' as const, focus: focusOf(RUN), ...noteStage(focusOf(RUN), undefined), canGoBack: false, shelf: null },
  walk: walkShot(WALK),
  'walk-begin': walkShot({ ...WALK, at: 0 }),
  'walk-last': walkShot({ ...WALK, at: WALK.items.length }),
  'walk-ended': walkShot(null),
  // The shelf over an empty stage: his two pinned cards, her three newest, "+2 more in the conversation".
  shelf: { picture: 'home' as const, focus: null, view: null, props: {}, canGoBack: false, shelf: shelf(ALL_CARDS, null) },
};

/**
 * A picture's shelf over the focus its stage holds (`station-fake.ts`'s `FAKE_STAGE`), or null where she has no cards: `home`'s
 * over the chat he pressed and `waiting`'s over the feature's card, so no chip is lit in either.
 */
export const shelfFor = (picture: keyof typeof SHELF_NOTES, focus: StationFocus | null) =>
  SHELF_NOTES[picture].length === 0 ? null : shelf(SHELF_NOTES[picture], focus);
