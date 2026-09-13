import express from 'express';

import { notificationChannelEndpointsDb, notificationPreferencesDb } from '@/modules/database/index.js';
import {
  getAppUrl,
  getNtfyConfig,
  maskNtfyMetadata,
  normalizeAppUrl,
  NTFY_CHANNEL,
  NtfyConfigError,
  removeNtfyConfig,
  saveNtfyConfig,
  setAppUrl,
  toNtfyConfigView,
} from '@/modules/notifications/services/ntfy-config.service.js';
import type { NtfyConfigInput } from '@/modules/notifications/services/ntfy-config.service.js';
import { publishNtfy } from '@/modules/notifications/services/ntfy-publish.service.js';

const router = express.Router();

function readText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function sanitizeEndpoint(endpoint: any) {
  const metadata = notificationChannelEndpointsDb.parseMetadata(endpoint.metadata_json);
  return {
    id: endpoint.id,
    channel: endpoint.channel,
    endpointId: endpoint.endpoint_id,
    label: endpoint.label,
    // An ntfy row's metadata holds its topic and token — credentials a listing must never return.
    metadata: endpoint.channel === NTFY_CHANNEL ? maskNtfyMetadata(metadata) : metadata,
    enabled: Boolean(endpoint.enabled),
    lastSeenAt: endpoint.last_seen_at,
    createdAt: endpoint.created_at,
    updatedAt: endpoint.updated_at,
  };
}

function readUserId(req: express.Request): number {
  const userId = Number((req as any).user?.id);
  if (!Number.isInteger(userId) || userId <= 0) {
    throw new Error('Authenticated user is missing');
  }
  return userId;
}

function updateChannelPreference(userId: number, channel: string): unknown {
  const currentPrefs = notificationPreferencesDb.getPreferences(userId);
  const hasEnabledEndpoint = notificationChannelEndpointsDb.getEnabledEndpoints(userId, channel).length > 0;
  return notificationPreferencesDb.updatePreferences(userId, {
    ...currentPrefs,
    channels: { ...currentPrefs.channels, [channel]: hasEnabledEndpoint },
  });
}

router.get('/endpoints', (req, res) => {
  try {
    const channel = readText(req.query.channel);
    if (!channel) {
      return res.status(400).json({ error: 'channel is required' });
    }

    const userId = readUserId(req);
    const endpoints = notificationChannelEndpointsDb
      .getEndpoints(userId, channel)
      .map(sanitizeEndpoint);
    return res.json({ success: true, endpoints });
  } catch (error) {
    console.error('Error fetching notification endpoints:', error);
    return res.status(500).json({ error: 'Failed to fetch notification endpoints' });
  }
});

router.post('/endpoints/current', (req, res) => {
  try {
    const { channel, endpointId, label, metadata = {}, enabled = true } = req.body || {};
    const normalizedChannel = readText(channel);
    const normalizedEndpointId = readText(endpointId);
    if (!normalizedChannel || !normalizedEndpointId) {
      return res.status(400).json({ error: 'channel and endpointId are required' });
    }

    const userId = readUserId(req);
    const endpoint = notificationChannelEndpointsDb.upsertEndpoint({
      userId,
      channel: normalizedChannel,
      endpointId: normalizedEndpointId,
      label,
      metadata: metadata && typeof metadata === 'object' ? metadata : {},
      enabled: enabled !== false,
    });

    const preferences = updateChannelPreference(userId, normalizedChannel);
    return res.json({ success: true, endpoint: sanitizeEndpoint(endpoint), preferences });
  } catch (error) {
    console.error('Error registering notification endpoint:', error);
    return res.status(500).json({ error: 'Failed to register notification endpoint' });
  }
});

router.patch('/endpoints/:channel/:endpointId', (req, res) => {
  try {
    const { channel, endpointId } = req.params;
    const { enabled } = req.body || {};
    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ error: 'enabled must be a boolean' });
    }

    const userId = readUserId(req);
    const updated = notificationChannelEndpointsDb.setEndpointEnabled(userId, channel, endpointId, enabled);
    if (!updated) {
      return res.status(404).json({ error: 'Notification endpoint not found' });
    }

    const endpoint = notificationChannelEndpointsDb.getEndpoint(userId, channel, endpointId);
    const preferences = updateChannelPreference(userId, channel);
    return res.json({ success: true, endpoint: endpoint ? sanitizeEndpoint(endpoint) : null, preferences });
  } catch (error) {
    console.error('Error updating notification endpoint:', error);
    return res.status(500).json({ error: 'Failed to update notification endpoint' });
  }
});

