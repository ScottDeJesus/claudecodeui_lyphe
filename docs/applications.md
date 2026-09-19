# The application switcher

Three routes under `/api/apps`, behind `authenticateToken` on the MOUNT (`server/index.ts:207` — no
route file imports the guard), wired in `createAppsModule()`. What they carry is a list of the
operator's own applications; what the client draws from it is a small round button in the sidebar's
logo row, a drawer of rows, and one or two framed panes over the main region. The client's half is
one group in `src/shared/api.ts` (`api.apps`, built on the same `get`/`post`/`del` helpers the rest
of that file uses, with the bearer token attached by `authenticatedFetch` — no caller passes one).

**It replaced the Applications Hub**, the page the operator's own applications used to be opened
from as links off a sheet of their own (`~/.claude/hub`). That page and its directory are deleted,
and nothing here reads it. Where the hub left the
workspace, the switcher frames an application INSIDE it: the sidebar, the project list and a chat
streaming its answer all keep running while an application is up, because the panes are a layer
over the main region rather than a route away from it.

## The server module

`server/modules/apps/` follows the house shape — a composition root, a router factory, a service
and its store — with nothing else in it:

| File | What it holds |
|---|---|
| `apps.seed.ts` | `DEFAULT_APPS`: the one row the registry file is created from — this app itself — and nothing that reads them. |
| `apps.store.ts` | The file itself: `resolveAppsFile`, `ensureAppsFile`, `readEntries`, `writeEntries`, `isDividerEntry`. |
| `apps.service.ts` | `listApps` · `addApp` · `updateDescription` · `removeApp`, and EVERY judgement about what a caller may send. |
| `apps.dividers.ts` | `addDivider` · `renameDivider` · `removeDivider` · `moveRow`: where rows sit (§"Dividers and order"). |
| `apps.icons.ts` | `appIcons`: each app's own tab icon, found on the app and remembered in `apps.icons.local.json` (§"App icons"). |
| `apps.routes.ts` | `createAppsRouter()` — thin routes that call one verb and hand anything thrown to `next`. |
| `apps.module.ts` · `index.ts` | `createAppsModule()` and the barrel the server entrypoint imports. |

`server/shared/app-types.ts` carries the two shapes that go on the wire — `AppEntry` (`{ id, name,
url, description? }`), `DividerEntry` (`{ id, divider }`), `RegistryRow` and `AppRegistryResponse`
(`{ apps, rows, selfPorts, icons }`) — as a sibling of `server/shared/types.ts`
rather than an addition to it, which is the pattern `kanban-types.ts` established beside the other
ten. `src/shared/app-types.ts` is a field-for-field mirror of that file, and the two are edited
together, always: a change on one side alone is a response the drawer cannot read.

**Validation is the service's, never the route's.** An `id` a caller sends must match
`^[a-z0-9][a-z0-9-]{0,63}$`; an `id` left out is minted from the name (lower-cased, runs of
non-alphanumerics folded to `-`, trimmed, and stepped around the ids already in the file with a
`-2` suffix rather than refused as a duplicate). A `name` is 1–64 characters after trimming. A
`url` must parse as an absolute `http:`/`https:` URL **after `{host}` is replaced by `localhost`**,
so `http://{host}:8003` is a valid row and a bare word carrying no scheme is not. A duplicate `id` on create is a 409; an
unknown `id` on delete is a 404; both are `AppError`s with an explicit `statusCode`, rendered by the
global handler as `{ success: false, error: { code, message } }`.

**`selfPorts` is how the client recognizes this app's own row**, and it is the same two expressions
the server already uses to describe itself: `SERVER_PORT || 3001` and `VITE_PORT || 5173`. On this
box that answers `[3011, 5183]` — the API on its loopback port and Vite on the port the browser
actually opened.

## The registry file

The list is a FILE, not a table. There is no migration, no schema and no second copy:

