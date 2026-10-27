/**
 * A callback that throws is logged with its account and swallowed: a store error or a panel callback must not end her
 * conversation. Cut from `companion-session.ts` by cohesion — it is a rule about every callback the conversation is
 * handed, not about the conversation. Consumed by `companion-session.ts`, which wraps each callback of its deps in it.
 */
export function guarded<Args extends unknown[]>(label: string, userId: number, callback: (...args: Args) => void): (...args: Args) => void {
  return (...args) => {
    try {
      callback(...args);
    } catch (error) {
      console.error(`[Companion] account ${userId}: the ${label} callback threw`, error);
    }
  };
}
