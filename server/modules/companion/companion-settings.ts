import { userDb, userPreferencesDb } from '@/modules/database/index.js';
import type { CompanionModel, CompanionSettings, TalkBinding } from '@/shared/companion-types.js';
import { isFlag, isRecord, isText } from '@/shared/document-fields.js';

import { inputInvalid } from './companion-input.js';
import { COMPANION_REGISTER_DEFAULT, DEFAULT_DELIVERY_NOTE } from './session/companion-prompt.js';

/**
 * Her settings: the `companion` key of the account's `user_preferences`, read with every default
 * applied and written only through `saveCompanionSettings` — the one place that knows the shape and
 * the limits (interface 1 of the plan), so a page never has to.
 *
 * WHAT IS STORED is the account's OVERRIDES, never the resolved settings. A field the operator has
 * not set is absent, so its default stays live: `operatorName` follows `users.git_name`, and the
 * register follows the product's text instead of freezing the copy a page once echoed back. A field
 * whose stored value no longer passes its limit (the generic `PATCH /api/user/preferences` can write
 * any key, this module's route is not the only way in) reads as unset, and the next save drops it.
 *
 * READ FRESH, NEVER CACHED. The register is re-read at every push (ruling 4), so a save is the
 * next message's voice with nothing to invalidate. A read is one preferences query, and one or two
 * more only while `operatorName` is unset.
 *
 * Both functions are synchronous end to end, so two saves cannot interleave their read and write.
 * Neither touches a socket: telling the account's pages (`companion_settings`) is the caller's act,
 * through the store.
 *
 * Consumers: `companion-account.ts` (the session's read at every push, which is how the conversation gets the
 * register fresh for each message), `companion-picture.ts` (the picture), `companion.service.ts` (the save behind
 * `PUT /api/companion/settings` and the `live` gate of focus news) and `feeds/alert-feed.ts` (the `live` gate of alerts).
 */

/** The preference key her settings live under. */
const PREFERENCE_KEY = 'companion';

const DEFAULT_NAME = 'Kaylee';
const DEFAULT_MODEL: CompanionModel = 'sonnet';
/** What she calls him when the account has neither a usable git name nor a usable username. */
const LAST_RESORT_OPERATOR_NAME = 'Operator';

/**
 * The three models she can run on, in the order the picker lists them. Consumed by `companion-picture.ts`, which
 * labels each from the installed CLI's catalog, and by the model check below.
 */
export const COMPANION_MODELS: readonly CompanionModel[] = ['sonnet', 'opus', 'haiku'];

type TextField = 'name' | 'operatorName' | 'register' | 'deliveryNote' | 'talkBinding.label';
type TextLimits = { min: number; max: number; singleLine: boolean };

/** Interface 1's limits, in characters (code points, so one emoji is one). */
const TEXT_LIMITS: Record<TextField, TextLimits> = {
  name: { min: 1, max: 40, singleLine: true },
  operatorName: { min: 1, max: 40, singleLine: true },
  register: { min: 200, max: 16_000, singleLine: false },
  deliveryNote: { min: 0, max: 120, singleLine: true },
  'talkBinding.label': { min: 1, max: 40, singleLine: true },
};

/** Every break a Unicode-aware reader draws a new line at, not only `\n`: any of them splits a one-line slot. */
const LINE_BREAK = /[\n\r\v\f\u0085\u2028\u2029]/;
const SURROGATE_PAIR = /[\uD800-\uDBFF][\uDC00-\uDFFF]/g;

/**
 * What a save may carry: any of her settings, for the register `null`, which restores the
 * default template, and for the talk binding `null`, which unbinds it. Consumed by `companion.service.ts` and
 * `companion.routes.ts`, which build one from a request body or from a live toggle and model change.
 */
export type CompanionSettingsPatch = Partial<Omit<CompanionSettings, 'register'>> & { register?: string | null };

type Checked<T> = { ok: true; value: T } | { ok: false; sentence: string };

/** The overrides an account has set: a setting that is absent here reads as its default. */
type Overrides = Partial<CompanionSettings>;

function refuse(sentence: string): { ok: false; sentence: string } {
  return { ok: false, sentence };
}

/** Characters as a person counts them: UTF-16 units less one for each surrogate pair, with no array of the text built. */
function characterCount(text: string): number {
  return text.length - (text.match(SURROGATE_PAIR)?.length ?? 0);
}

/**
 * One text setting checked against its limits. Surrounding whitespace is dropped first, so `"   "`
 * is a name of no characters rather than a name of three, and what comes back is what is stored.
 */
