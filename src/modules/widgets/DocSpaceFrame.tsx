import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { WidgetErrorCard } from '@/modules/widgets/WidgetErrorCard';
import { docspaceEmbedUrl, isForeignOrigin, resolveDocSpaceOrigin } from '@/modules/widgets/docspaceOrigin';
import { useWidgetHost } from '@/modules/widgets/hooks/useWidgetHost';
import { useTheme } from '@/shared/context/ThemeContext';
import type { DocSpaceBlockRef } from '@/shared/types';

/**
 * The SECOND fence: one DocSpace block, embedded live in the transcript and editable in place.
 *
 * TWO FENCES, NOT ONE, AND THEY ARE NOT INTERCHANGEABLE. The HTML widget next door
 * (`WidgetFrameLive`) is model output — a document this app composes and hands to the frame
 * inline, on an opaque origin, under a CSP that refuses the network. Everything it is given is
 * everything it may ever have. This frame is the opposite shape: it navigates to a REAL page on
 * ArchPulse, which owns its own document, its own stylesheet, its own store and its own API. It
 * is not sandboxing untrusted output; it is showing another of the operator's own services.
 *
 * WHY `allow-same-origin` IS SAFE HERE, AND ONLY HERE. That token does not grant the frame OUR
 * origin — it lets the frame keep the origin of the document it loads. For a DocSpace page that
 * origin is `http://<host>:8005`, and the frame needs it for the one thing this feature exists
 * to do: a block the reader edits must be able to write itself back through ArchPulse's own API,
 * and a frame forced onto an opaque origin can neither read its session nor reach that API. The
 * embed would be a picture of a block instead of the block.
 *
 * So the invariant is not the token — it is the ORIGIN. `allow-same-origin` is safe exactly while
 * the document loaded is NOT this app's, because CloudCLI's login JWT sits in
 * `localStorage['auth-token']` and a frame on this origin reads it as easily as the page does.
 * `isForeignOrigin` is where that is settled, mechanically, BEFORE the iframe is ever rendered
 * and whatever an operator put in `VITE_DOCSPACE_EMBED_ORIGIN` — a misconfiguration that pointed
 * this at CloudCLI's own origin draws the error card and no frame at all. That is also why the
 * DocSpace port must never be proxied through this app's Express or Vite to "reach the phone":
 * proxying makes the frame same-origin and hands it the token. It is reached directly instead.
 *
 * Nothing here weakens the other fence. This file adds a second, differently-shaped frame beside
 * the first; it does not touch `WidgetFrameLive`, its sandbox, or the CSP its document carries.
 */

/**
 * The three tokens, and no fourth.
 *
 * `allow-scripts` because the block is a React view; `allow-same-origin` because it must reach
 * its own API (above); `allow-forms` because a block's inputs are how it is edited. Everything
 * else the platform offers is deliberately withheld — the frame may not open windows, may not
 * navigate the tab it sits in, and may not raise a modal dialog over the chat. That last one is
 * not merely tidiness: the embed answers a delete with its own inline confirm strip precisely
 * because a browser dialog would be silently answered `false` in a frame without that token.
 *
 * Reversible in one place: dropping back to `allow-scripts` alone leaves `isForeignOrigin` doing
 * its job and costs the embed its ability to save.
 */
export const DOCSPACE_SANDBOX = 'allow-scripts allow-same-origin allow-forms';

/**
 * How long the frame is given to say `ready` before the reader is told it is not coming.
 *
 * A frame that never answers is the one failure a reader cannot see: an iframe whose document
 * did not load looks exactly like an iframe that is still loading, forever, and the height stays
 * at the host's floor so it reads as a thin empty line rather than as a fault. ArchPulse being
 * down, restarted mid-read, or simply not at the resolved origin all land here. Eight seconds is
 * long enough for a cold Vite transform of the embed route on this box and short enough that
 * nobody sits looking at nothing.
 */
export const DOCSPACE_READY_TIMEOUT_MS = 8000;

/**
 * One embedded block.
 *
 * Keyed on the fence body by its caller, so `pageId`/`blockId` cannot change under an instance
 * and every latch below holds for the element's whole life.
 */
