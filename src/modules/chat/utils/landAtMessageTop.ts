/**
 * How long the landing keeps re-aligning, in frames (about three quarters of a second). Rows near the
 * message were placeholders of an estimated height until this scroll brought them into the lazy band,
 * and they measure themselves a commit or two later — after any run of "nothing to correct" frames —
 * so the pin holds for a fixed window rather than until the first quiet one.
 */
const PIN_FRAMES = 45;
/** How far the scroller may sit from where the pin last put it and still be where the pin put it (sub-pixel rounding). */
const PINNED_TOLERANCE_PX = 2;

/** The distance the scroller must move for `message` to stand at its own top inset — the gap the first row of any transcript has. */
function distanceToTopInset(container: HTMLElement, message: HTMLElement): number {
  const topInset = Number.parseFloat(container.ownerDocument.defaultView?.getComputedStyle(container).paddingTop ?? '0') || 0;
  return message.getBoundingClientRect().top - container.getBoundingClientRect().top - topInset;
}

/**
 * Puts the message `locateMessage` finds at the top of the transcript view, at once, and keeps it
 * there while the rows around it settle (see `PIN_FRAMES`). The pin gives up the moment the reader
 * turns a wheel, touches, grabs the scrollbar or presses a key, or the view is somewhere the pin did
 * not leave it.
 *
 * The message is LOCATED AGAIN ON EVERY FRAME, never held: the operator's sent message changes its
 * key when the persisted row replaces its local echo, so the element found first is unmounted a
 * commit later and a held reference would hold nothing. A frame that finds none waits for the next.
 *
 * Used by `useChatSessionState` to land the operator on the message they sent. The scroll events it
 * causes are read as any other: a view parked above the foot is "scrolled up", so the jump-to-bottom
 * button shows and the follow stays off. Answers a function that stops the pin; `onDone` runs once,
 * when the pin ends however it ends — the caller holds the other writers of the position back until then.
 */
export function landAtMessageTop(
  container: HTMLElement,
  locateMessage: () => HTMLElement | null,
  hostWindow: Window,
  onDone: () => void,
): () => void {
  let rafId = 0;
  let framesUsed = 0;
  let lastWrittenTop: number | null = null;

  const align = () => {
    const message = locateMessage();
    if (!message) return;
    const distance = distanceToTopInset(container, message);
    if (Math.abs(distance) < 0.5) return;
    container.scrollTop += distance;
    lastWrittenTop = container.scrollTop;
  };

  let isDone = false;
  const stop = () => {
    if (isDone) return;
    isDone = true;
    if (rafId) hostWindow.cancelAnimationFrame(rafId);
    rafId = 0;
    container.removeEventListener('wheel', stop);
    container.removeEventListener('touchstart', stop);
    container.removeEventListener('pointerdown', stopOnScrollbarPress);
    hostWindow.document.removeEventListener('keydown', stop, true);
    onDone();
  };
  // A press on a row is a click on the content; only one on the scroller itself grabs the scroll.
  function stopOnScrollbarPress(event: Event) {
    if (event.target === container) stop();
  }

  const step = () => {
    rafId = 0;
    if (!container.isConnected) return stop();
    // Someone else moved the view since the last write: it is theirs now.
    if (lastWrittenTop !== null && Math.abs(container.scrollTop - lastWrittenTop) > PINNED_TOLERANCE_PX) return stop();

    align();
    framesUsed += 1;
    if (framesUsed >= PIN_FRAMES) return stop();
    rafId = hostWindow.requestAnimationFrame(step);
  };

  container.addEventListener('wheel', stop, { passive: true });
  container.addEventListener('touchstart', stop, { passive: true });
  container.addEventListener('pointerdown', stopOnScrollbarPress, { passive: true });
  hostWindow.document.addEventListener('keydown', stop, true);

  align();
  rafId = hostWindow.requestAnimationFrame(step);
  return stop;
}
