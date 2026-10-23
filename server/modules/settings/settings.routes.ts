import express from 'express';

import { AppError } from '@/shared/utils.js';

import { readClaudeApi, removeClaudeApiKey, saveClaudeApiKey } from './claude-api-keys.js';
import type { ClaudeApiKeySave } from './claude-api-keys.js';
import type { createSettingsService } from './settings.service.js';

type AuthenticatedRequest = express.Request & { user?: { id?: number | string } };

function userId(req: express.Request): number {
  return Number((req as AuthenticatedRequest).user?.id);
}

function queryString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * A `:slot` path segment as the 1 or 2 the door takes, or the 400 that names them. Refused HERE,
 * before a door is spawned: `set 3` would otherwise be a door fault (exit 1), which is the wrong
 * sentence for a caller's typo.
 */
function claudeApiSlot(value: unknown): number {
  if (value === '1') return 1;
  if (value === '2') return 2;
  throw new AppError('slot must be 1 or 2', { code: 'INVALID_CLAUDE_API_SLOT', statusCode: 400 });
}

/**
 * A PUT body as the door's `set` can be asked with. Every shape the door cannot take is refused
 * here, by name, before a child is spawned; the door's own RULES (a key's shape, a label that
 * looks like a key, settings for an empty slot) stay in Python, where the door is the one judge.
 *
 * `undefined` means "leave this alone", while `renewsDay: null` means "clear the day" — the two
 * are different requests, and the door spells them `--renews` omitted and `--renews none`.
 */
function claudeApiSave(body: unknown): ClaudeApiKeySave {
  const input = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  const save: ClaudeApiKeySave = {};
  if (input.key !== undefined) {
    if (typeof input.key !== 'string') {
      throw new AppError('key must be a string', { code: 'INVALID_CLAUDE_API_KEY', statusCode: 400 });
    }
    save.key = input.key;
  }
  if (input.label !== undefined) {
    if (typeof input.label !== 'string') {
      throw new AppError('label must be a string', { code: 'INVALID_CLAUDE_API_LABEL', statusCode: 400 });
    }
    save.label = input.label;
  }
  if (input.creditUsd !== undefined) {
    if (typeof input.creditUsd !== 'number' || !Number.isFinite(input.creditUsd) || input.creditUsd < 0) {
      throw new AppError('creditUsd must be a non-negative number', {
        code: 'INVALID_CLAUDE_API_CREDIT',
        statusCode: 400,
      });
    }
    save.creditUsd = input.creditUsd;
  }
  if (input.renewsDay !== undefined) {
    const day = input.renewsDay;
    if (day === null) save.renewsDay = null;
    else if (typeof day === 'number' && Number.isInteger(day) && day >= 1 && day <= 31) save.renewsDay = day;
    else {
      throw new AppError('renewsDay must be a whole day from 1 to 31, or null', {
        code: 'INVALID_CLAUDE_API_RENEWS_DAY',
        statusCode: 400,
      });
    }
  }
  return save;
}

