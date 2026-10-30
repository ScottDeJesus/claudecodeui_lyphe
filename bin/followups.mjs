#!/usr/bin/env node
// followups — keep this chat's next steps and known gaps current, from a Bash tool call inside a CloudCLI chat.
//
//   followups [list] [--all]                       the chat's open items, oldest first, one line each:
//                                                  #<id>  next|gap  <age>  <text>   (--all adds the done ones)
//   followups add [--next "<line>"]... [--gap "<line>"]...
//                                                  files each line, in the order given, in ONE call; prints the ids
//   followups done <id> [<id>...]                  closes items that are settled (answered, done, or no longer true)
//
// The Next steps widget beside the chat draws these rows, and the person ticks them there too. A line is one plain
// line of 1-240 characters; a longer one or one with a line break is refused with the reason, and a call that
// carries a refused line files nothing, so fix that line and send the call again.
//
// Exit codes are the contract a prompt reads:
//   0  done
//   1  not done — CloudCLI refused (its own sentence is printed), cannot be reached, or this is not a
//      CloudCLI chat (no chat credential in the environment)
//   2  a malformed call; the usage is printed
//
// WHY IT LIVES IN CLOUDCLI'S REPO. Its whole contract is CloudCLI's command door (`POST /api/followups-cmd`,
// server/modules/followups/followups.command-routes.ts) and the three variables a chat is launched with, so the two
// change together. CloudCLI links it into ~/.local/bin at boot (server/modules/followups/followups.module.ts, through
// the shared command-link helper). It holds no state, imports nothing, and is run by bare `node` — the footing of `notes`.
//   CLAUDE_CODE_SESSION_ID    this conversation's Claude session id (set by the CLI)
//   CLOUDCLI_TOOLSET_URL      the API's loopback origin (set at launch)
//   CLOUDCLI_TOOLSET_TOKEN    this chat's credential (set at launch) — the one `toolset` and `notes` send

const REQUEST_TIMEOUT_MS = 30_000;

const USAGE = [
  'usage: followups [list] [--all]',
  '       followups add [--next "<one plain line>"]... [--gap "<one plain line>"]...',
  '       followups done <id> [<id>...]',
].join('\n');

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

const notDone = (message) => new Stop(EXIT_NOT_DONE, `followups: ${message}`);

/** One line of text: the server's sentence may carry a break, and a listing is one line per item. */
const oneLine = (text) => String(text ?? '').replace(/\s+/g, ' ').trim();

/** `{ action, ... }` from the arguments, or a refusal carrying the usage. */
function parseArguments(args) {
  const [verb, ...rest] = args;
  if (verb === undefined) return { action: 'list', all: false };
  if (verb === 'list' || verb === '--all') {
    const flags = verb === 'list' ? rest : args;
    if (flags.length === 0) return { action: 'list', all: false };
    if (flags.length === 1 && flags[0] === '--all') return { action: 'list', all: true };
  }
  if (verb === 'add') return parseAdd(rest);
  if (verb === 'done') return parseDone(rest);
  throw new Stop(EXIT_MALFORMED, USAGE);
}

/** `followups add`'s flags: `--next` and `--gap`, each as many times as there are lines, as `--flag value` or `--flag=value`. */
function parseAdd(flags) {
  const items = [];
  for (let index = 0; index < flags.length; index += 1) {
    const match = /^--(next|gap)(?:=(.*))?$/s.exec(flags[index]);
    if (match === null) throw new Stop(EXIT_MALFORMED, USAGE);
    const value = match[2] ?? flags[index + 1];
    if (value === undefined) throw new Stop(EXIT_MALFORMED, USAGE);
    if (match[2] === undefined) index += 1;
    items.push({ kind: match[1], text: value });
  }
  if (items.length === 0) throw new Stop(EXIT_MALFORMED, USAGE);
  return { action: 'add', items };
}

/** `followups done`'s ids: one or more positive whole numbers, each as `12` or `#12`. */
function parseDone(args) {
  const ids = args.map((arg) => (/^#?[1-9]\d{0,14}$/.test(arg) ? Number(arg.replace('#', '')) : null));
  if (ids.length === 0 || ids.includes(null)) throw new Stop(EXIT_MALFORMED, USAGE);
  return { action: 'done', ids };
}

/** The chat's coordinates from the environment, or the one line that says there are none. */
function readChatEnvironment(env) {
  const url = env.CLOUDCLI_TOOLSET_URL;
  const token = env.CLOUDCLI_TOOLSET_TOKEN;
  const claudeSessionId = env.CLAUDE_CODE_SESSION_ID;
  if (!url || !token || !claudeSessionId) {
    throw notDone('this is not a CloudCLI chat (no chat credential in the environment), so there is no list to reach');
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
    response = await fetch(`${url}/api/followups-cmd`, {
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

/** How long ago a stamp was, in one short word: `now`, `5m`, `3h`, `2d`. */
function formatAge(iso) {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (!Number.isFinite(seconds) || seconds < 60) return 'now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86_400)}d`;
}

/**
 * The mark before a done row: `[done]`, or — when the house closed it as the feature, task or epic it named finished —
 * which one, so the chat can tell a settled item from one a person or a chat ticked. `closedFor` is `<feature>`,
 * `<feature>/<task key>` or `epic:<epic>`; the epic prefix is tested BEFORE the slash split.
 */
function doneMark(item) {
  if (item.closedBy !== 'completion' || typeof item.closedFor !== 'string') return '[done]';
  if (item.closedFor.startsWith('epic:')) return `[done: epic ${item.closedFor.slice('epic:'.length)} finished]`;
  const slash = item.closedFor.indexOf('/');
  if (slash === -1) return `[done: feature ${item.closedFor} finished]`;
  return `[done: task ${item.closedFor.slice(slash + 1)} of feature ${item.closedFor.slice(0, slash)} finished]`;
}

/** `followups list`'s stdout: one line per item, in the order the door answered (oldest first). */
function formatList(items) {
  if (items.length === 0) return ['Nothing open in this chat.'];
  return items.map((item) => {
    const text = item.state === 'done' ? `${doneMark(item)} ${oneLine(item.text)}` : oneLine(item.text);
    return `#${item.id}  ${item.kind}  ${formatAge(item.createdAt)}  ${text}`;
  });
}

async function run(args, env) {
  const request = parseArguments(args);
  const body = await callCommandDoor(readChatEnvironment(env), request);
  if (!body.success) throw notDone(oneLine(body.error?.message) || 'the request was refused');

  if (request.action === 'list') return formatList(body.data);
  if (request.action === 'add') return body.data.map((item) => `#${item.id}  ${item.kind}  ${oneLine(item.text)}`);
  return [`Closed ${body.data.map((item) => `#${item.id}`).join(', ')}.`];
}

// A reader that closes its end early (`followups | head -1`) must not turn a finished read into an
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
