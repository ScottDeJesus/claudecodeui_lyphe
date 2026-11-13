import type { HealSessionsAnswer } from '@/modules/heal';
import { PEOPLE, RUN_1007, RUN_DENSE, RUN_EVERY, RUN_TEST } from '@/modules/upload-runs/uploads-fake-runs';
import type { RunSheetRead } from '@/modules/upload-runs/utils/uploadsModel';
import type { UploadConfirmation, UploadRunEvent, UploadRunSummary, UploadRunWhole, UploadWalk, UploadWalkStep } from '@/shared/upload-runs-types';

/*
 * THE FAKE SHEETS: one run whole, its events and its heal answer, for each run a fixture opens. Deleted with the fill, as
 * `uploads-fake-runs.ts` is. MODELLED ON THE REAL RECORD: the 2026-10-07 run's events are its own 56, condensed to the ones
 * that tell its story (the skill load, the contract reads, the one Bash call that failed, the question it stopped on), with
 * the customer's name left out; its heal answer is `heal-reflex --sessions 551d51cd…` as answered on 2026-11-13 (one
 * tool-error row, claimed by heal-tool-error-20261008-030237-22b0, no fix line). The steps are the flows' own step names and
 * statuses, and their reasons are the walker's own sentences. COMPOSED: every other run's events, walks and confirmations.
 */

const iso = (ms: number) => new Date(ms).toISOString();
type Step = [step: string | null, status: string, reason?: string];
const steps = (list: Step[]): UploadWalkStep[] => list.map(([step, status, reason]) => ({ step, status, reason: reason ?? null }));

function walk(id: string, flow: string, armed: boolean, outcome: string, bumpy: boolean | null, list: Step[], at: string, more: Partial<UploadWalk> = {}): UploadWalk {
  return {
    id, archetype: flow, variant: null, mode: armed ? 'execute' : 'dry_run', armed, outcome, bumpy, refused_count: list.filter(([, status]) => status.startsWith('refused')).length,
    generated_by: 'upload_runner:invocation:00000000-0000-4000-8000-000000a11c0d', created_at: at, updated_at: at, cleared_at: null, steps: steps(list), ...more,
  };
}

const CLEAN_STEPS: Step[] = [
  ['wc_note', 'fired'], ['sla_notes_wc', 'skipped_idempotent'], ['wc_snapshot', 'fired'], ['apa_onsite', 'fired'], ['xact_dates', 'fired'], ['apa_contact', 'fired'],
  ['xact_report_text', 'fired'], ['drying_report', 'fired'], ['sla_notes_f9', 'skipped_idempotent'], ['xact_attach', 'fired'], ['wc_unlock', 'fired'],
  ['wc_upload', 'refused', 'press_held: the upload is pressed by its own act, after a person confirms this walk'],
];
const HALTED_STEPS: Step[] = [
  ['direct_bill_check', 'verified'], ['verify_time_chain', 'verified'],
  ['verify_date_alignment', 'blocked_missing_facts', 'WC and Xactimate dates are not aligned: date_received differs (WC 2026-10-06, Xactimate 2026-10-05); customer_called is not entered in Xactimate'],
  ['rejection_prevention_gate', 'verified'],
  ['invoice_request', 'blocked_missing_facts', 'cannot send the invoice request: the amount to invoice is unresolved (the inspection-fee estimate has no synced grand_total yet)'],
  ['photo_transfer', 'skipped_idempotent'], ['sketch_upload', 'refused', 'no parsed drying report or XA sketch: nothing to transcribe'],
  ['drybook_complete', 'failed', 'close legs accepted but drying-complete verify did not read true: an unresolved blocker likely refused the close'],
  [null, 'unreadable'],
];

function confirmation(n: number, walkId: string, at: string, more: Partial<UploadConfirmation> = {}): UploadConfirmation {
  return {
    grant_id: `00000000-0000-4000-8000-0000000c0f${String(n).padStart(2, '0')}`, walk_id: walkId, action_type: 'wc_upload_press', confirmed_by: PEOPLE[0], confirmed_at: at,
    granted_via: 'eis_app', expires_at: iso(Date.parse(at) + 3_600_000), revoked_at: null, revoke_reason: null, bookkeeping_revoke: false, consumed_at: null, consumed_by_run_id: null, ...more,
  };
}

