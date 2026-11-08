/**
 * The rules behind chat's McpElicitationPanel: an MCP server asked the person for input, and this reads the
 * schema it sent into form fields, checks an answer by the rules the SERVER will apply, and builds the content
 * that goes back. Pure and DOM-free; the panel owns the state and the words.
 *
 * The server validates an accepted answer against `requestedSchema` with ajv and ajv-formats in full mode, so an
 * answer this lets through can still fail the tool call. Every check here therefore runs on the string that is
 * SENT, not on what was typed: a date-time goes out as a UTC instant, a choice goes out untrimmed.
 *
 * Consumer: chat's McpElicitationPanel.
 */
// The rules file alone: it has no dependencies, unlike the ajv plugin around it.
import { fullFormats } from 'ajv-formats/dist/formats';

import type {
  ElicitationChoice,
  ElicitationField,
  ElicitationFieldValue,
  ElicitationProblem,
  ElicitationRawValues,
  ElicitationRequestInput,
} from '@/shared/types';

const FORMAT_INPUT_TYPES: Record<string, ElicitationField['inputType']> = {
  email: 'email',
  uri: 'url',
  date: 'date',
  'date-time': 'datetime-local',
};

// What a datetime-local input gives (local time, seconds and fraction optional), and the same with an
// explicit offset. Any other shape is not guessed at.
const LOCAL_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/;
const OFFSET_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/i;

/** Reads the flat object schema MCP elicitation allows into form fields, in the server's order. */
export function readElicitationFields(requestedSchema: ElicitationRequestInput['requestedSchema']): ElicitationField[] {
  const properties = asRecord(requestedSchema?.properties);
  const required = new Set(Array.isArray(requestedSchema?.required) ? requestedSchema.required : []);
  return Object.entries(properties).map(([key, raw]) => readField(key, asRecord(raw), required.has(key)));
}

/** The answers a form starts with: every field at its schema default. */
export function initialElicitationValues(fields: ElicitationField[]): ElicitationRawValues {
  return Object.fromEntries(fields.map((field) => [field.key, field.initial]));
}

/**
 * Why a field's answer cannot be sent, or null when it fits the schema. A boolean always answers (unticked is
 * false), so it never has a problem.
 */
export function problemWithAnswer(field: ElicitationField, value: ElicitationRawValues[string] | undefined): ElicitationProblem | null {
  switch (field.kind) {
    case 'boolean':
      return null;
    case 'multi':
      return problemWithPicks(field, Array.isArray(value) ? value : []);
    case 'number':
    case 'integer':
      return problemWithNumber(field, typeof value === 'string' ? value.trim() : '');
    case 'text':
    case 'choice':
      return problemWithText(field, value);
    default:
      return assertNever(field.kind);
  }
}

/** The typed content sent back on accept; optional fields left empty are left out. */
export function buildElicitationContent(fields: ElicitationField[], values: ElicitationRawValues): Record<string, ElicitationFieldValue> {
  const content: Record<string, ElicitationFieldValue> = {};
  for (const field of fields) {
    const value = values[field.key];
    if (field.kind === 'boolean') {
      content[field.key] = value === true;
    } else if (field.kind === 'multi') {
      const picked = Array.isArray(value) ? value : [];
      if (picked.length > 0) content[field.key] = picked;
    } else if (field.kind === 'number' || field.kind === 'integer') {
      const text = typeof value === 'string' ? value.trim() : '';
      if (text) content[field.key] = Number(text);
    } else {
      // The same string the checks ran on.
      const sent = toSentString(field, value);
      if (sent.answered && sent.text !== null) content[field.key] = sent.text;
    }
  }
  return content;
}

