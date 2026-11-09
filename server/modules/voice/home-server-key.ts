import { credentialsDb } from '@/modules/database/index.js';
import type { HomeServerKeyStatus } from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';

/** The `credential_type` the account's one home server key is stored under in `user_credentials`. */
const CREDENTIAL_TYPE = 'home_server_key';

const KEY_MIN_LENGTH = 8;
const KEY_MAX_LENGTH = 200;
/** The key rides the `Authorization: Bearer` header, so it is printable ASCII: a smart quote or an invisible character pasted into it could never be sent. */
const KEY_PATTERN = new RegExp(`^[\\x21-\\x7e]{${KEY_MIN_LENGTH},${KEY_MAX_LENGTH}}$`);

function keyInvalid(): AppError {
  return new AppError(
    `The home server key must be ${KEY_MIN_LENGTH} to ${KEY_MAX_LENGTH} printable ASCII characters with no spaces or line breaks.`,
    { code: 'VOICE_SETTINGS_INVALID', statusCode: 400, details: { field: 'homeServer.key' } },
  );
}

/**
 * The key the account's home server calls use, resolved at call time: the account's stored active credential, else
 * `null`. There is no house fallback: the home server is the account's own box, and a key that is not the account's is
 * not one the box would know. The raw key leaves the module nowhere but the bearer header `voice.service.ts` sends.
 * Consumed by `speech-transcriber.ts`, which pairs it with the account's address.
 */
export function resolveHomeServerKey(userId: number): string | null {
  return credentialsDb.getActiveCredential(userId, CREDENTIAL_TYPE);
}

/**
 * Whether the account has a home server key, and its last four characters when it does. Consumed by the settings routes
 * (every answer carries it) and, through the voice barrel, by the companion's `read_settings`, which reads the `source`
 * alone to say whether the home server is set up.
 */
export function homeServerKeyStatus(userId: number): HomeServerKeyStatus {
  const stored = resolveHomeServerKey(userId);
  return stored ? { source: 'stored', last4: stored.slice(-4) } : { source: 'none', last4: null };
}

/** Deletes the account's `home_server_key` rows, active or not, except the one id kept, so one key is all that is ever held. */
function deleteStoredKeys(userId: number, keepId: number | null): void {
  for (const row of credentialsDb.getCredentials(userId, CREDENTIAL_TYPE)) {
    if (row.id !== keepId) credentialsDb.deleteCredential(userId, row.id);
  }
}

/**
 * Stores the account's home server key (8 to 200 printable ASCII characters, no whitespace), replacing any earlier one,
 * and answers the new status. A key that fails its limit throws AppError `VOICE_SETTINGS_INVALID` (400) naming
 * `homeServer.key`; the sentence never repeats the key. Consumed by the settings route (`PUT /api/voice/home-server-key`).
 */
export function saveHomeServerKey(userId: number, key: string): HomeServerKeyStatus {
  if (typeof key !== 'string' || !KEY_PATTERN.test(key)) {
    throw keyInvalid();
  }

  // The new row lands first, so a failed insert leaves the earlier key standing instead of none.
  const created = credentialsDb.createCredential(userId, 'Home server key', CREDENTIAL_TYPE, key, 'Voice: the home server that transcribes');
  deleteStoredKeys(userId, Number(created.id));
  return homeServerKeyStatus(userId);
}

/** Deletes the account's stored key, which turns the home server off (Gemini then transcribes alone); answers the new status. Consumed by `DELETE /api/voice/home-server-key`. */
export function clearHomeServerKey(userId: number): HomeServerKeyStatus {
  deleteStoredKeys(userId, null);
  return homeServerKeyStatus(userId);
}
