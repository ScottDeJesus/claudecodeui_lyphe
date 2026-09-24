import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { WidgetEmbedFramer } from '@/shared/types';
import { buildWidgetDocument } from '@/modules/widgets/buildWidgetDocument';
import { classifyWidgetBody } from '@/modules/widgets/classifyWidgetBody';
import { docspaceStudioUrl } from '@/modules/widgets/docspaceOrigin';
import { DocSpaceFrame } from '@/modules/widgets/DocSpaceFrame';
import { EmbedUrlFrame } from '@/modules/widgets/EmbedUrlFrame';
import { resolveEmbedUrl } from '@/modules/widgets/embedUrl';
import { readVerveTokens } from '@/modules/widgets/readVerveTokens';
import { WidgetErrorCard } from '@/modules/widgets/WidgetErrorCard';
import { useWidgetBridge } from '@/modules/widgets/hooks/useWidgetBridge';
import { useWidgetHost } from '@/modules/widgets/hooks/useWidgetHost';
import { otherOverlayHoldsEscape } from '@/shared/ui/overlayEscape';

/**
 * The raw source a widget falls back to, in the spelling `MermaidDiagram` uses for its own
 * fallback, so the two unresolved fences in a transcript read as one thing.
 *
 * THE TWO SPELLINGS MATCH TODAY, with no palette literal on either side. They briefly diverged:
 * this module's own verification gate greps this directory for a palette literal and requires
 * zero, so while `MermaidDiagram` still carried a `dark:bg-zinc-*` override this constant could
 * not copy it, and the two fallbacks painted different dark backgrounds. The rendered-markdown-
 * verve plan's Phase 8 closed that the honest way this comment used to call for: it lifted
 * `MermaidDiagram` off the literal instead of re-adding it here, so both fallbacks are now exactly
 * this string.
 *
 * If a future edit needs `MermaidDiagram`'s fallback to diverge from this one again, that is a
 * deliberate re-tone with its own baseline re-capture (`docs/architecture/MANUAL.md (08-rendered-shapes)`
 * §"Gotchas"), never a quiet copy back of a palette literal this gate rejects.
 */
const FALLBACK_CLASSES =
  'my-3 overflow-x-auto rounded-xl border border-border bg-muted/50 p-4 font-mono text-[0.8125rem] leading-relaxed text-muted-foreground';

/**
 * Renders a ```widget fence as a live, sandboxed HTML widget.
 *
 * Two rules decide what this draws, and both are load-bearing.
 *
 * FIRST RENDER IS ALWAYS THE SOURCE. The iframe appears only after an effect has run. That is
 * not a loading nicety: `renderToStaticMarkup` — which is how the HTML transcript export is
 * built (`buildTranscriptHtml`) — runs no effects at all, so `mounted` below is never set there
 * and an exported document carries the fence's text where the screen carries a living frame. A
 * saved conversation stays a static file, which is the only thing it can safely be. The same gate
 * keeps every hook that needs a browser (and the theme context the export does not provide)
 * inside `WidgetFrameLive`, which the export therefore never renders.
 *
 * A STREAMING FENCE IS SOURCE. While a reply is still being written the fence body is a fragment
 * that grows on every delta, and mounting it would restart the widget ten times a second. It
 * becomes a widget when the fence closes and the block settles into the non-streaming half.
 *
 * A RETRACTION RESTARTS THE WIDGET, AND NOTHING HERE CAN PREVENT THAT. `StreamingMarkdown`
 * recomputes its split on every delta, and an already-settled block returns to the pending half
 * whenever the text after it makes the old split unsafe — about a third of replies, once, by its
 * own doc comment's measurement. The two halves are two FIXED SIBLING SLOTS, so a block crossing
 * between them changes parent: React unmounts this component and mounts a fresh one, exactly as
 * `StreamingMarkdown`'s own comment says ("A block changes parent when it crosses… so its DOM is
 * recreated"). Measured, not reasoned: driving a real retraction over a live widget leaves zero
 * iframes and one `<pre>`. No state local to this component survives that, so gating on a latched
 * body rather than on the flag buys nothing — it was tried, and it only moved the restart. The
 * fence flashes back to source for one tick mid-reply and comes back when the reply ends.
 * Curing it means keeping the block in ONE slot across the boundary, which is `StreamingMarkdown`'s
 * shape to change, not this file's.
 *
 * `frame` IS THE CALLER'S, AND IT IS OPTIONAL. The live element for whichever kind this body turned
 * out to be is handed to it, together with a `WidgetEmbed` saying which kind that is and where a
 * reader can open it outside this app — so the frame can name the embed and offer a way out
 * without ever learning how a body is classified. The chat transcript's `CodeBlock` is the
 * only caller that passes one today, and it passes `EmbedFrame`. The three embed probes are NOT a
 * second shape of caller: `phase-22`, `-28` and `-29` mount through the app's own `Markdown`, so
 * `CodeBlock` hands them a frame too and their shots (2026-09-15) carry the card header. The
 * unframed branch below is therefore a real path with no probe on it yet — it stays for any caller
 * that renders this component directly, rather than through markdown.
 *
 * FULLSCREEN IS STATE HERE AND CHROME THERE, and the split is not arbitrary. A card that wants to
 * fill the screen could be drawn two ways: move the live element into an overlay, or leave it
 * exactly where it is and change the CSS of the box around it. The first is unavailable — React
 * reparenting an iframe destroys and recreates the element, so a fullscreen toggle would reload the
 * widget, drop a DocSpace edit in progress and restart a video. So it is the second, which means
 * the class that does it belongs on the CALLER'S card (only the caller draws a box) while the flag
 * that does it belongs here (only this component knows which live element exists, and only it can
 * tell that element to fill its box). Both halves travel in the `WidgetEmbed` the framer already
 * receives, so a caller drawing no frame simply never offers the switch — and an unframed embed's
 * `fullscreen` stays false forever, which is the correct answer for a box nobody drew.
 */
