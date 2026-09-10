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

## The pieces

| File | Role |
| --- | --- |
| `src/modules/widgets/index.ts` | The barrel. Exports `WidgetFrame` and nothing else |
| `src/modules/widgets/WidgetFrame.tsx` | `WidgetFrame` — the `<pre>`/iframe decision — and the private `WidgetFrameLive`, which only ever renders in a browser |
| `src/modules/widgets/buildWidgetDocument.ts` | `WIDGET_CSP` and `buildWidgetDocument` — the whole HTML document a widget lives in |
| `src/modules/widgets/widgetBridgeScript.ts` | `WIDGET_BRIDGE_SCRIPT` — the in-frame script that becomes `window.live` |
| `src/modules/widgets/readVerveTokens.ts` | `WIDGET_TOKEN_NAMES` (the contract) and `readVerveTokens` (the live read) |
| `src/modules/widgets/hooks/useWidgetHost.ts` | `useWidgetHost` — the page's half: one message listener, the height, the theme post, and the `load` counter that revokes a frame which navigated itself away |
| `src/modules/widgets/hooks/useWidgetBridge.ts` | `useWidgetBridge` — one frame's subscriptions: the two refusals, the per-frame cap, and the unmount sweep |
| `src/modules/live-bus/topics.ts` | `LIVE_TOPIC_ALLOWLIST`, `isAllowedTopic`, `RUNNER_ALL_TOPIC`, `runnerTopic` — the whole vocabulary |
| `src/modules/live-bus/context/LiveBusContext.tsx` | `LiveBusProvider` and `useLiveBus` — the retained values, the listener registry, `publish`/`subscribe`/`get` |
| `src/modules/live-bus/hooks/useLiveTopic.ts` | `useLiveTopic` — the module's ONE render trigger, for a React component reading a topic |
| `src/modules/live-bus/index.ts` | The barrel. The provider, the bus hook, `useLiveTopic`, and the vocabulary |
| `src/modules/chat/transcript/Markdown.tsx` | `CodeBlock`'s widget branch and the file-private `MarkdownStreamingContext` |
| `src/modules/chat/transcript/StreamingMarkdown.tsx` | Marks the pending half streaming; the settled half is untouched |
| `src/shared/types.ts` | `WidgetFrameMessage`, `WidgetHostMessage`, `WidgetHostHandlers`, `LiveTopic`, `LiveValue`, `LiveBus`, under `LIVE WIDGETS` |
| `.verify/phase-22.mjs` | The fence probe: the sandbox, the opaque origin, the CSP refusal, height, theme, streaming, export, and the revoke rule from both sides |
| `.verify/phase-24.mjs` | The bus probe: a stage written to disk read back inside a sandboxed widget, both refusals, the cap, the unmount sweep, the REST seed and the retirement |

## The fence

`CodeBlock` in `Markdown.tsx` reads the info string off the `language-*` class react-markdown puts
on the `code` element. The widget branch matches the WHOLE word, not the `\w+` capture the label
and the highlighter use: `\w` stops at a hyphen, so a `widget-config` fence would otherwise read
as `widget` and mount a live scripted frame for an ordinary documentation label. Directly under
the mermaid branch:

````
```widget
<div style="padding:16px;background:var(--surface);color:var(--ink)">hello</div>
```
````

renders `<WidgetFrame code={raw} streaming={streaming} />`. `streaming` comes from
`MarkdownStreamingContext`, a file-private context defaulting to `false`, which
`MarkdownBodyRenderer` provides around its `ReactMarkdown`. Only `StreamingMarkdown` sets it, and
only on the pending half — `splitStreamingMarkdown` keeps an open fence and everything after it
in `pending`, and a finished message never carries the flag at all.

The consequence worth holding on to: a widget fence renders as source in three situations — while
the reply is still being written, in an exported document, and for one tick whenever the streaming
split boundary RETRACTS back over an already-live widget — and as a live frame everywhere else.

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
`var(--ink)` and `var(--font-body)`. The fence body is never interpolated into a script, an
attribute or the CSP.

**The theme.** The document's opening theme is read off the `dark` class on `<html>` at build
time, the same instant and the same source the tokens come from. Every change after that is a
`theme` message: `useWidgetHost` posts one when the frame says `ready` and again whenever
`useTheme().isDarkMode` changes, and the bridge toggles the `dark` class and calls
`style.setProperty` for each token on the frame's own document element.

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

## The live bus