/** Only http(s) links get an Open button; anything else (`javascript:` above all) is shown as text. */
export function isOpenableUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const { protocol } = new URL(url);
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled elicitation field kind: ${String(value)}`);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

/**
 * `record[key]` when `key` is one of the record's OWN entries, else undefined. A schema's `format` is the MCP server's
 * text, and a plain lookup would answer `hasOwnProperty` or `valueOf` with the function every object inherits.
 */
function ownEntry<T>(record: Record<string, T>, key: string): T | undefined {
  return Object.prototype.hasOwnProperty.call(record, key) ? record[key] : undefined;
}

/** Choices from `enum` (labelled by `enumNames`) or from `oneOf`/`anyOf` entries of `const` and `title`. */
function readChoices(schema: Record<string, unknown>): ElicitationChoice[] | null {
  if (Array.isArray(schema.enum)) {
    const names = Array.isArray(schema.enumNames) ? schema.enumNames : [];
    return schema.enum.map((value, index) => ({ value: String(value), label: String(names[index] ?? value) }));
  }
  const alternatives = Array.isArray(schema.oneOf) ? schema.oneOf : Array.isArray(schema.anyOf) ? schema.anyOf : null;
  if (alternatives && alternatives.length > 0 && alternatives.every((entry) => 'const' in asRecord(entry))) {
    return alternatives.map((entry) => {
      const record = asRecord(entry);
      return { value: String(record.const), label: String(record.title ?? record.const) };
    });
  }
  return null;
}

function readFieldKind(schema: Record<string, unknown>, choices: ElicitationChoice[] | null, isMulti: boolean): ElicitationField['kind'] {
  if (isMulti) return 'multi';
  if (choices) return 'choice';
  if (schema.type === 'boolean') return 'boolean';
  if (schema.type === 'integer') return 'integer';
  if (schema.type === 'number') return 'number';
  return 'text';
}

function readField(key: string, schema: Record<string, unknown>, required: boolean): ElicitationField {
  const itemChoices = schema.type === 'array' ? readChoices(asRecord(schema.items)) : null;
  const choices = itemChoices ?? readChoices(schema);
  const kind = readFieldKind(schema, choices, itemChoices !== null);
  return {
    key,
    label: typeof schema.title === 'string' && schema.title ? schema.title : key,
    description: typeof schema.description === 'string' ? schema.description : undefined,
    required,
    kind,
    inputType: ownEntry(FORMAT_INPUT_TYPES, String(schema.format)) ?? 'text',
    format: typeof schema.format === 'string' ? schema.format : undefined,
    choices: choices ?? [],
    minLength: asNumber(schema.minLength),
    maxLength: asNumber(schema.maxLength),
    minimum: asNumber(schema.minimum),
    maximum: asNumber(schema.maximum),
    minItems: asNumber(schema.minItems),
    maxItems: asNumber(schema.maxItems),
    initial: readInitial(kind, schema, choices ?? []),
  };
}

function readInitial(kind: ElicitationField['kind'], schema: Record<string, unknown>, choices: ElicitationChoice[]): ElicitationField['initial'] {
  const fallback = schema.default;
  if (kind === 'multi') {
    // Only what a box can show as ticked, so nothing is sent that was not on screen.
    const defaults = Array.isArray(fallback) ? fallback.map(String) : [];
    return choices.map((choice) => choice.value).filter((value) => defaults.includes(value));
  }
  if (kind === 'boolean') return fallback === true;
  if (kind === 'choice') {
    // A single choice is held as its position in `choices`, so that '' can mean "nothing chosen" even when
    // an enum value is itself empty or blank.
    const position = fallback !== undefined ? choices.findIndex((choice) => choice.value === String(fallback)) : -1;
    return position >= 0 ? String(position) : '';
  }
  return toInitialText(schema.format, fallback);
}

/** An instant as a datetime-local input shows it: local wall time, seconds only when it has them. */
function toPickerValue(instant: Date): string {
  const pad = (value: number, width = 2) => String(value).padStart(width, '0');
  const minutes = `${pad(instant.getFullYear(), 4)}-${pad(instant.getMonth() + 1)}-${pad(instant.getDate())}T${pad(instant.getHours())}:${pad(instant.getMinutes())}`;
  const milliseconds = instant.getMilliseconds();
  if (!instant.getSeconds() && !milliseconds) return minutes;
  return `${minutes}:${pad(instant.getSeconds())}${milliseconds ? `.${pad(milliseconds, 3)}` : ''}`;
}

/**
 * A schema default as its input can show it. Date inputs blank any value not in their own shape, while the
 * state behind them keeps it, which would submit a value nobody saw. So a date-time default becomes local wall
 * time, and a default these inputs cannot show starts the field empty.
 */
function toInitialText(format: unknown, fallback: unknown): string {
  if (fallback === undefined || fallback === null) return '';
  const text = String(fallback);
  if (format === 'date') return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '';
  if (format !== 'date-time') return text;
  if (!LOCAL_DATE_TIME.test(text) && !OFFSET_DATE_TIME.test(text)) return '';
  const instant = new Date(text);
  return Number.isNaN(instant.getTime()) ? '' : toPickerValue(instant);
}

/**
 * The text a field sends. A `datetime-local` input gives local time without seconds or offset, which RFC 3339
 * `date-time` rejects, so a `date-time` answer goes out as an ISO 8601 instant in UTC. Null when it is not a
 * date, or names a local time that does not exist.
 */
function toSubmittedText(field: ElicitationField, text: string): string | null {
  if (field.format !== 'date-time') return text;
  const local = LOCAL_DATE_TIME.exec(text);
  if (!local && !OFFSET_DATE_TIME.test(text)) return null;
  const instant = new Date(text);
  if (Number.isNaN(instant.getTime())) return null;
  // A local time a DST change skipped (02:30 on a spring-forward night) parses to an hour later; refuse it
  // rather than send a time nobody picked. Offsets are whole seconds but not always whole minutes (historical
  // zones had gaps of under a minute), so the wall time is compared to the second.
  if (local) {
    const [year, month, day, hours, minutes] = local.slice(1, 6).map(Number);
    const seconds = Number(local[6] ?? '0');
    const sameWallTime = instant.getFullYear() === year
      && instant.getMonth() + 1 === month
      && instant.getDate() === day
      && instant.getHours() === hours
      && instant.getMinutes() === minutes
      && instant.getSeconds() === seconds;
    if (!sameWallTime) return null;
  }
  return instant.toISOString();
}

/**
 * Whether a value meets its `format` by the rules the MCP SDK validates an answer with on the server
 * (ajv-formats, full mode), so the panel does not send what the server would reject. A format those rules lack
 * is not checked.
 */
function matchesFormat(format: string, value: string): boolean {
  const rule: unknown = ownEntry(fullFormats as Record<string, unknown>, format);
  const check = rule && typeof rule === 'object' && !(rule instanceof RegExp) && 'validate' in rule
    ? (rule as { validate: unknown }).validate
    : rule;
  if (check instanceof RegExp) return check.test(value);
  if (typeof check === 'function') return Boolean((check as (candidate: string) => unknown)(value));
  return true;
}

/**
 * The string a choice or text field would send, so every check runs on what the server will validate rather
 * than on what was typed. `answered: false` is an empty field; `text: null` is a date-time that does not parse.
 */
function toSentString(
  field: ElicitationField,
  value: ElicitationRawValues[string] | undefined,
): { answered: false } | { answered: true; text: string | null } {
  if (field.kind === 'choice') {
    // Held as a position: '' is "nothing chosen", and the enum value itself goes out untrimmed, because an
    // empty or blank value is a real choice.
    const choice = typeof value === 'string' && value !== '' ? field.choices[Number(value)] : undefined;
    return choice ? { answered: true, text: choice.value } : { answered: false };
  }
  const typed = typeof value === 'string' ? value.trim() : '';
  return typed ? { answered: true, text: toSubmittedText(field, typed) } : { answered: false };
}

function problemWithPicks(field: ElicitationField, picked: string[]): ElicitationProblem | null {
  if (field.required && picked.length === 0) return { code: 'required' };
  if (field.minItems !== undefined && picked.length > 0 && picked.length < field.minItems) {
    return { code: 'tooFew', count: field.minItems };
  }
  if (field.maxItems !== undefined && picked.length > field.maxItems) {
    return { code: 'tooMany', count: field.maxItems };
  }
  return null;
}

function problemWithNumber(field: ElicitationField, text: string): ElicitationProblem | null {
  if (!text) return field.required ? { code: 'required' } : null;
  const number = Number(text);
  if (!Number.isFinite(number)) return { code: 'notANumber' };
  if (field.kind === 'integer' && !Number.isInteger(number)) return { code: 'notAnInteger' };
  if (field.minimum !== undefined && number < field.minimum) return { code: 'tooSmall', value: field.minimum };
  if (field.maximum !== undefined && number > field.maximum) return { code: 'tooLarge', value: field.maximum };
  return null;
}

/** Choice and text fields: every limit applies to the string that is sent, which for a date-time is the UTC instant, not what the picker shows. */
function problemWithText(field: ElicitationField, value: ElicitationRawValues[string] | undefined): ElicitationProblem | null {
  const sent = toSentString(field, value);
  if (!sent.answered) return field.required ? { code: 'required' } : null;
  if (sent.text === null) return { code: 'badFormat', format: field.format };
  // JSON Schema counts characters as code points, so an emoji is one, not two.
  const length = [...sent.text].length;
  if (field.minLength !== undefined && length < field.minLength) return { code: 'tooShort', count: field.minLength };
  if (field.maxLength !== undefined && length > field.maxLength) return { code: 'tooLong', count: field.maxLength };
  if (field.format && !matchesFormat(field.format, sent.text)) return { code: 'badFormat', format: field.format };
  return null;
}