/** A run's events, written as a script: each call adds the next event `gap` seconds after the last, its seq in order. */
function script(startedAt: string) {
  const out: UploadRunEvent[] = [];
  let at = Date.parse(startedAt);
  const push = (kind: string, role: string, body: Partial<UploadRunEvent>, gap: number) => {
    at += gap * 1000;
    out.push({ seq: out.length + 1, ts: iso(at), kind, role, ...body });
  };
  return {
    out,
    sys: (kind: string, meta?: Record<string, unknown>, text?: string, gap = 1) => push(kind, 'system', { ...(meta && { meta }), ...(text !== undefined && { text }) }, gap),
    say: (text: string, gap = 3) => push('assistant_text', 'agent', { text }, gap),
    tool: (name: string, summary: string, ok = true, said = '', gap = 2) => {
      const id = `toolu_${String(out.length).padStart(6, '0')}`;
      push('tool_use', 'agent', { tool: { id, name, summary, ok: null } }, gap);
      push('tool_result', 'agent', { tool: { id, name: null, summary: said, ok } }, 1);
    },
    answer: (text: string, by: string) => push('operator_text', 'operator', { text, truncated: null, meta: { by } }, 95),
  };
}

const QUESTION = 'The upload stops here on the one decision the flow hands to you: nobody has named which initial flow this job runs, and I do not pick that alone.\n\nThe runner raised it as a formal question, and the server confirms it is holding it. Tell me blank_initial or complete_initial and I will carry on.';

function events1007(): UploadRunEvent[] {
  const s = script(RUN_1007.started_at);
  s.sys('agent_init', { cwd: '/opt/shadow-connector', model: 'claude-fable-5-1', tool_count: 51, permission_mode: 'bypassPermissions', claude_code_version: '2.1.292' }, undefined, 0);
  s.say('I\'m the upload driver for this job, 2610-518903WTR. First I\'ll load the upload skill and the driver contract, then run the preflight against what the brief already holds.', 7);
  s.tool('Skill', 'upload 2610-518903WTR initial upload, archetype unstamped', true, 'Launching skill: upload', 1);
  s.sys('rate_limit', { status: 'allowed', resets_at: 1791402600, overage_status: 'rejected', rate_limit_type: 'five_hour' }, undefined, 0);
  s.sys('injected_text', undefined, 'Base directory for this skill: /opt/shadow-connector/.claude/skills/upload\n\n# Upload — what a human decides\n\nThe upload process is an AUTOMATED SYSTEM with a few designed AI seats, not an AI-drive', 0);
  s.say('Loading the domain bundle and the driver contract before I act.', 2);
  s.tool('Bash', '~/.claude/scripts/docstore get MAN-898 --text 2>&1 | head -150', true, 'MAN-898 manual house:projects/-opt-shadow-connector/memory | domain-uploads');
  s.tool('Bash', 'sed -n 4573,4660p docs/MANUAL.md', true, 'section: DRIVER_CONTRACT/000 Who this is for You are an AI driving a WorkCenter job upload.');
  s.tool('Bash', 'venv/bin/python scripts/upload.py next "2610-518903WTR"; echo "EXIT=$?"', true, '2610-518903WTR · no flow named · initial NEXT: stop — nobody has chosen which upload flow this job runs', 21);
  s.tool('Bash', 'venv/bin/python scripts/upload.py notes "2610-518903WTR" 2>&1 | head -120', true, 'workcenter_journal_notes · Work Center Service · Daily Narrative Summary for 10/6/2026: Loss Type: Water');
  s.say('Still gathering: reading how `run` opens the archetype question, and which initial flows the registry offers.', 24);
  s.tool('Bash', 'venv/bin/python - <<\'EOF\' from core.upload_policies import registry for name, pol in registry.ARCHETYPES.items(): ut = getattr(pol, "upload_type", None)', false, 'Exit code 1 Traceback (most recent call last): File "<stdin>", line 4, in <module> TypeError: unsupported format string passed to tuple.__format__');
  s.say('Reading the initial-flow option list the question would carry.', 2);
  s.tool('Bash', 'venv/bin/python - <<\'EOF\' from core.upload_engine.obligation_resolver import INITIAL_ARCHETYPES, FINAL_ARCHETYPES', true, 'INITIAL: [\'blank_initial\', \'complete_initial\', \'unknown\'] FINAL: [\'full_final\', \'invoice_only_final\']');
  s.tool('Bash', 'venv/bin/python scripts/upload.py run "2610-518903WTR" --upload-type initial --invocation-id 040d1818-4e6c-4146-bcf0-f612fb2cf494', true, '2610-518903WTR · no flow named · initial NEXT: stop — nobody has chosen which upload flow this job runs', 43);
  s.tool('Bash', 'venv/bin/python scripts/upload.py wait "2610-518903WTR"; echo "EXIT=$?"', true, 'CONFIRMED: the server is holding 1 matching OPEN wait(s): operator 6ad5d559… Nothing is stranded — post the status line and end your turn.', 16);
  s.say(QUESTION, 12);
  s.sys('turn_end', { subtype: 'success', is_error: false, sentinel: false, num_turns: 23, closing_ask: true, duration_ms: 158602, stop_reason: 'end_turn', terminal_reason: 'completed' }, undefined, 0);
  return s.out;
}

