# Project Universe

## In one paragraph

Four repositories are crawled into one map — every tracked file a *star*, every directory and repo a *body*, the
estate a galaxy around the sun at `/home/me/.claude` — and that map is drawn as a live sky in a tab of its
own. Two taps read what the estate is *doing*: the systemd journal and the Claude transcripts, whose rows
resolve onto map stars and reach the canvas over one websocket frame kind, while the map arrives over a second
frame kind and over REST. Nothing on the sky is invented — an edit flares its star, an execution sends a comet
along edges the graph really has, and a quiet estate is a dark sky. **The map's schema has one home**, the
module docstring of `scripts/universe/build.py` (lines 1-95, the code that writes it); this document points at
it rather than restating it. See [07-live-widgets.md](./07-live-widgets.md) for the bus a digest rides, and
[02-realtime-stream.md](./02-realtime-stream.md) for the transport.

## Mental model

1. **One registry entry is the whole of adding a repo.** `state/universe/repos.json` names every galaxy, and
   nothing is ever written into a repo it names (`scripts/universe/registry.py:1-22`).
2. **A map is stale exactly when the heads it was built from have moved** — which is why the watcher reads
   `.git/HEAD` rather than asking the lane for its own `mapId`
   (`server/modules/universe/universe-heads.service.ts:6-20`).
3. **Two taps, one window.** Both push raw rows into ONE coalescer that drains at most one frame per 100 ms and
   sends nothing when the estate is quiet (`server/modules/universe/universe-activity.service.ts:3-15,35-36`).

## The pieces

| File | Role |
| --- | --- |
| `scripts/universe-crawl:2`, `scripts/universe/{registry,gitcrawl,blobs,nodes,build,merge,resolve}.py`, `edges/`, `routedump.py` | The crawler: the registry and its entry shape, git facts per repo, the line cache, the node list, the four resolvers, the three derived lanes and their caps, one live app's route table, and the build — **the map schema's one home** (`build.py:1-103`) |
| `server/modules/universe/universe-journal.tap.ts`, `universe-transcript.{tap,tail}.ts` | Tap 1: `journalctl -f -o json` per unit, resolved to a star (`:116-257`); tap 2: the byte-offset tail (`tail:1-17`), and what a tool call means (`tap:9-29`) |
| `server/modules/universe/universe.module.ts`, `{universe-activity,universe-map,universe-route-match,universe-state,universe-registry}.service.ts`, `universe.routes.ts` | The lane: held map, route, HEADS watcher, taps, broadcast (`:48-148`); The throttle, the held map, route matching, the layout, the registry read (`activity:39-99`); `GET /api/universe/map`, and deliberately no rebuild endpoint (`routes:5-13`) |
| `src/modules/universe/{UniverseFeed,UniversePanel,UniverseCanvas}.tsx`, `hooks/`, `utils/`, `src/shared/types.ts:425-506`, `src/modules/live-bus/topics.ts:19-37,56` | The live-bus door (`Feed:9-38`); the tab and its chrome (`Panel:19-43`); the sky — five stacked canvases and the cadence that repaints them, per its own header (`Canvas:43-78`); the hooks and the engine; the four universe types and `universe:*` in the bus allowlist; the frame's own cost, published every frame at `window.__universePerf` for a probe to read (`utils/universePerf.ts:1-51`) |

## The crawler

`scripts/universe-crawl build --full` crawls with each repo's own interpreter and nothing else
(`scripts/universe/cli.py:48-59`). A repo whose HEAD matches the one `index.json` already holds is skipped whole
and its file on disk reused, and a poll that changes nothing writes nothing at all — which is what makes the
files' mtimes a trustworthy trigger (`scripts/universe/build.py:220-236,282-289`). The server runs the crawl as
one CHILD at a time and reads the new `mapId` off the crawler's own summary line rather than off disk
(`server/modules/universe/universe-crawl.service.ts:1-41,86-98`). The map lands at `$UNIVERSE_STATE_DIR/map/`
(default `~/.claude/state/universe/map/`): one `<repo-id>.json` per galaxy, `index.json`, the `merged.json` the
fork reads, and the line cache at `<state>/lines.json` (`build.py:111-113`, `scripts/universe/blobs.py:1-18`).

