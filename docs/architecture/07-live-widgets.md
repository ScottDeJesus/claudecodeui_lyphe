# Live widgets

## In one paragraph

A fenced code block whose info string is exactly `widget` renders in the chat as a live,
sandboxed HTML widget instead of as highlighted source. The fence body is model output, so it is
treated as untrusted from end to end: it never becomes raw HTML in the page, it is placed in a
whole document of its own, and that document is loaded into an iframe with an opaque origin and a
Content-Security-Policy that refuses every way of reaching the network but one — the frame may
still navigate itself away, which **The CSP** below documents as measured, along with why nothing
shipped in a browser closes it. What the widget gets in exchange is a
small message protocol — the app's design tokens copied in as values, a theme that follows the
page, an iframe that grows and shrinks with its content, and a `live.subscribe(topic, fn)` door
onto named topics. The widget names topics; it never names URLs.

The same fence has two other body shapes, and both are REFERENCES rather than documents: JSON
naming a DocSpace block, which embeds that block from ArchPulse live and editable, and JSON naming
a URL, which draws any page at all in a frame. They are not variations on the HTML widget — the
first is untrusted output that must reach nothing, the other two are real pages on origins that
are never this app's — and `classifyWidgetBody` is the one place the three are told apart. Every
one of them is drawn inside the transcript's ordinary shape card, which carries a fullscreen
switch that hands the frame the whole viewport without reloading it.

Read [the realtime stream](./02-realtime-stream.md) for how a reply arrives, and
[tool views](./06-tool-view.md) for the other way a block of model output becomes UI.

## Mental model

1. **The opt-in is the info string `widget`, and nothing else.** An `html` fence is still a code
   block. There is no attribute, no comment marker and no heuristic — one exact word.
2. **Two fences make the fence.** `sandbox="allow-scripts"` on the iframe keeps the widget off
   the app's origin; `WIDGET_CSP` inside the document closes its reach outward. Neither is
   sufficient alone: a sandboxed frame can still reach the network perfectly well, and a CSP
   alone would leave the widget same-origin with the page. Both, always — and even both together
   leave the frame able to navigate ITSELF, so the fence is a boundary with a named gap rather
   than a sealed box. **The CSP** below measures exactly where it runs.
3. **The first render is always the source.** `WidgetFrame` renders a `<pre>` until an effect has
   run. `renderToStaticMarkup` runs no effects, so the HTML transcript export
   (`buildTranscriptHtml`) can never carry a live frame into a saved file.
4. **A fence still being written is source too.** The pending half of a streaming reply is marked
   through `MarkdownStreamingContext`, so a widget appears at the moment its fence closes rather
   than being restarted on every delta.
5. **The document is built once per fence body.** A theme change is a message into the living
   frame, never a new `srcDoc` — rebuilding would reload every widget and discard its state.
6. **The host trusts a message only from that frame's `contentWindow`, and only while the frame
   still holds our document.** Identity, not origin: every sandboxed document shares the opaque
   origin `null`, so comparing origins would admit all of them. But identity alone is not enough
   either — a `contentWindow` survives the frame navigating itself away — so a second `load` on
   the element revokes the frame permanently, in both directions. **The document** below measures
   that, and why it is never re-armed. Shape is validated too, and the height a frame reports is
   clamped.
7. **Tokens are copied, not shared.** The frame cannot resolve `var(--canvas)` against the page's
   stylesheets, so the names are the contract and the values are read live and sent across.
8. **A widget names TOPICS, never endpoints.** The host owns the vocabulary; `topics.ts` is the
   only place a topic shape is admitted, and it is an allowlist of anchored patterns rather than
   a prefix test. **The live bus** below says why the difference is not stylistic.
9. **The bus knows no producer.** It retains values, dispatches them and admits topics — that is
   all it does. What fills it is a FEED, a headless component owned by the module whose data it
   carries, and the first is `RunnerFeed` in `src/modules/plan-runner/`.
10. **Three body shapes, one fence.** The info string says *widget*; the BODY says which kind. Raw
    HTML is the default and everything above describes it — an opaque-origin frame carrying a
    document this app composed inline. A body that parses as JSON naming a DocSpace block instead
    renders as a `src` frame on ArchPulse's OWN origin; a body naming a URL renders as a `src`
    frame on whatever origin that is. They are not variations on one frame: the first is untrusted
    output that must be able to reach nothing, the other two are real pages that must be able to
    reach themselves. **The DocSpace kind** and **The embed kind** below are the whole of it, and
    `isForeignOrigin` is the line all three are on the right side of.
11. **The reader can always make the frame bigger.** A declared height is a guess and a reported
    one is a request; either can be wrong, and the answer to both is the same switch. Fullscreen is
    a CLASS CHANGE on the card that is already there — never a move in the React tree, because
    reparenting an iframe reloads it and would throw away a part-typed edit. **Fullscreen** below.

## The pieces

