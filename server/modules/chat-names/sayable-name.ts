/** Characters no sayable name holds: path and markup marks, a slash command's slash, markdown's emphasis, code and heading marks. */
const UNSAYABLE_CHARACTERS = /[/#\\<>{}[\]|*_~`"]/;

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MOST_WORDS = 5;
const MOST_CHARACTERS = 40;

/**
 * Whether a person could say this chat's name aloud. Consumed by the namer, for the chat's current name and for Haiku's answer.
 *
 * WHY. Measured on the live table (2026-10-26): the names he gave his chats ("Live mode", "Bugfixes", "PM flow", "Fix every broken
 * sign-in") pass, and the ones nobody could say are slash commands and placeholders ("/git", "/upload STEVEN KENDALL", "Untitled
 * Session"). A new chat is named with its first message's first four words (`buildCloudCliSessionName`), so a plain opening such as
 * "Help me plan a" passes the rule as well — the rule asks whether the name can be spoken, not whether it says anything.
 *
 * True when, after `trim()`, all of these hold: 1 to 5 words (split on whitespace); at most 40 characters; the first character is a
 * letter or a digit; none of the characters / # \ < > { } [ ] | * _ ~, a backtick or a double quote; not matching `/^untitled\b/i`;
 * not shaped like a UUID. A missing name is not sayable.
 */
export function isSayableName(name: string | null | undefined): boolean {
  const trimmed = (name ?? '').trim();
  if (trimmed === '') return false;
  if (trimmed.split(/\s+/).length > MOST_WORDS) return false;
  if (trimmed.length > MOST_CHARACTERS) return false;
  if (!/^[\p{L}\p{N}]/u.test(trimmed)) return false;
  if (UNSAYABLE_CHARACTERS.test(trimmed)) return false;
  if (/^untitled\b/i.test(trimmed)) return false;
  return !UUID_SHAPE.test(trimmed);
}