**The registry** (`registry.py:1-22`) is the only place a galaxy is named, and its entry is the whole of what
"deploying a project to the universe" means: `id`, `path`, `role` (`sun` or `galaxy`), `units` (the systemd
units whose journal lines belong to it), `entry_file` (the star a journal line pulses when nothing else
matches), `apps` (uvicorn apps in the repo), and `pg` and `mcp` (endpoint names). Adding a galaxy is that one
entry and nothing else — no change in the repo it names. Beside it, `systems.json` names the INTEGRATION
FOLDERS — `{repo, dirs}` with segment-exact globs, seeded as `backend-repo`'s `extractors/*` and
`outbound/*` (`registry.py`, `SYSTEMS_SEED`) — and the crawler marks a matching directory node `system`
(`resolve.system_dirs`): the folder it was, with its files and history, only marked, so the sky can draw
a repo's named third-party integrations large and apart. Nothing is invented; a first design that added synthetic
platform nodes was struck by the operator (2026-09-17). `load()` sorts entries LONGEST PATH FIRST once
(`registry.py:169`) and `repo_for_path` takes the first prefix hit at a path-component boundary
(`:187`). The ordering IS the rule, which is why it ships as data in `index.json`'s `resolve` array
(`build.py:31-35`) and the server walks that array rather than re-sorting it
(`server/modules/universe/universe-map.service.ts:169-181`).

### The four lanes, and their caps

**Tree is structural, not derived** — one edge per node to its parent, built with the node list itself
(`scripts/universe/nodes.py:9-20`), so it needs no cap: a tree has one parent per node. The other three are
derived from the repo on disk, each best-effort, each carrying its budget in a named constant:

| Lane | What it is | Cap |
| --- | --- | --- |
| `import` | A **safe assumption**, never an observation: a specifier resolving to no tracked file yields no edge, and exact spellings outrank guesses | `MAX_IMPORT_EDGES = 6` per importer (`edges/import_lane.py:37`) |
| `cochange` | Stars that move in the same commits; commits over 50 files are dropped whole | `MAX_COMMIT_FILES = 50`, `MIN_COCHANGE_WEIGHT = 2`, `MAX_COCHANGE_EDGES = 8` per star (`edges/cochange_lane.py:22-23,33`) |
| `endpoint` | A `data-sql` star, or a route handler whose own text touches SQL, pointing at the repo's FIRST `pg` node | one target, weight 1; a repo naming no `pg` gets no edges (`resolve.py:170-200`) |

The co-change cap applies to the SHARED pair set — a pair survives only where BOTH ends keep it — because
capping each end alone would leave the renderer drawing a half-edge (`edges/cochange_lane.py:9-15`). All four
reach the client as weighted graph links (`src/modules/universe/utils/universeGraph.ts:115,165-168`); the
`edges` tweak chooses which are drawn, and every derived kind is dashed where the tree is solid
(`utils/universeGraphPasses.ts:143,163,177,188`). **The four resolvers** (`resolve.py:1-30`) are how a repo names
what its stars talk to: the route table, read only from inside the live app — `routedump` imports it in a
subprocess with a 45-second bound and a `killpg` on timeout (`routedump.py:1-40`) — a `.py` star, named by the
literal it hands `logging.getLogger` AND by its dotted module path (`:16-29`), and a table as a `CREATE TABLE`
in a `.sql` star (`:47-60`). An app that will not import contributes no routes and one warning, and the map is
still written (`:112-143`) — nothing here is a gate.

## The two taps

### Tap 1 — the journal

One `journalctl -f -o json -n 0` child follows every unit the registry names
(`server/modules/universe/universe-journal.tap.ts:10-17,183-229`). `-n 0` is the whole of "live": a tap that
replayed history would flood the canvas with months of access logs on the tab's first paint (`:13-15`). Each
line resolves in a fixed order — an HTTP access line to the route it matched, then a Python logger line to that
logger's star, and otherwise to the unit's own `entry_file` (`:129-144`). The matcher prefers the route with the
most literal segments, so a summary request pulses the file that declares it and not the one declaring `/{id}`,
and candidates are filtered to the unit's OWN repo first, because two repos both serve `GET /health`
(`universe-route-match.ts:50-81`, `:119-127`). **It drops** the query string (`:50-54`), any line from a unit no
repo claims, and any line that is neither shape — those last still pulse the entry file, since a line nobody
could identify is still a line from that unit.

### Tap 2 — the transcripts

A live byte-offset tail over `~/.claude/projects/**/*.jsonl`, which hands over complete lines and knows nothing
about what is written in them (`universe-transcript-tail.ts:1-17`). Offsets are in memory and never on disk,
deliberately: shared with the durable cursors next door, they would replay months of history on first paint
(`:12-16,180-187`). A 15 s walk finds files it has never seen; a 400 ms poll reads the HOT set — the files
written to inside a two-minute window — because the corpus is over four thousand files and statting all of them
four times a second is a core burnt to learn nothing (`:20-32,218-240`).

