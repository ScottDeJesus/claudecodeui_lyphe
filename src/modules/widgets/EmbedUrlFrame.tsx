import { useMemo } from 'react';

import { WidgetErrorCard } from '@/modules/widgets/WidgetErrorCard';
import { isForeignOrigin } from '@/modules/widgets/docspaceOrigin';
import { resolveEmbedUrl } from '@/modules/widgets/embedUrl';
import type { EmbedUrlRef } from '@/shared/types';

/**
 * The THIRD fence: any address at all, drawn in a frame in the transcript.
 *
 * WHAT MAKES IT A DIFFERENT SHAPE FROM ITS TWO NEIGHBOURS. The HTML widget is a document this app
 * composes and hands to the frame inline, so the app knows everything inside it. The DocSpace frame
 * points at ONE known service on a route this app builds, so the app knows the page's protocol —
 * `ready`, a height, a theme. This one points wherever the writer said, and the app therefore knows
 * NOTHING about what loads: no protocol, no height report, no theme, no proof it rendered. Every
 * difference below follows from that single fact rather than from a preference.
 *
 * THE HEIGHT IS DECLARED, NOT REPORTED, and it has to be. `useWidgetHost` exists to let a frame say
 * how tall it is, and a page that never heard of this app will never post that message — so the
 * frame would sit forever at the host's 24-pixel floor and read as a thin empty line. The fence body
 * carries the height instead, clamped here between a floor that is visibly a frame and the same
 * 2000-pixel ceiling a widget's own reports are clamped to, so a mistyped `height` cannot push the
 * rest of the transcript off the screen. FULLSCREEN is the answer to a declared height being wrong:
 * the reader can always give the frame the whole viewport without the writer having guessed right.
 *
 * WHY THERE IS NO READY TIMEOUT, unlike `DocSpaceFrame`. An address that refuses to be framed —
 * `X-Frame-Options: DENY`, a `frame-ancestors` CSP, which is most of the public web — still fires
 * `load` on the element, and its document is cross-origin, so nothing in this page can tell a
 * refusal from a blank page from a perfectly rendered one. A timer here would therefore be a coin
 * toss dressed as a diagnosis. The honest answer is the card's own action instead: every embed
 * carries its address as an `Open` link, so a frame that shows nothing is one click from the page
 * it was meant to show.
 *
 * A LOOPBACK ADDRESS IS THE COMMONEST WAY TO WRITE A BROKEN EMBED, and it is cured here rather
 * than merely warned about: `127.0.0.1` in an `src` is resolved by the READER'S browser and names
 * the reader's own machine. On the box that is right; on the phone over Tailscale — which is how
 * this app is mostly read — it is a blank frame with nothing to say. `resolveEmbedUrl` moves such
 * an address onto whatever host reached this page, which is the same trick `resolveDocSpaceOrigin`
 * plays for the same reason.
 *
 * MIXED CONTENT IS THE OTHER SILENT FAILURE and it has the same answer: an `http://` address inside
 * a page served over `https://` is blocked by the browser before this element sees anything. The
 * app cannot fix that from here — it is the browser's rule, correctly applied — and the link out is
 * again what rescues the reader.
 */

/**
 * The three tokens, and no fourth — deliberately the same set `DOCSPACE_SANDBOX` carries.
 *
 * `allow-scripts` because nearly every embeddable page is an application; `allow-same-origin`
 * because a page stripped of its own origin cannot read its own session or storage and most
 * embeds turn into a login wall or an exception; `allow-forms` because a frame the reader cannot
 * submit anything in is a picture. Withheld and worth naming: `allow-popups`, so an embed cannot
 * spray windows over the operator's browser, and `allow-top-navigation`, so it cannot steer the
 * tab it sits in away from the chat.
 *
 * `allow-same-origin` is only safe because of the origin gate below — it grants the frame the
 * origin of the DOCUMENT IT LOADS, which is a hole the instant that document is this app's, since
 * CloudCLI's login JWT sits in `localStorage['auth-token']` where a same-origin frame reads it.
 * See `docspaceOrigin.ts`, where that rule is written out in full; this fence obeys the same one.
 */
