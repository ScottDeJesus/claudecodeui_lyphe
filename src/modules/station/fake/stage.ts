import type { RoadmapFeature } from '@/shared/roadmap-types';
import type { DispatcherAsk, DispatcherPhase, DispatcherPlan } from '@/shared/types';

/*
 * THE STAGE'S FIXTURE DATA, for `station-fake.ts`'s pictures only: the feature whose Accept stands open in the
 * `waiting` picture, and the shipped feature the `home` picture shows in the roadmap's facts. Each is typed by the
 * wire it rides (`DispatcherPlan`, `RoadmapFeature`), every key the type carries, so the dispatcher's card and the
 * roadmap's facts draw them exactly as they draw the live ones. Nothing in the app imports this file.
 *
 * The Accept is what `dispatcher question kaylee-station--what-needs-you` printed (a pure read) for the station's
 * own right rail, with its lock's token and its `asked` replaced by ones no store has held (an id above 900000, as
 * `.verify/lib/ask-lane.mjs` keeps them): a press on it could only be refused `not-open`. The shipped feature is the
 * roadmap's `kaylee--eyes`, its goal cut to its first paragraph. Times are relative to when the fixture loads.
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
  'AT ITS HEAD, when one stands: the action waiting for his word. It is her card as her panel draws it: the act and its target, the prompt or his carried words, "Say “…”", when it lapses, and the × that withdraws it.',
  '',
  'UNDER IT, A STACKED INBOX in his order, each item showing its kind in words, what it is about, one line of it, its one act and the words that fire it.',
  '',
  'THE KINDS:',
  '- ACCEPT PROMPTS: a feature\'s or an epic\'s Accept. Act: Queue…. Words: “Queue <its name>”.',
  '- DESIGN QUESTIONS: a round of questions. Act: Answer…. Words: say your answers, then “Send the answers to <its name>”.',
  '- PERMISSION REQUESTS: a chat waiting on a tool\'s permission, a question it asked, or a plan to approve. Act: Allow…. Words: “Allow <chat>”.',
  '- FOLLOW-UPS: one item per chat that has open follow-ups. Act: Open. Words: “Open <chat>”.',
  '- RED CHECKS: a Cerberus check failing or denied. Act: Open. Words: “Open <check>”.',
  '',
  'PRESSING AN ITEM OR ITS ACT puts its whole on the stage, with the control that fires it in reach. Nothing fires from the rail itself, and nothing fires without his press or his spoken word.',
  '',
  'WHEN NOTHING WAITS: "Nothing needs you."',
  '',
  'Repo ~/.claude/claudecodeui_lyphe · Epic kaylee-station · Waits on kaylee-station--shell · 7 tasks in 5 waves · 7 decisions settled',
  '',
  '1. Everything that needs him, read whole on the server with the words that fire each — hephaestus/sonnet',
  '2. "Open <check>" is a word that fires — hephaestus/sonnet',
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
    task('read', 1, 'Everything that needs him, read whole on the server with the words that fire each', 'hephaestus'),
    task('open-checks', 2, '"Open <check>" is a word that fires', 'hephaestus'),
    task('provider', 3, 'The page keeps what needs him on events', 'hephaestus', ['read']),
    task('views', 4, '"What needs you", composed on fixtures', 'iris'),
    task('live', 5, '"What needs you", live in the right rail', 'hephaestus', ['provider', 'views']),
    task('whole', 6, '"What needs you", whole and by voice, on the hands\' stager', 'hephaestus', ['open-checks', 'live']),
    task('docs', 7, 'The docstore says what landed', 'prometheus', ['read', 'open-checks', 'provider', 'views', 'live', 'whole']),
  ],
};

/** One of the shipped feature's tasks, done: its key, its title, and when it was done, in minutes before now. */
const done = (key: string, title: string, minutesAgo: number) => ({ key, title, status: 'done' as const, done_at: ago(minutesAgo) });

/** The `home` picture's feature: shipped, and no longer one the dispatcher holds, so the roadmap's facts draw it. */
export const SHIPPED_FEATURE: RoadmapFeature = {
  name: 'kaylee--eyes', title: 'Kaylee\'s eyes', project: 'lyphecli', repo: '/home/lyphe/.claude/claudecodeui_lyphe',
  goal: 'Kaylee is my eyes, an extension of me: she can look at the roadmap, the runs, DocSpace, settings, the alerts history and the other panels the house exposes, read-only in the first pass, through companion tools described the way read_session and list_followups are, pulled on demand and digested through a dactyl when long, with nothing from them loaded into her context up front.',
  position: 9, blocked: null, word: 'shipped', step: 'shipped', waiting_on_you: null, waits_on: [],
  created_at: ago(2140), promoted_at: ago(2100), approved_at: ago(2030), shipped_at: ago(1560), runtime_s: 26556,
  cases: { total: 0, holding: 0, broken: 0, regressed: 0, not_run: 0, cant_run: 0 },
  tasks: [
    done('wire', 'The action on the wire and in storage: the pending action and the open in both mirrors of the contract', 1960),
    done('house', 'The house handed in: the readers only a module instance holds, handed to every tool', 1970),
    done('eyes', 'The eyes\' shared seam: one capped list, one whole-or-digest, one panel card, his clock\'s words', 1968),
    done('roadmap-reads', 'Her eyes on the roadmap: `list_roadmap` and `read_card` in the Roadmap tab\'s own words', 1905),
    done('run-reads', 'Her eyes on the runs: `list_runs` and `read_run` over the dispatcher\'s runs and the souls a chat launched', 1909),
    done('doc-reads', 'Her eyes on DocSpace: `search_docs` and `read_doc` through ArchPulse\'s own search and page reads', 1925),
    done('alerts', 'What the house told him, kept and read: a notification history and `list_alerts` over it', 1926),
    done('panel-reads', 'Her eyes on four more panels: `read_kanban`, `read_heal`, `read_notes` and `read_schedules`', 1917),
    done('git-reads', 'The git panel\'s status and per-file diff as a service, a pure move, every answer byte-identical', 1978),
    done('house-reads', 'Her eyes on the rest of the house: `read_git`, `read_cerberus`, `read_memory` and `read_settings`', 1880),
    done('relay', 'Her doors into the dispatcher and the runs: a third door `kaylee` in the ask book carrying his press', 1943),
    done('word', 'His word, checked: the pure check that his spoken line came after her read-back and names the target', 1900),
    done('hands', 'Her hands, on his word: `prepare_action`, `take_action` and `cancel_action` over twelve actions', 1773),
    done('card', 'The action card, composed: "Waiting for your word" in the warn tone with the action and its target', 1710),
    done('card-fill', 'The card live and the opens answered: a `companion_open` answered by the page that holds the floor', 1665),
    done('docs', 'The docs say what landed: the eyes, the hands, her record of actions and the alerts history', 1634),
    done('whole', 'Kaylee\'s eyes and hands, whole and live: one read through each of her fifteen eyes on the dev server', 1560),
  ],
};
