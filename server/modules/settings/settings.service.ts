import { AppError } from '@/shared/utils.js';

import { JEV_SCOPES } from './jev-switches.js';
import type { JevScopeKey, JevSwitches } from './jev-switches.js';
import { readHealModel, writeHealModel } from './heal-model-switch.js';
import type { HealModel } from './heal-model-switch.js';
import { readHealCycle, writeHealCycle } from './heal-cycle-switch.js';
import { readHealCap, readHealMaster, writeHealCap, writeHealMaster } from './heal-switch.js';
import { readSwarmSwitch, writeSwarmSwitch } from './swarm-switch.js';

/**
 * Every field a `PUT /jev` body may name — the master plus each scope in the table — for the two
 * messages that have to enumerate them. Derived from `JEV_SCOPES` so a scope added there is named
 * here without an edit.
 */
const JEV_SWITCH_FIELDS = ['master', ...Object.keys(JEV_SCOPES)].join(', ');

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
   * The house Jev switches, in the same shape and for the same reason: flag files that steer hooks
   * and scripts running on this host, so they are machine-wide rather than a row any signed-in
   * operator owns. Each scope is its own file with its own blast radius — see `jev-switches.ts`.
   */
  jev: {
    read(): Promise<JevSwitches>;
    writeMaster(enabled: boolean): Promise<void>;
    writeScope(scope: JevScopeKey, enabled: boolean): Promise<void>;
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
    /**
     * The swarm switch: whether the plan runner runs several phases of one plan at once, and the
     * optional ceiling it runs under.
     *
     * Unlike the DeepSeek switch above it — the one switch here injected as a dependency, because a
     * Kanban board carries its own copy of that flag and needs a second writer — this one is not a
     * dependency of this service: it reads and writes `swarm-switch.ts` directly, the way the metis
     * spawner reads its own flag writer and the way the heal switches below read theirs. There is one
     * swarm flag and no second path to it, so an injected pair would carry nothing the module does not.
     */
    async getSwarm() {
      return readSwarmSwitch();
    },
    async setSwarm(enabledInput: unknown, lanesInput: unknown) {
      if (typeof enabledInput !== 'boolean') {
        throw new AppError('enabled must be a boolean', {
          code: 'INVALID_SWARM_STATE',
          statusCode: 400,
        });
      }
      // The ceiling is OPTIONAL, and both ways of saying "none" mean the same thing: absent, or
      // an explicit null. `null` is the uncapped default the operator asked for, so it is a
      // position and never an error — a caller turning the switch on with no ceiling chosen gets
      // `on`, every phase the independence rule frees at once.
      const lanes = lanesInput === undefined || lanesInput === null ? null : lanesInput;
      // A COUNT, and one both languages can hold. `Number.isSafeInteger` is exactly the line where
      // this server's double and the runner's arbitrary-precision int stop agreeing — the reader in
      // `swarm-switch.ts` says so at the same line, and answers one lane past it rather than the
      // number — so a ceiling above it is a value the row would draw as `1 lane` while the runner
      // honoured nine quadrillion, and `1e21` is worse still: `Math.trunc(1e21).toString()` is
      // `1e+21`, a token NEITHER grammar accepts, so an ON press would leave a flag both readers
      // call OFF. Refused at the door, where the count enters, rather than narrowed on the way out.
      // A float is refused with it: a ceiling is a number of lanes, and silently truncating one is
      // how the row and the file first disagree.
      if (lanes !== null && (typeof lanes !== 'number' || !Number.isSafeInteger(lanes))) {
        throw new AppError('lanes must be a whole number of lanes, or null for no ceiling', {
          code: 'INVALID_SWARM_STATE',
          statusCode: 400,
        });
      }
      await writeSwarmSwitch(enabledInput, lanes);
      // Read back rather than echo the input, for the reason above — and here the file is the one
      // that holds the truth about the ceiling: `null` reads back as `null`, and a count reads back
      // exactly as it was written, because nothing on either side narrows it.
      return readSwarmSwitch();
    },
    /**
     * The heal reflex's MASTER switch: whether the reflex may LAUNCH at all, over and above the cap
     * beside it. A flag file steering a worker this host runs detached from a hook, so it is
     * machine-wide rather than a row any signed-in operator owns.
     *
     * No count rides on this line — the file is the one word `off`, or `on` — and the row that draws
     * it reads back the side the server read off disk. `off` stops LAUNCHES and nothing else: an
     * ending still indexes the friction it saw, and the typed `/heal` door is the operator's own hand
     * and is never gated by it.
     */
    async getHealMaster() {
      return { enabled: await readHealMaster() };
    },
    async setHealMaster(enabledInput: unknown) {
      if (typeof enabledInput !== 'boolean') {
        throw new AppError('enabled must be a boolean', {
          code: 'INVALID_HEAL_MASTER_STATE',
          statusCode: 400,
        });
      }
      await writeHealMaster(enabledInput);
      // Read back rather than echo the input: the switch is a file another process reads, and the
      // answer the UI renders should be what is on disk, not what we asked for.
      return { enabled: await readHealMaster() };
    },
    /**
     * The heal reflex's CYCLE SCHEDULE: when the maintenance cycle opens, and the UTC hour it opens at.
     * A flag file of the family above, machine-wide for the same reason.
     *
     * `hour` rides on the PUT body beside `enabled` as `lanes` does on the swarm one: the file is ONE
     * line — `off`, or `on <hour>` — so the hour is REQUIRED and held to a whole hour of the day, and
     * no press can be drawn as a time it never asked for. Unlike the master this is not the launch
     * gate but a CLOCK: `off` stops the scheduled cycle and nothing else, because a pressed cycle is
     * the operator's own hand.
     */
    async getHealCycle() {
      return readHealCycle();
    },
    async setHealCycle(enabledInput: unknown, hourInput: unknown) {
      if (typeof enabledInput !== 'boolean') {
        throw new AppError('enabled must be a boolean', {
          code: 'INVALID_HEAL_CYCLE_STATE',
          statusCode: 400,
        });
      }
      // A whole hour of the day and nothing else: the worker reads `on <N>` as written, and answers
      // anything past 23 with the shipped hour — a fraction or a string is a schedule it drops.
      if (typeof hourInput !== 'number' || !Number.isInteger(hourInput) || hourInput < 0 || hourInput > 23) {
        throw new AppError('hour must be a whole hour of the day, 0..23', {
          code: 'INVALID_HEAL_CYCLE_STATE',
          statusCode: 400,
        });
      }
      // Read back rather than echo the input: the file another process reads is the answer.
      await writeHealCycle({ enabled: enabledInput, hour: hourInput });
      return readHealCycle();
    },
    /**
     * The ceiling on a day's DeepSeek spend. A negative one is refused at the door: the worker's own
     * gate is `cap >= 0`, so a negative file parks NOTHING and the refusal keeps the row and the worker
     * from disagreeing. A cap of ZERO is admitted, and it bites — the day's spend has already reached
     * it, so every heal is barred until local midnight.
     */
    async getHealCap() {
      return { usd: await readHealCap() };
    },
    async setHealCap(usdInput: unknown) {
      const usd = usdInput === undefined || usdInput === null ? null : usdInput;
      // A dollar amount the worker can measure spend against: finite, and zero or more. `NaN` and
      // `Infinity` are refused — a cap that cannot be compared to spend is a control that silently
      // does nothing. A NEGATIVE is refused for the reason above: the worker reads it as no ceiling,
      // so admitting one would answer the operator with a cap the reflex is not acting on. Zero is
      // admitted, and is the tightest ceiling there is — it bars every heal until tomorrow.
      if (usd !== null && (typeof usd !== 'number' || !Number.isFinite(usd) || usd < 0)) {
        throw new AppError('usd must be a non-negative dollar amount, or null for no ceiling', {
          code: 'INVALID_HEAL_CAP',
          statusCode: 400,
        });
      }
      await writeHealCap(usd);
      return { usd: await readHealCap() };
    },
    /**
     * The heal reflex's MODEL switch: which model a heal's souls run on — DeepSeek's billed flash, or
     * the operator's own Claude subscription. Its own file, so the heal's choice never moves the chat
     * composer's switch and the chat's never moves the heal's; the file names a side in every state,
     * and absent is `deepseek`, the side it shipped on.
     *
     * The cap above is a DEEPSEEK number: the worker sums the day's heals that ran on DeepSeek, so a
     * heal moved onto Claude is not a dollar any ceiling bounds and carries no cap, no dollar figure
     * and no warning of its own.
     */
    async getHealModel() {
      return { model: await readHealModel() };
    },
    async setHealModel(modelInput: unknown) {
      // THE TWO WORDS ARE THE BODY, and there is no third value: the file names a side in every state
      // (`deepseek` when it is absent), so a press always writes a model and a `null` is a request the
      // route cannot honour rather than the clear it was before this switch had its own default.
      const model: HealModel | undefined =
        modelInput === 'deepseek' || modelInput === 'claude' ? modelInput : undefined;
      if (model === undefined) {
        throw new AppError("model must be 'deepseek' or 'claude'", {
          code: 'INVALID_HEAL_MODEL_STATE',
          statusCode: 400,
        });
      }
      await writeHealModel(model);
      // Read back rather than echo the input, for the reason above: this is a file another process
      // parses at every ending, so the answer the UI renders is what is on disk.
      return { model: await readHealModel() };
    },
    async getJev() {
      return dependencies.jev.read();
    },
    async setJev(input: unknown) {
      if (typeof input !== 'object' || input === null || Array.isArray(input)) {
        throw new AppError(`${JEV_SWITCH_FIELDS} must be sent as a JSON object`, {
          code: 'INVALID_JEV_SWITCH_STATE',
          statusCode: 400,
        });
      }
      const body = input as Record<string, unknown>;
      // Every field is parsed BEFORE any of them is written, so a body naming one switch correctly
      // and another as `"on"` is refused whole rather than half-applied.
      const master = optionalBoolean(body, 'master');
      const scopes: { scope: JevScopeKey; enabled: boolean }[] = [];
      for (const scope of Object.keys(JEV_SCOPES) as JevScopeKey[]) {
        const enabled = optionalBoolean(body, scope);
        if (enabled !== undefined) scopes.push({ scope, enabled });
      }
      if (master === undefined && scopes.length === 0) {
        throw new AppError(`${JEV_SWITCH_FIELDS} must be a boolean`, {
          code: 'INVALID_JEV_SWITCH_STATE',
          statusCode: 400,
        });
      }
      // Every position as it stands, taken before any write: the compensating write below needs the
      // master's previous value, and it must be the value from BEFORE this request, not whatever a
      // failed half left behind.
      const before = await dependencies.jev.read();

      // Only the fields that came in are written. Each switch is a separate file with its own
      // meaning, so a PUT naming one must not be able to move another as a side effect.
      //
      // They are also separate FILES, with no transaction between them, and the order below is the
      // one that can be compensated. A failure on a scope write would leave `{master:true,prompts:false}`
      // half-landed: the master on (so Python reads that scope as live) with its sending still armed
      // from the stored file. Writing a scope FIRST is not the cure — that direction arms it in the
      // window before the master's own write lands, with the master already on from a moment ago.
      //
      // So the master goes first and every file this request moved is put back on failure — the
      // master, then the scopes already written, each read from `before`. That is the one shape that
      // stays all-or-nothing however long the table gets: with N scopes, restoring the master alone
      // would leave an armed scope behind whenever the master was already on.
      //
      // The restore is gated on NOTHING HAVING BEEN WRITTEN, never on `masterWritten` alone. A body
      // naming scopes and no master sets no such flag, and this loop is not one write long any more:
      // the first scope would land, the second would throw, and the guard would rethrow with the
      // first scope armed — and, if the master was already on, LIVE. `written` is the honest test of
      // "nothing was written": it is appended before each write, so it is empty exactly when the
      // request has nothing to put back.
      let masterWritten = false;
      const written: JevScopeKey[] = [];
      try {
        if (master !== undefined) {
          await dependencies.jev.writeMaster(master);
          masterWritten = true;
        }
        for (const { scope, enabled } of scopes) {
          // Recorded BEFORE its write: a scope whose write threw is put back too, which is a no-op
          // if its file never moved. A flag file lands by rename, so it is one or the other.
          written.push(scope);
          await dependencies.jev.writeScope(scope, enabled);
        }
      } catch (error) {
        // Nothing this request touched: rethrow the real error rather than report a restore that had
        // nothing to restore. `masterWritten` is belt to `written`'s braces — the master is in
        // `written`'s world too, and the pair reads as one thought: anything written, put it back.
        if (!masterWritten && written.length === 0) throw error;
        const stranded: string[] = [];
        try {
          await dependencies.jev.writeMaster(before.master);
        } catch (restoreError) {
          console.error('Jev: the master switch could not be restored:', restoreError);
          stranded.push('master');
        }
        for (const scope of written.reverse()) {
          try {
            await dependencies.jev.writeScope(scope, before[scope]);
          } catch (restoreError) {
            console.error(`Jev: the ${scope} switch could not be restored:`, restoreError);
            stranded.push(scope);
          }
        }
        if (stranded.length > 0) {
          // The position is unknown to the caller now, so say which files are unknown rather than
          // letting the original error imply the switches are where they were.
          throw new AppError(
            `The Jev switches could not be updated and ${stranded.join(', ')} could not be put back. Check ~/.claude/state/jev*.flag before relying on them.`,
            { code: 'JEV_SWITCH_WRITE_PARTIAL', statusCode: 500 },
          );
        }
        throw error;
      }
      // Read back rather than echo the request: these are files another process reads at call time,
      // and the answer the panel renders — the live fields included — should be what is on disk now.
      return dependencies.jev.read();
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