- **It lives at `apps.local.json` in the application root** — beside `package.json` on a checkout —
  and at `process.env.APPS_FILE` when that is set. The path is resolved from the module's own
  location (`findApplicationRoot(getModuleDirectory(import.meta.url))`), never from
  `process.cwd()`, because the dev supervisor and systemd do not agree on a working directory. It
  is resolved on every call rather than captured once, so a server booted with `APPS_FILE` set
  honors it on every read.
- **It is git-ignored.** `.gitignore` carries `apps.local.json` and its `.tmp` scratch, and the
  entry says why: the file is created on first boot and is private to the machine that made it.
- **It is created when absent, never repaired.** `ensureAppsFile()` runs at module creation — so
  the file exists from the first boot rather than from the first request — and again at the top of
  every read, so deleting it mid-run re-seeds it. It writes `DEFAULT_APPS` and NOTHING else.
- **Creating it can never take the server down.** The call at module creation sits in a `try/catch`
  that logs and continues: a read-only application root must not cost chat, files and git for the
  sake of a list of links. The one request that needs the registry still answers 500 if it cannot
  be read, which is where a broken setup belongs.
- **A file that exists belongs to the operator.** No read rewrites it, whatever is in it. A file
  that is not valid JSON, or holds a row that is not three non-empty strings, is a 500 naming which
  of the two happened (`apps registry is not valid JSON` / `apps registry holds an invalid entry:
  <id or index>`) and the file is left alone — trading the operator's rows for a clean boot is the
  one thing this module must never do.
- **Writes are atomic**: JSON to `<path>.tmp` in the same directory, then `fs.renameSync` onto the
  real name, the discipline `server/modules/settings/deepseek-flash-switch.ts` already uses. A
  half-written registry is never observable.
- **Order is file order.** No sorting, no favourites, no reorder verb. The drawer lists the rows
  top to bottom exactly as the file holds them.

The seed, and the file the first boot writes, is:

```json
[
  {"id": "cloudcli", "name": "CloudCLI", "url": "http://{host}:5183"}
]
```

This app alone — every other row is the operator's own, added through the drawer or the
registry file by hand. A row may carry a path, not just a bare origin, when an app's root is
not the page worth opening (`{"id": "dashboard", "name": "Dashboard", "url":
"http://{host}:9001/dashboard"}`).

**Adding an application is a POST, a curl, or one line in that file**, and the three are the same
act. Nothing is cached on the server and nothing is cached for long on the client: the drawer
re-reads the registry on every open, so a row appended by hand or by curl a second ago is in the
list the next time the drawer is looked at — no restart, no watcher, no polling. A row appended
while the drawer stood closed is in the list the next time it is opened.

## The routes

```
GET    /api/apps              -> { apps: AppEntry[], rows: RegistryRow[], selfPorts: number[], icons: { [id]: dataUrl } }
POST   /api/apps              { name, url, description?, id? }   -> { app: AppEntry }
PATCH  /api/apps/:id          { description }   -> { app: AppEntry }   (blank clears it)
DELETE /api/apps/:id          -> { ok: true }
POST   /api/apps/:id/move     { direction: 'up' | 'down' }   -> { ok: true }   (any row, app or divider)
POST   /api/apps/dividers     { title? }   -> { divider: DividerEntry }   (appended at the end)
PATCH  /api/apps/dividers/:id { title }    -> { divider: DividerEntry }   (blank = a plain line)
DELETE /api/apps/dividers/:id              -> { ok: true }
```

The one `PATCH` sets a row's description (at most 160 characters), the only field the drawer edits
in place; renaming or readdressing a row is a DELETE plus a POST, or one line in the file. The mount
carries the guard (`app.use('/api/apps', authenticateToken, createAppsModule())`), so a route added
to the file later cannot be the one that forgot it, and `express.json()` is already global — no
body parser is added here.

Worked, against the API on this box. The token is any bearer token the server accepts; the harness
in §"Proving it" mints a real one from the live database's own secret:

