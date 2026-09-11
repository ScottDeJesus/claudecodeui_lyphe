import { useEffect, useMemo, useRef, useState } from 'react';

import { buildWidgetDocument } from '@/modules/widgets/buildWidgetDocument';
import { classifyWidgetBody } from '@/modules/widgets/classifyWidgetBody';
import { DocSpaceFrame } from '@/modules/widgets/DocSpaceFrame';
import { readVerveTokens } from '@/modules/widgets/readVerveTokens';
import { WidgetErrorCard } from '@/modules/widgets/WidgetErrorCard';
import { useWidgetBridge } from '@/modules/widgets/hooks/useWidgetBridge';
import { useWidgetHost } from '@/modules/widgets/hooks/useWidgetHost';

/**
 * The raw source a widget falls back to, in the spelling `MermaidDiagram` already uses for its
 * own fallback, so the two unresolved fences in a transcript read as one thing.
 *
 * ONE CLASS OF MERMAID'S IS DELIBERATELY ABSENT, and the divergence is recorded rather than
 * quiet. The plan asks for two things that cannot both hold: its Interfaces W copies Mermaid's
 * fallback classes verbatim, which includes a `dark:bg-zinc-*` palette literal, while the phase's
 * own verification gate greps this directory for exactly that family of literals and requires
 * zero. The gate is executable and the prose is not, so the gate wins and the literal is dropped.
 *
 * BE HONEST ABOUT THE COST: this is not a no-op. `MermaidDiagram` carries BOTH `bg-muted/50` and
 * the `dark:` palette override, and the override is the one that paints in dark mode — so the two
 * fallbacks now differ there, which is the very drift "one spelling" existed to prevent. What is
 * bought is that this module names no palette literal; what is paid is that in dark mode the
 * widget fallback sits on the muted token where Mermaid's sits on its zinc override. To make them
 * one string again, lift Mermaid's off its literal — never re-add it here, which the gate rejects.
 * (The literal is not spelled out anywhere in this directory, including in prose: the gate greps
 * for the pattern and cannot tell a quoted example from a live class. Page 07 spells it.)
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
 */
export function WidgetFrame({ code, streaming }: { code: string; streaming?: boolean }) {
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

  if (!mounted || streaming) {
    return <pre className={FALLBACK_CLASSES}>{code.trim()}</pre>;
  }

  // The fork sits BEHIND both gates, and that is the whole reason it is in this file rather than
  // in `CodeBlock`. Forking upstream would put it in front of them: the HTML transcript export
  // runs no effects, so it would carry a live `<iframe>` into a saved file, and a docspace fence
  // still being streamed would mount — and start fetching — on a body that is a fragment. Behind
  // the gates, every kind inherits the same two promises the HTML widget already makes.
  if (shape.kind === 'docspace') {
    // Keyed on the body for the same reason `WidgetFrameLive` is: a different body is a different
    // block, and it must arrive as a NEW element rather than as a new `src` on this one. The host
    // treats a second load on an element as a frame navigating itself away and revokes it
    // permanently, so an in-place swap would silently kill a healthy embed.
    return <DocSpaceFrame key={code} pageId={shape.ref.pageId} blockId={shape.ref.blockId} />;
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
  return <WidgetFrameLive key={code} code={code} />;
}

/**
 * The living frame. Only ever rendered in a browser, after mount, on a settled fence body — and
 * only ever for ONE body, because its caller keys it on that body.
 */
function WidgetFrameLive({ code }: { code: string }) {
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
    <div className="my-3 overflow-hidden rounded-xl border border-border bg-card">
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
        style={{ height }}
      />
    </div>
  );
}
