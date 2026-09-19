import { AppError } from '@/shared/utils.js';

import type { JevLedgerStats } from './jev-ledger.js';
import type { JevSwitches } from './jev-switches.js';

type ApiKeyRow = Record<string, unknown> & { api_key: string };
type NotificationPreferences = Record<string, unknown> & {
  channels?: Record<string, unknown> & { webPush?: boolean };
};

type SettingsDependencies = {
  apiKeys: {
    list(userId: number): ApiKeyRow[];
    create(userId: number, keyName: string): unknown;
    remove(userId: number, keyId: number): boolean;
    toggle(userId: number, keyId: number, isActive: boolean): boolean;
  };
  credentials: {
    list(userId: number, credentialType: string | null): unknown[];
    create(
      userId: number,
      name: string,
      type: string,
      value: string,
      description: string | null,
    ): unknown;
    remove(userId: number, credentialId: number): boolean;
    toggle(userId: number, credentialId: number, isActive: boolean): boolean;
  };
  notifications: {
    getPreferences(userId: number): NotificationPreferences | undefined;
    updatePreferences(userId: number, preferences: NotificationPreferences): unknown;
    createEnabledEvent(): unknown;
    notifyUser(userId: number, event: unknown): void | Promise<void>;
  };
  pushSubscriptions: {
    save(userId: number, endpoint: string, p256dh: string, auth: string): void;
    remove(endpoint: string): void;
  };
  /**
   * The plan runner's DeepSeek switch. It is machine-wide rather than per-user because the thing
   * it steers is one daemon on this host, not a row anyone owns — every signed-in operator of
   * this server sees and sets the same switch.
   */
  deepseekFlash: {
    read(): Promise<boolean>;
    write(enabled: boolean): Promise<void>;
  };
  /**
   * The house Jev switches, in the same shape and for the same reason: two flag files that steer
   * hooks and scripts running on this host, so they are machine-wide rather than a row any signed-in
   * operator owns. The two are separate files with separate blast radii — see `jev-switches.ts`.
   */
  jev: {
    read(): Promise<JevSwitches>;
    writeMaster(enabled: boolean): Promise<void>;
    writePrompts(enabled: boolean): Promise<void>;
    readStats(): Promise<JevLedgerStats>;
  };
  getVapidPublicKey(): string | null;
};

/**
 * One switch named by a `PUT /jev` body: its value when it was sent as a real boolean, `undefined`
 * when it was not sent at all, and a 400 for anything else — `"yes"`, `1`, `null`. Absent and
 * malformed are kept apart on purpose: absent means "leave this switch alone", malformed means the
 * caller is guessing, and only the first of those may be honoured.
 */
function optionalBoolean(input: Record<string, unknown>, field: string): boolean | undefined {
  const value = input[field];
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') {
    throw new AppError(`${field} must be a boolean`, {
      code: 'INVALID_JEV_SWITCH_STATE',
      statusCode: 400,
    });
  }
  return value;
}

function requiredString(value: unknown, fieldName: string, code: string): string {
  const normalizedValue = typeof value === 'string' ? value.trim() : '';
  if (!normalizedValue) {
    throw new AppError(`${fieldName} is required`, { code, statusCode: 400 });
  }
  return normalizedValue;
}

function assertFound(found: boolean, resourceName: string, code: string): void {
  if (!found) {
    throw new AppError(`${resourceName} not found`, { code, statusCode: 404 });
  }
}

