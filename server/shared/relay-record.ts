import type { RelayedPress } from '@/shared/relayed-press-types.js';

/**
 * The record of his word, spoken or typed, that kaylee--press's doors read from `--relay`, as ONE argv string: the JSON of
 * `{ by: "app:kaylee", account, said_at, target, words, press }` and, when the press carries one, `token`.
 *
 * Its keys come in kaylee--press's order (`dispatcher shapes relay` prints the shape), and `token` is left out when it is `null` —
 * a record that names a token is an Accept's, and the door checks it against the `--lock` the same argv carries. `target`
 * is the card (or the chain) THIS act is on: a door refuses a record that names another, so the target is the verb's own
 * argument and never the press's. `words` is his line exactly as he said it; JSON escapes it, and nothing here trims it.
 *
 * Used by the dispatcher module (`dispatcher-answer.service.ts` for the Accept and each `tell`, `dispatcher-relay.service.ts`
 * for the other verbs) and by dispatch-souls (`run-resume.service.ts`) — two modules write the record, so one function does.
 */
export function relayRecord(press: RelayedPress, target: string): string {
  return JSON.stringify({
    by: 'app:kaylee',
    account: { id: press.account.id, name: press.account.name },
    said_at: press.saidAt,
    target,
    words: press.words,
    press: press.press,
    ...(press.token === null ? {} : { token: press.token }),
  });
}