function eventsTest(): UploadRunEvent[] {
  const s = script(RUN_TEST.started_at);
  s.sys('session_started', { pid: 266179, dry_run: true }, undefined, 0);
  s.sys('brief', undefined, 'This is a DRY RUN of the upload-agent launch path. It exists to prove the plumbing works — the spawn, the transcript reader, the live stream to the browser, and the model this service pins — WITHOUT touching a job.\n\nThere is no job, no customer, no approval grant and no upload here. You have been given NO tools at all.', 0);
  s.sys('state', { from: 'starting', to: 'running', reason: 'init' });
  s.sys('agent_init', { model: 'claude-opus-5-5', tool_count: 0 }, undefined, 0);
  s.say('Hello from the upload-agent dry run.\n\nUPLOAD-RUN-COMPLETE: dry run — nothing was touched', 5);
  s.sys('rate_limit', { status: 'allowed', rate_limit_type: 'seven_day' }, undefined, 0);
  s.sys('turn_end', { sentinel: true, closing_ask: false, terminal_reason: 'completed' }, undefined, 0);
  s.sys('state', { from: 'running', to: 'complete', reason: 'sentinel' }, undefined, 0);
  s.sys('session_ended', { rc: 0, state: 'complete', reason: 'sentinel', terminal_reason: 'completed' }, undefined, 0);
  return s.out;
}

/** 1,500 events of a long final upload: steps of the flow, two questions with their answers, a quiet spell, a rate limit, stream trouble, and one kind this build has no words for. */
function eventsDense(): UploadRunEvent[] {
  const s = script(RUN_DENSE.started_at);
  s.sys('session_started', { pid: 30412 }, undefined, 0);
  s.sys('brief', undefined, 'You are the upload driver for a FINAL upload. The job, its flow and what the operator has already confirmed are below.\n\nRun the flow through the runner. Stop and ask when the flow hands a decision to a person.', 0);
  s.sys('state', { from: 'starting', to: 'running', reason: 'init' });
  s.sys('agent_init', { model: 'claude-opus-5-5', tool_count: 51 }, undefined, 0);
  const calls = ['venv/bin/python scripts/upload.py next "2608-436177WTR"', 'venv/bin/python scripts/upload.py prepare "2608-436177WTR" --upload-type final', 'sed -n 120,180p scripts/upload_runner/MANUAL.md', 'venv/bin/python scripts/upload.py wait "2608-436177WTR"'];
  for (let round = 0; s.out.length < 1488; round += 1) {
    if (round % 9 === 0) s.say(`Leg ${Math.floor(round / 9) + 1} of the final: reading what the server holds before the next step.`);
    s.tool('Bash', calls[round % calls.length], round % 97 !== 41, round % 97 === 41 ? 'Exit code 2 upload.py: error: the wait is no longer open' : 'ok · the server holds what the step expects');
    if (round === 611) { s.sys('quiet', { seconds: 184 }, undefined, 184); s.sys('rate_limit', { status: 'rejected', rate_limit_type: 'five_hour' }, undefined, 0); }
    if (round === 640) s.sys('stream_error', { count: 1 }, 'Unterminated string in JSON at position 4096', 0);
    if (round === 655) s.sys('walk_progress', { step: 'invoice_request' }, 'invoice_request · blocked_missing_facts', 0);
    if (round === 590 || round === 700) {
      s.say(round === 590 ? 'The invoice amount is unresolved: the inspection-fee estimate has no synced total yet. Do you want me to wait for the sync, or send the request without it?' : 'The drying report needs one more reading before it can be generated. Shall I generate it as it stands?');
      s.sys('state', { from: 'running', to: 'awaiting_input', reason: 'closing_ask' }, undefined, 0);
      s.answer(round === 590 ? 'Wait for the sync, then carry on.' : 'Yes, generate it as it stands.', PEOPLE[0]);
      s.sys('state', { from: 'awaiting_input', to: 'running', reason: 'operator_text' }, undefined, 0);
    }
  }
  // Filled to 1,497 so the three closing events below make exactly 1,500.
  while (s.out.length < 1497) s.say('Every leg has landed. Posting the closing line.');
  s.sys('turn_end', { sentinel: true, closing_ask: false, terminal_reason: 'completed' }, undefined, 0);
  s.sys('state', { from: 'running', to: 'complete', reason: 'sentinel' }, undefined, 0);
  s.sys('session_ended', { rc: 0, state: 'complete', reason: 'sentinel', terminal_reason: 'completed' }, undefined, 0);
  return s.out.slice(0, 1500);
}

