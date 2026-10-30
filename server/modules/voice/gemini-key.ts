import { readFileSync } from 'node:fs';

import { credentialsDb } from '@/modules/database/index.js';
import type { GeminiKeyStatus } from '@/shared/types.js';
import { AppError, pythonStrip } from '@/shared/utils.js';

/** The `credential_type` the account's one Gemini key is stored under in `user_credentials`. */
const CREDENTIAL_TYPE = 'gemini_api_key';
const KEY_VARIABLE = 'GEMINI_API_KEY';
const DEFAULT_HOUSE_ENV_FILE = '/opt/shadow-connector/.env';

const KEY_MIN_LENGTH = 20;
const KEY_MAX_LENGTH = 200;
/** The key rides the `x-goog-api-key` header, so it is printable ASCII: a smart quote or an invisible character pasted into it could never be sent. */
const KEY_PATTERN = new RegExp(`^[\\x21-\\x7e]{${KEY_MIN_LENGTH},${KEY_MAX_LENGTH}}$`);

/** The line boundaries of Python's `str.splitlines()`; written as escapes (a control character in a source file is invisible). */
const PYTHON_LINE_BREAK = new RegExp('\\r\\n|[\\n\\r\\v\\f\\x1c-\\x1e\\x85\\u2028\\u2029]');

/**
 * The `GEMINI_API_KEY=` line of the house's env file, parsed exactly as `~/.claude/scripts/gemini-image`'s
 * `_read_api_key` does: lines split and each one stripped by Python's own sets, an `export ` prefix dropped, the name
 * before the first `=` compared after stripping, the value stripped and stripped of quote marks, and a line whose
 * value is empty skipped. Read at call time (never cached), so a key the operator rotates in the file is the next
 * press's key.
 */
function readKeyFromEnvFile(): string | null {
  const filePath = process.env.GEMINI_ENV_FILE?.trim() || DEFAULT_HOUSE_ENV_FILE;
  let text: string;
  try {
    text = readFileSync(filePath, 'utf8');
  } catch {
    // An absent or unreadable file is "no house key", the same answer gemini-image gives.
    return null;
  }

  for (const rawLine of text.split(PYTHON_LINE_BREAK)) {
    let line = pythonStrip(rawLine);
    if (line.startsWith('export ')) line = pythonStrip(line.slice('export '.length));
    const separatorAt = line.indexOf('=');
    if (separatorAt === -1 || pythonStrip(line.slice(0, separatorAt)) !== KEY_VARIABLE) continue;
    const value = pythonStrip(line.slice(separatorAt + 1)).replace(/^['"]+|['"]+$/g, '');
    if (value) return value;
  }
  return null;
}

/** The house's key: the process environment first, then the env file's line. `null` when neither holds one. */
function readHouseKey(): string | null {
  const fromEnvironment = pythonStrip(process.env[KEY_VARIABLE] ?? '');
  return fromEnvironment || readKeyFromEnvFile();
}

function keyInvalid(): AppError {
  return new AppError(
    `key must be a string of ${KEY_MIN_LENGTH} to ${KEY_MAX_LENGTH} printable ASCII characters with no spaces or line breaks.`,
    { code: 'VOICE_SETTINGS_INVALID', statusCode: 400, details: { field: 'key' } },
  );
}

/**
 * The key the account's Gemini calls use, resolved at call time: the account's stored active credential, else the
 * house's (`GEMINI_API_KEY`, else the env file's line), else `null`. The raw key leaves the module nowhere:
 * `gemini-transcribe.ts` and `gemini-speech.ts` put it in the `x-goog-api-key` header and nothing else.
 * Consumed by `gemini-transcribe.ts` and `gemini-speech.ts`.
 */
export function resolveGeminiKey(userId: number): string | null {
  return credentialsDb.getActiveCredential(userId, CREDENTIAL_TYPE) ?? readHouseKey();
}

/**
 * Where the account's key comes from, and its last four characters when it is the account's own. The house's key
 * is never shown, even in part. Consumed by the settings routes (every answer carries it) and, through the voice barrel, by the
 * companion's `read_settings`, which reads the `source` alone and says "a key of yours", "the house's key" or "no key".
 */
export function geminiKeyStatus(userId: number): GeminiKeyStatus {
  const stored = credentialsDb.getActiveCredential(userId, CREDENTIAL_TYPE);
  if (stored) return { source: 'stored', last4: stored.slice(-4) };
  return { source: readHouseKey() ? 'house' : 'none', last4: null };
}

/** Deletes the account's `gemini_api_key` rows, active or not, except the one id kept, so one key is all that is ever held. */
function deleteStoredKeys(userId: number, keepId: number | null): void {
  for (const row of credentialsDb.getCredentials(userId, CREDENTIAL_TYPE)) {
    if (row.id !== keepId) credentialsDb.deleteCredential(userId, row.id);
  }
}

/**
 * Stores the account's Gemini key (20 to 200 printable ASCII characters, no whitespace), replacing any earlier one,
 * and answers the new status. A key that fails its limit throws AppError `VOICE_SETTINGS_INVALID` (400) naming
 * `key`; the sentence never repeats the key. Consumed by the settings route (`PUT /api/voice/gemini-key`).
 */
export function saveGeminiKey(userId: number, key: string): GeminiKeyStatus {
  if (typeof key !== 'string' || !KEY_PATTERN.test(key)) {
    throw keyInvalid();
  }

  // The new row lands first, so a failed insert leaves the earlier key standing instead of none.
  const created = credentialsDb.createCredential(userId, 'Gemini API key', CREDENTIAL_TYPE, key, 'Voice: Gemini transcription and speech');
  deleteStoredKeys(userId, Number(created.id));
  return geminiKeyStatus(userId);
}

/** Deletes the account's stored key, so its calls fall back to the house's; answers the new status. Consumed by `DELETE /api/voice/gemini-key`. */
export function clearGeminiKey(userId: number): GeminiKeyStatus {
  deleteStoredKeys(userId, null);
  return geminiKeyStatus(userId);
}
