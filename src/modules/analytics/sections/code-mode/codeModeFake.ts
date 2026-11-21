import type { CodeModeAnalytics, CodeModeCause, CodeModeDay, CodeModeFigures, CodeModeGroup, CodeModeKind } from '@/shared/analytics-types';

/**
 * THE SCAFFOLD'S STAND-IN ANSWER, in the shape `code-mode analytics --days N` prints. It is here so the section draws
 * before its route is read: `fakeRead.ts` hands it to the frame as a reading. The fill deletes both files.
 *
 * THE WINDOW PICKS THE STATE, so the head's own window switch walks them:
 *  - 90 days is the dense one: six kinds on three models, 25 families of failure, a sentence at its full length.
 *  - 30 days is the usual one, with a history twelve days old: the banner over the parts.
 *  - 7 days is a quiet week on one model: the reviewers never ran without Code Mode, the planners never with it, and nothing failed.
 *  - 2 to 6 days hold no launch; 1 day has no history at all.
 *
 * Every figure is built up from one made-up cell per (day, kind, with or without, model), so the table, the readout
 * and the plot agree with each other. The "medians" here are means: it is a fake.
 */

const KINDS: CodeModeKind[] = [
  { kind: 'build', label: 'Builders' },
  { kind: 'review', label: 'Reviewers' },
  { kind: 'plan', label: 'Planners' },
  { kind: 'scaffold', label: 'Screen scaffolds' },
  { kind: 'docs', label: 'Doc writers' },
  { kind: 'heal', label: 'Heal chains' },
];
const UNCOUNTED: CodeModeKind[] = [
  { kind: 'chat', label: 'Chats' },
  { kind: 'inline', label: 'Inline builds' },
];
const MODELS = ['claude-sonnet-5', 'deepseek-v4-flash', 'claude-opus-5'];
const HELPERS = ['edit', 'write', 'bash', 'read', 'grep', 'tool', 'glob', 'blob', 'save'];
const FAULTS = ['threw', 'refused', 'failed'];
const HOOKS = ['freshness_guard', 'enforce_rm_literal_path', 'script_nudge', 'write_arbiter'];
const SUMMED = [
  'launches', 'ok', 'turns_total', 'tokens_in_total', 'tokens_out_total', 'seconds_total', 'merges_asked', 'merges_merged',
  'scripts', 'thrown', 'timed_out', 'refused', 'failed', 'declined', 'resent',
] as const;

type Sums = Pick<CodeModeFigures, (typeof SUMMED)[number]>;
type Cell = Sums & { day: string; kind: string; code_mode: boolean; model: string };

/** The same numbers on every render: a fixed seed, never the clock. */
function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

/** The fake's today is 2026-11-21. */
function dayBefore(back: number): string {
  return new Date(Date.UTC(2026, 10, 21 - back)).toISOString().slice(0, 10);
}

function cellOf(rand: () => number, day: string, kind: string, code_mode: boolean, model: string, quiet: boolean): Cell | null {
  const launches = Math.floor(rand() * 3.4);
  if (launches === 0) return null;
  const whole = (each: number, spread: number) => Math.round(launches * (each + rand() * spread));
  const scripts = code_mode ? whole(3, 4) : 0;
  const some = (share: number) => (quiet ? 0 : Math.floor(scripts * share * rand()));
  const thrown = some(0.14);
  const merges_asked = some(0.3);
  const declined = Math.floor(merges_asked * 0.12);
  return {
    day, kind, code_mode, model, launches,
    ok: launches - (rand() < (code_mode ? 0.08 : 0.18) ? 1 : 0),
    turns_total: code_mode ? whole(8, 8) : whole(15, 14),
    tokens_in_total: code_mode ? whole(140_000, 90_000) : whole(260_000, 160_000),
    tokens_out_total: code_mode ? whole(9_000, 6_000) : whole(11_000, 7_000),
    seconds_total: code_mode ? whole(290, 240) : whole(420, 380),
    merges_asked, merges_merged: merges_asked - declined, declined,
    scripts, thrown, timed_out: Math.floor(thrown * 0.25), resent: Math.floor(thrown * 0.6), refused: some(0.07), failed: some(0.05),
  };
}

function figuresOf(cells: Cell[]): CodeModeFigures {
  const sums = Object.fromEntries(SUMMED.map((key) => [key, cells.reduce((sum, cell) => sum + cell[key], 0)])) as Sums;
  const each = (total: number) => Math.round(total / Math.max(1, sums.launches));
  return {
    ...sums,
    turns: each(sums.turns_total),
    tokens_in: each(sums.tokens_in_total),
    tokens_out: each(sums.tokens_out_total),
    tokens: each(sums.tokens_in_total + sums.tokens_out_total),
    seconds: each(sums.seconds_total),
  };
}

function grouped<Key>(cells: Cell[], keyOf: (cell: Cell) => Key): { key: Key; cells: Cell[] }[] {
  const found = new Map<string, { key: Key; cells: Cell[] }>();
  for (const cell of cells) {
    const key = keyOf(cell);
    const entry = found.get(JSON.stringify(key)) ?? { key, cells: [] };
    entry.cells.push(cell);
    found.set(JSON.stringify(key), entry);
  }
  return Array.from(found.values());
}