```bash
TOKEN=$(bash -c '. scripts/apps-probe-env.sh; mint_token')

curl -s -H "Authorization: Bearer $TOKEN" http://127.0.0.1:3011/api/apps
# {"apps":[{"id":"cloudcli","name":"CloudCLI","url":"http://{host}:5183"}, …],"selfPorts":[3011,5183]}

curl -s -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"name":"CloudCLI","url":"http://{host}:9001/dashboard"}' http://127.0.0.1:3011/api/apps
# {"app":{"id":"cloudcli-2","name":"CloudCLI","url":"http://{host}:9001/dashboard"}}   <- the id was taken, so one was minted

curl -s -X DELETE -H "Authorization: Bearer $TOKEN" http://127.0.0.1:3011/api/apps/cloudcli-2
# {"ok":true}
```

Without a token the same GET answers 401 — the guard is on the mount, and it is the whole reason
these routes are three lines each.

## Dividers and order

A divider is a row of the registry file like an app is — `{ "id": "divider-x1y2", "divider": "Work" }`,
with no `url` — so its place is its position in the file, and a hand-edit can add one. The title
may be blank, which draws a plain line. `readEntries` returns apps and dividers in file order;
`GET /api/apps` answers the apps alone in `apps` (what the panes read) and the whole list in `rows`
(what the drawer draws). Dividers share the app id space, so `/:id/move` names either kind: it swaps
the row with its neighbour, and a row already at that end stays put. A new divider is appended at
the end and opens straight into its title field; the kebab moves it into place.

## App icons

Each row's tile shows the app's own tab icon when the app publishes one. The browser cannot read
another origin's page, so the server finds it (`apps.icons.ts`): it fetches the app's page with
`{host}` resolved to `127.0.0.1`, takes the `<link rel="icon">` / `apple-touch-icon` hrefs (an SVG
first), then `/favicon.ico`, and keeps the first answer whose content type is `image/*` and whose
size is at most 256 KB. The type check matters: an SPA answers `/favicon.ico` with its index page at 200.

Icons are REMEMBERED in `apps.icons.local.json` beside the registry (git-ignored), by app id and
url: a found icon is re-checked after a week, a missing one after an hour, and a changed url
fetches afresh. `GET /api/apps` carries them as data URLs in `icons`, and waits only for the probes
that are due, each bounded by a 3-second timeout. An app with no icon keeps its letter tile.

## `{host}`, resolved in the browser

A row's url may carry the literal `{host}`, and **the substitution happens in the reader's browser,
never on the server**. `resolveAppUrl(url, host)` in
`src/modules/app-switcher/utils/resolveAppUrl.ts` is the whole rule: a case-insensitive, GLOBAL
replace of `{host}` with `window.location.hostname`, made at the moment a row is opened.

That is what lets ONE registry file serve every address this host answers to. Opened on the LAN or
over the VPN the row resolves to `http://10.0.0.5:8004` — this host's own address on either
network — and on the box itself it is `http://localhost:8004`, every one of them from the same
rows and the same file. A
url with a host baked in would pin every reader to whichever address it was written from. The
server checks the shape of a `{host}` url by substituting `localhost` (`apps.service.ts`), because
that is the one address it can resolve on its own; the stored row keeps the placeholder.

The file imports NOTHING, and that is load-bearing rather than tidy: both of its functions are pure
and take the host, the page origin and the port set as arguments, so they can be run for real under
`tsx`, outside a browser, with no test file in the repo.

## The self-origin rule

**A row that IS this application opens in a new tab and is never framed.** `isSelfOrigin(resolved,
window.location.origin, selfPorts)` is true when the resolved url has the identical origin, or the
same hostname as the page on a port this app answers on itself — its API port or its Vite port.
That is why `selfPorts` exists at all: on this box the API answers on `127.0.0.1:3011` while the
browser sits on `127.0.0.1:5183`, one hostname and two origins, so an origin-only test would frame
the app whenever the tab was opened on its other port.

The row it would frame is the `cloudcli` row, and CloudCLI inside CloudCLI is not a second
application: it is a mirror, and worse than a mirror, because the inner copy shares this page's
`localStorage['auth-token']` and would show its reader the session they are already in. So that row
— and any row naming this app — renders with its body click opening a new tab, an external-link
glyph saying so before it is pressed, and a menu cut down to that one item.