/** Creates settings workflows with repositories and notification effects injected. */
export function createSettingsService(dependencies: SettingsDependencies) {
  return {
    listApiKeys(userId: number) {
      const apiKeys = dependencies.apiKeys.list(userId).map((key) => ({
        ...key,
        api_key: `${key.api_key.substring(0, 10)}...`,
      }));
      return { apiKeys };
    },
    createApiKey(userId: number, keyNameInput: unknown) {
      const keyName = requiredString(keyNameInput, 'Key name', 'API_KEY_NAME_REQUIRED');
      return { success: true, apiKey: dependencies.apiKeys.create(userId, keyName) };
    },
    deleteApiKey(userId: number, keyId: number) {
      assertFound(dependencies.apiKeys.remove(userId, keyId), 'API key', 'API_KEY_NOT_FOUND');
      return { success: true };
    },
    toggleApiKey(userId: number, keyId: number, isActive: unknown) {
      if (typeof isActive !== 'boolean') {
        throw new AppError('isActive must be a boolean', {
          code: 'INVALID_ACTIVE_STATE',
          statusCode: 400,
        });
      }
      assertFound(
        dependencies.apiKeys.toggle(userId, keyId, isActive),
        'API key',
        'API_KEY_NOT_FOUND',
      );
      return { success: true };
    },
    listCredentials(userId: number, credentialType: string | null) {
      return { credentials: dependencies.credentials.list(userId, credentialType) };
    },
    createCredential(userId: number, input: Record<string, unknown>) {
      const credentialName = requiredString(
        input.credentialName,
        'Credential name',
        'CREDENTIAL_NAME_REQUIRED',
      );
      const credentialType = requiredString(
        input.credentialType,
        'Credential type',
        'CREDENTIAL_TYPE_REQUIRED',
      );
      const credentialValue = requiredString(
        input.credentialValue,
        'Credential value',
        'CREDENTIAL_VALUE_REQUIRED',
      );
      const description = typeof input.description === 'string'
        ? input.description.trim() || null
        : null;
      return {
        success: true,
        credential: dependencies.credentials.create(
          userId,
          credentialName,
          credentialType,
          credentialValue,
          description,
        ),
      };
    },
    deleteCredential(userId: number, credentialId: number) {
      assertFound(
        dependencies.credentials.remove(userId, credentialId),
        'Credential',
        'CREDENTIAL_NOT_FOUND',
      );
      return { success: true };
    },
    toggleCredential(userId: number, credentialId: number, isActive: unknown) {
      if (typeof isActive !== 'boolean') {
        throw new AppError('isActive must be a boolean', {
          code: 'INVALID_ACTIVE_STATE',
          statusCode: 400,
        });
      }
      assertFound(
        dependencies.credentials.toggle(userId, credentialId, isActive),
        'Credential',
        'CREDENTIAL_NOT_FOUND',
      );
      return { success: true };
    },
    getNotificationPreferences(userId: number) {
      return { success: true, preferences: dependencies.notifications.getPreferences(userId) };
    },
    updateNotificationPreferences(userId: number, preferences: NotificationPreferences) {
      return {
        success: true,
        preferences: dependencies.notifications.updatePreferences(userId, preferences),
      };
    },
    async getDeepseekFlash() {
      return { enabled: await dependencies.deepseekFlash.read() };
    },
    async setDeepseekFlash(enabledInput: unknown) {
      if (typeof enabledInput !== 'boolean') {
        throw new AppError('enabled must be a boolean', {
          code: 'INVALID_DEEPSEEK_FLASH_STATE',
          statusCode: 400,
        });
      }
      await dependencies.deepseekFlash.write(enabledInput);
      // Read back rather than echo the input: the switch is a file another daemon reads, and the
      // answer the UI renders should be what is on disk, not what we asked for.
      return { enabled: await dependencies.deepseekFlash.read() };
    },
    async getJev() {
      return dependencies.jev.read();
    },
    async setJev(input: unknown) {
      if (typeof input !== 'object' || input === null || Array.isArray(input)) {
        throw new AppError('master and/or prompts must be sent as a JSON object', {
          code: 'INVALID_JEV_SWITCH_STATE',
          statusCode: 400,
        });
      }
      const body = input as Record<string, unknown>;
      const master = optionalBoolean(body, 'master');
      const prompts = optionalBoolean(body, 'prompts');
      if (master === undefined && prompts === undefined) {
        throw new AppError('master or prompts must be a boolean', {
          code: 'INVALID_JEV_SWITCH_STATE',
          statusCode: 400,
        });
      }
      // Both positions as they stand, taken before either write: the compensating write below needs
      // the master's previous value, and it must be the value from BEFORE this request, not whatever
      // a failed half left behind.
      const before = await dependencies.jev.read();

      // Only the fields that came in are written. The two switches are separate files with separate
      // meanings, so a PUT naming one must not be able to move the other as a side effect.
      //
      // They are also two FILES, with no transaction between them, and the order below is the one
      // that can be compensated. A failure on the prompts write would leave `{master:true,prompts:false}`
      // half-landed: the master on (so Python reads the pair as live) with prompt sending still armed
      // from the stored file. The master is therefore put back where it was. Writing prompts FIRST is
      // not the cure — that direction arms prompt sending in the window between the two writes.
      let masterWritten = false;
      try {
        if (master !== undefined) {
          await dependencies.jev.writeMaster(master);
          masterWritten = true;
        }
        if (prompts !== undefined) await dependencies.jev.writePrompts(prompts);
      } catch (error) {
        if (!masterWritten) throw error;
        try {
          await dependencies.jev.writeMaster(before.master);
        } catch (restoreError) {
          // Both halves are now unknown to the caller, so say what is actually on disk rather than
          // letting the original error imply nothing was changed.
          console.error('Jev: the prompt switch could not be written, and the master could not be restored:', restoreError);
          throw new AppError(
            `The Jev switches could not be updated: the master switch was left ${master ? 'on' : 'off'}. Check ~/.claude/state/jev.flag before relying on it.`,
            { code: 'JEV_SWITCH_WRITE_PARTIAL', statusCode: 500 },
          );
        }
        throw error;
      }
      // Read back rather than echo the request: these are files another process reads at call time,
      // and the answer the panel renders — `promptsLive` included — should be what is on disk now.
      return dependencies.jev.read();
    },
    async getJevStats() {
      return dependencies.jev.readStats();
    },
    getVapidPublicKey() {
      return { publicKey: dependencies.getVapidPublicKey() };
    },
    subscribeToPush(userId: number, input: Record<string, unknown>) {
      const endpoint = requiredString(input.endpoint, 'Endpoint', 'PUSH_SUBSCRIPTION_REQUIRED');
      const keys = typeof input.keys === 'object' && input.keys !== null
        ? input.keys as Record<string, unknown>
        : {};
      const p256dh = requiredString(keys.p256dh, 'p256dh', 'PUSH_SUBSCRIPTION_REQUIRED');
      const auth = requiredString(keys.auth, 'auth', 'PUSH_SUBSCRIPTION_REQUIRED');
      dependencies.pushSubscriptions.save(userId, endpoint, p256dh, auth);

      const currentPreferences = dependencies.notifications.getPreferences(userId);
      if (!currentPreferences?.channels?.webPush) {
        dependencies.notifications.updatePreferences(userId, {
          ...currentPreferences,
          channels: { ...currentPreferences?.channels, webPush: true },
        });
      }
      const event = dependencies.notifications.createEnabledEvent();
      void dependencies.notifications.notifyUser(userId, event);
      return { success: true };
    },
    unsubscribeFromPush(userId: number, endpointInput: unknown) {
      const endpoint = requiredString(endpointInput, 'Endpoint', 'PUSH_ENDPOINT_REQUIRED');
      dependencies.pushSubscriptions.remove(endpoint);
      const currentPreferences = dependencies.notifications.getPreferences(userId);
      if (currentPreferences?.channels?.webPush) {
        dependencies.notifications.updatePreferences(userId, {
          ...currentPreferences,
          channels: { ...currentPreferences.channels, webPush: false },
        });
      }
      return { success: true };
    },
  };
}
