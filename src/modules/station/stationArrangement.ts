import type { StationArrangement, StationTier } from '@/shared/types';

/**
 * The arrangement the station draws: the phone's FIRST (a phone is never asked to use the second monitor's), then compact below
 * 1024 px (the tier `narrow`) and wherever his `compact` switch is on, else the tier's own columns. The one place the rule is
 * written, so the shell that draws the arrangement and a stage view that places something by it never disagree.
 *
 * Used by this module's StationShell (which picks the arrangement) and CheckStage (which places its check sheet by it).
 */
export function stationArrangementOf(tier: StationTier, phone: boolean, compactOn: boolean): StationArrangement {
  if (phone) return 'phone';
  if (tier === 'narrow' || compactOn) return 'compact';
  return tier;
}