`resolveAppUrl.ts` carries a comment naming its deliberate twin, `isForeignOrigin` in
`src/modules/widgets/docspaceOrigin.ts`. The two are not merged: that file is a chat-domain module,
so reaching into it would be both a wrong-way coupling and a boundary error, and the questions
differ — widgets asks origin-only, where being conservative is right because the answer gates
`allow-same-origin`, while the switcher needs the app's own port set.

## The FAB

One control, and it is the reader's way in and out of every pane.

- **It is 28px drawn, docked or floating, inside a 44px round catch** — the size measured off the
  retired hub's own design reference. Its face is the app's logo (`/logo-64.png`), filling the
  circle inside a 1px accent rim. The catch is a transparent `::before` on `.vv-fab`,
  so a press up to 22px from the centre starts a drag while `getBoundingClientRect()` still answers
  28px, and every rect the drag, the clamp and the dock snap read is the circle the reader sees.
- **It sits docked to the left of the wordmark**, in the sidebar's logo row. The rail holds 30px
  icon buttons beside a 26px serif wordmark in 328px of width, so the button stays the smallest
  thing in the row, its catch reaches exactly the `gap-2` before the wordmark, and the wordmark
  still renders untruncated at a 320px viewport, which the probe checks.
- **The dock is a slot, not an import.** `ProjectSidebarRegion.tsx` passes `leading={<AppSwitcherDock />}`
  to `Sidebar` at both of its call sites (the desktop branch and the mobile drawer branch), and
  `SidebarHeader` renders it as the FIRST child of the logo row — a sibling of the anchor and the
  `LogoBlock`, never inside them, because two of `LogoBlock`'s call sites sit inside an `<a>` and a
  button inside an anchor is invalid HTML that navigates away instead of opening the drawer. The
  sidebar module never imports the switcher, exactly as it never imports the tabs.
- **Exactly one dock is on the page**, gated the way `tabs` is (`{leading && !isCompact}` in the
  desktop header, `{leading && isCompact}` in the mobile one). The header draws both blocks and
  hides one with CSS; a slot placed in both would leave two docks reporting one rect.
- **It drags.** Past a 4px threshold the press becomes a drag; below it, the release is a click
  that opens the drawer, and Enter or Space does the same from the keyboard. Clamped to the
  viewport with 8px of padding on every side, so it can never be thrown off screen and lost.
- **Released within 64px of the dock's centre it snaps back into the dock**; anywhere else it
  floats where it was let go. A dock that is not on screen means the button floats at its clamped
  default rather than at a remembered point that no longer exists.
- **`z-index: 60`**, a measured number with its five neighbours in the comment beside it in
  `src/shared/ui/verve/surfaces.css`: it beats the mobile sidebar drawer (`z-50`, in the same
  stacking context) because a FAB under that backdrop is dimmed and unclickable exactly when the
  reader is trying to leave a pane, and loses to the portalled drawer it opens and the menus inside
  it.

**What is remembered is furniture, and only furniture** — one `localStorage` key, `app-switcher`,
per browser, never the server:

```ts
export type AppSwitcherRecord = {
  fab: { docked: boolean; x: number; y: number };
  dual: boolean;
  ratio: number;
};
```

The FAB's position, whether dual screen is on, and where the divider stands. **Which applications
are open is deliberately not in it.** A window that reopens onto somebody else's application
instead of onto the workspace is a surprise — this app opens to the workspace, every time — and
every pane restored would be an iframe loading on the first paint. Only furniture is remembered;
the room is always the workspace.

The first position, for a reader who has never touched it: docked from 768px of viewport width up,
floating near the bottom-right below that. Once the reader moves it, the record wins at every
width.

On a phone that corner is over the chat composer's first line: the 44px catch covers the right end
of it, so a press there opens the sheet rather than placing the caret, and text under the catch
cannot be reached. Left as it stands — no fixed pair of insets clears a composer whose height
follows the text in it and the keyboard, and lifting the button past the composer puts the catch in
the middle of the conversation, where a press meant for the text moves the button.

