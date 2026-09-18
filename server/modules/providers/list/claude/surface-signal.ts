/**
 * The surface signal — how a Claude turn learns it is running inside CloudCLI's chat,
 * rather than a terminal.
 *
 * Both exports below are set on `sdkOptions` INSIDE `mapCliOptionsToSDK`, per turn, in
 * `claude-runtime.provider.js` — never in `.env`, a systemd unit, or `process.env` at
 * module load. That is deliberate: a terminal launch of `claude` reads none of this, so
 * its ABSENCE is what tells a turn it is not talking to CloudCLI's chat. Hoisting either
 * export to somewhere always-on would erase that signal for every terminal session on
 * this host.
 *
 * The runner's own souls (Heph, Athena, Prometheus, …) run through a different path
 * entirely and never pass through this provider, so `SURFACE_PROMPT_APPEND` never
 * reaches them — only a turn sent through this provider's `mapCliOptionsToSDK` carries it.
 */

export const SURFACE_ENV = { CLAUDE_SURFACE: 'cloudcli' } as const;

// The widget fence: the raw HTML frame and the DocSpace embed (docs/architecture/07-live-widgets.md).
// Another session owns these bytes — change a character here only on purpose, never in passing.
const WIDGET_SIGNAL =
  "On this surface (CloudCLI, CLAUDE_SURFACE=cloudcli) a fenced code block whose info string is exactly widget renders in the chat either as a live sandboxed HTML widget — body HTML with inline style and script tags only, no external resources and no network — whose script may call live.subscribe('runner:*', fn) or live.subscribe('runner:<run_id>', fn) to have fn(payload) called with the retained value at once and again on every change, or, when the fence body is exactly the JSON {\"kind\":\"docspace\",\"pageId\":\"…\",\"blockId\":\"…\"}, as that DocSpace block embedded inline and editable in place, so for anything that should persist, be edited by the person reading it, or be read back on a later turn create a DocSpace block through the archpulse MCP (create_page or add_block), embed it that way, and read it back with get_page or query_database_rows, keep the raw HTML fence for one-off visuals, reach for either only when a live, editable or visual view is clearer than markdown, and never emit one anywhere CLAUDE_SURFACE is not cloudcli, because the fence does not exist there.";

// The third widget body: any address, drawn in a frame (docs/architecture/07-live-widgets.md
// §"The embed kind"). Kept as its own sentence rather than folded into the run-on above, so the
// two older kinds' bytes are untouched and this one can be dropped or reworded on its own.
// `CLOUDCLI_PUBLIC_HOST` is the address a READER's browser reaches this box on (a LAN or VPN
// address, or a name). Unset, the sentence says which kind of address to use and names none.
// A bare host is what the sentence needs, so a scheme, a port or a path given with it is dropped.
const PUBLIC_HOST = (process.env.CLOUDCLI_PUBLIC_HOST ?? '')
  .trim()
  .replace(/^["']|["']$/g, '')
  .replace(/^[a-z]+:\/\//i, '')
  .replace(/[/?#].*$/, '')
  .replace(/:\d+$/, '');
const EMBED_HOST_HINT = PUBLIC_HOST === ''
  ? 'use the LAN or VPN address (or hostname) this host is reached on for anything running here'
  : `use this host\'s address ${PUBLIC_HOST} for anything running here, e.g. http://${PUBLIC_HOST}:8005`;
const EMBED_SIGNAL =
  'A third widget body embeds ANY page: a fence body that is the JSON {"kind":"embed","url":"https://…"} — with optional "title" (the card\'s heading) and "height" (pixels, default 420, clamped 120–2000) — draws that address in an iframe card, so a dashboard, a log viewer, a docs page, a map or any other service the operator runs can sit inside the reply instead of being linked to. The url must be an absolute http:// or https:// address and must not be this app\'s own origin. NEVER write localhost or 127.0.0.1 in an embed url: the frame is loaded by the READER\'s browser, which is usually a phone or a laptop on the LAN or a VPN, so loopback names their machine and not this box \u2014 ' + EMBED_HOST_HINT + '. The page is loaded as itself and speaks none of the widget protocol, so it cannot report its own height and nothing in the chat can tell a page that rendered from one that refused to be framed — many public sites (Google, most social sites) send X-Frame-Options and show blank, so prefer addresses known to allow embedding and remember the card always carries an Open link out to the real page. Every address you embed ALSO appears in the chat\'s Embed widget — a panel in the gutter beside the transcript that holds the live page at full height, follows the newest address you declare and opens itself when one arrives — so an embed is both a card in the reply and a page the reader can keep working against. Every embed card and every gutter widget wears a fullscreen switch in its header that hands it the whole viewport without reloading the frame, so a wrong height is never fatal.';

// The markdown shapes (docs/architecture/08-rendered-shapes.md). Only the four conventions a model
// would not write unprompted are named, because this text is paid for on every turn; the shapes
// that fire on ordinary markdown get one clause saying they exist, and the trigger table stays in
// `src/modules/chat/transcript/shapes/detect.ts`.
const MARKDOWN_SIGNAL =
  'Four markdown conventions also draw as components here: a fence whose info string is exactly stats, holding one label | value | delta line per tile (the delta is optional and its sign sets its colour), renders as stat tiles. A paragraph that is exactly VERDICT: PASS or VERDICT: FAIL, optionally followed by — B:n H:n M:n L:n, renders as a verdict banner carrying those blocking, high, medium and low counts. A path/to/file.ext:line reference, in prose or in inline code, renders as a chip that opens that file at that line, and a mermaid fence renders as a diagram. Ordinary markdown — tables, > [!NOTE] alerts, task lists, diff fences — already renders as rich components on this surface, so none of it needs a widget.';

export const SURFACE_PROMPT_APPEND = `${WIDGET_SIGNAL} ${EMBED_SIGNAL} ${MARKDOWN_SIGNAL}`;
