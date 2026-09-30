import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';

import { readVerveTokens } from '@/modules/widgets/readVerveTokens';
import { useHostWindow } from '@/shared/context/HostWindowContext';
import { useTheme } from '@/shared/context/ThemeContext';
import type { WidgetHostHandlers, WidgetHostMessage } from '@/shared/types';

/**
 * The floor and ceiling a frame's self-reported height is clamped between.
 *
 * The frame is untrusted, so its height is a request rather than a measurement: without a
 * ceiling a widget could report a million pixels and push the whole transcript off the screen,
 * and without a floor a mid-layout report of 0 would collapse it to an invisible line the reader
 * cannot recover. Both are one constant each to move.
 */
const MIN_WIDGET_HEIGHT = 24;
const MAX_WIDGET_HEIGHT = 2000;

/**
 * One poster per window, made in that window's own realm — see `postAsHostWindow`.
 * Module-private: `postToFrame` below is the only caller.
 */
const postersByWindow = new WeakMap<Window, (target: Window, message: WidgetHostMessage) => void>();

/**
 * Posts `message` to `target` (a widget frame's window) AS `hostWindow`, so the frame sees its own
 * `parent` as the sender.
 *
 * WHY THIS IS NOT JUST `target.postMessage(...)`. A message's `event.source` is the window whose
 * SCRIPT made the call, and every line of this app runs in the opener's realm — even while the chat
 * is drawn in a picture-in-picture window. The widget bridge accepts a message only when
 * `event.source === window.parent` (`widgetBridgeScript.ts`), and for a frame in the floating window
 * that parent is the floating window. A post made straight from here arrives from the OPENER, and the
 * bridge drops it in silence: no `theme` applied, no `data`, not even the host's refusal of a topic
 * (measured 2026-09-29: the frame's own listener saw the message, `live.theme` stayed null). So the
 * call is made by a function CREATED in `hostWindow`'s realm, whose realm is then the caller.
 *
 * At home `hostWindow` is the global window and the call is the direct one it always was. If the
 * window refuses to build the function, the direct post is the fallback and the refusal is logged —
 * the widget then hears nothing, and that has to be findable rather than silent.
 */
function postAsHostWindow(hostWindow: Window, target: Window, message: WidgetHostMessage): void {
  if (hostWindow === window) {
    target.postMessage(message, '*');
    return;
  }
  let poster = postersByWindow.get(hostWindow);
  if (!poster) {
    try {
      poster = new (hostWindow as Window & typeof globalThis).Function(
        'target',
        'message',
        'target.postMessage(message, "*");',
      ) as (target: Window, message: WidgetHostMessage) => void;
    } catch (error) {
      console.warn('Widget host: the floating window would not build a poster; posting from the opener, which a widget drops', error);
      poster = (frameWindow, payload) => frameWindow.postMessage(payload, '*');
    }
    postersByWindow.set(hostWindow, poster);
  }
  try {
    poster(target, message);
  } catch (error) {
    // A window that closed under a delivery: the frame went with it, and the chat is on its way home.
    console.warn('Widget host: could not post to a frame in a window that is going away', error);
  }
}

