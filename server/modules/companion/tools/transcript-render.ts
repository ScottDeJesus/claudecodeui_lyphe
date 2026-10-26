import { spawn } from 'node:child_process';
import { lstatSync, mkdirSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { userFacingEnv } from '@/shared/child-env.js';
import { describeToolCall } from '@/shared/tool-call-hint.js';
import type { NormalizedMessage } from '@/shared/types.js';

/**
 * How the companion reads anything longer than one turn: a chat's turns are rendered to a markdown file under her
 * scratch and a dactyl answers one fixed brief about it. The dactyl numbers the lines it is handed, so its `L<n>` is
 * a line of the file written here; its 16,000-byte budget and quote lines pass through untouched.
 * Consumers: `read-tools.ts` (`read_session`, `ask_dactyl`) and `feeds/focus-feed.ts`, in the companion module.
 */

//----------------- THE FOUR FIXED BRIEFS ------------

/** The brief for the digest of a long last reply. Consumer: `read-tools.ts`'s `read_session` with scope `last_turn`. */
export const LAST_TURN_DIGEST_BRIEF =
  'What did this reply report: what got done, what changed, what it needs from the operator. Count any list and give each item in one line. At most 15 lines; cite L<n>.';

/** The brief for the digest of a session's last ten turns. Consumer: `read-tools.ts`'s `read_session` with scope `recent`. */
export const RECENT_DIGEST_BRIEF =
  'What has this session been doing: the threads of work, the decisions made, what is still open. At most 15 lines; cite L<n>.';

/** The brief for a phrase search, with `<phrase>` where the phrase goes — fill it with `phraseDigestBrief`. Consumer: `read-tools.ts`'s `read_session` with a phrase for scope. */
export const PHRASE_DIGEST_BRIEF = 'What does this session say about: <phrase>? At most 12 lines; cite L<n>.';

/** The brief for a focus session's finished reply. Consumer: `feeds/focus-feed.ts`, which hands the digest to her as the session's news. */
export const FOCUS_NEWS_BRIEF =
  'In at most 5 lines: what this reply reports was done, what changed, and what it needs from the operator; cite L<n>.';

/** The longest phrase a brief carries, in characters: it is a topic, and the brief is a sentence. */
const PHRASE_MAX_CHARACTERS = 200;

/**
 * `PHRASE_DIGEST_BRIEF` with the phrase in it, folded to one line, cut at 200 characters, and placed by a replacer
 * function so a `$&` in it stays text. Consumer: `read-tools.ts`, for the phrase scope of `read_session`.
 */
export function phraseDigestBrief(phrase: string): string {
  const topic = phrase.replace(/\s+/g, ' ').trim().slice(0, PHRASE_MAX_CHARACTERS);
  return PHRASE_DIGEST_BRIEF.replace('<phrase>', () => topic);
}

//----------------- RENDERING TURNS TO A FILE ------------

/** One turn on its way to the file: his message, then what the reply said and did, in order. */
type RenderedTurn = {
  at: string | null;
  /** `null` when the rows begin mid-turn (a page of history cut before his message). */
  said: string | null;
  reply: Array<{ kind: 'text'; text: string } | { kind: 'call'; line: string }>;
  calls: number;
};

/** A transcript's text as one safe block: CRLF folded to LF, NUL dropped (the dactyl refuses a file with one as binary). */
const cleanText = (text: string): string => text.replace(/\u0000/g, '').replace(/\r\n?/g, '\n').trim();

/** A row's time as `YYYY-MM-DD HH:MM UTC`, or `null` when the row carries none that parses. */
function stampOf(timestamp: string | undefined): string | null {
  const parsed = timestamp ? new Date(timestamp) : null;
  return parsed && !Number.isNaN(parsed.getTime()) ? `${parsed.toISOString().slice(0, 16).replace('T', ' ')} UTC` : null;
}

/** The opening of the notice the CLI injects as a "user" row when a background command finishes: its words, not his. */
const BACKGROUND_NOTICE_PREFIX = '<task-notification>';

/**
 * Groups rows into turns: one opens at his text message and holds every reply row until the next (other kinds are
 * neither said nor done). A background-task notice is no message of his: it joins the turn it belongs to, labelled,
 * so the turns counted are his messages and a digest never reads it as his words.
 */
function groupTurns(rows: NormalizedMessage[]): RenderedTurn[] {
  const turns: RenderedTurn[] = [];
  let current: RenderedTurn | null = null;

  const turnFor = (row: NormalizedMessage): RenderedTurn => {
    if (current === null) {
      current = { at: stampOf(row.timestamp), said: null, reply: [], calls: 0 };
      turns.push(current);
    }
    return current;
  };

  for (const row of rows) {
    const notice = row.kind === 'text' && row.role === 'user' && (row.content ?? '').trimStart().startsWith(BACKGROUND_NOTICE_PREFIX);
    if (row.kind === 'text' && row.role === 'user' && !notice) {
      current = { at: stampOf(row.timestamp), said: cleanText(row.content ?? ''), reply: [], calls: 0 };
      turns.push(current);
    } else if (row.kind === 'text' && (row.role === 'assistant' || notice)) {
      const text = cleanText(row.content ?? '');
      if (!text) continue;
      const label = notice ? '(a background task notice, not his words)\n' : row.isCompactSummary === true ? '(the conversation was compacted here; its summary)\n' : '';
      turnFor(row).reply.push({ kind: 'text', text: label + text });
    } else if (row.kind === 'tool_use') {
      const turn = turnFor(row);
      turn.reply.push({ kind: 'call', line: describeToolCall(row.toolName ?? 'tool', row.toolInput) });
      turn.calls += 1;
    }
  }
  return turns;
}

/** The reply in order: a blank line between blocks of text, and a run of tool calls kept together, one per line. */
function replyBlocks(reply: RenderedTurn['reply']): string {
  return reply.reduce((out, part, index) => {
    const joiner = index === 0 ? '' : part.kind === 'call' && reply[index - 1].kind === 'call' ? '\n' : '\n\n';
    return out + joiner + (part.kind === 'call' ? part.line : part.text);
  }, '');
}

/** One turn as markdown: a heading, what he said, the reply in order, and the count of tool calls. */
function renderTurn(turn: RenderedTurn, number: number): string {
  const heading = turn.at ? `## Turn ${number} — ${turn.at}` : `## Turn ${number}`;
  const said = turn.said === null ? '(before this window)' : turn.said || '(no text — attachments only)';
  const reply = replyBlocks(turn.reply) || '(none)';
  return `${heading}\n\nHe said:\n${said}\n\nReply:\n${reply}\n\nTool calls: ${turn.calls}\n`;
}

/**
 * Writes `rows` — as `sessionsService.fetchHistory` answers them — to `file` as markdown and answers how many turns
 * it holds: a heading per turn, his text and the reply's text in full, each tool call as one line
 * (`<tool> <short hint>`), the turn's calls counted. It ends with the newline the dactyl's line numbers count against.
 * Synchronous on purpose (a few kilobytes, handed straight to `runDactylRead`); the folder must exist
 * (`companionScratchDir`); zero turns still writes a file, so the caller judges the count.
 * Consumers: `read-tools.ts` (`read_session`) and `feeds/focus-feed.ts`.
 */
export function renderTurns(sessionId: string, rows: NormalizedMessage[], file: string): number {
  const turns = groupTurns(rows);
  const title = `# Session ${sessionId.replace(/\s+/g, ' ').trim()} — ${turns.length} ${turns.length === 1 ? 'turn' : 'turns'}\n`;
  const body = turns.map((turn, index) => renderTurn(turn, index + 1));
  writeFileSync(file, [title, ...body].join('\n'), 'utf8');
  return turns.length;
}

//----------------- THE DACTYL ------------

/** Where the dactyl lives: the house's own script, which names the model and refuses what it must. */
const DACTYL_SCRIPT = path.join(os.homedir(), '.claude', 'scripts', 'dactyl');

/** How long one call may run before the dactyl is stopped: a read of eight files is a fan-out of model calls. */
const DACTYL_TIMEOUT_MS = 180_000;

/** After the stop request, how long the dactyl has to hand it to its children before it is killed outright. */
const DACTYL_KILL_GRACE_MS = 5_000;

/** The dactyl's answer: its stdout, or the sentence that says why there is none. */
export type DactylReadResult = { ok: true; text: string } | { ok: false; error: string };

/** A dactyl report without the spend line under each headline (model, effort, turns, tokens): never hers to say (Ruling 17). */
const withoutSpendLines = (stdout: string): string => {
  const lines = stdout.split('\n');
  return lines
    .filter((line, at) => !(at > 0 && /^[✓✗] dactyl --read /.test(lines[at - 1]) && /^ {2}\S.* \(served .*\) · .* · \d+ turns · \d+s\b/.test(line)))
    .join('\n');
};

/** The `✗` lines of a dactyl report: its own words for a refusal or for a file it could not answer. */
const failureLines = (stdout: string): string =>
  stdout
    .split('\n')
    .filter((line) => line.startsWith('✗'))
    .join('\n');

/**
 * Runs `~/.claude/scripts/dactyl --read <files…> --brief - [--context <file>]` with the brief on stdin and
 * answers what it printed, bounded at 180 s, in `userFacingEnv()`.
 *
 * - Exit 0: every file was answered; the answer is its stdout (16,000-byte budget, quote lines in it), less the
 *   spend line under each headline.
 * - Exit 2 or 3: it refused before reading anything; the error is its own `✗` line.
 * - Exit 1: some file was not answered. Stdout holds a `✓` block per answered file and a `✗` block per other, so
 *   with any answer in it the stdout is returned whole; with none, the `✗` lines are the error.
 * - Past the bound it is stopped (SIGTERM, which it hands to its children; SIGKILL after 5 s); a failed spawn
 *   is told. Both answer a sentence. Paths are made absolute, so a name is never read as one of its options.
 * Consumers: `read-tools.ts` (`read_session` digests, `ask_dactyl`) and `feeds/focus-feed.ts`.
 */
export function runDactylRead(files: string[], brief: string, context?: string): Promise<DactylReadResult> {
  return new Promise((resolve) => {
    const args = ['--read', ...files.map((file) => path.resolve(file)), '--brief', '-'];
    if (context) args.push('--context', path.resolve(context));

    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(DACTYL_SCRIPT, args, { env: userFacingEnv(), stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (error) {
      resolve({ ok: false, error: `The reader could not be started: ${error instanceof Error ? error.message : String(error)}` });
      return;
    }

    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let timedOut = false;
    let settled = false;
    let killTimer: NodeJS.Timeout | undefined;
    const timedOutResult = (): DactylReadResult => ({ ok: false, error: `The reader took longer than ${DACTYL_TIMEOUT_MS / 1000} seconds and was stopped.` });
    const finish = (result: DactylReadResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(stopTimer);
      clearTimeout(killTimer);
      resolve(result);
    };

    const stopTimer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      killTimer = setTimeout(() => child.kill('SIGKILL'), DACTYL_KILL_GRACE_MS);
    }, DACTYL_TIMEOUT_MS);

    child.stdout?.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr?.on('data', (chunk: Buffer) => stderr.push(chunk));
    // A dactyl that refuses on its arguments exits without reading stdin: the write then fails with EPIPE, which
    // unhandled is an uncaught exception. Its exit code says what happened.
    child.stdin?.on('error', () => {});
    child.on('error', (error) => finish({ ok: false, error: `The reader could not be started: ${error.message}` }));
    // `close` waits for the stdio pipes, which a descendant of the dactyl can hold open past the stop; the bound
    // must not wait on them, so a stopped call is answered when the dactyl itself has exited (`exit` comes first).
    child.on('exit', () => {
      if (timedOut) finish(timedOutResult());
    });

    child.on('close', (code, signal) => {
      const printed = withoutSpendLines(Buffer.concat(stdout).toString('utf8').trimEnd());
      if (code === 0 || (code === 1 && /^✓ /m.test(printed))) {
        finish({ ok: true, text: printed });
      } else if (code === null) {
        finish({ ok: false, error: `The reader was stopped by ${signal ?? 'a signal'} before it answered.` });
      } else {
        const said = failureLines(printed) || Buffer.concat(stderr).toString('utf8').trim().split('\n')[0];
        finish({ ok: false, error: said || `The reader stopped with exit code ${code} and said nothing.` });
      }
    });

    child.stdin?.end(brief);
  });
}

//----------------- HER SCRATCH FOLDER ------------

/**
 * Her scratch folder, `~/.claude/state/companion/<user id>/scratch`, made if absent. The id becomes a path
 * segment, so it must be a plain positive number. Consumers: `read-tools.ts`, which renders each digest's file
 * here, and `ask_dactyl`'s path rules, which let a dactyl read it.
 */
export function companionScratchDir(userId: string | number): string {
  const id = String(userId);
  if (!/^[1-9]\d*$/.test(id)) throw new Error(`The companion's scratch folder belongs to an account number; got "${id}".`);
  const dir = path.join(os.homedir(), '.claude', 'state', 'companion', id, 'scratch');
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Keeps the newest `keep` files of `dir` (20 unless told) and unlinks the rest; answers how many it removed.
 * Only regular files directly inside `dir` are looked at — a folder or a link is left alone, nothing is removed
 * recursively. Newest is by modification time, ties broken by name. A vanished file is not a failure, and a
 * missing folder holds nothing to prune. Consumer: `read-tools.ts`, after each render.
 */
export function pruneScratch(dir: string, keep = 20): number {
  if (!Number.isInteger(keep) || keep < 0) {
    throw new RangeError(`pruneScratch keeps a whole number of files, 0 or more; got ${keep}.`);
  }

  let names: string[];
  try {
    names = readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0;
    throw error;
  }

  const dated: Array<{ name: string; modified: number }> = [];
  for (const name of names) {
    try {
      dated.push({ name, modified: lstatSync(path.join(dir, name)).mtimeMs });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  dated.sort((a, b) => b.modified - a.modified || (a.name < b.name ? 1 : -1));

  let removed = 0;
  for (const stale of dated.slice(keep)) {
    try {
      unlinkSync(path.join(dir, stale.name));
      removed += 1;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.error(`[Companion] could not remove the scratch file ${stale.name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  return removed;
}