## The drawer

The retired hub's drawer, on the kit. Its design reference and a captured screenshot of its layout
are this screen's visual spec — every measurement below (the sheet's width, the 22px slide, the
row height, the tile size) is read off one of the two rather than guessed. A sheet down the LEFT,
`min(88vw, 364px)` on the canvas
ground, sliding in 22px from the edge the FAB docks on. Top to bottom in the order a reader's
questions are asked — what is this and how do I leave, how will what I pick be shown, what can I
pick, how do I add one:

- **"Your *apps*"** in the display serif, a count line (**3 apps · single screen** / **dual screen
  on**), and a round **✕** that closes the sheet and leaves the panes standing, as Escape and the
  backdrop do. While anything is up, **Close all** sits on the count line: it takes every pane down
  and returns to the workspace, and says "all" because it is not the same act as the ✕. Drawn by
  `AppDrawerHeader.tsx`, extracted out of the drawer at the 300-line ceiling — the count line's two
  readings of the registry (has the first read landed; did it fail) are its own, the list below only
  asks whether that first read happened at all.
- While dual screen is on, a card with a pill bar reading **Opens in — Left / Right**, naming which
  half the next choice fills. There is no on/off switch: a row's **Open in dual screen** turns it
  on and **Close dual screen** turns it off.
- A scrolling list of cards in file order: the app's icon (or its letter), the name, and its
  description — the resolved host when it has none — which reads **… · on screen** while the app is up (the tile turns accent then). Pressing a card puts
  it in its half, or takes it down again. Until `registryRead` (the context flag `useAppRegistry.ts`
  sets once the FIRST read has answered, with rows or with a refusal) turns true, the list draws
  three skeleton rows instead — never the empty state, because an unmeasured registry is not an
  empty one.
- **Dividers** among the cards (`AppDrawerDivider.tsx`): a hairline with its title, or a plain line.
  Pressing the title, or **Rename** in its kebab, edits it in place; the kebab also moves and
  removes it. **Add divider** sits beside **Add application** in the footer.
- A **kebab menu** per card: **Reload** (live only while that app is up), **Open in a new tab**,
  **Open in dual screen** — or **Close dual screen** on the app holding the second half —
  **Edit description**, which turns the second line into a field in place (Enter or leaving it
  saves, Escape puts it back, blank clears it), **Move up** / **Move down** (greyed at the list's
  ends), and **Remove**, which calls `removeRegistryApp` (`utils/registryRequests.ts`) — `DELETE
  /api/apps/:id` — and then `refresh()`. **Open in dual screen** turns dual screen on with THIS
  app in the second half in one update — the context's own `openInDualScreen` — because it cannot
  be composed from `toggleDual(true)` followed by `open(...)`: `open` reads `dual` and the "opens
  in" side from the render it runs in, and with dual still off that fills the LEFT half again — an
  app beside itself is not what "Open in dual screen" says. A kebab left open takes the next Escape itself, and the sheet
  goes on the press after it — the shared overlay-Escape contract every portalled `ActionMenu`
  carries (`src/shared/ui/overlayEscape.ts`, documented in
  [`verve/README.md`](../src/shared/ui/verve/README.md) §"The overlay half"). Removing an app that
  is UP takes its pane down first, in the render the press was made in, so a refusal then names it
  in the banner: the reader's screen changed for a removal that did not happen, and the notice has
  to say so. A row naming this app (§"The self-origin rule") carries only Open in a new tab and
  Remove.
- Pinned below the list, a wide **Add application** button opening an inline **New application**
  form (name, web address, **Add it**) in the list's place, which calls `addRegistryApp`
  (`utils/registryRequests.ts`) — `POST /api/apps` — and then `refresh()`, so the row the list
  draws always comes back from the registry rather than from the draft that was typed. The form
  checks both fields under themselves before sending — `http://` is added to an address with no
  scheme, and `{host}` is accepted — and prints the server's own sentence when the server refuses.
