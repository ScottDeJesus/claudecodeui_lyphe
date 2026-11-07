import fs from 'node:fs';
import path from 'node:path';

/**
 * The BYTES behind one launcher-soul launch directory — `~/.claude/state/dispatch-souls/<launch id>/`.
 *
 * Nothing here decides what a launch MEANS; `soul-launch.service.ts` does. This module owns the
 * disk, the parse and the two liveness questions, and answers `null`-ish values rather than
 * throwing: a directory being written while we read it is a normal event on a live state root,
 * and one torn read must never cost the lane its other launches.
 *
 * THE LAYOUT IS THE LAUNCHER'S, NOT OURS (`~/.claude/hooks/plan_runner/solo/`): `spec.json` is
 * written before the fork and is the whole contract of the launch; `result.json` is written by
 * the detached half when the child ends, and its ABSENCE is how "the soul is still out" is
 * spelled; `brief.md` is the task it was handed; `launcher.pid` and `child.pid` name the two
 * processes that carry it; `child.log` is the child's own stream-json, whose first events name the
 * model it was served. We read those and invent none of them.
 */

/** How much of a brief is read for the one line the pin shows. A brief is a task, not a corpus. */
const BRIEF_HEAD_BYTES = 4096;

/**
 * How much is read when that head turns out to be ALL preamble.
 *
 * A brief written by a conductor opens with one banner block per subject — the estate's constraints,
 * then the repo's guidance, then the project's context — and those blocks run past four kilobytes
 * routinely: of the four real briefs that opened this way, one put its task line 232 bytes beyond
 * the cap above. So the head is re-read at this size before the pin gives up, and this is the ONLY
 * path that reads a second time: an ordinary brief still costs one small read, and this costs one
 * larger one only for the briefs whose first four kilobytes say nothing about the task.
 */
const BRIEF_PREAMBLE_BYTES = 16 * 1024;

/**
 * How much of a child's log is read for the model it announced: the `system` `init` event, the CLI's
 * first line once its start-up hooks answer. It ended at byte 12,422 at the furthest of the newest 400
 * logs on disk, so 64 KiB is five times the worst case and a sliver of a log that grows to megabytes.
 */
const CHILD_LOG_HEAD_BYTES = 64 * 1024;

/** Picks the init line out of a head full of long hook events, so only that one line is ever parsed. */
const INIT_EVENT_MARK = /"subtype"\s*:\s*"init"/;

/** The needle `/proc/<pid>/cmdline` must carry for a pid to still be the process we recorded. */
const LAUNCHER_NEEDLE = 'soul-run';
const CHILD_NEEDLE = 'claude';

/** A bulleted item in a brief: how the conductor writes the body of a block it heads with a banner. */
const BULLET = /^[-*]\s/;

/** What one launch directory holds, as read. */
export type SoulLaunchFiles = {
  /** The directory's own name, which IS the launch id (`<launch dir>/<id>`). */
  launchId: string;
  /** Parsed `spec.json`, or `null` when absent or unreadable — a launch with no spec is not one. */
  spec: unknown;
  /** Parsed `result.json`, or `null` while the soul is still out. */
  result: unknown;
  /** Whether the detached half that owes `result.json` is still running. */
  launcherAlive: boolean;
  /** Whether the `claude` child itself is still running. */
  childAlive: boolean;
  /** The brief's first meaningful line, for the pin's description. `''` when it cannot be read. */
  briefLine: string;
  /** The model the child announced on its log's init event; `''` until it has, when the log names none, or when no log read was asked for ({@link readLaunchFiles}). */
  servedModel: string;
};

/** A `readdir` failure — a state root that does not exist yet — is an empty lane, not a fault. */
export function listLaunchDirs(root: string, notOlderThanMs: number): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }

  const names: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    // AGED OUT BY THE DIRECTORY'S OWN mtime, before a single file inside it is opened. That stamp
    // is NOT the launch's last activity — writing a file does not touch its parent's mtime, only
    // creating, removing or renaming one there does — so what it holds is when this directory's
    // ENTRIES were last written: the spec, the pids and the brief at launch, and the receipt at
    // the end. For a running launch it is therefore frozen at its start, which is exactly the age
    // this window wants, and it is safe against a live soul only because the two constants are
    // ordered: the launcher caps every child at one hour (`solo/record.py:HOUR_S`) and this window
    // is six. RAISE THE CAP PAST THE WINDOW and a soul still out would be dropped from the lane
    // mid-run, with the strip's row going with it.
    try {
      if (fs.statSync(path.join(root, entry.name)).mtimeMs < notOlderThanMs) continue;
    } catch {
      continue; // vanished between the listing and the stat
    }
    names.push(entry.name);
  }
  // Ascending by name, and the launcher mints `<stem>-<YYYYmmdd-HHMMSS>-<hex>` — so this is
  // ascending by start, which keeps two launches of the same second in a stable order instead of
  // swapping places between ticks and broadcasting a change that is not one.
  return names.sort();
}