export function WidgetFrame({
  code,
  streaming,
  frame,
}: {
  code: string;
  streaming?: boolean;
  frame?: WidgetEmbedFramer;
}) {
  // Whether an effect has run in this component — which is to say, whether we are in a browser
  // at all. It is the export's guard, not a loading nicety: `renderToStaticMarkup` runs no
  // effects, so this stays false there and the export gets the `<pre>` above. See FIRST RENDER.
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // WHICH KIND of widget this body is. Read once per body, and read HERE — above the gate below
  // rather than beside the fork it feeds — because a hook may not sit after a conditional return:
  // the first render takes the `<pre>` path, so a `useMemo` placed below would be skipped on that
  // render and called on the next, which is a changed hook count and a React error. Where it is
  // CONSUMED is what the fork's placement is really about, and that is still after the gates.
  const shape = useMemo(() => classifyWidgetBody(code), [code]);

  // Whether the reader has asked this card for the whole screen. It lives here rather than in the
  // caller's frame for the reason the header gives: the class goes on the card, but the flag has to
  // reach the live element, and this is the only component that knows which live element there is.
  //
  // It survives a retraction no better than anything else on this component: a fence that flashes
  // back to source mid-reply unmounts this instance entirely, so a card the reader had opened
  // fullscreen comes back as an ordinary card. That is what a discarded component can offer, and
  // curing it means curing the retraction itself — which is `StreamingMarkdown`'s shape, not this
  // file's, exactly as the header says of the widget restart.
  const [fullscreen, setFullscreen] = useState(false);
  const onToggleFullscreen = useCallback(() => setFullscreen((on) => !on), []);

  // Escape leaves fullscreen, and takes the key with it. CAPTURE phase and `stopPropagation`: the
  // card covers the viewport, so nothing BEHIND it — the transcript's own turn-abort Escape, a menu —
  // should act on the same press. A modal dialog is the exception, because it is not behind: the card
  // sits under the dialog layer (`z-[45]` under `z-50`), so a dialog opened over a fullscreen card is
  // in front of it and the press is the dialog's — and so is a panel that owns the key, a menu or a
  // Select opened on top of it. It is asked for rather than out-raced — see `otherOverlayHoldsEscape`. The listener exists only while fullscreen is on, so an ordinary card never
  // touches the key at all.
  useEffect(() => {
    if (!fullscreen) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || otherOverlayHoldsEscape()) return;
      event.stopPropagation();
      setFullscreen(false);
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [fullscreen]);

  if (!mounted || streaming) {
    return <pre className={FALLBACK_CLASSES}>{code.trim()}</pre>;
  }

  // The fork sits BEHIND both gates, and that is the whole reason it is in this file rather than
  // in `CodeBlock`. Forking upstream would put it in front of them: the HTML transcript export
  // runs no effects, so it would carry a live `<iframe>` into a saved file, and a docspace fence
  // still being streamed would mount — and start fetching — on a body that is a fragment. Behind
  // the gates, every kind inherits the same two promises the HTML widget already makes. The caller's
  // `frame` is applied behind both gates too, which is why it is a function passed in rather than a
  // wrapper the caller draws: a wrapper would have to be written in front of them.

  // The switch every framed kind wears, spelled once. An UNFRAMED embed is never fullscreen: the
  // caller drew no box, so there is no box to grow and no control to toggle it with.
  const framed = Boolean(frame);
  const filling = framed && fullscreen;
  const fullscreenState = { fullscreen: filling, onToggleFullscreen };

  if (shape.kind === 'docspace') {
    // Keyed on the body for the same reason `WidgetFrameLive` is: a different body is a different
    // block, and it must arrive as a NEW element rather than as a new `src` on this one. The host
    // treats a second load on an element as a frame navigating itself away and revokes it
    // permanently, so an in-place swap would silently kill a healthy embed.
    const live = (
      <DocSpaceFrame
        key={code}
        pageId={shape.ref.pageId}
        blockId={shape.ref.blockId}
        framed={framed}
        fill={filling}
      />
    );
    return frame
      ? frame(
          {
            kind: 'docspace',
            openUrl: docspaceStudioUrl(shape.ref.pageId, shape.ref.blockId),
            title: null,
            ...fullscreenState,
          },
          live,
        )
      : live;
  }

  if (shape.kind === 'embed') {
    // Keyed on the body like the other two, and here the key is what keeps the `src` from ever
    // being reassigned in place: a changed address arrives as a new element, so the frame navigates
    // exactly once in its life and nothing the reader did inside it is thrown away by a re-render.
    const live = (
      <EmbedUrlFrame
        key={code}
        url={shape.ref.url}
        title={shape.ref.title}
        height={shape.ref.height}
        framed={framed}
        fill={filling}
      />
    );
    // `openUrl` is the address itself: an embed that refuses to be framed, or that a browser blocks
    // as mixed content, shows nothing and cannot say so — so the way out to the real page is the
    // one action this kind must always carry. See `EmbedUrlFrame`'s header.
    //
    // It is the RESOLVED address, not the written one, and for exactly the reason the frame's `src`
    // is: this link is followed by the reader's own browser. Handing a phone `http://127.0.0.1:8005`
    // opens a tab that fails the same silent way the frame would have — and this link is the thing
    // that was supposed to rescue them from that.
    return frame
      ? frame({ kind: 'embed', openUrl: resolveEmbedUrl(shape.ref.url), title: shape.ref.title ?? null, ...fullscreenState }, live)
      : live;
  }

  if (shape.kind === 'invalid') {
    return <WidgetErrorCard reason={shape.reason} />;
  }

  // Keyed on the body, so a DIFFERENT fence body is a different widget and gets a different
  // element rather than having its `srcdoc` reassigned in place. That is not a preference; it is
  // what makes the host's revoke rule sound. `useWidgetHost` treats a second `load` on the element
  // as proof the widget navigated itself away, and an in-place `srcdoc` swap ALSO fires a second
  // load — measured: one load at mount, a second on reassignment. Without this key a perfectly
  // ordinary body change would revoke the frame permanently and in complete silence: no error, no
  // console line, the widget simply never receiving a theme flip or (under the live bus) any data
  // again, since revocation is by design never lifted. With it, an element loads exactly one
  // document in its life, so a second load can only be a navigation.
  const live = <WidgetFrameLive key={code} code={code} framed={framed} fill={filling} />;
  // `openUrl: null`: an HTML widget is model output composed here, not a page on another service,
  // so there is nothing outside this app to open it in. The caller reads that null as "no action".
  return frame ? frame({ kind: 'html', openUrl: null, title: null, ...fullscreenState }, live) : live;
}