| File | Role |
| --- | --- |
| `src/modules/widgets/index.ts` | The barrel. Exports `WidgetFrame` and nothing else |
| `src/modules/widgets/WidgetFrame.tsx` | `WidgetFrame` — the `<pre>`/iframe decision, and the optional `frame` a caller hands it — and the private `WidgetFrameLive`, which only ever renders in a browser |
| `src/modules/widgets/buildWidgetDocument.ts` | `WIDGET_CSP` and `buildWidgetDocument` — the whole HTML document a widget lives in |
| `src/modules/widgets/widgetBridgeScript.ts` | `WIDGET_BRIDGE_SCRIPT` — the in-frame script that becomes `window.live` |
| `src/modules/widgets/readVerveTokens.ts` | `WIDGET_TOKEN_NAMES` (the contract) and `readVerveTokens` (the live read) |
| `src/modules/widgets/hooks/useWidgetHost.ts` | `useWidgetHost` — the page's half: one message listener, the height, the theme post, and the `load` counter that revokes a frame which navigated itself away |
| `src/modules/widgets/hooks/useWidgetBridge.ts` | `useWidgetBridge` — one frame's subscriptions: the two refusals, the per-frame cap, and the unmount sweep |
| `src/modules/widgets/classifyWidgetBody.ts` | `DOCSPACE_ID_RE` and `classifyWidgetBody` — which KIND a settled fence body is. The raw path is the default |
| `src/modules/widgets/EmbedUrlFrame.tsx` | `EMBED_SANDBOX`, `EMBED_MIN_HEIGHT` / `EMBED_MAX_HEIGHT` / `EMBED_DEFAULT_HEIGHT` and `EmbedUrlFrame` — the third frame: any address, the origin gate, a DECLARED height, and no protocol at all |
| `src/modules/chat/embeds/collectEmbedTargets.ts` | `collectEmbedTargets` — every embed a chat has declared, read out of its own messages through the one classifier |
| `src/modules/chat/embeds/embedSource.ts` | `publishEmbedSource`, `useChatEmbedTargets`, `useEmbedWidgetState` — the chat's list, published for the widget that draws it, and whether it has arrived at all |
| `src/modules/chat/embeds/EmbedWidgetBody.tsx` | `EmbedWidgetBody` — the gutter widget: the follow latch, the one-row dropdown (house presets, the chat's addresses, `Type an address…`), the way out, and `EmbedUrlFrame` filling the card |
| `src/modules/chat-gutters/GutterWidgetFrame.tsx` | The gutter card, and its `fullscreen` / `onToggleFullscreen` / `flush` / `headerAction` props |
| `src/modules/widgets/embedUrl.ts` | `isLoopbackHost` and `resolveEmbedUrl` — a loopback address moved onto the host that reached this page, because an `src` is resolved by the reader's browser |
| `src/modules/widgets/docspaceOrigin.ts` | `DOCSPACE_EMBED_DEFAULT_PORT`, `resolveDocSpaceOrigin`, `docspaceEmbedUrl`, `docspaceStudioUrl`, and `isForeignOrigin` — the gate on `allow-same-origin` |
| `src/modules/widgets/DocSpaceFrame.tsx` | `DOCSPACE_SANDBOX`, `DOCSPACE_READY_TIMEOUT_MS` and `DocSpaceFrame` — the second frame: a `src` on ArchPulse's origin, the latched theme, the ready timer, and the `framed` prop that drops its own border where a card already draws one |
| `src/modules/widgets/WidgetErrorCard.tsx` | `WidgetErrorCard` — the two-sentence card shown where a widget was asked for and cannot be drawn |
| `src/modules/live-bus/topics.ts` | `LIVE_TOPIC_ALLOWLIST`, `isAllowedTopic`, `RUNNER_ALL_TOPIC`, `SOULS_ALL_TOPIC`, `UNIVERSE_ALL_TOPIC`, `runnerTopic` — the whole vocabulary |
| `src/modules/live-bus/context/LiveBusContext.tsx` | `LiveBusProvider` and `useLiveBus` — the retained values, the listener registry, `publish`/`subscribe`/`get` |
| `src/modules/live-bus/hooks/useLiveTopic.ts` | `useLiveTopic` — the module's ONE render trigger, for a React component reading a topic |
| `src/modules/live-bus/index.ts` | The barrel. The provider, the bus hook, `useLiveTopic`, and the vocabulary |
| `src/modules/chat/transcript/shapes/code/index.tsx` | `CodeBlock` — the `code` override's routing decision, and the widget branch inside it, which hands `EmbedFrame` down as `WidgetFrame`'s `frame` |
| `src/modules/chat/transcript/shapes/code/EmbedFrame.tsx` | `EmbedFrame` — the card a LIVE embed wears: the one `ShapeFrame` header every shape draws (flush), the way out (`Open in ArchPulse` for a block, `Open page` for an embed), and the fullscreen switch. It imports nothing from this module |
| `src/modules/chat/transcript/shapes/ShapeFrame.tsx` | The card itself, and its `fullscreen` prop — the fixed panel at `z-[45]`, the flex chain that lets a frame fill it, the forced-open fold and the `data-owns-escape` claim |
| `src/modules/chat/transcript/shapes/markdownStreaming.ts` | `MarkdownStreamingContext`, in its own module. `CodeBlock` is the last consumer left in the tree |
| `src/modules/chat/transcript/Markdown.tsx` | Provides that context around its `ReactMarkdown`, and names `CodeBlock` as the `code` override in both component maps |
| `src/modules/chat/transcript/StreamingMarkdown.tsx` | Marks the pending half streaming; the settled half is untouched |
| `src/shared/types.ts` | `WidgetFrameMessage`, `WidgetHostMessage`, `WidgetHostHandlers`, `DocSpaceBlockRef`, `EmbedUrlRef`, `WidgetBodyShape`, `WidgetEmbed`, `WidgetEmbedFramer`, `LiveTopic`, `LiveValue`, `LiveBus`, under `LIVE WIDGETS` |
| `.verify/phase-22.mjs` | The fence probe: the sandbox, the opaque origin, the CSP refusal, height, theme, streaming, export, and the revoke rule from both sides |
| `.verify/phase-24.mjs` | The bus probe: a stage written to disk read back inside a sandboxed widget, both refusals, the cap, the unmount sweep, the REST seed and the retirement |
| `.verify/phase-28.mjs` | The kind probe: the exact sandbox, the foreign origin, the error card, the raw path left alone, the streaming gate, the exports, and that a theme flip never rewrites `src` |
| `.verify/phase-29.mjs` | The end-to-end probe, and the only one in this repo that needs ArchPulse up: a real block embedded, edited from inside the frame, that edit read back in ArchPulse's own studio, plus the theme flip on a LIVING frame, the height, and the not-found card |

## The fence

`CodeBlock`, the `code` override in `shapes/code/index.tsx`, reads the info string off the
`language-*` class react-markdown puts on the `code` element. The widget branch matches the WHOLE
word, not the `\w+` capture the label and the highlighter use: `\w` stops at a hyphen, so a
`widget-config` fence would otherwise read as `widget` and mount a live scripted frame for an
ordinary documentation label. It is the first language decision `CodeBlock` makes — mermaid,
`stats` and `diff` are `CodeFence`'s to decide, after it:

````
```widget
<div style="padding:16px;background:var(--surface);color:var(--ink)">hello</div>
```
````

renders `<WidgetFrame code={raw} streaming={streaming} frame={(embed, live) => <EmbedFrame {...embed} code={raw}>{live}</EmbedFrame>} />`.
`streaming` comes from
`MarkdownStreamingContext`, a context defaulting to `false` which `MarkdownBodyRenderer` provides
around its `ReactMarkdown`. It sits in a module of its own, `shapes/markdownStreaming.ts`, for a
mechanical reason: `Markdown.tsx` imports `CodeBlock` and `CodeBlock` reads the context, so
leaving the context in `Markdown.tsx` would be an import cycle. `CodeBlock` is also its ONLY
consumer — the streaming fallback for every other element is decided once, upstream, by which
component map `MarkdownBodyRenderer` hands `ReactMarkdown`, so nothing downstream has a streaming
rule left to forget. The fence shapes are where the flag travels one step further: `CodeBlock`
passes it to `CodeFence` (`shapes/code/CodeFence.tsx`) as a plain prop, and `CodeFence` returns the
ordinary highlighted block for any streaming fence before it tries a single shape — mermaid
included, so a half-arrived diagram is never handed to the parser. Only `StreamingMarkdown` sets it, and only on the pending half —
`splitStreamingMarkdown` keeps an open fence and everything after it in `pending`, and a finished
message never carries the flag at all.

The consequence worth holding on to: a widget fence renders as source in three situations — while
the reply is still being written, in an exported document, and for one tick whenever the streaming
split boundary RETRACTS back over an already-live widget — and as a live frame everywhere else.

**`frame` dresses the live frame, and it is a function rather than a wrapper.** Both live kinds —
the HTML widget and the DocSpace block — are handed to a caller's `frame` together with a
`WidgetEmbed` saying which kind it is and, for a DocSpace block, the studio link that block's own
`docspaceStudioUrl` resolves. The chat passes `EmbedFrame`, so an embed wears the same titled card
the rest of the transcript wears. It is a function because a wrapper the CALLER drew would sit
in front of this file's two gates: the export runs no effects, and a streaming fence's body is a
fragment still growing on every delta. `frame` is therefore called from BEHIND both of them, and
the `<pre>` and the error card are never passed to it at all — an exported or still-streaming fence
stays raw source with no header over it, which is also what the invalid body draws. The element the
framer is given is the same keyed one it would have been without a framer: `key={code}` stays on
the inner `<DocSpaceFrame>`/`<WidgetFrameLive>`, because that key is what makes the host's revoke
rule sound (below), and a key belongs to the element whose load count it resets rather than to
whatever wraps it.

That third one is worth stating plainly, because it is a restart and not a repaint.
`StreamingMarkdown` renders two fixed sibling slots, settled and pending, and recomputes the
boundary on every delta; an already-settled block returns to the pending half whenever the text
after it makes the old split unsafe, which its own doc comment measures at about a third of
replies, once. A block crossing between the two slots changes parent, so React unmounts the
`WidgetFrame` and mounts a fresh one — the widget reloads and loses whatever state it had built.
Measured, not inferred: driving a real retraction over a live widget leaves zero iframes and one
`<pre>`. No state local to `WidgetFrame` can survive it, so gating the frame on a latched fence
body rather than on the `streaming` flag does not help; that was tried, and it only moved the
restart. Curing it means keeping the block in ONE slot across the boundary, which is a change to
`StreamingMarkdown`'s shape, not to anything in this module.

## The document

`buildWidgetDocument({ body, dark, tokens })` returns a complete HTML document, in this order:
doctype, `<html>` (carrying `class="dark"` when the page is dark), charset and viewport metas,
the CSP meta, a `<style>` block, the bridge script, then `<body>` holding the fence body verbatim.

**The sandbox.** `WidgetFrame` renders the iframe with `sandbox="allow-scripts"` and no other
token, plus `referrerPolicy="no-referrer"` and no `src`. The document arrives through `srcDoc`.
`allow-same-origin` is never added — the login JWT lives in `localStorage` under `auth-token`
(`src/shared/authToken.ts`), and a same-origin frame could read it. Nor `allow-forms`,
`allow-popups`, `allow-top-navigation` or `allow-modals`. The server sets no CSP and no frame
headers of its own, so this attribute is the whole fence on that side. Note what withholding
`allow-top-navigation` does and does not buy: it stops the widget navigating the TAB, not the
widget navigating its own frame, which a sandboxed context may always do.

**Self-navigation, and why the host stops talking.** Because a widget can always navigate its own
frame, `contentWindow` identity is not by itself proof that the widget document is still there —
the window object is REUSED across a navigation. Without more, a widget could subscribe to a
topic, move the frame to a page it controls, and go on receiving everything the host pushes,
because `postMessage` to an opaque origin must use `'*'` and so has no origin to refuse. So
`useWidgetHost` counts `load` events on the element: the first is our `srcDoc`, and any later one
revokes the frame permanently — nothing is posted into it again, and nothing from it is listened
to again. The revocation is never lifted, because a navigated document can forge a `ready` as
easily as ours can send one; arming on `ready` would hand the channel straight back. This does not
make a hostile widget safe — one that navigates away carries whatever it already had in the URL it
leaves by, and no shipped control closes that — it closes the CONTINUING channel, which is the
part that is closable.

That count is only trustworthy because the element loads exactly one document in its life, and
that is structural rather than conventional: `WidgetFrame` keys `WidgetFrameLive` on the fence
body, so a CHANGED body arrives as a new element instead of as a fresh `srcDoc` on the old one.
The distinction matters because an in-place `srcDoc` reassignment fires a second `load` that is
indistinguishable from a navigation — measured: one load at mount, a second on reassignment. Were
the two conflated, an ordinary body change would revoke a healthy widget permanently and in
silence: no error, no console line, just a widget that never sees another theme flip or another
datum, since revocation is never lifted. Gate 9c holds the key in place by rebuilding a widget's
body and requiring the host to still answer it. Do not remove the key without removing the
counter; each is the other's premise.

**The CSP.** `WIDGET_CSP` is `default-src 'none'` with `script-src` and `style-src` opened to
`'unsafe-inline'` (the widget's own markup is inline by definition), `img-src` and `font-src`
limited to `data:`, and `connect-src`, `form-action` and `base-uri` at `'none'`. The meta stands
before every style and script and above all before the body: a policy declared after the content
it governs arrives too late to govern it.

Where that policy actually runs was measured, not reasoned about — twelve egress vectors driven
through a real frame carrying exactly it:

| Refused | Escapes |
| --- | --- |
| `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `sendBeacon`, `<img>`, `<script>`, `<link rel=stylesheet>`, a nested `<iframe>`, a form submit, `window.open` | `location.href = …` — the frame navigating ITSELF, the request carrying whatever the widget wrote into the URL |

The exception is the platform, not a gap to patch in `WIDGET_CSP`. `connect-src` never governed
navigation; `navigate-to` was never shipped, and Chromium answers it `Unrecognized
Content-Security-Policy directive`; `frame-src` governs neither document's self-navigation, on
the parent or inside the frame; and sandboxing has never prevented a context navigating itself.
Adding a directive in the belief that it closes this makes the docs wrong again — measure first.

Two things bound the damage. The frame holds nothing of ours to spend — opaque origin, no
storage, no parent DOM — so a widget can leak only what the host POSTED to it, which is what
makes the topic allowlist the real control on exfiltration rather than a formality — see **The
live bus**. And a nested frame is refused, so the exit cannot be taken quietly: the widget has
to navigate itself away to use it, and a widget that vanishes is one the reader watches vanish.

**The tokens.** `readVerveTokens()` resolves every name in `WIDGET_TOKEN_NAMES` against
`document.documentElement` and omits any that resolve to nothing, so a widget's own
`var(--x, fallback)` still gets its fallback. The values are interpolated into the `<style>`
block only, declared on `:root`, alongside a reset that gives the body `var(--canvas)`,
`var(--ink)`, `var(--font-body)` and `display:flow-root` — the last so a first or last child's
margin stays inside the body box the bridge measures, instead of collapsing through it into a
few pixels the frame cannot show. The fence body is never interpolated into a script, an
attribute or the CSP.

**The theme.** The document's opening theme is read off the `dark` class on `<html>` at build
time, the same instant and the same source the tokens come from. Every change after that is a
`theme` message: `useWidgetHost` posts one when the frame says `ready` and again whenever
`useTheme().isDarkMode` changes, and the bridge toggles the `dark` class and calls
`style.setProperty` for each token on the frame's own document element.

That repost reads the tokens off `<html>` inside an ordinary effect, so it depends on the page
having switched already. ThemeProvider (`src/shared/context/ThemeContext.tsx`) guarantees it by
putting `dark` on `<html>` in a LAYOUT effect, which runs before every ordinary (passive) effect of
the same update. A plain effect there would run after the widget host's, because React runs a
child's effects before its parent's, and every live flip would send the new `dark` flag with the
old theme's colours — measured on the living frame: 89 of 89 colour readings stale after a flip
to dark with the plain effect, 0 with the layout effect (`/tmp/widget-theme-probe.mjs` shape: flip
through the app's own switch, no reload, diff against a fresh dark load). Any other reader of the
computed tokens gets the same guarantee only from an ordinary effect; one in its own layout effect,
or at render time, would still read the old theme.

## The bridge protocol

Both directions use `postMessage` with a target origin of `'*'`, because an opaque origin has no
name to address. Safety comes from identity instead: the frame acts only on messages whose
`event.source` is `window.parent`, and the host only on messages whose `event.source` is that
frame's `contentWindow`.

### Frame → host (`WidgetFrameMessage`)

| `type` | Payload | Meaning |
| --- | --- | --- |
| `ready` | — | The bridge has parsed. The host answers with the current theme. |
| `resize` | `height` | The body's measured height, coalesced through `requestAnimationFrame`. Clamped by the host to `[24, 2000]`; a non-finite value is refused outright. |
| `subscribe` | `topic` | Sent on the FIRST subscriber of a topic. Answered by the live bus: data, or one of the two refusals. |
| `unsubscribe` | `topic` | Sent when the LAST subscriber of a topic leaves. |

### Host → frame (`WidgetHostMessage`)

| `type` | Payload | Meaning |
| --- | --- | --- |
| `theme` | `dark`, `tokens` | Applied in place — the `dark` class plus one `setProperty` per token. Never a new document. |
| `error` | `topic`, `reason` | `topic not allowed` or `too many subscriptions`. A refusal, deliberately, rather than a silence a widget could not tell from a slow producer. |
| `data` | `topic`, `payload`, `at` | The retained value and every change after it, unwrapped from the bus's `LiveValue` into this shape. |

Inside the frame this surfaces as `window.live`: `live.subscribe(topic, fn, onError)` returning an
unsubscribe function, `live.theme` holding the last `{ dark, tokens }`, and `live.onTheme(fn)`.

**There are two retentions, and their lifetimes differ on purpose.** Inside the frame, the bridge
script keeps a topic's last message only while that topic has a live subscription: a `data` or
`error` for a topic no callback holds is dropped rather than stored, because only the last
unsubscribe of a topic clears its entry and a topic never subscribed has no unsubscribe coming — so
an in-frame replay can never predate the subscription it answers. On the page, the bus retains a
topic's value whether or not anyone is listening, which is the entire point: it is what lets a
widget mounted ten minutes into a run start with a picture instead of a blank box.

## The DocSpace kind

The second body shape. A `widget` fence whose body is exactly JSON of this shape embeds one
DocSpace block from ArchPulse, live and editable in place:

```json
{ "kind": "docspace", "pageId": "<id>", "blockId": "<id>" }
```

`classifyWidgetBody` decides, and it decides conservatively. A body that does not start with `{`,
one that fails to parse, and one whose `kind` is anything else are all `html` — so **the raw path
is the default and nothing that renders today can change**. A body that merely CONTAINS the word
docspace is HTML too; the test is the parsed `kind` field, never a substring. Only a body that
says `kind: "docspace"` and then names ids that cannot be embedded is `invalid`, and that one
draws `WidgetErrorCard` rather than falling back, because a block of JSON painted at the reader
with no explanation is worse than a sentence saying what is wrong. Both ids must match
`DOCSPACE_ID_RE`, an allowlist of letters, digits, dot, underscore, colon and hyphen that may not
LEAD with a dot — which refuses `../x` and `a/b` without either being named as a special case.
`DOCSPACE_ID_RE` is deliberately the same pattern as `LINK_ID_RE` in ArchPulse's own
`src/data/links.ts` — the one its embed route exports as `EMBED_ID_RE` and its deep links are
held to — so an id one side accepts is an id the other accepts.

**The origin is the invariant, and it is not the same invariant as the HTML widget's.**
`resolveDocSpaceOrigin` returns `VITE_DOCSPACE_EMBED_ORIGIN` when it is set AND is an absolute
`http:`/`https:` URL, and otherwise the page's own hostname on port 8005 — right on the LAN and
over Tailscale alike, because both services live on one box and whatever name reached CloudCLI
reaches ArchPulse. The scheme is checked THERE rather than at the origin gate below, because a
scheme with no host (`javascript:`, `data:`, `blob:`) has the opaque origin `"null"`, which is
truthfully not this app's origin and so passes a foreign-ness test while being exactly the URL
that should never reach a frame. A value that fails the check falls back to the default and is
`console.warn`ed naming the value: a silently ignored setting is its own bug, because the timeout
card would then name the DERIVED origin — a host the operator never typed — and point the
investigation away from the setting that was dropped. Whatever it returns, `isForeignOrigin` is
consulted BEFORE the iframe is rendered: if the resolved URL lands
on this app's own origin, `DocSpaceFrame` draws the error card and no frame at all. Origins are
compared, never hostnames — CloudCLI and ArchPulse share a hostname here and differ only by port,
so a hostname test would refuse the normal case. A URL that will not parse is treated as NOT
foreign, so an address nobody can reason about is never embedded.

That gate is what makes `DOCSPACE_SANDBOX` safe. It is `allow-scripts allow-same-origin
allow-forms`, and the extra two tokens next to the HTML widget's lone `allow-scripts` are not a
relaxation of the same rule — they answer a different question. `allow-same-origin` does not give
the frame OUR origin; it lets the frame keep the origin of the document it loads, which for a
DocSpace page is `http://<host>:8005`. The block needs it to reach its own API and save what the
reader typed; forced onto an opaque origin the embed would be a picture of a block. What must
hold is only that the origin is not CloudCLI's, because CloudCLI's login JWT sits in
`localStorage['auth-token']` (`src/shared/authToken.ts`) and a frame on this origin reads it as
easily as the page does. **Never proxy port 8005 through this app's Express or Vite** to reach a
phone: proxying is precisely how the frame becomes same-origin. The phone reaches ArchPulse
directly. `allow-forms` is there because a block's inputs are how it is edited; nothing else is
granted, and the absence of `allow-modals` is why the embed answers a delete with its own inline
confirm strip rather than a browser dialog, which a frame without that token answers `false` in
silence.

**The frame also carries `allow="fullscreen"`, a Permissions-Policy grant and not a fourth
SANDBOX token.** A canvas block's own Full Screen control calls the browser's Fullscreen API from
inside this document; without the grant the call is refused and `useElementFullscreen` falls back
to its CSS overlay instead, same as any other host that withholds it
(`~/.claude/ArchPulse/README.md` §"Embedding one block"). Gate 1 of
`.verify/probe-docspace-canvas.mjs` reads `allow` off the rendered element alongside the three
sandbox tokens, so a change that drops either reddens the same gate.

**A canvas block opens in READ in this frame** — pan locked, its Read/Edit switch the way into
Edit. The mode is the block's own default on every surface, so nothing here asks whether it is
framed; the hooks that mode rides on are the README's (§"Embedding one block"), not this file's,
and `.verify/probe-docspace-canvas.mjs` reads them from inside the frame.

**A frame that never answers is a fault the reader cannot see**, so `DocSpaceFrame` arms a timer
for `DOCSPACE_READY_TIMEOUT_MS` at mount and replaces the iframe with `WidgetErrorCard` naming the
origin if no `ready` arrives. The timer is cleared two ways — by the `ready` the host accepts, and
by the effect's cleanup on unmount, which is what stops it setting state on a component that is
gone. ArchPulse down, restarted mid-read, or simply not at the resolved origin all land there
instead of on an iframe that looks identical to one still loading.

**The theme travels as a message, never as a `src`.** The URL's `?theme=` describes the FIRST
paint only: `DocSpaceFrame` latches the mount-time value in a ref and memoises the URL on the ids
alone, so a flip cannot rewrite `src`. It must not, because a new `src` is a navigation — the
frame reloads and whatever the reader had typed into the block is gone. Later flips reach the
document through the host's ordinary `theme` post; the embed reads `dark` and ignores `tokens`,
since it has a stylesheet of its own.

What crosses this frame's boundary is deliberately thin. The embed posts `ready` and `resize`, and
that is all: `DocSpaceFrame` passes no `onSubscribe`/`onUnsubscribe`, so a `subscribe` from it is
answered `topic not allowed` exactly as it is for any widget with no bridge. **No topics reach a
DocSpace block** — it has its own server to ask.

**A framed block offers the way out to the studio.** `docspaceStudioUrl(pageId, blockId)` returns
`<origin>/#page=<pageId>&block=<blockId>` on the origin `resolveDocSpaceOrigin` already resolved —
ArchPulse's own studio deep link, which is why the link and the frame beside it can never point at
two different hosts. `WidgetFrame` builds it from the SAME classified, id-checked ref the frame was
built from, and only for a LIVE block: `EmbedFrame` draws it as an `a[data-docspace-open]` with
`target="_blank"` and `rel="noopener noreferrer"`, so the studio opens in a new tab on ArchPulse's
origin and receives neither this window's handle nor this page's referrer. It points at the studio
and never at the embed route; port 8005 is never proxied through this app. The HTML widget has no
such link and gets no action at all — `openUrl` is `null` there, because a widget is model output
this app composed rather than a page another service owns. (An embed's `openUrl` is its own address;
see the next section, where the link is not a convenience but the reader's only recourse.)

**A framed block drops its OWN border, and nothing else.** `DocSpaceFrame` and `WidgetFrameLive`
each draw their own `my-3 rounded-xl border` wrapper when they stand alone, because a border on the
iframe itself would be taken out of the height the embed reported (border-box sizing) and leave a
two-pixel scrollbar. Inside a card that border is the card's, so `WidgetFrame` passes
`framed={Boolean(frame)}` and the wrapper keeps only the clipping and the fill. The sandbox, the
`src`, the ready timer and `key={code}` are unchanged either way.

**The embed probes are not the unframed path.** `phase-22`, `phase-28` and `phase-29` mount through
`MarkdownBody`, the app's own transcript renderer, so `CodeBlock` hands them `EmbedFrame` exactly as
a real reply would, and their shots (2026-09-15) carry the card header. The unframed branch —
`WidgetFrame` called with no `frame` at all — is therefore a real path with no probe on it yet; it
stays for any caller that renders this component directly, outside markdown.

**Folding a framed embed is safe.** The card's `CollapsibleContent` is a `grid-rows-[0fr]` track
and never an unmount, so shutting a DocSpace card leaves its iframe connected with its `src`
untouched: no reload, and nothing the reader typed into the block is discarded.

**"Editable in place" is a claim about two surfaces, and it is measured as one.**
`.verify/phase-29.mjs` stands a real page up in the DocSpace store, embeds one of its blocks in a
transcript here, edits it from inside the frame, and watches that edit arrive in a SECOND browser
showing the same block in ArchPulse's own studio — the round trip, rather than either end of it.
It is the one probe in this repo that needs `archpulse.service` up; the gates it reads, the
title-prefixed fixture it creates and deletes, and what an ArchPulse restart mid-run looks like are
in [verification.md](../verification.md) §"The browser harness" and §"What bites people". The other
half of this contract — the embed route, the block types that behave differently there, the
`resize` height being the body's border box rather than the document's `scrollHeight` — is
`~/.claude/ArchPulse/README.md` §"Embedding one block", which points back here for this half.

## The embed kind

The third body shape, and the one the app knows least about. A `widget` fence whose body is JSON of
this shape draws that address in a frame inside the card:

```json
{ "kind": "embed", "url": "http://10.0.0.5:8005/", "title": "ArchPulse — DocSpace hub", "height": 420 }
```

`url` is the only required field. `title` becomes the card's heading and the frame's accessible
name — worth setting, because "Embed" tells a reader nothing and only the writer knows the page is
a Grafana panel. `height` is the drawn height in CSS pixels: default `EMBED_DEFAULT_HEIGHT` (420),
clamped between `EMBED_MIN_HEIGHT` (120) and `EMBED_MAX_HEIGHT` (2000). A `height` that is not a
finite positive number is DROPPED rather than refused — a cosmetic mistake should not cost the
reader the page — while a `url` that is not an absolute `http:`/`https:` address, or is longer
than 2048 characters, makes the whole body `invalid` and draws `WidgetErrorCard`. The scheme is
checked by PARSING (`new URL`), never by matching a prefix, because `javascript:`, `data:` and
`blob:` are exactly what must never reach an `src` and a prefix test is defeated by case and
whitespace. That parse needs no `window`, which is what lets `classifyWidgetBody` keep running
inside the HTML transcript export where there is none.

**A loopback address is corrected, not warned about.** An `src` is resolved by the READER'S
browser. A model writing a reply runs on this box, where `http://127.0.0.1:8005` is ArchPulse; the
same string in a frame on a phone over the VPN is the PHONE'S port 8005, which is nothing, and it
fails in the one mode nothing here can detect. `resolveEmbedUrl` (`embedUrl.ts`) therefore moves a
loopback host onto whatever hostname reached this page — the same trick `resolveDocSpaceOrigin`
plays, for the same reason — leaving the scheme, port, path and query alone. The one exception is a
reader who is themself on loopback, where the address already means what it says. A non-loopback
host is never second-guessed. The address the model SHOULD write is `CLOUDCLI_PUBLIC_HOST`, when
the operator has set one — the surface prompt names it verbatim (`use this host's address <host>
for anything running here`); unset, the prompt instead tells the model to use whatever LAN or VPN
address (or hostname) this host is reached on, since none is named. Either way the rewrite above is
the net under that, not a substitute for it.

**The origin gate is the DocSpace kind's, unchanged.** `EMBED_SANDBOX` is the same
`allow-scripts allow-same-origin allow-forms`, for the same reason and under the same condition:
the frame keeps the origin of the document it loads, which is safe exactly while that document is
not CloudCLI's — a same-origin frame reads `localStorage['auth-token']`. `isForeignOrigin` is
consulted in `EmbedUrlFrame` before the iframe is rendered, and an address on this app's own origin
draws an error card and no frame. It is asked THERE and not in the classifier because it is the one
question that needs the live page to answer it. `allow-popups` and `allow-top-navigation` are
withheld: an embed may not spray windows over the operator's browser, and may not steer the tab it
sits in away from the chat. The one grant made through `allow` is `fullscreen`, so an embedded
video's own control keeps working — a different mechanism from the card's switch, which never
touches the frame. The same grant reaches a whole ArchPulse page framed here: its canvas blocks
open in **Read**, pan locked, and the `fullscreen` grant is what lets one of their Full Screen
controls call the real API rather than fall back to the CSS overlay (§"The DocSpace kind";
`~/.claude/ArchPulse/README.md` §"Embedding one block" for the block).

**The height is DECLARED, not reported, and it has to be.** A page that never heard of this app
will never post `resize`, so `useWidgetHost`'s protocol has nothing to say here and the frame would
otherwise sit at the host's 24-pixel floor, reading as a thin empty line rather than as a fault.
The fence body carries the number instead. This is also why the kind mounts no host at all: there
is no `ready` to wait for, no theme to post, and no topic to answer.

**Two silent failures, one answer.** An address that refuses to be framed — `X-Frame-Options`,
`frame-ancestors`, which is most of the public web — still fires `load` on the element, and the
document is cross-origin, so nothing in this page can tell a refusal from a blank page from a
perfectly rendered one. A `http://` address inside a page served over `https://` is blocked by the
browser before the element sees anything, for the same undetectable-from-here reason. So there is
deliberately NO ready timeout on this kind: a timer would be a coin toss dressed as a diagnosis.
What the card carries instead is the address itself as an `a[data-embed-open]` `Open page` link,
which is why `openUrl` on this kind is not a convenience — it is the reader's only recourse when
the frame shows nothing.

`EmbedUrlFrame` is keyed on the fence body by `WidgetFrame`, exactly like its two neighbours, so a
changed address arrives as a NEW element rather than as a reassigned `src`: the frame navigates
once in its life and a re-render can never throw away what the reader did inside it.

## The Embed widget

The same address, in the gutter beside the transcript rather than inline in it — the fourth chat
gutter widget, next to Runs, Memory and Subagents.

**Why a widget and not only a card.** An inline card is part of the reply: it scrolls away with the
message that declared it, and it is as wide as the transcript column. A page the reader is *working
against* — a board they are moving cards on, a dashboard they are watching while the model talks —
wants to stay put and to be as big as they like. So the same declaration feeds both: the card is the
receipt in the conversation, the widget is the place the page lives.

**The chat publishes, the widget reads.** `ChatInterface` derives the addresses with
`collectEmbedTargets` over its own messages and publishes them through `embeds/embedSource.ts`,
tagged with its app session id; `EmbedWidgetBody` asks for one id and is handed nothing for any
other. It is the same shape, in the same place, as the Subagents widget's `subagentSource` — and for
the same reason: the messages live in a `useRef` store private to `ChatInterface`.

**The derivation is over the MESSAGES, never the DOM.** The obvious channel — have the inline card
register itself as it mounts — is wrong: the transcript unmounts rows that scroll far from the
viewport, so the widget's list would grow and shrink with the reader's scrollbar and a fence nobody
had scrolled to would not exist. Fences are found by the SAME parser that renders them —
`unified` + `remark-parse` + `remark-gfm`, reading `code` nodes whose `lang` is exactly `widget` —
behind a cheap pre-filter that must stay LOOSER than the parser (backtick or tilde, spaces or tabs
allowed before the word, because CommonMark trims the info string — a tighter hint drops a
declaration the transcript draws, in silence). A second parser — a line-anchored regex, say — can
only agree with the first by accident: it misses a fence in a list item, a blockquote or an indented
block, which then draws its card and never reaches the widget. Each body then goes through
`classifyWidgetBody` — the one classifier — so the widget can never list an address the card would
have refused. Only the model's own replies declare, and that is asked of `isProseReply`
(`chat/utils/toolGrouping.ts`), the app's one answer to "is this the model's reply": a user's paste, a
tool's output, a thinking row, a task notification and the synthetic placeholder never steer the
frame. Addresses collapse on the URL and stand where they were LAST named, so re-declaring one brings
it back to the front; the list is capped at 12. Each message's addresses are cached by its text, so a
streaming turn re-parses only the reply being written — parsing every fence-bearing reply on every
100ms flush cost 66ms for a 300-message chat.

**The newest declaration wins, and a reader's choice survives until there is a newer one.** A widget
that ignored new declarations would make the fence useless; one that discarded the reader's pick on
every render would snatch a page away mid-read. The follow is latched: a CHANGE in the newest
address adopts it, and until then whatever the reader chose stands. A newly named address also
OPENS the widget, once — and the trigger is precise because each looser one fought the reader: the
NEWEST address changing (a count grows when older history loads), within ONE chat (the layout stays
mounted across a switch, and comparing two chats re-opened a widget the reader had shut, writing it
open to the server), after that chat's list has ARRIVED (`useEmbedWidgetState().known` — the arriving
chat publishes a commit after the layout re-renders, and without it a whole history reads as new).

**It is also a generic viewer, and it opens on a dropdown.** The row is a dropdown that is there
before any chat has said anything: the house's own services first — ArchPulse, whose address comes
from `resolveDocSpaceOrigin` (the same answer the DocSpace embed uses, so it is the page's own
Tailscale host, or `VITE_DOCSPACE_EMBED_ORIGIN` when set) — then every address this chat declared,
deduplicated on the URL with the chat's entry winning (it carries the model's title), then a last
entry, `Type an address…`, that swaps the row to a field. A typed value is validated by building the
fence body it is equivalent to and handing it to the same classifier; a value with no scheme is
retried once as `http://`, because someone typing `myhost:8005` means a host. The row is ONE row
with two modes because two rows of chrome took 92px of a 242px card, measured, in a 300px column.

**A flush card takes the column's spare height.** `GutterWidgetFrame` grew two props for this:
`flush`, which gives a body that is itself a frame the card's whole inside (no padding, no scroll
area — a live iframe scrolls itself), and the `flex-1` that goes with it, because a frame asking for
`height: 100%` has no intrinsic height to grow its card with and sat at the 9rem floor with the page
peeking through a slot. It KEEPS a floor while it grows — a taller one, 16rem or 45% of the column —
because growth and a floor do not conflict and dropping the floor (`min-h-0`) let a taller neighbour
crush the card to 2px, header and switches clipped out of reach, with nothing left to reopen it
(Athena's review, memory 658 / embed 2 in a 700px column). The other three widgets stay
content-sized.


## Fullscreen

Every LIVE embed — an HTML widget, a DocSpace block and a URL embed alike — wears a switch in its
card header that gives it the whole viewport, and so does every chat gutter widget. `Escape` leaves.

**It is a class change, never a move.** React reparenting an iframe destroys and recreates the
element: a fullscreen toggle that lifted the frame into an overlay would reload the widget, drop a
DocSpace edit in progress and restart a video. So nothing moves in the tree — `ShapeFrame`'s root
becomes `fixed inset-0 z-[45]`, opaque and square-cornered (`tailwind-merge` replaces the card's
`my-3 rounded-xl bg-card/50` rather than piling on), and the boxes between that root and the frame
become a flex column so the body can be told to fill what is left under the header. The chain is
root → `Collapsible` → `CollapsibleContent` (whose own inner `overflow-hidden` div is reached with
`[&>div]:h-full`, the one box the file cannot otherwise name) → the body → the frame's wrapper →
the iframe at `height: 100%`. A break anywhere in it leaves the frame at its old height in a
screen-sized box. `.verify` measured the round trip: the same DOM node before, during and after,
and the declared height restored on exit.

**The flag is `WidgetFrame`'s and the chrome is the card's**, because only `WidgetFrame` knows which
live element exists and only the card draws a box. Both halves travel in the `WidgetEmbed` handed to
the framer (`fullscreen`, `onToggleFullscreen`), so a caller that draws no frame never offers the
switch and an unframed embed's `fullscreen` is false forever — the right answer for a box nobody
drew.

**The layer is `z-[45]`, under the dialogs on purpose.** Over everything the workspace draws (sticky
rows at z-10/20, the app switcher's layer at z-40) and UNDER `Dialog`'s z-50. Fullscreen is a mode
the reader sits in with the app live around it, so a dialog opened from it — the command palette, a
confirm — must come up in front of it; on a layer above the dialogs the palette opens invisibly
behind the card and keeps the keyboard, so every keystroke lands in a list the reader cannot see.

**A fullscreen card is open and claims Escape.** The fold is forced open while it is up — a
full-screen card showing only its own header is a screen of nothing — and the chevron is not drawn
at all rather than drawn dead; the fold MEMORY is untouched, so leaving fullscreen returns the card
to exactly the state it was left in. The root carries `data-owns-escape` (`shared/ui/overlayEscape`)
while it is up, and `WidgetFrame`'s own listener takes the key in the capture phase and stops it
there, so the transcript's turn-abort Escape behind the card never fires. A modal DIALOG is the
exception, because it is not behind — and so is any panel that owns the key (`OWNS_ESCAPE`): the
widget's own dropdown, the composer's menu. The listener asks `otherOverlayHoldsEscape()` and stands
down, so the press closes what is in front and leaves the card fullscreen. It cannot win that by `stopPropagation` — the
dialog listens on the same window capture stage, and stopping propagation there does not stop a
second listener on the same node, so without the stand-down one press closes the dialog AND leaves
fullscreen.
The listener exists only while fullscreen is on.

**The gutter widgets answer to the same rule, in their own file.** `GutterWidgetFrame` takes
`fullscreen` and `onToggleFullscreen`; `ChatGutterLayout` holds WHICH widget has the screen (one
value, so two fullscreen WIDGETS cannot happen — though a transcript card and a widget can both be
fullscreen at once, two identical panels on one layer that one Escape leaves together) and owns the
Escape listener, with the same dialog stand-down, and drops it when the region narrows past the
gutters' threshold. The switch is a second control, so it
is a second button beside the header's toggle rather than inside it — a button within a button is
invalid markup — and the header row therefore holds every control at once: the toggle, the frame's
switch, and one node the widget itself supplies through `headerAction` (the Subagents widget's
"Clear completed" is the only one; [06-tool-view.md](06-tool-view.md) §Subagents). Each is a sibling
of the toggle, so a press meant for one of them folds nothing and drags nothing.

A retraction is the one thing that ends fullscreen without the reader: a fence that flashes back to
the streaming half unmounts `WidgetFrame` entirely, and the card comes back as a card. That is the
same restart the widget itself suffers there, and curing it is `StreamingMarkdown`'s shape to change.

## The live bus

`LiveBusProvider` (mounted once by `App`) holds one retained value per topic and dispatches
publishes synchronously to whoever subscribed. `useWidgetBridge` is the widget module's door onto
it; `useLiveTopic` is the door for an ordinary React component, and the Runner tab is its first
caller in the app — the panel and the tab's own gate both read `runner:*` through `useRunnerRuns`
([plan-runner.md](../plan-runner.md) §"The Runner tab"), never through a fetch of their own.

**The bus knows no producer.** It imports no transport, calls no endpoint and names no frame kind.
What fills it is a FEED — a headless component owned by the module whose data it carries, which
subscribes to whatever it likes and calls `publish`. The first is `RunnerFeed` in
`src/modules/plan-runner/`, documented in [plan-runner.md](../plan-runner.md) under *Consumers*.
Three more have followed and all three kept the shape: `ArcFeed`, beside `RunnerFeed` in that same
module, publishes the arc deck's own `arc:*` ([plan-runner.md](../plan-runner.md) §"The arc deck");
`SoulLaunchFeed` in `src/modules/dispatch-souls/` ([dispatch-souls.md](../dispatch-souls.md)); and
`UniverseFeed` in `src/modules/universe/`, which publishes a once-a-second digest rather than the raw
activity stream ([plan-runner.md](../plan-runner.md) §"The feed"). A further lane (git delegation,
Task Master) lands the same way — a sibling `*Feed.tsx`, usually in ITS own module, though `ArcFeed`
is the exception: the arc deck reads the runner's own state directory rather than owning one of its
own, so its feed never became a second job for `RunnerFeed`. Every feed lands as a component, never
as a line in `live-bus/`. That rule is what keeps this file from acquiring a switch over frame kinds
it has no business knowing, and it is why the bus can be read without knowing anything about the
runner.

**The vocabulary is an allowlist, and the shapes are anchored.** `LIVE_TOPIC_ALLOWLIST` holds four
patterns today — `runner:*` (every run as one array), `runner:<run_id>` with the route's own
character class and its 120-character ceiling, `souls:*` (every launcher soul), and `universe:*`
(the estate's activity as one digest, never its rows) — and `isAllowedTopic` is the single question
every other file asks. A `startsWith('runner:')` test would admit `runner:../../etc/passwd`, a topic
carrying a URL, and a topic 40 kB long, each of which reads as a runner topic to a prefix and as
nonsense to everything downstream. Adding a lane means adding a pattern here and nowhere else.

**Retained, and replayed synchronously.** `subscribe(topic, listener)` on an allowed topic replays
the retained value before it returns, so a subscriber never has to reason about whether it arrived
before or after its producer: either the value is handed to it on the way in, or there is none to
hand. On a topic outside the allowlist it replays nothing and returns a no-op — the registration is
not held at all, and the refusal a widget actually sees is the bridge's `topic not allowed`.

**Publish is a function call, not a render.** `publish(topic, payload, at = Date.now())` sets the
retained value and notifies that topic's listeners, in the same tick. On a disallowed topic it
retains nothing and notifies nobody, and it says so once: the bus `console.warn`s the first time it
refuses a given topic, naming it and pointing at `topics.ts`. Dropping it stays the behaviour — a
producer must not be able to invent a topic — but the drop is not silent, because only a feed can
reach it (the bridge refuses a widget's topic before the bus ever sees it), so it is always a
producer bug, and a subject that goes on existing while its own topic never carries anything is
otherwise a debugging trap with no cause attached to it anywhere.
A publish whose JSON matches the retained JSON is a COMPLETE no-op — nobody is notified, and
the entry keeps both its identity and its `at`. Identity, because `useLiveTopic` reads the bus as an
external store and React compares snapshots by reference, so a fresh object holding the same data
would re-render every subscriber on every poll tick. And `at`, because it means the instant the
value became true rather than the last instant something confirmed it, which is what makes a feed's
"only overwrite when newer" guard mean anything.

**The registry is refs, not React state**, for the reason the socket's own listener set is
(`WebSocketContext.tsx`, quoted in `LiveBusContext.tsx`): two publishes in one tick would otherwise
collapse into a single render carrying only the later one — which for a runner frame plus a
retirement means the retirement lands and the picture explaining it does not. The one render
trigger in the module is `useLiveTopic`, which subscribes through `useSyncExternalStore`, the same
idiom `useCliVersion` and the git-panel run store already use.

**The bridge is per frame, and it is swept.** `useWidgetBridge` holds a `Map<topic, unsubscribe>`
for one frame. It refuses a topic off the allowlist before it consults anything else, refuses the
seventeenth topic with `too many subscriptions` (`MAX_TOPICS_PER_FRAME`, sixteen — a blast-radius
number, not a performance one), forwards each `LiveValue` down as `{ type: 'data', topic, payload,
at }`, and drops every subscription it holds when the frame unmounts. That sweep is not tidiness:
nothing inside a widget hears about being unmounted, so it can never send the `unsubscribe` that
would clean up after it, and without the sweep every widget ever rendered in a session leaves its
listeners in the bus for every later publish to walk.

## Gotchas

- **A `blob:` or `data:` URL is not a shortcut for `srcDoc`.** A blob URL shares the parent's
  origin once the frame is same-origin, and a `data:` document does not carry the CSP meta the
  same way. The document goes in through `srcDoc`.
- **`rehype-raw` and `dangerouslySetInnerHTML` are not the simpler version of this.** Raw HTML in
  the transcript runs no script and leaks into every message; the sandboxed iframe is the door.
- **The height is the height, not a `min-height`.** A widget that shrinks must shrink the element
  around it, which a minimum would prevent.
- **`loading="lazy"` is deliberately absent.** A lazy frame subscribes late.
- **An embed that renders nothing is indistinguishable from one that rendered.** `X-Frame-Options`,
  `frame-ancestors` and mixed-content blocking all fire `load` on the element and leave a
  cross-origin document nothing here can read. Do not add a timeout to guess at it — the `Open page`
  link is the honest answer. See §"The embed kind".
- **The token list is not sized to what a widget happens to use.** It is also the payload of the
  `theme` message, so trimming it silently narrows what a widget can restyle itself with.
- **Any sandboxed frame on this page raises one `SecurityError: Failed to read the 'serviceWorker'
  property from 'Navigator'`.** It is the app's own registration guard — `'serviceWorker' in
  navigator` is true in a sandboxed context while reading the property throws — in `index.html`
  and `src/main.tsx`. It reproduces with an empty `srcdoc` carrying none of this code, so it is
  not the widget document's doing; the widget fence is simply the first thing in the app to
  create a sandboxed frame. `.verify/phase-22.mjs` filters it by message and says so.
- **`MermaidDiagram` reads `useTheme()` unconditionally, and the HTML export provides no
  `ThemeProvider`.** That is why `WidgetFrame` keeps every context read inside `WidgetFrameLive`,
  behind the mount gate, rather than following mermaid's shape exactly. The transcript export
  never mounts `MermaidDiagram`: `CodeFence` draws a mermaid fence's source there instead (see
  [rendered shapes](./08-rendered-shapes.md) §"Collapse and export").

## If you change this, check that

| If you touch | Also check |
| --- | --- |
| The `sandbox` attribute | Nothing but `allow-scripts` is on it. `.verify/phase-22.mjs` reads the attribute as a string and asserts the frame's origin is opaque and `localStorage` throws |
| `WIDGET_CSP` | `connect-src 'none'` survives, `img-src`/`font-src` stay at `data:`, and the meta is still emitted before the style, the script and the body. If you added a directive meaning to close frame self-navigation, re-measure the twelve vectors before believing it — the last three candidates all looked right and changed nothing |
| `buildWidgetDocument` | The fence body still reaches only the `<body>` element, and token values still come from `getComputedStyle` |
| `WIDGET_TOKEN_NAMES` | Every name is still declared in `src/shared/ui/verve/tokens.css`, and the `theme` message carries the same list |
| The theme path | A flip still posts `theme` and does NOT rebuild `srcDoc`; the memo in `WidgetFrameLive` is keyed on `code` alone. Gate 10 of the probe leaves a sentinel on the frame's `window` and requires it to survive a flip, so adding anything theme-shaped to that memo key reddens it |
| The height clamp | A widget still SHRINKS, not just grows — gate 4 drives one widget each way, because a `min-height` (or a monotonic `setHeight`) passes every growth assertion alone |
| `useWidgetHost`'s listener | The `event.source` identity check, the shape validation, and the `[24, 2000]` clamp on a finite number |
| `WidgetFrame`'s mount gate | `buildTranscriptHtml` still exports a `<pre>` and no `<iframe>` — gate 9 of the probe |
| The streaming context | `StreamingMarkdown` still marks only the pending half, `MarkdownBody` keeps its memo, and `CodeBlock` is still the only thing that reads the context — a second reader is a second place the streaming rule can be forgotten |
| The widget branch in `CodeBlock` (`shapes/code/index.tsx`) | The opt-in is still the WHOLE info-string word `widget`. Gate 7 drives both an `html` fence and a `widget-config` one, each with a positive control — "zero iframes" is also what a container that rendered nothing reports |
| `postToFrame` or the revoke rule | The host still stops posting after a second `load` on the element. Gate 9b navigates a widget to `about:blank`, forges the `ready` a real widget sends, and requires silence — a frame that navigated away keeps its `contentWindow`, so identity alone would go on admitting it |
| `LIVE_TOPIC_ALLOWLIST` | Every pattern is still ANCHORED and still bounded. Gates 4 and 5 of `.verify/phase-24.mjs` drive a bare bad topic and a URL-shaped one; a prefix test passes neither |
| `MAX_TOPICS_PER_FRAME` | The refusal is still an ANSWER, not a silence — gate 6 reads the reason out of the seventeenth topic's `onError` inside the frame |
| `useWidgetBridge`'s cleanup | Gate 8 drops the WIDGETS while the bus and the feed stay mounted and publishing, and requires every subscription they held to have been released — counted at the bus through a wrapper over `subscribe`, which a leaked listener never calls back. Not console silence: a listener left behind posts into a dead `contentWindow`, and `postToFrame`'s `?.` makes that raise nothing at all |
| `publish`'s equal-value skip | It must remain a COMPLETE no-op. Replace the retained entry on an equal reading and `useLiveTopic` re-renders forever, because its snapshot is compared by reference |
| The feed's retirement or its seed guard | Gate 9 drives the REST seed into a fresh bus and gate 10 ends a run and requires it to leave `runner:*`. Both live in `RunnerFeed.tsx`, never in `live-bus/` |
| `DOCSPACE_SANDBOX` | It still carries EXACTLY `allow-scripts allow-same-origin allow-forms` and the frame still has no inline document. Gate 1 of `.verify/phase-28.mjs` compares the attribute with `===`, never `includes`, so a quietly added `allow-popups` or `allow-top-navigation` reddens it |
| `DocSpaceFrame`'s `allow` attribute | It still reads `fullscreen` — a canvas block's own Full Screen control needs it to reach the real Fullscreen API rather than its CSS-overlay fallback. Gate 1 of `.verify/probe-docspace-canvas.mjs` checks it alongside `DOCSPACE_SANDBOX` on the same rendered iframe |
| `isForeignOrigin` | It still compares ORIGINS (not hostnames — the two services differ only by port here), still treats an unparseable URL as not-foreign, and is still consulted BEFORE the iframe renders. It is the only thing standing between a same-origin `VITE_DOCSPACE_EMBED_ORIGIN` and `localStorage['auth-token']`; gate 2 of the probe asserts the rendered frame's origin is not the page's |
| The `src` memo in `DocSpaceFrame` | It is keyed on the ids ALONE and the theme is still read from a ref latched at mount. Adding anything theme-shaped to that key turns every flip into a reload that discards the reader's unsaved edit — gate 8 of `phase-28.mjs` flips the theme and requires `src` to come back byte-identical, with the flip itself asserted so the gate cannot pass by not happening. Gate 3 of `phase-29.mjs` flips it again on a frame holding a REAL block, where a reload is a fault the reader would see and not only an attribute that changed |
| `EMBED_SANDBOX` or the embed's URL validation | The sandbox is still EXACTLY `allow-scripts allow-same-origin allow-forms` (no `allow-popups`, no `allow-top-navigation`), the scheme is still checked by PARSING rather than by a prefix, and `isForeignOrigin` still runs before the iframe renders. The same-origin refusal is what keeps `allow-same-origin` away from `localStorage['auth-token']` |
| The embed's declared height | The clamp is still applied and the `EMBED_*` constants are still the only spelling of it. The kind mounts no `useWidgetHost`, so nothing else can correct a wrong number — only the reader, through fullscreen |
| `ShapeFrame`'s `fullscreen` prop | The flex chain is unbroken (root → `Collapsible` → `CollapsibleContent` + its inner `[&>div]` → body → wrapper → iframe at `height: 100%`), the fold is still forced open with the MEMORY untouched, and the root still carries `data-owns-escape` while it is up. A break in the chain leaves the frame at its card height inside a screen-sized box |
| The fullscreen layer or the flush floor | The card still sits at `z-[45]`, under `Dialog`'s z-50 — raise it and a dialog opened from fullscreen comes up behind it holding the keyboard. The flush gutter card still has a floor under its `flex-1` — drop it and a tall neighbour crushes the Embed widget to 2px with no control left to reopen it |
| `WidgetFrame`'s fullscreen state | It is still a class change and never a move: the live element must keep its position in the React tree across the toggle, or the iframe reloads and a part-typed DocSpace edit is gone. Toggle it and assert the SAME DOM node before and after |
| The `key` on `WidgetFrameLive` OR on `DocSpaceFrame` | BOTH forks carry `key={code}` and both rest on the same premise — the revoke rule, not a reconciliation nicety. Without it a changed fence body is applied to the SAME element: `srcDoc` reassigned in place for an HTML widget, a new `src` for a DocSpace block. Either fires a second `load`, which the host cannot tell from the frame navigating itself away, and it silently revokes a healthy frame forever. Gate 9c rebuilds a body and requires `live.theme` to be set inside the new document — the sentinel half of that gate passes either way, because an in-place swap is also a new document, so `live.theme` is the read that matters |