`LiveBusProvider` (mounted once by `App`) holds one retained value per topic and dispatches
publishes synchronously to whoever subscribed. `useWidgetBridge` is the widget module's door onto
it; `useLiveTopic` is the door for an ordinary React component, and the Runner tab is its first
caller in the app — the panel and the tab's own gate both read `runner:*` through `useRunnerRuns`
([plan-runner.md](../plan-runner.md) §"The Runner tab"), never through a fetch of their own.

**The bus knows no producer.** It imports no transport, calls no endpoint and names no frame kind.
What fills it is a FEED — a headless component owned by the module whose data it carries, which
subscribes to whatever it likes and calls `publish`. The first is `RunnerFeed` in
`src/modules/plan-runner/`, documented in [plan-runner.md](../plan-runner.md) under *Consumers*;
a second (git delegation, Task Master) lands as a sibling `*Feed.tsx` in ITS own module and never as
a line in `live-bus/`. That rule is what keeps this file from acquiring a switch over frame kinds it
has no business knowing, and it is why the bus can be read without knowing anything about the runner.

**The vocabulary is an allowlist, and the shapes are anchored.** `LIVE_TOPIC_ALLOWLIST` holds two
patterns today — `runner:*` (every run as one array) and `runner:<run_id>` with the route's own
character class and its 120-character ceiling — and `isAllowedTopic` is the single question every
other file asks. A `startsWith('runner:')` test would admit `runner:../../etc/passwd`, a topic
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
- **OPEN: the two raw-source `<pre>` fallbacks do not match in dark, and the divergence is
  recorded rather than quiet.** `WidgetFrame`'s fallback is `MermaidDiagram`'s spelling minus
  `dark:bg-zinc-900`, so the two render on different dark backgrounds. Both spellings are
  mandated: the plan's interfaces copy mermaid's classes verbatim, while this phase's executable
  verification gate greps `src/modules/widgets` for palette literals and requires zero. The gate
  is executable and the prose is not, so the literal was dropped. Be honest about the cost: it is
  not free. `MermaidDiagram` carries `bg-muted/50` AND `dark:bg-zinc-900`, and the `dark:` variant
  is the one that paints in dark mode — so in dark the widget fallback sits on the muted token
  while mermaid's sits on zinc-900, which is exactly the drift "one spelling" existed to prevent.
  Converging the two needs a ruling on which spelling wins; if it is mermaid's, the honest move is
  to lift `MermaidDiagram` off its literal too, never to re-add this one.
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
  behind the mount gate, rather than following mermaid's shape exactly.

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
| The streaming context | `StreamingMarkdown` still marks only the pending half, and `MarkdownBody` keeps its memo |
| The widget branch in `CodeBlock` | The opt-in is still the WHOLE info-string word `widget`. Gate 7 drives both an `html` fence and a `widget-config` one, each with a positive control — "zero iframes" is also what a container that rendered nothing reports |
| `postToFrame` or the revoke rule | The host still stops posting after a second `load` on the element. Gate 9b navigates a widget to `about:blank`, forges the `ready` a real widget sends, and requires silence — a frame that navigated away keeps its `contentWindow`, so identity alone would go on admitting it |
| `LIVE_TOPIC_ALLOWLIST` | Both patterns are still ANCHORED and still bounded. Gates 4 and 5 of `.verify/phase-24.mjs` drive a bare bad topic and a URL-shaped one; a prefix test passes neither |
| `MAX_TOPICS_PER_FRAME` | The refusal is still an ANSWER, not a silence — gate 6 reads the reason out of the seventeenth topic's `onError` inside the frame |
| `useWidgetBridge`'s cleanup | Gate 8 drops the WIDGETS while the bus and the feed stay mounted and publishing, and requires every subscription they held to have been released — counted at the bus through a wrapper over `subscribe`, which a leaked listener never calls back. Not console silence: a listener left behind posts into a dead `contentWindow`, and `postToFrame`'s `?.` makes that raise nothing at all |
| `publish`'s equal-value skip | It must remain a COMPLETE no-op. Replace the retained entry on an equal reading and `useLiveTopic` re-renders forever, because its snapshot is compared by reference |
| The feed's retirement or its seed guard | Gate 9 drives the REST seed into a fresh bus and gate 10 ends a run and requires it to leave `runner:*`. Both live in `RunnerFeed.tsx`, never in `live-bus/` |
| The `key` on `WidgetFrameLive` | It is the revoke rule's premise, not a reconciliation nicety: without it a changed fence body reassigns `srcDoc` in place, fires a second `load`, and silently revokes a healthy widget forever. Gate 9c rebuilds a body and requires `live.theme` to be set inside the new document — the sentinel half of that gate passes either way, because an in-place swap is also a new document, so `live.theme` is the read that matters |
