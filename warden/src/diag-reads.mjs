// The three reads a diagnosis has — `log.read`, `file.read`, `status.read` — as a fixed menu. There is no tool that
// runs a string: a read is one of the argv lines in `STATUS_MENU`, `journalctl` for one validated unit, or this
// process opening a path that passed `diag-guard.mjs`. Each answers `{ ok, text, truncated }`. `diag-tools.mjs` masks every
// text it sends, but a read that CUTS a text masks it first and cuts only on a whole line, so no cut leaves half a secret
// for that later mask to miss; `contains` filters the MASKED text, so a filter can never confirm a guess at a secret.
//
//   log.read     { unit | path, sinceMin = 15 (1..1440), lines = 200 (1..500), contains? }
//                unit → `journalctl -u <unit> --since "-<n> min" -n <lines> --no-pager -o short-iso`
//                path → the last `lines` lines of the file; `contains` keeps the lines holding it (any case)
//   file.read    { path, maxBytes = 65536 (1..65536) } → a regular text file's head, or a directory's listing (200 entries,
//                each with its mtime as local time and offset — the form center gives the model for every other moment).
//                The head is whole lines: `maxBytes` and up to 4 KiB more are read and masked, then it ends on the last line
//                that fits `maxBytes`; a file whose first line runs past `maxBytes` answers "(its first line runs past … bytes)"
//   status.read  { what, name? } → one line of `STATUS_MENU`; `name` only for `unit`
import fs from 'node:fs';

import { maskSecrets, resolveReadable } from './diag-guard.mjs';
import { OUTPUT_CAP_BYTES } from './diag-argv.mjs';
import { localStamp } from './local-time.mjs';

const UNIT_NAME = /^[A-Za-z0-9@._-]+$/;
const MAX_LISTING_ENTRIES = 200;
/** How much of a file's end `log.read` looks at: the last lines of any log live inside it. */
const TAIL_WINDOW_BYTES = 256 * 1024;
/** How far past `maxBytes` `file.read` reads before it masks: a secret the cut would halve is whole in what the mask sees. */
const MASK_ROOM_BYTES = 4 * 1024;
const MAX_CONTAINS_CHARS = 200;
/** What an empty file answers: an `ok: true` with no text at all could not be told from a read that went wrong. */
const EMPTY_FILE = '(the file is empty)';

const STATUS_MENU = {
  unit: (name) => ['systemctl', ['status', name, '--no-pager', '-n', '0']],
  failed_units: () => ['systemctl', ['list-units', '--type=service', '--state=failed', '--no-pager']],
  containers: () => ['docker', ['ps', '--format', '{{.Names}}\t{{.Status}}']],
  disks: () => ['df', ['-h']],
  memory: () => ['free', ['-m']],
  uptime: () => ['uptime', []],
  listening: () => ['ss', ['-ltn']],
};

const refuse = (text) => ({ ok: false, text, truncated: false });

/** The whole number `value` is (or `fallback` when it is absent), or the sentence saying what range it must be in. */
function wholeNumber(value, fallback, max, name) {
  if (value === undefined || value === null) return { number: fallback };
  if (!Number.isInteger(value) || value < 1 || value > max) return { problem: `${name} must be a whole number from 1 to ${max}` };
  return { number: value };
}

/** A unit name that is safe as a program argument: the pattern, and never a leading `-` (an option to systemctl or journalctl). */
const isUnitName = (unit) => typeof unit === 'string' && UNIT_NAME.test(unit) && !unit.startsWith('-') && unit.length <= 256;

/**
 * Text with only the lines containing `needle` (any case). A miss says how much was looked at: it is the answer a diagnosis
 * would cite as "no such line", and a read covers only the latest lines, never the whole log.
 */
function keepLines(text, needle, scope) {
  const wanted = needle.toLowerCase();
  const all = text.split('\n');
  const kept = all.filter((line) => line.toLowerCase().includes(wanted));
  if (kept.length) return kept.join('\n');
  return `(no line contains "${needle}" among the ${all.length} read — this read covers only ${scope}, so it does not show the text is absent from the log)`;
}

/** Whether `buffer` is not text: a NUL byte, or a share of bytes that are not UTF-8 beyond a stray one. */
function looksBinary(buffer) {
  if (buffer.includes(0)) return true;
  const text = buffer.toString('utf8');
  const broken = text.split('�').length - 1;
  return broken > Math.max(2, text.length * 0.02);
}

/**
 * Up to `length` bytes of `file` from `position`, read until the file ends or the buffer is full — the length is never
 * `stat().size`, which is 0 for a `/proc` file and one page for a `/sys` one. One descriptor, opened without blocking
 * (a FIFO would otherwise hold the open).
 */
