import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';

import { readVerveTokens } from '@/modules/widgets/readVerveTokens';
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
      // '*' for the same reason the frame uses it: an opaque origin has no name to address.
      frameRef.current?.contentWindow?.postMessage(message, '*');
    },
    [frameRef],
  );

  const postTheme = useCallback(() => {
    postToFrame({ type: 'theme', dark: isDarkMode, tokens: readVerveTokens() });
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

    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
    // Both dependencies are stable for the life of the frame, so this listener is added once and
    // removed once — never re-installed underneath a message already in flight.
  }, [frameRef, postToFrame]);

  // A theme flip re-posts into the living document rather than rebuilding it. Rebuilding would
  // reload every widget on the screen and throw away whatever state each had built up.
  useEffect(() => {
    postTheme();
  }, [postTheme]);

  return { height, postToFrame, onFrameLoad };
}