function checkText(field: TextField, value: unknown): Checked<string> {
  const { min, max, singleLine } = TEXT_LIMITS[field];
  const limit = `${field} must be ${min}-${max} characters${singleLine ? ' with no line break' : ''}`;

  if (!isText(value)) return refuse(`${limit} (it is not text).`);
  const text = value.trim();
  if (singleLine && LINE_BREAK.test(text)) return refuse(`${limit} (it has a line break).`);

  const length = characterCount(text);
  if (length < min || length > max) return refuse(`${limit} (it has ${length}).`);
  return { ok: true, value: text };
}

function checkModel(value: unknown): Checked<CompanionModel> {
  const model = COMPANION_MODELS.find((candidate) => candidate === value);
  return model ? { ok: true, value: model } : refuse(`model must be one of ${COMPANION_MODELS.join(', ')}.`);
}

function checkLive(value: unknown): Checked<boolean> {
  return isFlag(value) ? { ok: true, value } : refuse('live must be true or false.');
}

/** A function key's `KeyboardEvent.code`: `F1` to `F24`, nothing wider (`F0`, `F25` and `F08` are not keys). */
const FUNCTION_KEY_CODE = /^F(?:[1-9]|1\d|2[0-4])$/;
/** What a `KeyboardEvent.code` is made of (`KeyK`, `Digit1`, `Space`, `NumpadAdd`, `F8`). */
const KEY_CODE_SHAPE = /^[A-Za-z0-9]{1,40}$/;
/** The mouse's middle, back and forward buttons by `MouseEvent.button`: not the left (0, every click) and not the right (2, the menu). */
const TALK_MOUSE_BUTTONS = [1, 3, 4] as const;

/**
 * The talk binding, or `null` for none. The rule mirrors the page's `talkBindingFromEvent`
 * (`src/modules/companion/utils/talkBinding.ts`) for what may be bound, and the two are edited together: a
 * `key` binding is a function key or carries Ctrl, Alt or Meta (a plain typing key would fire on every word
 * he types), a `mouse` binding is button 1, 3 or 4. What comes back is rebuilt field by field, so a stray key
 * on the object is not stored. Every sentence names `talkBinding`, which is all the settings field shows.
 */
function checkTalkBinding(value: unknown): Checked<TalkBinding | null> {
  if (value === null) return { ok: true, value: null };
  if (!isRecord(value)) return refuse('talkBinding must be null or an object with a kind of key or mouse.');

  const label = checkText('talkBinding.label', value.label);
  if (!label.ok) return label;

  if (value.kind === 'mouse') {
    const button = TALK_MOUSE_BUTTONS.find((candidate) => candidate === value.button);
    if (button === undefined) return refuse('talkBinding.button must be 1 (middle), 3 (back) or 4 (forward).');
    return { ok: true, value: { kind: 'mouse', button, label: label.value } };
  }
  if (value.kind !== 'key') return refuse('talkBinding.kind must be key or mouse.');

  const { code, ctrl, alt, shift, meta } = value;
  if (!isText(code) || !KEY_CODE_SHAPE.test(code)) {
    return refuse('talkBinding.code must be 1-40 characters of letters and digits (it is a KeyboardEvent.code, as KeyK).');
  }
  if (!isFlag(ctrl) || !isFlag(alt) || !isFlag(shift) || !isFlag(meta)) {
    return refuse('talkBinding.ctrl, alt, shift and meta must each be true or false.');
  }
  if (!FUNCTION_KEY_CODE.test(code) && !ctrl && !alt && !meta) {
    return refuse('talkBinding must be a function key (F1-F24) or hold Ctrl, Alt or Meta with the key: a key on its own fires while you type.');
  }
  return { ok: true, value: { kind: 'key', code, ctrl, alt, shift, meta, label: label.value } };
}

/** One checker per setting, typed by the setting it answers: a field added to the contract does not compile until it has one. */
const FIELD_CHECKS: { [Field in keyof CompanionSettings]: (value: unknown) => Checked<CompanionSettings[Field]> } = {
  name: (value) => checkText('name', value),
  operatorName: (value) => checkText('operatorName', value),
  register: (value) => checkText('register', value),
  deliveryNote: (value) => checkText('deliveryNote', value),
  model: checkModel,
  live: checkLive,
  talkBinding: checkTalkBinding,
};

const SETTING_FIELDS = Object.keys(FIELD_CHECKS) as Array<keyof CompanionSettings>;

