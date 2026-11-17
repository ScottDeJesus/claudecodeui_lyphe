#!/usr/bin/env node
// panel — put a thing on this chat's panel, change it in place, or clear it, from a Bash tool call inside a CloudCLI chat.
//
// The panel is the one place beside the talk that the chat has to itself. It shows one thing at a time, and every show or
// update is a new version of it that the reader can walk back along.
//
//   panel show --title "<title>" --diagram <file | ->      a mermaid diagram, its source read from a file or from stdin
//   panel show --title "<title>" --widget <file | ->       a page of your own: an HTML body, as a widget fence takes it
//   panel show --title "<title>" --page <url>              a web page at an http(s) address, drawn in a frame
//   panel show --title "<title>" --picture <path | url>    an image file on this machine, or an image's http(s) address
//   panel update [--title "<title>"] --diagram|--widget|--page|--picture <…>
//                                                          what is showing, changed in place as a new version; the title
//                                                          showing is kept unless one is given
//   panel clear                                            empties the panel
//   panel                                                  what the panel shows now
//
// Exit codes are the contract a skill reads:
//   0  done
//   1  not done — CloudCLI refused (its own sentence is printed), cannot be reached, or this is not a CloudCLI chat (no chat
//      credential in the environment)
//   2  a malformed call; the usage is printed
//
// WHY A COMMAND AND NOT A FENCE. A fence makes a new block in the transcript each time it is written. A command addresses one
// stable thing, changes it in place, and says whether it landed.
//
// WHY IT LIVES IN CLOUDCLI'S REPO. Its whole contract is CloudCLI's command door (`POST /api/session-panel-cmd`,
// server/modules/session-panel/session-panel.command-routes.ts) and the three variables a chat is launched with, so the two
// change together. CloudCLI links it into ~/.local/bin at boot (server/modules/session-panel/session-panel.module.ts, through the
// shared command-link helper).
//
// It holds no state, imports only node's own modules, and is run by bare `node`, the same footing as `followups` and `notes`.
//   CLAUDE_CODE_SESSION_ID    this conversation's Claude session id (set by the CLI)
//   CLOUDCLI_TOOLSET_URL      the API's loopback origin (set at launch)
//   CLOUDCLI_TOOLSET_TOKEN    this chat's credential (set at launch), the one every command of the chat sends

import { readFile } from 'node:fs/promises';
import path from 'node:path';

const REQUEST_TIMEOUT_MS = 30_000;

const USAGE = [
  'usage: panel show --title "<title>" --diagram <file | ->',
  '       panel show --title "<title>" --widget <file | ->',
  '       panel show --title "<title>" --page <url>',
  '       panel show --title "<title>" --picture <path | url>',
  '       panel update [--title "<title>"] --diagram|--widget|--page|--picture <…>',
  '       panel clear',
  '       panel',
].join('\n');

/** The kinds whose value is read from a file (or stdin, for `-`), and the kinds whose value is the thing itself. */
const READ_KINDS = ['diagram', 'widget'];
const KINDS = [...READ_KINDS, 'page', 'picture'];

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

const notDone = (message) => new Stop(EXIT_NOT_DONE, `panel: ${message}`);

/** One line of text, for a title printed back. */
const oneLine = (text) => String(text ?? '').replace(/\s+/g, ' ').trim();

/** `{ action, ... }` from the arguments, or a refusal carrying the usage. */
function parseArguments(args) {
  const [verb, ...rest] = args;
  if (verb === undefined) return { action: 'status' };
  if (verb === 'clear' && rest.length === 0) return { action: 'clear' };
  if (verb === 'show' || verb === 'update') return parseThing(verb, rest);
  throw new Stop(EXIT_MALFORMED, USAGE);
}

/** The flags of `show` and `update`: `--title` at most once, and exactly one kind with its value, each as `--flag value` or `--flag=value`. */
function parseThing(action, flags) {
  const seen = {};
  for (let index = 0; index < flags.length; index += 1) {
    const match = /^--(title|diagram|widget|page|picture)(?:=(.*))?$/s.exec(flags[index]);
    if (match === null || match[1] in seen) throw new Stop(EXIT_MALFORMED, USAGE);
    const value = match[2] ?? flags[index + 1];
    if (value === undefined) throw new Stop(EXIT_MALFORMED, USAGE);
    if (match[2] === undefined) index += 1;
    seen[match[1]] = value;
  }
  const kinds = KINDS.filter((kind) => kind in seen);
  if (kinds.length !== 1 || seen[kinds[0]] === '') throw new Stop(EXIT_MALFORMED, USAGE);
  if (action === 'show' && (typeof seen.title !== 'string' || seen.title.trim() === '')) throw new Stop(EXIT_MALFORMED, USAGE);
  return { action, kind: kinds[0], title: seen.title, value: seen[kinds[0]] };
}

/** The whole of stdin, for a value of `-`. */
async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

/** The body the door is sent: a file's text (or stdin's) for a diagram or a widget, the address for a page, and for a picture its address or its path made absolute, since the server reads it where it lies. */
async function readBody(kind, value) {
  if (READ_KINDS.includes(kind)) {
    if (value === '-') return readStdin();
    try {
      return await readFile(value, 'utf8');
    } catch (error) {
      throw notDone(`cannot read ${value} (${error?.code ?? error?.message ?? 'unknown error'})`);
    }
  }
  if (kind === 'picture' && !/^https?:\/\//i.test(value)) return path.resolve(value);
  return value;
}

/** The chat's coordinates from the environment, or the one line that says there are none. */
function readChatEnvironment(env) {
  const url = env.CLOUDCLI_TOOLSET_URL;
  const token = env.CLOUDCLI_TOOLSET_TOKEN;
  const claudeSessionId = env.CLAUDE_CODE_SESSION_ID;
  if (!url || !token || !claudeSessionId) {
    throw notDone('this is not a CloudCLI chat (no chat credential in the environment), so it has no panel');
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

/** One call to the command door. Answers the parsed JSON envelope; anything that is not a JSON answer from CloudCLI is "not done". */
async function callCommandDoor({ url, token, claudeSessionId }, request) {
  let response;
  let body;
  try {
    response = await fetch(`${url}/api/session-panel-cmd`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ claudeSessionId, ...request }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
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

/** What is showing, as one line. The chat's page reads `(id N)` off this line to mark the place in the talk, so its shape is a contract. */
function formatShowing(head, versions) {
  return `On the panel: "${oneLine(head.title)}" · ${head.kind} · version ${head.version} of ${Math.max(versions, head.version)} (id ${head.id})`;
}

async function run(args, env) {
  const parsed = parseArguments(args);
  const chat = readChatEnvironment(env);

  const request =
    parsed.action === 'show' || parsed.action === 'update'
      ? { action: parsed.action, kind: parsed.kind, title: parsed.title, body: await readBody(parsed.kind, parsed.value) }
      : { action: parsed.action };
  const body = await callCommandDoor(chat, request);
  if (!body.success) throw notDone(oneLine(body.error?.message) || 'the request was refused');

  if (request.action === 'clear') return [body.data.cleared > 0 ? 'Cleared.' : 'The panel was already empty.'];
  if (request.action === 'status') {
    return [body.data.showing === null ? 'Nothing is on the panel.' : formatShowing(body.data.showing, body.data.versions)];
  }
  return [formatShowing(body.data.shown, body.data.versions)];
}

// A reader that closes its end early must not turn a finished call into an uncaught EPIPE and exit 1: the exit code is already decided.
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
