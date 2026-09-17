# The application switcher, folded into LypheCLI — the FAB, the drawer, the panes, and the hub retired

## INTENT LOCK

**ORIGINAL REQUEST** (the operator's own words, verbatim):
> Can we start a plan to fold the application switcher into our cloudCLI? I would like that application button to live on the left of the lypheCLI title but I still want it to be drag-and-droppable anywhere as a fab. I want the application switcher itself to be a part of and live inside of our cloudCLI because as we create applications I want them to essentially be appended here (so I can switch to them easily) and because it's a part of the lypheCLI. I can have floating windows and floating chats while I'm working inside of other applications. Does that make sense?
>
> 1. After the switcher lives in CloudCLI, please retire the hub and yes, delete it and remove its system D.
> 2. Keep the existing behavior.
> 3. I haven't figured that one out yet so let's just put that out of scope for now.
> 4. The app list can live in the same project as lypheCLI or the CloudCLI and have all of the existing unseeded websites copied over. The entries shouldn't be living inside of the Git so it should be Git-ignored. Make sure that if it's being created for the first time, it should create this file so AI builders can do that.
> 5. It would be awesome to have a fab docking area so I can remember its spot and sort of snap onto it if I throw it over there. It should already be Verve-implemented. Everything is already Verve-implemented so there's nothing to change here.
> 6. What is the hub? Are iFrame workarounds that no longer apply?
> 7. You're going to have to explain number 6 to me and I don't know what 7 is.
>
> go

**THIS PLAN DELIVERS:**
The Applications Hub stops being a separate app on `:8006` and becomes a part of LypheCLI. A new
server module, `server/modules/apps/`, owns a **git-ignored `apps.local.json` at the repo root**,
created on first server start when absent and seeded with the seven entries copied verbatim from
the hub's own `apps.json` (`{id, name, url}`, `{host}` intact), read on every request so an AI
builder can append a row with a text editor or one `curl` and see it on the next open of the
drawer — `GET`, `POST` and `DELETE` behind `authenticateToken` at `/api/apps`. In the browser, a
**docking FAB** sits to the left of the "LypheCLI" wordmark by default, drags anywhere over the
page with pointer capture, snaps back when it is dropped near its dock, and remembers where it
was left per browser in `localStorage`. A plain click opens a **drawer** listing the applications;
choosing one fills the workspace's main region with a full-bleed pane, and a **dual-screen**
switch puts two side by side behind a draggable divider clamped to 15%–85%, with per-row
**Reload** and **Open in a new tab**, in light and dark. Two new Verve system components carry the
mechanism nothing in the kit composes — `DockableFab` and `SplitPane`, with their own stylesheet
`src/shared/ui/verve/surfaces.css` and the shared `usePointerDrag` hook whose body class turns
`pointer-events` off on every iframe for the length of a drag, which is the one reason a drag
survives crossing a cross-origin pane. The EIS app's backend is granted CloudCLI's own origins in
`EIS_FRAME_ANCESTORS` so its pane paints; Dispatch keeps `X-Frame-Options: DENY` and stays an
"Open in a new tab" row, which is accepted rather than worked around. A row whose url resolves to
this page's own origin — the CloudCLI row the operator asked to keep verbatim — opens in a new tab
instead of framing the app inside itself. Then the hub is **retired**: `hub.service` stopped,
disabled and removed, `/home/lyphe/.claude/hub/` deleted, and all ten pointers to it across the
house corrected by name. Floating windows and floating chats are out of scope. No test file is
written: every phase is proven against a real server on port 7893, real `curl` with a real JWT, a
real `tsx` execution of the real url resolver, and a real headless Chromium driving the built SPA
through the whole scenario — FAB, drawer, pane, dual screen, divider drag, FAB drag, reload.

**OPERATOR VERDICT:** CONFIRMED -- 2026-09-16 -- Scott: "Accept — run it"

## Runner

```toml
plan_format = 2
cwd = "/home/lyphe/.claude/claudecodeui_lyphe"
add_dirs = ["/home/lyphe/.claude", "/opt/shadow-connector"]

[budget]
max_cycles = 40
max_spawns = 200
max_fix_passes = 2
max_attempts = 2
max_review_passes = 1
max_replans = 3
```

## Interfaces

Everything in this section is a measured fact with its anchor, or a decision already made.
Nothing here is for the child to re-derive.

### Repo conventions that bind every phase

- Backend: `server/modules/<feature>/` with `<feature>.module.ts` (composition root),
  `<feature>.routes.ts` (router factory), `<feature>.service.ts` (domain logic), `index.ts`
  (barrel). Cross-module imports go through the other module's `index.ts` only.
  (`.agents/skills/backend-module-standards/SKILL.md`; the template is
  `server/modules/kanban/kanban.module.ts:1-15`, which imports its services and its
  `routes/…` factory and exports `createKanbanModule(): Router`.)
- Frontend: `src/modules/<feature>/` with an `index.ts` barrel; `@/...` imports only, never a
  relative path; `type` aliases, never `interface`; no module-local `types.ts` / `utils.ts` /
  `constants.ts`; a large module-private utility goes in `src/modules/<feature>/utils/` under a
  descriptive name (`.agents/skills/frontend-module-standards/SKILL.md:88-89`).
- Server application imports END IN `.js` even when the target file is `.ts`
  (`server/modules/kanban/kanban.module.ts:3-9`).
- Scripts: `npm run typecheck` = two `tsc -p` runs; `npm run lint` = `oxlint src/ server/`;
  `npm run lint:client` = `oxlint src/`; `npm run build:client` = `vite build` into `dist/`.
- The repo root has **no `README.md`** (measured); `docs/README.md` is the index, and its entry
  format is the bullet at `docs/README.md:62`.

### Where the new code lives

| Path | What |
|---|---|
| `server/shared/app-types.ts` | `AppEntry`, `AppRegistryResponse` — the server's two types |
| `server/modules/apps/apps.seed.ts` | `DEFAULT_APPS` — the seven entries, verbatim |
| `server/modules/apps/apps.store.ts` | the registry file: path resolution, create-when-absent, read, atomic write |
| `server/modules/apps/apps.service.ts` | `listApps` · `addApp` · `removeApp`, and the validation |
| `server/modules/apps/apps.routes.ts` | `createAppsRouter()` — four thin routes |
| `server/modules/apps/apps.module.ts` · `index.ts` | the composition root and the barrel |
| `server/index.ts` | ONE mount line, beside the kanban mount |
| `.gitignore` | ONE line: `apps.local.json` |
| `.oxlintrc.json` | ONE list entry per shared file — see §The lint's own law |
| `src/shared/app-types.ts` | the client mirror of `server/shared/app-types.ts` |
| `src/shared/api.ts` | ONE new group, `apps:` |
| `src/shared/ui/usePointerDrag.ts` | the one drag mechanism both kit components use — IN the kit, not above it |
| `src/shared/ui/DockableFab.tsx` · `SplitPane.tsx` · `verve/surfaces.css` | the kit |
| `src/modules/app-switcher/` | the provider, the dock, the FAB, the drawer, the panes, the layer |
| `src/modules/sidebar/` | the `leading` slot, threaded exactly as `tabs` already is |
| `src/modules/project-workspace/ProjectSidebarRegion.tsx` | passes `leading={<AppSwitcherDock />}` |
| `src/modules/project-workspace/ProjectWorkspaceShell.tsx` | mounts the provider, the layer and the FAB |
| `src/modules/i18n/locales/<lang>/common.json` | the `applications` block, in all eleven locales |
| `scripts/apps-probe-env.sh` | `mint_token` · `boot_probe_server` · `stop_probe_server`, sourced by every verify |
| `scripts/apps-ui-probe.mjs` | the one real-browser probe |
| `docs/applications.md` | the lane's ONE documentation home |

### The lint's own law — `.oxlintrc.json` must learn each new shared file

**This repo's module boundaries are enforced by a linter, not only by a document.**
`.oxlintrc.json` sets `"boundaries/no-unknown": "error"` (`:271`, `:329`), and two of its elements
are **explicit file enumerations**, not folder patterns: `backend-shared-utils` (`:69-81`) lists
eleven files ending in `server/shared/kanban-types.ts`, and `frontend-shared-file` (`:97-112`) lists
twelve ending in `src/shared/kanban-types.ts` (measured 2026-09-16). `boundaries/include` (`:44-55`)
covers `src/shared/*.ts` and `server/**/*.ts`, so a new file there that matches no element is an
`error` the moment anything imports it. **The file is JSONC** — it carries `//` comments (`:5-6`
and throughout), so it is edited as text; a JSON round-trip would silently strip every comment in
it, and a check that parses it with a strict JSON reader fails on a file that is perfectly correct.

So each of this plan's two sibling type files carries ONE list entry, added by the same phase that
creates it, and proven by that phase's existing lint gate:

- `server/shared/app-types.ts` → the `backend-shared-utils` pattern list (Phase 1, `lint:server`)
- `src/shared/app-types.ts` → the `frontend-shared-file` pattern list (Phase 5, `lint:client`)

`src/shared/ui/` and `src/shared/hooks/` are FOLDER elements, so the two kit components, the
stylesheet and the drag hook need no entry at all. Nothing else in this plan touches this file.

### The registry file

- **Path.** `process.env.APPS_FILE` when set, else
  `path.join(findApplicationRoot(getModuleDirectory(import.meta.url)), 'apps.local.json')` — the
  exact idiom this server already uses to find its own root from inside a module
  (`server/modules/deepseek/index.ts:31`, measured). Never `process.cwd()`: the dev supervisor and
  systemd do not agree on it.
- **It is git-ignored**, and `.gitignore` gains exactly one line, `apps.local.json`. The repo's
  `.gitignore` has no entry for it today (measured: 153 lines, no `*.json` rule).
- **Created when absent, never repaired.** `ensureAppsFile()` runs at module creation (so the
  file exists from the first boot) and again at the top of every read (so deleting it mid-run
  re-seeds it). It writes `DEFAULT_APPS` and nothing else. A file that EXISTS is never rewritten
  by a read, whatever is in it.
- **Creating it can never take the server down, and never clobbers a concurrent create.** The call
  at module creation sits inside a `try/catch` that logs and continues: `findApplicationRoot`
  resolves the package root under a packaged target too (`npm run desktop`, `npm run server:bundle`
  both exist), and a read-only root must not kill the whole API for a list of links — the routes
  already answer 500 on an unreadable registry. The create itself is
  `writeFileSync(path, seed, { flag: 'wx' })` with `EEXIST` swallowed, because `existsSync` then
  `writeFileSync` is a TOCTOU between two live servers: `cloudcli-server-dev.service` runs
  `deploy/dev-supervisor/supervisor.mjs`, which hot-restarts the operator's API on any save under
  `server/`, so from the moment Phase 1 lands there are two processes creating and reading this one
  file.
- **Read on every request.** No cache, no watcher, no restart. A builder appending a row with a
  text editor sees it on the next `GET`.
- **Written atomically**: to `<path>.tmp` in the same directory, then `fs.renameSync` onto the
  real name — the discipline already used by
  `server/modules/settings/deepseek-flash-switch.ts:86-100`. A half-written registry is never
  observable.
- **The seed, verbatim from `/home/lyphe/.claude/hub/apps.json:1-9`** (measured; the strings are
  copied character for character, `{host}` included):

```json
[
  {"id": "descent", "name": "Descent", "url": "http://{host}:7878"},
  {"id": "eis-app", "name": "EIS App", "url": "http://{host}:8004"},
  {"id": "dispatch", "name": "Dispatch", "url": "http://{host}:8003"},
  {"id": "cerberus", "name": "Cerberus", "url": "http://{host}:8001/dashboard"},
  {"id": "archpulse", "name": "ArchPulse", "url": "http://{host}:8005"},
  {"id": "storybook", "name": "EIS Storybook", "url": "http://{host}:6006"},
  {"id": "cloudcli", "name": "CloudCLI", "url": "http://{host}:5183"}
]
```

### The server types — `server/shared/app-types.ts`

```ts
/** One row of the application registry. The shape a builder appends by hand. */
export type AppEntry = { id: string; name: string; url: string };

/** What GET /api/apps answers. `selfPorts` is how the client knows which row is this app. */
export type AppRegistryResponse = { apps: AppEntry[]; selfPorts: number[] };
```

`src/shared/app-types.ts` is a field-for-field mirror of that file and carries nothing else.
`server/shared/types.ts` (1672 lines) and `src/shared/types.ts` (2078 lines) are **not opened by
any phase in this plan** — the sibling-file convention is the one the Kanban board already
established (`src/shared/kanban-types.ts` beside ten other siblings).

`selfPorts` is `[Number(process.env.SERVER_PORT || 3001), Number(process.env.VITE_PORT || 5173)]`
— the same two expressions `server/index.ts:318` and `:321` already use. It exists so the client
can tell that the `cloudcli` row IS this app even when the browser opened it on a different one of
its own two ports (on this box: Vite on 5183 in the browser, the API on 3011 loopback — measured).

### The service verbs — `server/modules/apps/apps.service.ts`

```ts
listApps(): AppRegistryResponse
addApp(input: { id?: string; name: string; url: string }): AppEntry
removeApp(id: string): void
```

Four rules bind them:

1. **Validation is the service's, never the route's.** `id` matches `^[a-z0-9][a-z0-9-]{0,63}$`
   and is minted from the name when absent (lower-cased, non-alphanumerics folded to `-`,
   trimmed, de-duplicated with a `-2` suffix). `name` is 1–64 characters after trimming. `url`
   must parse as an absolute `http:` or `https:` URL **after `{host}` is replaced by `localhost`**
   — so `http://{host}:7878` is valid and `descent` is not.
2. **A duplicate id is a 409, an unknown id on delete is a 404.** Both are thrown as
   `AppError` from `@/shared/utils.js` with an explicit `statusCode`, exactly as the kanban
   services do, and rendered by the global handler at `server/index.ts:282-303`.
3. **A registry file that exists and is not a JSON array of valid entries is a 500 and is NEVER
   overwritten.** The message is `apps registry is not valid JSON` or
   `apps registry holds an invalid entry: <id or index>`. Silently replacing it with the seed
   would delete the operator's list on one stray character.
4. **Order is file order.** No sorting, no favourites, no reorder verb. The file is the order.

### The routes — `/api/apps`, mounted with the guard on the mount

```
GET    /api/apps              -> { apps: AppEntry[], selfPorts: number[] }
POST   /api/apps              { name, url, id? }   -> { app: AppEntry }
DELETE /api/apps/:id          -> { ok: true }
```

- Mount: `app.use('/api/apps', authenticateToken, createAppsModule());` in `server/index.ts`,
  in the flat mount block, directly after the kanban mount at `server/index.ts:192` (measured).
  The MOUNT carries the guard; no route file imports `authenticateToken`.
- `express.json()` is already global (`server/index.ts:129-139`); no body parser is added.
- There is no `PATCH`. Editing a row is a `DELETE` plus a `POST`, or one line in the file.

### The client API surface

`src/shared/api.ts` gains ONE group beside `kanban` (`api.ts:645-672`), built on the same
`get` / `post` / `del` helpers (`api.ts:157-171`); `authenticatedFetch` attaches the bearer token
itself (`api.ts:86-97`), so no caller passes a token.

```ts
apps: {
  list: () => get('/api/apps'),
  add: (body: { id?: string; name: string; url: string }) => post('/api/apps', body),
  remove: (id: string) => del(`/api/apps/${encodeURIComponent(id)}`),
},
```

### `{host}` resolution and the self-origin rule — `src/modules/app-switcher/utils/resolveAppUrl.ts`

The hub resolved `{host}` in the browser (`seed.js:34`,
`String(s.url).replace(/\{host\}/gi, location.hostname)`), and so does this — one registry serves
LAN and Tailscale because the substitution happens where the reader is.

**This file imports nothing.** Both functions are pure and take what they need as arguments, so a
phase can run them for real through `tsx` without a browser and without a test file.

```ts
/** `http://{host}:7878` + `100.103.222.79` -> `http://100.103.222.79:7878`. Case-insensitive. */
export function resolveAppUrl(url: string, host: string): string;

/** True when the resolved url IS this app: same hostname as the page AND a port the app itself
 *  answers on (its API port or its Vite port), or the identical origin. Such a row is opened in
 *  a new tab and NEVER framed — CloudCLI inside CloudCLI is a mirror, not an application. */
export function isSelfOrigin(resolvedUrl: string, pageOrigin: string, selfPorts: number[]): boolean;
```

The caller passes `window.location.hostname` and `window.location.origin`. The repo already builds
urls from the page this way (`docspaceOrigin.ts`, `resolveDocSpaceOrigin` and `isForeignOrigin`).

**`isSelfOrigin` has a deliberate twin, and it is not imported.** `src/modules/widgets/docspaceOrigin.ts`
exports `isForeignOrigin(url)` — the negation of this predicate, minus the port set. It stays
separate, and `resolveAppUrl.ts` carries one comment naming it so the next reader finds both: that
file is a chat-domain module, a deep import into `@/modules/widgets` is a wrong-way coupling AND a
`boundaries/dependencies` error (`.oxlintrc.json:260-263` bans deep imports), and the two questions
differ — widgets asks origin-only to gate `allow-same-origin`, where being conservative is right,
while the switcher needs the app's own port set. The reversal is in §Decisions.

### Iris's ruling on the two kit components (settled fact, not a step)

Verve draws neither a floating action button nor a split pane today, and neither can be composed
from what exists: both are **mechanism** — pointer capture, viewport clamping, a dock hit-test, a
clamped divider — which `DESIGN_DOCTRINE.md` §2 names as the one thing that earns a component.
They join the shared kit; every screen composes them and none re-implements them.

```ts
// src/shared/ui/DockableFab.tsx
export type DockableFabPosition = { docked: true } | { docked: false; x: number; y: number };

type DockableFabProps = {
  label: string;                  // aria-label AND tooltip text; every word arrives as a prop
  icon: ReactNode;                // the glyph; the kit draws no icon of its own
  position: DockableFabPosition;  // controlled — the owner persists it
  dockRect: DOMRect | null;       // where the dock is, measured by the owner; null = nowhere to dock
  active?: boolean;               // renders as aria-expanded and the pressed wash
  onPress: () => void;            // a pointerup that never passed the drag threshold
  onPositionChange: (next: DockableFabPosition) => void;  // exactly once per drag, at release
};
```

- It is **always `position: fixed` in one DOM node, docked or not.** Docked means its `left`/`top`
  are read from `dockRect`; floating means from `x`/`y`. It is never unmounted and re-mounted
  into the header, because a node that unmounts mid-drag loses its pointer capture and the drag
  dies in the reader's hand.
- **Two sizes, because the dock is a crowded rail.** FLOATING it is 56px on desktop and 48px below
  768px. **DOCKED it is 36px**, and that is Iris's ruling rather than an inheritance: the logo row
  it joins holds 30px icon buttons (`SidebarHeader.tsx:151`) beside a 26px serif wordmark that
  already `truncate`s, in a 328px rail — a 56px circle there would outweigh the app's own name.
  36px reads as the row's largest control without becoming its subject, and the wordmark must still
  render untruncated at a 320px viewport, which the probe checks.
- `border-radius: 9999px`, the accent fill, an `--elev-2` shadow, and `cursor: grab` —
  `cursor: grabbing` for the length of a drag, from the body class.
- The drag threshold is **4px**; below it the release is a click. The snap radius is
  **64px** measured centre to centre against `dockRect`.
- Clamped to the viewport with 8px of padding on every side, so it can never be thrown off screen.
- **`z-index: 60`, a measured number rather than a relative wish.** The stack it lands in, measured
  2026-09-16: the mobile sidebar drawer is `fixed inset-0 z-50` IN THE SAME TREE
  (`ProjectSidebarRegion.tsx:76`), `Dialog` is `z-50` PORTALLED to the body
  (`Dialog.tsx:185,205`), `ActionMenu` is `z-[70]` (`:214`), the app's ceiling is 10000
  (`McpServerFormModal.tsx:107`) and the toast stack is 10001 (`verve/feedback.css:73`). 60 beats
  the in-tree drawer — a FAB under that backdrop is dimmed, blurred and unclickable at exactly the
  moment the reader is trying to leave a pane — and loses to the portalled drawer it opens and to
  the menus inside it. The number lives in `surfaces.css` with those five neighbours in its comment.
- **It is reachable from the keyboard, and a drag never opens the drawer.** Enter and Space on a
  button fire `click`, not `pointerup`, so `onPress` on the pointer path alone would leave the
  drawer keyboard-unreachable; wiring `onClick` naively is the opposite trap, because the release
  ending a drag dispatches a click too. The house already solved this exact seam once:
  `src/modules/sidebar/hooks/useSimpleChatReorder.ts:188-194` swallows the post-drag click in an
  `onClickCapture` guard keyed on **`event.detail === 0`** — a keyboard click has no pointer behind
  it, so it is never swallowed. `DockableFab` uses that rule verbatim: `onPress` fires from a
  pointer release that never moved, AND from any `click` whose `detail` is 0; a click whose
  `detail` is non-zero after a moved gesture is swallowed.

```ts
// src/shared/ui/SplitPane.tsx
export const SPLIT_MIN_RATIO = 0.15;
export const SPLIT_MAX_RATIO = 0.85;

type SplitPaneProps = {
  ratio: number;                        // the LEFT pane's share; clamped to [MIN, MAX] on render
  onRatioChange: (next: number) => void;
  left: ReactNode;
  right: ReactNode | null;              // null -> the left pane fills and no divider renders
  dividerLabel: string;                 // aria-label on the separator
};
```

- The divider is `role="separator" aria-orientation="vertical"` carrying
  `aria-valuenow={Math.round(ratio * 100)}`, `aria-valuemin={15}`, `aria-valuemax={85}` — which is
  both the accessible shape and the only hook the browser probe needs.
- Left and Right arrows move it by 0.02 when it has focus. Drag moves it with the pointer.
- The clamp is the hub's, measured: `Math.min(0.85, Math.max(0.15, …))`
  (`design/Applications Hub.dc.html:284,358`).

```ts
// src/shared/ui/usePointerDrag.ts  — IN the kit, beside the two components that are its only
// consumers, and NOT exported from the barrel (the barrel is components).
export type PointerDragKind = 'fab' | 'split';

export function usePointerDrag(options: {
  kind: PointerDragKind;
  threshold?: number;                                   // default 4 (px)
  onMove: (p: { x: number; y: number; dx: number; dy: number }) => void;
  onEnd: (p: { x: number; y: number; dx: number; dy: number; moved: boolean }) => void;
}): { onPointerDown: (event: React.PointerEvent) => void };
```

**It belongs to the kit, not above it.** The frontend standard's clause is *"put a hook used by
multiple feature modules in `src/shared/hooks/`"* — this hook has zero feature-module consumers, so
the clause does not reach it. What does reach it is dependency direction: it writes `vv-dragging`
and `vv-drag-<kind>`, class names whose only meaning lives in `src/shared/ui/verve/surfaces.css`,
and its `PointerDragKind` names two kit components. Measured 2026-09-16: **no file under
`src/shared/ui/` imports from `src/shared/hooks/`** — they import only `cn` from `@/shared/utils`.
Putting it in `src/shared/hooks/` would point the kit's own mechanism upward out of the kit and then
back down at its stylesheet. It moves out the day a feature module wants it, which is the standard's
own rule (`SKILL.md:90`).

**This hook is the reason the whole feature works, and it carries the hub's hardest-won lesson.**
A drag that begins on a handle and continues over a cross-origin iframe dies, because the iframe
swallows the pointer events. The cure is a class on `document.body` for the length of the drag —
never an inline style write on the iframes, which React owns and would undo (`hub/README.md:65-67`).
Measured, from `hub/drag.js:58-63` and `:78-94`:

- on the first move past the threshold: `document.body.classList.add('vv-dragging', 'vv-drag-' + kind)`
- `setPointerCapture(event.pointerId)` on the handle at `pointerdown`
- the classes are removed in a `release()` bound to `pointerup` and `pointercancel` **in the
  capture phase**, so the panes regain hit-testing before any bubble-phase handler runs
- `release()` also runs on unmount, so a component torn down mid-drag cannot leave the whole
  application unclickable.

### The paint — `src/shared/ui/verve/surfaces.css`

A fourth Verve stylesheet beside `tokens.css` (208), `controls.css` (440), `feedback.css` (386)
and `board.css` (227) — measured 2026-09-16. `controls.css` is already past its own stated
ceiling, so nothing is squeezed into it. It holds `.vv-fab`, its docked and active variants,
`.vv-split`, `.vv-split__pane`, `.vv-split__divider`, and the four body-class rules above.
Colours come from tokens only; no hex literal, no `rgb(`. `.vv-fab` carries `z-index: 60` with the
five measured neighbours named in its comment, in the shape `feedback.css:59-60` already uses for
the toast stack's 10001 — a z-index in this house is a measurement with a receipt, not a guess.

**Import order in `src/shared/ui/index.ts` is load-bearing** (`index.ts:24-29`, measured):
`controls.css`, `feedback.css`, **`surfaces.css`**, then `board.css` LAST — board keeps the last
word because a lane card overrides `.vv-card` at equal specificity, and nothing in `surfaces.css`
shares a selector with either.

### The switcher module — `src/modules/app-switcher/`

| File | What |
|---|---|
| `index.ts` | the barrel: `AppSwitcherProvider`, `AppSwitcherDock`, `AppSwitcherFab`, `AppSwitcherLayer` — and nothing else |
| `context/AppSwitcherContext.tsx` | the one state home: the registry, the two panes, dual on/off, the ratio, the FAB position, the dock rect, the drawer's open flag. It exports the provider and the hook its siblings read it with |
| `AppSwitcherDock.tsx` | the dock anchor rendered in the sidebar header — a box the size of the FAB that reports its rect to the provider and paints nothing |
| `AppSwitcherFab.tsx` | composes `DockableFab` and hangs the drawer off it |
| `AppDrawer.tsx` | the sheet: the close action, the dual-screen switch, the Opens-in strip, the rows |
| `AppPane.tsx` | one iframe pane |
| `AppSwitcherLayer.tsx` | the panes over the main region, composed in `SplitPane` |
| `hooks/useAppRegistry.ts` | `GET /api/apps` on mount and on every drawer open; `{ apps, selfPorts, error, refresh }` |
| `utils/resolveAppUrl.ts` | the two pure functions above |
| `utils/appSwitcherStorage.ts` | `readAppSwitcherRecord()` / `writeAppSwitcherRecord(record)` — data, so it is built in Phase 5 beside the other non-rendering files |

**The context lives in `context/`, and no file here is named `*Provider.tsx`.** The frontend
standard says *"put a context primarily owned by one feature in `src/modules/<feature>/context/`"*,
and the repo is unanimous: measured 2026-09-16, ten contexts, every one at
`src/modules/<feature>/context/<Name>Context.tsx` (auth, chat, command-palette, live-bus,
memory-intake, plugins, project-workspace, task-master ×2), and **zero** files named
`*Provider.tsx` anywhere under `src/modules/`. The barrel's public surface is unchanged by this.

**The persisted record** — one `localStorage` key, `app-switcher`, per browser, never the server:

```ts
export type AppSwitcherRecord = {
  fab: { docked: boolean; x: number; y: number };
  dual: boolean;
  ratio: number;
};
```

Which apps are open is **not** persisted: a window that reopens into somebody else's application
instead of the workspace is a surprise, and the first paint gets slower for it.

**The default position** when nothing is stored: docked at a viewport ≥ 768px; floating at
`{ x: innerWidth - 72, y: innerHeight - 112 }` below it — the operator's "on mobile it floats from
the start". Once the reader moves it, storage wins at every width.

### The mounts — every call site, measured

**Anchored by SYMBOL, not by line.** This repo's own ruling (`docs/architecture/README.md`):
*"Line numbers are deliberately not used — they go stale, symbol names do not. If a symbol has
moved, grep for it."* That matters doubly here, because Project Constraint 12 turns a line that has
moved into a STOP.

| Where | Change |
|---|---|
| `ProjectWorkspaceShell.tsx`, the component's returned tree | wrap it in `<AppSwitcherProvider>`; give the main-region wrapper — the `<div className="flex min-w-0 flex-1 flex-col">` holding `<ProjectMainRegion />` — the class `relative`; render `<AppSwitcherLayer />` as that wrapper's last child; render `<AppSwitcherFab />` as the last sibling of `<ProjectCommandPalette />` inside the `fixed inset-0` container |
| `ProjectSidebarRegion.tsx`, both `<Sidebar>` call sites (the desktop branch and the mobile drawer branch, each already passing `tabs={tabs}`) | each gains `leading={<AppSwitcherDock />}`. The sidebar module never imports this one, exactly as it never imports the tabs — the comment above the `tabs` const says why |
| `SidebarHeader.tsx`, `SidebarHeaderProps` | gains `leading?: ReactNode`, documented like `tabs` |
| `SidebarHeader.tsx`, the desktop logo row and the mobile logo row | `{leading && !isCompact && …}` in the desktop row and `{leading && isCompact && …}` in the mobile one — the FIRST child of the row, a SIBLING of the anchor/`LogoBlock` branch, **never inside `LogoBlock`** |
| `src/modules/sidebar/` (the thread) | `leading` is threaded `Sidebar` → `SidebarContent` → `SidebarHeader`, the same path `tabs` takes. **Declare it `leading?:` OPTIONAL at all three**, unlike `SidebarContent`'s `tabs`, which is required (`SidebarContent.tsx:94`) — every other `Sidebar` call site must keep compiling |

**The trap, measured (`sidebar.md`, scout 3):** `LogoBlock` is called from four sites
(`SidebarHeader.tsx:141,144,244,247`) and two of them sit inside
`<a href="https://cloudcli.ai/dashboard">`. A button placed inside `LogoBlock` would be a button
inside an anchor — invalid HTML, and a click that navigates away instead of opening the drawer.
The slot goes in the logo ROW, above the anchor, which is why the two anchor branches are left
untouched.

**Exactly ONE dock mounts, because the slot is gated the way `tabs` is.** `SidebarHeader` draws its
desktop and mobile headers as two blocks and hides one with CSS, and it says so in its own comment
above the `isCompact` gate: *"a slot placed in both would put TWO live tablists on the page … The
strip is rendered into whichever block is actually on screen, and once."* `tabs` obeys that with
`{tabs && !isCompact}` and `{tabs && isCompact}`; `leading` obeys it identically. Two docks would
mean two `ResizeObserver`s writing one rect — and would be the direct cause of the off-screen rect
the next rules close.

**The dock rect is accepted only when it is REAL, and it is never allowed to go stale.** Four rules,
each written against a measured hole:

1. **Accept a rect only when it is non-zero AND intersects the viewport.** Zero size alone is not
   enough: the mobile sidebar is hidden with `invisible opacity-0` (`ProjectSidebarRegion.tsx`), and
   `visibility: hidden` KEEPS the layout box — `getBoundingClientRect()` answers full width and
   height — while the panel is translated `-translate-x-full`, roughly 85vw off the left edge. A
   record reading `docked: true` against that rect paints the FAB off-screen, and the FAB is the
   reader's only way out of a pane.
2. **The dock clears the rect when it unmounts.** `Sidebar` swaps `SidebarCollapsed` in for the
   whole header when the sidebar is collapsed, so the dock disappears entirely; an uncleared rect
   pins the FAB to a point that no longer exists.
3. **A null `dockRect` means the FAB floats at its clamped default**, whatever the record says. A
   docked FAB with nowhere to dock renders where it can be reached, never at a remembered ghost.
4. **Re-measure on `window` resize and whenever the sidebar's open or collapsed state changes**, not
   on `ResizeObserver` alone — an observer watches SIZE, and every hole above is a change of
   POSITION at constant size.

### The layer, the panes, and the way back out

- `AppSwitcherLayer` renders `null` when no application is open. The workspace is untouched
  underneath it in every other state too: it is `absolute inset-0` over the main region only, so
  the sidebar, the project list and a streaming chat all keep running while an application is up.
- One application open → one pane filling the layer. Dual screen on and two chosen → `SplitPane`
  with the divider between them.
- A pane is an iframe carrying, and carrying only:
  `src={resolved}` · `title={app.name}` · `referrerpolicy="no-referrer"` ·
  `allow="geolocation"` · `className="h-full w-full border-0"`.
  **`allow="geolocation"` is the fix for a measured hub defect** — the hub's iframes carried no
  `allow` attribute at all, so Descent's weather tile was refused the geolocation it asks for
  (`hub/README.md:29`).
  **There is deliberately NO `sandbox` attribute, and `AppPane.tsx` says so in a comment.** The
  house's two other cross-origin frames both carry one (`WidgetFrame.tsx` `sandbox="allow-scripts"`,
  `DocSpaceFrame.tsx` `DOCSPACE_SANDBOX`), so an unexplained absence here reads as an oversight. It
  is not: a sandbox without `allow-same-origin` would cut the framed app's `SameSite=Lax` session
  cookie, which is the whole premise of the EIS grant in R-EISBE-7 — these are the operator's own
  applications on his own host, not untrusted embeds.
- **Reload** bumps a per-pane `reloadNonce` used in the iframe's React `key`, which remounts the
  element. The hub swapped `src` to `about:blank` and back on a 30ms timer
  (`design/Applications Hub.dc.html:337-341`); a key bump is the same effect with no timer to
  race.
- **Open in a new tab** is `window.open(resolved, '_blank', 'noopener')`.
- **The way out is the FAB**, which floats above the panes and is never covered: its drawer
  carries a Close action that clears both panes, and a row already on screen reads "on screen"
  and closes that pane when it is clicked again.

### The drawer's composition

Composed, not invented — `DESIGN_DOCTRINE.md` §2: nothing here needs a mechanism the kit lacks.
`Dialog` + `DialogContent` as a right-hand sheet (the shape
`src/modules/kanban/card-drawer/KanbanCardDrawer.tsx` already uses), holding, in order:

1. `DialogTitle` with the applications label, and a Close `Button` that clears the panes.
2. A `Switch` labelled Dual screen.
3. When dual is on, a `PillBar` reading Opens in — Left / Right.
4. A `ScrollArea` of rows, file order. A row is a ghost `Button` (name, then the resolved host in
   muted type, then "on screen" when it is up) plus an `ActionMenu` carrying **Reload** and
   **Open in a new tab**.
5. An `EmptyState` when the registry is empty, and a `Banner` carrying the message when the
   registry could not be read.

A **self** row — the `cloudcli` row — renders with its menu reduced to Open in a new tab, and its
body click opens a new tab rather than a pane.

### i18n

Every user-visible word goes through `src/modules/i18n/locales/<lang>/common.json`, in an
`applications` block, in **all eleven locales** (`de en es fr it ja ko ru tr zh-CN zh-TW`).

**No new namespace file.** Adding one costs eleven imports, eleven `resources` edits and one `ns`
edit in `src/modules/i18n/config.ts:16-98,126-133,226` (measured) — the existing `common.json` is
where these keys belong. The keys:

```
applications.title          applications.fabLabel      applications.close
applications.dualScreen     applications.opensIn       applications.left
applications.right          applications.reload        applications.openInNewTab
applications.onScreen       applications.empty         applications.unreadable
applications.divider
```

A missing key in a non-English locale silently falls back to English (`config.ts:220`), so a
locale that is skipped fails silently — which is why a check counts all eleven.

### The EIS app's framing grant

Measured, 2026-09-16: `/opt/shadow-connector/.eis_backend.env:40` reads exactly

```
EIS_FRAME_ANCESTORS=http://100.103.222.79:8006,http://192.168.1.95:8006,http://eis1.tail8717cd.ts.net:8006,http://localhost:8006,http://127.0.0.1:8006
```

`eis_backend/middleware.py:67-83` parses it at import into `_FRAME_ANCESTORS`, and
`SecurityHeadersMiddleware` (`middleware.py:200-227`) writes `frame-ancestors <origins>` into the
CSP and DELETES `X-Frame-Options` when the list is non-empty. `R-EISBE-7` (`GOTCHAS.md:434-460`)
is the rule; its framing clause names the hub as today's only embedder, and that sentence is part
of what this plan changes.

**CloudCLI's origins are the eight names a browser can open this app on** — the five the hub was
granted, moved to the port the browser actually uses, plus the bare tailnet name and both loopback
forms of the API port. Measured from the live units and interfaces (`serving.md`, scout 2):
Vite serves the app on `0.0.0.0:5183` (`cloudcli-client-dev.service`), the API on `127.0.0.1:3011`
(`cloudcli-server-dev.service`), the Tailscale address is `100.103.222.79`, the tailnet name
`eis1` / `eis1.tail8717cd.ts.net`, the LAN address `192.168.1.95`.

```
http://100.103.222.79:5183,http://192.168.1.95:5183,http://eis1.tail8717cd.ts.net:5183,http://eis1:5183,http://localhost:5183,http://127.0.0.1:5183,http://localhost:3011,http://127.0.0.1:3011
```

Dispatch (`:8003`) sends `X-Frame-Options: DENY` and is not changed: its row opens in a new tab.
That is an accepted property of that application, not a defect to route around.

### The real-system harness — `scripts/apps-probe-env.sh`

One tracked helper, sourced by every verify command in this plan, so the recipe lives in one place
instead of being pasted into fifteen. Its three functions are the ones proven on this box during
the Kanban build (2026-09-15) with one addition: booting is idempotent, so a verify that finds the
probe server already up reuses it.

```bash
PROBE_PORT="${PROBE_PORT:-7893}"
mint_token         # HS256 JWT for the first user, signed with app_config.jwt_secret from ~/.cloudcli/auth.db
boot_probe_server  # reuse ONLY a server this script started (live pid file + the port answers);
                   # else SERVER_PORT=7893 tsx server/index.ts, wait up to 90s
stop_probe_server  # kill the pid it wrote, and restore the ~/.cloudcli/local-server.json it copied aside
```

**Reuse is pid-scoped on purpose.** A phase that changed server code must not be verified against
a server another phase left running, so `boot_probe_server` reuses only a process whose pid it
wrote itself, and **every phase's FIRST verify calls `stop_probe_server` before it boots**, which
is why each phase in this plan begins its first boot with that line.

`boot_probe_server` copies `~/.cloudcli/local-server.json` to `/tmp/apps-marker.bak` first and
`stop_probe_server` copies it back: the second server rewrites that marker and deletes it on exit,
and this backup-copy revert is the doctrine's alternative to a git restore.

### The browser probe — `scripts/apps-ui-probe.mjs`

`node scripts/apps-ui-probe.mjs <app-url> <token> <fab-label>` drives the built SPA over the
DevTools protocol, prints one `KEY=value` line per reading and then exactly one verdict line,
`PROBE OK` or `PROBE FAILED`. `node scripts/apps-ui-probe.mjs --selftest <app-url> <token>` runs
the plumbing alone and nothing else — launch, seed the token, load the app, assert the wordmark
renders — printing `BOOT=1` and its verdict. That path exists so the phase that WRITES the probe
also runs it: without it, a 450-line CDP driver's first execution would be two waves away, in a
gate where a failure of the probe's plumbing is indistinguishable from a failure of the switcher,
and the fix-pass budget gets spent on the wrong file.

**The window is set explicitly to 1280×900 before anything is read.** Below 768px the app is in its
touch layout, the desktop header is `display: none` and the default FAB position is floating — so a
headless default viewport could pass every reading below WITHOUT THE DOCK EVER EXISTING. The
viewport is part of the contract, not an ambient property of whoever's machine runs it. Its browser plumbing — launching
`chrome-headless-shell`, the CDP socket, writing the token into `localStorage` under `auth-token`,
reloading, waiting for text — is the plumbing `scripts/kanban-ui-probe.mjs` already proves on this
box; that file is the starting point and its mechanics are kept.

The scenario, in order, and the line each step prints:

| # | Action | Line |
|---|---|---|
| 1 | load, seed the token, reload, wait for the button whose `aria-label` is `<fab-label>` | `FAB=1` |
| 2 | click it; wait for the dialog | `DRAWER=1` and `ROWS=<n>` |
| 3 | click the row reading `Descent`; wait for an iframe | `PANES=1`, `PANE0SRC=<src>`, `PANE0ALLOW=<allow>` |
| 4 | reopen the drawer, turn Dual screen on, click `ArchPulse` | `PANES=2`, `SPLIT=1` |
| 5 | drag the `[role="separator"]` to 25% of the layer's width | `RATIO=<left width / total, 2dp>` |
| 6 | read the FAB's rect against the `AppSwitcherDock` box's rect on first paint | `DOCKED=1` |
| 7 | drag the FAB by +180,+90 | `FABMOVED=1` |
| 8 | drag it back to within 64px of the dock's centre and release; re-read its rect | `FABSNAPPED=1` |
| 9 | reload the page and read the FAB's rect again | `FABPERSIST=1` |
| 10 | resize to 320×900 and read the wordmark's `scrollWidth` against its `clientWidth` | `WORDMARK=1` when it is not truncated |

A step that cannot be completed prints its key with `=0` and the probe ends `PROBE FAILED`; the
explanation goes to stderr. Nothing is hard-coded: the url, the token and the label are arguments.

## Project Constraints

Copied verbatim to every child. These are the rules and the mechanics, both.

1. **No test files, ever.** No `*.test.ts`, no `*.spec.ts`, no vitest file, no new entry under any
   `tests/` directory. The repo's backend and frontend standards documents each ask for tests;
   that clause is OVERRIDDEN by the operator's standing rule, and the checks in this plan are the
   verification. If a standards document and this line disagree, this line wins.
2. **No branches, and no git writes of any kind inside the run** — no `add`, `commit`, `stash`,
   `checkout`, `restore`, `reset`, `clean`, `push`. The work ends in the working tree. A probe is
   undone from a backup copy taken by the same command, never with `git checkout --`. Deleting the
   hub is `rm -rf`, never `git rm`.
3. **Healed means deleted.** No SUPERSEDED block, no "previously this was…", no pointer to removed
   text, no dead tempting code left behind. When the hub goes, every sentence naming it is either
   corrected to name CloudCLI or removed — never annotated.
4. **Module size.** 300 LOC is the default ceiling, 500 soft, 800 hard. When a file in this plan
   would cross 300, split it by cohesion into a sibling rather than growing it. Two exceptions are
   already granted, at plan time, and are not yours to re-argue: `scripts/apps-ui-probe.mjs` is a
   single sequential browser driver and may reach 450 lines (its sibling
   `scripts/kanban-ui-probe.mjs` is 398), and `src/modules/sidebar/SidebarHeader.tsx` is already
   305 lines and takes about six more for the `leading` slot. **Never open
   `server/shared/types.ts` or `src/shared/types.ts`** — no phase in this plan touches either.
5. **Never touch `server/modules/kanban/`, `src/modules/kanban/`, `src/shared/ui/KanbanLane.tsx`,
   `src/shared/ui/KanbanCard.tsx`, `src/shared/ui/verve/board.css` or
   `scripts/kanban-ui-probe.mjs`.** The board is shipped and its probe is somebody else's
   verification. Read them as patterns; change nothing in them.
6. **The real-system harness.** Source `scripts/apps-probe-env.sh` and use its three functions
   rather than inventing a variant. The first phase creates it; every later phase's verify begins
   `. scripts/apps-probe-env.sh`.
7. **Probe data is cleaned up by the command that made it.** A verify that adds a registry row
   names it `probe-phase<N>` and DELETEs it before the command ends, so re-running the check finds
   the same seven rows again.
8. **A second server is always live, and it writes what you write.** The operator's own API runs on
   3011 against the same `auth.db` AND the same application root, under
   `cloudcli-server-dev.service` → `deploy/dev-supervisor/supervisor.mjs`, which HOT-RESTARTS it on
   any save under `server/`. So from the moment Phase 1 lands there are two processes creating and
   reading `apps.local.json`: every create is `flag: 'wx'` with `EEXIST` swallowed, never
   `existsSync` then write. On a `SQLITE_BUSY` run the command once more; if it fails again, file
   `[BLOCKED: sqlite busy]` rather than changing a pragma or a path.
9. **Never run `npm run dev`** (it starts Vite and the server together and never exits). Use
   `npm run build:client` plus the boot function. Any command that can exceed two minutes carries
   a `timeout` or runs in the background.
10. **`docs/applications.md` is the ONE documentation home for this feature.** No phase — and no
    doc sweep in any phase — creates `server/modules/apps/README.md`,
    `src/modules/app-switcher/README.md` or any other new document about the switcher.
11. **`sudo` is passwordless on this box** (`sudo -n -l` shows `(ALL) NOPASSWD: ALL`, measured
    2026-09-16), so the systemd work in this plan runs unattended. `sudo systemctl` calls are
    ordinary steps, not a reason to stop.
12. **The divergence rule.** If reality differs from this plan — a file is not where it says, a
    signature differs, a check fails for a reason the plan does not name — STOP, report the
    divergence verbatim, and do not improvise a fix.

## Phase 1 — The registry, its file, and `/api/apps`
Depends on: none

```toml
[phase]
id = "1"
builder = "hephaestus"
model = "opus"
code_change = true
doc_sweep = "foreground"
expected_s = 2400
manifest = [
  "server/shared/app-types.ts",
  "server/modules/apps",
  "server/index.ts",
  ".gitignore",
  ".oxlintrc.json",
  "scripts/apps-probe-env.sh",
]
forbidden = [
  "server/modules/kanban",
  "server/modules/descent",
  "server/shared/types.ts",
  "src",
  "scripts/kanban-ui-probe.mjs",
]
athena = [
  "The registry path is built from process.cwd() instead of findApplicationRoot(getModuleDirectory(import.meta.url)), so the file lands wherever the process happened to start",
  "A read REPAIRS a corrupt or unexpected registry by overwriting it with the seed, which silently deletes the operator's own rows",
  "The seeded entries differ from the hub's apps.json in any character -- a renamed id, a changed port, a resolved {host}, a dropped /dashboard path",
  "The write is a plain truncating writeFileSync rather than a temp file plus rename, so an interrupted write leaves an unreadable registry",
  "authenticateToken was imported inside a route file instead of riding the mount, or the mount was placed outside the flat block",
  "ensureAppsFile() at module creation is not wrapped, so an unwritable application root takes the entire API down for a list of links",
  "The create is existsSync-then-write rather than flag wx, which is a TOCTOU against the dev supervisor's live server writing the same path",
  "server/shared/app-types.ts was added without its entry in .oxlintrc.json's backend-shared-utils list, so boundaries/no-unknown reddens the lint gate",
  "Validation lives in the route rather than the service, so a POST through a different caller skips it",
  "A duplicate id overwrites the existing row instead of answering 409",
  "apps.local.json is missing from .gitignore, so the operator's private list becomes a tracked file",
  "The code attempt 1 wrote sits in this attempt's diff baseline (the spec moved, so the runner re-snapshotted over it), so the patch under review can be empty over code no reviewer has read -- every item above is judged against server/modules/apps/*, server/shared/app-types.ts, scripts/apps-probe-env.sh, the apps import and mount in server/index.ts, the app-types entry in .oxlintrc.json and the apps.local.json line in .gitignore read WHOLE as they stand on disk, never against the diff alone",
  "server/tsconfig.json does not reach a phase file, so the server-only typecheck gate is green over code tsc never compiled -- server/shared/app-types.ts and every server/modules/apps file must fall under its include globs and not under its exclude list",
]

[[steps]]
kind = "edit"
path = "scripts/apps-probe-env.sh"
what = "TWO STANDING ORDERS FOR THE WHOLE PHASE, read before any step. (A) Attempt 1 of this phase already wrote every manifest file, and every check and verify of this phase except the typecheck step passed against it (measured by the runner 2026-09-16; that step failed only on type errors in another session's in-flight universe module on the client side, which this phase does not own). So where a step's file already exists, READ it against its step and change only what diverges from the step; never rewrite a file that already meets its step. (B) No Bash or Monitor command you run may contain the text of any MUST-NOT entry -- not the three letters src anywhere in the line, not server/modules/kanban, server/modules/descent, server/shared/types.ts or scripts/kanban-ui-probe.mjs -- not even inside a read such as git status, git diff or grep, and never inside a compound line. The runner's guard matches those names by substring in shell text, it filed attempt 1's read-only git status over them as a write, and another session is editing files under the client tree while you work, so one such line blocks this phase again. Do not check whether you touched them: the runner's guard proves that itself. If you must look inside one, use the Read, Grep or Glob tool, never a shell. THEN, the step: Create the sourced harness described in Interfaces: PROBE_PORT defaulting to 7893, mint_token (python3 heredoc reading app_config.jwt_secret and the first users row from ~/.cloudcli/auth.db and printing an HS256 JWT valid for an hour), boot_probe_server (return immediately ONLY when /tmp/apps-server.pid names a live process AND the port answers /api/auth/status -- a server this script did not start is never reused, because a phase that changed server code must not be verified against another phase's process; otherwise copy ~/.cloudcli/local-server.json to /tmp/apps-marker.bak, start SERVER_PORT=$PROBE_PORT node_modules/.bin/tsx --tsconfig server/tsconfig.json server/index.ts in the background writing /tmp/apps-server.log and /tmp/apps-server.pid, and poll the same endpoint for up to 90 seconds), and stop_probe_server (kill that pid, remove the pid file, copy the marker back). It is sourced, never executed as a program, and no application code imports it."
check = "bash -n scripts/apps-probe-env.sh && grep -c 'stop_probe_server()' scripts/apps-probe-env.sh"
expect = "1"

[[steps]]
kind = "edit"
path = "server/shared/app-types.ts"
what = "Create the file with exactly the two exported types in Interfaces -- AppEntry and AppRegistryResponse -- each carrying the doc comment shown there. Nothing else goes in this file, and server/shared/types.ts is not opened."
check = "grep -cE '^export type (AppEntry|AppRegistryResponse)' server/shared/app-types.ts"
expect = "2"

[[steps]]
kind = "edit"
path = "server/modules/apps/apps.seed.ts"
what = "Export DEFAULT_APPS: AppEntry[] holding the seven entries from the Interfaces seed block, character for character, with {host} left unresolved and the /dashboard path on cerberus intact. A doc comment names its one consumer, apps.store.ts, and records that these rows were copied from the Applications Hub's apps.json."
check = "grep -c 'http://{host}:' server/modules/apps/apps.seed.ts"
expect = "7"

[[steps]]
kind = "edit"
path = "server/modules/apps/apps.store.ts"
what = "The registry file itself: resolve its path with process.env.APPS_FILE or findApplicationRoot(getModuleDirectory(import.meta.url)) joined with 'apps.local.json' -- both helpers come from '@/shared/utils.js', the idiom at server/modules/deepseek/index.ts:31. Export ensureAppsFile() (write DEFAULT_APPS with writeFileSync(path, seed, { flag: 'wx' }) and SWALLOW an EEXIST error -- never existsSync-then-write, which is a TOCTOU against the operator's own live server writing the same path; a file that exists is never touched), readApps() (ensure, then read and JSON.parse, throwing the AppError shapes named in Interfaces for a non-array root or an invalid entry) and writeApps(entries) (JSON.stringify with two-space indent to <path>.tmp in the same directory, then renameSync onto the real name). No caching between calls."
check = "grep -c 'findApplicationRoot' server/modules/apps/apps.store.ts"
expect_re = "^[1-9][0-9]*$"

[[steps]]
kind = "edit"
path = "server/modules/apps/apps.service.ts"
what = "Export appsService with listApps, addApp and removeApp exactly as Interfaces gives them, holding ALL validation: the id pattern and the minting rule from a name, the 1-64 character name, the url that must parse as absolute http/https once {host} is replaced by localhost, 409 on a duplicate id and 404 on an unknown id, both as AppError from '@/shared/utils.js' with an explicit statusCode. listApps returns { apps, selfPorts } with selfPorts read from SERVER_PORT and VITE_PORT exactly as server/index.ts:318,321 reads them."
check = "grep -cE 'listApps|addApp|removeApp' server/modules/apps/apps.service.ts"
expect_re = "^[3-9]|^[1-9][0-9]+$"

[[steps]]
kind = "edit"
path = "server/modules/apps/apps.routes.ts"
what = "Export createAppsRouter(): Router with the three thin routes from Interfaces -- GET '/', POST '/', DELETE '/:id' -- each one calling the service and passing any error to next(error). No validation, no file access and no authenticateToken import here: the guard rides the mount."
check = "grep -cE \"router\\.(get|post|delete)\\(\" server/modules/apps/apps.routes.ts"
expect = "3"

[[steps]]
kind = "edit"
path = "server/modules/apps/apps.module.ts"
what = "Export createAppsModule(): Router -- the composition root in the shape of server/modules/kanban/kanban.module.ts: call ensureAppsFile() once so the registry exists from the first boot, INSIDE a try/catch that logs and continues (a read-only packaged root must never take the API down for a list of links; the routes already answer 500 on an unreadable registry), then build one express.Router() and mount createAppsRouter() on it. Create server/modules/apps/index.ts beside it exporting createAppsModule and nothing else."
check = "grep -c 'createAppsModule' server/modules/apps/index.ts"
expect_re = "^[1-9][0-9]*$"

[[steps]]
kind = "edit"
path = "server/index.ts"
what = "Import createAppsModule from '@/modules/apps/index.js' beside the other module imports, and add ONE mount line in the flat block directly after the kanban mount at line 192: app.use('/api/apps', authenticateToken, createAppsModule()); Nothing else in this file changes."
check = "grep -cE \"^app\\.use\\('/api/apps', authenticateToken, createAppsModule\\(\\)\\);\" server/index.ts"
expect = "1"

[[steps]]
kind = "edit"
path = ".oxlintrc.json"
what = "Add the ONE string \"server/shared/app-types.ts\" to the backend-shared-utils element's pattern list, as the last entry after \"server/shared/kanban-types.ts\" (around line 80). That list is an explicit file enumeration and boundaries/no-unknown is an error, so a new file under server/shared/ that is not listed reddens npm run lint:server the moment anything imports it. This file is JSONC -- it carries // comments -- so edit it as text and never round-trip it through a JSON serialiser, which would strip every comment in it. Add nothing else and change no rule."
check = "grep -c '\"server/shared/app-types.ts\"' .oxlintrc.json"
expect = "1"

[[steps]]
kind = "edit"
path = ".gitignore"
what = "Add exactly one line, apps.local.json, under a one-line comment saying it is the application registry, created on first boot and private to this machine."
check = "grep -cx 'apps.local.json' .gitignore"
expect = "1"

[[steps]]
kind = "run"
cmd = "node_modules/.bin/tsc --noEmit -p server/tsconfig.json && npm run lint:server"
check = "node_modules/.bin/tsc --noEmit -p server/tsconfig.json > /tmp/apps-p1-tc.log 2>&1 && npm run lint:server > /tmp/apps-p1-lint.log 2>&1 && echo GREEN || (tail -5 /tmp/apps-p1-tc.log; tail -5 /tmp/apps-p1-lint.log)"
expect = "GREEN"
timeout_s = 600

[[verify]]  # create-when-absent, proven through the APPS_FILE override so the real registry is never touched
#            (the service is forbidden to destroy the operator's list; so is this plan's own verify)
cmd = '''
. scripts/apps-probe-env.sh
stop_probe_server > /dev/null 2>&1 || true
rm -f /tmp/apps-probe-registry.json
APPS_FILE=/tmp/apps-probe-registry.json boot_probe_server > /dev/null
TOKEN=$(mint_token)
curl -sf -H "Authorization: Bearer $TOKEN" http://127.0.0.1:7893/api/apps \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print('apps=%d ids=%s' % (len(d['apps']), ','.join(a['id'] for a in d['apps'])))"
'''
expect = "apps=7 ids=descent,eis-app,dispatch,cerberus,archpulse,storybook,cloudcli"
timeout_s = 300

[[verify]]  # the file the server created is the seed, with {host} unresolved
cmd = "python3 -c \"import json; d=json.load(open('/tmp/apps-probe-registry.json')); print(d[0]['url'], d[3]['url'], len(d))\""
expect = "http://{host}:7878 http://{host}:8001/dashboard 7"

[[verify]]  # the guard rides the mount: no token, no registry
cmd = '''
. scripts/apps-probe-env.sh
boot_probe_server > /dev/null
curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:7893/api/apps
'''
expect = "401"
timeout_s = 180

[[verify]]  # a POST appends and a DELETE removes, and the file is what changed
cmd = '''
. scripts/apps-probe-env.sh
boot_probe_server > /dev/null
TOKEN=$(mint_token)
curl -sf -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"name":"probe phase1","url":"http://{host}:9999"}' http://127.0.0.1:7893/api/apps > /tmp/apps-p1-post.json
ADDED=$(python3 -c "import json; print(json.load(open('/tmp/apps-p1-post.json'))['app']['id'])")
COUNT_AFTER=$(python3 -c "import json; print(len(json.load(open('/tmp/apps-probe-registry.json'))))")
curl -sf -X DELETE -H "Authorization: Bearer $TOKEN" "http://127.0.0.1:7893/api/apps/$ADDED" > /dev/null
COUNT_BACK=$(python3 -c "import json; print(len(json.load(open('/tmp/apps-probe-registry.json'))))")
echo "added=$ADDED after=$COUNT_AFTER back=$COUNT_BACK"
'''
expect = "added=probe-phase1 after=8 back=7"
timeout_s = 300

[[verify]]  # a registry that exists is never repaired: a broken one is a 500 and survives untouched
#            every verify in this phase rides the APPS_FILE the first one booted with, so the
#            operator's own apps.local.json is never read, written or deleted by this plan
cmd = '''
. scripts/apps-probe-env.sh
boot_probe_server > /dev/null
TOKEN=$(mint_token)
printf '{ not json' > /tmp/apps-probe-registry.json
CODE=$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $TOKEN" http://127.0.0.1:7893/api/apps)
STILL=$(cat /tmp/apps-probe-registry.json)
rm -f /tmp/apps-probe-registry.json
stop_probe_server
echo "code=$CODE kept=$STILL"
'''
expect = "code=500 kept={ not json"
timeout_s = 300
```

**What to build.** One server module, two types, one mount line, one ignore line, one sourced
harness. Nothing in `src/`. The type gate is the SERVER project alone
(`tsc --noEmit -p server/tsconfig.json`): every file this phase writes is under its `include`
(`./**/*.ts`, which reaches `server/shared/`), and the root `tsconfig.json` includes only `src`,
the root `shared` and `vite.config.js`, none of which this phase touches.

**Sirens.** You will see `npm run typecheck` red on `PerfSample` errors in
`src/modules/universe/` — that is another session's in-flight work in a MUST-NOT tree, and it is
why this phase's gate runs the server project only; do not open it, do not fix it, do not run the
client half to see whether it cleared. You will want to prove you left the MUST-NOT paths alone
with a `git status` or `git diff` over them — do not; the runner's guard proves it, and a shell
line naming one of them is exactly what blocked attempt 1. You will find attempt 1's files already
on disk — do not rewrite them to "make the diff show"; read each against its step and change only
what diverges. You will want to make a corrupt registry heal itself, because a 500 looks unfriendly —
do not; the file is the operator's list and overwriting it on one stray comma is how a list
disappears. You will want to cache the parsed file because reading it on every request looks
wasteful — do not; reading it every time is the whole feature, and it is a few hundred bytes. You
will want to add a `PATCH` because an edit verb feels missing — it is deliberately absent; a
`DELETE` and a `POST` say the same thing and there is one less surface to keep right. You will
want to seed with a resolved host because `{host}` looks like a bug — it is the mechanism that
makes one file serve LAN and Tailscale; leave every character alone. You will want to put
`apps.local.json` under `~/.cloudcli/` beside `auth.db` because that is where this app keeps state
— the operator asked for a git-ignored file in the project, which is what "it should be
Git-ignored" means. You will want to prove create-when-absent by deleting the real
`apps.local.json` — every verify here boots with `APPS_FILE=/tmp/apps-probe-registry.json` for
exactly that reason: this plan's own checks may not do what its service is forbidden to do. You
will want to reach for `existsSync` before writing, because `wx` looks obscure — the operator's own
server is running against this same path and hot-restarts on every save you make under `server/`,
so the gap between the check and the write is a real race with a real second writer. You will want
to let `ensureAppsFile()` throw at module creation so a broken setup is loud — it is mounted at
import time, and a throw there takes down chat, files, git and everything else for the sake of a
list of links. You will see the boot log fill with unrelated warnings from other modules;
they are not yours.

## Phase 2 — The EIS app grants CloudCLI's origins the right to frame it
Depends on: none

```toml
[phase]
id = "2"
builder = "hephaestus"
model = "opus"
code_change = true
doc_sweep = "foreground"
expected_s = 1200
manifest = [
  "/opt/shadow-connector/.eis_backend.env",
  "/opt/shadow-connector/eis_backend/GOTCHAS.md",
]
forbidden = [
  "server",
  "src",
]
athena = [
  "An origin was written with a trailing slash, a wildcard, a path, or 'self' -- middleware.py validates each entry at import and silently SKIPS a malformed one, so the list can shrink without any error",
  "The hub's five :8006 origins were removed in this phase, which would break the hub before its replacement exists",
  "The app's own port was guessed rather than taken from the measured units: the browser opens this app on 5183, not 3011 and not 3001",
  "The service was edited but never restarted, so the header on the wire still carries the old list",
  "R-EISBE-7's framing clause still says the Applications Hub is the only embedder after this change",
  "X-Frame-Options came back on the response, which would contradict the CSP and block the frame anyway",
]

[[steps]]
kind = "edit"
path = "/opt/shadow-connector/.eis_backend.env"
what = "Extend the single EIS_FRAME_ANCESTORS line at line 40 by APPENDING, comma-separated with no spaces, the eight CloudCLI origins listed in Interfaces. The hub's five :8006 origins stay exactly where they are -- Phase 8 removes them once the switcher has replaced it. Change no other line in this file."
check = "grep -c 'http://eis1.tail8717cd.ts.net:5183' /opt/shadow-connector/.eis_backend.env"
expect = "1"

[[steps]]
kind = "edit"
path = "/opt/shadow-connector/eis_backend/GOTCHAS.md"
what = "In R-EISBE-7's framing clause (around line 447-457) the sentence reading 'Today the list is the Applications Hub (~/.claude/hub, :8006) under every name this host answers to' is no longer true. Rewrite that sentence to say the list names TWO embedders today -- the Applications Hub on :8006 and LypheCLI/CloudCLI's application panes on :5183 (plus its loopback API on :3011) -- and keep the clause's point intact: the embedder frames the app on the SAME host it was opened from, which is what keeps the SameSite=Lax session cookie riding inside the frame. Change nothing else in the file."
check = "grep -c '5183' /opt/shadow-connector/eis_backend/GOTCHAS.md"
expect_re = "^[1-9][0-9]*$"

[[steps]]
kind = "run"
cmd = "sudo systemctl restart eis-app"
check = "systemctl is-active eis-app"
expect = "active"
timeout_s = 180

[[verify]]  # the header on the wire names CloudCLI's tailnet and LAN origins
cmd = '''
sleep 3
curl -s -o /dev/null -D - http://127.0.0.1:8004/ | tr -d '\r' | grep -i '^content-security-policy:' \
  | grep -o 'frame-ancestors[^;]*' \
  | python3 -c "import sys; s=sys.stdin.read(); print('tailnet=%s lan=%s hub=%s' % ('http://eis1.tail8717cd.ts.net:5183' in s, 'http://192.168.1.95:5183' in s, 'http://100.103.222.79:8006' in s))"
'''
expect = "tailnet=True lan=True hub=True"
timeout_s = 120

[[verify]]  # X-Frame-Options is still dropped, so nothing contradicts the CSP
cmd = "{ curl -s -o /dev/null -D - http://127.0.0.1:8004/ | tr -d '\\r' | grep -ci '^x-frame-options:' || true; }"
expect = "0"
timeout_s = 120

[[verify]]  # every origin the env file names survived middleware.py's import-time validation
cmd = '''
ENVCOUNT=$(grep '^EIS_FRAME_ANCESTORS=' /opt/shadow-connector/.eis_backend.env | sed 's/^EIS_FRAME_ANCESTORS=//' | tr ',' '\n' | grep -c .)
HDRCOUNT=$(curl -s -o /dev/null -D - http://127.0.0.1:8004/ | tr -d '\r' | grep -i '^content-security-policy:' | grep -o 'frame-ancestors[^;]*' | sed 's/frame-ancestors //' | tr ' ' '\n' | grep -c .)
echo "env=$ENVCOUNT header=$HDRCOUNT"
'''
expect = "env=13 header=13"
timeout_s = 120
```

**What to build.** One line extended in one env file, one stale sentence corrected, one restart.

**Sirens.** You will want to grant `http://eis1:5183` a matching `https://` twin, or to add a
wildcard so this never has to be touched again — do not; `middleware.py` validates exact origins
and quietly skips anything else, so a wildcard reads as an empty grant and the pane goes black
with no error anywhere. You will want to tidy the hub's five origins away while you are in the
line — they belong to a service that is still running; Phase 8 removes them. You will want to
restart `shadow-connector` as well because the name looks related — the unit is `eis-app`, and it
is the only one that serves `:8004`. You will want to verify by loading the app in a browser —
the header is the fact; the browser comes later, in Phase 7.

## Phase 3 — Kit scaffold: DockableFab, SplitPane, and the fourth stylesheet
Depends on: none

```toml
[phase]
id = "3"
kind = "scaffold"
builder = "iris"
model = "opus"
code_change = true
doc_sweep = "foreground"
expected_s = 2400
manifest = [
  "src/shared/ui/DockableFab.tsx",
  "src/shared/ui/SplitPane.tsx",
  "src/shared/ui/verve/surfaces.css",
  "src/shared/ui/index.ts",
]
forbidden = [
  "src/shared/ui/verve/controls.css",
  "src/shared/ui/verve/feedback.css",
  "src/shared/ui/verve/board.css",
  "src/shared/ui/verve/tokens.css",
  "src/shared/ui/KanbanCard.tsx",
  "src/shared/ui/KanbanLane.tsx",
  "src/modules",
  "package.json",
]
athena = [
  "A colour literal or a hex value appears in either component instead of a token or a vv- class",
  "The FAB is written to render inside the sidebar when docked and in a portal when floating -- two mount points for one node, which loses pointer capture mid-drag",
  "The divider is a plain div with no role=separator and no aria-valuenow, leaving the only hook the probe has and the only keyboard path a reader has both missing",
  "The clamp constants are spelled as literals inside the component instead of the exported SPLIT_MIN_RATIO and SPLIT_MAX_RATIO",
  "A handler body was implemented instead of left as a FILL: marker, so behaviour ships in the phase that was meant to compose only",
  "surfaces.css was imported after board.css, or one of its rules duplicates a selector that already lives in controls.css or feedback.css",
  "A user-visible word is written into either component instead of arriving as a prop",
  "The FAB carries a relative z-index, or one below 50, which puts it under the mobile sidebar drawer's backdrop at the moment the reader is trying to leave a pane",
  "The docked FAB is drawn at the floating size, so a 56px circle outweighs the 26px wordmark and the 30px buttons in a 328px rail",
  "The FAB is a div, or a button with no aria-label, so the keyboard path the ruling requires cannot exist",
  "A new npm dependency was added for dragging or splitting",
]

[[steps]]
kind = "edit"
path = "src/shared/ui/DockableFab.tsx"
what = "Compose the FAB to the Iris ruling in Interfaces: the prop type verbatim, one always-fixed node, the TWO ruled sizes (36px docked; 56px floating on desktop and 48px floating under 768px), the pill radius, the accent fill, the elevation, cursor grab, z-index 60, a real <button> carrying aria-label from the label prop and aria-expanded from active, and the docked branch that reads left/top from dockRect against the floating branch that reads x/y. Export DockableFabPosition. Every handler body is the single line // FILL: <name> and nothing else -- onPointerDown, the drag maths, the dock hit-test and the click-versus-drag decision are all Phase 4's. No word of copy is written in this file; every string arrives as a prop."
check = "grep -c 'DockableFabPosition' src/shared/ui/DockableFab.tsx"
expect_re = "^[1-9][0-9]*$"

[[steps]]
kind = "edit"
path = "src/shared/ui/SplitPane.tsx"
what = "Compose the split pane to the ruling: the prop type verbatim, the exported SPLIT_MIN_RATIO and SPLIT_MAX_RATIO constants, a flex row whose left pane takes the clamped ratio as its flex-basis and whose right pane takes the rest, both with min-width 0, and a divider carrying role=separator, aria-orientation=vertical, aria-valuenow, aria-valuemin 15, aria-valuemax 85, aria-label from dividerLabel and tabIndex 0. When right is null the left pane fills and no divider renders at all. Every handler body is // FILL: <name> -- the pointer drag and the arrow-key steps are Phase 4's."
check = "grep -c 'role=\"separator\"' src/shared/ui/SplitPane.tsx"
expect = "1"

[[steps]]
kind = "edit"
path = "src/shared/ui/verve/surfaces.css"
what = "Create the fourth Verve stylesheet holding every .vv-fab, .vv-fab--docked, .vv-split, .vv-split__pane and .vv-split__divider rule the two components reference -- .vv-fab carrying z-index: 60 with the five measured neighbours named in its comment, in the shape feedback.css:59-60 uses for the toast stack -- plus the four body-class rules from Interfaces: body.vv-dragging sets user-select none, body.vv-dragging iframe sets pointer-events none, body.vv-drag-fab sets cursor grabbing and body.vv-drag-split sets cursor col-resize. Colours come from tokens only. Nothing here duplicates a rule already in controls.css or feedback.css."
check = "grep -c 'body.vv-dragging iframe' src/shared/ui/verve/surfaces.css"
expect = "1"

[[steps]]
kind = "edit"
path = "src/shared/ui/index.ts"
what = "Side-effect import surfaces.css BETWEEN feedback.css and board.css -- board.css must stay last, and the comment at lines 26-28 explains why. Export DockableFab and SplitPane in the existing alphabetical value block, and export type DockableFabPosition plus the two SPLIT_ ratio constants in the existing type/value export lines."
check = '''
F=$(grep -n "verve/feedback.css" src/shared/ui/index.ts | cut -d: -f1)
S=$(grep -n "verve/surfaces.css" src/shared/ui/index.ts | cut -d: -f1)
B=$(grep -n "verve/board.css" src/shared/ui/index.ts | cut -d: -f1)
[ -n "$S" ] && [ "$F" -lt "$S" ] && [ "$S" -lt "$B" ] && echo ORDER-OK || echo "ORDER-BAD f=$F s=$S b=$B"
'''
expect = "ORDER-OK"

[[steps]]
kind = "run"
cmd = "node_modules/.bin/tsc --noEmit -p tsconfig.json && npm run lint:client"
check = "node_modules/.bin/tsc --noEmit -p tsconfig.json > /tmp/apps-p3-tc.log 2>&1 && npm run lint:client > /tmp/apps-p3-lint.log 2>&1 && echo GREEN || (tail -5 /tmp/apps-p3-tc.log; tail -5 /tmp/apps-p3-lint.log)"
expect = "GREEN"
timeout_s = 600

[[verify]]  # the z-index is the measured number, not a relative wish
cmd = "grep -cE 'z-index: *60' src/shared/ui/verve/surfaces.css"
expect = "1"

[[verify]]  # no colour literal in either component, and no drag dependency was added
cmd = "test $(grep -lE '#[0-9a-fA-F]{3,8}|rgba?\\(' src/shared/ui/DockableFab.tsx src/shared/ui/SplitPane.tsx | wc -l) -eq 0 && test $(grep -cE 'dnd-kit|react-dnd|react-resizable|split-pane' package.json) -eq 0 && echo CLEAN"
expect = "CLEAN"

[[verify]]  # board.css still has the last word and surfaces.css sits after feedback.css
cmd = '''
F=$(grep -n "verve/feedback.css" src/shared/ui/index.ts | cut -d: -f1)
S=$(grep -n "verve/surfaces.css" src/shared/ui/index.ts | cut -d: -f1)
B=$(grep -n "verve/board.css" src/shared/ui/index.ts | cut -d: -f1)
LAST=$(grep -n "verve/.*\.css" src/shared/ui/index.ts | tail -1 | cut -d: -f1)
echo "after_feedback=$((F<S)) before_board=$((S<B)) board_is_last=$((B==LAST))"
'''
expect = "after_feedback=1 before_board=1 board_is_last=1"

[[verify]]  # the markers Phase 4 will fill are present and named
cmd = "test $(grep -c 'FILL:' src/shared/ui/DockableFab.tsx src/shared/ui/SplitPane.tsx | awk -F: '{s+=$2} END {print s}') -ge 4 && echo MARKED"
expect = "MARKED"

[[verify]]  # the client still builds with the two new components in the barrel
cmd = "npm run build:client > /tmp/apps-p3-build.log 2>&1 && echo BUILD-OK || tail -8 /tmp/apps-p3-build.log"
expect = "BUILD-OK"
timeout_s = 600
```

**What to build.** Composition and paint. No behaviour.

**Sirens.** You will want to render the FAB inside the sidebar header when it is docked, because
that is where the operator says it lives — do not; it is one fixed node whose position is read
from the dock's rect, and the reason is mechanical: a node that unmounts from the header when the
drag starts takes its pointer capture with it and the drag dies on the first pixel. You will want
to squeeze these rules into `controls.css` — it is forbidden this phase and it is already 440
lines, past its own stated ceiling. You will want to implement the drag while you are in the file
— leave the marker; Phase 4 fills it, and a half-written drag here is exactly what the split
exists to prevent. You will want to give the divider a nice thin `<div>` with a `cursor` class and
no ARIA — the `role="separator"` is load-bearing twice over: it is the keyboard path and it is the
only handle the browser probe can find. You will want to write the word "Applications" somewhere —
every string is a prop; this kit speaks no English. You will want to give the FAB one size, because
two is a special case — the docked rail is 328px wide and holds a 26px wordmark that already
truncates; the 36px docked size is the ruling, and the floating sizes are unchanged. You will want
to write `z-index: 9999` and move on — 60 is measured: the in-tree mobile drawer is 50, the
portalled dialog this FAB opens is 50, the menus inside it are 70, the ceiling is 10000 and toasts
are 10001. Above 70 the FAB covers its own menus.

## Phase 4 — Kit fill: the drag mechanism, the dock snap, the clamp, and the probe
Depends on: Phase 3

```toml
[phase]
id = "4"
kind = "fill"
scaffold_of = "3"
builder = "hephaestus"
model = "opus"
code_change = true
doc_sweep = "foreground"
expected_s = 2700
manifest = [
  "src/shared/ui/DockableFab.tsx",
  "src/shared/ui/SplitPane.tsx",
  "src/shared/ui/usePointerDrag.ts",
  "scripts/apps-ui-probe.mjs",
]
forbidden = [
  "src/shared/ui/verve/surfaces.css",
  "src/shared/ui/verve/controls.css",
  "src/shared/ui/verve/feedback.css",
  "src/shared/ui/verve/board.css",
  "src/shared/ui/index.ts",
  "src/modules",
  "scripts/kanban-ui-probe.mjs",
  "package.json",
]
athena = [
  "The body classes are added but never removed on pointercancel, or removed on a bubble-phase listener, so one cancelled drag leaves every iframe in the app unclickable",
  "The release listener is not bound in the CAPTURE phase, so the panes regain hit-testing after the app's own pointerup handlers have already run",
  "setPointerCapture is missing, so a fast drag that outruns the cursor drops the element",
  "The hook leaves listeners or body classes behind when the component unmounts mid-drag",
  "A click and a drag are told apart by a timer instead of the 4px threshold, so a slow press becomes a drag and the drawer never opens",
  "The FAB can be dropped outside the viewport, or snaps to a dockRect of zero size",
  "The divider writes a ratio outside 0.15-0.85, or the clamp is applied on render but not on drag",
  "The click after a drag opens the drawer, because onClick was wired without the event.detail === 0 rule",
  "Enter and Space do not open the drawer, because onPress hangs off the pointer path alone",
  "The hook was placed in src/shared/hooks/, pointing the kit's own mechanism up out of the kit and back down at its stylesheet",
  "The probe script hard-codes a token, a port or a label instead of taking them as arguments, or never sets its own viewport",
]

[[steps]]
kind = "edit"
path = "src/shared/ui/usePointerDrag.ts"
what = "Create the one drag mechanism, exactly as Interfaces specifies: setPointerCapture on the handle at pointerdown; the 4px threshold before anything is called a drag; document.body.classList.add('vv-dragging', 'vv-drag-' + kind) on crossing it; onMove with absolute and delta coordinates; a release() that removes both classes, releases the capture and calls onEnd with moved true or false; release() bound to pointerup and pointercancel in the CAPTURE phase -- written with the POSITIONAL third argument, addEventListener('pointerup', release, true) and addEventListener('pointercancel', release, true), never an options object, so the phase's own check can read it; and release() again in the effect's cleanup so an unmount mid-drag cannot leave the application unclickable. It imports nothing but react, it lives IN the kit beside its two consumers, and it is NOT added to the barrel -- the barrel is components."
check = "grep -cE \"addEventListener\\('pointer(up|cancel)', *[A-Za-z_]+, *true\\)\" src/shared/ui/usePointerDrag.ts"
expect = "2"

[[steps]]
kind = "edit"
path = "src/shared/ui/DockableFab.tsx"
what = "Replace every FILL: marker with its behaviour and nothing else: usePointerDrag with kind 'fab'; onMove writing the new x/y clamped to the viewport with 8px of padding; onEnd calling onPress() when moved is false, otherwise calling onPositionChange with { docked: true } when the release point is within 64px of dockRect's centre and dockRect is non-null with a non-zero size, and with { docked: false, x, y } otherwise. AND the keyboard path: an onClickCapture guard copied in shape from src/modules/sidebar/hooks/useSimpleChatReorder.ts:188-194 -- a click whose event.detail is 0 has no pointer behind it, so it is a keyboard press and calls onPress(); a click whose detail is non-zero after a gesture that MOVED is swallowed with preventDefault and stopPropagation, so a drag never opens the drawer. The composition, the classes and the ARIA from Phase 3 are not touched."
check = "{ grep -c 'FILL:' src/shared/ui/DockableFab.tsx || true; }"
expect = "0"

[[steps]]
kind = "edit"
path = "src/shared/ui/SplitPane.tsx"
what = "Replace every FILL: marker: usePointerDrag with kind 'split' on the divider, onMove computing (clientX - containerRect.left) / containerRect.width clamped to SPLIT_MIN_RATIO..SPLIT_MAX_RATIO and calling onRatioChange, and the keydown handler moving the ratio by 0.02 on ArrowLeft and ArrowRight with the same clamp. The container rect is read from a ref, never from the event target."
check = "{ grep -c 'FILL:' src/shared/ui/SplitPane.tsx || true; }"
expect = "0"

[[steps]]
kind = "edit"
path = "scripts/apps-ui-probe.mjs"
what = "Create the browser probe described in Interfaces. Start from scripts/kanban-ui-probe.mjs -- its CHROME_HEADLESS_SHELL default, its CDP socket, its token seeding into localStorage under auth-token, its reload-and-wait and its single-verdict-line contract are proven on this box and are kept -- and replace the scenario with the TEN numbered steps in the Interfaces table, printing one KEY=value line each and then exactly one PROBE OK or PROBE FAILED. Set the window to 1280x900 before any reading (Emulation.setDeviceMetricsOverride or a --window-size flag), because below 768px the desktop header is display:none and every dock reading would pass with no dock on the page. Add the --selftest path from Interfaces: launch, seed the token, load the app, assert the wordmark renders, print BOOT=1 and the verdict, and do nothing else -- it is what lets THIS phase run the driver it writes. The url, the token and the FAB label are arguments; nothing about the app is hard-coded. Ceiling 450 lines."
check = "node --check scripts/apps-ui-probe.mjs && test $(wc -l < scripts/apps-ui-probe.mjs) -le 450 && echo PARSES"
expect = "PARSES"

[[steps]]
kind = "run"
cmd = "npm run typecheck && npm run lint"
check = "npm run typecheck > /tmp/apps-p4-tc.log 2>&1 && npm run lint > /tmp/apps-p4-lint.log 2>&1 && echo GREEN || (tail -5 /tmp/apps-p4-tc.log; tail -5 /tmp/apps-p4-lint.log)"
expect = "GREEN"
timeout_s = 600

[[verify]]  # every marker is gone from both components
cmd = "{ grep -c 'FILL:' src/shared/ui/DockableFab.tsx src/shared/ui/SplitPane.tsx | awk -F: '{s+=$2} END {print s}' || true; }"
expect = "0"

[[verify]]  # the hub's lesson is in the code: the body class, and a capture-phase release
cmd = '''
CLASSES=$({ grep -c "vv-dragging" src/shared/ui/usePointerDrag.ts || true; })
CAPTURE=$({ grep -cE "pointer(up|cancel)', *[A-Za-z_]+, *true" src/shared/ui/usePointerDrag.ts || true; })
CAPTURED=$({ grep -c "setPointerCapture" src/shared/ui/usePointerDrag.ts || true; })
INLINE=$({ grep -c "style.pointerEvents" src/shared/ui/usePointerDrag.ts src/shared/ui/DockableFab.tsx src/shared/ui/SplitPane.tsx | awk -F: '{s+=$2} END {print s+0}'; })
echo "bodyclass=$((CLASSES>0)) capturephase=$((CAPTURE>=2)) pointercapture=$((CAPTURED>0)) inlinewrite=$((INLINE>0))"
'''
expect = "bodyclass=1 capturephase=1 pointercapture=1 inlinewrite=0"

[[verify]]  # the components still hold no data access and no copy of their own
cmd = "{ grep -cE \"from '@/shared/api'|useTranslation\" src/shared/ui/DockableFab.tsx src/shared/ui/SplitPane.tsx | awk -F: '{s+=$2} END {print s}' || true; }"
expect = "0"

[[verify]]  # the client builds with the filled kit
cmd = "npm run build:client > /tmp/apps-p4-build.log 2>&1 && echo BUILD-OK || tail -8 /tmp/apps-p4-build.log"
expect = "BUILD-OK"
timeout_s = 600

[[verify]]  # the phase that WROTE the 450-line driver also RUNS it: the plumbing is proven here,
#           so a red gate in Phase 7 means the switcher is wrong and not the probe
cmd = '''
. scripts/apps-probe-env.sh
stop_probe_server > /dev/null 2>&1 || true
boot_probe_server > /dev/null
TOKEN=$(mint_token)
node scripts/apps-ui-probe.mjs --selftest http://127.0.0.1:7893 "$TOKEN" > /tmp/apps-p4-selftest.log 2>/tmp/apps-p4-selftest.err
grep -cE '^BOOT=1$' /tmp/apps-p4-selftest.log
tail -1 /tmp/apps-p4-selftest.log
stop_probe_server
'''
expect_re = "1[\\s\\S]*PROBE OK"
timeout_s = 900
```

**What to build.** The behaviour behind Phase 3's markers, the one hook both components share, and
the probe every later UI phase runs.

**Sirens.** You will want to set `pointerEvents = 'none'` on the iframes directly, because it is
one line and obviously works — do not; React owns those elements and will undo it on the next
render, which is exactly the bug the hub's body class was written to cure
(`hub/README.md:65-67`). You will want to remove the body class on a normal bubbling `pointerup` —
it must be the capture phase, or the panes are still deaf when the app's own handlers run. You
will want to distinguish a click from a drag with a 200ms timer — the threshold is 4px of
movement; a reader who presses and holds without moving is opening the drawer. You will want to
restyle something while you are in the file — `surfaces.css` is forbidden this phase; a missing
class is a divergence to report, not to patch. You will want to make the probe click things by
CSS class — it finds the FAB by its `aria-label` argument and the divider by
`[role="separator"]`, both of which the scaffold guaranteed. You will want to wire `onClick`
straight to `onPress` because a button should just work — a pointer release that ends a drag
dispatches a click too, so the drawer would open every single time the FAB is moved; the
`event.detail === 0` rule is how this house already tells the two apart, and it is one grep away.
You will want to let the probe take whatever viewport the headless shell defaults to — below 768px
there is no dock on the page at all, and every dock reading would pass by not existing.

## Phase 5 — The client's data layer: the types, the api group, the url rules, the registry hook
Depends on: Phase 1

```toml
[phase]
id = "5"
builder = "hephaestus"
model = "opus"
code_change = true
doc_sweep = "foreground"
expected_s = 1800
manifest = [
  "src/shared/app-types.ts",
  "src/shared/api.ts",
  ".oxlintrc.json",
  "src/modules/app-switcher/utils/resolveAppUrl.ts",
  "src/modules/app-switcher/utils/appSwitcherStorage.ts",
  "src/modules/app-switcher/hooks/useAppRegistry.ts",
]
forbidden = [
  "src/shared/types.ts",
  "src/shared/ui",
  "src/modules/kanban",
  "server",
]
athena = [
  "resolveAppUrl imports something, so it can no longer be executed outside a browser and the phase's own proof disappears",
  "{host} is replaced case-sensitively or only once, so a url carrying {HOST} or two placeholders comes out wrong",
  "isSelfOrigin compares only the origin string, so the CloudCLI row is framed whenever the browser opened the app on its other port",
  "The hook caches the registry forever, so a row a builder appends never appears without a reload",
  "The hook swallows a failed request, leaving the drawer showing an empty list instead of the unreadable-registry message",
  "A second api helper or a raw fetch was added instead of one group beside kanban in src/shared/api.ts",
  "src/shared/app-types.ts was added without its entry in .oxlintrc.json's frontend-shared-file list, so boundaries/no-unknown reddens the lint gate",
  "The stored record carries which applications were open, which reopens a window into somebody else's application",
  "readAppSwitcherRecord throws on unparseable localStorage instead of answering the defaults",
  "src/shared/types.ts was opened",
]

[[steps]]
kind = "edit"
path = "src/shared/app-types.ts"
what = "Create the client mirror of server/shared/app-types.ts: AppEntry and AppRegistryResponse, field for field, each with the comment convention of its sibling and a line naming the server file it mirrors. Nothing else goes in it, and src/shared/types.ts is not opened."
check = "grep -cE '^export type (AppEntry|AppRegistryResponse)' src/shared/app-types.ts"
expect = "2"

[[steps]]
kind = "edit"
path = ".oxlintrc.json"
what = "Add the ONE string \"src/shared/app-types.ts\" to the frontend-shared-file element's pattern list, as the last entry after \"src/shared/kanban-types.ts\" (around line 111). That list is an explicit file enumeration and boundaries/no-unknown is an error, so a new file under src/shared/ that is not listed reddens npm run lint:client the moment anything imports it. src/shared/ui/ is a FOLDER element, so the kit's components and its drag hook need no entry. This file is JSONC -- it carries // comments -- so edit it as text and never round-trip it through a JSON serialiser, which would strip every comment in it. Add nothing else and change no rule."
check = "grep -c '\"src/shared/app-types.ts\"' .oxlintrc.json"
expect = "1"

[[steps]]
kind = "edit"
path = "src/modules/app-switcher/utils/resolveAppUrl.ts"
what = "Create the two pure functions from Interfaces and nothing else. resolveAppUrl(url, host) replaces every {host} case-insensitively (a global, case-insensitive regex, the hub's own rule at seed.js:34) and returns the string. isSelfOrigin(resolvedUrl, pageOrigin, selfPorts) parses both with the URL constructor and answers true when the origins match, or when the hostnames match and the resolved port -- defaulted from the protocol when absent -- is one of selfPorts. This file imports NOTHING, so it can be run outside a browser. Carry one comment on isSelfOrigin naming its deliberate twin: src/modules/widgets/docspaceOrigin.ts exports isForeignOrigin, the same question minus the port set; it is NOT imported, because that file is a chat-domain module and a deep import into @/modules/widgets is both a wrong-way coupling and a boundaries/dependencies error, and because widgets asks origin-only to gate allow-same-origin while this asks about the app's own port set."
check = "{ grep -cE \"^import \" src/modules/app-switcher/utils/resolveAppUrl.ts || true; }"
expect = "0"

[[steps]]
kind = "edit"
path = "src/shared/api.ts"
what = "Add ONE group, apps, beside the kanban group that ends at line 672, with the three arrow functions from Interfaces built on the existing get/post/del helpers. No new helper, no new fetch, nothing else in this file changes."
check = "grep -cE \"list: \\(\\) => get\\('/api/apps'\\)\" src/shared/api.ts"
expect = "1"

[[steps]]
kind = "edit"
path = "src/modules/app-switcher/utils/appSwitcherStorage.ts"
what = "Create the persistence helper from Interfaces: the AppSwitcherRecord type, readAppSwitcherRecord() reading localStorage key 'app-switcher' and answering the defaults on absent or unparseable content (docked at window.innerWidth >= 768, otherwise floating at innerWidth-72 / innerHeight-112), and writeAppSwitcherRecord(record) writing it back. Which applications are open is NOT part of the record. It is data, not behaviour, which is why it lands in this phase and not in a render phase."
check = "grep -c \"'app-switcher'\" src/modules/app-switcher/utils/appSwitcherStorage.ts"
expect_re = "^[1-9][0-9]*$"

[[steps]]
kind = "edit"
path = "src/modules/app-switcher/hooks/useAppRegistry.ts"
what = "Create useAppRegistry() returning { apps, selfPorts, error, refresh }: it calls api.apps.list() on mount and whenever refresh() is called, keeps the parsed AppRegistryResponse in state, and on a failed request keeps the last good list while setting error to the server's message so the drawer can raise a Banner. There is no polling and no websocket subscription -- the registry changes when a person or a builder edits it, and the drawer refreshes on every open."
check = "grep -c 'api.apps.list' src/modules/app-switcher/hooks/useAppRegistry.ts"
expect_re = "^[1-9][0-9]*$"

[[steps]]
kind = "run"
cmd = "npm run typecheck && npm run lint:client"
check = "npm run typecheck > /tmp/apps-p5-tc.log 2>&1 && npm run lint:client > /tmp/apps-p5-lint.log 2>&1 && echo GREEN || (tail -5 /tmp/apps-p5-tc.log; tail -5 /tmp/apps-p5-lint.log)"
expect = "GREEN"
timeout_s = 600

[[verify]]  # the real function, really executed: {host} resolves for a tailnet and a LAN reader alike
cmd = '''
node_modules/.bin/tsx -e '
import { resolveAppUrl } from "./src/modules/app-switcher/utils/resolveAppUrl.ts";
console.log([
  resolveAppUrl("http://{host}:7878", "100.103.222.79"),
  resolveAppUrl("http://{HOST}:8001/dashboard", "192.168.1.95"),
  resolveAppUrl("http://example.test:1/x", "eis1"),
].join(" "));
'
'''
expect = "http://100.103.222.79:7878 http://192.168.1.95:8001/dashboard http://example.test:1/x"
timeout_s = 180

[[verify]]  # the self-origin rule: CloudCLI is never framed inside CloudCLI, on either of its ports
cmd = '''
node_modules/.bin/tsx -e '
import { isSelfOrigin } from "./src/modules/app-switcher/utils/resolveAppUrl.ts";
const ports = [3011, 5183];
console.log([
  isSelfOrigin("http://eis1:5183", "http://eis1:5183", ports),
  isSelfOrigin("http://eis1:3011", "http://eis1:5183", ports),
  isSelfOrigin("http://eis1:7878", "http://eis1:5183", ports),
  isSelfOrigin("http://other:5183", "http://eis1:5183", ports),
].join(" "));
'
'''
expect = "true true false false"
timeout_s = 180

[[verify]]  # the api group answers the real server
cmd = '''
. scripts/apps-probe-env.sh
stop_probe_server > /dev/null 2>&1 || true
boot_probe_server > /dev/null
TOKEN=$(mint_token)
curl -sf -H "Authorization: Bearer $TOKEN" http://127.0.0.1:7893/api/apps \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print('ports=%d apps=%d' % (len(d['selfPorts']), len(d['apps'])))"
stop_probe_server
'''
expect = "ports=2 apps=7"
timeout_s = 300
```

**What to build.** Four small files, none of them rendering anything.

**Sirens.** You will want to read `window.location.hostname` inside `resolveAppUrl` because every
caller passes it — do not; the moment it touches `window` this phase loses the only way it can
prove the function is right without a browser. You will want `isSelfOrigin` to special-case the id
`cloudcli` — ids are the operator's to choose and the rule must hold for a row he adds tomorrow.
You will want the hook to poll — the registry changes when somebody edits a file, and the drawer
reads it on every open. You will want to add the group to a new `src/shared/apps-api.ts` because
`api.ts` is long — the frontend standard names `src/shared/api.ts` as the one home for endpoint
definitions, and this is three lines. You will want to skip `.oxlintrc.json` because the type file
typechecks fine without it — it is `boundaries/no-unknown: error` that fails, at the lint gate of
this very phase, and the two `kanban-types.ts` entries already sitting in those lists are the
precedent. You will want to import `isForeignOrigin` from the widgets module rather than write a
second predicate — that is a deep cross-module import into a chat-domain file, banned by
`boundaries/dependencies`, and the comment in the file is how the two stay findable instead.

## Phase 6 — Switcher scaffold: the provider, the dock, the drawer, the panes, the mounts
Depends on: Phase 3, Phase 5

```toml
[phase]
id = "6"
kind = "scaffold"
builder = "iris"
model = "opus"
code_change = true
doc_sweep = "foreground"
expected_s = 3000
manifest = [
  "src/modules/app-switcher",
  "src/modules/sidebar",
  "src/modules/project-workspace/ProjectSidebarRegion.tsx",
  "src/modules/project-workspace/ProjectWorkspaceShell.tsx",
  "src/modules/i18n/locales/en/common.json",
]
forbidden = [
  "src/modules/app-switcher/utils",
  "src/modules/app-switcher/hooks/useAppRegistry.ts",
  "src/shared/ui",
  "src/shared/types.ts",
  "src/shared/api.ts",
  "src/modules/project-workspace/WorkspaceMain.tsx",
  "src/modules/project-workspace/WorkspaceTabs.tsx",
  "src/modules/kanban",
  "server",
]
athena = [
  "The dock slot was rendered INSIDE LogoBlock, putting a button inside the dashboard anchor -- invalid HTML, and a click that navigates away",
  "The slot was added to only one of the two logo rows, so the dock disappears at one breakpoint",
  "The slot was rendered in BOTH rows ungated, so two docks mount at once and two observers write one rect -- the file's own comment above the isCompact gate says why tabs is not allowed to do this",
  "leading was declared required somewhere in the thread, so every other Sidebar call site stops compiling",
  "The context was placed at the module root as AppSwitcherProvider.tsx, against ten out of ten contexts in this repo and the standard's own context clause",
  "The layer was mounted over the whole shell instead of inside the main-region wrapper, so an open application covers the sidebar and the reader loses the way back",
  "The main-region wrapper never got position: relative, so an absolutely positioned layer escapes to the viewport",
  "The pane iframe is missing allow=\"geolocation\", which is the one defect this plan was told to fix",
  "A user-visible string is written as a literal instead of coming from t('applications.*')",
  "The sidebar module imports the app-switcher module directly instead of receiving it as a slot, inverting the dependency the tabs slot already establishes",
  "A behaviour was implemented instead of left as a FILL: marker",
  "The barrel exports a hook, a util or an internal screen beside the four doors",
]

[[steps]]
kind = "edit"
path = "src/modules/app-switcher/context/AppSwitcherContext.tsx"
what = "Compose the module's one state home, in context/ where every one of this repo's ten contexts lives and under the <Name>Context.tsx name every one of them uses: a context holding the registry (from useAppRegistry), the open panes (two slots, each an app id or null, each with a reloadNonce), dual on/off, the divider ratio, the FAB position, the dock rect, which side the next choice fills, and whether the drawer is open. Every state declaration carries the comment the frontend standard asks for. Every action body is // FILL: <name> -- open, close, toggleDual, setRatio, reload, moveFab, registerDock are all Phase 7's. Export AppSwitcherProvider and the hook the sibling screens read it with."
check = "grep -c 'FILL:' src/modules/app-switcher/context/AppSwitcherContext.tsx"
expect_re = "^[1-9][0-9]*$"

[[steps]]
kind = "edit"
path = "src/modules/app-switcher/AppSwitcherDock.tsx"
what = "Compose the dock anchor: a box exactly the size of the FAB (56px, 48px under 768px) that paints NOTHING -- no border, no background -- reserves the space to the left of the wordmark, and reports its rect to the provider. The reporting body is // FILL: registerDock; the ResizeObserver and the zero-size rule are Phase 7's."
check = "grep -c 'FILL: registerDock' src/modules/app-switcher/AppSwitcherDock.tsx"
expect = "1"

[[steps]]
kind = "edit"
path = "src/modules/app-switcher/AppSwitcherFab.tsx"
what = "Compose the FAB's owner: read position, dockRect and drawer state from the provider, render the kit's DockableFab with label={t('applications.fabLabel')} and a lucide LayoutGrid icon, and hang AppDrawer off it. The handlers are // FILL: onPress and // FILL: onPositionChange."
check = "grep -c 'DockableFab' src/modules/app-switcher/AppSwitcherFab.tsx"
expect_re = "^[1-9][0-9]*$"

[[steps]]
kind = "edit"
path = "src/modules/app-switcher/AppDrawer.tsx"
what = "Compose the drawer exactly as Interfaces describes it: Dialog + DialogContent as a right-hand sheet, DialogTitle with t('applications.title'), a Close Button reading t('applications.close'), a Switch labelled t('applications.dualScreen'), the PillBar reading t('applications.opensIn') with t('applications.left') and t('applications.right') shown only when dual is on, a ScrollArea of rows in file order (name, then the resolved host in muted type, then t('applications.onScreen') when that app is up) each with an ActionMenu carrying t('applications.reload') and t('applications.openInNewTab'), an EmptyState with t('applications.empty'), and a Banner with t('applications.unreadable') when the registry could not be read. A self row shows only the new-tab action. Every handler is // FILL: <name>; every word comes from t(). Split this file if it passes 300 lines, by cohesion -- the rows are the natural sibling."
check = "grep -c \"t('applications\\.\" src/modules/app-switcher/AppDrawer.tsx"
expect_re = "^([6-9]|[1-9][0-9]+)$"

[[steps]]
kind = "edit"
path = "src/modules/app-switcher/AppPane.tsx"
what = "Compose one pane: an iframe carrying src, title, referrerpolicy=\"no-referrer\", allow=\"geolocation\" and the h-full w-full border-0 classes, and NOTHING else -- no chrome, no header strip, no watchdog and no not-showing-up fallback. Carry one comment stating why there is deliberately NO sandbox attribute, since the house's other two cross-origin frames both have one (WidgetFrame.tsx, DocSpaceFrame.tsx): a sandbox without allow-same-origin would cut the framed app's SameSite=Lax session cookie, which is the whole premise of the EIS grant in R-EISBE-7, and these are the operator's own applications on his own host. The src arrives as a prop; this file resolves nothing and fetches nothing."
check = "grep -c 'allow=\"geolocation\"' src/modules/app-switcher/AppPane.tsx"
expect = "1"

[[steps]]
kind = "edit"
path = "src/modules/app-switcher/AppSwitcherLayer.tsx"
what = "Compose the layer: null when no pane is open; otherwise an absolute inset-0 surface over the main region holding the kit's SplitPane with left, right and dividerLabel={t('applications.divider')} -- right is null when dual is off, which is what makes the left pane fill. The choice of which app each side shows comes from the provider; the selection body is // FILL: paneApps."
check = "grep -c 'SplitPane' src/modules/app-switcher/AppSwitcherLayer.tsx"
expect_re = "^[1-9][0-9]*$"

[[steps]]
kind = "edit"
path = "src/modules/app-switcher/index.ts"
what = "The barrel: export AppSwitcherProvider, AppSwitcherDock, AppSwitcherFab and AppSwitcherLayer -- the four doors the shell mounts -- and nothing else. Carry the comment the kanban barrel carries (src/modules/kanban/index.ts): no hook, no util and no internal screen leaves this module."
check = "grep -cE '^export' src/modules/app-switcher/index.ts"
expect = "4"

[[steps]]
kind = "edit"
path = "src/modules/sidebar/SidebarHeader.tsx"
what = "Add leading?: ReactNode to SidebarHeaderProps beside tabs, documented the same way, and render the slot as the FIRST child of BOTH logo rows -- GATED exactly as tabs is: {leading && !isCompact && ...} in the desktop row and {leading && isCompact && ...} in the mobile row, so exactly one dock mounts. The file's own comment above the tabs gate says why: two blocks, one hidden with CSS, and a slot in both puts two live instances on the page. The slot is a SIBLING of the anchor/LogoBlock branch and never goes inside LogoBlock, which is called from inside an <a href=.../dashboard>. Then thread leading from Sidebar through SidebarContent to SidebarHeader -- the same path tabs takes -- declaring it OPTIONAL (leading?:) at all three, unlike SidebarContent's tabs which is required, so every other Sidebar call site keeps compiling. This file gains about six lines and no more. Note that the word `leading` ALREADY appears here as the Tailwind class `leading-[1.1]` -- the checks read the slot `{leading}` and the prop `leading?:`, never the bare word."
check = '''
DESK=$({ grep -c 'leading && !isCompact' src/modules/sidebar/SidebarHeader.tsx || true; })
MOB=$({ grep -cE 'leading && isCompact' src/modules/sidebar/SidebarHeader.tsx || true; })
PROP=$({ grep -c 'leading?:' src/modules/sidebar/SidebarHeader.tsx || true; })
THREAD=$({ grep -lc 'leading?:' src/modules/sidebar/Sidebar.tsx src/modules/sidebar/SidebarContent.tsx src/modules/sidebar/SidebarHeader.tsx 2>/dev/null | wc -l; })
echo "desktop=$DESK mobile=$MOB prop=$PROP optional_thread=$THREAD"
'''
expect = "desktop=1 mobile=1 prop=1 optional_thread=3"

[[steps]]
kind = "edit"
path = "src/modules/project-workspace/ProjectSidebarRegion.tsx"
what = "Both <Sidebar ... tabs={tabs} /> call sites -- the desktop branch and the mobile drawer branch -- gain leading={<AppSwitcherDock />}, imported from '@/modules/app-switcher'. This is the same one-way dependency the tabs slot already establishes in the comment above the tabs const: the sidebar module never imports this one."
check = "grep -c 'leading={<AppSwitcherDock />}' src/modules/project-workspace/ProjectSidebarRegion.tsx"
expect = "2"

[[steps]]
kind = "edit"
path = "src/modules/project-workspace/ProjectWorkspaceShell.tsx"
what = "Wrap the returned tree in <AppSwitcherProvider>; add the class relative to the main-region wrapper -- the div className=\"flex min-w-0 flex-1 flex-col\" that holds <ProjectMainRegion /> -- so an absolutely positioned child stays inside it; render <AppSwitcherLayer /> as that wrapper's last child, after <ProjectMainRegion .../>; and render <AppSwitcherFab /> as the last sibling of <ProjectCommandPalette /> inside the fixed inset-0 container. Anchor by those symbols, not by line number. Nothing else in this file changes."
check = "grep -cE 'AppSwitcherProvider|AppSwitcherLayer|AppSwitcherFab' src/modules/project-workspace/ProjectWorkspaceShell.tsx"
expect_re = "^([4-9]|[1-9][0-9]+)$"

[[steps]]
kind = "edit"
path = "src/modules/i18n/locales/en/common.json"
what = "Add one top-level applications block carrying the thirteen keys listed in Interfaces with their English words: Applications, Applications (the FAB's label), Close, Dual screen, Opens in, Left, Right, Reload, Open in a new tab, on screen, No applications yet, The application list could not be read, Resize applications. Valid JSON, no trailing comma, no other block touched."
check = "python3 -c \"import json; d=json.load(open('src/modules/i18n/locales/en/common.json')); print(len(d['applications']))\""
expect = "13"

[[steps]]
kind = "run"
cmd = "node_modules/.bin/tsc --noEmit -p tsconfig.json && npm run lint:client"
check = "node_modules/.bin/tsc --noEmit -p tsconfig.json > /tmp/apps-p6-tc.log 2>&1 && npm run lint:client > /tmp/apps-p6-lint.log 2>&1 && echo GREEN || (tail -5 /tmp/apps-p6-tc.log; tail -5 /tmp/apps-p6-lint.log)"
expect = "GREEN"
timeout_s = 600

[[verify]]  # the dock slot is a sibling of the wordmark, never a child of the anchor-wrapped LogoBlock
cmd = "python3 -c \"import re; s=open('src/modules/sidebar/SidebarHeader.tsx').read(); m=re.search(r'function LogoBlock.*?\\n}', s, re.S); print('NO-LOGOBLOCK' if not m else ('INSIDE' if '{leading}' in m.group(0) else 'OUTSIDE'))\""
expect = "OUTSIDE"

[[verify]]  # every screen's copy comes from i18n, not from a literal
cmd = "{ grep -cE '>(Applications|Dual screen|Open in a new tab|Reload)<' src/modules/app-switcher/*.tsx | awk -F: '{s+=$2} END {print s}' || true; }"
expect = "0"

[[verify]]  # the markers Phase 7 will fill are present across the module
cmd = "test $(grep -rc 'FILL:' src/modules/app-switcher | awk -F: '{s+=$2} END {print s}') -ge 6 && echo MARKED"
expect = "MARKED"

[[verify]]  # the client builds with the switcher mounted, and no file in the module passed 300 lines
cmd = '''
npm run build:client > /tmp/apps-p6-build.log 2>&1 || { tail -8 /tmp/apps-p6-build.log; exit 1; }
BIG=$(find src/modules/app-switcher -name '*.tsx' -o -name '*.ts' | xargs wc -l | awk '$2 != "total" && $1 > 300 {print $2}' | wc -l)
echo "build=OK oversize=$BIG"
'''
expect = "build=OK oversize=0"
timeout_s = 600
```

**What to build.** Composition, copy and the three mount points. No behaviour.

**Sirens.** You will want to put the dock button inside `LogoBlock`, because that is the component
that draws the wordmark — do not; two of its four call sites sit inside
`<a href="https://cloudcli.ai/dashboard">`, and a button inside an anchor is invalid HTML whose
click navigates away instead of opening the drawer. You will want to mount the layer at the shell
level so an application is truly full screen — it covers the main region only, on purpose: the
sidebar is how the reader gets back to a project, and the operator's own model is that CloudCLI
stays the shell. You will want to add a Kanban-style tab for applications — the switcher is not a
tab, and `WorkspaceTabs.tsx`, `WorkspaceMain.tsx`, `AppTab` and `VALID_TABS` are all untouched by
this plan. You will want to give the pane a title bar with a close button — the FAB is the way
out, it floats above the panes, and a chrome strip is the opposite of full-bleed. You will want to
implement the drag or the open action while the file is open — leave the marker. You will want to
translate the other ten locales now — Phase 7 does all ten in one pass, against the English block
this phase settles.

## Phase 7 — Switcher fill: the behaviour, the persistence, the ten locales, the probe
Depends on: Phase 4, Phase 6

```toml
[phase]
id = "7"
kind = "fill"
scaffold_of = "6"
builder = "hephaestus"
model = "opus"
code_change = true
doc_sweep = "foreground"
expected_s = 3600
manifest = [
  "src/modules/app-switcher",
  "src/modules/i18n/locales",
]
forbidden = [
  "src/shared/ui",
  "src/shared/api.ts",
  "src/shared/types.ts",
  "src/modules/sidebar",
  "src/modules/project-workspace",
  "src/modules/i18n/config.ts",
  "src/modules/kanban",
  "server",
  "scripts",
]
athena = [
  "A FILL: marker was deleted without its behaviour being implemented",
  "A rect is accepted from the mobile sidebar while it is hidden: invisible + opacity-0 KEEPS the layout box, so getBoundingClientRect answers full size at a point 85vw off the left edge, and the FAB paints off-screen",
  "The rect is not cleared when the dock unmounts under SidebarCollapsed, so the FAB stays pinned to a point that no longer exists",
  "A null dockRect with a docked record renders the FAB at a remembered ghost instead of falling back to the clamped floating default",
  "Re-measurement hangs off ResizeObserver alone, which watches SIZE -- every hole here is a change of POSITION at constant size",
  "The persisted record is written on every pointermove rather than once at the end of a drag, hammering localStorage through the whole gesture",
  "Which applications are open got persisted, so a fresh window opens into somebody else's application instead of the workspace",
  "The CloudCLI row is framed rather than opened in a new tab, because isSelfOrigin was never called at the open site",
  "Reload re-navigates the iframe with a src swap and a timer instead of bumping the key, reintroducing the race the plan replaced",
  "A locale file was left without the applications block, which fails silently because i18next falls back to English",
  "A locale file became invalid JSON, which breaks the whole bundle rather than one language",
  "The drawer does not refresh the registry when it opens, so a row a builder appended never appears"
]

[[steps]]
kind = "edit"
path = "src/modules/app-switcher/context/AppSwitcherContext.tsx"
what = "Replace every FILL: marker with its behaviour: open(appId) fills the active side (or opens a new tab when isSelfOrigin says the row is this app), and closes that pane when the same app is already there; close() clears both panes; toggleDual seeds the second slot and clears it when it is turned off; setRatio; reload(side) bumping that pane's reloadNonce; moveFab persisting the new position; and registerDock under the FOUR rect rules in Interfaces -- (1) accept a rect only when it is non-zero AND intersects the viewport, because the hidden mobile sidebar keeps its layout box and reports full size about 85vw off the left edge, (2) clear the rect when the dock unmounts, because SidebarCollapsed swaps the whole header away, (3) when dockRect is null the FAB floats at its clamped default whatever the record says, and (4) re-measure on window resize and on every change of the sidebar's open/collapsed state, not on a ResizeObserver alone, which watches size while every hole here is a change of position at constant size. The record from utils/appSwitcherStorage.ts is read once on mount and written at the END of a gesture, never during it."
check = "{ grep -c 'FILL:' src/modules/app-switcher/context/AppSwitcherContext.tsx || true; }"
expect = "0"

[[steps]]
kind = "edit"
path = "src/modules/app-switcher/AppDrawer.tsx"
what = "Replace every FILL: marker: the open handler, the per-row Reload and Open in a new tab (window.open(resolved, '_blank', 'noopener')), the dual-screen switch, the Opens-in strip, the Close action, and a refresh of the registry every time the drawer opens. A self row's body click opens a new tab and its menu holds only that action. The rows read resolveAppUrl(app.url, window.location.hostname) and isSelfOrigin(resolved, window.location.origin, selfPorts) -- this is the only place in the module that touches window.location."
check = "{ grep -c 'FILL:' src/modules/app-switcher/AppDrawer.tsx || true; }"
expect = "0"

[[steps]]
kind = "edit"
path = "src/modules/app-switcher/AppSwitcherLayer.tsx"
what = "Replace the FILL: paneApps marker: resolve each side's app id to its entry and its resolved url, pass them to AppPane with a React key that includes that pane's reloadNonce, and render right as null when dual is off. Nothing here fetches and nothing here decides which app opens."
check = "{ grep -rc 'FILL:' src/modules/app-switcher | awk -F: '{s+=$2} END {print s}' || true; }"
expect = "0"

[[steps]]
kind = "edit"
path = "src/modules/i18n/locales/de/common.json"
what = "Add the applications block to the TEN non-English locales -- de, es, fr, it, ja, ko, ru, tr, zh-CN, zh-TW -- with the same thirteen keys, translated, matching the English block Phase 6 settled. Every file stays valid JSON. Do not touch src/modules/i18n/config.ts: these keys live in the existing common namespace and no import changes."
check = "python3 -c \"import json,glob; print(sum(1 for p in glob.glob('src/modules/i18n/locales/*/common.json') if len(json.load(open(p)).get('applications', {})) == 13))\""
expect = "11"

[[steps]]
kind = "run"
cmd = "npm run typecheck && npm run lint:client && npm run build:client"
check = "npm run typecheck > /tmp/apps-p7-tc.log 2>&1 && npm run lint:client > /tmp/apps-p7-lint.log 2>&1 && npm run build:client > /tmp/apps-p7-build.log 2>&1 && echo GREEN || (tail -5 /tmp/apps-p7-tc.log; tail -5 /tmp/apps-p7-lint.log; tail -5 /tmp/apps-p7-build.log)"
expect = "GREEN"
timeout_s = 900

[[verify]]  # the whole scenario, in a real browser, against the real server: FAB, drawer, pane, dual, drags
cmd = '''
. scripts/apps-probe-env.sh
stop_probe_server > /dev/null 2>&1 || true
npm run build:client > /tmp/apps-p7-build2.log 2>&1 || { tail -8 /tmp/apps-p7-build2.log; exit 1; }
boot_probe_server > /dev/null
TOKEN=$(mint_token)
node scripts/apps-ui-probe.mjs http://127.0.0.1:7893 "$TOKEN" Applications > /tmp/apps-p7-probe.log 2>/tmp/apps-p7-probe.err
tail -1 /tmp/apps-p7-probe.log
stop_probe_server
'''
expect = "PROBE OK"
timeout_s = 900

[[verify]]  # the readings behind that verdict -- including the two the operator actually asked for:
#            that the FAB IS at its dock on first paint, and that it RETURNS there when thrown at it
cmd = '''
for KEY in DOCKED PANES SPLIT FABMOVED FABSNAPPED FABPERSIST WORDMARK; do
  printf '%s=%s ' "$KEY" "$(grep -oE "^${KEY}=[0-9]+" /tmp/apps-p7-probe.log | tail -1 | cut -d= -f2)"
done
echo
'''
expect = "DOCKED=1 PANES=2 SPLIT=1 FABMOVED=1 FABSNAPPED=1 FABPERSIST=1 WORDMARK=1"

[[verify]]  # the pane really carries the geolocation grant and a resolved host
cmd = '''
grep -E '^PANE0(SRC|ALLOW)=' /tmp/apps-p7-probe.log | tr '\n' ' '
'''
expect = "PANE0SRC=http://127.0.0.1:7878 PANE0ALLOW=geolocation"

[[verify]]  # all eleven locales carry all thirteen keys, and every file is still valid JSON
cmd = "python3 -c \"import json,glob; ps=sorted(glob.glob('src/modules/i18n/locales/*/common.json')); print('files=%d full=%d' % (len(ps), sum(1 for p in ps if len(json.load(open(p)).get('applications', {})) == 13)))\""
expect = "files=11 full=11"

[[verify]]  # only the drawer reads window.location; the kit and the panes stay pure
cmd = "{ grep -rl 'window.location' src/modules/app-switcher | grep -v AppDrawer | wc -l; }"
expect = "0"
```

**What to build.** The behaviour behind Phase 6's markers, the stored record, and the ten
translations.

**Sirens.** You will want to persist which applications were open so the reader comes back to
where they were — the record holds the FAB, the dual flag and the ratio, and nothing else; a
window that reopens into somebody else's application is a surprise and a slower first paint. You
will want to write the record on every `pointermove` because that is where the numbers change —
write it once, at the end of the gesture. You will want the dock rect from a `querySelector`
because two headers exist — exactly one dock mounts now, gated by `isCompact` the way `tabs` is,
and the provider takes the rect it is handed. You will want to trust a non-zero rect —
`visibility: hidden` KEEPS the layout box, so the hidden mobile sidebar reports full width and
height from about 85vw off the left edge; the rect must INTERSECT THE VIEWPORT, and a FAB painted
off-screen is a reader with no way out of a pane. You will want to leave a stale rect in place when
the dock unmounts, because it will probably come back — `SidebarCollapsed` replaces the whole
header, and a remembered point that no longer exists is exactly where the FAB will sit. You will want to make the CloudCLI row work by framing it anyway
"just to see" — a browser framing its own origin is a hall of mirrors that eats memory; the row
opens a new tab and that is the ruling. You will want to translate by copying the English words
into ten files — a key that is missing falls back to English silently, so a lazy file looks fine
and is not; the count check is why. You will want to touch `config.ts` — these keys are in the
existing `common` namespace, and no import changes.

## Phase 8 — The hub is retired
Depends on: Phase 2, Phase 7

```toml
[phase]
id = "8"
builder = "hephaestus"
model = "opus"
builder_reason = "A deletion and a prose sweep across a shipped app's comments and docs -- the .css and .html entries are one-line comment corrections in Descent's own files, never a restyle, so the route's UI split would buy nothing."
code_change = true
doc_sweep = "foreground"
expected_s = 2400
manifest = [
  "/home/lyphe/.claude/hub",
  "/home/lyphe/.claude/.gitignore",
  "/home/lyphe/.claude/README.md",
  "/home/lyphe/.claude/descent/README.md",
  "/home/lyphe/.claude/descent/ui/index.html",
  "/home/lyphe/.claude/descent/ui/descent.css",
  "/home/lyphe/.claude/ArchPulse/vite.config.ts",
  "/opt/shadow-connector/.eis_backend.env",
  "/opt/shadow-connector/eis_backend/GOTCHAS.md",
  "docs/hosting.md",
  "vite.config.js",
]
forbidden = [
  "src",
  "server",
  "scripts",
  "docs/applications.md",
]
athena = [
  "The hub's folder was deleted before its seven entries were confirmed to live in this repo's seed, losing the registry",
  "git rm, git clean or git checkout was used to remove the hub instead of rm -rf, which would reach beyond the deletion into uncommitted work",
  "The systemd unit was stopped but left enabled, or removed from /etc/systemd/system without a daemon-reload, so it comes back or lingers as a failed unit",
  "A pointer was annotated -- 'formerly the Applications Hub' -- instead of corrected or removed, which is the SUPERSEDED shape the house rule forbids",
  "vite.config.js's allowedHosts entries were deleted along with the comment that mentions the hub: the hosts are still needed, the reason is what changed",
  "The EIS list lost a CloudCLI origin while the hub's five were being removed",
  "Descent's scrollbar rule was changed rather than its comment, altering behaviour that still applies inside a CloudCLI pane",
  "A file outside the manifest was edited because it also said the word hub",
]

[[steps]]
kind = "run"
cmd = "sudo systemctl disable --now hub.service && sudo rm -f /etc/systemd/system/hub.service && sudo systemctl daemon-reload"
check = "{ systemctl list-unit-files hub.service 2>/dev/null | grep -c '^hub.service' || true; }; { test -e /etc/systemd/system/hub.service && echo UNIT-PRESENT || echo UNIT-GONE; }"
expect_re = "^0[\\s\\S]*UNIT-GONE"
timeout_s = 300

[[steps]]
kind = "run"
cmd = "rm -rf /home/lyphe/.claude/hub"
check = "{ test -d /home/lyphe/.claude/hub && echo PRESENT || echo GONE; }"
expect = "GONE"
timeout_s = 120

[[steps]]
kind = "edit"
path = "/home/lyphe/.claude/.gitignore"
what = "Lines 64-65 are a two-line comment describing the Applications Hub and the hub/ entry it governs. The folder is gone, so remove that comment AND the hub entry it introduces entirely. Nothing is left behind naming it -- no 'removed 2026-09-16' line."
check = "{ grep -ci 'applications hub\\|^hub/\\|8006' /home/lyphe/.claude/.gitignore || true; }"
expect = "0"

[[steps]]
kind = "edit"
path = "/home/lyphe/.claude/README.md"
what = "Lines 78-79 describe hub/ in the estate's directory tree. The folder is gone: remove those lines from the tree listing, and if the surrounding prose names the hub anywhere else in this file, fix it in the same pass. Nothing points at what was removed."
check = "{ grep -ci 'applications hub\\|8006' /home/lyphe/.claude/README.md || true; }"
expect = "0"

[[steps]]
kind = "edit"
path = "/home/lyphe/.claude/descent/README.md"
what = "Lines 123-124 say the page hides its own scrollbar when it is opened inside the Applications Hub (~/.claude/hub, :8006). The behaviour still applies -- Descent is now framed by LypheCLI's application pane instead -- so correct the NAME and the reference: it is framed in LypheCLI's application switcher (docs/applications.md in the claudecodeui_lyphe repo). Do not change what the sentence says about the scrollbar."
check = "{ grep -ci '8006\\|~/.claude/hub' /home/lyphe/.claude/descent/README.md || true; }"
expect = "0"

[[steps]]
kind = "edit"
path = "/home/lyphe/.claude/descent/ui/index.html"
what = "Line 6 is a comment asking whether the page is framed in the Applications Hub (~/.claude/hub, :8006). Correct the name to LypheCLI's application pane and drop the dead path and port. Change the comment ONLY: if any CODE in this file or in descent.css branches on the hub's origin or on port 8006, do not change it -- report the divergence and stop."
check = "{ grep -ci '8006\\|applications hub' /home/lyphe/.claude/descent/ui/index.html || true; }"
expect = "0"

[[steps]]
kind = "edit"
path = "/home/lyphe/.claude/descent/ui/descent.css"
what = "Line 113's comment says 'Inside the Applications Hub the pane is the whole window'. The pane is now LypheCLI's application pane; correct the name and leave every rule exactly as it is."
check = "{ grep -ci 'applications hub' /home/lyphe/.claude/descent/ui/descent.css || true; }"
expect = "0"

[[steps]]
kind = "edit"
path = "/home/lyphe/.claude/ArchPulse/vite.config.ts"
what = "Line 28's comment explains an allowedHosts guard by saying the Applications Hub opens the app under another name. LypheCLI's application pane does the same thing; correct the name and change no configuration value -- the hosts are still needed."
check = "{ grep -ci 'applications hub' /home/lyphe/.claude/ArchPulse/vite.config.ts || true; }"
expect = "0"

[[steps]]
kind = "edit"
path = "vite.config.js"
what = "The comment at lines 48-50 explains the allowedHosts list by saying the Applications Hub frames this app under the name it was opened on. The hub is gone and the LIST STAYS -- this app is now opened directly under those names on the LAN and the tailnet, which is the reason to keep it. Rewrite the comment to say that, and change no configuration value."
check = "{ grep -ci 'applications hub' vite.config.js || true; }; grep -c \"allowedHosts: \\['eis1', 'eis1.tail8717cd.ts.net'\\]\" vite.config.js"
expect_re = "^0[\\s\\S]*1$"

[[steps]]
kind = "edit"
path = "docs/hosting.md"
what = "Four lines name the hub: line 34 points at ~/.claude/hub/apps.json as where this app is registered, and lines 81, 83 and 84 explain --strictPort and allowedHosts by the Hub's framing. The registry is now this repo's own git-ignored apps.local.json (docs/applications.md), and the reasons for --strictPort and allowedHosts are that the app is opened directly under those names. Rewrite all four; leave every number and flag exactly as it is."
check = "{ grep -ci 'applications hub\\|~/.claude/hub' docs/hosting.md || true; }"
expect = "0"

[[steps]]
kind = "edit"
path = "/opt/shadow-connector/.eis_backend.env"
what = "Remove the five hub origins on :8006 from the EIS_FRAME_ANCESTORS line, leaving the eight CloudCLI origins Phase 2 added and nothing else. The line keeps its single-line shape and no other line in the file changes."
check = "{ grep -c '8006' /opt/shadow-connector/.eis_backend.env || true; }"
expect = "0"

[[steps]]
kind = "edit"
path = "/opt/shadow-connector/eis_backend/GOTCHAS.md"
what = "R-EISBE-7's framing clause names two embedders after Phase 2. The hub is gone: rewrite that sentence so LypheCLI's application panes are the ONLY embedder, and remove the hub and its port from the rule entirely. The clause's point -- same host, so the SameSite=Lax cookie rides inside the frame -- is unchanged."
check = "{ grep -ci 'applications hub\\|8006' /opt/shadow-connector/eis_backend/GOTCHAS.md || true; }"
expect = "0"

[[steps]]
kind = "run"
cmd = "sudo systemctl restart eis-app"
check = "systemctl is-active eis-app"
expect = "active"
timeout_s = 180

[[verify]]  # nothing answers on the hub's port any more, and the unit is gone from systemd's view
cmd = '''
UP=$(curl -sf --max-time 3 http://127.0.0.1:8006/healthz > /dev/null 2>&1 && echo UP || echo DOWN)
UNIT=$(systemctl list-unit-files hub.service 2>/dev/null | grep -c '^hub.service' || true)
DIR=$(test -d /home/lyphe/.claude/hub && echo PRESENT || echo GONE)
echo "port=$UP unit=$UNIT dir=$DIR"
'''
expect = "port=DOWN unit=0 dir=GONE"
timeout_s = 180

[[verify]]  # not one pointer is left in the ten files that carried them
cmd = '''
FILES="/home/lyphe/.claude/.gitignore /home/lyphe/.claude/README.md /home/lyphe/.claude/descent/README.md /home/lyphe/.claude/descent/ui/index.html /home/lyphe/.claude/descent/ui/descent.css /home/lyphe/.claude/ArchPulse/vite.config.ts /opt/shadow-connector/eis_backend/GOTCHAS.md /opt/shadow-connector/.eis_backend.env docs/hosting.md vite.config.js"
N=$({ grep -lie 'applications hub' -e '~/.claude/hub' -e '/home/lyphe/.claude/hub' -e 'hub.service' -e ':8006' $FILES 2>/dev/null | wc -l; })
echo "files=$(echo $FILES | wc -w) pointers=$N"
'''
expect = "files=10 pointers=0"
timeout_s = 180

[[verify]]  # and none has appeared anywhere else in this app's own source or prose
#           docs/plans is excluded: this plan, and every plan, is a record of what was done and
#           says the hub's name on purpose. A record is not a pointer.
cmd = '''
{ grep -ril --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.git --exclude-dir=plans \
    -e 'applications hub' -e '~/.claude/hub' -e 'hub.service' \
    src server docs vite.config.js 2>/dev/null | wc -l; }
'''
expect = "0"
timeout_s = 300

[[verify]]  # the EIS grant survived the removal: CloudCLI still frames it, the hub no longer can
cmd = '''
sleep 3
curl -s -o /dev/null -D - http://127.0.0.1:8004/ | tr -d '\r' | grep -i '^content-security-policy:' \
  | grep -o 'frame-ancestors[^;]*' \
  | python3 -c "import sys; s=sys.stdin.read(); print('cloudcli=%s hub=%s count=%d' % ('http://eis1.tail8717cd.ts.net:5183' in s, '8006' in s, len(s.split())-1))"
'''
expect = "cloudcli=True hub=False count=8"
timeout_s = 180

[[verify]]  # this app still builds and still allows the two hosts it is opened under
cmd = '''
npm run build:client > /tmp/apps-p8-build.log 2>&1 || { tail -8 /tmp/apps-p8-build.log; exit 1; }
HOSTS=$(grep -c "allowedHosts: \['eis1', 'eis1.tail8717cd.ts.net'\]" vite.config.js)
echo "build=OK hosts=$HOSTS"
'''
expect = "build=OK hosts=1"
timeout_s = 600
```

**What to build.** A deletion, and ten corrected sentences.

**Sirens.** You will want to keep the hub folder "just in case" — its seven entries are already in
`server/modules/apps/apps.seed.ts` and in the running registry, which is what makes the deletion
safe; a kept copy is the second home the house rule exists to prevent. You will want to write
"(formerly the Applications Hub)" into a corrected sentence — that is the SUPERSEDED shape; the
sentence names what is true now, and nothing else. You will want to delete `allowedHosts` and
`--strictPort` along with the comments that explain them by the hub — the hosts are still needed;
only the reason changed. You will want to reach for `git rm` because the hub is tracked in
`~/.claude` — `rm -rf` only; every git write is forbidden in this run, and the deletion is the
operator's to commit later. You will want to fix Descent's scrollbar rule while you are in its
CSS — the behaviour still applies inside a CloudCLI pane; only the name in the comment is wrong.
You will see the word "hub" in the Universe module's graph code meaning a highly-connected node
(sixteen lines, measured) — that is not this hub; it is not in your manifest and it is not yours.

## Phase 9 — The lane's documentation
Depends on: Phase 8

```toml
[phase]
id = "9"
builder = "prometheus"
model = "sonnet"
code_change = false
doc_sweep = "foreground"
expected_s = 1500
manifest = [
  "docs/applications.md",
  "docs/README.md",
]
forbidden = [
  "src",
  "server",
  "scripts",
  "docs/hosting.md",
  "docs/kanban.md",
  "vite.config.js",
]
athena = [
  "The document describes routes that do not exist, or omits one that does",
  "The registry's path or its git-ignored nature is described wrongly, so a builder appends a row to a file nothing reads",
  "The {host} rule is described as server-side, when it is resolved in the browser",
  "A second document about the switcher was created instead of docs/applications.md being the one home",
  "The hub is described as if it still existed, or as if it could be returned to",
  "The probe's invocation is written from the plan's prose rather than read from scripts/apps-ui-probe.mjs as it actually shipped",
]

[[steps]]
kind = "edit"
path = "docs/applications.md"
what = "Write the lane's document in the register of docs/kanban.md: what the application switcher is and that it replaced the Applications Hub; the registry file -- where it lives, that it is git-ignored, that it is created on first boot from a seed of seven entries, that it is read on every request so a row appended by hand or by curl shows up on the next open of the drawer, and the exact three routes with a worked curl example carrying a bearer token; the {host} rule and WHERE it is resolved (in the browser, so one file serves LAN and Tailscale); the self-origin rule and why the CloudCLI row opens a new tab; the FAB -- its dock to the left of the wordmark, the drag, the 64px snap, and the localStorage record that holds the position, the dual flag and the ratio but never which applications were open; the drawer and its per-row Reload and Open in a new tab; the panes, their allow=geolocation, and the fact that a pane covers the main region while the sidebar and a streaming chat keep running underneath; the two kit components and the one drag hook, and the body class that keeps a drag alive across a cross-origin iframe; which applications can be framed and which cannot -- EIS by grant in EIS_FRAME_ANCESTORS, Dispatch never, because it sends X-Frame-Options: DENY; and how to run scripts/apps-ui-probe.mjs, read from the file as it shipped."
check = "grep -c '/api/apps' docs/applications.md"
expect_re = "^([3-9]|[1-9][0-9]+)$"

[[steps]]
kind = "edit"
path = "docs/README.md"
what = "Add one bullet to the feature list in the shape of the Kanban Board bullet at line 62, naming the application switcher, what it does in one sentence, and pointing at applications.md. Change nothing else in the file."
check = "grep -c 'applications.md' docs/README.md"
expect = "1"

[[verify]]  # the document names the registry, the placeholder and the rule that keeps this app out of its own pane
cmd = '''
F=docs/applications.md
A=$(grep -c 'apps.local.json' $F); B=$(grep -c '{host}' $F); C=$(grep -ci 'new tab' $F); D=$(grep -c 'geolocation' $F)
echo "registry=$((A>0)) host=$((B>0)) newtab=$((C>0)) geo=$((D>0))"
'''
expect = "registry=1 host=1 newtab=1 geo=1"

[[verify]]  # the probe's usage line in the document matches the script that shipped
cmd = '''
USAGE=$(grep -o 'apps-ui-probe.mjs[^`"]*' scripts/apps-ui-probe.mjs | head -1)
grep -c "apps-ui-probe.mjs" docs/applications.md
'''
expect_re = "^[1-9][0-9]*$"

[[verify]]  # docs/applications.md is the ONE home: no module README was created for the switcher
cmd = "{ ls server/modules/apps/README.md src/modules/app-switcher/README.md docs/app-switcher.md 2>/dev/null | wc -l; }"
expect = "0"

[[verify]]  # the document is reachable from the docs index
cmd = "grep -c 'applications.md' docs/README.md"
expect = "1"
```

**What to build.** Prose, and only prose.

**Sirens.** You will want to document the hub and how to bring it back — it is gone, and a
document that explains how to restore it is the pointer the house rule forbids. You will want to
write a second document for the server module because every other server module has a README — the
switcher has exactly one documentation home and a check refuses a second. You will want to
describe floating chats and floating windows, because the request mentions them — they are out of
scope in this plan and naming them as coming is a promise the code does not keep. You will want to
copy the probe's usage line out of this plan — read it out of `scripts/apps-ui-probe.mjs` as it
actually shipped.

## Goal

**Goal:** the application switcher lives inside LypheCLI — a docking, draggable FAB opens a drawer
of applications read live from a git-ignored `apps.local.json` the server creates and seeds on
first boot; choosing one fills the main region, two fill it side by side behind a divider clamped
to 15%–85%; and the Applications Hub, its systemd unit and every pointer to it are gone.

**Verify by:** Phase 7's headless-browser probe, at an explicit 1280×900, printing `PROBE OK` with
`DOCKED=1 PANES=2 SPLIT=1 FABMOVED=1 FABSNAPPED=1 FABPERSIST=1 WORDMARK=1` — `DOCKED` and
`FABSNAPPED` being the operator's own headline requirement, that the button lives beside the
wordmark and snaps back when it is thrown at its dock — Phase 1's real-server curls answering
`apps=7 ids=descent,eis-app,dispatch,cerberus,archpulse,storybook,cloudcli` and `401` without a
token, and Phase 8's sweep answering `port=DOWN unit=0 dir=GONE` with zero pointers left in the
house.

## Waves

A wave is a set of phases that could run at the same time — nothing more.

```
Wave 1: Phase 1, Phase 2, Phase 3 — independent; the server module, the EIS grant and the kit
                                    scaffold share no file, no gate and no service
Wave 2: Phase 4 — the kit's behaviour, on the scaffold it fills
Wave 3: Phase 5 — the client's data layer; needs the route to answer
Wave 4: Phase 6 — the switcher's screens and mounts; needs the kit and the types
Wave 5: Phase 7 — the switcher's behaviour; needs the filled kit and the scaffold
Wave 6: Phase 8 — the retirement; needs the replacement to work, and the EIS line Phase 2 wrote
Wave 7: Phase 9 — the prose
```

**Wave 1's three phases are gate-disjoint as well as file-disjoint.** Phase 1 gates on
`npm run typecheck` plus `lint:server`, Phase 3 on the client `tsc -p tsconfig.json` plus
`lint:client`, and Phase 2 on a curl of another process's header. Phase 1's typecheck spans both
tsconfigs, so it reads Phase 3's tree — but Phase 3 only ADDS files that nothing imports until
Phase 6, so a half-written kit cannot fail it; each of the three touches a different half of the
repository and the two servers they touch are different processes.

The split mode is off: this is one plan in one file, walked in written order. Wave 1 holds three
independent phases of a sitting each; asking for the split would make them three sessions. Every
render-touching phase is a scaffold and a fill pair, as the route classifier requires.

## Decisions already made, with their reversals

| Decision | Why | Reversal |
|---|---|---|
| The switcher is a LAYER over the main region, not a workspace tab | the operator's "keep the existing behavior" is full-bleed panes with a floating drawer button — and two measured facts make a tab actively wrong, not merely heavier: `WorkspaceTabs` is rendered ONLY when a project is selected (`ProjectSidebarRegion.tsx`, the `tabs` const's own guard), so the switcher would be unreachable with no project open; and `activeTab` is RESTORED FROM STORAGE on mount (`useProjectsState.ts`'s `readPersistedTab`), so a tab would reopen the browser straight into somebody else's application — the exact surprise this plan refuses when it declines to persist which apps were open. A tab would also need `AppTab`, `VALID_TABS`, two command palettes and eleven locales to say something it cannot say | mount `AppSwitcherLayer` from `WorkspaceMain.tsx` behind an `activeTab === 'apps'` branch and add the tab; the layer's own props do not change |
| The pane covers the MAIN REGION only, never the sidebar | the sidebar is the way back to a project, the workspace stays mounted and a streaming chat keeps running underneath | move `<AppSwitcherLayer />` up one level in `ProjectWorkspaceShell.tsx` to be a sibling of the sidebar |
| The FAB is ONE always-fixed node, docked by reading the dock's rect | a node that unmounts from the header when a drag begins takes its pointer capture with it and the drag dies on the first pixel | render it in-flow in the header and in a portal when floating, and re-arm the capture on the new node at the first move |
| The FAB's position lives in `localStorage`, not in `auth.db` | the operator asked for it to be remembered per browser; a phone and a desktop want different spots for the same account | swap `utils/appSwitcherStorage.ts` for `readUserPreference`/`writeUserPreference` from `src/shared/userSettings.ts` — one file changes |
| Which applications are open is NOT persisted | a window that reopens into somebody else's application is a surprise, and the first paint gets slower for it | add the two ids to `AppSwitcherRecord`; the provider already reads and writes it |
| `{host}` is resolved in the BROWSER | one registry file serves a LAN reader and a Tailscale reader, which is the hub's own mechanism (`seed.js:34`) and the whole reason the placeholder exists | resolve it server-side from the `Host` header in `listApps`, and drop the placeholder from the wire |
| A row that IS this app opens in a new tab, decided by hostname plus `selfPorts` | the operator asked to keep all seven entries verbatim, including CloudCLI; framing this app inside itself is a hall of mirrors, and an origin-only test misses it whenever the browser is on the app's other port | drop `selfPorts` from the response and compare origins alone |
| The registry is read on every request; no watcher, no websocket frame | a list that changes weekly does not need a frame kind, an allowlist entry and a lifecycle; the drawer refreshes when a person opens it | add an `fs.watch` in `apps.store.ts` and one `apps_changed` frame beside the kanban one; the client hook already has `refresh()` |
| A corrupt registry is a 500 and is never repaired | overwriting the operator's list on one stray comma is how a list disappears | let `readApps` fall back to `DEFAULT_APPS` on a parse error — one branch in one function |
| No `PATCH`, no add form, no favourites, no reorder | the operator's use is that a builder appends a row; `POST` and `DELETE` say everything an edit does, with one less surface | add `PATCH /api/apps/:id` and a form in the drawer's footer, as the hub had |
| Reload bumps a React `key` instead of swapping `src` to `about:blank` on a timer | the hub's 30ms timer (`design/Applications Hub.dc.html:337-341`) is a race with nothing to win; a key bump remounts the iframe synchronously | restore the src swap in `AppPane.tsx`; nothing else reads the nonce |
| `usePointerDrag` lives IN `src/shared/ui/`, not in `src/shared/hooks/` | the standard's clause is about hooks shared by feature MODULES, and this one has none; what it does have is `vv-dragging` and a `PointerDragKind` naming two kit components, so in `src/shared/hooks/` the kit's mechanism would point up out of the kit and back down at its own stylesheet. Measured: no file under `src/shared/ui/` imports from `src/shared/hooks/` today | move it to `src/shared/hooks/` and swap `PointerDragKind` for a `dragClassName` prop the day a feature module wants it — the standard's own rule |
| Two new kit components, one new stylesheet, one new hook | `DESIGN_DOCTRINE.md` §2: pointer capture, a dock hit-test and a clamped divider are mechanism, which nothing composes; and `controls.css` is already 440 lines, past its own stated ceiling | keep them inside `src/modules/app-switcher/` as module-private components; the props do not change |
| `scripts/apps-ui-probe.mjs` duplicates the CDP plumbing of `kanban-ui-probe.mjs` | the two probes beside it belong to shipped plans whose verification must keep working byte-identically, and refactoring somebody else's proof mid-run is how a green gate turns red for an unrelated reason | extract `scripts/lib/cdp.mjs` and have all three import it — its own checkpoint, once this plan has shipped |
| The i18n keys go in the existing `common.json`, not a new namespace | a new namespace file costs eleven imports, eleven `resources` edits and one `ns` edit in `config.ts:16-98,126-133,226` | create `applications.json` per locale and pay those twenty-three edits |
| `isSelfOrigin` is written fresh rather than reusing `isForeignOrigin` | `docspaceOrigin.ts` answers nearly the same question, and it is a chat-domain module file: importing it from the switcher is a deep cross-module import, banned by `boundaries/dependencies` (`.oxlintrc.json:260-263`) and a wrong-way coupling besides. The questions also differ — widgets asks origin-only to gate `allow-same-origin`, where being conservative is correct; the switcher needs the app's own port set, because the browser may be on either of them. A comment in each direction keeps both findable | lift ONE predicate into `src/shared/utils.ts` and have both call it; that is a shared-file edit and a `.oxlintrc.json` entry, which is why it is not done inside this plan |
| `usePointerDrag` is this repo's THIRD pointer-drag mechanism, and it is not a convergence | `src/modules/universe/utils/universePointer.ts` (pointer capture, 6px click slop) and `src/modules/sidebar/hooks/useSimpleChatReorder.ts` (5px threshold, window listeners, unmount cleanup, the `detail === 0` click swallow) already exist. Both are load-bearing inside shipped features, and merging three gesture models mid-run would put two working surfaces at risk for a feature that needs neither of them changed. This one takes the click-swallow RULE from the second, by citation, rather than its code | converge all three on the kit's hook once this plan has shipped — its own checkpoint, in the order universe → sidebar, each proven against the real surface it drives |
| The hub's five `:8006` origins leave EIS in Phase 8, not Phase 2 | the hub is still serving readers until the switcher replaces it; removing its grant first would break a working thing for a week of walking | remove them in Phase 2 and accept the gap |

## Edge cases and their endings

- **The registry file is absent** — the server creates it with the seven seeded entries, at module
  creation and again at the top of every read. Deleting it is a supported way to reset it.
- **The registry file is corrupt** — `GET` answers 500 with a plain message, the file is left
  exactly as it is, and the drawer raises a `Banner` carrying that message. Nothing is overwritten.
- **A row is appended by hand while the drawer is open** — it appears the next time the drawer is
  opened, because the drawer refreshes on open. No reload, no restart.
- **A row's url has no `{host}`** — it is used as written. The placeholder is optional.
- **A row resolves to this app** — it opens in a new tab and is never framed, and its menu shows
  only that action.
- **Dispatch (`:8003`) is opened** — its pane stays blank because it sends `X-Frame-Options:
  DENY`. That is accepted, not worked around; the row's "Open in a new tab" is the way in.
- **The EIS pane is opened from an origin EIS was not granted** — the pane stays blank. The grant
  is exact-origin by design (`middleware.py` skips anything malformed), and Phase 2's verify is
  what proves the eight names.
- **A drag crosses a pane** — the body class turns `pointer-events` off on every iframe for the
  length of the drag, and the capture-phase release turns them back on before any bubble-phase
  handler runs. Without it the drag dies the moment the cursor enters a pane.
- **A drag is cancelled by the browser** (a context menu, a lost pointer) — `pointercancel` runs
  the same release, so the classes never outlive the gesture.
- **A component unmounts mid-drag** — the hook's cleanup releases too, so a torn-down FAB cannot
  leave every iframe in the application deaf.
- **The FAB is thrown off screen** — it cannot be: the position is clamped to the viewport with
  8px of padding before it is ever stored.
- **The FAB is dropped near the dock** — within 64px of the dock's centre it snaps back and the
  record reads `docked: true`. The dock's rect is taken only from a header that is actually
  visible, because a zero-sized rect is rejected.
- **The window is resized while the FAB floats** — its stored `x`/`y` are re-clamped on the next
  render, so it never ends up outside the new viewport.
- **The divider is dragged past either end** — the ratio clamps at 0.15 and 0.85; no drag is
  refused and the pane never disappears.
- **Dual screen is turned off with two applications open** — the second pane closes and the first
  fills; nothing is re-fetched.
- **A locale is missing the `applications` block** — i18next falls back to English silently
  (`config.ts:220`), which is exactly why Phase 7 counts all eleven rather than trusting the eye.
- **The probe server is already up on 7893** — `boot_probe_server` reuses it instead of failing,
  so two verifies in a row cost one boot.
- **A `SQLITE_BUSY` while the operator's own server holds the file** — run the command once more;
  if it fails again, file `[BLOCKED: sqlite busy]`.

## Exclusions — named, not deferred into a step

- **Floating windows and floating chats are out of scope.** The operator put them out of scope
  himself. The layer's shape leaves room for them — the workspace stays mounted beneath an open
  application — but nothing in this plan floats a chat.
- **No add or edit form in the drawer.** Appending is `POST /api/apps` or one line in the file,
  which is the operator's stated use ("as we create applications I want them to essentially be
  appended here"). The hub's add form, favourites and reorder are not carried over.
- **No MCP tool, no autonomy, no registry of registries.** Nothing schedules or launches anything.
- **No change to `server/modules/kanban/`, `src/modules/kanban/` or the board's kit and probe.**
- **No workspace tab, and no change to `AppTab`, `VALID_TABS`, `WorkspaceTabs.tsx` or
  `WorkspaceMain.tsx`.**
- **No `X-Frame-Options` workaround for Dispatch.** An application that refuses framing is opened
  in a new tab.
- **No test file, no test runner config, no `tests/` entry.**
- **No commit and no push.** The run ends with its work in the working tree — in this repo, in
  `~/.claude` where the hub was deleted, and in `/opt/shadow-connector` where two files changed.
- **No Cloudflare, no TLS, no public exposure.** The origins granted are the ones this machine
  already answers to on the LAN and the tailnet.

## Doctrine citations

- `~/.claude/CLAUDE.md`: no branches; no unit tests ever; healed means deleted; verify before
  answering; root cause before fix; leave it better than you found it; a plan never involves the
  operator.
- `AGENTS.md` → `.agents/skills/backend-module-standards/SKILL.md` and
  `.agents/skills/frontend-module-standards/SKILL.md`: module layout, barrels, `@/` imports,
  `type` over `interface`, type placement, thin routes, `src/modules/<feature>/utils/` for a large
  module-private utility (`:88-89`). Their "add unit tests" clause is overridden by the house rule
  above, and that override is stated in Project Constraints so no builder has to weigh it alone.
- `~/.claude/design/DESIGN_DOCTRINE.md`: §1 the design system decides which components exist; §2
  the compose-or-component test, and mechanism as the one thing that earns a component; §3 screens
  compose and never build; §4 layout and paint stay separate; §6 colour is never the whole signal.
- `/opt/shadow-connector/eis_backend/GOTCHAS.md` **R-EISBE-7** (`:434-460`): `frame-ancestors` is
  `'none'` by default, `EIS_FRAME_ANCESTORS` names the only embedders as exact origins validated
  at import, a malformed entry is skipped silently, and the embedder must frame the app on the
  same host it was opened from so the `SameSite=Lax` session cookie rides inside the frame.
- `docs/architecture/README.md`: the app's websocket vocabulary — cited because this plan
  deliberately adds nothing to it.
- `docs/verification.md` and `docs/plans/lyphecli-kanban-board.plan.md`: the real-system
  verification lane this plan reuses — a second server on 7893, a minted JWT, a headless Chromium
  driven over CDP.

## Scout findings behind this plan

Every anchor in this file came from one of these; none of it was inferred.

- **hub** — the seven registry entries verbatim, `{host}` resolved client-side at `seed.js:34`,
  the body-class drag cure at `drag.js:58-63,78-94`, the 15–85% clamp at
  `design/Applications Hub.dc.html:284,358`, the reload and new-tab actions at `:337-343`, the
  drawer's rows and menu, the unit at `/etc/systemd/system/hub.service` with its install lines,
  and the missing `allow` attribute that refused Descent its geolocation (`README.md:29`).
- **hubrefs** and **hubrefs2** — the complete pointer list: nine lines across `~/.claude`'s
  `.gitignore` and `README.md`, Descent's `README.md`, `ui/index.html` and `ui/descent.css`, and
  ArchPulse's `vite.config.ts`; plus six inside this repo (`docs/hosting.md:34,81,83,84` and
  `vite.config.js:48-49`). `hub.service` is system-scope, enabled and active; no user-scope unit
  exists. Sixteen "hub" hits in the Universe module mean a graph node, not this hub.
- **sidebar** — `SidebarHeaderProps` and its `tabs` slot at `:33`, `LogoBlock` at `:38-49`, its
  four call sites at `:141,144,244,247` with two of them inside the dashboard anchor, the desktop
  block at `:130-224` against the mobile block at `:233-299`, the slot wiring from
  `ProjectSidebarRegion.tsx:40-53,69,93`, and the measured absence of any drag handler in the file.
- **workspace** — `ProjectWorkspaceShell.tsx:16-30` as the one place the sidebar, the main region
  and the global overlays are laid out; `WorkspaceMain.tsx`'s conditional blocks and the Kanban
  mount at `:405-412`; `BASE_TABS`; `VALID_TABS` at `useProjectsState.ts:349`; `AppTab` at
  `src/shared/types.ts:54`; and `ToastStack` as the app's existing fixed overlay above the routes.
- **verve** — the 34-component kit and the absence, measured, of a FAB, a split pane, a drawer
  primitive and any shared drag helper; the four stylesheets and their line counts; the barrel's
  load-bearing import order at `index.ts:24-29`; `setPointerCapture` existing only in
  `src/modules/universe/utils/universePointer.ts:92`; and the `userSettings.ts` / `uiPreferences.ts`
  persistence split.
- **server** — the flat mount block at `server/index.ts:156-241` with the kanban mount at `:192`,
  the guard riding the mount, the kanban module shape, `fs.readFileSync`/`writeFileSync` as this
  server's JSON idiom (`plugin-registry.service.ts:37-51`), the atomic scratch-then-rename
  discipline at `deepseek-flash-switch.ts:86-100`, the 153-line `.gitignore` with no JSON rule, and
  the port defaults at `:318,321`.
- **eis** — `EIS_FRAME_ANCESTORS` at `/opt/shadow-connector/.eis_backend.env:40`, its parse at
  `middleware.py:67-83`, the CSP assembly and the `X-Frame-Options` deletion at `:200-227`, the
  `eis-app` unit and its restart line, and R-EISBE-7 at `GOTCHAS.md:434-460`.
- **serving** — `cloudcli-client-dev.service` serving Vite on `0.0.0.0:5183` and
  `cloudcli-server-dev.service` serving the API on `127.0.0.1:3011`, the live listeners, the
  Tailscale address `100.103.222.79`, the tailnet names `eis1` and `eis1.tail8717cd.ts.net`, the
  LAN address `192.168.1.95`, and the fact that `dist/index.html` exists so the node server serves
  the built SPA.
- **i18n** — the eleven locales, the six namespaces, the 66 static imports and the hand-wired
  `resources` map at `config.ts:16-98,126-133,226` that make a new namespace expensive, and
  `fallbackLng: 'en'` at `:220` that makes a skipped locale fail silently.
- **panel** — the kanban module's file list and its one-door barrel, the `kanban` api group at
  `api.ts:645-672`, the `get`/`post`/`del` helpers at `:157-171`, `authenticatedFetch`'s token
  attachment at `:86-97`, and the existing origin-building code at `docspaceOrigin.ts:63,148`.

Measured again on the reviewed draft, 2026-09-16 — the facts the amendments rest on, each read at
its source:

- `.oxlintrc.json:69-81,97-112` are EXPLICIT file enumerations ending in `kanban-types.ts`, under
  `"boundaries/no-unknown": "error"` (`:271,329`) — which is why each new sibling type file carries
  one list entry in the phase that creates it.
- `SidebarHeader.tsx:113-116` states the two-blocks rule in its own words, and `:183` / `:267`
  implement it as `{tabs && !isCompact}` / `{tabs && isCompact}`; `SidebarContent.tsx:94` declares
  `tabs` REQUIRED, which is why `leading` is declared optional at all three points of the thread.
- `ProjectSidebarRegion.tsx:76-78` hides the mobile sidebar with `invisible opacity-0` —
  `visibility: hidden` keeps the layout box — and `:88` translates it `-translate-x-full`;
  `Sidebar.tsx:264-265` swaps `SidebarCollapsed` in for the whole header. Those two lines are the
  dock rect's four rules.
- The z-stack the FAB lands in: `ProjectSidebarRegion.tsx:76` `z-50` in-tree, `Dialog.tsx:185,205`
  `z-50` portalled, `ActionMenu.tsx:214` `z-[70]`, `McpServerFormModal.tsx:107` `z-[10000]`,
  `verve/feedback.css:73` `z-index: 10001` — so the FAB is 60.
- `useSimpleChatReorder.ts:188-194` is the house's existing answer to the click-after-drag seam,
  keyed on `event.detail === 0`; `docspaceOrigin.ts:146` `isForeignOrigin` is `isSelfOrigin`'s
  deliberate twin; `universePointer.ts:92` is the first of the three drag mechanisms.
- Ten contexts under `src/modules/*/context/*Context.tsx` and ZERO `*Provider.tsx` files anywhere
  under `src/modules/`; and no file under `src/shared/ui/` imports from `src/shared/hooks/`.
- `ProjectWorkspaceShell.tsx` is 38 lines — its returned tree is `:16-36` and
  `<ProjectCommandPalette />` sits at `:33`, not where the first draft said — which is why the
  mount table is anchored by symbol, per `docs/architecture/README.md`.

Measured directly, 2026-09-16: `sudo -n -l` reporting `(ALL) NOPASSWD: ALL`, so every systemd step
in this plan runs unattended; `findApplicationRoot(getModuleDirectory(import.meta.url))` as this
server's own way to find its root from inside a module (`server/modules/deepseek/index.ts:31`);
`hub.service` live since 2026-09-11 with `eis-app` live since 2026-09-16; and the absence of a
`README.md` at this repo's root, which is why `docs/README.md` is the index Phase 9 writes into.

## Open Questions

None. Every scope question this plan raised was answered from the code, the codices or the
operator's locked decisions, and each reversible default is named with its reversal in the
Decisions table above.

## Ship Logs

### Phase 1 Ship Log — ⛔ BLOCKED 2026-09-16
- [BLOCKED: forbidden-changed: src]
- run: application-switcher-plan-20260916-174904-e358 · attempt 1 of 2 · fix-passes 0 of 2 · spec_sha ce5187d61e00 · retry: on-spec-change
- builder: hephaestus/deepseek-flash · session ae5d9a33-3dd3-4a85-b489-56c91f417d92 · 272s · RESULT: DONE
- forbidden: CHANGED: src
- evidence: /home/lyphe/.claude/state/runner/application-switcher-plan-20260916-174904-e358/phase_1/

### Phase 1 Ship Log — ↻ REPLANNED 2026-09-16
- run: application-switcher-plan-20260916-174904-e358 · replan 1 of 3 · spec_sha ce5187d61e00 → 86d8c892e99e · replanner odysseus/claude-opus-5 · session 9cbc66df-79dd-4f1c-920d-ab17cfc3de29 · 252s · cost $2.89
- cause: forbidden-changed: src
- changed: I rewrote Phase 1 of the plan so it can run again. The runner's four checks pass (lint, gate and walk run clean; the lock token still reads `lock:d8a78659fe`). The phase's hash moved from `ce5187d61e00` to `86d8c892e99e`, and the runner's no-weakening check passes. Every change sits inside the Phase 1 section. **Why it blocked.** Nothing the builder wrote is under `src/`. Another session is editing files under `src/` right now, and the runner blamed this phase because of a flaw in how it recognises read-only commands. The builder ran one long read-only line that included `git status --short -- … src …`. That line also held `grep -E "…app-types|^[-+].*kanban-types"`. The runner's command spl
- evidence: /home/lyphe/.claude/state/runner/application-switcher-plan-20260916-174904-e358/phase_1/

### Phase 1 Ship Log — ⛔ BLOCKED 2026-09-16
- [BLOCKED: foreign-write: src — moved by a neighbouring session (src/modules/universe, 17:53–17:58); no child of this phase named it. Filed as forbidden-changed by the runner's attribution scanner, which read a quoted `|` as a pipe and the replanner's own log as builder evidence; both cured in hooks 2026-09-16]
- run: application-switcher-plan-20260916-174904-e358 · attempt 1 of 2 · fix-passes 0 of 2 · spec_sha 86d8c892e99e · retry: allowed
- builder: hephaestus/deepseek-flash · session 6163289a-c81d-448f-ab7d-d9d5d43f8127 · 145s · RESULT: DONE
- forbidden: CHANGED: src — a neighbour's write, not the builder's
- evidence: /home/lyphe/.claude/state/runner/application-switcher-plan-20260916-174904-e358/phase_1/

### Phase 2 Ship Log — ✅ SHIPPED 2026-09-16
- run: application-switcher-plan-20260916-174904-e358 · attempt 1 of 2 · cycle 3 · spawns 8/200 · fix-passes 1 of 2 · cost $0.89 (run $5.59) · resumed 0×
- builder: hephaestus/deepseek-flash · session 0eaf4b30-4883-4e9a-b0eb-346607cf9c30 · 40s · RESULT: DONE
- athena: pass 1/deepseek-flash BLOCKING 0 · HIGH 0 · MED 3 · LOW 1 → fix-pass 1/deepseek-flash (80s) — fixed, not re-reviewed (max_review_passes 1)
- checks: 3/3 steps OK · verify 3/3 OK
- forbidden: unchanged (2 declared, 2 present) · narrowed by 41 file(s) another live run owns
- docs: Prometheus returned · 0 files
- residue: BLOCKING 0 · HIGH 0 · MED 3 · LOW 1 handed to fix-pass 1, not re-reviewed
- evidence: /home/lyphe/.claude/state/runner/application-switcher-plan-20260916-174904-e358/phase_2/

### Phase 3 Ship Log — ⛔ BLOCKED 2026-09-16
- [BLOCKED: foreign-write: src/modules — moved by a neighbouring session (src/modules/universe, 18:15–18:16); no child of this phase wrote under it. Filed as forbidden-changed by the runner's attribution scanner, which matched `node_modules` as `src/modules` and read a whole line for one `rm -rf /tmp/…` segment; both cured in hooks 2026-09-16]
- run: application-switcher-plan-20260916-174904-e358 · attempt 1 of 2 · fix-passes 0 of 2 · spec_sha 560fa9d77db4 · retry: allowed
- builder: iris/opus · session 87c5c51e-6a82-489d-adfe-265eea8f32b1 · 848s · RESULT: DONE
- forbidden: CHANGED: src/modules — a neighbour's write, not the builder's
- evidence: /home/lyphe/.claude/state/runner/application-switcher-plan-20260916-174904-e358/phase_3/

### Phase 4 Ship Log — ⛔ BLOCKED 2026-09-16
- [BLOCKED: depends: not SHIPPED: Phase 3]
- run: application-switcher-plan-20260916-174904-e358 · attempt 0 of 2 (never dispatched) · fix-passes 0 of 2 · spec_sha f1ed6e4bd0ed · retry: allowed
- evidence: /home/lyphe/.claude/state/runner/application-switcher-plan-20260916-174904-e358/phase_4/

### Phase 5 Ship Log — ⛔ BLOCKED 2026-09-16
- [BLOCKED: depends: not SHIPPED: Phase 1]
- run: application-switcher-plan-20260916-174904-e358 · attempt 0 of 2 (never dispatched) · fix-passes 0 of 2 · spec_sha cdd4e5f42a53 · retry: allowed
- evidence: /home/lyphe/.claude/state/runner/application-switcher-plan-20260916-174904-e358/phase_5/

### Phase 6 Ship Log — ⛔ BLOCKED 2026-09-16
- [BLOCKED: depends: not SHIPPED: Phase 3, Phase 5]
- run: application-switcher-plan-20260916-174904-e358 · attempt 0 of 2 (never dispatched) · fix-passes 0 of 2 · spec_sha 726de0171bfe · retry: allowed
- evidence: /home/lyphe/.claude/state/runner/application-switcher-plan-20260916-174904-e358/phase_6/

### Phase 7 Ship Log — ⛔ BLOCKED 2026-09-16
- [BLOCKED: depends: not SHIPPED: Phase 4, Phase 6]
- run: application-switcher-plan-20260916-174904-e358 · attempt 0 of 2 (never dispatched) · fix-passes 0 of 2 · spec_sha 1a2fa48aae9c · retry: allowed
- evidence: /home/lyphe/.claude/state/runner/application-switcher-plan-20260916-174904-e358/phase_7/

### Phase 8 Ship Log — ⛔ BLOCKED 2026-09-16
- [BLOCKED: depends: not SHIPPED: Phase 7]
- run: application-switcher-plan-20260916-174904-e358 · attempt 0 of 2 (never dispatched) · fix-passes 0 of 2 · spec_sha c5060eae83c4 · retry: allowed
- evidence: /home/lyphe/.claude/state/runner/application-switcher-plan-20260916-174904-e358/phase_8/

### Phase 9 Ship Log — ⛔ BLOCKED 2026-09-16
- [BLOCKED: depends: not SHIPPED: Phase 8]
- run: application-switcher-plan-20260916-174904-e358 · attempt 0 of 2 (never dispatched) · fix-passes 0 of 2 · spec_sha fbbbcc51002c · retry: allowed
- evidence: /home/lyphe/.claude/state/runner/application-switcher-plan-20260916-174904-e358/phase_9/

### Run application-switcher-plan-20260916-174904-e358 — COMPLETE 2026-09-16
- shipped: 2
- blocked: 1: forbidden-changed, 3: forbidden-changed, 4: depends, 5: depends, 6: depends, 7: depends, 8: depends, 9: depends, 1: skipped, spec unchanged, 3: skipped, spec unchanged
- next: re-author the phase spec each ⛔ entry names, then plan-runner start /home/lyphe/.claude/claudecodeui_lyphe/docs/plans/application-switcher.plan.md — until a phase's `spec_sha` moves it is skipped, so a run started before the edit repeats this one exactly
- brief: /home/lyphe/.claude/state/runner/application-switcher-plan-20260916-174904-e358/resume_brief.md

### Phase 1 Ship Log — ✅ SHIPPED 2026-09-16
- run: application-switcher-plan-20260916-174904-e358 · attempt 1 of 2 · cycle 5 · spawns 14/200 · fix-passes 1 of 2 · cost $1.00 (run $15.19) · resumed 1×
- builder: hephaestus/deepseek-flash · session 57435042-25bf-4da5-a924-06a639d16d05 · 49s · RESULT: DONE
- athena: pass 1/deepseek-flash BLOCKING 0 · HIGH 0 · MED 0 · LOW 3 → fix-pass 1/deepseek-flash (50s) — fixed, not re-reviewed (max_review_passes 1)
- checks: 11/11 steps OK · verify 5/5 OK
- forbidden: unchanged (5 declared, 5 present) · ⚠ NOT WATCHED: server/shared/types.ts (every file owned by another live run) · narrowed by 10 file(s) another live run owns
- docs: Prometheus returned · 0 files
- residue: BLOCKING 0 · HIGH 0 · MED 0 · LOW 3 handed to fix-pass 1, not re-reviewed
- evidence: /home/lyphe/.claude/state/runner/application-switcher-plan-20260916-174904-e358/phase_1/

### Phase 3 Ship Log — ⛔ BLOCKED 2026-09-16
- [BLOCKED: foreign-write: src/modules — moved by a neighbouring session (src/modules/universe/utils/universeLoop.ts, 19:13); the daemon that filed this was launched at 18:43 and held the attribution scanner as it then stood; the cured scanner reads the same evidence as nobody of ours (replayed 19:3x)]
- run: application-switcher-plan-20260916-174904-e358 · attempt 1 of 2 · fix-passes 1 of 2 · spec_sha 560fa9d77db4 · retry: allowed
- builder: iris/opus · session e1d33f08-e588-469e-8b9c-28ff523db15c · 193s · RESULT: DONE
- athena: pass 1/opus BLOCKING 0 · HIGH 0 · MED 2 · LOW 4 → fix-pass 1/opus (462s) — fixed, not re-reviewed (max_review_passes 1)
- checks: 5/5 steps OK · verify 5/5 OK
- forbidden: CHANGED: src/modules
- docs: Prometheus returned · 1 files
- residue: BLOCKING 0 · HIGH 0 · MED 2 · LOW 4 handed to fix-pass 1, not re-reviewed
- evidence: /home/lyphe/.claude/state/runner/application-switcher-plan-20260916-174904-e358/phase_3/

### Phase 4 Ship Log — ⛔ BLOCKED 2026-09-16
- [BLOCKED: depends: not SHIPPED: Phase 3]
- run: application-switcher-plan-20260916-174904-e358 · attempt 0 of 2 (never dispatched) · fix-passes 0 of 2 · spec_sha f1ed6e4bd0ed · retry: allowed
- evidence: /home/lyphe/.claude/state/runner/application-switcher-plan-20260916-174904-e358/phase_4/

### Phase 5 Ship Log — ✅ SHIPPED 2026-09-16
- run: application-switcher-plan-20260916-174904-e358 · attempt 1 of 2 · cycle 7 · spawns 22/200 · fix-passes 1 of 2 · cost $1.13 (run $24.74) · resumed 1×
- builder: hephaestus/deepseek-flash · session 1a848a7c-74c0-410b-b9af-b189c72012a5 · 117s · RESULT: DONE
- athena: pass 1/deepseek-flash BLOCKING 0 · HIGH 0 · MED 0 · LOW 1 → fix-pass 1/deepseek-flash (63s) — fixed, not re-reviewed (max_review_passes 1)
- checks: 7/7 steps OK · verify 3/3 OK
- forbidden: unchanged (4 declared, 4 present)
- docs: Prometheus returned · 1 files
- residue: BLOCKING 0 · HIGH 0 · MED 0 · LOW 1 handed to fix-pass 1, not re-reviewed
- evidence: /home/lyphe/.claude/state/runner/application-switcher-plan-20260916-174904-e358/phase_5/

### Phase 6 Ship Log — ⛔ BLOCKED 2026-09-16
- [BLOCKED: depends: not SHIPPED: Phase 3]
- run: application-switcher-plan-20260916-174904-e358 · attempt 0 of 2 (never dispatched) · fix-passes 0 of 2 · spec_sha 726de0171bfe · retry: allowed
- evidence: /home/lyphe/.claude/state/runner/application-switcher-plan-20260916-174904-e358/phase_6/

### Phase 7 Ship Log — ⛔ BLOCKED 2026-09-16
- [BLOCKED: depends: not SHIPPED: Phase 4, Phase 6]
- run: application-switcher-plan-20260916-174904-e358 · attempt 0 of 2 (never dispatched) · fix-passes 0 of 2 · spec_sha 1a2fa48aae9c · retry: allowed
- evidence: /home/lyphe/.claude/state/runner/application-switcher-plan-20260916-174904-e358/phase_7/

### Phase 8 Ship Log — ⛔ BLOCKED 2026-09-16
- [BLOCKED: depends: not SHIPPED: Phase 7]
- run: application-switcher-plan-20260916-174904-e358 · attempt 0 of 2 (never dispatched) · fix-passes 0 of 2 · spec_sha c5060eae83c4 · retry: allowed
- evidence: /home/lyphe/.claude/state/runner/application-switcher-plan-20260916-174904-e358/phase_8/

### Phase 9 Ship Log — ⛔ BLOCKED 2026-09-16
- [BLOCKED: depends: not SHIPPED: Phase 8]
- run: application-switcher-plan-20260916-174904-e358 · attempt 0 of 2 (never dispatched) · fix-passes 0 of 2 · spec_sha fbbbcc51002c · retry: allowed
- evidence: /home/lyphe/.claude/state/runner/application-switcher-plan-20260916-174904-e358/phase_9/

### Run application-switcher-plan-20260916-174904-e358 — COMPLETE 2026-09-16
- shipped: 1, 5
- blocked: 3: forbidden-changed, 4: depends, 6: depends, 7: depends, 8: depends, 9: depends
- next: re-author the phase spec each ⛔ entry names, then plan-runner start /home/lyphe/.claude/claudecodeui_lyphe/docs/plans/application-switcher.plan.md — until a phase's `spec_sha` moves it is skipped, so a run started before the edit repeats this one exactly
- brief: /home/lyphe/.claude/state/runner/application-switcher-plan-20260916-174904-e358/resume_brief.md

### Phase 3 Ship Log — ⛔ BLOCKED 2026-09-16
- [BLOCKED: foreign-write: src/modules — src/modules/universe/utils/universeForces.ts moved at 20:10 by the universe session; the one text of ours naming src/modules names chat/, mcp/, sidebar/ and kanban/ files, none of them the file that moved. Attribution is per moved file from this heal on; a neighbour's write no longer costs an attempt]
- run: application-switcher-plan-20260916-174904-e358 · attempt 2 of 2 · fix-passes 1 of 2 · spec_sha 560fa9d77db4 · retry: allowed
- builder: iris/opus · session 54419d2e-4dd1-4659-bb66-4df51a4215a2 · 412s · RESULT: DONE
- athena: pass 1/opus BLOCKING 0 · HIGH 0 · MED 0 · LOW 3 → fix-pass 1/opus (188s)
- forbidden: CHANGED: src/modules
- evidence: /home/lyphe/.claude/state/runner/application-switcher-plan-20260916-174904-e358/phase_3/

### Phase 4 Ship Log — ⛔ BLOCKED 2026-09-16
- [BLOCKED: depends: not SHIPPED: Phase 3]
- run: application-switcher-plan-20260916-174904-e358 · attempt 0 of 2 (never dispatched) · fix-passes 0 of 2 · spec_sha f1ed6e4bd0ed · retry: allowed
- evidence: /home/lyphe/.claude/state/runner/application-switcher-plan-20260916-174904-e358/phase_4/

### Phase 6 Ship Log — ⛔ BLOCKED 2026-09-16
- [BLOCKED: depends: not SHIPPED: Phase 3]
- run: application-switcher-plan-20260916-174904-e358 · attempt 0 of 2 (never dispatched) · fix-passes 0 of 2 · spec_sha 726de0171bfe · retry: allowed
- evidence: /home/lyphe/.claude/state/runner/application-switcher-plan-20260916-174904-e358/phase_6/

### Phase 7 Ship Log — ⛔ BLOCKED 2026-09-16
- [BLOCKED: depends: not SHIPPED: Phase 4, Phase 6]
- run: application-switcher-plan-20260916-174904-e358 · attempt 0 of 2 (never dispatched) · fix-passes 0 of 2 · spec_sha 1a2fa48aae9c · retry: allowed
- evidence: /home/lyphe/.claude/state/runner/application-switcher-plan-20260916-174904-e358/phase_7/

### Phase 8 Ship Log — ⛔ BLOCKED 2026-09-16
- [BLOCKED: depends: not SHIPPED: Phase 7]
- run: application-switcher-plan-20260916-174904-e358 · attempt 0 of 2 (never dispatched) · fix-passes 0 of 2 · spec_sha c5060eae83c4 · retry: allowed
- evidence: /home/lyphe/.claude/state/runner/application-switcher-plan-20260916-174904-e358/phase_8/

### Phase 9 Ship Log — ⛔ BLOCKED 2026-09-16
- [BLOCKED: depends: not SHIPPED: Phase 8]
- run: application-switcher-plan-20260916-174904-e358 · attempt 0 of 2 (never dispatched) · fix-passes 0 of 2 · spec_sha fbbbcc51002c · retry: allowed
- evidence: /home/lyphe/.claude/state/runner/application-switcher-plan-20260916-174904-e358/phase_9/

### Run application-switcher-plan-20260916-174904-e358 — ALL-BLOCKED 2026-09-16
- shipped: none
- blocked: 3: forbidden-changed, 4: depends, 6: depends, 7: depends, 8: depends, 9: depends
- next: re-author the phase spec each ⛔ entry names, then plan-runner start /home/lyphe/.claude/claudecodeui_lyphe/docs/plans/application-switcher.plan.md — until a phase's `spec_sha` moves it is skipped, so a run started before the edit repeats this one exactly
- brief: /home/lyphe/.claude/state/runner/application-switcher-plan-20260916-174904-e358/resume_brief.md

### Phase 3 Ship Log — ✅ SHIPPED 2026-09-16
- run: application-switcher-plan-20260916-174904-e358 · attempt 2 of 2 · cycle 10 · spawns 34/200 · fix-passes 1 of 2 · cost $5.48 (run $49.53) · resumed 4×
- builder: iris/opus · session 54419d2e-4dd1-4659-bb66-4df51a4215a2 · resumed at checks
- athena: pass 1/opus BLOCKING 0 · HIGH 0 · MED 0 · LOW 1 → fix-pass 1/opus (133s) — fixed, not re-reviewed (max_review_passes 1)
- checks: 5/5 steps OK · verify 5/5 OK
- forbidden: unchanged (8 declared, 8 present) · narrowed by 4 file(s): another live run's ground or this run's own plan
- docs: Prometheus returned · 0 files
- residue: BLOCKING 0 · HIGH 0 · MED 0 · LOW 1 handed to fix-pass 1, not re-reviewed
- evidence: /home/lyphe/.claude/state/runner/application-switcher-plan-20260916-174904-e358/phase_3/

### Phase 4 Ship Log — ✅ SHIPPED 2026-09-16
- run: application-switcher-plan-20260916-174904-e358 · attempt 1 of 2 · cycle 11 · spawns 38/200 · fix-passes 1 of 2 · cost $1.38 (run $50.91) · resumed 4×
- builder: hephaestus/deepseek-flash · session e2fbeb44-e3c7-45d0-88f8-03c17b5aac3c · 794s · RESULT: DONE
- athena: pass 1/deepseek-flash BLOCKING 0 · HIGH 1 · MED 1 · LOW 2 → fix-pass 1/deepseek-flash (310s) — fixed, not re-reviewed (max_review_passes 1)
- checks: 5/5 steps OK · verify 5/5 OK
- forbidden: unchanged (8 declared, 8 present) · narrowed by 22 file(s): another live run's ground or this run's own plan
- docs: Prometheus returned · 0 files
- residue: BLOCKING 0 · HIGH 1 · MED 1 · LOW 2 handed to fix-pass 1, not re-reviewed
- evidence: /home/lyphe/.claude/state/runner/application-switcher-plan-20260916-174904-e358/phase_4/

### Phase 6 Ship Log — ✅ SHIPPED 2026-09-16
- run: application-switcher-plan-20260916-174904-e358 · attempt 1 of 2 · cycle 12 · spawns 42/200 · fix-passes 1 of 2 · cost $13.84 (run $64.76) · resumed 4×
- builder: iris/opus · session e9bad57b-3d97-4c38-89fe-fd11013309a4 · 747s · RESULT: DONE
- athena: pass 1/opus BLOCKING 0 · HIGH 0 · MED 1 · LOW 5 → fix-pass 1/opus (269s) — fixed, not re-reviewed (max_review_passes 1)
- checks: 12/12 steps OK · verify 4/4 OK
- forbidden: unchanged (9 declared, 9 present) · ⚠ NOT WATCHED: src/shared/types.ts, src/shared/api.ts (every file is another live run's ground or this run's own plan) · narrowed by 46 file(s): another live run's ground or this run's own plan
- docs: Prometheus returned · 0 files
- residue: BLOCKING 0 · HIGH 0 · MED 1 · LOW 5 handed to fix-pass 1, not re-reviewed
- evidence: /home/lyphe/.claude/state/runner/application-switcher-plan-20260916-174904-e358/phase_6/

### Phase 7 Ship Log — ⛔ BLOCKED 2026-09-16
- [BLOCKED: builder-blocked (cured outside the phase):  DIVERGENCE: verify 1 answers `PROBE FAILED` and verify 2 reads `FABMOVED=0` — the probe's own words are `apps-ui-probe: the FAB's centre drifted 14px from the 180,90 it was dragged by` — while the plan's step 7 expects `FABMOVED=1`; the cause is outside this phase's manifest: `.vv-fab--docked` is `- — the divergence was real and in the kit: `src/shared/ui/DockableFab.tsx` measured the grab on the 36px docked box and placed the 56px floating box by its corner, a 14px centre drift the probe refused. The conductor anchored the drag by the centre (2026-09-16 22:0x); the phase's own probe then read PROBE OK with DOCKED=1 PANES=2 SPLIT=1 FABMOVED=1 FABSNAPPED=1 FABPERSIST=1 WORDMARK=1]
- run: application-switcher-plan-20260916-174904-e358 · attempt 1 of 2 · fix-passes 0 of 2 · spec_sha 1a2fa48aae9c · retry: allowed
- builder: hephaestus/deepseek-flash · session 6ec4c954-2846-4883-8ecf-6f4acafe81d0 · 815s · RESULT: BLOCKED
- evidence: /home/lyphe/.claude/state/runner/application-switcher-plan-20260916-174904-e358/phase_7/

### Phase 8 Ship Log — ⛔ BLOCKED 2026-09-16
- [BLOCKED: depends: not SHIPPED: Phase 7]
- run: application-switcher-plan-20260916-174904-e358 · attempt 0 of 2 (never dispatched) · fix-passes 0 of 2 · spec_sha c5060eae83c4 · retry: allowed
- evidence: /home/lyphe/.claude/state/runner/application-switcher-plan-20260916-174904-e358/phase_8/

### Phase 9 Ship Log — ⛔ BLOCKED 2026-09-16
- [BLOCKED: depends: not SHIPPED: Phase 8]
- run: application-switcher-plan-20260916-174904-e358 · attempt 0 of 2 (never dispatched) · fix-passes 0 of 2 · spec_sha fbbbcc51002c · retry: allowed
- evidence: /home/lyphe/.claude/state/runner/application-switcher-plan-20260916-174904-e358/phase_9/

### Run application-switcher-plan-20260916-174904-e358 — COMPLETE 2026-09-16
- shipped: 3, 4, 6
- blocked: 7: builder-blocked, 8: depends, 9: depends, 7: skipped, spec unchanged
- next: re-author the phase spec each ⛔ entry names, then plan-runner start /home/lyphe/.claude/claudecodeui_lyphe/docs/plans/application-switcher.plan.md — until a phase's `spec_sha` moves it is skipped, so a run started before the edit repeats this one exactly
- brief: /home/lyphe/.claude/state/runner/application-switcher-plan-20260916-174904-e358/resume_brief.md

### Phase 7 Ship Log — ✅ SHIPPED 2026-09-16
- run: application-switcher-plan-20260916-174904-e358 · attempt 1 of 2 · cycle 13 · spawns 46/200 · fix-passes 1 of 2 · cost $0.90 (run $65.82) · resumed 5×
- builder: hephaestus/opus · session 6ec4c954-2846-4883-8ecf-6f4acafe81d0 · resumed at checks
- athena: pass 1/deepseek-flash BLOCKING 0 · HIGH 0 · MED 0 · LOW 4 → fix-pass 1/deepseek-flash (267s) — fixed, not re-reviewed (max_review_passes 1)
- checks: 5/5 steps OK · verify 5/5 OK
- forbidden: unchanged (9 declared, 9 present) · ⚠ NOT WATCHED: src/shared/api.ts, src/shared/types.ts (every file owned by another live run) · narrowed by 48 file(s): another live run's ground or this run's own plan
- docs: Prometheus returned · 0 files
- residue: BLOCKING 0 · HIGH 0 · MED 0 · LOW 4 handed to fix-pass 1, not re-reviewed
- evidence: /home/lyphe/.claude/state/runner/application-switcher-plan-20260916-174904-e358/phase_7/

### Phase 8 Ship Log — ⛔ BLOCKED 2026-09-16
- [BLOCKED: builder-blocked (cured outside the phase): DIVERGENCE: verify 3 prints `1` instead of `0` — `server/modules/apps/apps.seed.ts:5` (`* Applications Hub's apps.json (/home/lyphe/.claude/hub/apps.json:1-9, measured 2026-09-16).`) is the single remaining hit, it is under `server/` (MUST NOT touch) and in no Phase 8 manifest, and plan line 760 req — the plan contradicted itself: Phase 1's step ordered `apps.seed.ts` to name the Applications Hub as its provenance, and this phase's sweep requires zero mentions. The hub is gone, so the pointer was stale; the conductor reworded the docstring (no hub, no path) and the sweep reads 0 (2026-09-16 22:2x). Every other step and verify of this phase had already passed]
- run: application-switcher-plan-20260916-174904-e358 · attempt 1 of 2 · fix-passes 0 of 2 · spec_sha c5060eae83c4 · retry: allowed
- builder: hephaestus/deepseek-flash · session ad37ef09-7eab-408e-889f-61725cd08960 · 227s · RESULT: BLOCKED
- evidence: /home/lyphe/.claude/state/runner/application-switcher-plan-20260916-174904-e358/phase_8/

### Phase 9 Ship Log — ⛔ BLOCKED 2026-09-16
- [BLOCKED: depends: not SHIPPED: Phase 8]
- run: application-switcher-plan-20260916-174904-e358 · attempt 0 of 2 (never dispatched) · fix-passes 0 of 2 · spec_sha fbbbcc51002c · retry: allowed
- evidence: /home/lyphe/.claude/state/runner/application-switcher-plan-20260916-174904-e358/phase_9/

### Run application-switcher-plan-20260916-174904-e358 — COMPLETE 2026-09-16
- shipped: 7
- blocked: 8: builder-blocked, 9: depends, 8: skipped, spec unchanged
- next: re-author the phase spec each ⛔ entry names, then plan-runner start /home/lyphe/.claude/claudecodeui_lyphe/docs/plans/application-switcher.plan.md — until a phase's `spec_sha` moves it is skipped, so a run started before the edit repeats this one exactly
- brief: /home/lyphe/.claude/state/runner/application-switcher-plan-20260916-174904-e358/resume_brief.md

### Phase 8 Ship Log — ✅ SHIPPED 2026-09-16
- run: application-switcher-plan-20260916-174904-e358 · attempt 1 of 2 · cycle 14 · spawns 50/200 · fix-passes 1 of 2 · cost $0.75 (run $66.64) · resumed 6×
- builder: hephaestus/opus · session ad37ef09-7eab-408e-889f-61725cd08960 · resumed at checks
- athena: pass 1/deepseek-flash BLOCKING 0 · HIGH 0 · MED 3 · LOW 5 → fix-pass 1/deepseek-flash (132s) — fixed, not re-reviewed (max_review_passes 1)
- checks: 13/13 steps OK · verify 5/5 OK
- forbidden: unchanged (4 declared, 3 present) · narrowed by 70 file(s): another live run's ground or this run's own plan · a neighbour moved scripts/universe-token.mjs; scripts/universe-token.mjs — re-baselined 2×
- docs: Prometheus returned · 0 files
- residue: BLOCKING 0 · HIGH 0 · MED 3 · LOW 5 handed to fix-pass 1, not re-reviewed
- evidence: /home/lyphe/.claude/state/runner/application-switcher-plan-20260916-174904-e358/phase_8/

### Phase 9 Ship Log — ✅ SHIPPED 2026-09-16
- run: application-switcher-plan-20260916-174904-e358 · attempt 1 of 2 · cycle 15 · spawns 51/200 · fix-passes 0 of 2 · cost $0.07 (run $66.71) · resumed 6×
- builder: prometheus/deepseek-flash · session a60ee487-46f8-4c98-97bf-e43888881971 · 160s · RESULT: DONE
- athena: n/a — code_change = false
- checks: 2/2 steps OK · verify 4/4 OK
- forbidden: unchanged (6 declared, 6 present) · narrowed by 18 file(s): another live run's ground or this run's own plan
- evidence: /home/lyphe/.claude/state/runner/application-switcher-plan-20260916-174904-e358/phase_9/

### Run application-switcher-plan-20260916-174904-e358 — COMPLETE 2026-09-16
- shipped: 8, 9
- blocked: none
- next: run complete — the checkpoint is Scott's /git, on his clock
- brief: /home/lyphe/.claude/state/runner/application-switcher-plan-20260916-174904-e358/resume_brief.md
