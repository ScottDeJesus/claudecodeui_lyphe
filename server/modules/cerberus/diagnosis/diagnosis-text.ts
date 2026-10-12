import type { CerberusDiagnosisSubmission } from '@/shared/cerberus-types.js';

/**
 * How free text moves between the store and the diagnosing agent: masked, on one line, cut to size.
 *
 * Two doors lead stored text to the model — the system prompt (a check's value, its stored results, a
 * fix's command) and `history_read` (results, runs, diagnoses) — and the warden's three reads are a
 * third. The model can quote anything it is shown into `evidence` or a `proposal`, which are stored
 * for ever and drawn on the sheet, so every door masks the same way: `password=hunter2` reaches it as
 * `password=<masked>` whichever door the words came through. The warden masks what IT reads with
 * `maskSecrets` in `warden/src/diag-guard.mjs`; that file runs on a node and cannot be imported here, so
 * `maskCredentials` repeats its six patterns, and the two are edited together.
 *
 * THE WAY OUT IS MASKED TOO. Every input the model sees is masked, but a model can reassemble a credential
 * from pieces or invent one, and what it writes is kept for ever and drawn. So a finding (`note`) goes through
 * `oneMaskedLine`, the words of a conclusion (`maskedConclusion`) are masked as they are stored, and a proposed
 * command that the mask would change (`carriesCredential`) is refused to the agent whole: masking would break the
 * command and leaving it would keep a secret, so it is neither altered nor kept.
 *
 * Consumers: `diagnosis-prompt.ts`, `diagnosis-history.ts`, `diagnosis-measurement.ts` and `diagnosis-step-words.ts`,
 * through `oneMaskedLine`; `diagnosis-deps.ts` (a note, and `carriesCredential` for a proposal); and
 * `diagnosis.service.ts`, which stores every conclusion through `maskedConclusion`.
 */

const MASKED = '<masked>';
/** The warden's `KEY_WORD_VALUE` (`warden/src/diag-guard.mjs`), word for word: the two are edited together. */
const KEY_WORD_VALUE =
  /((?:password|passwd|passphrase|secret|api[_-]?key|access[_-]?key|private[_-]?key)s?|token|(?<![A-Za-z])(?:pass|pwd)(?![A-Za-z])|(?<=["'])key(?=["']\s*:))((?:(?:[_.-]|key|id|value|access)[A-Za-z0-9_.-]{0,40})?["']?\s*[=:]\s*)(?:<masked>|"[^"\n]*"|'[^'\n]*'|\S+)/gi;

/**
 * Masks what looks like a credential: a private-key block (an armored PGP `… PRIVATE KEY BLOCK-----` included; and, when the
 * text begins inside one, everything from its start through the last `-----END … PRIVATE KEY-----` line that has no BEGIN
 * before it); `password`, `passwd`, `passphrase`, `secret`, `token`,
 * `api` / `access` / `private` key, `pass` and `pwd` as whole words, and a quoted `"key"`, each followed by `=` or `:`
 * (any case; a name that carries the word counts, `DB_PASS`, `secretKey` and `AWS_SECRET_ACCESS_KEY` included, and the
 * credential words take a plural, while `passed` and `max_tokens` stay; the value a `<masked>` already, a quoted text or the
 * next run of non-space characters, a JSON key's closing quote kept, so masking twice changes nothing); a URL's password
 * (`scheme://user:<masked>@host`, a lone userinfo of 20 or more characters going whole); a `Bearer` or
 * `Basic` value of 16 or more characters; and a JWT.
 */
function maskCredentials(text: string): string {
  return text
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY(?: BLOCK)?-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY(?: BLOCK)?-----|$)/g, MASKED)
    // Every complete block is `<masked>` by now, so an END line still here has no BEGIN before it; anchored, so one scan, and
    // greedy, through the LAST such line, so one pass leaves nothing for a second to mask.
    .replace(/^[\s\S]*-----END [A-Z ]*PRIVATE KEY(?: BLOCK)?-----/, MASKED)
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

/**
 * Whether masking would change `text` — it holds something that looks like a credential. Used on a proposed command, which
 * cannot be masked (the masked command would not run) and so is refused instead.
 */
export function carriesCredential(text: string): boolean {
  return maskCredentials(text) !== text;
}

/**
 * The conclusion as it is stored and drawn: the summary, each evidence line and the fix button's name masked. The proposal's
 * `cmd` and `general` are left as they came, because `carriesCredential` already refused any the mask would change.
 */
export function maskedConclusion(submission: CerberusDiagnosisSubmission): CerberusDiagnosisSubmission {
  const { summary, evidence, proposal } = submission;
  return {
    summary: maskCredentials(summary),
    evidence: evidence.map((line) => maskCredentials(line)),
    proposal: proposal === null ? null : { ...proposal, name: maskCredentials(proposal.name) },
  };
}
