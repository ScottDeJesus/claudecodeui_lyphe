/** Characters no sayable name holds: path and markup marks, a slash command's slash, markdown's emphasis, code and heading marks. */
const UNSAYABLE_CHARACTERS = /[/#\\<>{}[\]|*_~`"]/;

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MOST_WORDS = 5;
const MOST_CHARACTERS = 40;

/** Scripts whose words are not set apart by a space: for these a whitespace-separated token is a phrase, not a word. */
const SCRIPTS_WITHOUT_SPACES = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u;
const WORD_SEGMENTER = new Intl.Segmenter(undefined, { granularity: 'word' });

/** Whether any of the name's letters is in a script whose words a space does not set apart (Han, Kana, Thai, Lao, Khmer, Myanmar). */
export function hasScriptWithoutSpaces(name: string): boolean {
  return SCRIPTS_WITHOUT_SPACES.test(name);
}

/**
 * How many words a name holds, the way its language writes them: a token between spaces is one word, except a token in a script
 * without spaces, which the runtime's word segmenter (ICU's dictionaries) divides. So "Kanban board" is 2, "Login-fix" is 1 (a hyphenated
 * word stays one), "看板ボード" is 2 and "見積書の下書き" is 4. The dictionary divides finer than a person hears: it splits "カンバン" into two and
 * "数据库" into two (`haiku-name.ts` allows one word more for it). Consumed by `cleanedName` for the naming pass's word rule; `isSayableName`
 * below still reads a current name by its whitespace tokens.
 */
export function countWords(name: string): number {
  let words = 0;
  for (const token of name.split(/\s+/)) {
    if (token === '') continue;
    if (!SCRIPTS_WITHOUT_SPACES.test(token)) {
      words += 1;
      continue;
    }
    for (const part of WORD_SEGMENTER.segment(token)) if (part.isWordLike) words += 1;
  }
  return words;
}

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
