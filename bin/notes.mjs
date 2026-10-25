#!/usr/bin/env node
// notes — read the operator's notes, or add one, from a Bash tool call inside a CloudCLI chat.
//
//   notes list                                     every note of this chat's account, newest first:
//                                                  id · title · last saved · the description's first line
//   notes show <id>                                one note, whole
//   notes add --title "<title>" [--body "<text>"]  adds one note and prints what was saved, with its id
//   notes add --title "<title>" --body -           the same, the description read from stdin
//
// There is no edit and no delete: a note is rewritten or thrown away by its owner, in the Notes tab.
//
// Exit codes are the contract a skill reads:
//   0  done
//   1  not done — CloudCLI refused (its own sentence is printed), cannot be reached, or this is not a
//      CloudCLI chat (no chat credential in the environment)
//   2  a malformed call; the usage is printed
//
// WHY A COMMAND AND NOT A TOOL. The same reason `toolset` is one: a command costs a chat nothing until
// it is called, and a chat's model already has a shell.
//
// WHY IT LIVES IN CLOUDCLI'S REPO. Its whole contract is CloudCLI's command door
// (`POST /api/notes-cmd`, server/modules/notes/notes.command-routes.ts) and the three variables a chat
// is launched with, so the two change together. CloudCLI links it into ~/.local/bin at boot
// (server/modules/notes/notes.module.ts, through the shared command-link helper).
//
// It holds no state, imports nothing, and is run by bare `node` — the same footing as `toolset`.
//   CLAUDE_CODE_SESSION_ID    this conversation's Claude session id (set by the CLI)
//   CLOUDCLI_TOOLSET_URL      the API's loopback origin (set at launch)
//   CLOUDCLI_TOOLSET_TOKEN    this chat's credential (set at launch) — the one `toolset` sends; the chat
//                             has no other, and the account it opens is the chat's own owner

const REQUEST_TIMEOUT_MS = 30_000;

const USAGE = [
  'usage: notes list',
  '       notes show <id>',
  '       notes add --title "<title>" [--body "<text>" | --body -]',
].join('\n');

/** The description's first line, as `notes list` shows it: longer than this and the rest is `show`'s. */
const LIST_PREVIEW_MAX = 120;

const EXIT_DONE = 0;
const EXIT_NOT_DONE = 1;
const EXIT_MALFORMED = 2;

/** Thrown to end the run with a message on stderr and an exit code. */
class Stop extends Error {
  constructor(exitCode, message) {
    super(message);
    this.exitCode = exitCode;
  }
}

const notDone = (message) => new Stop(EXIT_NOT_DONE, `notes: ${message}`);

/** One line of text: a note's own line breaks must not turn one note into several lines of a listing. */
const oneLine = (text) => String(text ?? '').replace(/\s+/g, ' ').trim();

/** `{ action, ... }` from the arguments, or a refusal carrying the usage. */
function parseArguments(args) {
  const [verb, ...rest] = args;
  if (verb === 'list' && rest.length === 0) return { action: 'list' };
  if (verb === 'show' && rest.length === 1 && rest[0] !== '' && !rest[0].startsWith('--')) {
    return { action: 'show', id: rest[0] };
  }
  if (verb === 'add') return parseAdd(rest);
  throw new Stop(EXIT_MALFORMED, USAGE);
}

/** `notes add`'s flags: `--title` once and required, `--body` at most once, each as `--flag value` or `--flag=value`. */
function parseAdd(flags) {
  const seen = {};
  for (let index = 0; index < flags.length; index += 1) {
    const match = /^--(title|body)(?:=(.*))?$/s.exec(flags[index]);
    if (match === null || match[1] in seen) throw new Stop(EXIT_MALFORMED, USAGE);
    const value = match[2] ?? flags[index + 1];
    if (value === undefined) throw new Stop(EXIT_MALFORMED, USAGE);
    if (match[2] === undefined) index += 1;
    seen[match[1]] = value;
  }
  if (typeof seen.title !== 'string' || seen.title.trim() === '') throw new Stop(EXIT_MALFORMED, USAGE);
  return { action: 'add', title: seen.title, body: seen.body };
}

/** The whole of stdin, for `--body -`. */
async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

