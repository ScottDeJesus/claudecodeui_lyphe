/**
 * ONE BANK WRITE AT A TIME. A remember checks her bank (a search for a twin) and then writes; two remembers interleaving
 * could each find the bank empty of the other and both write, so a twin gets in. Her bank is one package for every
 * account, so the order is kept per PROCESS, not per account: one promise chain, shared by whoever asks.
 */
let tail: Promise<unknown> = Promise.resolve();

/**
 * Runs `work` after every bank write already queued in this process, whichever account asked, and answers what `work`
 * answers. A `work` that rejects rejects only its own caller: the chain moves on, so one failed write never wedges the
 * next. Consumed by `memory-verbs.ts` (remember, forget and `clearMemory` each run inside it).
 *
 * A `work` must NEVER call `onBank`, nor a verb that does (remember, forget, `clearMemory`): the inner work queues behind the
 * outer one, which is waiting for it, so the chain never settles and every bank write of every account waits on it for the
 * life of the process. A verb that needs another verb's steps calls the steps, not the verb.
 */
export function onBank<T>(work: () => Promise<T>): Promise<T> {
  const mine = tail.then(work);
  // The chain keeps only the settling, not the outcome: a rejection is `mine`'s caller's to handle and must not reach the next work.
  tail = mine.then(() => undefined, () => undefined);
  return mine;
}