/**
 * The page's half of the widget protocol: one message listener per frame, and the two things the
 * host says back — the current theme, and the answer to a topic request.
 *
 * Everything here starts from the same premise: the frame is untrusted. So a message is acted on
 * only when it came from THIS frame's `contentWindow` (identity, not origin — every sandboxed
 * document shares the opaque origin `null`, so comparing origins would admit all of them), only
 * when its shape validates, and only when its `type` is one of the four the frame is allowed to
 * say. Anything else is dropped in silence.
 *
 * AND ONLY WHILE THE FRAME STILL HOLDS OUR DOCUMENT. `contentWindow` identity is not enough on its
 * own, because it survives a navigation: a sandboxed frame may always navigate ITSELF, whatever
 * the CSP says (measured, and recorded at length in `buildWidgetDocument`), and the window object
 * is reused when it does. So a widget that sets `location.href` keeps the same `contentWindow`,
 * and `postMessage(…, '*')` — the only target origin an opaque origin permits — would go on
 * delivering into whatever now occupies the frame. That matters because `postToFrame` is the very
 * `send` the live bus hands to `onSubscribe`: a widget could subscribe, navigate to a site it
 * controls, and have the host keep pushing subscribed data to it. The frame holding nothing of
 * ours to READ, which is what the sandbox guarantees, says nothing about what the host PUSHES.
 *
 * What closes it is the `load` event, which the embedder can see even though the document is
 * cross-origin. The first `load` is our own srcDoc; ANY later one means the document that posted
 * `ready` is gone, so the frame is revoked permanently and nothing is posted into it again. It is
 * never re-armed: a navigated frame can forge a `ready` as easily as any other message, so arming
 * on `ready` alone would hand the channel straight back.
 *
 * That rule is only sound because the element loads exactly ONE document in its lifetime, and
 * that is a structural guarantee rather than a convention: `WidgetFrame` keys `WidgetFrameLive`
 * on the fence body, so a changed body arrives as a NEW element rather than as a fresh `srcDoc`
 * on this one. It matters because an in-place `srcDoc` reassignment fires a second `load` that is
 * indistinguishable from a navigation here — which would revoke a healthy widget permanently and
 * in silence. If that key is ever removed, this counter starts lying; do not weaken one without
 * the other.
 *
 * This does not make a hostile widget safe — one that navigates away can carry whatever it had
 * already received in the URL it leaves by, and no shipped control closes that. It closes the
 * CONTINUING channel, which is the part that is closable.
 */
