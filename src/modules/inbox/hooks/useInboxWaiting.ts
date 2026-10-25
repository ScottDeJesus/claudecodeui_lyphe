import { useHeal } from '@/modules/heal';
import { useDispatcherPlans } from '@/modules/dispatcher';
import { DISPATCHER_ALL_TOPIC, useLiveTopic } from '@/modules/live-bus';
import { useMemoryIntake } from '@/modules/memory-intake';

/**
 * What waits on the operator, per section of the Inbox and in all: the memories sessions proposed, the live friction
 * in the heal ledger, and the asks the roadmap's features and epics are stopped on. Each figure is the one its own
 * module already counts — the Memory tab's pending badge, the Heal tab's `live` (the whole live ledger, which is not
 * the headline `Friction` figure the Heal panel opens on: that one is the cut since the last heal), the lane's
 * `waiting` (asks by identity, never cards) — so the memory and roadmap counts are the very figures their panels print.
 *
 * ONE HOOK FOR THE TOTAL AND ITS PARTS: the total is the sum of the three, read here and nowhere else, so a figure
 * for "everything waiting" and the strip's counts can never tell different stories. A reading not yet landed (no
 * summary from the ledger, nothing retained on the lane) counts as a zero: an unreadable source is not something
 * waiting.
 *
 * `landed` SAYS WHICH READINGS HAVE ARRIVED, for the one decision that must tell a zero from a reading not yet taken:
 * where an entry lands the reader. A figure is enough for a badge; it is not for a rule that takes the first section
 * with something waiting, because a section not yet read is not a section with nothing waiting. A reading that came
 * back refused or unreachable has still landed (its figure is the honest zero); only "not asked yet" has not.
 *
 * Used by this module's InboxPanel for its strip's counts and its entry rule, and through the barrel by
 * project-workspace's useRailBadges, which draws `total` as the Inbox glyph's badge.
 */
export function useInboxWaiting(): {
  memory: number;
  heal: number;
  roadmap: number;
  total: number;
  landed: { memory: boolean; heal: boolean; roadmap: boolean };
} {
  const { pending, pendingCount: memory } = useMemoryIntake();
  const { state, summary } = useHeal();
  const heal = summary?.live ?? 0;
  const { waiting: roadmap } = useDispatcherPlans();
  // The lane's own reading collapses "nothing retained yet" into an empty lane on purpose, so the bus is asked directly:
  // `undefined` there is "no picture has landed", the one thing a count of 0 cannot say.
  const lane = useLiveTopic(DISPATCHER_ALL_TOPIC);

  return {
    memory,
    heal,
    roadmap,
    total: memory + heal + roadmap,
    landed: { memory: pending !== null, heal: state.phase !== 'loading', roadmap: lane !== undefined },
  };
}
