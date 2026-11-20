/**
 * The bug hunters' routes, mounted by `kanban-dispatch.routes.ts` at `/hunts` under `/api/kanban-dispatch`, behind the mount's `authenticateToken`.
 * Each route runs one dispatcher command through the shared relay and answers what the dispatcher printed:
 *   GET  /settings  the hunt config as it stands          (`hunt config --json`)
 *   PUT  /settings  sets any of the hunt config's fields   (`hunt config --flag=value ... --json`)
 *   POST /night     opens tonight's night now              (`hunt night --now [--minutes=n]`)
 *   POST /stop      winds the hunters down                 (`hunt stop [--now]`)
 *   POST /reopen    reopens one hunt's unit in a project   (`hunt reopen <hunt> <project> <unit>`)
 * This router keeps no state and writes no file: `charters/hunts.toml` has one writer, `dispatcher hunt config`.
 * Every flag is passed in the `--flag=value` form, so a value that begins with a dash is never read by the dispatcher's parser as a flag.
 * This router checks only the TYPE of each field; the dispatcher judges the value, and its refusal comes back as a 409.
 */

import express from 'express';

import type { CommandDependencies } from '@/modules/dispatcher/index.js';

import { bodyOf, isArgText, relayJson, relayLine, sendBadRequest } from './kanban-dispatch.verb.js';

/** The hunt settings a PUT may name, and the same names in the words the 400 sentences use. */
const SETTING_KEYS: readonly string[] = ['nightly', 'start', 'minutes', 'order', 'turns', 'projects', 'ticketsPerNight'];
const SETTING_NAMES = 'nightly, start, minutes, order, turns, projects or ticketsPerNight';
/** An unknown key is echoed back in its 400, cut to this many characters. */
const KEY_MAX = 64;
const BODY_NOT_OBJECT = 'the body must be a JSON object';

/** The bug hunters' routes, each one dispatcher command over the shared relay. */
export function createHuntsRouter(commands: CommandDependencies): express.Router {
  const router = express.Router();

  router.get('/settings', async (_request, response, next) => {
    try {
      await relayJson(commands, ['hunt', 'config', '--json'], response);
    } catch (error) {
      next(error);
    }
  });

  router.put('/settings', async (request, response, next) => {
    try {
      const body = bodyOf(request.body);
      if (body === null) {
        sendBadRequest(response, BODY_NOT_OBJECT);
        return;
      }
      const checked = settingsFlags(body);
      if ('error' in checked) {
        sendBadRequest(response, checked.error);
        return;
      }
      // The dispatcher prints the config after the write, so the answer is the config as it now stands.
      await relayJson(commands, ['hunt', 'config', ...checked.flags, '--json'], response);
    } catch (error) {
      next(error);
    }
  });

  router.post('/night', async (request, response, next) => {
    try {
      const body = bodyOf(request.body);
      if (body === null) {
        sendBadRequest(response, BODY_NOT_OBJECT);
        return;
      }
      const { minutes } = body;
      if (minutes !== undefined && !isWhole(minutes)) {
        sendBadRequest(response, 'Minutes must be a whole number');
        return;
      }
      const flags: string[] = minutes === undefined ? [] : [`--minutes=${minutes}`];
      await relayLine(commands, ['hunt', 'night', '--now', ...flags], response);
    } catch (error) {
      next(error);
    }
  });

  router.post('/stop', async (request, response, next) => {
    try {
      const body = bodyOf(request.body);
      if (body === null) {
        sendBadRequest(response, BODY_NOT_OBJECT);
        return;
      }
      const { now } = body;
      if (now !== undefined && typeof now !== 'boolean') {
        sendBadRequest(response, 'now must be true or false');
        return;
      }
      const flags: string[] = now === true ? ['--now'] : [];
      await relayLine(commands, ['hunt', 'stop', ...flags], response);
    } catch (error) {
      next(error);
    }
  });

  router.post('/reopen', async (request, response, next) => {
    try {
      const body = bodyOf(request.body);
      if (body === null) {
        sendBadRequest(response, BODY_NOT_OBJECT);
        return;
      }
      const { hunt, project, unit } = body;
      if (!isArgText(hunt) || !isArgText(project) || !isArgText(unit)) {
        sendBadRequest(response, 'hunt, project and unit are each required text that does not begin with a dash');
        return;
      }
      await relayLine(commands, ['hunt', 'reopen', hunt, project, unit], response);
    } catch (error) {
      next(error);
    }
  });

  return router;
}

/**
 * Checks a PUT body and turns its fields into the dispatcher's flags, in the order the fields are listed for the flags.
 * An unknown key, no allowed key at all, or a field of the wrong type is an error sentence; the value itself is the dispatcher's to judge.
 */
function settingsFlags(body: Record<string, unknown>): { flags: string[] } | { error: string } {
  const unknownKey = Object.keys(body).find((key) => !SETTING_KEYS.includes(key));
  if (unknownKey !== undefined) {
    return { error: `\`${unknownKey.slice(0, KEY_MAX)}\` is not a hunt setting; name ${SETTING_NAMES}` };
  }
  const { nightly, start, minutes, ticketsPerNight, turns, order, projects } = body;
  const present = [nightly, start, minutes, ticketsPerNight, turns, order, projects].some((field) => field !== undefined);
  if (!present) {
    return { error: `name at least one of ${SETTING_NAMES}` };
  }
  const flags: string[] = [];
  if (nightly !== undefined) {
    if (typeof nightly !== 'boolean') return { error: 'nightly must be true or false' };
    flags.push(`--nightly=${nightly ? 'on' : 'off'}`);
  }
  if (start !== undefined) {
    if (typeof start !== 'string') return { error: 'start must be text' };
    flags.push(`--start=${start}`);
  }
  if (minutes !== undefined) {
    if (!isWhole(minutes)) return { error: 'Minutes a night must be a whole number' };
    flags.push(`--minutes=${minutes}`);
  }
  if (ticketsPerNight !== undefined) {
    if (!isWhole(ticketsPerNight)) return { error: 'Tickets a night must be a whole number' };
    flags.push(`--tickets=${ticketsPerNight}`);
  }
  if (turns !== undefined) {
    if (typeof turns !== 'string') return { error: 'turns must be text' };
    flags.push(`--turns=${turns}`);
  }
  if (order !== undefined) {
    if (!isListOf(order, isListWord)) return { error: 'order must be a list of names with no comma or line break' };
    flags.push(`--order=${order.join(',')}`);
  }
  if (projects !== undefined) {
    if (!isListOf(projects, isProjectName)) {
      return { error: 'projects must be a list of names, none empty, with no comma or line break' };
    }
    flags.push(`--projects=${projects.join(',')}`);
  }
  return { flags };
}

/** A whole number the dispatcher can take as a count: a safe integer with no fraction. */
function isWhole(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

/** One word of a comma-joined list: text with no comma and no line break, which would split or break the list. */
function isListWord(value: unknown): value is string {
  return typeof value === 'string' && !/[,\r\n]/.test(value);
}

/** A project name is a list word that is not empty. */
function isProjectName(value: unknown): value is string {
  return isListWord(value) && value !== '';
}

/** An array in which every item passes `isWord`. */
function isListOf(value: unknown, isWord: (item: unknown) => item is string): value is string[] {
  return Array.isArray(value) && value.every(isWord);
}