export function useWidgetHost(
  frameRef: RefObject<HTMLIFrameElement>,
  handlers: WidgetHostHandlers,
): { height: number; postToFrame: (message: WidgetHostMessage) => void; onFrameLoad: () => void } {
  const { isDarkMode } = useTheme();
  // The window the frame is drawn in. A widget posts to its `parent`, and in a picture-in-picture
  // window that parent is THAT window, so the `message` listener below binds to it and every post to
  // the frame is made as it (`postAsHostWindow`). The theme message's tokens are NOT read from it:
  // they come from the opener's document, for the reason `postTheme` gives.
  const hostWindow = useHostWindow();

  // The frame's own reported height, clamped. It is state because it is the iframe's rendered
  // height: a widget that grows after load (a chart drawing, a list filling in) has no other way
  // to make the element around it grow with it, and the element must SHRINK again too — which is
  // why this is the height itself and never a min-height.
  const [height, setHeight] = useState(MIN_WIDGET_HEIGHT);

  // Handlers arrive as a fresh object on most renders. Reading them through a ref keeps the
  // listener installed exactly once per frame instead of being torn down and re-added whenever
  // the parent re-renders — a re-installed listener would miss messages sent in between.
  const handlersRef = useRef(handlers);
  useEffect(() => {
    handlersRef.current = handlers;
  }, [handlers]);

  // How many documents this element has loaded, and whether the frame has been given up on.
  // Refs rather than state on purpose: revocation must take effect for a message already being
  // handled in this same tick, and a state update would not be visible until the next render.
  const loadCountRef = useRef(0);
  const revokedRef = useRef(false);

  // Wired to the iframe's own `onLoad` (see `WidgetFrame`) rather than to a listener added from
  // an effect. React attaches this during commit, before the browser has finished fetching the
  // srcDoc document, so the first load is never missed — an effect could attach after it, and
  // would then miscount the ATTACKER's navigation as the first load and never revoke.
  const onFrameLoad = useCallback(() => {
    loadCountRef.current += 1;
    if (loadCountRef.current > 1) revokedRef.current = true;
  }, []);

  const postToFrame = useCallback(
    (message: WidgetHostMessage) => {
      if (revokedRef.current) return;
      // '*', and the reason differs by which frame this host is driving.
      //
      // For an HTML widget it is the only option there is: the document sits on an opaque origin,
      // which has no name to address. For a `DocSpaceFrame` the origin IS nameable, so '*' is a
      // choice rather than a necessity — one made because this hook is shared and threading a
      // per-frame target origin through it would buy nothing here. What '*' risks is delivering
      // to a document other than the one intended, and both halves of that are already closed:
      // the message goes only to THIS element's `contentWindow`, and the `load` counter above
      // revokes the frame the moment it holds a second document, so a frame that navigated away
      // is never posted into again. The payload is the theme flag and the app's CSS token values
      // — nothing addressed to a widget is a secret. If either of those ever stops being true,
      // this is where the DocSpace frame's real origin has to start being named.
      const target = frameRef.current?.contentWindow;
      if (target) postAsHostWindow(hostWindow, target, message);
    },
    [frameRef, hostWindow],
  );

  // The tokens are read from the OPENER's document, on purpose, and not from the window's copy of
  // `<html>`. `ThemeProvider` writes the theme there in a layout effect, so this passive effect reads
  // the theme that was just chosen; the window's copy is kept by chat-host's mirror through a
  // MutationObserver, which runs AFTER this effect on a click-driven flip — reading it here posted the
  // new `dark` flag with the PREVIOUS theme's tokens, one flip behind on every flip (measured
  // 2026-09-29). The tokens are theme values, and the window's sheets are clones of the opener's, so
  // once the mirror catches up the window computes the same ones. An opener fact, named.
  const postTheme = useCallback(() => {
    postToFrame({ type: 'theme', dark: isDarkMode, tokens: readVerveTokens(document) });
  }, [isDarkMode, postToFrame]);

  // `postTheme` changes identity on every theme flip. The message listener below reaches it
  // through this ref rather than through its dependency list, because naming it there would tear
  // the listener down and re-add it on each flip — which is precisely the churn the ref above
  // exists to prevent, and would make the "installed once per frame" guarantee false.
  const postThemeRef = useRef(postTheme);
  useEffect(() => {
    postThemeRef.current = postTheme;
  }, [postTheme]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const frame = frameRef.current;
      if (!frame || event.source !== frame.contentWindow) return;
      // A revoked frame is not merely un-postable-to: it is not listened to either. Otherwise a
      // navigated document could still drive `onSubscribe`, registering bus subscriptions whose
      // deliveries would then be dropped one by one at `postToFrame` — work held open on behalf
      // of a document that is gone, and a `ready` that would re-post the theme into it.
      if (revokedRef.current) return;

      const message = event.data as Record<string, unknown> | null;
      if (!message || typeof message !== 'object' || typeof message.type !== 'string') return;

      if (message.type === 'resize') {
        // A non-finite height is not a small mistake to round off — NaN or Infinity here would
        // set an unusable style — so it is refused outright rather than coerced.
        if (typeof message.height !== 'number' || !Number.isFinite(message.height)) return;
        setHeight(Math.min(MAX_WIDGET_HEIGHT, Math.max(MIN_WIDGET_HEIGHT, Math.round(message.height))));
        return;
      }

      if (message.type === 'ready') {
        // The document was built with the theme of the moment it was built; this is what keeps
        // it current afterwards, and it is the only theme path — a flip never rebuilds srcDoc.
        postThemeRef.current();
        // The embedder's own hook on the SAME accepted `ready`, and deliberately AFTER the theme
        // post: everything this listener already did has happened, so a handler that throws
        // cannot cost the frame its theme. It fires only for a ready this listener ADMITTED —
        // right frame, not revoked — which is what lets `DocSpaceFrame` treat it as proof of
        // life and disarm its timeout; a post from any other window has returned far above.
        // Reached through the ref for the reason the ref exists: `handlers` is a fresh object on
        // most renders, and naming it in the dependency list would re-install this listener
        // underneath a message already in flight.
        handlersRef.current.onReady?.();
        return;
      }

      if (message.type === 'subscribe' || message.type === 'unsubscribe') {
        if (typeof message.topic !== 'string') return;
        const topic = message.topic;
        const { onSubscribe, onUnsubscribe } = handlersRef.current;

        if (message.type === 'subscribe') {
          // No handler means no topic is admitted here, which is a refusal and not a silence:
          // a widget waiting forever for data cannot tell that from a slow producer.
          if (onSubscribe) onSubscribe(topic, postToFrame);
          else postToFrame({ type: 'error', topic, reason: 'topic not allowed' });
          return;
        }

        onUnsubscribe?.(topic);
      }
    };

    hostWindow.addEventListener('message', onMessage);
    return () => hostWindow.removeEventListener('message', onMessage);
    // The first two dependencies are stable for the life of the frame and the window changes only
    // when the chat moves between hosts, so this listener is added once per window and removed once
    // — never re-installed underneath a message already in flight.
  }, [frameRef, postToFrame, hostWindow]);

  // A theme flip re-posts into the living document rather than rebuilding it. Rebuilding would
  // reload every widget on the screen and throw away whatever state each had built up.
  useEffect(() => {
    postTheme();
  }, [postTheme]);

  return { height, postToFrame, onFrameLoad };
}