The meaning is the tap's (`universe-transcript.tap.ts:9-17`). `ADMITTED_TOOLS` (`:26`) admits
`Edit|Write|MultiEdit|NotebookEdit`, which name a file and become an **edit**, and `Skill|Agent|Task`, which
name a tracked definition and become an **execution**; a tool named `mcp__<server>__<tool>` is admitted by the
SHAPE of its name and becomes an execution against that server's endpoint (`:28-29,67-96`). **It drops `Read`
and `Bash`** — thousands a day, which would bury the edits that mean something, because a read is not an edit
and a shell command is not a file (`:12-16,74-75`).

## The two frames

Both go out over `connectedClients` — every open `/ws` socket (`universe.module.ts:61-66`) — and both are
excused from the chat reducer below.

**`universe_map`** is announced by the HEADS watcher, and that shape is the design
(`universe.module.ts:92-114`). Every 30 s the lane reads each repo's HEAD, and the comparison is against the MAP
— the heads it was built from — not against the last thing the timer happened to see (`:24,77-91`). So a boot a
minute old judges exactly as one up for a month, and a HEAD move landing mid-crawl is a retry rather than a loss
(`:92-101`). The reading is two small file reads — `.git/HEAD` names a ref, the ref holds the sha, with
`packed-refs` and worktree `commondir` covered (`universe-heads.service.ts:6-20,80-95`) — not four `git
rev-parse` subprocesses on the event loop that carries every chat socket. The frame carries the **held** map's
`mapId`, not the crawl's answer, because the held map is what the next `GET` will serve
(`universe.module.ts:108-113`).

It is not polled out of the `mapId` for the same reason it reads HEAD and not the map: the `mapId` is this
lane's own OUTPUT, derived from those heads, so a tick would be asking the effect — and the first tick after a
commit would report no change, because only the crawl that same tick kicked off can move it
(`universe.module.ts:82-91`). Watching `.git/HEAD` watches the cause (`universe-heads.service.ts:6-8`). And it
is the one frame a crawl can be silent about: a rebuild that changes nothing writes nothing, so nothing is
announced (`build.py:282-285`).

**`universe_activity`** is written by the coalescer and nothing else (`universe-activity.service.ts:3-15`). Both
taps push raw rows into one `Map` keyed `${node}|${kind}|${source}`; once per 100 ms tick it is drained into ONE
frame, capped at 200 rows, with the rows above the cap COUNTED into `dropped` rather than quietly left out — a
burst is visibly lossy instead of appearing complete (`:44-65`). **This lane does not poll at all**: it is push,
and an empty window broadcasts nothing, because the honest picture of a quiet estate is no picture, and an empty
frame ten times a second is 864,000 writes a day that say only "still nothing" (`:9-13,48-51`). It is
deliberately not a `createPolledLane`, whose contract is a picture that changed and which would therefore have
to send a heartbeat (`universe.module.ts:52-58`).

## Two rules for the word "touch"

The map holds ONE cross-repo edge, named for what it measures (`scripts/universe/edges/attention_lane.py:1-12`).
The freshness hook records a sha at every `Read` and for every path token a `Bash` command named, so a session's
state file is a list of paths it *looked at* — reads and shell mentions included. `attention` therefore counts
the sessions that touched two repos, and it is **not an edit edge** — nothing on screen may call it one
(`:47-90`). It is repo-level, its weight is a count of distinct sessions, and its source `/tmp` is wiped by a
reboot — absent state becomes a named `warnings` entry, not an empty measurement (`:19,78-90`).

The live lane's edit rule is deliberately narrower: only `Edit`, `Write`, `MultiEdit` and `NotebookEdit` make a
flare (`universe-transcript.tap.ts:26,93-95`). They are different rules because they answer different questions
— attention is where a session's focus went, and a read is exactly that; the sky is a picture of the estate
changing, and thousands of reads a day would bury the edits that mean something. The narrower rule is what earns
the word "edit" in the UI; the wider one is why the edge is called `attention`.

## The client

**The map store** (`src/modules/universe/hooks/useUniverseMap.ts:6-37`) fetches `merged.json` through
`api.universe.map` (`src/shared/api.ts:697-698`) and holds it at MODULE level, because the map is 1.4 MB and the
workspace remounts a tab's panel on every tab change. One identity rule guards every reader: `getKnownMapId()`
answers with the map the client HOLDS, never with the id a `universe_map` frame announced, because an
announcement says a crawl landed somewhere and not that this client has it (`:83-95`). The announcement opens a
fetch and the fetch landing opens the gate, so one request is ever in the air (`:96-131`).

