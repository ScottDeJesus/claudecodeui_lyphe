import { replyMaterialOf } from '@/modules/chat/transcript/replyMark';
import type { CoreDoing } from '@/modules/chat/utils/coreDoing';
import { useCoreDrawing } from '@/shared/context/CoreDrawingContext';

/** The square a card's core fills, in px: the height of the row's two lines. */
const CORE_PX = 36;

/** How hard a helper's core is driven: enough to stir its surface, under a chat's at full effort. */
const DRIVE = 0.4;

type SubagentCoreProps = {
  /** The model the helper runs on, as its record names it; empty while it names none (the chrome of Mercury then). */
  model: string;
  /** What it is doing, for the form its core takes (`idle` for one that is held back and waiting); `null` once it is not running. */
  doing: CoreDoing | 'idle' | null;
};

/**
 * A HELPER'S MARK ON ITS CARD: its own small core, made of its model's material (the app's one colour coding, `replyMaterialOf`)
 * and in the form of what it is doing, exactly as the chat's core is: the polyhedron while it thinks, the mouth while it reads,
 * the tendril while it changes something, lobes while its words arrive. The mouth and the tendril turn toward the card's own
 * words (three o'clock).
 *
 * ONCE IT IS NOT RUNNING it is the reply's mark instead: a still ring in the same material.
 *
 * The drawing is the page's to give (`useCoreDrawing`), as the chat's own core's is; where no page gave one, it is the ring. One
 * card is open at a time, so one such core is drawn at a time.
 *
 * Used by this module's `PinnedAgentRow` and `SoulLaunchPinRow`, at the head of the row.
 */
export function SubagentCore({ model, doing }: SubagentCoreProps) {
  const draw = useCoreDrawing();
  const material = replyMaterialOf(model);
  const drawn = doing !== null && draw !== null;
  return (
    <span
      aria-hidden="true"
      data-subagent-core={drawn ? doing : 'still'}
      data-material={material}
      className="grid flex-shrink-0 place-items-center"
      style={{ width: CORE_PX, height: CORE_PX }}
    >
      {drawn
        ? draw({ material, state: doing, drive: DRIVE, size: CORE_PX, azimuth: 0 })
        : <span data-reply-mark={material} />}
    </span>
  );
}
