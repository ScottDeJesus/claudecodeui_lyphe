import { userPreferencesDb } from '@/modules/database/index.js';
import { isRecord } from '@/shared/document-fields.js';
import type { VoiceProvider, VoiceSettings } from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';

/** The `user_preferences` key the account's voice settings live under. */
const PREFERENCE_KEY = 'voice';

/**
 * The ten sounds she may make, in the register's order. The register's `{sound_tags}` slot is filled from the account's
 * list and `parseExpression` keeps a sound only when it is on that list: one list, so what she is taught and what survives
 * the filter cannot drift apart. This is the list an account holds until it saves its own, and the one `soundTags: null`
 * restores. Consumed through the voice barrel by the companion's sentence-stream probe (`.verify/companion-wire-contract.mjs`),
 * which proves the parse against the shipped set; the live readers take the account's list from `readVoiceSettings`.
 */
export const DEFAULT_SOUND_TAGS: readonly string[] = [
  'giggle',
  'chuckle',
  'laugh',
  'gasp',
  'sigh',
  'phew',
  'tsk',
  'breath',
  'short pause',
  'long pause',
];

const DEFAULT_GEMINI_SETTINGS = {
  // The house's transcriber role.
  transcriptionModel: 'gemini-3.8-flash',
  speechModel: 'gemini-3.8-flash-tts',
  voice: 'Kore',
};

/** Both models ride the Gemini request, one in the URL's path, so their alphabet is the URL-safe one. */
const MODEL_PATTERN = /^[A-Za-z0-9._-]{1,80}$/;
const MODEL_LIMIT_SENTENCE = '1 to 80 characters of letters, digits, dots, underscores and hyphens';
const VOICE_PATTERN = /^[A-Za-z0-9_-]{1,40}$/;
const VOICE_LIMIT_SENTENCE = '1 to 40 characters of letters, digits, underscores and hyphens';

const MAX_SOUND_TAGS = 30;
const MAX_SOUND_TAG_CHARS = 24;
/** Words of lower-case letters with single spaces between them: the form the parse compares in (it trims, collapses spaces and lower-cases), so a tag stored in it matches exactly what she writes, and a blank tag (an empty `<>` that would pass as a sound) cannot exist. */
const SOUND_TAG_PATTERN = /^[a-z]+(?: [a-z]+)*$/;
const SOUND_TAGS_LIMIT_SENTENCE = `1 to ${MAX_SOUND_TAGS} sound tags, each 1 to ${MAX_SOUND_TAG_CHARS} lower-case letters with single spaces between words`;

/** The four fields a patch's `gemini` object may carry. */
const GEMINI_FIELDS = ['transcriptionModel', 'speechModel', 'voice', 'soundTags'] as const;

/** What is stored: only the fields the account set, so a default the house later changes still reaches an account that never chose. */
type StoredOverrides = {
  provider?: VoiceProvider;
  transcriptionModel?: string;
  speechModel?: string;
  voice?: string;
  soundTags?: string[];
};

/** What a patch's `gemini` object carries after validation; `soundTags: null` is the restore of the default. */
type GeminiPatch = {
  transcriptionModel?: string;
  speechModel?: string;
  voice?: string;
  soundTags?: string[] | null;
};

/** One of the two words the picker offers. */
function isProvider(value: unknown): value is VoiceProvider {
  return value === 'openai' || value === 'gemini';
}

function isModel(value: unknown): value is string {
  return typeof value === 'string' && MODEL_PATTERN.test(value);
}

function isVoiceName(value: unknown): value is string {
  return typeof value === 'string' && VOICE_PATTERN.test(value);
}

/** The tag list, or why it is not one. The same check serves a stored list (which then reads as the default) and a patch (which is refused with the reason). */
function checkSoundTags(value: unknown): { tags: string[] } | { problem: string } {
  const limit = { problem: `gemini.soundTags must be a list of ${SOUND_TAGS_LIMIT_SENTENCE}.` };
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_SOUND_TAGS) return limit;
  const seen = new Set<string>();
  for (const tag of value) {
    if (typeof tag !== 'string' || tag.length > MAX_SOUND_TAG_CHARS || !SOUND_TAG_PATTERN.test(tag)) return limit;
    // A twice-listed tag would be taught twice: the list is a set in the order the register shows it.
    if (seen.has(tag)) return { problem: `gemini.soundTags lists "${tag}" more than once.` };
    seen.add(tag);
  }
  return { tags: [...value] };
}

function settingsInvalid(sentence: string, field: string): AppError {
  return new AppError(sentence, { code: 'VOICE_SETTINGS_INVALID', statusCode: 400, details: { field } });
}

/** The account's stored fields, each one that still passes its limit kept and every other dropped (it then reads as its default). */
function storedOverrides(userId: number): StoredOverrides {
  const stored = userPreferencesDb.getPreferences(userId)[PREFERENCE_KEY];
  if (!isRecord(stored)) return {};

  const overrides: StoredOverrides = {};
  if (isProvider(stored.provider)) overrides.provider = stored.provider;
  if (isRecord(stored.gemini)) {
    const { transcriptionModel, speechModel, voice, soundTags } = stored.gemini;
    if (isModel(transcriptionModel)) overrides.transcriptionModel = transcriptionModel;
    if (isModel(speechModel)) overrides.speechModel = speechModel;
    if (isVoiceName(voice)) overrides.voice = voice;
    const checkedTags = checkSoundTags(soundTags);
    if ('tags' in checkedTags) overrides.soundTags = checkedTags.tags;
  }
  return overrides;
}