- Under it, a **Light appearance / Dark appearance** switch writing CloudCLI's own `ThemeContext`.
- An **empty state** ("No applications yet", with **Add your first application**) when the registry
  holds no rows, and a **banner** carrying the server's own message when the registry could not be
  read. The two are never shown together: a failed read with a list behind it keeps the last good
  list and raises the banner beside it, because "no applications yet" would be a claim nobody
  measured.

Favourites, reordering and Edit — all in the hub's drawer — are not here: the registry API has no
verb for any of them (`GET`, `POST` and `DELETE /api/apps` are the whole surface).

Every word the switcher draws comes from the `applications` block of
`src/modules/i18n/locales/<lang>/common.json`, in all eleven locales. There is no namespace file
of its own — the block is where these keys belong — and a key missing from a non-English locale
falls back to English without a word, which is what makes a skipped translation easy to miss.

## The panes, and the layer

`AppSwitcherLayer` renders `null` when nothing is open, and the workspace is untouched in every
other state too: it is `absolute inset-0` at `z-40` over the MAIN REGION only. The sidebar is how
the reader gets back to a project, so it is never covered, and a chat streaming underneath keeps
streaming — this is a layer over the workspace, not a route away from it.

One application open fills the layer. Dual screen on with two chosen composes `SplitPane` with the
divider between them; the divider is a `role="separator"` announcing its position as a percentage,
moved by drag and by the Left and Right arrows, and clamped to 15–85% of the row wherever a ratio
is written as well as where it is drawn — so a stored value can never put a pane where the reader
cannot reach its edge. The left pane is the same element whether or not a right one exists, so
opening or closing the second pane never remounts what the first is showing.

**A pane is an iframe and nothing else** — no title bar, no close button, no watchdog:

```tsx
<iframe src={resolved} title={app.name} referrerPolicy="no-referrer" allow="geolocation"
        className="h-full w-full border-0" />
```

- **`allow="geolocation"`** is there for a measured reason: the hub's frames carried no `allow`
  attribute at all, so a framed app asking for the operator's location was refused it outright.
- **There is deliberately no `sandbox` attribute**, and `AppPane.tsx` says so in a comment, because
  an unexplained absence beside the house's other two cross-origin frames reads as an oversight. A
  sandbox without `allow-same-origin` would cut the framed app's `SameSite=Lax` session cookie,
  which is the whole premise of the framing grant below. These are the operator's own applications
  on the operator's own host, not untrusted embeds.
- **Reload** bumps a per-pane counter used in the frame's React key, which remounts the element.
  **Open in a new tab** is `window.open(resolved, '_blank', 'noopener')`.
- **The way out is the FAB**, which floats above every pane and is never covered.

## What can be framed, and what cannot

Framing is the framed application's decision, not this one's, so it is a fact per row rather than a
setting here:

- **An application can be framed, by grant.** An env var in that application's own backend config
  (its equivalent of `<APP>_FRAME_ANCESTORS`) names CloudCLI's origins — the port the browser
  actually uses under every name this host answers to, plus both loopback forms of the API port —
  and a backend that reads such a variable at import writes `frame-ancestors <origins>` into its
  CSP and deletes its `X-Frame-Options` when the list is non-empty, naming CloudCLI as the
  embedder it grants.
- **Some applications can never be framed.** An application that answers `X-Frame-Options: DENY`
  and a `frame-ancestors 'none'` CSP stays that way; nothing about it is changed here. Its row
  opens in a new tab, which is an accepted property of that application rather than a defect to
  route around.
- **Any other row** opens in a pane and shows whatever its own headers allow. An application that
  refuses framing paints a blank pane; that is its answer, and the row's menu still offers Open in a
  new tab.

## The kit the switcher is built on

Three files joined `src/shared/ui/` for this lane, plus a stylesheet, because each is mechanism
rather than appearance — pointer capture, viewport clamping, a dock hit-test, a clamped divider —
which is what earns a component in this house. Every screen composes them; none re-implements them.