function readSlice(file, position, length) {
  const descriptor = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);
  try {
    const buffer = Buffer.alloc(length);
    let filled = 0;
    while (filled < length) {
      const got = fs.readSync(descriptor, buffer, filled, length - filled, position + filled);
      if (got === 0) break;
      filled += got;
    }
    return buffer.subarray(0, filled);
  } finally {
    fs.closeSync(descriptor);
  }
}

/** `{ stats }` of a path that is a regular file or a directory, else `{ refusal }` — a device, a socket or a FIFO is neither. */
function statReadable(target) {
  const stats = fs.statSync(target.real);
  if (stats.isFile() || stats.isDirectory()) return { stats };
  return { refusal: `${target.requested} is not a regular file or a directory` };
}

function listDirectory(target) {
  const names = fs.readdirSync(target.real).sort();
  const lines = ['name\ttype\tsize\tmtime'];
  for (const name of names.slice(0, MAX_LISTING_ENTRIES)) {
    const label = name.replace(/[\u0000-\u001f\u007f]/g, '?');
    try {
      const entry = fs.lstatSync(`${target.real}/${name}`);
      const type = entry.isDirectory() ? 'dir' : entry.isSymbolicLink() ? 'symlink' : entry.isFile() ? 'file' : 'other';
      lines.push(`${label}\t${type}\t${entry.size}\t${localStamp(entry.mtimeMs)}`);
    } catch (error) {
      lines.push(`${label}\t?\t?\t(${error.code ?? error.name})`);
    }
  }
  const more = names.length - MAX_LISTING_ENTRIES;
  if (more > 0) lines.push(`… and ${more} more entries`);
  return { ok: true, text: lines.join('\n'), truncated: more > 0 };
}

async function readFileTool(args, { wardenHome }) {
  const limit = wholeNumber(args.maxBytes, OUTPUT_CAP_BYTES, OUTPUT_CAP_BYTES, 'maxBytes');
  if (limit.problem) return refuse(limit.problem);
  const target = resolveReadable(args.path, wardenHome);
  if (target.refusal) return refuse(target.refusal);
  const found = statReadable(target);
  if (found.refusal) return refuse(found.refusal);
  if (found.stats.isDirectory()) return listDirectory(target);
  // `maxBytes` plus the room the mask needs to see a secret the cut would halve; one byte more tells a file that goes on
  // from one that ends exactly here.
  const reach = limit.number + MASK_ROOM_BYTES;
  const read = readSlice(target.real, 0, reach + 1);
  if (read.length === 0) return { ok: true, text: EMPTY_FILE, truncated: false };
  // Binary is judged on the head that can be returned: a NUL only in the mask's lookahead is not in the answer.
  if (looksBinary(read.subarray(0, limit.number))) return refuse(`Refused: ${target.requested} is a binary file`);
  return headOfFile(read.subarray(0, reach), read.length > reach, limit.number);
}

/**
 * A file's head as whole lines of at most `maxBytes` bytes. `window` is what was read — `maxBytes` and up to `MASK_ROOM_BYTES`
 * more — and `goesOn` says the file continues past it. The window is masked BEFORE the cut, so a secret that straddles
 * `maxBytes` (`postgres://app:S3cret` with its `@host` just past it) is whole when the mask meets it; then the head ends on the
 * last whole line that fits. `truncated` is true whenever the file goes on past what is returned.
 */
function headOfFile(window, goesOn, maxBytes) {
  // A read that stopped mid-file stopped mid-line too: that last line is not whole, so it is not part of the head.
  const read = goesOn ? window.subarray(0, window.lastIndexOf(10) + 1) : window;
  const masked = Buffer.from(maskSecrets(read.toString('utf8')), 'utf8');
  let kept = masked;
  if (masked.length > maxBytes) {
    // The last line break within reach of the cap ends the last whole line that fits (one at `maxBytes` ends a line of exactly that size).
    kept = masked.subarray(0, Math.max(masked.subarray(0, maxBytes + 1).lastIndexOf(10), 0));
  } else if (goesOn && masked.at(-1) === 10) {
    kept = masked.subarray(0, -1);
  }
  const truncated = goesOn || kept.length < masked.length;
  if (truncated && kept.length === 0) return { ok: true, text: `(its first line runs past ${maxBytes} bytes)`, truncated: true };
  return { ok: true, text: kept.toString('utf8'), truncated };
}

/**
 * The last `lines` lines of a file; the window's first line is dropped when the window began mid-file, since it is cut.
 * The whole window is masked BEFORE either cut — the last `lines` lines, then 64 KB from its front (the newest lines stay)
 * with the line the cut went through dropped (a newest line that alone passes 64 KB answers "(its last line runs past …)") —
 * so a private-key block whose `BEGIN` line the line cut would leave out is
 * masked while it is still whole, and a secret the 64 KB cut halves cannot keep its value's tail with its key word gone.
 * A block that began before the window's own first byte is masked from the window's start through its `END` line
 * (`maskSecrets`): a tail window runs to the newest line, so it holds the `END` of any key whose body it shows.
 */