**The activity reaches the client in two shapes** (`UniverseFeed.tsx:9-38`). The digest — how many edits and
executions the last window held — is published onto `universe:*` at most once a second, because the bus retains
one value per topic and compares every publish by `JSON.stringify`, so a lane carrying raw rows would stringify
the whole payload ten times a second whether or not anything was listening (`:20-28`,
`src/modules/live-bus/context/LiveBusContext.tsx:28,99-109`). A quiet second publishes nothing — the same rule
the server's coalescer keeps. The raw rows go, unreduced, straight to the canvas through `subscribeRows`: a
function call, React never consulted (`hooks/useUniverseStream.ts:14-27,130-135`); the ring behind it is capped
at 200 rows (`:31`). Both readers ask that same freshness rule, so the canvas and the digest can never disagree
about whether a frame from a retired map is real (`utils/universeFrames.ts:3-23`).

**What a frame draws.** A star's radius is `2.4 + min(sqrt(max(lines, 1)), 120) / 9`
(`utils/universeBirth.ts:57`) and its brightness is git recency — full inside `recencyBrightDays`, easing to
0.18 by a fixed 180 days (`utils/universeTokens.ts`, `brightnessFor` and `bandedBrightness`); its colour is its temperature, the design
export's own ramp from orange through warm white to blue keyed on its size with a stable per-star jitter
(`baseColorOf`, `universeTokens.ts`) — never its kind. A folder is its repo's pastel mixed halfway to warm white,
a repo warm white, the sun cream with a cool glow, and every glow below the sun is the repo's pastel (one of
the export's seven, by the repo's ordinal, `node.cluster`); an endpoint and an integration folder keep a
token each. Restored at the operator's word, 2026-09-17. **The sky is dark whatever the app's theme is** —
there is no white space, so there is no light sky. `UniversePanel` wraps the canvas and everything that sits ON
the sky (the counts, the controls, the selection) in a `.dark` element, and `readUniverseTokens(scope)` reads
the palette once off the canvas inside it, where every token resolves to its dark value; it is held for the
life of the page and nothing watches for a theme. The live activity feed is that wrapper's SIBLING, outside
it, so it alone follows the app's theme. An **edit is a flare** decaying
linearly to exactly zero in 2400 ms — not the export's asymptotic glow (`utils/universePulses.ts:7-28`) — and an
**execution is a pulse** routed on the real graph: from the star it resolved to, to that star's endpoint when
the graph carries an endpoint edge, and otherwise to its parent body, so an execution is one leg and never a
round trip (`:20-27`, `utils/universeComets.ts:9-15`). The starfield behind it is decoration, not a reading
(`utils/universeStarfield.ts:1-12`).

**The frame is drawn on five layers, and not every one every time.** `UniverseCanvas.tsx` renders `sky`,
`stars`, `gl`, `live` and `input` — the layer the pointer reads, carrying
the pre-stack className and aria-label unchanged (`Canvas:43-78,540-568`). `utils/universeLayers.ts` owns the
five bitmaps and their one clear; `utils/universeRenderer.ts` exports the three draws cut at that same seam —
`drawSky`, `drawStars`, `drawLive`; and `utils/universeRepaint.ts` decides which of `sky`/`stars` a frame owes
— the camera moved, an intro, a dirty flag, or else a fixed still cadence (stars every 6th frame coarse, 3rd
under zoom 1, 2nd above it; sky every 4th) — while `live` repaints every frame, because the comets, the flares
and the labels are what move (`utils/universeRepaint.ts:12-20`). `utils/universeLoop.ts` says so in its own
header: a row keeps the loop at sixty for the live layer's sake, never as licence to redraw the star layer,
which is this cadence's to bound (`:15-19`). A star's glow, core, flare halo/ring and doppler swing are pure
functions of the node alone in `utils/universeStarGeometry.ts`, with no `ctx` and no frame, so the 2D star
layer and the GPU layer below read the same shape and cannot drift.

