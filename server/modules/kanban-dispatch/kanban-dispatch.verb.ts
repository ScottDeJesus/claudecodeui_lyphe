/**
 * The one relay the bug hunters' routes share: each route runs one dispatcher command and answers its first line.
 * A dispatcher refusal goes back as 409 with the dispatcher's own sentence; a dispatcher fault goes back as 502.
 * This server never touches the dispatcher's store: it runs the dispatcher's verbs and reads what they print.
 */

import type { Response } from 'express';

import { firstLine, runDispatcherCommand, type CommandDependencies } from '@/modules/dispatcher/index.js';

import { isRecord } from './kanban-dispatch.fields.js';

const EXIT_OK = 0;
const EXIT_REFUSED = 2;
const STATUS_OK = 200;
const STATUS_BAD_REQUEST = 400;
const STATUS_CONFLICT = 409;
const STATUS_BAD_GATEWAY = 502;
const ARG_TEXT_MAX = 500;
const VERB_WORDS = 2;
/** How much of a fault's last line the 502 sentence carries. */
const FAULT_LINE_MAX = 300;
/** A positive decimal written plainly: no sign, no leading zero, at most ten digits. */
const ROUTE_ID_PATTERN = /^[1-9][0-9]{0,9}$/;

/** A refusal is the operator's answer (409); a dispatcher that did not answer is a fault (502). */
export type VerbFailure = { status: typeof STATUS_CONFLICT | typeof STATUS_BAD_GATEWAY; error: string };
/** The dispatcher's stdout on success, or the failure the route answers with. */
export type VerbOutcome = { ok: true; stdout: string } | ({ ok: false } & VerbFailure);

/**
 * Runs one dispatcher verb and sorts its exit into success, the operator's refusal, or a fault to report. `refusalExits` are
 * the exits on which the verb's first stdout line is its refusal: the hunt verbs refuse on 2 alone; the roadmap-form verbs
 * (`rnd`) also answer a name they do not hold on 1.
 */
export async function runVerb(
  commands: CommandDependencies,
  argv: readonly string[],
  refusalExits: readonly number[] = [EXIT_REFUSED],
): Promise<VerbOutcome> {
  const { exit, stdout, stderr } = await runDispatcherCommand(commands, argv);
  if (exit === EXIT_OK) return { ok: true, stdout };
  const refusal = firstLine(stdout);
  if (exit !== null && refusalExits.includes(exit) && refusal !== '') return { ok: false, status: STATUS_CONFLICT, error: refusal };
  const how = exit === null ? 'did not answer' : `exited ${exit}`;
  const detail = lastLine(stderr) || firstLine(stdout) || 'printed nothing it could read';
  const error = `dispatcher ${argv.slice(0, VERB_WORDS).join(' ')} ${how}: ${detail}`;
  console.error('[kanban-dispatch] ' + error);
  return { ok: false, status: STATUS_BAD_GATEWAY, error };
}

/**
 * The last non-blank line of stderr is the cause: argparse prints its usage first and the error last,
 * and a Python traceback ends on its exception.
 */
function lastLine(text: string): string {
  const lines = text.split('\n').map((line) => line.trim()).filter((line) => line !== '');
  const line = lines[lines.length - 1] ?? '';
  return line.slice(0, FAULT_LINE_MAX);
}

/** The first non-blank line whole: a JSON answer is one long line, past firstLine's cap. */
export function answerLine(stdout: string): string {
  const line = stdout.split('\n').map((text) => text.trim()).find((text) => text !== '');
  return line ?? '';
}

/** Answers a failure with its status and its sentence as `error`. */
export function sendFailure(response: Response, failure: VerbFailure): void {
  response.status(failure.status).json({ error: failure.error });
}

/** Answers a request the route refused before any verb ran. */
export function sendBadRequest(response: Response, error: string): void {
  response.status(STATUS_BAD_REQUEST).json({ error });
}

/** Relays a verb whose answer is its first line: 200 with `{ line }`, or the failure. */
export async function relayLine(
  commands: CommandDependencies,
  argv: readonly string[],
  response: Response,
  refusalExits?: readonly number[],
): Promise<void> {
  const outcome = await runVerb(commands, argv, refusalExits);
  if (!outcome.ok) {
    sendFailure(response, outcome);
    return;
  }
  response.status(STATUS_OK).json({ line: answerLine(outcome.stdout) });
}

/** Reads a JSON answer, or undefined when it does not parse, so the caller refuses it as a non-object. */
function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Relays a verb whose answer is a JSON object: 200 with the object as the body, or the failure. */
export async function relayJson(
  commands: CommandDependencies,
  argv: readonly string[],
  response: Response,
  refusalExits?: readonly number[],
): Promise<void> {
  const outcome = await runVerb(commands, argv, refusalExits);
  if (!outcome.ok) {
    sendFailure(response, outcome);
    return;
  }
  const parsed = parseJson(answerLine(outcome.stdout));
  if (!isRecord(parsed)) {
    response.status(STATUS_BAD_GATEWAY).json({ error: `dispatcher ${argv.join(' ')} did not answer a JSON object` });
    return;
  }
  response.status(STATUS_OK).json(parsed);
}

/** An absent body reads as no fields; a body that is not a JSON object is null, so the route answers 400. */
export function bodyOf(raw: unknown): Record<string, unknown> | null {
  if (raw === undefined) return {};
  return isRecord(raw) ? raw : null;
}

/**
 * Text that may become a positional argv entry: the dispatcher's parser would read a leading dash as a flag, so it is refused.
 */
export function isArgText(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.trim() !== '' &&
    value.length <= ARG_TEXT_MAX &&
    !/[\r\n]/.test(value) &&
    !value.startsWith('-')
  );
}

/** A route id is a positive plain decimal, passed to the dispatcher exactly as written; anything else is no id. */
export function routeId(raw: unknown): string | null {
  return typeof raw === 'string' && ROUTE_ID_PATTERN.test(raw) ? raw : null;
}