function withDefaults(overrides: StoredOverrides): VoiceSettings {
  return {
    provider: overrides.provider ?? 'openai',
    gemini: {
      transcriptionModel: overrides.transcriptionModel ?? DEFAULT_GEMINI_SETTINGS.transcriptionModel,
      speechModel: overrides.speechModel ?? DEFAULT_GEMINI_SETTINGS.speechModel,
      voice: overrides.voice ?? DEFAULT_GEMINI_SETTINGS.voice,
      // A copy either way: a caller that edits its list must not edit the shipped default or the next read.
      soundTags: [...(overrides.soundTags ?? DEFAULT_SOUND_TAGS)],
    },
  };
}

/**
 * The account's voice settings, read fresh from the database on every call (never cached, so a saved change is
 * heard by the next press). A stored field that fails its limit reads as its default.
 * Consumed by `gemini-transcribe.ts` (the transcription model), `gemini-speech.ts` (the speech model and the voice),
 * `voice-provider.ts` (the provider) and the settings routes. Exported through the voice barrel for the companion,
 * which reads `gemini.soundTags` at the start of each turn (the parse) and at each push (the register).
 */
export function readVoiceSettings(userId: number): VoiceSettings {
  return withDefaults(storedOverrides(userId));
}

/** The patch's `provider`, or the 400 that names it. `undefined` means the patch does not carry it. */
function checkedProvider(patch: Record<string, unknown>): VoiceProvider | undefined {
  if (!('provider' in patch)) return undefined;
  if (!isProvider(patch.provider)) throw settingsInvalid('provider must be "openai" or "gemini".', 'provider');
  return patch.provider;
}

/** The patch's `gemini` object with every field it carries checked, or the 400 that names the first field that fails. `undefined` means the patch does not carry `gemini`. */
function checkedGemini(patch: Record<string, unknown>): GeminiPatch | undefined {
  if (!('gemini' in patch)) return undefined;
  const gemini = patch.gemini;
  if (!isRecord(gemini)) throw settingsInvalid(`gemini must be an object holding ${GEMINI_FIELDS.join(', ')}.`, 'gemini');

  for (const field of Object.keys(gemini)) {
    if (!(GEMINI_FIELDS as readonly string[]).includes(field)) {
      throw settingsInvalid(`gemini.${field.slice(0, 40)} is not a voice setting; the fields are ${GEMINI_FIELDS.map((name) => `gemini.${name}`).join(', ')}.`, `gemini.${field.slice(0, 40)}`);
    }
  }

  const checked: GeminiPatch = {};
  for (const field of GEMINI_FIELDS) {
    if (!(field in gemini)) continue;
    const value = gemini[field];
    if (field === 'soundTags') {
      // `null` is the one way to say "go back to Google's set".
      if (value === null) {
        checked.soundTags = null;
        continue;
      }
      const tags = checkSoundTags(value);
      if ('problem' in tags) throw settingsInvalid(tags.problem, 'gemini.soundTags');
      checked.soundTags = tags.tags;
    } else if (field === 'voice') {
      if (!isVoiceName(value)) throw settingsInvalid(`gemini.voice must be ${VOICE_LIMIT_SENTENCE}.`, 'gemini.voice');
      checked.voice = value;
    } else {
      if (!isModel(value)) throw settingsInvalid(`gemini.${field} must be ${MODEL_LIMIT_SENTENCE}.`, `gemini.${field}`);
      checked[field] = value;
    }
  }
  return checked;
}

/** The `voice` document these overrides are stored as: only the fields the account set, the `gemini` object left out when it set none. */
function storedDocument(next: StoredOverrides): Record<string, unknown> {
  const gemini: Record<string, unknown> = {};
  if (next.transcriptionModel) gemini.transcriptionModel = next.transcriptionModel;
  if (next.speechModel) gemini.speechModel = next.speechModel;
  if (next.voice) gemini.voice = next.voice;
  if (next.soundTags) gemini.soundTags = next.soundTags;
  return {
    ...(next.provider ? { provider: next.provider } : {}),
    ...(Object.keys(gemini).length > 0 ? { gemini } : {}),
  };
}

/**
 * Merges a partial patch into the account's voice settings, field by field (the nested `gemini` included), and
 * answers the settings as stored. An invalid field, or a field that is not a setting, throws AppError
 * `VOICE_SETTINGS_INVALID` (400) whose sentence names the field and its limit; nothing is written then.
 * `gemini.soundTags: null` drops the account's own list, so it reads as the shipped `DEFAULT_SOUND_TAGS` again.
 * Consumed by the settings route (`PUT /api/voice/settings`).
 */
export function saveVoiceSettings(userId: number, patch: unknown): VoiceSettings {
  if (!isRecord(patch)) throw settingsInvalid('The settings must be a JSON object.', 'settings');

  for (const field of Object.keys(patch)) {
    if (field !== 'provider' && field !== 'gemini') {
      throw settingsInvalid(`${field.slice(0, 40)} is not a voice setting; the fields are provider and gemini (${GEMINI_FIELDS.join(', ')}).`, field.slice(0, 40));
    }
  }
  const provider = checkedProvider(patch);
  const gemini = checkedGemini(patch);

  // Read and write with no await between them, so two saves cannot both merge from the same stored value.
  const next: StoredOverrides = { ...storedOverrides(userId) };
  if (provider !== undefined) next.provider = provider;
  if (gemini?.transcriptionModel !== undefined) next.transcriptionModel = gemini.transcriptionModel;
  if (gemini?.speechModel !== undefined) next.speechModel = gemini.speechModel;
  if (gemini?.voice !== undefined) next.voice = gemini.voice;
  if (gemini?.soundTags === null) delete next.soundTags;
  else if (gemini?.soundTags !== undefined) next.soundTags = gemini.soundTags;

  userPreferencesDb.savePreferences(userId, { [PREFERENCE_KEY]: storedDocument(next) });
  return readVoiceSettings(userId);
}
