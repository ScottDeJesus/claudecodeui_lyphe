/**
 * How many board cards the dispatcher may work at the same time: every whole number `~/.claude/charters/cards.toml` accepts for `width`, lowest
 * first. Used by `RunnerBugBoardRow`, which builds its dropdown from it.
 */
export const BUG_BOARD_WIDTH_CHOICES: readonly number[] = [1, 2, 3, 4];

/** The bounds the dispatcher holds the sort's confidence to (`card_config`'s `threshold`). The row prints them over its field. */
export const BUG_BOARD_THRESHOLD_MIN = 0.5;
export const BUG_BOARD_THRESHOLD_MAX = 0.99;

type BugBoardSettings = {
  /** Card walks allowed at once, as the dispatcher last answered, or `null` while no read has succeeded. */
  width: number | null;
  /** How sure a voice must be for its sort to be taken, as the dispatcher last answered, or `null` while no read has succeeded. */
  threshold: number | null;
  /** True once a read has failed: the two numbers are unknown, which is not the same as their defaults. */
  unreadable: boolean;
  /** True while a write is in flight. */
  saving: boolean;
  /**
   * What the confidence field draws: the operator's own typing while a draft is open, otherwise the saved number at two decimals (`0.80`).
   * Empty while `threshold` is `null`.
   */
  thresholdText: string;
  /**
   * True from the moment the field was left on a draft that is not a number inside the bounds, until it is typed in again. The row
   * says "not saved" under the field while it holds. A blank draft is not one: it sends nothing and says nothing.
   */
  thresholdOutOfBounds: boolean;
  /** Move the number of cards walked at once. */
  setWidth: (next: number) => Promise<void>;
  /** Keep what the operator typed into the confidence field as a draft; nothing is written, and `thresholdOutOfBounds` falls. */
  typeThreshold: (text: string) => void;
  /**
   * The confidence field was left: write the draft when it is a number inside the bounds, else drop it so the field snaps back, raising
   * `thresholdOutOfBounds` unless the draft was blank.
   */
  leaveThreshold: () => void;
  /** Ask the dispatcher again: the way out of an unreadable setting. */
  refresh: () => Promise<void>;
};

/**
 * The one reader and writer of the dispatcher's two card numbers in `src/`: how many board cards it works at once, and how sure the sort
 * must be. Used by the settings module's `RunnerBugBoardRow`, which composes it.
 *
 * The numbers are NOT client preferences: they are `~/.claude/charters/cards.toml`, which the dispatcher reads at every take-up and every
 * sort, so every read here is a request to the server (`GET` / `PUT /api/kanban-dispatch/settings`, which relay `dispatcher card config`).
 *
 * A STUB: it answers the file's two shipped numbers and every act does nothing, so the row draws as it will stand. Its shape (the names
 * above and what each one promises) is the row's contract and is not the fill's to change.
 */
export function useBugBoardSettings(): BugBoardSettings {
  // FILL: read — GET /api/kanban-dispatch/settings into `width` and `threshold`, at mount and whenever the page regains focus or becomes
  // visible, as `useCpuLimit` does; a body that is not the two numbers inside their bounds is "could not ask" (`unreadable`), never a default.
  const width: number | null = 1;
  const threshold: number | null = 0.8;
  const unreadable = false;

  // FILL: saving — true from a write's start to the answer read back off the file.
  const saving = false;

  // FILL: thresholdText — the draft while one is open, else `threshold.toFixed(2)`; a read that lands mid-type never overwrites the draft.
  const thresholdText = '0.80';

  // FILL: thresholdOutOfBounds — raised by `leaveThreshold` on a dropped draft that was not blank; lowered by `typeThreshold`.
  const thresholdOutOfBounds = false;

  // FILL: setWidth — PUT { width }, optimistic then corrected by what the server read back; a pick during a write folds into the next write.
  const setWidth = async (): Promise<void> => {};

  // FILL: typeThreshold — hold the text as the draft, and lower `thresholdOutOfBounds`.
  const typeThreshold = (): void => {};

  // FILL: leaveThreshold — no draft sends nothing; a blank drops the draft; a non-number or a number outside the two bounds drops it and
  // raises `thresholdOutOfBounds`; anything else is PUT { threshold } rounded to two decimals, and the draft is dropped once that write
  // answers if it still holds the text sent.
  const leaveThreshold = (): void => {};

  // FILL: refresh — ask again, unless a write is in flight (its own answer is already coming).
  const refresh = async (): Promise<void> => {};

  return { width, threshold, unreadable, saving, thresholdText, thresholdOutOfBounds, setWidth, typeThreshold, leaveThreshold, refresh };
}
