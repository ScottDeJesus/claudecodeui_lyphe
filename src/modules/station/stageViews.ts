import type { ComponentType } from 'react';

import { AskStage } from '@/modules/station/AskStage';
import { CardStage } from '@/modules/station/CardStage';
import { ChatStage } from '@/modules/station/ChatStage';
import { CheckStage } from '@/modules/station/CheckStage';
import { FollowupsStage } from '@/modules/station/FollowupsStage';
import { NoteStage } from '@/modules/station/NoteStage';
import { PageStage } from '@/modules/station/PageStage';
import { WalkStage } from '@/modules/station/WalkStage';
import type { StationFocus, StationFocusKind } from '@/shared/station-types';

/**
 * THE REGISTRY OF THE STAGE'S VIEWS: for each kind of focus, the component that draws it large, handed `{ focus }` narrowed
 * to its kind. Every kind of focus has its line (`chat`, `card`, `page`, `ask`, `followups`, `check`, her `note` cards and her
 * `walk`); a kind added to `StationFocusKind` draws `FocusFallback` — its glyph and word, and a working way to the thing in
 * CloudCLI — until its line lands here, so a focus whose view has not landed is never a blank. Read by `StationStage`.
 */
export const STAGE_VIEWS: { [Kind in StationFocusKind]?: ComponentType<{ focus: Extract<StationFocus, { kind: Kind }> }> } = {
  chat: ChatStage,
  card: CardStage,
  page: PageStage,
  ask: AskStage,
  followups: FollowupsStage,
  check: CheckStage,
  note: NoteStage,
  walk: WalkStage,
};