/** The account's stored overrides, each field that still passes its limit kept and every other dropped. */
function storedOverrides(userId: number): Overrides {
  const stored = userPreferencesDb.getPreferences(userId)[PREFERENCE_KEY];
  const overrides: Overrides = {};
  if (!isRecord(stored)) return overrides;

  for (const field of SETTING_FIELDS) {
    const checked = FIELD_CHECKS[field](stored[field]);
    if (checked.ok) Object.assign(overrides, { [field]: checked.value });
  }
  return overrides;
}

/**
 * The first word of a git name: up to its first whitespace, or for a name written as one run
 * ("ScottDeJesus") up to the first place a lower-case letter is followed by an upper-case one.
 */
function firstWordOf(fullName: string): string {
  const trimmed = fullName.trim();
  const beforeSpace = trimmed.split(/\s+/)[0];
  if (beforeSpace !== trimmed) return beforeSpace;

  const boundary = trimmed.search(/(?<=\p{Ll})(?=\p{Lu})/u);
  return boundary > 0 ? trimmed.slice(0, boundary) : trimmed;
}

/** What she calls him when he has not said: the git name's first word, else the username capitalized, else a last resort. */
function defaultOperatorName(userId: number): string {
  const fromGitName = checkText('operatorName', firstWordOf(userDb.getGitConfig(userId)?.git_name ?? ''));
  if (fromGitName.ok) return fromGitName.value;

  const [initial = '', ...rest] = userDb.getUserById(userId)?.username ?? '';
  const fromUsername = checkText('operatorName', initial.toUpperCase() + rest.join(''));
  return fromUsername.ok ? fromUsername.value : LAST_RESORT_OPERATOR_NAME;
}

/**
 * The account's settings with every default applied: name `Kaylee`, `operatorName` from the git
 * name, the register and delivery note of `companion-prompt.ts`, model `sonnet`, live off, no talk
 * binding. A stored value that fails its limit reads as its default. Always read from the preference, never cached.
 * Consumed by `companion.service.ts`, at every push and for the picture.
 */
export function readCompanionSettings(userId: number): CompanionSettings {
  const overrides = storedOverrides(userId);

  return {
    name: overrides.name ?? DEFAULT_NAME,
    operatorName: overrides.operatorName ?? defaultOperatorName(userId),
    register: overrides.register ?? COMPANION_REGISTER_DEFAULT,
    deliveryNote: overrides.deliveryNote ?? DEFAULT_DELIVERY_NOTE,
    model: overrides.model ?? DEFAULT_MODEL,
    live: overrides.live ?? false,
    talkBinding: overrides.talkBinding ?? null,
  };
}

/**
 * Validates `patch` against interface 1's limits and stores it, answering the settings as they now
 * read. Nothing is written unless every field passes: the first one that fails throws a 400
 * `COMPANION_INPUT_INVALID` whose sentence names the field and its limit. `register: null`
 * restores the default template and `talkBinding: null` unbinds the talk button (each drops its override);
 * a field set to `undefined` is left as it was; a key that is not
 * a setting is refused rather than ignored, so a misspelt `deliverynote` does not look saved.
 *
 * `patch` is typed for callers inside the module, and checked as untyped input all the same: the
 * route hands over a request body. Consumed by `companion.service.ts`, behind `PUT /api/companion/settings`.
 */
export function saveCompanionSettings(userId: number, patch: CompanionSettingsPatch): CompanionSettings {
  if (!isRecord(patch)) throw inputInvalid('The settings body must be an object.');

  const next = storedOverrides(userId);
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;

    const field = SETTING_FIELDS.find((candidate) => candidate === key);
    if (!field) {
      // The key is the caller's text, echoed back: held to a sentence's length so a pasted blob is not.
      throw inputInvalid(`${key.slice(0, 40)} is not a setting; the settings are ${SETTING_FIELDS.join(', ')}.`, key.slice(0, 40));
    }

    if ((field === 'register' || field === 'talkBinding') && value === null) {
      delete next[field];
      continue;
    }
    const checked = FIELD_CHECKS[field](value);
    if (!checked.ok) throw inputInvalid(checked.sentence, field);
    Object.assign(next, { [field]: checked.value });
  }

  // A register that equals the default is not an override: a page that echoes the whole settings
  // object back must not freeze today's text against every later edit of the default.
  if (next.register === COMPANION_REGISTER_DEFAULT.trim()) delete next.register;

  // `undefined` deletes the preference row (savePreferences' contract), so an account back at all
  // defaults keeps nothing.
  userPreferencesDb.savePreferences(userId, { [PREFERENCE_KEY]: Object.keys(next).length > 0 ? next : undefined });
  return readCompanionSettings(userId);
}
