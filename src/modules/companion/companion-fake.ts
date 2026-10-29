import type {
  CompanionActionTarget, CompanionActivity, CompanionCarriedLine, CompanionDraft, CompanionLogEntry, CompanionNote,
  CompanionPendingAction, CompanionPicture, CompanionProcess, CompanionSessionRef, CompanionSettings, CompanionWalk,
} from '@/shared/companion-types';

/*
 * FAKE COMPANION PICTURES, for the scaffolds' fixtures only: every state of her panel and her Settings section, typed by
 * the wire's mirror, so each can be mounted and photographed before the module's routes exist. Nothing in the app
 * imports this file; `.verify/companion-panel-scaffold.mjs`, `.verify/kaylee-talk-scaffold.mjs` (its talk presses,
 * `heard`) and `.verify/kaylee-voice-scaffold.mjs` (her voice, `spoken`) do.
 *
 * The chats are named the way the operator names his (Kanban lanes, the migration chat) and the sentences are cut and
 * marked the way the server's `parseExpression` cuts and marks them: mood brackets lifted, a sound's `at` the length of
 * the words before it, so "Oh nice" + mark + " the lane drag landed." Times are relative to when the fixture loads.
 *
 * The actions waiting for his word are put as the hands put them (hands/action-recipe.ts): an Accept's prompt is the lock's
 * header and the census, a round's its questions numbered with their options, a card's `spoken` its title, a follow-up's
 * the first five words of its text, `say` the verb and that name, every carried line one of his spoken rows, by its id.
 */

const NOW = Date.now();
const ago = (seconds: number): string => new Date(NOW - seconds * 1000).toISOString();

const MODELS: CompanionPicture['models'] = [
  { value: 'sonnet', label: 'Sonnet 5.5' },
  { value: 'fable', label: 'Fable 5.1' },
  { value: 'opus', label: 'Opus 5.5' },
  { value: 'haiku', label: 'Haiku 5.5' },
];

/** A register long enough to scroll its field, with the three slots the real one carries. */
const REGISTER = [
  'REGISTER. Read it before you speak. It arrives with every message so it is never stale.',
  'You are {name}. Everything below is said aloud.',
  'WHO YOU ARE',
  'Cheerful, happy, bubbly, and extremely good at your job. You are the light that guides this project: you always know where things stand, what just landed, and what the next move is.',
  'HOW YOU TALK',
  'The point comes first. Two to four sentences, fifty words, unless he asked for more. One question at most, and it comes last.',
  'EXPRESSION',
  'A sound goes where you would actually make one, from this set only: {sound_tags}.',
  'Delivery note for the voice: {delivery_note}',
].join('\n');

export const FAKE_SETTINGS: CompanionSettings = {
  name: 'Kaylee', operatorName: 'Scott', register: REGISTER,
  deliveryNote: 'bright, warm, quick, a smile in the voice', model: 'sonnet', live: false, talkBinding: null,
};

const KANBAN: CompanionSessionRef = { sessionId: 'fx-kanban', name: 'Kanban lanes', project: 'claudecodeui_lyphe' };
const MIGRATION: CompanionSessionRef = { sessionId: 'fx-migration', name: 'Migration chat', project: 'shadow-connector' };

let nextId = 1;
type Sound = CompanionLogEntry['sounds'];
const he = (secondsAgo: number, text: string, via: 'typed' | 'spoken' = 'typed'): CompanionLogEntry => (
  { id: nextId++, at: ago(secondsAgo), role: 'operator', via, turnId: null, index: null, text, mood: null, sounds: [] });
const she = (secondsAgo: number, turnId: string, index: number, text: string, sounds: Sound = [], mood: string | null = null): CompanionLogEntry => (
  { id: nextId++, at: ago(secondsAgo), role: 'kaylee', via: null, turnId, index, text, mood, sounds });
const house = (secondsAgo: number, role: 'alert' | 'system', text: string): CompanionLogEntry => (
  { id: nextId++, at: ago(secondsAgo), role, via: null, turnId: null, index: null, text, mood: null, sounds: [] });

const HELLO: CompanionLogEntry[] = [
  he(420, 'hello'),
  she(416, 't-hello', 0, 'Hi Scott, good to hear from you!', [{ tag: 'giggle', at: 32 }]),
  she(415, 't-hello', 1, 'Two chats are working right now, Kanban lanes and the migration chat.'),
  she(414, 't-hello', 2, 'Want the headline of either?'),
];

const ASKED = [...HELLO, he(30, 'What did the kanban chat just do?')];

const READING = [...ASKED, she(24, 't-read', 0, 'On it, reading its last turn now.', [], 'brisk')];