export const EMBED_SANDBOX = 'allow-scripts allow-same-origin allow-forms';

/**
 * The floor, ceiling and default of a declared height, in CSS pixels.
 *
 * The ceiling is `useWidgetHost`'s own `MAX_WIDGET_HEIGHT`, spelled again rather than imported: that
 * constant clamps a MESSAGE from an untrusted frame, this one clamps a number in a fence body, and
 * the two would be tied together by an import that has no reason to hold. The default is a frame
 * tall enough to read a dashboard panel or a page of text in, which is what an embed usually is.
 */
export const EMBED_MIN_HEIGHT = 120;
export const EMBED_MAX_HEIGHT = 2000;
export const EMBED_DEFAULT_HEIGHT = 420;

/**
 * One embedded address.
 *
 * Keyed on the fence body by its caller, so `url` cannot change under an instance — the same
 * guarantee the other two frames are built on, and for the same reason: a changed `src` is a
 * navigation, and a navigation would throw away whatever the reader had done inside the frame.
 *
 * `framed` drops this element's own border where the caller has already drawn one. `fill` makes it
 * take the whole of whatever box the caller has put it in, and the declared height is then ignored:
 * a height written for a card in a transcript means nothing once the box is a fullscreen panel or a
 * gutter widget that is already as tall as it is going to be.
 */
export function EmbedUrlFrame({
  url,
  title,
  height,
  framed,
  fill,
}: EmbedUrlRef & { framed?: boolean; fill?: boolean }) {
  // A LOOPBACK ADDRESS IS REWRITTEN ONTO THE READER'S OWN HOST before anything else looks at it.
  // The frame's `src` is resolved by the reader's browser, so `127.0.0.1` names the READER'S machine
  // — right only when they are sitting at the box, and an empty frame on the phone over Tailscale,
  // which is how this app is mostly read. See `embedUrl.ts` for the rule and its one exception.
  const src = useMemo(() => resolveEmbedUrl(url), [url]);

  // The gate on `allow-same-origin`, settled before the iframe is ever rendered, and asked of the
  // address that will actually be loaded. `classifyWidgetBody` has already refused every scheme but
  // http and https; this is the other half — WHERE the address points — and it can only be asked
  // here, because it needs the live page's own origin to compare against and the classifier runs
  // where there is no page.
  const foreign = isForeignOrigin(src);

  // Clamped once per address. The fence body is model output, so `height` is a request: a 40-pixel
  // frame is not a frame and a 40000-pixel one is a transcript nobody can scroll past.
  const drawnHeight = useMemo(
    () => Math.min(EMBED_MAX_HEIGHT, Math.max(EMBED_MIN_HEIGHT, Math.round(height ?? EMBED_DEFAULT_HEIGHT))),
    [height],
  );

  if (!foreign) {
    return <WidgetErrorCard reason="an embedded address must not be this app's own origin" />;
  }

  return (
    // Border on a wrapper, never on the frame: every box here is `border-box`, so a border on the
    // iframe comes out of its height and buys a two-pixel scrollbar. The reason is spelled out once
    // in `WidgetFrame`; all three frames carry the same wrapper because of it.
    <div
      className={
        fill
          ? 'h-full overflow-hidden bg-card'
          : framed
            ? 'overflow-hidden bg-card'
            : 'my-3 overflow-hidden rounded-xl border border-border bg-card'
      }
    >
      <iframe
        src={src}
        sandbox={EMBED_SANDBOX}
        // The frame's accessible name, which is the one place the model's own title does real work
        // beyond the card's heading: a screen reader announces an unnamed frame as "iframe".
        title={title ?? 'Embedded page'}
        referrerPolicy="no-referrer"
        // The one permission granted through `allow`: a video or a dashboard panel with its own
        // fullscreen button keeps it. The card's own fullscreen switch is a different mechanism —
        // it resizes the card in this page and never touches the frame — so the two do not collide.
        allow="fullscreen"
        className="block w-full"
        // `100%` wherever the caller owns the height — a fullscreen card, a gutter widget — because a
        // fixed height there leaves a frame floating in a box that is already the right size.
        style={{ height: fill ? '100%' : drawnHeight }}
      />
    </div>
  );
}
