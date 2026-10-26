#!/usr/bin/env node
// toolset — switch this conversation's MCP tool sets on or off from a Bash tool call.
//
//   toolset list          the sets this box defines, and which are on for this conversation
//   toolset on <set>      switch a set on: its tools arrive within the same turn
//   toolset off <set>     switch it off again
//
// Exit codes are the contract a skill reads:
//   0  done — listed, or switched with every server connected, removed or unchanged (pending included)
//   1  switched, but a server failed or went unconfirmed
//   2  refused — a usage mistake, or CloudCLI said no (an undefined set, a node chat, a broken file)
//   3  unavailable — this is not a CloudCLI chat, or CloudCLI cannot be reached; a skill falls back
//
// WHY A COMMAND AND NOT A TOOL. CloudCLI's chats carry no MCP server of their own, and one added just
// for this would put a server and its tools into every chat's context. A command costs nothing until
// it is called, and it is the one form that can still answer "unavailable" outside CloudCLI.
//
// WHY IT LIVES IN CLOUDCLI'S REPO. Its whole contract is CloudCLI's command door
// (`POST /api/toolsets-cmd`, server/modules/toolsets/toolsets.routes.ts) and four variables, so the
// two change together. CloudCLI links it into ~/.local/bin at boot (chat-commands.link.ts).
//
// It holds no state, imports nothing, and is run by bare `node` — the same footing as `warden/`.
//   CLAUDE_SURFACE            'cloudcli' inside a CloudCLI chat (set at launch)
//   CLAUDE_CODE_SESSION_ID    this conversation's Claude session id (set by the CLI)
//   CLOUDCLI_TOOLSET_URL      the API's loopback origin (set at launch)
//   CLOUDCLI_TOOLSET_TOKEN    this chat's credential (set at launch)

const REQUEST_TIMEOUT_MS = 45_000;

const USAGE = ['usage: toolset list', '       toolset on <set>', '       toolset off <set>'].join('\n');

const EXIT_DONE = 0;
const EXIT_SERVER_PROBLEM = 1;
const EXIT_REFUSED = 2;
const EXIT_UNAVAILABLE = 3;

/** Thrown to end the run with a message on stderr and an exit code. */
class Stop extends Error {
  constructor(exitCode, message) {
    super(message);
    this.exitCode = exitCode;
  }
}

const unavailable = (why) => new Stop(EXIT_UNAVAILABLE, `toolset: unavailable — ${why}`);

/** A server's detail on one line, so one server is always one line of output. */
const oneLine = (text) => String(text ?? '').replace(/\s+/g, ' ').trim();

/** `{ action, set }` from the arguments, or a refusal carrying the usage. */
function parseArguments(args) {
  const [action, set, ...rest] = args;
  if (action === 'list' && set === undefined) return { action };
  if ((action === 'on' || action === 'off') && typeof set === 'string' && set !== '' && rest.length === 0) {
    return { action, set };
  }
  throw new Stop(EXIT_REFUSED, USAGE);
}

/** The chat's coordinates from the environment, or the reason there are none. */
function readChatEnvironment(env) {
  if (env.CLAUDE_SURFACE !== 'cloudcli') throw unavailable('not running inside a CloudCLI chat');
  const url = env.CLOUDCLI_TOOLSET_URL;
  const token = env.CLOUDCLI_TOOLSET_TOKEN;
  if (!url || !token) {
    throw unavailable("this chat's CLI was started without the tool-set credential; its next process carries it");
  }
  const claudeSessionId = env.CLAUDE_CODE_SESSION_ID;
  if (!claudeSessionId) throw unavailable('CLAUDE_CODE_SESSION_ID is not set, so this conversation cannot be named');
  return { url: url.replace(/\/+$/, ''), token, claudeSessionId };
}

/** Why a request never got an answer, in the words of the unavailable line. */
function describeFetchFailure(error, url) {
  const reason =
    error?.name === 'TimeoutError'
      ? `no answer within ${REQUEST_TIMEOUT_MS / 1000} s`
      : (error?.cause?.code ?? error?.cause?.message ?? error?.message ?? 'unknown error');
  return `CloudCLI does not answer at ${url} (${reason})`;
}

/**
 * One call to the command door. Answers `{ status, body }` where `body` is the parsed JSON envelope;
 * anything that is not a JSON answer from CloudCLI is "unavailable", because whatever sits at that
 * address is not CloudCLI's API.
 */
