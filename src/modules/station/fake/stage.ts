import type { DispatcherAsk, DispatcherPhase, DispatcherPlan } from '@/shared/types';

/*
 * THE STAGE'S FIXTURE DATA, for `station-fake.ts`'s pictures only: the feature whose Accept stands open in the
 * `waiting` picture. It is typed by the wire it rides (`DispatcherPlan`), every key the type carries, so the
 * dispatcher's card draws it exactly as it draws a live one. Nothing in the app imports this file. (`home`'s stage, the
 * chat he pressed, is the left rail's own: `fake/sessions.ts`.)
 *
 * The Accept is what `dispatcher question kaylee-station--what-needs-you` printed (a pure read) for the station's
 * own right rail, with its lock's token and its `asked` replaced by ones no store has held (an id above 900000, as
 * `.verify/lib/ask-lane.mjs` keeps them): a press on it could only be refused `not-open`. Times are relative to when
 * the fixture loads.
 */

const NOW = Date.now();
const ago = (minutes: number): string => new Date(NOW - minutes * 60_000).toISOString().replace(/\.\d{3}Z$/, 'Z');

const WAITING_PLAN = 'kaylee-station--what-needs-you';

/** The census as the dispatcher prints it: the first line, what it delivers, the facts line, the tasks, the lock's line. */
const CENSUS = [
  `${WAITING_PLAN} — 7 tasks`,
  '',
  '"What needs you", the station\'s right rail.',
  '',
  'AT ITS HEAD, when one stands: the action waiting for his word. It is her card as her panel draws it: the act and its target, the prompt or his carried words, when it lapses, and the × that withdraws it.',
  '',
  'UNDER IT, A STACKED INBOX in his order, each item showing its kind in words, what it is about, one line of it and its one act.',
  '',
  'THE KINDS:',
  '- ACCEPT PROMPTS: a feature\'s or an epic\'s Accept. Act: Queue….',
  '- DESIGN QUESTIONS: a round of questions. Act: Answer….',
  '- PERMISSION REQUESTS: a chat waiting on a tool\'s permission, a question it asked, or a plan to approve. Act: Allow….',
  '- FOLLOW-UPS: one item per chat that has open follow-ups. Act: Open.',
  '- RED CHECKS: a Cerberus check failing or denied. Act: Open.',
  '',
  'PRESSING AN ITEM OR ITS ACT puts its whole on the stage, with the control that fires it in reach. Nothing fires from the rail itself, and nothing fires without his word.',
  '',
  'WHEN NOTHING WAITS: "Nothing needs you."',
  '',
  'Repo ~/.claude/claudecodeui_lyphe · Epic kaylee-station · Waits on kaylee-station--shell · 7 tasks in 5 waves · 7 decisions settled',
  '',
  '1. Everything that needs him, read whole on the server — hephaestus/sonnet',
  '2. A red check opens on its own stage — hephaestus/sonnet',
  '3. The page keeps what needs him on events — hephaestus/sonnet — after 1',
  '4. "What needs you", composed on fixtures — iris/opus',
  '5. "What needs you", live in the right rail — hephaestus/sonnet — after 3, 4',
  '6. "What needs you", whole and by voice, on the hands\' stager — hephaestus/sonnet — after 2, 5',
  '7. The docstore says what landed — prometheus/sonnet — after 1, 2, 3, 4, 5, 6',
  '',
  'Run it? · lock:station-fake-0000000000',
].join('\n');

/** The lock the waiting feature owes: the census and the intent lock's three answers, in their contract order. */
const ACCEPT: DispatcherAsk = {
  plan: WAITING_PLAN,
  plans: [WAITING_PLAN],
  asked: { id: 900101, at: ago(6) },
  kind: 'accept',
  header: 'Intent lock',
  question: CENSUS,
  token: 'lock:station-fake-0000000000',
  options: [
    { label: 'Queue — starts on its turn', description: 'Record the verdict and put the run in the queue; it starts when its turn comes.' },
    { label: 'Hide — held until shown', description: 'Record the verdict and keep the run hidden, not started; Show on the Hidden list puts it back in the queue.' },
    { label: 'Rework', description: 'Send your notes back to the feature\'s designer; nothing launches.' },
  ],
  rework: [WAITING_PLAN],
};

/** One of the waiting feature's tasks, not started: its key, its place, its title, its soul and what it waits on. */
const task = (key: string, position: number, title: string, assignee: string, waitsOn: string[] = []): DispatcherPhase => ({
  key, position, title, assignee, status: 'not started', chain_id: null, done_at: null, waits_on: waitsOn, busy: false,
  stalled: null, rounds: 0, cost_usd: 0, paid_vendor: null, tokens: 0, tokens_in: 0, tokens_out: 0, tokens_cache_read: null,
  start_here: [], stages: [],
});

/** The `waiting` picture's feature: cut (`loaded`), owing its Accept, nothing approved, nothing run. */
export const WAITING_FEATURE: DispatcherPlan = {
  name: WAITING_PLAN, state: 'loaded', status: 'idle', hidden: null, repo: '/home/lyphe/.claude/claudecodeui_lyphe',
  goal: '3. RIGHT RAIL — "What needs you". A stacked inbox: Accept prompts, design questions with options, permission requests, follow-ups she filed, health checks that are red.',
  delivers: '"What needs you", the station\'s right rail.', session: null, session_app_id: null, author: null,
  arc: 'kaylee-station', planner: null, model: 'claude', model_own: null, posture: 'claude route', queue_hold: null,
  pace_hold: '', overridden: false, created_at: ago(170), updated_at: ago(6), completed_at: null, prompted_at: ago(6),
  paused: false, launched: false, stalled: null, approved: null, accept_armed: null, design_loaded_at: ago(40),
  asking: ACCEPT, waits_on: ['kaylee-station--shell'], schedule: null, cost_usd: 0, paid_vendor: null, tokens: 0,
  tokens_in: 0, tokens_out: 0, tokens_cache_read: null, runtime_s: 0, rounds: 0, events: [],
  phases: [
    task('read', 1, 'Everything that needs him, read whole on the server', 'hephaestus'),
    task('open-checks', 2, 'A red check opens on its own stage', 'hephaestus'),
    task('provider', 3, 'The page keeps what needs him on events', 'hephaestus', ['read']),
    task('views', 4, '"What needs you", composed on fixtures', 'iris'),
    task('live', 5, '"What needs you", live in the right rail', 'hephaestus', ['provider', 'views']),
    task('whole', 6, '"What needs you", whole and by voice, on the hands\' stager', 'hephaestus', ['open-checks', 'live']),
    task('docs', 7, 'The docstore says what landed', 'prometheus', ['read', 'open-checks', 'provider', 'views', 'live', 'whole']),
  ],
};
