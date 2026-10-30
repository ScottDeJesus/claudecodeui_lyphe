/**
 * The surface signal — how a Claude turn learns it is running inside CloudCLI's chat,
 * rather than a terminal.
 *
 * The exports below are applied to `sdkOptions` by `claude-runtime.provider.js`, per turn (`SURFACE_ENV` and
 * `SURFACE_PROMPT_APPEND` inside `mapCliOptionsToSDK`, `leadWithFollowupsSignal` after the toolsets hook has
 * answered) — never in `.env`, a systemd unit, or `process.env` at
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

// The widget fence: the raw HTML frame and the DocSpace embed (docs/architecture/MANUAL.md (07-live-widgets)).
// Another session owns these bytes — change a character here only on purpose, never in passing.
const WIDGET_SIGNAL =
  "On this surface (CloudCLI, CLAUDE_SURFACE=cloudcli) a fenced code block whose info string is exactly widget renders in the chat either as a live sandboxed HTML widget — body HTML with inline style and script tags only, no external resources and no network — whose script may call live.subscribe('dispatcher:all', fn) to have fn(payload) called with the retained value at once and again on every change, or, when the fence body is exactly the JSON {\"kind\":\"docspace\",\"pageId\":\"…\",\"blockId\":\"…\"}, as that DocSpace block embedded inline and editable in place, so for anything that should persist, be edited by the person reading it, or be read back on a later turn create a DocSpace block through the archpulse MCP (create_page or add_block), embed it that way, and read it back with get_page or query_database_rows, keep the raw HTML fence for one-off visuals, reach for either only when a live, editable or visual view is clearer than markdown, and never emit one anywhere CLAUDE_SURFACE is not cloudcli, because the fence does not exist there.";

// The third widget body: any address, drawn in a frame (docs/architecture/MANUAL.md (07-live-widgets)
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
// `VITE_DOCSPACE_EMBED_ORIGIN` is the address a READER's browser reaches DocSpace (ArchPulse) on. The client
// reads it for its own DocSpace frames (`docspaceOrigin.ts`); the server reads the same value so the
// model's embeds name that address too, in the scheme the reader's page can frame. It is accepted the
// way the client accepts it (trimmed, trailing slashes dropped, an absolute http: or https: URL, else
// ignored) and reduced to its origin; unset or ignored, the hint names no DocSpace address.
const DOCSPACE_PUBLIC_ORIGIN = readDocSpacePublicOrigin(process.env.VITE_DOCSPACE_EMBED_ORIGIN);

function readDocSpacePublicOrigin(configured: string | undefined): string {
  const value = (configured ?? '').trim().replace(/^["']|["']$/g, '').trim().replace(/\/+$/, '');
  if (value === '') return '';
  try {
    const { protocol, origin } = new URL(value);
    if (protocol === 'http:' || protocol === 'https:') return origin;
  } catch (error) {
    console.warn(`[surface-signal] VITE_DOCSPACE_EMBED_ORIGIN ${JSON.stringify(value)} did not parse as a URL; the embed hint names no DocSpace address:`, error instanceof Error ? error.message : error);
    return '';
  }
  console.warn(`[surface-signal] VITE_DOCSPACE_EMBED_ORIGIN ${JSON.stringify(value)} is not an http: or https: URL; the embed hint names no DocSpace address.`);
  return '';
}

// The https sentence rides on every hint: the reader may have this app open over https (a Tailscale
// serve door), where a browser blocks a plain-http frame and the card shows nothing but its Open link.
const EMBED_HTTPS_PREFERENCE =
  'prefer an https address wherever one exists, because this app may be open over https and a browser blocks a plain-http frame inside an https page, leaving the card blank';

const OTHER_SERVICES_HINT = PUBLIC_HOST === ''
  ? ''
  : `; for anything else running here use this host\'s address ${PUBLIC_HOST} with the service\'s own port`;

const EMBED_HOST_HINT = DOCSPACE_PUBLIC_ORIGIN !== ''
  ? `DocSpace (ArchPulse) is at ${DOCSPACE_PUBLIC_ORIGIN}: an embed of a DocSpace page names exactly that address, e.g. ${DOCSPACE_PUBLIC_ORIGIN}/#page=<page id>, even where a tool result gave the page an http://…:8005 address${OTHER_SERVICES_HINT}, and ${EMBED_HTTPS_PREFERENCE}`
  : PUBLIC_HOST === ''
    ? `use the LAN or VPN address (or hostname) this host is reached on for anything running here, and ${EMBED_HTTPS_PREFERENCE}`
    : `use this host\'s address ${PUBLIC_HOST} for anything running here, e.g. http://${PUBLIC_HOST}:8005, and ${EMBED_HTTPS_PREFERENCE}`;
const EMBED_SIGNAL =
  'A third widget body embeds ANY page: a fence body that is the JSON {"kind":"embed","url":"https://…"} — with optional "title" (the card\'s heading) and "height" (pixels, default 420, clamped 120–2000) — draws that address in an iframe card, so a dashboard, a log viewer, a docs page, a map or any other service the operator runs can sit inside the reply instead of being linked to. The url must be an absolute http:// or https:// address and must not be this app\'s own origin. NEVER write localhost or 127.0.0.1 in an embed url: the frame is loaded by the READER\'s browser, which is usually a phone or a laptop on the LAN or a VPN, so loopback names their machine and not this box \u2014 ' + EMBED_HOST_HINT + '. The page is loaded as itself and speaks none of the widget protocol, so it cannot report its own height and nothing in the chat can tell a page that rendered from one that refused to be framed — many public sites (Google, most social sites) send X-Frame-Options and show blank, so prefer addresses known to allow embedding and remember the card always carries an Open link out to the real page. Every address you embed ALSO appears in the chat\'s Embed widget — a panel in the gutter beside the transcript that holds the live page at full height, follows the newest address you declare and opens itself when one arrives — so an embed is both a card in the reply and a page the reader can keep working against. Every embed card and every gutter widget wears a fullscreen switch in its header that hands it the whole viewport without reloading the frame, so a wrong height is never fatal.';

// The markdown shapes (docs/architecture/MANUAL.md (08-rendered-shapes)). Only the four conventions a model
// would not write unprompted are named, because this text is paid for on every turn; the shapes
// that fire on ordinary markdown get one clause saying they exist, and the trigger table stays in
// `src/modules/chat/transcript/shapes/detect.ts`.
const MARKDOWN_SIGNAL =
  'Four markdown conventions also draw as components here: a fence whose info string is exactly stats, holding one label | value | delta line per tile (the delta is optional and its sign sets its colour), renders as stat tiles. A paragraph that is exactly VERDICT: PASS or VERDICT: FAIL, optionally followed by — B:n H:n M:n L:n, renders as a verdict banner carrying those blocking, high, medium and low counts. A path/to/file.ext:line reference, in prose or in inline code, renders as a chip that opens that file at that line, and a mermaid fence renders as a diagram. Ordinary markdown — tables, > [!NOTE] alerts, task lists, diff fences — already renders as rich components on this surface, so none of it needs a widget.';

// The Next steps widget (server/modules/followups/): the chat's own next steps and known gaps, kept in the
// gutter beside the transcript. This is the "automatically": no second model reads replies, the chat that
// knows what it left open files it with the `followups` command (bin/followups.mjs) over the chat-commands
// door. Pronoun-free toward the person ("the user") because CloudCLI has more than one account.
//
// LEADS the surface prompt (`leadWithFollowupsSignal`), and says WHEN and HOW in the imperative. Measured 2026-10-25 on a Haiku chat:
// the same rules appended LAST and phrased as a description ("you keep it current ...") drew no `followups` call —
// the reply asked a question and named something unchecked, and filed neither. This wording is the sharpened one —
// said first, told to run the call BEFORE the reply's final text, and naming the two replies that always owe an item —
// and the same kind of turn filed a next step and a known gap by itself (MAN-9004).
const FOLLOWUPS_SIGNAL =
  `Beside this chat sits its Next steps widget, which keeps this chat's open next steps and known gaps in front of the user so none is lost, and you are the one who fills it, with the followups command, in the same turn as the reply that opens or settles an item. Do it before you write the final text of the reply, as one Bash call, even when the turn has nothing else to run. When the reply leaves something open for later (a question or choice you put to the user, an offer waiting on a yes from the user, a step you put off), file it with followups add --next "<one plain line>"; when you know of a gap you are leaving (something not tested or that you could not check from here, a case not handled, a limit or risk you chose not to fix), file it with followups add --gap "<one plain line>". Word each line as you would say it to the user, with no codes or ids, and put every --next and --gap of the turn in one call. A reply that asks the user a question or says that something went unchecked always has an item to file. Never file what the same reply finishes, and never file uncommitted work: the Git tab already shows it. When an item is settled (answered, done, or no longer true) close it with followups done <id>; followups lists what is open with ids, so run it before closing anything you did not file this turn.`;

export const SURFACE_PROMPT_APPEND = `${WIDGET_SIGNAL} ${EMBED_SIGNAL} ${MARKDOWN_SIGNAL}`;

/**
 * The surface prompt with the Next steps instruction in front of it. Called by `claude-runtime.provider.js`
 * after the toolsets hook has answered, and ONLY for a launch that carries the chat credential
 * (`CLOUDCLI_TOOLSET_TOKEN` in the launch's env): the instruction tells the chat to run `followups`, and the
 * command has nothing to run with in a chat that has no credential — one whose project runs on a Cerberus node
 * (the hook gives those none: a stdio command there could not reach this box's loopback), one with no app session
 * id, or one whose hook did not answer. Such a chat keeps `SURFACE_PROMPT_APPEND` as it was.
 */
export function leadWithFollowupsSignal(append: string): string {
  return `${FOLLOWUPS_SIGNAL} ${append}`;
}
