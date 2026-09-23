import express from 'express';

import type { createSettingsService } from './settings.service.js';

type AuthenticatedRequest = express.Request & { user?: { id?: number | string } };

function userId(req: express.Request): number {
  return Number((req as AuthenticatedRequest).user?.id);
}

function queryString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
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
  // Host-wide for the same reason, and read the same way: the swarm flag steers one plan runner on
  // this host, so no `userId` is read. `lanes` rides on the PUT body beside `enabled` because the
  // file holds one line — `off`, `on`, or `on <N>` — so the ceiling is not a setting of its own, and
  // it is OPTIONAL: absent or null is no ceiling at all, which is the switch's default.
  router.get('/swarm', respond(() => service.getSwarm()));
  router.put('/swarm', respond((req) => service.setSwarm(req.body?.enabled, req.body?.lanes)));
  // The heal reflex's four switches, host-wide and read the same way: they are flag files steering a
  // worker on this host, so no `userId` is read. THE MASTER is the first of the family — one line,
  // `off` or `on`, and the only one of the four the reflex's whole launching hangs on. The CYCLE
  // SCHEDULE carries its hour on the PUT body, as `lanes` on the swarm one, because that file is a
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