async function callCommandDoor({ url, token, claudeSessionId }, { action, set }) {
  let response;
  let body;
  try {
    response = await fetch(`${url}/api/toolsets-cmd`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ claudeSessionId, action, set }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    // Only a body that is not JSON becomes `null` (and so "not a CloudCLI answer"); an abort or a
    // dropped connection mid-body is the same "does not answer" a stalled header would be.
    body = await response.json().catch((error) => {
      if (error instanceof SyntaxError) return null;
      throw error;
    });
  } catch (error) {
    throw unavailable(describeFetchFailure(error, url));
  }
  if (body === null || typeof body !== 'object' || typeof body.success !== 'boolean') {
    throw unavailable(`${url} answered HTTP ${response.status}, which is not a CloudCLI answer`);
  }
  return { status: response.status, body };
}

/** The refusal an error envelope carries, with the defined names a missing set adds. */
function refusalOf(error) {
  const message = oneLine(error?.message) || 'the request was refused';
  if (error?.code !== 'TOOLSET_NOT_DEFINED') return `toolset: ${message}`;
  const defined = Array.isArray(error.details?.defined) ? error.details.defined : [];
  return `toolset: ${message} ${defined.length > 0 ? `Defined: ${defined.join(', ')}.` : 'No set is defined on this box.'}`;
}

/** `toolset list`'s stdout. */
function formatList(view) {
  const lines = [];
  if (view.registryError) {
    lines.push(`The tool-set file could not be read (${view.registryFile}): ${oneLine(view.registryError)}`);
  } else if (view.sets.length === 0) {
    lines.push(`No tool sets are defined on this box (${view.registryFile}).`);
  } else {
    lines.push(`Tool sets on this box (${view.sets.length}):`);
    for (const set of view.sets) {
      const description = set.description ? `${set.description} ` : '';
      lines.push(`  ${set.name}  ${set.on ? 'on' : 'off'}  ${description}[${set.servers.join(', ')}]`);
    }
  }
  for (const name of view.strays) lines.push(`  ${name}  on  no longer defined on this box`);
  return lines;
}

/** One server's line under a switch; only a failed or unconfirmed server has a detail worth printing. */
function formatServer(server) {
  const hasDetail = (server.outcome === 'failed' || server.outcome === 'unconfirmed') && server.detail;
  return `  ${server.name}  ${server.outcome}${hasDetail ? `: ${oneLine(server.detail)}` : ''}`;
}

/** `toolset on|off <set>`'s stdout. */
function formatSwitch(result) {
  const state = result.on ? 'on' : 'off';
  const head = result.changed ? `${result.set}: ${state} for this conversation.` : `${result.set}: already ${state}.`;
  const lines = [result.live === 'next-message' ? `${head} It applies from this conversation's next message.` : head];
  for (const server of result.servers) lines.push(formatServer(server));
  return lines;
}

async function run(args, env) {
  const request = parseArguments(args);
  const chat = readChatEnvironment(env);
  const { status, body } = await callCommandDoor(chat, request);

  if (status === 401) throw unavailable('CloudCLI does not know this session');
  if (!body.success) throw new Stop(EXIT_REFUSED, refusalOf(body.error));

  if (request.action === 'list') return { lines: formatList(body.data), exitCode: EXIT_DONE };

  const troubled = body.data.servers.some((server) => server.outcome === 'failed' || server.outcome === 'unconfirmed');
  return { lines: formatSwitch(body.data), exitCode: troubled ? EXIT_SERVER_PROBLEM : EXIT_DONE };
}

// A reader that closes its end early (`toolset on x | true`) must not turn a finished switch into an
// uncaught EPIPE and exit 1, the code reserved for "a server failed": the exit code is already decided.
for (const stream of [process.stdout, process.stderr]) {
  stream.on('error', (error) => {
    if (error.code !== 'EPIPE') throw error;
  });
}

try {
  const { lines, exitCode } = await run(process.argv.slice(2), process.env);
  process.stdout.write(`${lines.join('\n')}\n`);
  process.exitCode = exitCode;
} catch (error) {
  // Anything that is not a Stop is a defect in this file or an answer shape it was not written for.
  // It is reported as unavailable, because the one thing a skill can do about it is fall back.
  const stop = error instanceof Stop ? error : unavailable(`internal error: ${error instanceof Error ? error.message : String(error)}`);
  process.stderr.write(`${stop.message}\n`);
  process.exitCode = stop.exitCode;
}
