import { createContext, useContext, useMemo } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** The stage frame's two boxes a kind's view draws into, each null until the frame has mounted it. */
type StageSlotNodes = {
  /** The head's box for the kind's own acts, between its label and the stage's ✕. */
  actions: HTMLElement | null;
  /** The box under the body, outside its scroller, at the stage's foot. */
  foot: HTMLElement | null;
};

const StageSlotsContext = createContext<StageSlotNodes>({ actions: null, foot: null });

/**
 * THE STAGE'S TWO SLOTS, handed by the frame (`StationStageView`) to the kind's view it draws in its body. The frame owns
 * the head and the foot (their place, their hairline, their padding); a kind that has acts of its own — her card's Pin and
 * Dismiss, her walk's End, the walk's Back and Next — draws them where the frame says, through `StageHeadActions` and
 * `StageFoot`, and keeps them in the one component that holds the thing they act on. Nothing is drawn into a box the frame
 * has not mounted, and a box nothing is drawn into stays out of the layout (`empty:hidden`), so a kind with no acts changes
 * nothing about the stage.
 *
 * Used by this module's `StationStageView` alone.
 */
export function StageSlotsProvider({ actions, foot, children }: StageSlotNodes & { children: ReactNode }) {
  const value = useMemo(() => ({ actions, foot }), [actions, foot]);
  return <StageSlotsContext.Provider value={value}>{children}</StageSlotsContext.Provider>;
}

/**
 * A kind's own acts, drawn in the stage's head beside the ✕ that clears the stage: inline on a stage 40rem wide or more, on a
 * row of their own under the label on a narrower one (a phone, a laptop's column beside her, the wide tier's stage column).
 * Each act names itself in words, because the head's ✕ is an ✕ too and a finger opens no tooltip.
 *
 * Used by this module's `NoteStageView` (Pin or Unpin, and Dismiss) and `WalkStageView` (End the walkthrough).
 */
export function StageHeadActions({ children }: { children: ReactNode }) {
  const { actions } = useContext(StageSlotsContext);
  return actions === null ? null : createPortal(children, actions);
}

/**
 * A kind's foot: the presses that stand under the body, outside its scroller, so a long body never scrolls them away, at the
 * foot of the stage where the thumb is.
 *
 * Used by this module's `WalkStageView` (Back and Next).
 */
export function StageFoot({ children }: { children: ReactNode }) {
  const { foot } = useContext(StageSlotsContext);
  return foot === null ? null : createPortal(children, foot);
}
