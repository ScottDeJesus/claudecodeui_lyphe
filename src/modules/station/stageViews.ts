import type { ComponentType } from 'react';

import { CardStage } from '@/modules/station/CardStage';
import { PageStage } from '@/modules/station/PageStage';
import type { StationFocus, StationFocusKind } from '@/shared/station-types';

/**
 * THE REGISTRY OF THE STAGE'S VIEWS: for each kind of focus, the component that draws it large, handed `{ focus }` narrowed
 * to its kind. A kind with no line draws `FocusFallback` — its glyph and word, and a working way to the thing in CloudCLI —
 * so a focus whose view has not landed is never a blank. Each later plan (the chat, the asks, the checks, her cards, her
 * walkthrough) adds its line here and its fallback stops drawing for that kind.
 *
 * Holds `card` and `page`. Read by `StationStage`.
 */
export const STAGE_VIEWS: { [Kind in StationFocusKind]?: ComponentType<{ focus: Extract<StationFocus, { kind: Kind }> }> } = {
  card: CardStage,
  page: PageStage,
};