- **`DockableFab.tsx`** — one `position: fixed` node for its whole life, docked or floating; docked
  it takes its `left`/`top` from the dock's rect, floating from its own `x`/`y`. It is never
  unmounted and re-mounted into the header, because a node that unmounts mid-drag loses its pointer
  capture and the drag dies in the reader's hand. 28px drawn everywhere, with a 44px catch. Its
  drag threshold is 4px, its snap radius 64px, its edge padding 8px. It presses on the CLICK, never
  on the pointer release: a phone dispatches a tap's click after the release, at the finger's point,
  into whatever is on screen by then — and the drawer it opens covers it, so a drawer opened on the
  release caught its own tap on the backdrop and shut again (or pressed a row inside the sheet). The
  click that ends a drag is swallowed; Enter and Space carry `detail === 0` and always press.
- **`SplitPane.tsx`** — two panes and a draggable seam, or one pane filling the row. The seam is
  its own narrow gutter BESIDE the panes rather than over them: a grab area laid over a pane would
  steal the clicks of whatever that application draws flush against its edge. It carries
  `SPLIT_MIN_RATIO` and `SPLIT_MAX_RATIO` (0.15 and 0.85, the clamp the hub measured) and moves by
  0.02 per arrow key.
- **`usePointerDrag.ts`** — the one drag mechanism both of them run on. It lives with the kit rather
  than in `src/shared/hooks/`, and is not exported from the barrel: the frontend standard sends a
  hook used by multiple FEATURE modules to `src/shared/hooks/`, and this one has none — what binds
  it here is direction, since it writes class names whose only meaning is in the kit's own
  stylesheet and its `PointerDragKind` names the two kit components.

**The body class is the reason the drag exists in this shape.** A pane is a cross-origin iframe, and
an iframe is its own browsing context: the moment a drag crosses into one, the frame swallows the
pointer stream and the gesture dies mid-flight. So for the length of a drag `document.body` carries
`vv-dragging` and `vv-drag-<kind>`, and `body.vv-dragging iframe { pointer-events: none }` returns
hit-testing to the page until the release. It is a class on the body and never an inline style on
the frames, which React owns and would undo on its next render. The release is bound to `pointerup`
and `pointercancel` in the CAPTURE phase, so the frames are clickable again before any of their own
handlers run, and the same release runs on unmount so a component torn down mid-drag cannot leave
the whole application unclickable.

`src/shared/ui/verve/surfaces.css` is the fourth Verve paint file, holding `.vv-fab`, `.vv-split`,
the divider rules and the four body classes. Colours come from tokens and nowhere else. Its import
in `src/shared/ui/index.ts` is load-bearing: after `controls.css` and `feedback.css`, before
`board.css`, which keeps the last word.

## The switcher's own files

`src/modules/app-switcher/`, whose barrel exports exactly four mounts — the provider, the dock, the
FAB and the layer — and nothing else:

| File | What |
|---|---|
| `context/AppSwitcherContext.tsx` | The one state home: the registry, the two panes, dual, the ratio, the FAB position, the dock rect, the drawer's open flag, `openInDualScreen` (dual-on-and-filled in one update) — and `refresh()` on every drawer open. |
| `AppSwitcherDock.tsx` | The empty 28px box in the logo row. It paints nothing; it holds the space open and reports its rect. |
| `AppSwitcherFab.tsx` · `AppDrawer.tsx` | The kit's FAB wearing the app logo, wired to the drawer it opens. |
| `AppDrawerHeader.tsx` | The sheet's "Your apps" heading, the count line and Close all — extracted out of `AppDrawer.tsx` at the 300-line ceiling. |
| `AppDrawerDivider.tsx` · `hooks/useDrawerLayout.ts` · `utils/moveItems.ts` | One divider row with its in-place title; the drawer's layout acts (add/rename/remove a divider, move a row) with their one refusal banner; the kebab's shared Move up / Move down pair. |
| `AppDrawerRow.tsx` · `NewApplicationForm.tsx` | One application's card, kebab and in-place description edit; the inline New application form (name, address, optional description) and its field checks. |
| `AppPane.tsx` · `AppSwitcherLayer.tsx` | One framed application; the panes composed over the main region. |
| `hooks/useAppRegistry.ts` | `GET /api/apps` on mount and on every drawer open — no polling, no websocket. A failed read keeps the last good list and raises an error beside it; `registryRead` is set once, after the first read settles either way. |
| `utils/registryRequests.ts` | The registry's WRITE verbs — `addRegistryApp`, `describeRegistryApp`, `removeRegistryApp`, `moveRegistryRow` and the three divider verbs — and `refusalInWords`, the one reader of a refusal's sentence every registry request in this module shares. |
| `utils/resolveAppUrl.ts` · `utils/appSwitcherStorage.ts` · `utils/dockRect.ts` | The pure functions of §"`{host}`…", the `localStorage` record, and the two rules (`dockableRect`, `sameRect`) a measured dock rect passes before the provider believes it. |