/** A family's sentences as a journal would word them; the first of a thrown family runs to the journal's full 240 characters. */
function sentencesOf(fault: string, helper: string, hook: string): string[] {
  if (fault === 'refused') {
    return [
      'refused by ' + hook + ': ' + helper + '() on src/shared/types.ts, changed since it was read; read() it again or use edit()',
      'refused by ' + hook + ': ' + helper + '() names a path outside every project root',
      'refused by ' + hook + ': ' + helper + '() would leave a file the house does not allow',
    ];
  }
  if (fault === 'failed') {
    return [
      helper + '(): exit 2 from npm run typecheck after 118 s',
      helper + "(): ENOENT: no such file or directory, open 'src/modules/analytics/index.ts'",
      helper + '(): the server answered 502 ANALYTICS_SOURCE_FAILED',
    ];
  }
  if (fault === 'declined') {
    return ['the merger declined: both sides rewrote the same statement of useProjectsState.ts', 'the merger declined: the lines it was shown are no longer in the file'];
  }
  return [
    helper + "(): old text not found in src/modules/project-workspace/hooks/useWorkspaceViews.ts; the closest lines as they read now are 212-214: \"{ id: 'cerberus', group: 'house', icon: ShieldCheck, keywords: 'cerberus checks fleet health' },\" and two more",
    helper + '(): 3 matches for the old text in WorkspaceMain.tsx; pass {all:true} or lengthen it',
    "TypeError: Cannot read properties of undefined (reading 'stdout')",
  ];
}

function causesOf(byFault: Record<string, number>, kinds: CodeModeKind[], limit: number): CodeModeCause[] {
  const families = [
    { fault: 'declined', helper: 'edit', hook: 'merger' },
    ...HELPERS.flatMap((helper, at) => FAULTS.map((fault) => ({ fault, helper, hook: fault === 'refused' ? HOOKS[at % HOOKS.length] : '' }))),
  ].slice(0, limit);
  return families
    .map((family, at) => {
      const peers = families.filter((peer) => peer.fault === family.fault);
      const weight = peers.reduce((sum, _peer, index) => sum + 1 / (index + 1), 0);
      const count = Math.round((byFault[family.fault] ?? 0) / weight / (peers.indexOf(family) + 1));
      const top = sentencesOf(family.fault, family.helper, family.hook)
        .map((cause, index) => ({ cause, count: index === 0 ? Math.ceil(count / 2) : Math.floor(count / 2 ** (index + 1)) }))
        .filter((sentence) => sentence.count > 0);
      return {
        ...family,
        count,
        threw: family.fault === 'threw' ? count : Math.floor(count / 5),
        launches: Math.max(1, Math.ceil(count * 0.6)),
        kinds: kinds.slice(0, 1 + (at % 3)).map((kind) => kind.kind),
        top,
      };
    })
    .filter((cause) => cause.count > 0)
    .sort((a, b) => b.count - a.count);
}

export function fakeCodeModeAnswer(days: number): CodeModeAnalytics {
  const dense = days >= 60;
  const quiet = days < 30;
  const usual = !dense && !quiet;
  const kinds = KINDS.slice(0, dense ? 6 : quiet ? 3 : 5);
  const models = MODELS.slice(0, dense ? 3 : quiet ? 1 : 2);
  // How many days back the launches reach: none under a week, twelve in the usual window, the whole window otherwise.
  const reach = days < 7 ? 0 : usual ? 12 : days;
  const rand = seeded(days);

  const cells: Cell[] = [];
  for (let back = reach - 1; back >= 0; back -= 1) {
    for (const kind of kinds) {
      for (const model of models) {
        for (const code_mode of [true, false]) {
          const absent = quiet && ((kind.kind === 'plan' && code_mode) || (kind.kind === 'review' && !code_mode));
          const cell = absent ? null : cellOf(rand, dayBefore(back), kind.kind, code_mode, model, quiet);
          if (cell !== null) cells.push(cell);
        }
      }
    }
  }

  const order = (kind: string) => kinds.findIndex((entry) => entry.kind === kind);
  const groups: CodeModeGroup[] = grouped(cells, (cell) => [cell.kind, cell.code_mode, cell.model] as const)
    .map(({ key: [kind, code_mode, model], cells: held }) => ({ kind, code_mode, model, ...figuresOf(held) }))
    .sort((a, b) => order(a.kind) - order(b.kind) || Number(b.code_mode) - Number(a.code_mode) || a.model.localeCompare(b.model));
  const rollups: CodeModeGroup[] = [
    ...grouped(cells, (cell) => [cell.kind, cell.code_mode] as const).map(({ key: [kind, code_mode], cells: held }) => ({ kind, code_mode, model: null, ...figuresOf(held) })),
    ...grouped(cells, (cell) => cell.code_mode).map(({ key, cells: held }) => ({ kind: null, code_mode: key, model: null, ...figuresOf(held) })),
  ];
  const series: CodeModeDay[] = [
    ...grouped(cells, (cell) => [cell.day, cell.kind, cell.code_mode] as const).map(({ key: [day, kind, code_mode], cells: held }) => ({ day, kind, code_mode, ...figuresOf(held) })),
    ...grouped(cells, (cell) => [cell.day, cell.code_mode] as const).map(({ key: [day, code_mode], cells: held }) => ({ day, kind: null, code_mode, ...figuresOf(held) })),
  ];

  const withCodeMode = figuresOf(cells.filter((cell) => cell.code_mode));
  const byFault = Object.fromEntries(
    Object.entries({ threw: withCodeMode.thrown, refused: withCodeMode.refused, failed: withCodeMode.failed, declined: withCodeMode.declined }).filter(([, count]) => count > 0),
  );

  return {
    days,
    generated_at: Date.UTC(2026, 10, 21, 17, 30) / 1000,
    today: dayBefore(0),
    first_day: days < 2 ? null : usual ? dayBefore(reach - 1) : dayBefore(200),
    kinds,
    uncounted: UNCOUNTED,
    groups,
    rollups,
    series,
    faults: { total: Object.values(byFault).reduce((sum, count) => sum + count, 0), by_fault: byFault },
    causes: causesOf(byFault, kinds, dense ? 25 : 8),
  };
}