const WALK_ITEMS = [
  'Lane drag drops a card on the wrong lane',
  'The WIP limit badge counts archived cards',
  'Column headers lose their sticky top on Safari',
  'Undo after a move restores the old order twice',
  'Keyboard move skips the empty lane',
];

const WALK: CompanionWalk = { session: KANBAN, items: WALK_ITEMS, at: 2, updatedAt: ago(40) };

const WALKED = [
  ...ASKED,
  she(26, 't-read', 0, 'Oh nice the lane drag fix landed, and it left five findings for you.', [{ tag: 'gasp', at: 7 }], 'delighted'),
  she(25, 't-read', 1, 'First one: a card dropped near a lane edge lands one lane over.'),
  she(25, 't-read', 2, 'Fix it or skip it?'),
  he(18, 'fix it, and keep the drop zone the full lane height', 'spoken'),
  she(14, 't-walk', 0, 'Got it, folded into the draft.'),
  she(13, 't-walk', 1, 'Second: the WIP badge counts archived cards, so a lane reads full when it is not.'),
];

const DRAFT_TEXT = [
  'Two answers from the review:',
  '1. Lane drag: fix it. Keep the drop zone the full height of the lane, so a card dropped near the edge lands in the lane under the pointer.',
  '2. WIP badge: count only cards that are not archived.',
].join('\n');

const DRAFT_KANBAN: CompanionDraft = { target: { kind: 'session', session: KANBAN }, text: DRAFT_TEXT, updatedAt: ago(70) };
const DRAFT_NEW: CompanionDraft = {
  target: { kind: 'new', projectPath: '/home/lyphe/.claude/claudecodeui_lyphe', projectName: 'claudecodeui_lyphe' },
  text: 'Add a "Through Kaylee" filter to the chat list, so I can see every brief she relayed today in one place.',
  updatedAt: ago(15),
};

const NOTES: CompanionNote[] = [
  {
    id: 41, at: ago(200), title: 'Files the lane drag touched',
    text: 'src/modules/kanban/KanbanBoard.tsx\nsrc/modules/kanban/hooks/useLaneDrag.ts\nsrc/shared/ui/KanbanLane.tsx',
  },
  {
    id: 42, at: ago(90), title: 'Where the migration stands',
    text: 'Three of five tables are copied and checked. The last two wait on the sessions backfill, which the migration chat says finishes tonight.',
  },
];

/** A long evening with her: turns, his spoken and typed lines, alerts, a system line, and her sounds. */
function longLog(): CompanionLogEntry[] {
  const rows: CompanionLogEntry[] = [];
  const topics = ['the kanban chat', 'the migration chat', 'the roadmap review', 'the inbox triage', 'the cerberus checks'];
  for (let turn = 0; turn < 9; turn += 1) {
    const at = 5400 - turn * 560;
    const topic = topics[turn % topics.length];
    rows.push(he(at, turn % 3 === 1 ? `what's ${topic} up to` : `Read the last turn of ${topic}.`, turn % 3 === 1 ? 'spoken' : 'typed'));
    rows.push(she(at - 6, `t-long-${turn}`, 0, `Okay so ${topic} finished its turn a few minutes ago.`, turn % 4 === 0 ? [{ tag: 'chuckle', at: 7 }] : []));
    rows.push(she(at - 5, `t-long-${turn}`, 1, 'It changed two files and left one question for you about the empty state.'));
    rows.push(she(at - 5, `t-long-${turn}`, 2, 'Want me to read the question out?'));
    if (turn === 2) rows.push(house(at - 120, 'alert', 'Feature finished · Kanban lanes · claudecodeui_lyphe\nLane drag landed. Follow-ups it filed for him: keep the drop zone the full lane height.'));
    if (turn === 5) rows.push(house(at - 90, 'alert', 'Permission · Migration chat · shadow-connector\nWaiting on him: run `npm run migrate` in Bash.'));
    if (turn === 6) rows.push(house(at - 60, 'system', 'Her memory could not be resumed; she starts fresh.'));
  }
  rows.push(he(60, 'and the migration chat?'));
  rows.push(she(55, 't-long-end', 0, 'Three of five tables are copied and checked.', [{ tag: 'short pause', at: 44 }]));
  rows.push(she(54, 't-long-end', 1, 'The last two wait on tonight\'s backfill; I put the details on the panel.'));
  return rows;
}

const LONG = longLog();