The context lives in `context/` and no file here ends in `Provider.tsx`, which is what the frontend
standard asks for and what the ten contexts already in this repo do. The mounts are made by
`src/modules/project-workspace/ProjectWorkspaceShell.tsx`: it wraps its tree in the provider, gives
its main-region wrapper the `relative` the layer needs, renders the layer as that wrapper's last
child and the FAB as the last sibling of the command palette — outside the main region, so the
button floats over an open application instead of being covered by it.

## Proving it

One tracked helper and one probe, both run against a REAL server and REAL applications. Neither is
a test runner, and neither writes anything back into the repo.

**`scripts/apps-probe-env.sh`** is sourced by every verify in the build, never executed as a
program, and imported by no application code. It is a library of three functions: `mint_token`
builds an HS256 JWT for the first user from the live database's own `jwt_secret`, so the token is
one the running `authenticateToken` accepts; `boot_probe_server` boots a SECOND server on
`$PROBE_PORT` (`7893` by default) and reuses one only when this script started it, because a phase
that changed server code must not be verified against a process another phase left running;
`stop_probe_server` kills that server. The probe writes its marker to a scratch path
(`CLOUDCLI_LOCAL_SERVER_MARKER`) and keeps its chat hosts in a scratch sessions directory
(`CLOUDCLI_SESSIONS_DIR`), so neither the operator's marker nor the operator's running chats are
ever touched. It still runs against the live database; neither redirect isolates that.

**`scripts/apps-ui-probe.mjs`** walks the switcher in a real browser over the DevTools protocol —
no playwright runner, no test framework — because everything it checks (a FAB paints, a drawer opens
with rows, a click frames an application, a dragged seam stays where it is put) exists only after
React has run, and a curl of the endpoint would answer none of them:

```
node scripts/apps-ui-probe.mjs <app-url> <token> <fab-label> [row-a] [row-b]  |  --selftest <app-url> <token>
```

It prints one `KEY=value` line per reading and then exactly one verdict line, `PROBE OK` or `PROBE
FAILED`; everything that explains a failure goes to stderr. `--selftest` runs the plumbing alone —
launch, seed the token, load the app, assert the wordmark renders — so the driver can be proven
without the feature. The two rows the split is built from are ARGUMENTS rather than constants,
because the registry is a file the operator edits by hand — pass the two rows a run is about.

Two things about it are contracts rather than conveniences. **The window is set to 1280×900 before
any reading is taken** — below 768px the desktop header is `display: none`, the FAB defaults to
floating and a dock reading would pass by there being no dock on the page at all — and the narrow
320×900 pass at the end exists to check that the wordmark is not truncated beside the FAB. And
**every drag is a real press, path and release over the protocol**: `element.click()` carries
`detail: 0`, so it takes the keyboard path and never touches the drag.

`CHROME_HEADLESS_SHELL` points the probe at a different browser; it defaults to playwright's own
download, already on this box. A full invocation is the whole recipe: mint a token with the
helper, boot a server against the real database, open the app in the browser, probe, stop.