/** Creates thin Settings transport handlers around the application service. */
export function createSettingsRouter(
  service: ReturnType<typeof createSettingsService>,
): express.Router {
  const router = express.Router();
  const respond = (operation: (req: express.Request) => unknown | Promise<unknown>) =>
    async (req: express.Request, res: express.Response, next: express.NextFunction) => {
      try { res.json(await operation(req)); } catch (error) { next(error); }
    };

  router.get('/api-keys', respond((req) => service.listApiKeys(userId(req))));
  router.post('/api-keys', respond((req) => service.createApiKey(userId(req), req.body?.keyName)));
  router.delete('/api-keys/:keyId', respond((req) => service.deleteApiKey(userId(req), Number(req.params.keyId))));
  router.patch('/api-keys/:keyId/toggle', respond((req) => service.toggleApiKey(
    userId(req), Number(req.params.keyId), req.body?.isActive,
  )));
  router.get('/credentials', respond((req) => service.listCredentials(
    userId(req), queryString(req.query.type),
  )));
  router.post('/credentials', respond((req) => service.createCredential(userId(req), req.body ?? {})));
  router.delete('/credentials/:credentialId', respond((req) => service.deleteCredential(
    userId(req), Number(req.params.credentialId),
  )));
  router.patch('/credentials/:credentialId/toggle', respond((req) => service.toggleCredential(
    userId(req), Number(req.params.credentialId), req.body?.isActive,
  )));
  router.get('/notification-preferences', respond((req) => service.getNotificationPreferences(userId(req))));
  router.put('/notification-preferences', respond((req) => service.updateNotificationPreferences(
    userId(req), req.body ?? {},
  )));
  // Host-wide, not per-user: the switch steers one plan-runner daemon, so no `userId` is read.
  router.get('/deepseek-flash', respond(() => service.getDeepseekFlash()));
  router.put('/deepseek-flash', respond((req) => service.setDeepseekFlash(req.body?.enabled)));
  // The Claude API keys' own routes, host-wide like the switches beside them: they steer which key
  // pays for a plan run on this host, so no `userId` is read. The door does every judgement that
  // is a rule — a key's shape, a label that looks like a key, settings for an empty slot — and
  // answers its own words; these routes refuse only a shape the door could not be asked with. THE
  // BODY IS NEVER LOGGED, ECHOED OR PUT IN AN ERROR: it carries a key, and the key reaches the
  // door's stdin and nowhere else. GET answers the door's picture, and both writes answer a fresh
  // one; a refused save is the door's sentence in the server's envelope.
  router.get('/claude-api', respond(() => readClaudeApi()));
  router.put('/claude-api/:slot', respond((req) => saveClaudeApiKey(
    claudeApiSlot(req.params.slot), claudeApiSave(req.body),
  )));
  router.delete('/claude-api/:slot', respond((req) => removeClaudeApiKey(claudeApiSlot(req.params.slot))));
  // The dispatcher's own DeepSeek switch, host-wide for the same reason: the features and epics with no
  // model word of their own ride it, apart from the chat's switch above.
  router.get('/deepseek-features', respond(() => service.getDeepseekFeatures()));
  router.put('/deepseek-features', respond((req) => service.setDeepseekFeatures(req.body?.enabled)));
  // The dispatcher's park-at-peak switch, host-wide like the two above and read the same way: it
  // steers the dispatcher on this host, so no `userId` is read. One word on the PUT body, because
  // the file holds one line — `off`, or `on`.
  router.get('/park-at-peak', respond(() => service.getParkAtPeak()));
  router.put('/park-at-peak', respond((req) => service.setParkAtPeak(req.body?.enabled)));
  // The plan runner's Dactyls switch, host-wide like the ones above: it steers the runner on this host,
  // so no `userId` is read. One word on the PUT body, because the file holds one line. The GET also
  // carries the verb's readiness, which is not the file's to hold.
  router.get('/dactyls', respond(() => service.getDactyls()));
  router.put('/dactyls', respond((req) => service.setDactyls(req.body?.enabled)));
  // The Custom compaction switch, host-wide like the ones above: it steers how chats on this host
  // compact, so no `userId` is read. One word on the PUT body, because the file holds one line. The GET
  // also carries the summarizer's words and readiness, which are not the file's to hold.
  router.get('/custom-compaction', respond(() => service.getCustomCompaction()));
  router.put('/custom-compaction', respond((req) => service.setCustomCompaction(req.body?.enabled)));
  // The Dactyls-for-the-main-session switch, host-wide like the ones above: it steers every main session on
  // this host, so no `userId` is read. One word on the PUT body, because the file holds one line. The GET
  // also carries the dactyl's words, its readiness and the week's hand ledger, which are not the file's.
  router.get('/main-session-dactyls', respond(() => service.getMainSessionDactyls()));
  router.put('/main-session-dactyls', respond((req) => service.setMainSessionDactyls(req.body?.enabled)));
  // The dispatcher's planner-lane dial, host-wide like the switches above and read the same way: it
  // steers the dispatcher on this host, so no `userId` is read. One integer on the PUT body, because
  // the file holds one line — a bare count of at least 1.
  router.get('/planner-lanes', respond(() => service.getPlannerLanes()));
  router.put('/planner-lanes', respond((req) => service.setPlannerLanes(req.body?.lanes)));
  // The usage pacer's weekly stop, host-wide like the switches above: it steers the pacer on this host, so
  // no `userId` is read. One integer on the PUT body, because the file holds one line — a whole percent.
  router.get('/weekly-stop', respond(() => service.getWeeklyStop()));
  router.put('/weekly-stop', respond((req) => service.setWeeklyStop(req.body?.percent)));
  // The heal reflex's four switches, host-wide and read the same way: they are flag files steering a
  // worker on this host, so no `userId` is read. THE MASTER is the first of the family — one line,
  // `off` or `on`, and the only one of the four the reflex's whole launching hangs on. The CYCLE
  // SCHEDULE carries its hour on the PUT body beside `enabled`, because that file is a
  // single line (`off`, or `on <hour>`), and the cap is a route of its own because its line holds a
  // dollar amount and nothing else. Absent or null means no ceiling. The MODEL is one of its own for
  // the same reason: its line holds one of two words, or nothing at all, and nothing at all is the
  // switch that FOLLOWS the session chat.
  router.get('/heal-master', respond(() => service.getHealMaster()));
  router.put('/heal-master', respond((req) => service.setHealMaster(req.body?.enabled)));
  router.get('/heal-cycle', respond(() => service.getHealCycle()));
  router.put('/heal-cycle', respond((req) => service.setHealCycle(req.body?.enabled, req.body?.hour)));
  router.get('/heal-cap', respond(() => service.getHealCap()));
  router.put('/heal-cap', respond((req) => service.setHealCap(req.body?.usd)));
  // The Gemini budget's per-plan cap, host-wide like the switches above: the backend's gate reads the file
  // at every Gemini call. One dollar amount on the PUT body, because the file holds one line — and no null,
  // because the cap has no off state.
  router.get('/gemini-plan-cap', respond(() => service.getGeminiPlanCap()));
  router.put('/gemini-plan-cap', respond((req) => service.setGeminiPlanCap(req.body?.usd)));
  router.get('/heal-model', respond(() => service.getHealModel()));
  router.put('/heal-model', respond((req) => service.setHealModel(req.body?.model)));
  // Also host-wide, and for the same reason: these flag files steer hooks and scripts on this host,
  // so no `userId` is read. A PUT carries only the switch or switches it means to move.
  router.get('/jev', respond(() => service.getJev()));
  router.put('/jev', respond((req) => service.setJev(req.body)));
  router.get('/push/vapid-public-key', respond(() => service.getVapidPublicKey()));
  router.post('/push/subscribe', respond((req) => service.subscribeToPush(userId(req), req.body ?? {})));
  router.post('/push/unsubscribe', respond((req) => service.unsubscribeFromPush(
    userId(req), req.body?.endpoint,
  )));
  return router;
}