function tailOfFile(target, stats, lines) {
  if (!stats.isFile()) return refuse(`${target.requested} is a directory: log.read reads a file or a unit`);
  // `stats.size` only places the window; the read itself goes to the end of the file (a `/proc` file stats as 0).
  const start = Math.max(0, stats.size - TAIL_WINDOW_BYTES);
  let window = readSlice(target.real, start, TAIL_WINDOW_BYTES);
  if (start > 0) window = window.subarray(window.indexOf(10) + 1);
  if (looksBinary(window)) return refuse(`Refused: ${target.requested} is a binary file`);
  const all = maskSecrets(window.toString('utf8')).split('\n');
  if (all.at(-1) === '') all.pop();
  const bytes = Buffer.from(all.slice(-lines).join('\n'), 'utf8');
  if (bytes.length === 0) return { ok: true, text: EMPTY_FILE, truncated: false };
  if (bytes.length <= OUTPUT_CAP_BYTES) return { ok: true, text: bytes.toString('utf8'), truncated: false };
  const cutAt = bytes.length - OUTPUT_CAP_BYTES;
  let kept = bytes.subarray(cutAt);
  if (bytes[cutAt - 1] !== 10) {
    // The cut went through a line: it is dropped. No line break in what is left means the newest line alone is past the cap.
    const lineBreak = kept.indexOf(10);
    if (lineBreak < 0) return { ok: true, text: `(its last line runs past ${OUTPUT_CAP_BYTES} bytes)`, truncated: true };
    kept = kept.subarray(lineBreak + 1);
  }
  return { ok: true, text: kept.toString('utf8'), truncated: true };
}

async function readLogTool(args, { run, wardenHome }) {
  // A key the caller left out may arrive as null: it is as absent as undefined.
  const unit = args.unit ?? undefined;
  const filePath = args.path ?? undefined;
  if ((unit === undefined) === (filePath === undefined)) return refuse('log.read needs a unit or a path, one of the two');
  const lines = wholeNumber(args.lines, 200, 500, 'lines');
  if (lines.problem) return refuse(lines.problem);
  const sinceMin = wholeNumber(args.sinceMin, 15, 1440, 'sinceMin');
  if (sinceMin.problem) return refuse(sinceMin.problem);
  const needle = args.contains ?? undefined;
  if (needle !== undefined && (typeof needle !== 'string' || needle === '' || needle.length > MAX_CONTAINS_CHARS)) {
    return refuse(`contains must be a text of 1 to ${MAX_CONTAINS_CHARS} characters`);
  }

  let answer;
  let scope;
  if (unit !== undefined) {
    if (!isUnitName(unit)) return refuse('unit must be a systemd unit name: letters, digits and @ . _ -, not starting with -');
    answer = await run('journalctl', ['-u', unit, '--since', `-${sinceMin.number} min`, '-n', String(lines.number), '--no-pager', '-o', 'short-iso']);
    scope = `the latest ${lines.number} journal lines of the last ${sinceMin.number} min`;
  } else {
    const target = resolveReadable(filePath, wardenHome);
    if (target.refusal) return refuse(target.refusal);
    const found = statReadable(target);
    if (found.refusal) return refuse(found.refusal);
    answer = tailOfFile(target, found.stats, lines.number);
    scope = `the last ${lines.number} lines of the file`;
  }
  if (!answer.ok || needle === undefined) return answer;
  return { ...answer, text: keepLines(maskSecrets(answer.text), needle, scope) };
}

async function readStatusTool(args, { run }) {
  const { what, name } = args;
  if (typeof what !== 'string' || !Object.hasOwn(STATUS_MENU, what)) return refuse(`what must be one of ${Object.keys(STATUS_MENU).join(', ')}`);
  if (what === 'unit' && !isUnitName(name)) return refuse('what "unit" needs a name: a systemd unit name, letters, digits and @ . _ -, not starting with -');
  const [binary, argv] = STATUS_MENU[what](name);
  return run(binary, argv);
}

/**
 * The tools by their wire name. Each takes `(args, { run, wardenHome })` — `run(binary, argv)` is the argv spawn
 * (`startArgv`, tracked by the caller so a closing diagnosis can kill it) — and answers `{ ok, text, truncated }`.
 */
export const READ_TOOLS = {
  'log.read': readLogTool,
  'file.read': readFileTool,
  'status.read': readStatusTool,
};