const TRANSCRIPT = '/home/lyphe/.claude/projects/-opt-shadow-connector';
const HEAL_1007: HealSessionsAnswer = {
  sessions: ['551d51cd-d696-4716-bf2e-c6172f6a1cbc'],
  items: [{
    id: 34292, ts: 1791396748.041, kind: 'tool-error', klass: null, source: 'index', soul: false, tool: 'Bash',
    detail: 'Exit code 1\nTraceback (most recent call last):\n  File "<stdin>", line 4, in <module>\nTypeError: unsupported format string passed to tuple.__format__',
    transcript: `${TRANSCRIPT}/551d51cd-d696-4716-bf2e-c6172f6a1cbc.jsonl`, transcript_line: 94, ignored: false,
    session: '551d51cd-d696-4716-bf2e-c6172f6a1cbc', claimed_by: 'heal-tool-error-20261008-030237-22b0', regression: null,
  }],
  heals: [{
    id: 'heal-tool-error-20261008-030237-22b0', kind: 'tool-error', status: 'done', reason: 'cycle:cycle-20261008-030003-e92e', started_at: 1791453757.67, ended_at: 1791457628.43,
    builder: '—', athena: null, closed: 207, shapes_claimed: 134, spikes: 9, cost_usd: 0, chain_id: 'heal-tool-error-20261008-030239', tokens: 0, tokens_in: 0, tokens_out: 0,
    signatures_claimed: ['bash-placeholder: <tool_use_error>error: no such tool available: bash-placeholder</tool_use_error>', 'bash: """upload_completion.confirm — the confirm: a human looks at what the prepare landed and says good.', 'bash: # core/upload_engine/obligation_resolver.py # core/upload_policies/full_final.py'],
    claimed_here: [34292], cured_here: [], fix_said: null,
  }],
};

/** Three rows for one run: one a landed heal cured (with its builder's line), one a running heal claimed, one that came back after a heal (the regression). */
function healEvery(session: string): HealSessionsAnswer {
  const item = (id: number, detail: string, more: Partial<HealSessionsAnswer['items'][number]>) => ({
    id, ts: 1792775900 + id, kind: 'tool-error', klass: null, source: 'index', soul: false, tool: 'Bash', detail,
    transcript: `${TRANSCRIPT}/${session}.jsonl`, transcript_line: 200 + id, ignored: false, session, claimed_by: null, regression: null, ...more,
  });
  const heal = (id: string, status: 'done' | 'running', more: Partial<HealSessionsAnswer['heals'][number]>) => ({
    id, kind: 'tool-error', status, reason: 'cycle:cycle-20261022-030004-71ad', started_at: 1792836000, ended_at: status === 'done' ? 1792838400 : null, builder: 'hephaestus · claude-sonnet-5-5',
    athena: status === 'done' ? { blocking: 0, high: 0, medium: 1, low: 2 } : null, closed: status === 'done' ? 12 : 0, signatures_claimed: ['bash: upload.py: error: the wait is no longer open'], shapes_claimed: 1,
    spikes: 0, cost_usd: 0.41, chain_id: `${id}-chain`, claimed_here: [], cured_here: [], fix_said: null, ...more,
  });
  return {
    sessions: [session],
    items: [
      item(41, 'Exit code 2\nupload.py: error: the wait is no longer open', { claimed_by: 'heal-tool-error-20261022-030210-9c1e', klass: 'recurring' }),
      item(42, 'Exit code 1\nTypeError: unsupported format string passed to tuple.__format__', { claimed_by: 'heal-tool-error-20261023-030155-4b7a', regression: { heal_id: 'heal-tool-error-20261008-030237-22b0', signature: 'bash: typeerror: unsupported format string passed to tuple.__format__', since: 1792775942 } }),
      item(43, 'The runner refused a second prepare while the first still held the slot', { source: 'rail', tool: null, ignored: true }),
    ],
    heals: [
      heal('heal-tool-error-20261022-030210-9c1e', 'done', { claimed_here: [41], cured_here: [41], fix_said: 'The runner\'s wait verb now says which wait closed and why, and the upload skill tells the driver to re-read `next` instead of calling `wait` again.' }),
      heal('heal-tool-error-20261023-030155-4b7a', 'running', { claimed_here: [42] }),
    ],
  };
}

