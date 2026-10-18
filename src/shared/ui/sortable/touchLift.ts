/** How long the lift's pulse lasts: Android's own long-press buzz, which a hand can feel (many vibration motors cannot render a shorter one). A phone on silent, and an iPhone, get none; the item leaving its slot (`carried.ts`) is the cue that does not depend on it. */
const LIFT_PULSE_MS = 20;

/** The sign a finger gets that something has come up: where the device can, it says so in the hand. Used by `useSortable` and `useSimpleChatDrag` at the moment of the lift. */
export function tickLift(): void {
  navigator.vibrate?.(LIFT_PULSE_MS);
}
