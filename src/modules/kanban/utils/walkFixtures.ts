import type { KanbanDecision } from '@/shared/kanban-types';
import type { KanbanWalk, KanbanWalkStage } from '@/modules/kanban/utils/walkModel';

/**
 * FAKE PROPS, AND NOTHING ELSE: what the board's screens are composed against until the feed fills
 * them. Every reader of this file sits under a `FILL:` marker, and the fill deletes the file.
 *
 * THEY ATTACH TO ONE SCRATCH BOARD, BY ITS ID. A fake hold sentence on a real card would be a lie
 * on a screen a person acts from, so nothing here is ever drawn on a board the operator works on:
 * `FAKE_BOARD_ID` is "Card walk scaffold (scratch)", made for this composition, and its six cards
 * are the keys below.
 */

export const FAKE_BOARD_ID = 'b-145';

const CARDS = { done: 'c-657', bug: 'c-658', duplicate: 'c-659', change: 'c-660', tweak: 'c-661', asking: 'c-662' };

/** The titles of that board's cards: what a link to one of them reads. */
export const FAKE_TITLES: Record<string, string> = {
  [CARDS.done]: 'Drawer: a step’s note loses its line breaks',
  [CARDS.bug]: 'cases sweep --suite . prints a hint that says "its repo path" where it means an absolute one',
  [CARDS.duplicate]: 'cases sweep tells me to give "its repo path" and then refuses the path I gave',
  [CARDS.change]: 'Sweep hint: show an example path under the message',
  [CARDS.tweak]: 'Board header: the Autonomy switch should say "Runs itself"',
  [CARDS.asking]: 'Lane counts drift after a card is dragged twice',
};

/** A card a link names that is no longer there: the id the scratch tweak card's `related:` tag carries. */
export const FAKE_GONE: string[] = ['c-0'];

const stage = (name: string, soul: string, launch: string, status: string, verdict: string | null, tokensIn: number, tokensOut: number): KanbanWalkStage => ({
  name, soul, launch_id: launch, status, verdict, cost_usd: 0, paid_vendor: null, tokens: tokensIn + tokensOut, tokens_in: tokensIn, tokens_out: tokensOut,
});

/** Real launches of this house, so a transcript opened from a fake stage is a transcript. */
const LAUNCH = {
  asclepius: 'dispatch-asclepius-20261114-050652-5c65',
  athena: 'dispatch-athena-20261118-155729-6ef3',
  athenaAgain: 'dispatch-athena-20261118-160432-f2a3',
  hephaestus: 'dispatch-hephaestus-20261118-091515-9f25',
  hephaestusAgain: 'dispatch-hephaestus-20261118-092450-7299',
};

export const FAKE_WALKS: Record<string, KanbanWalk> = {
  [CARDS.change]: { hold: `${FAKE_TITLES[CARDS.bug]} goes first`, stages: [], cases: [] },
  [CARDS.tweak]: { hold: '1 of 1 cards walking', stages: [], cases: [] },
  [CARDS.asking]: {
    hold: '',
    // A card that began as a tweak and was moved to the full flow, whose first diagnosis died: the
    // sitting no step of a bug's list claims, and the sitting that ended without finishing.
    stages: [
      stage('tweak', 'hephaestus', LAUNCH.hephaestus, 'done', 'MOVED', 96_000, 1_400),
      stage('diagnose', 'asclepius', LAUNCH.asclepius, 'crash', null, 58_000, 300),
      stage('diagnose', 'asclepius', LAUNCH.asclepius, 'done', 'NOT REPRODUCED', 412_000, 6_100),
    ],
    cases: [],
  },
  [CARDS.bug]: {
    hold: '',
    stages: [
      stage('diagnose', 'asclepius', LAUNCH.asclepius, 'done', 'BUG', 688_000, 9_400),
      stage('scenarios', 'athena', LAUNCH.athena, 'done', null, 301_000, 5_200),
      stage('builder', 'hephaestus', LAUNCH.hephaestus, 'waiting', null, 154_000, 2_300),
    ],
    cases: [
      { suite: 'house', name: 'cases-sweep-hint-names-an-absolute-path', word: 'draft' },
      { suite: 'house', name: 'cases-sweep-refusal-says-which-path-it-wanted', word: 'draft' },
    ],
  },
  [CARDS.done]: {
    hold: '',
    stages: [
      stage('diagnose', 'asclepius', LAUNCH.asclepius, 'done', 'BUG', 540_000, 7_800),
      stage('scenarios', 'athena', LAUNCH.athena, 'done', null, 286_000, 4_900),
      stage('builder', 'hephaestus', LAUNCH.hephaestus, 'done', null, 1_240_000, 14_600),
      stage('athena-1', 'athena', LAUNCH.athena, 'done', 'FAIL — B:0 H:1 M:0 L:2', 610_000, 6_300),
      stage('fix-pass', 'hephaestus', LAUNCH.hephaestusAgain, 'done', null, 402_000, 5_100),
      stage('athena-2', 'athena', LAUNCH.athenaAgain, 'done', 'PASS — B:0 H:0 M:0 L:1', 388_000, 3_700),
    ],
    cases: [
      { suite: 'lyphecli', name: 'a-steps-note-is-drawn-line-by-line-in-the-card-drawer', word: 'holding' },
      { suite: 'lyphecli', name: 'a-cards-body-keeps-its-line-breaks-in-the-drawer', word: 'broken' },
    ],
  },
};

/** Which step of a card's list each stage is drawn under, by the step's place in the list. */
export const FAKE_STEP_OF: Record<string, number> = {
  diagnose: 1, scenarios: 2, builder: 3, 'fix-pass': 3, 'athena-1': 4, 'athena-2': 4,
};

const decision = (id: string, question: string, choice: string, createdAt: string): KanbanDecision => ({
  id, cardId: CARDS.done, questionId: null, question, choice: [choice], tags: [], createdAt,
});

/** The decisions a walk took without asking, as `detail.decisions` will carry them. */
export const FAKE_DECISIONS: Record<string, KanbanDecision[]> = {
  [CARDS.done]: [
    decision('d-1', 'Which lines of a note are kept?', 'Every line, in the order it was written. An empty line stays an empty line.', '2026-11-18T19:02:00.000Z'),
    decision('d-3', 'Is "Lane counts drift after a card is dragged twice" the same bug?', 'Related, not the same: it shares the drawer’s re-read and nothing of the cause.', '2026-11-18T19:41:00.000Z'),
    decision('d-2', 'Does the body of a card get the same cure?', 'Yes. It is drawn by the same paragraph, so it is cured with the note.', '2026-11-18T19:20:00.000Z'),
  ],
};

/** The projects list a board's repositories are picked from. */
export const FAKE_PROJECTS: Array<{ name: string; path: string }> = [
  { name: '.claude', path: '/home/lyphe/.claude' },
  { name: 'claudecodeui_lyphe', path: '/home/lyphe/.claude/claudecodeui_lyphe' },
  { name: 'eis-app', path: '/opt/eis-app' },
  { name: 'shadow-connector', path: '/opt/shadow-connector' },
];
