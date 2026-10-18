import type { Region } from '@/shared/affected-areas-types';
import type { Tone } from '@/shared/types';

/**
 * Where a region stands in the operator's judgment: the one thing its look is chosen by.
 * - `proposed`: the reader marked it and nobody has judged it.
 * - `confirmed`: the operator confirmed it, or renamed its kind.
 * - `human`: the operator drew it by hand, a change the reader missed.
 * - `unsure`: unjudged and below its kind's threshold, so the system does not believe it yet.
 * - `not_a_change`: the operator marked it as no change at all.
 */
type RegionState = 'proposed' | 'confirmed' | 'human' | 'unsure' | 'not_a_change';

/** How one state is drawn: its tone, its edge, how much of the tone floods the inside, and its word. */
type RegionLook = { tone: Tone; edge: 'solid' | 'dashed'; wash: 'full' | 'light' | 'none'; wordKey: string };

/**
 * TONE IS BY JUDGMENT, NEVER BY KIND. Verve's tones are five and a sixth is refused (MAN-739 rule 4), and the
 * codebook has fourteen kinds: a colour per kind would need colours that mean nothing a tone means. So a region
 * is painted by where it stands, and its kind is words (the list's label, the badge's accessible name).
 *
 * Blue is the reader's word and green the operator's; a dashed edge is anything the reader's word alone does not
 * carry (a hand-drawn region, one below its line, one marked away). Until marks land, every region a model drew
 * reads `proposed`.
 *
 * Read by the affected-areas module's `PanoScreen` (each region's `RegionShape`) and `RegionList` (each row's
 * number and word). Written whole: the marking plan's marks land in these five states and leave this table as it is.
 */
export const REGION_LOOK: Record<RegionState, RegionLook> = {
  proposed: { tone: 'info', edge: 'solid', wash: 'full', wordKey: 'affectedAreas.look.proposed' },
  confirmed: { tone: 'positive', edge: 'solid', wash: 'full', wordKey: 'affectedAreas.look.confirmed' },
  human: { tone: 'positive', edge: 'dashed', wash: 'full', wordKey: 'affectedAreas.look.human' },
  unsure: { tone: 'info', edge: 'dashed', wash: 'light', wordKey: 'affectedAreas.look.unsure' },
  not_a_change: { tone: 'neutral', edge: 'dashed', wash: 'none', wordKey: 'affectedAreas.look.notAChange' },
};

/**
 * A region's state, read in this order: drawn by hand first (a hand-drawn region is the operator's own, whatever
 * mark it later carries); then the newest mark's verdict, `not_a_change`, or `confirm` / `rename`; then an unjudged
 * region the system does not believe (`standing === false`, no mark). Anything else is `proposed`, a null `mark` or
 * `standing` included: null is "not judged", never "judged and found wanting".
 */
export function regionState(region: Region): RegionState {
  if (region.source === 'human') return 'human';
  const verdict = region.mark?.verdict;
  if (verdict === 'not_a_change') return 'not_a_change';
  if (verdict === 'confirm' || verdict === 'rename') return 'confirmed';
  if (region.mark === null && region.standing === false) return 'unsure';
  return 'proposed';
}