/**
 * The living frame. Only ever rendered in a browser, after mount, on a settled fence body — and
 * only ever for ONE body, because its caller keys it on that body.
 */
function WidgetFrameLive({ code, framed, fill }: { code: string; framed?: boolean; fill?: boolean }) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const handlers = useWidgetBridge();
  const { height, onFrameLoad } = useWidgetHost(frameRef, handlers);

  // Built once, and deliberately not per theme: assigning a new srcdoc is a reload, so a theme
  // flip would restart every widget on screen and discard whatever state it had built up. The
  // theme of this instant only dresses the document; every later flip arrives as a `theme`
  // message that the bridge applies to the living one (`useWidgetHost`). `code` cannot change
  // under this instance — the caller's key guarantees it — so the memo holds for the frame's
  // whole life and this element's `srcdoc` is written exactly once.
  //
  // Both inputs are therefore read from the live document at the same instant, and dark-ness is
  // read the way the tokens are — off `<html>`, which is where ThemeProvider writes it. Taking
  // it from `useTheme()` instead would put a value in this closure that the dependency list
  // does not carry, which is the shape of a stale-render bug even when it happens to agree.
  const doc = useMemo(
    () => buildWidgetDocument({
      body: code,
      dark: document.documentElement.classList.contains('dark'),
      tokens: readVerveTokens(),
    }),
    [code],
  );

  return (
    // The border sits on a wrapper, never on the frame. Every box in this app is sized
    // border-box (`* { box-sizing: border-box }` in index.css), so a border on the iframe itself
    // comes out of `height` — the height the widget reported for its own content — and leaves
    // the viewport two pixels shorter than the document: a scrollbar for a two-pixel scroll, on
    // every widget. Measured 2026-09-10. DocSpaceFrame carries the same wrapper for the same reason.
    //
    // `framed` drops the border, the radius and the margin, and nothing else — the caller has
    // already drawn all three around this whole element. A framed embed that kept them would show
    // an embed inside a frame inside the frame.
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
        ref={frameRef}
        sandbox="allow-scripts"
        srcDoc={doc}
        title="Live widget"
        referrerPolicy="no-referrer"
        // The first load is this document; any later one means a widget navigated the frame away
        // from it, and the host must stop posting into whatever replaced it. Wired here rather
        // than from an effect so React attaches it before the srcdoc can finish loading — an
        // effect could attach after the first load and would then never see it. See useWidgetHost.
        onLoad={onFrameLoad}
        className="block w-full"
        // The widget's own reported height, except where the caller owns it — a fullscreen card — and
        // the frame fills its box. The report keeps arriving and the clamped value keeps updating
        // behind the override, so leaving fullscreen restores the height the widget last asked for.
        style={{ height: fill ? '100%' : height }}
      />
    </div>
  );
}