**The `gl` layer draws the stars when the `renderer` tweak reads `webgl` and this page has WebGL to give
it.** `utils/universeStarsGL.ts`'s `createStarsGL` links one program over the `gl` canvas and answers `null`
for a page with no WebGL or a program that will not link; `UniverseCanvas.tsx`'s frame loop decides, once a
frame, whether `drawStars` is handed that layer or `null`, and the same decision — not the tweak, read a
second time — is what `perfSample.renderer` reports, so a page with no WebGL always reads `canvas` however
the tweak is set. With a layer, every star whose glow and disc fit under the device's own point-size ceiling
(`gl.ALIASED_POINT_SIZE_RANGE`) is one typed-array buffer, one upload and two `drawArrays` calls — the glow
half additive, the disc half not — and a star too wide for a point (the sun, on most devices) comes back from
that draw as a "leftover" for `drawLeftovers` in `utils/universeRenderer.ts` to paint on the 2D `stars` layer
at the very same numbers, exported from `universeStarsGL.ts` rather than copied: `CORE_IRIS_RADII`,
`CORE_IRIS_ALPHA`, `KIND_DIM`, `discAlphaOf`. Both paths also gate a file's glow on the identical expression —
`node.r * GLOW_MULT[kind] * z` against `GLOW_MIN_PX` — so a star near that threshold cannot fall on one side
of the gate in one layer and the other side in the other. The panel's `renderer` control lives in the Look
group beside the tweaks that change what the sky looks like, though it is the one entry there that instead
changes only what the sky costs to draw (`UniverseTweaksPanel.tsx`'s `WORDS.renderer`).

**The loop has four answers** (`utils/universeLoop.ts:3-8`): 60 fps while the estate is alive, a slow tick once
nothing has happened for 20 s, nothing at all while the tab is hidden, and a single frame for a visitor who
asked for less motion (`:108,132-139,158-168`). All four answer *when* a frame is owed and none of them what
that frame repaints: the fast path is held for the live layer, whose comets, flares and labels move every
frame, and the star layer keeps to a cadence of its own ([the frame's cost](#what-a-frame-costs) below). The
window measures IDLENESS, not presence, so a page left open overnight ticks rather than burning a core on a sky
nobody is watching. `mode()` answers which of the four
the frame now drawing was scheduled on, not the one queued next (`:71-74,114-119,171-174`) — the field
`utils/universePerf.ts` publishes alongside `stepMs` and `drawMs` on `window.__universePerf` every frame, and
what `node scripts/universe-fps-probe.mjs <app-url> <token>` reads to print one line of cost per camera state.

**The chrome reads the map and that 1 Hz snapshot.** The strip holds six readings — repos, stars, lines, edges,
when it was built, and the events-per-second rate — and no control, because a chip there would be the second
control that drifts (`UniverseStatsStrip.tsx:6-18,96-101`). The feed shows the newest 50 rows, newest first; one
row is one AGGREGATE, so `×12` beside a path is twelve raw events in one frame and not twelve rows
(`UniverseActivityFeed.tsx:9-25`). The selection panel describes one node read top to bottom — where, what, how
big, how alive, what it touches — and only from what the map carries (`UniverseSelectionPanel.tsx:9-27`). The
panel's four fetch states are a spinner, an empty state, an amber banner leaving the sky as it was, and the map
itself (`UniversePanel.tsx:39-43,97-128`).

**The chat reducer returns early on these frames**
(`src/modules/chat/hooks/useChatRealtimeHandlers.ts:181-195`). Four kinds — `runner_state`, `soul_launch_state`,
`universe_map` and `universe_activity` — carry no `sessionId`. The early return is a naming, not the fence: what
actually keeps a frame out of the open transcript is that the append below admits a row only when it carries a
run's numeric `seq` (`:253`), and no box-wide lane frame ever does. For this pair the second kind is still worth
naming: it arrives up to ten times a second for as long as anything in the estate is busy.

**The Tweaks dialog** (`UniverseTweaksPanel.tsx:9-27`) is the ONE control surface — a gear beside Recenter,
opening a dialog with exactly one control per tunable, so no tunable has a second control anywhere to drift. A
number's range comes from `TWEAK_RANGES`, the table the parser clamps against, so a control and its clamp cannot
disagree; what the panel owns is each tweak's word, its sentence and its group — Motion, Look, Decoration, Data
(`utils/universeTweaks.ts:87-98`). The defaults live at `utils/universeTweaks.ts:70-77` — `doppler`, `wobble`,
`lensing`, `transits` and `depthOfField` among them — and every write is `parseTweaks`-validated, because
localStorage is a text file a person can hand-edit (`:126-149`). What persists is the DIFF from those defaults,
in `localStorage['universe.tweaks.v1']` and never on the server — a sky left alone stores an empty object, the
key removed rather than filled (`hooks/useUniverseTweaks.ts:11-27,39-63`, `utils/universeTweaks.ts:21,155-161`).
Those decorative passes were never deleted: each defaults to zero, and a zero or `false` skips its pass WHOLE,
so the default frame pays for none of them (`utils/universeTweaks.ts:15-17,70-77`,
`utils/universeLayout.ts:14-19`, `utils/universeRenderer.ts:53-57,130-131,166,171`).

**Each galaxy sits in a nebula of its own colour** (`utils/universeNebula.ts`), the first thing the star layer
draws inside the world transform, so it is under every edge, glow and star. The haze is the repo's own SHAPE,
not a disc: every repo, the sun, and every folder under them down to depth 3 — never an endpoint — lays one
soft, lobed puff over the room it holds
(`reach`, centred on the room's live centre carried onto the body's drawn position), so colour thickens where
folders crowd and thins where the repo does. The hue is the repo's palette slot, inherited down the tree —
`NEBULA_PALETTE` in `utils/universeTokens.ts`, the seven repo pastels slot for slot with the chroma put back,
because a pastel at a few percent of alpha is grey. The sun wears the slot after the last repo's, by design:
it is a repo like any other. Seven slots cycle, so an eighth repo shares a hue with the first. Two rules carry it. It is NEVER additive: every puff is
`source-over` at a low alpha, so overlapping haze converges on the hue and cannot sum to white — the flat
additive wash the clouds once tried turned the fitted view 70% white, and the nebula's measured share of
near-white pixels is the SAME with it on as with it off. And the parallax is two depths, not a second
camera: each body is stamped twice, a wide faint puff on a far sheet whose points are pulled toward the
view's centre (`FAR_DEPTH`) and a tighter one in the galaxy's own plane, so the two part as the camera pans.
Nothing is baked per galaxy — the bodies orbit, and a haze painted once would drift off its stars — only the
puff sprites are cached, by colour and variant. `nebula` is the tweak (0–1, default 0.7); zero skips the pass
whole.

## What a frame costs

**The sky never cooled, and the cause was a tug-of-war rather than a missing decay.** `stepLayout` ran the
whole-graph relaxation on every frame for the life of a page, and by frame 600 it still cost ~30 ms a frame
over the merged map's 10,100 nodes — nearly all of it recomputing the answer it already had. The
temperature's floor is held while the graph is still moving, and "still moving" is the relaxation's own step:
with the orbit off the sky cools, the peak step falling under `SETTLED_SPEED` by frame 300, and a frame drops
from 32 ms to 5.5 ms. At the default orbit it never does — the springs in `relax` chase their rest lengths
while the kinematic orbit moves every node every frame, the two fight, and the floor is held for ever
(`utils/universeForces.ts`'s header is the measured account, and says why the cure is a cadence rather than a
lower floor). The line everything below is measured against, verbatim from
`state/universe/proof/perf-baseline.txt`:

```text
fit=8.4/26.8/30.5/61.4 package=5.5/30.0/131.8/20.7 folder=2.2/27.2/13.0/419.2 folder+dof=1.6/28.9/15.8/587.5 renderer=canvas painted=2652
```

Its fields are `fps/stepMs/drawMs/otherMs` per camera state, `other` being the frame's time outside the two
passes the instrument times (`frameMs − stepMs − drawMs`): at fit the baseline was paying 26.8 ms of layout a
frame it did not need, and at folder 419.2 ms the instrument attributes to neither pass.

**The simulation is bounded by its cadence.** At the floor `relax` runs one frame in `RELAX_EVERY`, and every
frame while the sky is hot — settling, a drag, a gravity change; while the sky is coarse the call is skipped
whole, never handed a zero that would read to `advanceTemperature` as a settled sky and end the relaxation for
good. `applyGravity` returns the moment the tweak already matches `graph.gv`, so a page that never touches the
gravity control walks the links once, at birth (`utils/universeForces.ts`,
`utils/universeGraph.ts:234,288-297`).

**Every subtree is given the room it needs, and the sources stand outside the repos.** The export placed
children on a ring that shrank by 0.55 per depth whatever hung beneath them, and on the merged map sibling
subtrees drew their clouds through each other: measured after settling, 84% of the stars had a star from
another folder as their nearest neighbour. `utils/universeBirth.ts` now measures every node's `reach` from
the leaves up — a body's files pack an inner disc by area, its child bodies the annulus outside it, and the
room is the disc enclosing all of that, whose centre need not be the body (with the body pinned at the
centre a chain of single-child folders doubled per level and put cloudcli's room at 8,100 units; the enclosing
disc puts it at 2,400 at the first packing, 1,505 at the tighter one shipped). Each child is born at the
distance its tree spring rests at, the repos ring the sun by their rooms (largest first, at the top), the
endpoints ring the repos at the bearing of the repo that named them. An integration folder (`system`) is a
body like any other but drawn at 1.8× its size in the warn ink, given 1.35× its room, and
packed AFTER its plain siblings — and a folder that holds integrations (`extractors/`) is packed after ITS
siblings — so the estate's reach into its platforms takes the outer belt of the repo, an area of its own
(`universeBirth.ts`, `SYSTEM_R`, `SYSTEM_BELT`, `SYSTEM_ROOM`); its name fades in from zoom 0.22, absent at the fitted view and whole before a plain directory's, and the names are placed largest first with any that would print over one already placed left off (`universeRenderer.ts`, `SYSTEM_LABEL_FROM`). A cross link moves only its star end, so five
hundred capped links cannot tow a database off its ring, and an endpoint is drawn at a radius that grows with
the log of the stars reaching it (`universeGraph.ts`, `SOURCE_R_BASE`). The sky's radius is the outermost ring
and its margin (9,200 units on the merged map, against 1,670), so
`MIN_ZOOM` is 0.01 and `fitZoom` no longer carries the export's `0.85 / scale` cap, which framed the sun's
neighbourhood alone. Two forces keep it that way: a cross link's pull is capped (`CROSS_CAP`), so an import
is a lean and not a tow out of the folder, and sibling subtrees repel by their reach (`SIBLING_K`), a lean that keeps
the birth placement honest rather than a guarantee. The packing was tightened once at the operator's word (2026-09-17, "too spread out"): measured after 600
settled frames at 16 ms steps, 2,079 stars whose nearest star has a different parent (from 8,145; the looser
packing gave 1,240) and 7 pairs closer than the sum of their radii (from 256); the layout bench 0.4 ms at fit
and 3-4 ms at folder zoom 1.8. The
settled speed floor under the default orbit rises with the sky's size (2.6 at 1,670 units to 3.5-4.0 at 9,200) — the ellipse
breathing against the spring rests, bounded by the relax cadence as before (`universeForces.ts` header).

**Distance is a tweak, applied as one rigid scale.** The `distance` slider (0.3-1.5, default 1) multiplies every
resting and drawn position, spring rest, held ring, room measure and cloud extent about the sun in one call
(`applyDistance`, `universeGraph.ts`), so the sky closes in on Claude at any zoom — including the fitted view,
where the relaxation never runs — with nothing left to fight, and the canvas rebakes the clouds for the new
`fr`. Every link's rest scales, the cross links' included; the repulsion cell and a star's drawn radius do not,
so closer means a little more crowded, and at 0.3 the dense folders merge into knots — the deliberate
"star size is not distance". The number input commits on Enter or blur, so a change is one snap and the camera
eases to the new fit. Operator's word, 2026-09-17.

**Only code is drawn by default.** The `files` tweak (`code`) keeps every star but the `source` kind — config,
docs, data, assets, 27% of the map — out of the active list, the hit test, the clouds' bake, the edges and the
flares (`hiddenKind`, `universeTweaks.ts`; `graph.codeOnly`, written by the regimes). The map is unchanged: the
stats strip still counts them, and switching the tweak to `all` draws them on the next frame and rebakes the
clouds. Operator's word, 2026-09-17.

**The viewport has one home, and the camera is an argument.** `utils/universeView.ts` owns the `Viewport`
type, `SCREEN_PAD` and `viewportBounds`; `stepLayout(graph, now, tweaks, view)` and
`updateRegimes(graph, view)` take it, so a caller that forgets it is refused by the typechecker where a
zero-initialised graph field would have drawn nothing, silently. From that viewport `utils/universeRegimes.ts`
answers the frame's two questions: `coarse`, under which every star is sub-pixel and the files leave both the
simulation and the drawing, and `act`, the list every display pass walks. A star off `act` is off *this
frame's* display and not out of the model — the relaxation is whole-graph by physics, so an unwatched star
keeps moving, and the frame its parent is marked again it is drawn where the physics put it.

**A pass that redraws at sixty makes everything under it redraw too.** That is why the sky is five canvases
and not one — React renders the five elements in JSX, and no file under `utils/` creates one — and why each
layer got a cadence: `utils/universeRepaint.ts` decides what a frame owes, the sky on a movement or every
fourth frame, the star layer on a movement, an intro, a dirty mark or a focus fade and otherwise by regime,
and the live layer every frame, because the comets, the flares and the labels are what move. With the camera
still, a settled sky repaints its star layer every second or third frame instead of sixty times a second, and
the picture is the same one.

**What a star looks like has one home.** `utils/universeStarGeometry.ts` holds the glow, the core, the flare's
halo and the doppler swing as pure functions — no `ctx`, no frame — so the 2D passes and the layer below read
the same shape and cannot drift; the flare itself is drawn once, on the live layer, because a flare is a thing
that moves (`utils/universeStarlight.ts`'s `drawFlares`).

**The stars themselves go to the GPU when the page has one.** `utils/universeStarsGL.ts` packs the small
lights into one interleaved buffer, uploads it once and reads it with two draws, the glow additive and the
core not; a star whose point would exceed the device's own `ALIASED_POINT_SIZE_RANGE` — the sun on most
devices, a galaxy's glow — comes back as a leftover the 2D star layer paints, at numbers both paths read from
`utils/universeStarGeometry.ts`. The owner decides the path once a frame
(`tweaks.renderer === 'webgl' ? starsGL : null`) and hands the renderer a layer or nothing, so no draw pass
reads the tweak; the same decision is what `perfSample.renderer` reports, which is why a probe's
`renderer=webgl` is a fact about the page it ran on and not about the panel's setting. The control is one
`Select` beside the other Look tweaks, defaulting to `webgl` (`utils/universeTweaks.ts:76,97`).

**Before and after**, one line per run, quoted from the proof file beside it:

| Run | The line |
| --- | --- |
| Phase 1, baseline — `perf-baseline.txt` | `fit=8.4/26.8/30.5/61.4 package=5.5/30.0/131.8/20.7 folder=2.2/27.2/13.0/419.2 folder+dof=1.6/28.9/15.8/587.5 renderer=canvas painted=2652` |
| Phase 3, regimes and the cadence — `perf-phase3.txt` | `fit=28.9/0.4/4.2/30.0 package=5.4/8.8/156.5/18.8 folder=1.7/6.0/12.4/574.9 folder+dof=1.7/6.7/14.1/564.1 renderer=canvas painted=2244` |
| Phase 4, the layer stack — `perf-phase4.txt` | `fit=49.4/0.4/6.7/13.1 package=15.5/6.9/49.5/8.1 folder=3.3/5.7/7.6/292.6 folder+dof=3.4/6.5/9.6/276.0 renderer=canvas painted=2105` |
| Phase 5, the GPU star layer — `perf-final.txt` | `fit=48.6/0.7/6.9/13.0 package=16.5/8.8/6.9/44.8 folder=3.2/6.9/6.0/301.7 folder+dof=3.2/6.9/8.3/300.6 renderer=webgl painted=1450` |

**Re-measure it in one line**, with the app up on its dev port and a token from the same origin:

```bash
T=$(node scripts/universe-token.mjs); node scripts/universe-fps-probe.mjs http://127.0.0.1:5183 "$T" --out /tmp/perf.txt
```

## What is not a source here

- **Hook executions.** Transcripts do not record hook runs and nothing in this lane reads one — the tap's
  admitted set is `universe-transcript.tap.ts:26`, and the lane's only hook-derived input is the freshness state
  the `attention` lane reads (`scripts/universe/edges/attention_lane.py:47`).
- **`pg_stat_user_tables` counters.** Table names come from `CREATE TABLE` in the repos' own `.sql` stars
  (`scripts/universe/resolve.py:47-60,158-167`), never from a live counter: the pooler refused the credential,
  and nothing may depend on it.
- **`inotify`, or any per-file watcher on a repo.** Ruled out — commit time is when human edits land, which is
  why the map is triggered by a HEAD read (`universe-heads.service.ts:6-20`) and the transcript tail WALKS its
  corpus rather than calling `fs.watch` (`universe-transcript-tail.ts:36-39`).
- **The live apps' `/openapi.json`.** The route table comes from importing the app in a bounded subprocess,
  because the assembled paths exist only inside its `APIRouter(prefix=…)` constructors
  (`scripts/universe/routedump.py:1-12`).
- **An SSE transport per app.** Every unit's requests already arrive as journal lines
  (`universe-journal.tap.ts:35`), so a second transport would double-count them.
- **`Read` and `Bash` tool calls.** Dropped by the transcript tap on purpose: thousands a day, and neither is an
  edit (`universe-transcript.tap.ts:12-16`).

## If you change this, check that

| If you touch | Also check |
| --- | --- |
| The registry's entry shape | The crawler's docstring, the server's tolerant reader (`universe-registry.service.ts:7-20`) and the seed all agree, and nothing has grown a path into `/opt/web-app` or `/opt/backend-repo` |
| The edge caps | The four constants are still named in `edges/`, and co-change is still capped on the SHARED pair set |
| `ADMITTED_TOOLS` | `Read` and `Bash` are still out, and a new tool is added in that one array rather than in the resolver |
| `reconcile`, the coalescer, `TWEAK_RANGES` | The comparison is still against the held map's heads; a quiet estate still sends nothing and the cap still counts the rows it drops; every key of `UniverseTweaks` is still in the range table, and a zero still skips its pass whole |
| The GPU glow/disc gate in `universeStarsGL.ts`, or `CORE_IRIS_RADII`/`CORE_IRIS_ALPHA`/`KIND_DIM`/`discAlphaOf` | The gate still reads the same expression `drawGlow` uses (`node.r * GLOW_MULT[kind] * z` against `GLOW_MIN_PX`), and those four stay exported from `universeStarsGL.ts` and read — not copied — by `drawLeftovers` in `universeRenderer.ts`, so a star too wide for a GPU point draws at the same numbers as one that fit |
| `useChatRealtimeHandlers`'s early return | The four kinds still RETURN and do not break — a `break` would run the switch's per-kind UI side effects meant for provider frames, though the `seq` stamp gate (`:253`) would still keep the row itself out of the transcript |