/** His talk presses: one that carried words, then one that carried none, each answered (if only with a word). */
const HEARD = [
  ...HELLO,
  he(40, 'What chats are working?', 'spoken'),
  she(36, 't-heard', 0, 'Two are: Kanban lanes and the migration chat.'),
  she(35, 't-heard', 1, 'The migration chat is copying its fourth table.'),
  he(12, '', 'spoken'),
  she(9, 't-empty', 0, 'Yes?'),
];

/**
 * A turn whose words are all in while her voice is still on them, as it is for most of a spoken answer (the text streams
 * faster than she speaks): the voice fixtures mark its third sentence, which wraps on a phone and holds a sound.
 */
const SPOKEN = [
  ...ASKED,
  she(20, 't-spoken', 0, 'Okay so the kanban chat just finished its turn.'),
  she(19, 't-spoken', 1, 'It fixed the lane drag and changed three files.'),
  she(18, 't-spoken', 2, 'Oh and it left five findings for you, the first about a card that lands one lane over.', [{ tag: 'gasp', at: 2 }]),
  she(18, 't-spoken', 3, 'Want to walk them now?'),
];

/** A line he said, carried into an action as the log holds it: its row's id, its time, its words. */
const carriedOf = (entry: CompanionLogEntry): CompanionCarriedLine => ({ logId: entry.id, at: entry.at, text: entry.text });

/** An action prepared `secondsAgo`, lapsing five minutes after it went up. */
const prepared = (secondsAgo: number, action: Omit<CompanionPendingAction, 'preparedAt' | 'expiresAt'>): CompanionPendingAction => ({ ...action, preparedAt: ago(secondsAgo), expiresAt: ago(secondsAgo - 300) });

const card = (name: string, spoken: string): CompanionActionTarget => ({ kind: 'card', name, spoken, arc: 'kanban' });

/** An Accept as the card draws it: the lock's header, then the census `dispatcher question` prints, its token last. */
const CENSUS = [
  'Intent lock', '', 'kanban--lane-drag — 4 tasks', '',
  'A card dropped anywhere over a lane lands in that lane, where the pointer marks it; a drop between two lanes goes to the one under the pointer.',
  '', 'Repo ~/.claude/claudecodeui_lyphe · Epic kanban · 4 tasks in 2 waves · 3 decisions settled', '',
  '1. The drop zone, the full height of the lane — hephaestus/claude', '2. A drop between two lanes — hephaestus/claude',
  "3. The lane's drop marker, composed — iris/claude — after 1", '4. The marker live, shown at 390 and 1440 — hephaestus/claude — after 2, 3',
  '', 'Run it? · lock:4be1c09a7d',
].join('\n');

const QUEUE_LOG = [
  he(150, 'Get lane drag ready to queue.', 'spoken'),
  she(146, 't-queue', 0, 'Okay, Lane drag is on your panel to queue.'),
  she(145, 't-queue', 1, 'The prompt reads "kanban--lane-drag — 4 tasks", and it delivers: a card dropped anywhere over a lane lands in that lane.'),
  she(144, 't-queue', 2, 'Say "Queue Lane drag" when you want it.'),
];
const QUEUE = prepared(147, { id: 'fx-act-queue', action: 'queue', target: card('kanban--lane-drag', 'Lane drag'), prompt: CENSUS, carried: [], say: 'Queue Lane drag' });

const QUESTIONS = [
  '1. Should the WIP badge count the cards that are blocked?', '   - Yes, a blocked card still takes room in the lane', '   - No, only the cards being worked', '',
  '2. Where does the badge sit while a lane is folded?', "   - On the folded lane's spine", '   - Hidden until the lane opens',
].join('\n');

const ANSWER_LOG = [
  he(240, 'Answer the WIP badge questions.', 'spoken'),
  she(236, 't-q1', 0, 'Question one: should the badge count the cards that are blocked?'),
  he(210, 'Yes, count the blocked ones.', 'spoken'),
  he(200, 'They still take up room in the lane.', 'spoken'),
  she(190, 't-q2', 0, 'And two: where does it sit while a lane is folded?'),
  he(170, 'On the spine, so I can see it while it is folded.', 'spoken'),
  she(160, 't-answer', 0, 'Your answers to WIP badge are on your panel, word for word.'),
  she(159, 't-answer', 1, 'Say "Send the answers to WIP badge" to send them.'),
];
const ANSWER = prepared(161, {
  id: 'fx-act-answer', action: 'answer', target: card('kanban--wip-badge', 'WIP badge'), prompt: QUESTIONS, say: 'Send the answers to WIP badge',
  carried: [
    { label: 'Should the WIP badge count the cards that are blocked?', lines: [carriedOf(ANSWER_LOG[2]), carriedOf(ANSWER_LOG[3])] },
    { label: 'Where does the badge sit while a lane is folded?', lines: [carriedOf(ANSWER_LOG[5])] },
  ],
});

