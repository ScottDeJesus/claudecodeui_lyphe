/**
 * How free text from the store reaches the diagnosing agent: masked, on one line, cut to size.
 *
 * Two doors lead stored text to the model — the system prompt (a check's value, its stored results, a
 * fix's command) and `history_read` (results, runs, diagnoses) — and the warden's three reads are a
 * third. The model can quote anything it is shown into `evidence` or a `proposal`, which are stored
 * for ever and drawn on the sheet, so every door masks the same way: `password=hunter2` reaches it as
 * `password=<masked>` whichever door the words came through. The warden masks what IT reads with
 * `maskSecrets` in `warden/src/diag-guard.mjs`; that file runs on a node and cannot be imported here, so
 * `maskCredentials` repeats its five patterns, and the two are edited together.
 *
 * Consumers: `diagnosis-prompt.ts` and `diagnosis-history.ts`, through `oneMaskedLine`.
 */

const MASKED = '<masked>';
/** The warden's `KEY_WORD_VALUE` (`warden/src/diag-guard.mjs`), word for word: the two are edited together. */
const KEY_WORD_VALUE =
  /((?:password|passwd|passphrase|secret|api[_-]?key|access[_-]?key|private[_-]?key)s?|token|(?<![A-Za-z])(?:pass|pwd)(?![A-Za-z])|(?<=["'])key(?=["']\s*:))((?:(?:[_.-]|key|id|value|access)[A-Za-z0-9_.-]{0,40})?["']?\s*[=:]\s*)(?:<masked>|"[^"\n]*"|'[^'\n]*'|\S+)/gi;

/**
 * Masks what looks like a credential: a private-key block; `password`, `passwd`, `passphrase`, `secret`, `token`,
 * `api` / `access` / `private` key, `pass` and `pwd` as whole words, and a quoted `"key"`, each followed by `=` or `:`
 * (any case; a name that carries the word counts, `DB_PASS`, `secretKey` and `AWS_SECRET_ACCESS_KEY` included, and the
 * credential words take a plural, while `passed` and `max_tokens` stay; the value a `<masked>` already, a quoted text or the
 * next run of non-space characters, a JSON key's closing quote kept, so masking twice changes nothing); a URL's password
 * (`scheme://user:<masked>@host`, a lone userinfo of 20 or more characters going whole); a `Bearer` or
 * `Basic` value of 16 or more characters; and a JWT.
 */
function maskCredentials(text: string): string {
  return text
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g, MASKED)
    .replace(KEY_WORD_VALUE, `$1$2${MASKED}`)
    .replace(/(\b[a-z][a-z0-9+.-]{0,15}:\/\/)([^\s/@]{1,512})@/gi, (whole, scheme: string, userinfo: string) => {
      const colon = userinfo.indexOf(':');
      if (colon >= 0) return `${scheme}${userinfo.slice(0, colon)}:${MASKED}@`;
      return userinfo.length >= 20 ? `${scheme}${MASKED}@` : whole;
    })
    .replace(/\b(Bearer|Basic)(\s+)[A-Za-z0-9._~+/=-]{16,}/gi, `$1$2${MASKED}`)
    .replace(/\beyJ[A-Za-z0-9_-]{8,512}\.[A-Za-z0-9_-]{4,8192}\.[A-Za-z0-9_-]{0,512}/g, MASKED);
}

/**
 * One piece of stored text made fit for one line of a prompt or a history answer: credential-looking
 * values masked FIRST (so the cut can never leave half a secret behind), then folded onto one line and
 * cut at `limit` characters. `—` for a null, an empty or a blank text.
 */
export function oneMaskedLine(text: string | null, limit: number): string {
  if (text === null || text === '') return '—';
  const folded = maskCredentials(text).replace(/\s+/g, ' ').trim();
  if (folded === '') return '—';
  return folded.length > limit ? `${folded.slice(0, limit)}…` : folded;
}