/** One field of a parsed JSON record, without asserting the record is one. */
function field(record: unknown, name: string): unknown {
  return record !== null && typeof record === 'object' ? (record as Record<string, unknown>)[name] : undefined;
}

/**
 * Parsed JSON from a file, or `null` for absent, unreadable, or not-an-object.
 *
 * Exported for `chain-record.transport.ts`, which reads the walker's `chain.json` under the same
 * rule: a file being written while we read it is a normal event, and it answers `null`.
 */
export function readJson(file: string): unknown {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    return parsed !== null && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Whether `<pid>` is STILL the process the launcher recorded, proved by its command line.
 *
 * A pid is reused, so the number alone proves nothing; the needle is what the launcher's own
 * reaper asks (`solo/record.py:owns`) and the ONLY test that cannot mistake a stranger for a soul.
 * A missing file, a dead pid and a recycled pid all answer `false`, which reads downstream as
 * "this launch's wrapper is gone".
 */
function owns(dir: string, name: string, needle: string): boolean {
  try {
    const pid = Number(fs.readFileSync(path.join(dir, name), 'utf8').trim());
    if (!Number.isInteger(pid) || pid <= 0) return false;
    return fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').includes(needle);
  } catch {
    return false;
  }
}

/** The front of a file, as text — and whether the file had more beyond it. `''` when unreadable. */
function readHead(file: string, bytes: number): { text: string; truncated: boolean } {
  try {
    // A partial read, not `readFileSync(...).slice()`: the file is the conductor's and may be a
    // megabyte, and this is asking for one line off the front of it.
    const handle = fs.openSync(file, 'r');
    try {
      const buffer = Buffer.alloc(bytes);
      const read = fs.readSync(handle, buffer, 0, bytes, 0);
      return { text: buffer.toString('utf8', 0, read), truncated: read === bytes };
    } finally {
      fs.closeSync(handle);
    }
  } catch {
    return { text: '', truncated: false };
  }
}

/** A brief's meaningful lines: trimmed, any leading markdown marker stripped, blanks dropped. */
function briefLines(head: string): string[] {
  return head
    .split('\n')
    .map((raw) => raw.trim().replace(/^#+\s*/, '').trim())
    .filter((line) => line !== '');
}

/**
 * Where the brief stops being preamble: the index of the first line that is NOT part of a leading
 * banner block, or `-1` when the lines given are nothing but banners and their bullets.
 *
 * A banner is a line whose own colon closes it with a bulleted item as the next thing written, and
 * the blocks come in a STACK rather than one at a time — a real dispatch brief heads three or four
 * subjects before it says what the soul is actually for. So the walk repeats: skipping one banner
 * and landing on another leaves the pin reading "CloudCLI repository guidance (…, verbatim)" where
 * the task should be, which is the same defect one block further down.
 */
function taskLineIndex(lines: string[]): number {
  let index = 0;
  while (index < lines.length && lines[index].endsWith(':') && BULLET.test(lines[index + 1] ?? '')) {
    index += 1;
    while (index < lines.length && BULLET.test(lines[index])) index += 1;
  }
  return index < lines.length ? index : -1;
}

/** The task line inside one head's text, or `null` when that head holds nothing but preamble. */
function taskLineIn(text: string): string | null {
  const lines = briefLines(text);
  const index = taskLineIndex(lines);
  return index >= 0 ? (lines[index] ?? null) : null;
}

/**
 * The brief's first meaningful line, skipping the preamble blocks that head it.
 *
 * Never the whole file: the pin shows one truncated line, so four kilobytes is already generous —
 * and when those four kilobytes turn out to be nothing but preamble, one larger read is taken
 * before giving up ({@link BRIEF_PREAMBLE_BYTES}). A brief that is nothing but its own banners
 * keeps the first of them: better the document's own heading than a line lifted out of its middle.
 */
export function readBriefLine(file: string): string {
  const head = readHead(file, BRIEF_HEAD_BYTES);
  const here = taskLineIn(head.text);
  if (here !== null) return here;
  // All preamble so far. Read more — unless there is no more, in which case this brief is nothing
  // but its own banners and keeps the first of them: better the document's own heading than a line
  // lifted out of the middle of it.
  if (!head.truncated) return briefLines(head.text)[0] ?? '';
  const whole = readHead(file, BRIEF_PREAMBLE_BYTES).text;
  return taskLineIn(whole) ?? briefLines(whole)[0] ?? '';
}

/** The model a `system`/`init` event line announces; `''` for a line that is anything else, or torn. */
function modelOfInitLine(line: string): string {
  try {
    const event: unknown = JSON.parse(line);
    if (field(event, 'type') !== 'system' || field(event, 'subtype') !== 'init') return '';
    const model = field(event, 'model');
    return typeof model === 'string' ? model.trim() : '';
  } catch {
    // A line cut by the head's cap, or one the child is still writing: it names nothing yet.
    return '';
  }
}

/**
 * The model the child announced on the init event at the front of its `child.log`, or `''`.
 *
 * The log is the CLI's own stream-json, so that `model` is the id it was served (`claude-sonnet-5-5`),
 * there seconds after the launch and long before the receipt. It is what names a soul that took the
 * default model (`spec.json` says `model: ""`) while it runs. Only the head of the log is read.
 */
function readServedModel(dir: string): string {
  const head = readHead(path.join(dir, 'child.log'), CHILD_LOG_HEAD_BYTES);
  for (const line of head.text.split('\n')) {
    if (!INIT_EVENT_MARK.test(line)) continue;
    const model = modelOfInitLine(line);
    if (model !== '') return model;
  }
  return '';
}

/**
 * One launch's `spec.json` alone, or `null` — the whole contract of the launch, and the one file
 * that names who launched it (`launched_by`). Exported for `running-launchers.service.ts`, which
 * asks a chain's stage launches who owns them and has no use for their pids or briefs.
 */
export function readLaunchSpec(dir: string): unknown {
  return readJson(path.join(dir, 'spec.json'));
}

/**
 * Whether the launch has written its receipt. `result.json`'s ABSENCE is how "the soul is still out"
 * is spelled, so a launch that has one has ended and can never read `running` — which lets a caller
 * that wants only the running ones skip the rest with one `stat` instead of the full read.
 * Exported for `running-launchers.service.ts`; the verdict itself stays `classifyLaunch`'s.
 */
export function hasLaunchReceipt(dir: string): boolean {
  return fs.existsSync(path.join(dir, 'result.json'));
}

/**
 * The model the child's log announced, read once per launch: a launch's served model never changes, so
 * what a read finds is kept in `kept` (launch id → model). An EMPTY answer is kept only for an ended
 * launch — a running one has not announced yet, while an ended launch's log is final.
 */
function servedModelOf(dir: string, launchId: string, ended: boolean, kept: Map<string, string>): string {
  const known = kept.get(launchId);
  if (known !== undefined) return known;
  const served = readServedModel(dir);
  if (served !== '' || ended) kept.set(launchId, served);
  return served;
}

/**
 * Everything the lane reads out of one launch directory. Never throws: a torn read answers empty.
 *
 * `servedModelByLaunchId` is the lane's memory of what each child's log announced, owned by the
 * composition root. A caller that reads only a launch's state or words (`running-launchers.service.ts`,
 * `run-reads.service.ts`) omits it, and no log is opened for them.
 */
export function readLaunchFiles(
  dir: string,
  launchId: string,
  servedModelByLaunchId?: Map<string, string>,
): SoulLaunchFiles {
  const spec = readLaunchSpec(dir);
  const result = readJson(path.join(dir, 'result.json'));
  const briefPath = field(spec, 'brief_path');
  return {
    launchId,
    spec,
    result,
    launcherAlive: owns(dir, 'launcher.pid', LAUNCHER_NEEDLE),
    childAlive: owns(dir, 'child.pid', CHILD_NEEDLE),
    briefLine: typeof briefPath === 'string' ? readBriefLine(briefPath) : '',
    servedModel: servedModelByLaunchId === undefined
      ? ''
      : servedModelOf(dir, launchId, result !== null, servedModelByLaunchId),
  };
}