/**
 * A round at the length he really speaks (his spoken lines to her average 96 characters, his round answers run to 459), and
 * of the size most rounds have, three questions: the third he left unanswered, so it goes as "(no answer)".
 */
const LIMIT_QUESTIONS = [
  "What should a lane's WIP limit count, and how is it shown when a lane goes over it?",
  'Who hears about a lane that stays over its limit, and where does that land?', 'Should a lane over its limit refuse a new card by itself?',
];
const ROUND_LOG = [
  he(330, 'Answer the lane limits questions.', 'spoken'),
  she(326, 't-r1', 0, "Question one: what should a lane's WIP limit count, and how is it shown when a lane goes over it?"),
  he(300, "Count the cards in the lane that are not archived and not blocked, and show it as a badge on the lane's head beside its name.", 'spoken'),
  he(290, "When a lane goes over, the badge turns into a warning with the count and the limit, and the lane's border goes amber until it is back under.", 'spoken'),
  she(270, 't-r2', 0, 'Two: who hears about a lane that stays over its limit, and where does that land?'),
  he(250, "Nobody gets pinged for now. It shows on the board and in the lane's own history, and later we decide which roles hear about it, so put that in the milestones as its own feature, after the sticky headers land.", 'spoken'),
  she(200, 't-r3', 0, 'Your answers to Lane limits are on your panel; the third question goes with no answer.'),
  she(199, 't-r3', 1, 'Say "Send the answers to Lane limits" to send them.'),
];
const ROUND = prepared(201, {
  id: 'fx-act-round', action: 'answer', target: card('kanban--lane-limits', 'Lane limits'), say: 'Send the answers to Lane limits',
  prompt: LIMIT_QUESTIONS.map((question, at) => `${at + 1}. ${question}\n   - As the design proposes\n   - Something else`).join('\n\n'),
  carried: [
    { label: LIMIT_QUESTIONS[0], lines: [carriedOf(ROUND_LOG[2]), carriedOf(ROUND_LOG[3])] },
    { label: LIMIT_QUESTIONS[1], lines: [carriedOf(ROUND_LOG[5])] },
    { label: LIMIT_QUESTIONS[2], lines: [] },
  ],
});

/** A rework with no Accept prompt open: his notes go to the card's designer as a message, so the card shows them alone. */
const REWORK_LOG = [
  he(130, 'Rework sticky headers. Here are my notes.', 'spoken'),
  she(127, 't-notes', 0, 'Go ahead, I will carry them word for word.'),
  he(110, 'The headers have to stick on Safari too, not just Chrome.', 'spoken'),
  he(95, 'Keep the lane count in the header while it sticks.', 'spoken'),
  he(80, 'No shadow under it, the border is enough.', 'spoken'),
  she(72, 't-rework', 0, 'Three notes for Sticky headers are on your panel.'),
  she(71, 't-rework', 1, 'There is no Accept prompt open, so they go to its designer as a message.'),
  she(70, 't-rework', 2, 'Say "Rework Sticky headers" to send them.'),
];
const REWORK = prepared(74, {
  id: 'fx-act-rework', action: 'rework', target: card('kanban--sticky-headers', 'Sticky headers'), prompt: null, say: 'Rework Sticky headers',
  carried: [{ label: null, lines: [REWORK_LOG[2], REWORK_LOG[3], REWORK_LOG[4]].map(carriedOf) }],
});

const OPEN_LOG = [
  he(50, 'Pull up the voice companion prompt page.', 'spoken'),
  she(46, 't-open', 0, 'Voice companion prompt is ready to open on your screen.'),
  she(45, 't-open', 1, 'Say "Open Voice companion prompt".'),
];
const OPEN = prepared(47, {
  id: 'fx-act-open', action: 'open', prompt: null, carried: [], say: 'Open Voice companion prompt',
  target: { kind: 'page', pageId: 'page-1793032570463-003-ev8jb8', blockId: null, spoken: 'Voice companion prompt' },
});

const CLOSE_LOG = [
  he(64, 'Close the follow-up about retesting lane drag on Safari.', 'spoken'),
  she(60, 't-close', 0, 'Follow-up 12 is on your panel to close: "Retest lane drag on Safari once the sticky headers land."'),
  she(59, 't-close', 1, 'Say "Close the follow-up on Retest lane drag on Safari".'),
];
const CLOSE = prepared(61, {
  id: 'fx-act-close', action: 'close_followup', prompt: null, carried: [], say: 'Close the follow-up on Retest lane drag on Safari',
  target: { kind: 'followup', id: 12, sessionId: KANBAN.sessionId, spoken: 'Retest lane drag on Safari', text: 'Retest lane drag on Safari once the sticky headers land.' },
});

