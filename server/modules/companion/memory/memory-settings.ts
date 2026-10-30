import type { CompanionMemoryReading } from '@/shared/companion-types.js';

import { BANK_PAGE_ID, bankDoor } from './bank-door.js';
import { accountName, clearMemory } from './memory-verbs.js';

/**
 * THE TWO VERBS SETTINGS' "HER MEMORY" CARD CALLS, and nothing else. They are verbs of the memory folder, not of the route: the route
 * (`memory.routes.ts`) only parses and answers, and what a reading is and what a Settings clear says as its reason are decided here.
 * They sit beside `memory-verbs.ts` and not in it because that file is at the module-size ceiling, and they are the Settings half of
 * `clearMemory`'s two callers (the other is the hands' `clear_memory`, on his word).
 *
 * NOTHING HERE IS PUSHED. The card reads when Settings opens and again after a clear; no frame announces her bank, and nothing
 * polls it. Consumer: `memory/memory.routes.ts`.
 */

/**
 * Her memory as Settings reads it: how many memories her bank holds, and the DocSpace page that shows them. The count is the door's
 * `list`, one call whose rows carry no bodies. A door that does not answer is `count: null` with its
 * sentence as `reason`, never a count of zero: "she keeps nothing" and "her memory cannot be read" are different things to show him.
 * Never throws. Consumed by `memory.routes.ts`, behind `GET /api/companion/memory`.
 */
export async function readMemory(): Promise<CompanionMemoryReading> {
  const listed = await bankDoor.list();
  if (!listed.ok) return { count: null, pageId: BANK_PAGE_ID, reason: listed.sentence };
  return { count: listed.value.length, pageId: BANK_PAGE_ID, reason: null };
}

/**
 * Every memory of her bank retired as his act in Settings: the cause each row's reason reads is `<account> cleared her memory in
 * Settings, <at>.`, with `account` the CloudCLI username of the account that pressed it and `at` the moment of the press (ISO), so the
 * docstore's history keeps who cleared it and when. Answers what `clearMemory` answers: `{ ok: true, forgotten }`, or `{ ok: false,
 * sentence }` for a door that stopped it, the sentence saying how many were forgotten before it. Consumed by `memory.routes.ts`,
 * behind `DELETE /api/companion/memory`.
 */
export function clearMemoryFromSettings(userId: number): ReturnType<typeof clearMemory> {
  return clearMemory({ kind: 'settings', account: accountName(userId), at: new Date().toISOString() });
}