/** The chat's coordinates from the environment, or the one line that says there are none. */
function readChatEnvironment(env) {
  const url = env.CLOUDCLI_TOOLSET_URL;
  const token = env.CLOUDCLI_TOOLSET_TOKEN;
  const claudeSessionId = env.CLAUDE_CODE_SESSION_ID;
  if (!url || !token || !claudeSessionId) {
    throw notDone('this is not a CloudCLI chat (no chat credential in the environment), so there are no notes to reach');
  }
  return { url: url.replace(/\/+$/, ''), token, claudeSessionId };
}

/** Why a request never got an answer, in the words of the not-done line. */
function describeFetchFailure(error, url) {
  const reason =
    error?.name === 'TimeoutError'
      ? `no answer within ${REQUEST_TIMEOUT_MS / 1000} s`
      : (error?.cause?.code ?? error?.cause?.message ?? error?.message ?? 'unknown error');
  return `CloudCLI does not answer at ${url} (${reason})`;
}

/**
 * One call to the command door. Answers the parsed JSON envelope; anything that is not a JSON answer
 * from CloudCLI is "not done", because whatever sits at that address is not CloudCLI's API.
 */
async function callCommandDoor({ url, token, claudeSessionId }, request) {
  let response;
  let body;
  try {
    response = await fetch(`${url}/api/notes-cmd`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ claudeSessionId, ...request }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    // Only a body that is not JSON becomes `null`; an abort or a dropped connection mid-body is the
    // same "does not answer" a stalled header would be.
    body = await response.json().catch((error) => {
      if (error instanceof SyntaxError) return null;
      throw error;
    });
  } catch (error) {
    throw notDone(describeFetchFailure(error, url));
  }
  if (body === null || typeof body !== 'object' || typeof body.success !== 'boolean') {
    throw notDone(`${url} answered HTTP ${response.status}, which is not a CloudCLI answer`);
  }
  return body;
}

/** One note as `show` and `add` print it: its fields, then the description under a blank line. */
function formatNote(note) {
  const lines = [`id: ${note.id}`, `title: ${note.title}`, `created: ${note.createdAt}`, `saved: ${note.updatedAt}`];
  if (note.description !== '') lines.push('', note.description);
  return lines;
}

/** `notes list`'s stdout: one line per note, in the order the door answered (newest first). */
function formatList(notes) {
  if (notes.length === 0) return ['No notes.'];
  return notes.map((note) => {
    const firstLine = oneLine(note.description.split('\n').find((line) => line.trim() !== '') ?? '');
    const preview = firstLine.length > LIST_PREVIEW_MAX ? `${firstLine.slice(0, LIST_PREVIEW_MAX - 1)}…` : firstLine;
    return [note.id, oneLine(note.title), note.updatedAt, preview].join(' · ');
  });
}

async function run(args, env) {
  const parsed = parseArguments(args);
  const chat = readChatEnvironment(env);

  const request =
    parsed.action === 'add'
      ? { action: 'add', title: parsed.title, description: parsed.body === '-' ? await readStdin() : (parsed.body ?? '') }
      : parsed;
  const body = await callCommandDoor(chat, request);
  if (!body.success) throw notDone(oneLine(body.error?.message) || 'the request was refused');

  if (request.action === 'list') return formatList(body.data);
  if (request.action === 'show') return formatNote(body.data);
  return ['Added.', ...formatNote(body.data)];
}

// A reader that closes its end early (`notes list | head -1`) must not turn a finished read into an
// uncaught EPIPE and exit 1, the code reserved for "not done": the exit code is already decided.
for (const stream of [process.stdout, process.stderr]) {
  stream.on('error', (error) => {
    if (error.code !== 'EPIPE') throw error;
  });
}

try {
  const lines = await run(process.argv.slice(2), process.env);
  process.stdout.write(`${lines.join('\n')}\n`);
  process.exitCode = EXIT_DONE;
} catch (error) {
  // Anything that is not a Stop is a defect in this file or an answer shape it was not written for.
  const stop = error instanceof Stop ? error : notDone(`internal error: ${error instanceof Error ? error.message : String(error)}`);
  process.stderr.write(`${stop.message}\n`);
  process.exitCode = stop.exitCode;
}