router.delete('/endpoints/:channel/:endpointId', (req, res) => {
  try {
    const { channel, endpointId } = req.params;
    const userId = readUserId(req);
    const removed = notificationChannelEndpointsDb.removeEndpoint(userId, channel, endpointId);
    if (!removed) {
      return res.status(404).json({ error: 'Notification endpoint not found' });
    }

    const preferences = updateChannelPreference(userId, channel);
    return res.json({ success: true, preferences });
  } catch (error) {
    console.error('Error removing notification endpoint:', error);
    return res.status(500).json({ error: 'Failed to remove notification endpoint' });
  }
});

const isString = (value: unknown): value is string => typeof value === 'string';
const isStringOrNull = (value: unknown): value is string | null => value === null || typeof value === 'string';
const isNumber = (value: unknown): value is number => typeof value === 'number';
const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean';

/** Reads one optional body field; a field that is present with the wrong type is a 400. */
function readBodyField<T>(
  source: Record<string, unknown>,
  field: string,
  isValid: (value: unknown) => value is T,
): T | undefined {
  const value = source[field];
  if (value === undefined) return undefined;
  if (!isValid(value)) throw new NtfyConfigError(`${field} has the wrong type`);
  return value;
}

/** Parses the ntfy settings PUT body into the service input plus the instance-wide app URL. */
function readNtfySettingsBody(body: unknown): { input: NtfyConfigInput; appUrl: string | null | undefined } {
  const source = body && typeof body === 'object' ? body as Record<string, unknown> : {};
  return {
    input: {
      serverUrl: readBodyField(source, 'serverUrl', isString),
      topic: readBodyField(source, 'topic', isString),
      token: readBodyField(source, 'token', isStringOrNull),
      longRunMinutes: readBodyField(source, 'longRunMinutes', isNumber),
      enabled: readBodyField(source, 'enabled', isBoolean),
    },
    appUrl: readBodyField(source, 'appUrl', isStringOrNull),
  };
}

router.get('/ntfy', (req, res) => {
  try {
    return res.json(toNtfyConfigView(getNtfyConfig(readUserId(req))));
  } catch (error) {
    console.error('Error reading ntfy settings:', error);
    return res.status(500).json({ error: 'Failed to read ntfy settings' });
  }
});

router.put('/ntfy', (req, res) => {
  try {
    const userId = readUserId(req);
    const { input, appUrl } = readNtfySettingsBody(req.body);
    // Both halves validate before either writes: saveNtfyConfig validates then writes, and the app
    // URL is normalized up front, so a 400 from either half leaves every stored value as it was.
    const storedAppUrl = appUrl === undefined ? undefined : normalizeAppUrl(appUrl);
    const view = saveNtfyConfig(userId, input);
    if (storedAppUrl !== undefined) setAppUrl(storedAppUrl);
    return res.json({ ...view, appUrl: getAppUrl() });
  } catch (error) {
    if (error instanceof NtfyConfigError) {
      return res.status(error.status).json({ error: error.message });
    }
    console.error('Error saving ntfy settings:', error);
    return res.status(500).json({ error: 'Failed to save ntfy settings' });
  }
});

router.delete('/ntfy', (req, res) => {
  try {
    removeNtfyConfig(readUserId(req));
    return res.json({ ok: true });
  } catch (error) {
    console.error('Error removing ntfy settings:', error);
    return res.status(500).json({ error: 'Failed to remove ntfy settings' });
  }
});

router.post('/ntfy/test', async (req, res) => {
  try {
    const config = getNtfyConfig(readUserId(req));
    if (!config?.topic) {
      return res.status(404).json({ error: 'ntfy is not configured' });
    }
    const result = await publishNtfy(
      { serverUrl: config.serverUrl, topic: config.topic, token: config.token },
      {
        title: 'CloudCLI test',
        message: 'ntfy is connected to CloudCLI.',
        priority: 3,
        tags: ['white_check_mark'],
        click: getAppUrl() ?? undefined,
      },
    );
    return res.json(result);
  } catch (error) {
    console.error('Error sending ntfy test push:', error);
    return res.status(500).json({ error: 'Failed to send ntfy test push' });
  }
});

export default router;