const IDLE: CompanionActivity = { phase: 'idle', session: null, files: null, walk: null };
const AWAKE: CompanionProcess = { state: 'awake', error: null };
const FAILED_SENTENCE = "Kaylee couldn't start: the Claude login on this box has expired. Sign in again from Settings > Account.";

/** A picture: the defaults of an awake, idle companion with an empty panel, and whatever a state changes. */
const picture = (change: Partial<CompanionPicture>): CompanionPicture => ({
  settings: FAKE_SETTINGS, models: MODELS, process: AWAKE, activity: IDLE, turnId: null, focus: null,
  draft: null, pending: null, walk: null, notes: [], log: [], floor: 'fixture-page', ...change,
});

/** One state of the panel: her picture, whether the draft's target is working, and the page's open state. */
type FakePanelState = { picture: CompanionPicture | null; targetWorking: boolean; open: boolean };

const state = (change: Partial<CompanionPicture> | null, targetWorking = false, open = true): FakePanelState => (
  { picture: change === null ? null : picture(change), targetWorking, open });

export const FAKE_PANEL: Record<string, FakePanelState> = {
  loading: state(null),
  asleepEmpty: state({ process: { state: 'asleep', error: null } }),
  waking: state({ process: { state: 'waking', error: null }, log: [he(2, 'hello')] }),
  awakeIdle: state({ log: HELLO }),
  thinking: state({ log: ASKED, turnId: 't-read', activity: { ...IDLE, phase: 'thinking' } }),
  readingSession: state({ log: READING, turnId: 't-read', focus: KANBAN, activity: { ...IDLE, phase: 'reading_session', session: KANBAN } }),
  readingCode: state({
    log: READING, turnId: 't-read', focus: KANBAN,
    activity: { ...IDLE, phase: 'reading_code', files: ['src/modules/kanban/KanbanBoard.tsx', 'src/modules/kanban/hooks/useLaneDrag.ts'] },
  }),
  drafting: state({ log: WALKED, turnId: 't-walk', focus: KANBAN, draft: DRAFT_KANBAN, activity: { ...IDLE, phase: 'drafting', session: KANBAN } }),
  walking: state({
    log: WALKED, turnId: 't-walk', focus: KANBAN, walk: WALK, settings: { ...FAKE_SETTINGS, live: true },
    activity: { ...IDLE, phase: 'walking', session: KANBAN, walk: { at: 2, total: 5 } },
  }),
  failed: state({ process: { state: 'failed', error: FAILED_SENTENCE }, log: [...HELLO, he(12, 'are you there?'), house(10, 'system', FAILED_SENTENCE)] }),
  longLog: state({ log: LONG, focus: MIGRATION, settings: { ...FAKE_SETTINGS, live: true } }),
  draftWorking: state({ log: WALKED.slice(0, 8), focus: KANBAN, draft: DRAFT_KANBAN }, true),
  draftNew: state({ log: HELLO, draft: DRAFT_NEW }),
  walk: state({ log: WALKED, focus: KANBAN, walk: WALK }),
  notes: state({ log: LONG.slice(-6), focus: MIGRATION, notes: NOTES }),
  dense: state({
    log: LONG, turnId: 't-dense', focus: KANBAN, walk: WALK, notes: NOTES, draft: DRAFT_KANBAN,
    settings: { ...FAKE_SETTINGS, live: true, model: 'opus' }, activity: { ...IDLE, phase: 'thinking' },
  }, true),
  closed: state({ log: HELLO }, false, false),
  heard: state({ log: HEARD }),
  spoken: state({ log: SPOKEN, focus: KANBAN }),
  actionQueue: state({ log: [...HELLO, ...QUEUE_LOG], pending: QUEUE }),
  actionAnswer: state({ log: [...HELLO, ...ANSWER_LOG], pending: ANSWER }),
  actionRound: state({ log: [...HELLO, ...ROUND_LOG], pending: ROUND }),
  actionRework: state({ log: [...HELLO, ...REWORK_LOG], focus: KANBAN, pending: REWORK }),
  actionOpen: state({ log: [...HELLO, ...OPEN_LOG], pending: OPEN }),
  actionClose: state({ log: [...HELLO, ...CLOSE_LOG], pending: CLOSE }),
  // The densest dock an action meets: a round's prompt and his answers above a draft that stays where it was.
  actionDraft: state({ log: [...HELLO, ...ANSWER_LOG], focus: KANBAN, draft: DRAFT_KANBAN, pending: ANSWER }),
};