function wholeOf(entry: UploadRunSummary): UploadRunWhole {
  const at = entry.ended_at ?? entry.started_at;
  if (entry.session_id === RUN_EVERY.session_id) {
    const halted = walk('00000000-0000-4000-8000-00000000a002', 'full_final', true, 'halted', true, HALTED_STEPS, at);
    const landed = walk('00000000-0000-4000-8000-00000000a003', 'invoice_only_final', true, 'completed', true, CLEAN_STEPS, at, { variant: 'pause_the_clock' });
    const press = walk('00000000-0000-4000-8000-00000000a004', 'post_press_final', true, 'completed', false, [['wc_upload', 'fired'], ['verify_landed', 'verified']], iso(Date.parse(at) + 2_400_000));
    return {
      run: entry,
      walks: [walk('00000000-0000-4000-8000-00000000a001', 'full_final', false, 'preview_complete', null, CLEAN_STEPS.slice(0, 11), entry.started_at), halted, landed],
      after: [
        confirmation(1, landed.id, iso(Date.parse(at) + 600_000), { revoked_at: iso(Date.parse(at) + 900_000), revoke_reason: 'the job\'s estimate changed after the walk: confirm the new walk instead' }),
        confirmation(2, landed.id, iso(Date.parse(at) + 1_500_000), { revoked_at: iso(Date.parse(at) + 1_560_000), revoke_reason: 'replaced by a newer confirmation', bookkeeping_revoke: true }),
        confirmation(3, landed.id, iso(Date.parse(at) + 1_800_000), { consumed_at: iso(Date.parse(at) + 2_400_000), consumed_by_run_id: press.id }),
      ],
      presses: [press],
    };
  }
  if (entry.verdict === 'live') return { run: entry, walks: [walk('00000000-0000-4000-8000-00000000b001', entry.archetype ?? 'blank_initial', false, 'intent', null, CLEAN_STEPS.slice(0, 5), entry.started_at)], after: [], presses: [] };
  if (entry.walks.total === 0) return { run: entry, walks: [], after: [], presses: [] };
  const armed = walk('00000000-0000-4000-8000-00000000c002', entry.archetype ?? 'full_final', true, 'completed', false, CLEAN_STEPS, at);
  return { run: entry, walks: [walk('00000000-0000-4000-8000-00000000c001', entry.archetype ?? 'full_final', false, 'preview_complete', false, CLEAN_STEPS.slice(0, 11), entry.started_at), armed], after: [], presses: [] };
}

/**
 * The sheet's read for a run, in the state a fixture asks for: `ready`, the run's own read still out (`loading`), the lane
 * failed (`trouble`), or the run read and the heal ledger not (`healFailed`).
 */
export function fakeSheet(entry: UploadRunSummary, state: 'ready' | 'loading' | 'trouble' | 'healFailed' = 'ready'): RunSheetRead {
  const blank: RunSheetRead = { phase: 'loading', whole: null, events: [], hasEarlier: false, live: false, friction: null, frictionFailed: false, trouble: null };
  if (state === 'loading') return blank;
  if (state === 'trouble') return { ...blank, phase: 'trouble', trouble: 'The upload engine did not answer in 10 s.' };
  const sid = entry.session_id;
  const all = sid === RUN_1007.session_id ? events1007() : sid === RUN_DENSE.session_id ? eventsDense() : sid === RUN_TEST.session_id ? eventsTest() : eventsDense().slice(0, entry.verdict === 'live' ? 52 : 40);
  const session = entry.claude_session_id ?? '';
  const friction = sid === RUN_1007.session_id ? HEAL_1007 : sid === RUN_EVERY.session_id ? healEvery(session) : { sessions: [session], items: [], heals: [] };
  // A composed run's count is the events composed for it; the 2026-10-07 run keeps its real 56 over the condensed script.
  const counted = sid === RUN_1007.session_id ? entry : { ...entry, counts: { ...entry.counts, events: all.length } };
  return {
    phase: 'ready', whole: wholeOf(counted), events: all.slice(-500), hasEarlier: all.length > 500, live: entry.verdict === 'live',
    friction: state === 'healFailed' ? null : friction, frictionFailed: state === 'healFailed', trouble: null,
  };
}