export function DocSpaceFrame({ pageId, blockId }: DocSpaceBlockRef) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const { isDarkMode } = useTheme();

  // The theme of the instant this frame mounted, LATCHED in a ref rather than read per render.
  // The URL carries `?theme=` so the embed's first paint is already right and the reader never
  // sees a light block flash in a dark chat. But `?theme=` may only ever describe that first
  // paint: putting the live theme in the memo below would rewrite `src` on every flip, and a new
  // `src` is a navigation — the frame reloads and whatever the reader had typed into the block
  // is gone. A ref (not state) because changing it must never re-render: its whole purpose is to
  // be the value that does NOT move. Later flips reach the frame as a posted `theme` message
  // through `useWidgetHost`, which is the channel that costs nothing.
  const darkAtMount = useRef(isDarkMode);

  // Whether the frame missed its window to say `ready`. It is state because it is the only thing
  // on this component that CHANGES what is drawn — the frame is torn out and the error card put
  // in its place — and a ref could not schedule that repaint. It is one-way: nothing sets it
  // back, because a frame that never spoke is not going to start.
  const [timedOut, setTimedOut] = useState(false);

  // The armed timer, held in a ref so `onReady` and the unmount cleanup can both reach the same
  // handle without either being re-created when this component re-renders.
  const readyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Origin and URL are derived TOGETHER and memoised on the ids alone, exactly as the latch
  // above requires. The origin is kept as well as the URL because the timeout message names it:
  // "did not answer" is only actionable if the reader is told where nobody answered.
  const { origin, url } = useMemo(() => {
    const resolved = resolveDocSpaceOrigin();
    return { origin: resolved, url: docspaceEmbedUrl(resolved, { pageId, blockId }, darkAtMount.current) };
  }, [pageId, blockId]);

  // The gate on `allow-same-origin`, read before anything is rendered. See the header.
  const foreign = isForeignOrigin(url);

  const clearReadyTimer = useCallback(() => {
    if (readyTimerRef.current === null) return;
    clearTimeout(readyTimerRef.current);
    readyTimerRef.current = null;
  }, []);

  // Proof of life. The host calls this only for a `ready` it ACCEPTED — from this frame's own
  // `contentWindow`, on a frame it has not revoked — so it cannot be forged by another window on
  // the page. Idempotent: a second `ready` finds the handle already cleared.
  const onReady = useCallback(() => {
    clearReadyTimer();
  }, [clearReadyTimer]);

  const { height, onFrameLoad } = useWidgetHost(frameRef, { onReady });

  // Armed at mount and cleared two ways — by `ready`, and by this cleanup on unmount. The
  // cleanup is what keeps a scrolled-away frame from setting state on a component that is gone;
  // it is not a tidy-up, it is the reason `setTimedOut` can never fire late. Not armed at all on
  // the refusal path: no frame is rendered there, so there is nothing to wait for and a timer
  // would only replace one error card with another.
  useEffect(() => {
    if (!foreign) return undefined;
    readyTimerRef.current = setTimeout(() => {
      readyTimerRef.current = null;
      setTimedOut(true);
    }, DOCSPACE_READY_TIMEOUT_MS);
    return clearReadyTimer;
  }, [foreign, clearReadyTimer]);

  if (!foreign) {
    return <WidgetErrorCard reason="the DocSpace origin must differ from this app's origin" />;
  }

  if (timedOut) {
    return <WidgetErrorCard reason={`DocSpace did not answer at ${origin}`} />;
  }

  return (
    // Border on a wrapper, not on the frame — border-box sizing would take it out of the
    // reported height and leave a two-pixel scrollbar. The reason is spelled out in WidgetFrame.
    <div className="my-3 overflow-hidden rounded-xl border border-border bg-card">
      <iframe
        ref={frameRef}
        src={url}
        sandbox={DOCSPACE_SANDBOX}
        title="DocSpace block"
        referrerPolicy="no-referrer"
        // The host's revoke rule: the first load is the block, and any later one means the frame
        // navigated away from it, after which nothing is posted in. Wired as a prop rather than
        // from an effect so React attaches it during commit, before the document can finish
        // loading — an effect could attach after the first load and would then miscount.
        onLoad={onFrameLoad}
        className="block w-full"
        style={{ height }}
      />
    </div>
  );
}
