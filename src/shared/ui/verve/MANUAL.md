<!-- docstore export; edit rows with docstore write, never this file -->

## MAN-745 — verve

The Verve theme layer: tokens.css as the app's one source of colour, type, spacing and motion — light in :root, dark under .dark — with single declaration and derived values keeping it one source, and a held ceiling on the hard-coded colours left to clear.

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/verve/

## MAN-738 — The Verve theme layer
section: README/000

`tokens.css` is this app's one source of colour, type, spacing and motion. What the UI paints
comes from a custom property declared there — light in `:root`, dark under `.dark` — so a
colour change is one line in one file and both modes move together. Where the tokens came from,
and the four deliberate edits made to them, is in that file's own header.

A few hard-coded colours still survive in screens the theme layer has not reached, mostly in
Settings. They are counted, not ignored: the harness holds their number as a ceiling, so a new
one fails the run. Clearing an old one as you pass is welcome; the count only goes down.

This note says how the Verve design language is wired into this repo.

## MAN-739 — The rules that keep it one source
section: README/001 The rules that keep it one source

1. **Import order is load-bearing.** `src/main.tsx` imports `tokens.css` *before* `index.css`,
   because `@tailwind base` and every utility mapped onto a token have to resolve against
   properties that already exist. Swapping the two lines is not a style preference.

2. **Never declare a colour token twice.** `--accent`, `--canvas`, `--ink`, `--border` and
   their siblings are declared in `tokens.css` and nowhere else. `index.css` may *derive* — its
   `--nav-*` values are `color-mix()` over a Verve token — but a second declaration is a second
   palette, and two palettes drift inside a single phase.

3. **Colour reaches a screen through Tailwind, never as a literal.** `tailwind.config.js`
   maps every colour name (`bg-primary`, `text-muted-foreground`, `border-border`, …) to
   `color-mix(in srgb, var(--token) calc(<alpha-value> * 100%), transparent)`. The `color-mix`
   is what carries the alpha modifier (`bg-primary/10`) through a custom property — a bare
   `var(--accent)` cannot. So a screen spells Tailwind names: not hex, not `var(--…)`. A library
   component spells neither — its colour is a `.vv-*` rule, per the section below. Adding a
   *name* is not adding a colour: `ink-faint`, `warn-ink` and `accent-ink` joined the map — the
   first two for the task board, the third for accent TEXT — each one `color-mix` over a token
   `tokens.css` already declared. `accent-ink` is the readable half of a pair, because `primary`
   is the accent FILL: a green WORD is `text-accent-ink`, a green SHAPE is `text-primary`, and
   the wrong way round is how the sidebar's most important label went under AA. `accent-soft` and
   `accent-soft-hover` joined for the soft green ground a lit control stands on (`text-accent-ink`
   on `bg-accent-soft`, the views rail's lit glyph), each `color-mix` over `--accent-soft` or
   `--accent-soft-hover`; bare `accent` is the shadcn legacy over `--surface2`, so the soft ground
   needed names of its own. `tone-soft`,
   `tone-ink` and `tone-dot` joined as names over the tone swap's own properties, not over a palette
   token: each is `color-mix` over `--tone-soft`, `--tone-ink` or `--tone-dot`, which the
   `[data-tone]` rules of rule 4 hand to everything inside a container. `bg-tone-dot` is the dot of
   whichever of the five tones the nearest `data-tone` chose, and resolves to nothing with none above
   it. `--tone-glyph` has no name: it holds a string, not a colour. A name whose
   `var()` points at no existing token is rule 2's second palette in a Tailwind spelling.

   A module carries its own stylesheet only where a selector must reach markup no className can: a
   scope class's descendants, `:has()`, `::marker`. It still spells Tailwind names through `@apply`,
   the transcript's named `md-body`, `md-meta`, `md-code` and `md-stat` sizes included, and there are
   two today, side by side under `src/modules/chat/transcript/`: `markdownCards.css`
   ([docs/architecture/MANUAL.md (08-rendered-shapes)](../../../../docs/architecture/MANUAL.md) §"Element cards")
   and `shapes/shapeMotion.css` (its §"Header, type and motion").

4. **Tone is a token swap, not a rule.** Put `data-tone="neutral|info|positive|warn|danger"`
   (the `Tone` type in `src/shared/types.ts`) on a container and the five `[data-tone]` rules
   hand `--tone-soft`, `--tone-ink`, `--tone-dot` and `--tone-glyph` to everything inside it by
   inheritance. No component writes a tone rule of its own, and the set never grows — two
   spellings for one state is what the swap exists to prevent. `warn` covers errors; red is
   kept for destructive or denied. `Badge` is the first consumer: its `tone` prop lands as
   `data-tone` on the badge, and `.vv-badge` reads `--tone-soft` / `--tone-ink` from there.

   The marker vocabulary is not only tone. `data-vv-enter` on a container is the ENTRANCE marker — a
   container carrying it plays its entrance — and the library reads it in one place: `tokens.css`'s
   `[data-vv-enter] .vv-meter__fill` runs `@keyframes vv-meter-grow`, a `from` frame only, because a
   meter's end state is its inline `transform: scaleX(p)` and a `to` frame with a fill would pin
   every bar at full width. That rule sits inside a `prefers-reduced-motion: no-preference` query, so
   a reader who asked for less motion gets a still meter. The chat sets the marker, on the frames it
   draws and only on a card the reader has not watched arrive
   ([docs/architecture/MANUAL.md (08-rendered-shapes)](../../../../docs/architecture/MANUAL.md) §"Header, type and
   motion"); a bare `.vv-meter` under no such marker never animates.

5. **Colour animates only across a theme flip.** `body.vv-anim` sets a transition with
   `!important` on every element. `ThemeContext.toggleDarkMode` adds it for 500 ms around the
   switch and takes it back off; left on, it smears every hover, menu and scroll in the app.
   Nothing else adds that class, and no always-on colour transition comes back.

6. **The terminal reads the palette; it never keeps one.** `src/modules/shell/utils/terminalTheme.ts`
   builds xterm's theme from the tokens live on `<html>`, and `useTerminalGround` re-reads them
   after every flip because xterm holds a *copy* of what it was handed; a ground hard-coded there
   is rule 2's second palette. The light ANSI sixteen follow that ground — eight read the token for
   a role Verve names (`--danger-ink`, `--pos-ink`, `--warn-ink`, `--info-ink`, the ink ladder),
   and only the eight Verve has no word for are literals, quarantined in one `INVENTED_LIGHT_ANSI`
   block. The dark sixteen stay as they are, in `useShellTerminal`'s `TERMINAL_OPTIONS`. Which
   measurement forced each choice is in that file's own header — doctrine §7's method, applied.

7. **A library piece's text size is a custom-property swap too, the same shape as rule 4's tone.**
   `.vv-badge`, `.vv-chip`, `.vv-meter__label`, `.vv-banner` and `.vv-tabs__tab` (both its filled and
   underline registers) spell their `font-size` as `var(--vv-text-meta, <literal>)` or, for `Banner`,
   `var(--vv-text-body, <literal>)`, in `controls.css`/`feedback.css`. Neither property is declared
   here: a rendered shape's frame is the one thing that sets them, on `[data-text-scale="flow"]` in
   `tokens.css`, so a library piece a shape composes inherits the reader's chat text size and the
   same piece built bare — outside any frame — falls back to the literal it always had. The frame
   side of the swap, and the five named sizes it stands beside, is
   [docs/architecture/MANUAL.md (08-rendered-shapes)](../../../../docs/architecture/MANUAL.md) §"Header, type and motion".

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/main.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/shell/utils/terminalTheme.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/types.ts, /home/lyphe/.claude/claudecodeui_lyphe/tailwind.config.js

## MAN-740 — The library those tokens paint
section: README/002 The library those tokens paint

37 components carry Verve paint (a file in `src/shared/ui/` that puts a `.vv-*` class in its markup; a comment naming one does not count, and `Toast` with `ToastStack`, `Gallery` with `PhotoFill`, `RegionImage` with `RegionDrawLayer`, `SphereView` with `sphere/SphereCanvas` count once). The sheet that paints each (rule 6):

| sheet | components |
|---|---|
| `controls.css` | Button, Badge, Input, Card, Shimmer, Chip, Switch, Avatar, Meter, Spinner, Field, Select, Stepper |
| `feedback.css` | Banner, Toast, Tabs, EmptyState, Menu, Dialog, Tooltip, ActionMenu |
| `surfaces.css` | DockableFab, SplitPane, ResizeGrip |
| `panels.css` | TextArea, Sheet, Timeline, Steps, Checkbox, DialogFrame |
| `media.css` | RegionImage, SphereView, Gallery |
| `spots.css` | RegionImage's spots (`.vv-region-spot`), opened beside `media.css` when it stood at 280 lines |
| `data.css` | SegmentedControl, DataTable |
| `board.css` | KanbanLane, KanbanCard |

- `Sheet` (a panel on the right edge over a scrim), `Timeline` (an event feed, dense or full; props and open-row rules: MAN-7847) and `Steps` (Verve's navigation stepper) joined for the Cerberus tab: `CheckSheet`, Fleet's "What happened" and History's feed, the Enroll dialog. `TextArea` joined for the roadmap's goal field; the Mute dialog's reason takes it too.
- `Steps`, not `Stepper`: `Stepper` is the house's numeric minus/plus control and has its own consumers, and Verve's bundle gives its navigation component the same name. `Steps` shows where a flow stands: numbered rounds, a ✓ once done, an accent rail between; a step is not pressable.
- `TextArea` wears `Input`'s `.vv-input` paint (`controls.css`) and adds only its geometry in `panels.css`.
- `Checkbox` is Verve's `forms/Checkbox`, in the library because Verve draws it; its first consumer is the Cerberus Update wardens dialog. A real `<input type="checkbox">` hidden with `sr-only`, its box and ✓ painted from the input's own `:checked`, `:disabled` and `:focus-visible` by sibling selectors, so the state has one home. The focus ring is `Input`'s (2px `--accent`, 2px offset) moved onto the box; the rule that silences the hidden input's own ring has three class-level parts because `src/index.css` pins `input[type="checkbox"]:focus` at (0,2,1). Its `className` is size and flow on the `<label>`, the press target, never paint: the dialog's rows pass `py-3`, so a whole row is one 44 px target.
- `DialogFrame` is Verve's `overlays/Modal` on the house `Dialog`, in the library because Verve draws it (MAN-571): its props, behaviour and paint are MAN-7963.
- `DockableFab`, `SplitPane` and `ResizeGrip` were admitted on the barrel's *mechanism* test, not its two-module rule (`index.ts`'s own header). `ResizeGrip`'s one consumer is `ChatHostPanel`.
- `RegionImage` and `Gallery` joined for the Cerberus Tours tab; props, drawing and paint: MAN-8579. `RegionImage` is admitted on the *mechanism* test (`index.ts`'s own header): an SVG layer in the image's own 0..1 space, a polygon hit-test and a badge clamped inside the image are what no arrangement of the parts here produces. `Gallery` is admitted because Verve draws it (§10 Media, MAN-571), with or without a second module. Both put a photo in a box through `PhotoFill`, which the barrel does not export. `RegionImage`'s `spots` (where a camera stood, a round press laid on the picture) joined for the Tours view's day-one sketch; props MAN-8945, paint MAN-8947.

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/Checkbox.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/DialogFrame.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/Gallery.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/PhotoFill.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/RegionImage.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/Sheet.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/sphere/SphereCanvas.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/SphereView.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/Steps.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/TextArea.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/Timeline.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/verve/media.css, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/verve/panels.css

## MAN-9016 — The library those tokens paint — `SphereView` joined for the Tours view's pano screen, on the *mechanism* test (`index.ts`'s own
section: README/002 The library those tokens paint/001 `SphereView` joined for the Tours view's pano screen, on the *mechanism* test (`index.ts`'s own

- `SphereView` joined for the Tours view's pano screen, on the *mechanism* test (`index.ts`'s own header): a WebGL sphere with a frame loop, its drag and zoom, and outlines laid on it by yaw and pitch are what no arrangement of the parts here produces. One consumer, `PanoSphere.tsx`; its next is the roadmap's photo work, where in a tour's pano a CompanyCam photo was taken. Its four types are in `src/shared/types.ts`: `CubeFaces`, `SphereShape`, `SphereLook`, `SphereTrouble`. It knows a cube, outlines and tones; the engine's faces, areas and looks stay in the module. Its viewer and three.js load in a chunk of their own, so the barrel names the piece and never `sphere/SphereCanvas`. Its paint in `media.css`: `.vv-sphere` (the `--surface2` ground, a `.vv-skeleton` while its faces load), `.vv-sphere .psv-overlay*` (house type), `.vv-sphere .vv-region-badge` (its press on the sphere); the full table: MAN-8943. Rules and proof: MAN-8944. It does not use `PhotoFill`.
- `SegmentedControl` and `DataTable` joined for the affected-areas module's marking screens, because Verve draws them (§11 Plumbing and §5, MAN-571), with or without a second module; props, behaviour and paint: MAN-8580. `RegionImage` also gained `drawing` (a box dragged on the photo) and `focusId` (one region at full wash, the rest dimmed): MAN-8579.
- `ConfirmDialog` was admitted on the two-module rule and paints nothing of its own: it is `Dialog` and `Button`, both already painted. It is not in the table.
- `Tabs` is one file and one strip: a `role="tablist"` of WORD tabs (`TabItem`: `id`, `label`, and optionally `count`, `attention`, `tone`), in the `segmented` (default) or `underline` register, with `equal` shares and a required `ariaLabel`. A count above zero draws the `.vv-tabs__count` pill in the tab's register: `attention` makes it warn and enters the tab's title (`<label> (<count>) · <attention>`), else `tone`, else neutral. It draws no glyph tab and no overflow menu. Callers: MAN-9013 (the Inbox's sections), MAN-7654 (the Roadmap faces), git-panel, file-manager, api-tab, cerberus, affected-areas, document-preview and the chat's tabbed code.
- `Menu` is `{ trigger, items, onSelect, width? }`: a choice list hung from the left edge of the trigger the caller draws, an item `{ id, label, description?, selected? }`. No count, no trigger label, no alignment prop. Callers: affected-areas' `MarkPresses` and `FacePhoto`. Its viewport and dismissal rules: INV-8867.

What they share is the contract every later one joins:

1. **A component is a flat file in `src/shared/ui/`.** `verve/` holds stylesheets and nothing
   else: no component, no module, no `verve/components/` to grow into.
2. **Paint is a `.vv-*` rule; the component carries layout.** Colour, border, shadow and radius
   live in the piece's own sheet (rule 6) as `.vv-<name>` / `.vv-<name>--<variant>`; the `className`
   spells only size and flow (`inline-flex`, `h-10 px-4`). A colour utility inside a library file is a
   second paint mechanism, and the harness greps every file it has restyled for one. The ban is on
   the library file, not the call site: a caller's own `className` still wins over `.vv-*`, by
   design — except `TextArea`'s colours (rule 6). `panels.css` holds two departures, each named in its
   header: `.vv-textarea` invents no paint, it is `Input`'s `.vv-input`; and `.vv-timeline__dot`
   carries no colour, because `Timeline`'s dot is `data-tone` + `bg-tone-dot`, the tone swap's own dot,
   so a timeline dot and a status mark drawn the same way elsewhere cannot drift.
3. **Marker classes are surface, not decoration.** `vv-button--<variant>`, `vv-badge--<variant>`
   and `data-tone` are what a verify script queries to prove a variant painted; rename one and a
   gate that never reads your source goes quiet. A variant emitting no marker is unprovable.

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/Checkbox.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/DialogFrame.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/Gallery.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/PhotoFill.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/RegionImage.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/Sheet.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/sphere/SphereCanvas.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/SphereView.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/Steps.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/TextArea.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/Timeline.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/verve/media.css, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/verve/panels.css

## MAN-9017 — The library those tokens paint — Import from the barrel, `@/shared/ui`. It side-effect-imports all eight stylesheets (rule
section: README/002 The library those tokens paint/002 Import from the barrel, `@/shared/ui`. It side-effect-imports all eight stylesheets (rule

4. **Import from the barrel, `@/shared/ui`.** It side-effect-imports all eight stylesheets (rule
   6), so the barrel — not the component file — is what puts the paint in the document. A deep
   import by path gets an unpainted component unless something else loaded the barrel first.
5. **Props come from a site you can point at** — the integration plan's §4 table
   (`~/.claude/plans/cloudcli-verve-integration.md`), or a real call. A prop nobody passes is a
   prop nobody proves: `Card`'s `interactive` has no consumer today.
6. **A stylesheet at its ceiling opens a new file; it never wins lines back by squeezing what is
   there.** The barrel imports eight sheets, in this order (lines measured 2026-10-17 unless dated):

   | import | sheet | opened | lines | also holds |
   |---|---|---|---|---|
   | 1 | `controls.css` | 1st | 510 | past its stated ceiling (the headers of `surfaces.css` and `panels.css` say so) |
   | 2 | `feedback.css` | 2nd | 440 | — |
   | 3 | [`surfaces.css`](surfaces.css) | 4th | 402 | the `body.vv-dragging` / `vv-drag-fab` / `vv-drag-split` / `vv-drag-resize` classes a drag of any piece sets for its length (why a new file: that sheet's own header); `[data-hold-lift]` (a hold-lift handle's callout, selection and native drag, off on touch screens from the first touch), and `[data-carried]` (an item in a hand: `--shadow-lift` and a `--border-strong` hairline) |
   | 4 | [`panels.css`](panels.css) | 5th | 341 | `.vv-input`'s colours and ground said back over `src/index.css`'s `!important` pins on every bare `textarea` (the piece's own header says why) |
   | 5 | [`media.css`](media.css) | 6th | 281 (2026-10-26) | a literal-colour exception: the gallery tag's and count's near-black scrim and white ink, which sit on a photograph and must not flip with the theme (the sheet's own header says why) |
   | 6 | [`spots.css`](spots.css) | 8th | 86 (2026-10-26) | `RegionImage`'s spots (`.vv-region-spot`), opened when `media.css` stood at 280 lines and the spot paint would carry it past 300; the second literal-colour exception, the spot's near-black disc in a white ring, which sits on a picture and must not flip with the theme (the sheet's own header says why) |
   | 7 | [`data.css`](data.css) | 7th | 210 | the segmented count pill, spelt again because feedback.css is at its ceiling and takes no more lines |
   | 8 | `board.css` | 3rd | 227 | the `.vv-lane`, `.vv-lane__head` and `.vv-lane-card` rules and their variants |

   `panels.css` is the fifth sheet opened and the fourth imported; `media.css` is the sixth opened and the fifth imported; `spots.css` is the eighth opened and the sixth imported, beside the sheet it extends; `data.css` is the seventh opened and the seventh imported. The order is load-bearing at one end:
   - `board.css` stays LAST. A lane card composes `.vv-card`'s ground and overrides its background,
     shadow and transition, and at equal specificity the LATER rule wins, so imported any earlier
     `board.css` would lose all three to `.vv-card`.
   - `surfaces.css` and `panels.css` share no selector with their neighbours, so they only have to
     land before `board.css`. `panels.css` wins every tie it has by specificity, never by order.
   - A rule in `panels.css` that must beat `index.css`'s pins sits at three class-level parts
     (`.vv-input.vv-textarea.vv-textarea`); a new one needs the same height. A caller's `text-*` class
     loses to a TextArea's colours; only its ground defers to `bg-transparent`.

Which components exist at all, and when a screen composes instead of asking for a new one, is
doctrine §1–§3. Read it there, not here.

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/Checkbox.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/DialogFrame.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/Gallery.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/PhotoFill.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/RegionImage.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/Sheet.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/sphere/SphereCanvas.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/SphereView.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/Steps.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/TextArea.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/Timeline.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/verve/media.css, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/verve/panels.css

## MAN-741 — The overlay half
section: README/003 The overlay half

`feedback.css` is the second paint file and holds to those same six rules: Banner, Toast,
Tabs, EmptyState and Menu new, Dialog, Tooltip and ActionMenu restyled.

- **A toast is advisory.** `useToast()` (from `@/shared/context/ToastContext`, not the barrel)
  raises one; it leaves after 3250 ms and has no dismiss control. It may say what happened,
  never be the only record that it did — an outcome the reader must act on is a `Banner`.
- **The stack is the app's topmost surface, and it takes no pointer.** `z-index: 10001` is one
  above the highest z-index measured in `src/`, because later phases raise toasts from inside
  those modals; `pointer-events: none` because the stack's rect sits over the composer and
  swallowed its clicks. A toast that gains an action takes `auto` back on itself then, not before.
- **The keyboard is the contract.** `Tabs` roves a single tab stop with Arrow/Home/End and falls
  back to the first tab when `active` names none, because `role="tablist"` promises it. `Menu`
  closes on Escape and on an outside pointerdown, returns focus to its trigger, and marks its
  chosen row `aria-current` — its rows are menu items, of which one is current.
- **`Dialog` owns Escape, unless a panel that CLAIMS it is up in front.** The dialog listens on
  `window` capture and stops the key there, so no `document` handler below acts on a keystroke that
  closed a panel. The exception is a panel drawn over it — inside it, or after it in document order
  — that carries `data-owns-escape` (`overlayEscape.ts`): the dialog stands down and marks the key
  rather than stopping it, so that panel's own Escape closes it, and the next press closes the
  dialog. The claim is stated by the panel's producer, not read off a role, because a role is
  shared: cmdk's list carries `role="listbox"` as static content of the dialog it sits in, and a
  role-keyed rule left the command palette unable to be dismissed from the keyboard.

  **Six panels carry the marker in the library and the menus**: `ActionMenu`, `Menu`, `Select`,
  `Sheet`, the file tree's `FileContextMenu` and the composer's `ComposerMenuPrimitives`. The
  Lightbox, the fullscreen frames (`ShapeFrame`, `GutterWidgetFrame`), the application switcher's
  radial, rows and picker, the session picker popover and the check label editor claim it the same
  way. Each is rendered SOLELY while it is open, which is what lets the marker's mere presence in the
  document stand for the fact itself — a panel that stayed mounted closed could not honestly carry it.

  **`Sheet` also asks `modalInFrontHoldsEscape`** (`overlayEscape.ts`), the same question with a modal
  dialog (`[role="dialog"][aria-modal="true"]`) among the candidates. A `Dialog` carries no marker, since
  it is the thing that takes the key, so the marker rule alone leaves a sheet blind to the dialog its own
  button opens in front of it; and as both listen on `window` in the capture phase, where
  `stopPropagation` does not keep the second listener from running, one press would close the dialog
  AND the sheet. A dialog drawn BEHIND the sheet is no candidate (document order): the key is the
  sheet's. `Dialog` asks `overlayInFrontHoldsEscape`, markers only.

  **The failure direction is silent, not broken.** A new overlay that closes itself on Escape but
  forgets `OWNS_ESCAPE` (`overlayEscape.ts`) is invisible to `overlayInFrontHoldsEscape`, so the
  dialog beneath it never stands down: the FIRST Escape closes the dialog — and, being in front of
  it, the forgetful overlay along with it — instead of just the overlay on its own press. That is
  the OLD behaviour the marker exists to replace, not a crash, which is exactly why it shipped
  once: the application switcher's drawer is a `Dialog` and its rows' kebabs are a portalled
  `ActionMenu` in front of it, and before `ActionMenu` carried the marker, one Escape took the
  sheet and the open kebab together.
- **Dialog's motion is a Tailwind keyframe, not `vv-pop`.** `vv-pop` animates `transform`
  outright, which would overwrite the `-translate-*` that centres the panel. The retuned
  `animate-dialog-content-show` is that motion carried onto a centred box.

## MAN-742 — Five open design-language questions
section: README/004 Five open design-language questions

All five are measured facts about Verve's own palette, recorded rather than fixed. Changing any of
them means picking a colour Verve did not, which is the operator's call:

- The accent on the canvas measures **2.81:1** in light, under the 3:1 floor for graphics.
  Verve spends the accent on actions and focus, never on body text.
- `text-destructive` on the canvas measures **3.17:1** in dark, below AA. Verve's `.dark` block
  lightens nearly everything but never redeclares `--danger`, though it does ship
  `--danger-ink` for exactly this ink-on-canvas role.
- An unticked `Checkbox`'s edge, `--border-strong` on `--surface`, measures **1.41:1** in light and
  **1.57:1** in dark, under the 3:1 a control's outline needs (WCAG 1.4.11). It is Verve's own
  `forms/Checkbox` draw, a 1.5px `--border-strong` edge (`_ds_bundle.js` :1570). Its first screen,
  the Cerberus Update wardens dialog, opens with every box it offers ticked, so an empty box there
  is one the operator emptied. The composer's tool-set section (MAN-8490) is the opposite case: most
  of its boxes are empty, so this edge is usually the only sign a row can be ticked. Its box is
  Verve's draw, kept as is.
- The five tone dots (`--*-dot`, declared once in `:root` and never in `.dark`) on a card's
  `--surface` measure, light / dark: neutral 3.34 / 5.14, info **2.86** / 5.99, positive 3.01 /
  5.71, warn **2.21** / 7.77, danger 5.95 / **2.88**. The three in bold are under the 3:1 floor for
  graphics. Measured 2026-10-17 from the token values, and confirmed on painted pixels for warn: the
  Tours view's room list, `#d9a64a` on `#ffffff` at 2.21:1 and on `#1a1b22` at 7.77:1. Each dot of
  the Timeline, of RoomDrying's wet and dry readings and of the room list's affected rooms (all
  `bg-tone-dot`) has its words beside it, so a dot is never the only sign there (MAN-578). It is also
  why a dot cannot be the one mark of a state.
- Verve's caption (`--text-caption`: 12px, uppercase, `.14em` tracking, `--ink-faint`; the house
  eyebrow `text-xs uppercase tracking-[0.14em] text-ink-faint`, written out in 22 `.tsx` files) measures **3.12:1**
  on the canvas and **3.34:1** on a card in light, and 4.74:1 / **4.32:1** in dark. All are under AA's
  4.5:1 for text that size except the dark canvas. Measured 2026-10-17 from the token values and on
  the Tours view's painted page (a caption on the canvas, 3.12:1 light, 4.74:1 dark). A caption names a
  section ("PANOS · 12" adds how many it holds), and no state is said in it alone.

## MAN-743 — What a composed screen looks like
section: README/005 What a composed screen looks like

Settings is the first screen assembled out of that library rather than asking for new components,
so copy it: the nav rail is `Chip` (`selected` + `onClick`), `SettingsToggle` is the library
`Switch` behind one settings-shaped prop name so four tabs share a spelling instead of each
growing its own track and knob, and a connected agent says so with `Badge tone="positive"` — a
tone attribute, not a green. The modal is hand-built and still borrows `vv-dialog__backdrop`,
because the paint classes work without the component that usually carries them. Whether a missing
piece becomes a *new* component is doctrine §1–§3; this is the other answer.

Phase 5 composed three more — sidebar, workspace header, sign-in — and left two rules behind.
**A wash is chosen by measuring it, not by reasoning about it.** The selected project row wanted
the prototype's full `--accent-soft` under its name; that pair reads under AA, so the wash — this
app's half, against the ink Verve owns — moved, and a border carries the "chosen" reading the
thinner fill gave up. **A new string is a translated string**: it arrives through `t()`, and a
counted one carries one plural key per category `Intl.PluralRules` gives its language — four for
`ru`, three for `es`/`fr`/`it`, one for `ja`/`ko`/`zh`, never an `_one` in a one-category file.

## MAN-744 — Where the rest lives
section: README/006 Where the rest lives

- How the numbers above are measured, and the baselines a change must not regress:
  [`docs/MANUAL.md (verification)`](../../../../docs/MANUAL.md)

## MAN-7963 — `DialogFrame` — Verve's `overlays/Modal` on the house `Dialog`: two widths, the accent, the ✕ last in focus order, `busy`

`src/shared/ui/DialogFrame.tsx` is Verve's `overlays/Modal` composed on the house `Dialog` (MAN-741). It is in the library because Verve draws it (MAN-571); a screen composes it and never builds a frame of its own (MAN-575). Consumers: the Cerberus tab's Mute, Enroll, Promote and Update wardens dialogs (MAN-7884).

## Props
| prop | meaning |
|---|---|
| `size` | `md` = 520 px, `lg` = 600 px; never wider than the screen less 2 rem; the panel scrolls as a whole (`max-h-[calc(100dvh-2rem)]`) |
| `title` | the serif heading's first words |
| `accent?` | `{ words }`: italic, in the accent ink. `{ key }`: a raw key, mono, upright, `0.62em`. Omitted: the title stands alone |
| `busy?` | a write is out: the ✕ is `disabled` (dimmed, takes no press); the dialog's own buttons are the caller's |
| `onDismiss` | Escape, the backdrop and the ✕ all call it; the caller decides whether that closes the dialog |
| `children` | the body |
| `...rest` | any `data-*` and any `aria-*` but `aria-labelledby` (the title's id is the frame's own) land on the panel; the Cerberus dialogs pass `data-cerberus-dialog="mute" \| "enroll" \| "promote" \| "update"` |

## Behaviour
- Mounted only while its dialog is open (`<Dialog open>`): it opens clean every time, and the house `Dialog`'s Escape, backdrop, focus trap and first focus hold (MAN-741).
- The ✕ is LAST in panel order though drawn first (absolute, top right). why: first focus lands on the dialog's first field or chip, not on the way out, and Escape still closes from anywhere.
- The ✕ is the round close, `aria-label` `buttons.close`: 32 px at a desk, 44 px below md (Verve's touch minimum).

## Paint — `verve/panels.css`
| class | holds |
|---|---|
| `.vv-dialogframe` | padding `clamp(20px,5vw,30px)` by `var(--vv-dialogframe-gutter)`; the gutter is `clamp(18px,5vw,32px)` |
| `.vv-dialogframe__title` | `var(--font-display)` 28 px (25 px below 640 px); `overflow-wrap: anywhere`, so a long key wraps instead of widening the title under the ✕ |
| `.vv-dialogframe__accent`, `__key` | the italic accent ink; the mono key in the accent ink |
| `.vv-dialogframe__close` | a 32 px circle on `--surface2`; below md 44 px, its top and right offsets 6 px smaller about its own centre so it stays where it was |

- The ✕'s phone-size offsets are computed from the frame's padding and gutter: change them together.
- The panel's width and scroll are layout, spelled in the component; the paint is the `.vv-dialogframe*` rules (MAN-740).

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/DialogFrame.tsx

## MAN-8579 — `PhotoFill`, `RegionImage` and `Gallery` — the Tours view (affected areas) library pieces: a photo with its regions, a set of photo tiles; props, drawing, paint (`verve/media.css`)

`src/shared/ui/RegionImage.tsx`, `Gallery.tsx` and `PhotoFill.tsx` put a photograph on screen: `RegionImage` draws a view's regions over it and `Gallery` lays a tour's panos out as tiles, for the Cerberus Tours view (affected areas). `RegionImage` and `Gallery` are in the library by the barrel's admission tests (MAN-740): `RegionImage` on the *mechanism* test, `Gallery` because Verve draws it (§10 Media, MAN-571). Consumer: the Tours view (MAN-8575); the photo-match viewer is `RegionImage`'s next. Paint: `verve/media.css`, imported by the barrel after `panels.css` and before `board.css` (MAN-740 rule 6); a spot's paint is `verve/spots.css`, imported right after it (MAN-8947). Both are exported from `@/shared/ui`; the types `RegionShape` and `GalleryItem` are in `src/shared/types.ts`. `SphereView` lays the same outlines and badges on a 360° sphere: props, files and paint MAN-8943; rules and proof MAN-8944.

## `SphereView` beside `RegionImage`
| what | holds |
|---|---|
| share | the `.vv-region*` paint, toned by `data-tone`; one outline per region and one number per badge; no words on the photo |
| differ | yaw and pitch in place of the photo's 0..1; the library's markers in place of `RegionImage`'s one `<svg>`; the chosen outline drawn last, because SVG paints in document order |
| with the library | the wheel is gated on Ctrl or ⌘ by the piece itself; the navbar's one button shows only while fullscreen; WebGL 2 is asked before the chunk loads; the WebGL context is lost on unmount; three.js and the viewer load in one chunk of their own, named in `optimizeDeps.include` and in no manual chunk |

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/Gallery.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/PhotoFill.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/RegionDrawLayer.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/RegionImage.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/SphereView.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/verve/media.css

## MAN-8945 — `PhotoFill`, `RegionImage` and `Gallery` — the Tours view (affected areas) — `RegionImage`
section: `PhotoFill`, `RegionImage` and `Gallery` — the Tours view (affected areas) library pieces: a photo with its regions, a set of photo tiles; props, drawing, paint (`verve/media.css`)/001 `RegionImage`

| prop | meaning |
|---|---|
| `src` | the photo; `null` draws the neutral tile, and the regions still draw and select over it |
| `alt` | the photo's name |
| `width`, `height` | the photo's natural size; only the ratio is used, as the box's `aspect-ratio`. A pair that is not positive and finite reads as `1 / 1`. why: every child is absolute, so the ratio is the box's only height |
| `regions` | `RegionShape[]`: `id`, `ordinal`, `polygon` (`[x, y]` points), `box` (`[x0, y0, x1, y1]`), `tone`, `edge` (`solid` \| `dashed`), `wash` (`full` \| `light` \| `none`), `label`; coordinates in 0..1 of the image, drawn as stored |
| `selectedId?` | the chosen region |
| `onSelect?` | called with a region id by its outline or its badge. Omitted: the regions are drawn and inert. Ignored while `drawing` is set |
| `drawing?` | `{ onDrawn(box), onCancel() }` or null. Set: a box can be dragged on the photo (mouse, pen or one finger), drawn live in the image's 0..1 space; `onDrawn([x0, y0, x1, y1])` on release with x0 < x1 and y0 < y1; Escape calls `onCancel`. Site: `FacePhoto`, the pano's Missed one (through `MissedDraw`, MAN-8582). A box is one gesture on a phone, where the operator works; a polygon would be many taps |
| `focusId?` | the focused region: drawn at full wash whatever wash it was given; every other region and badge wears `.vv-region--dim`. An id that names no region here dims nothing. Site: `MarkQueue`, the Mark screen's current area (MAN-8582) |
| `spots?` | `{ id, x, y, label, onPress? }[]`: points laid on the picture, each a round mark centred at `x`, `y` in 0..1 of the image, over the outlines and under the badges, so a spot never covers a number. With `onPress`: a `<button>` named by `label`, one tab stop each, before the badges. Without it, or while `drawing` is set: an inert `aria-hidden` span (the Lightbox's display-only copy). Omitted: none. A spot carries no number and no word on the picture. Site: the Tours view's day-one sketch (`DayOnePlan`), each pano's camera on the plan's drawing, "{room} 360° photo" |
| `badgePlacement?` | `corner` (default): each badge at its box's top-left. `clear`: each badge, in the caller's order, at the cheapest of 24 places, held inside the picture (`regionBadgePlaces.ts`, not exported): its box's four corners, the eight places beside its box touching it at those corners, its four outer corners, and a second ring of eight a badge and a press (6 px) further out. Cheapest is compared in order: covering no badge placed before it and no spot; its middle on no other region's box; touching its own box; its press (`.vv-region-badge::before`, 6 px) clear of the badges before it and the spots; least of it on other regions' boxes; then the earlier place. The places are for the picture's size on screen: the box is measured by a ResizeObserver, only under `clear`, and until its first answer every badge stands at its corner. Site: the day-one sketch, whose numbers crowd wall runs, cabinet runs and small rooms. The fixture probe (`.verify/affected-areas-day-one-scaffold.mjs`) holds every number there at least 80% shown and pressable at its middle at 390 and 1280 px |

Draws, in one `relative w-full` box:
1. `PhotoFill` (`fit="fill"`): the `<img>`, or the neutral tile when `src` is null or the image errors (remembered per `src`).
2. One `<svg viewBox="0 0 1 1" preserveAspectRatio="none">` over the box (`overflow-visible`, `pointer-events-none`). One `<polygon>` per region: `data-tone`, `vector-effect="non-scaling-stroke"`, `aria-hidden`, `aria-label` "{ordinal}. {label}". A polygon with fewer than three finite points draws nothing. Outlines stack by box area, largest first (equal areas keep the caller's order), so a small region inside a large one stays reachable; the stacking never follows the selection.
3. One badge per region at its box's top-left, showing the ordinal. `left` and `top` are the box corner as a percentage clamped to 0–100, then `min(…, calc(100% - var(--vv-region-badge-extent)))`, so a corner region's number is never cut off. With `onSelect`: a `<button>` named "{ordinal}. {label}" with `aria-pressed`, in the caller's order (the tab order). Without: an inert `<span>`.

4. Before the badges in the DOM, so drawn under them (neither takes a z-index): one `.vv-region-spot` per spot. `left` and `top` are the point as a percentage clamped to 0–100, and its paint's `translate(-50%, -50%)` centres the mark there. The badges of item 3 follow, at their box's top-left, or under `clear` where `clearBadgePlaces` stood them.

5. With `drawing`: one `RegionDrawLayer` (`RegionDrawLayer.tsx`, not exported by the barrel) over the whole box, above the outlines and badges. It is the kit's `usePointerDrag` (kind `draw`), so the drag survives what is under the pointer and sets `vv-dragging` for its length; `.vv-region-draw` is `touch-action: none` from the first touch, so one finger draws where it would scroll. The live box is a `<rect>` (`.vv-region.vv-region--drawing`) in the layer's own 0..1 svg. A drag the browser takes away, a press that never moved and a drag with no width or no height report nothing; any other box is reported, however thin, because the floor on its area is the caller's: `MIN_REGION_AREA` (1e-4, the engine's `seat/normalize.MIN_AREA_FRAC`). The release point is held inside the photo and the corners are normalised, so a drag up-left reports the same box as one down-right. Escape calls `onCancel` unless a dialog or a menu in front owns the key (`otherOverlayHoldsEscape`), and it ends the drag in progress: the box vanishes at once and the release reports no `onDrawn`, whether or not the caller then leaves drawing mode.

Rules:
- Words never sit on the photo. why: the number is how a reader finds the region's row in the list beside it.

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/Gallery.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/PhotoFill.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/RegionDrawLayer.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/RegionImage.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/verve/media.css

## MAN-8946 — `PhotoFill`, `RegionImage` and `Gallery` — the Tours view (affected areas) — The badge is the one control for keyboard and screen reader; the outline is the pointer's second way
section: `PhotoFill`, `RegionImage` and `Gallery` — the Tours view (affected areas) library pieces: a photo with its regions, a set of photo tiles; props, drawing, paint (`verve/media.css`)/002 The badge is the one control for keyboard and screen reader; the outline is the pointer's second way

- A region's badge is its one control for keyboard and screen reader (a spot is a pano's own button, MAN-8945); the outline is the pointer's second way in, hidden from the accessibility tree with no tab stop. why: each region would otherwise be spoken twice, the second time by a button no key can reach.
- Region selection is off while `drawing` is set: no outline is pressable and every badge is an inert `<span>`, so a press on the photo can only start a box.
- Only `.vv-region--pressable` (set exactly when `onSelect` is given and nothing is being drawn) takes the pointer, the cursor and the hover. why: a display-only copy inside the `Lightbox` must pan with the picture; give a `Lightbox` copy no `onSelect` (MAN-7426).
- The svg is not clipped. why: an edge is centred on its path, so a clip would halve the weight of a region on the photo's border.
- Tone reaches paint as `data-tone` alone: no `--tone-*` is declared in `media.css` (MAN-739 rule 4).

## `Gallery`
| prop | meaning |
|---|---|
| `items` | `GalleryItem[]`: `id`, `src` (`null` = the neutral tile), `tag`, `badge?` |
| `selectedId?` | the chosen tile: `aria-current="true"`, an accent ring and an accent tag. Shown only on a pressable tile: without `onSelect` the tiles are `<div>`s, carry no `aria-current` and draw no ring. The ring survives hover. No caller passes it today (`RoomGallery` passes `items`, `max`, `label`, `onSelect`, `onOverflowOpen`) |
| `onSelect?` | called with a tile's id. Omitted: the tiles are `<div>`s, not buttons; the overflow tile is a `<button>` either way |
| `max?` | the most tiles drawn, floored and at least 1 (`max 0` draws the overflow tile alone); omitted draws every item |
| `onOverflowOpen?` | called once, from an effect after the commit that shows the whole set (the overflow tile pressed, or a selection the collapse would hide forced it); never for a set that does not collapse, never again once open. It lets a caller that loads each tile's photo load only the drawn ones until then (`useTilePhotos`, MAN-8575) |
| `label` | the `<ul>`'s accessible name |

- Every tile carries its `tag` (bottom-left) and, when given, its `badge` (top-right, on the surface, so it never reads as a second tag). Square tiles in `repeat(auto-fill, minmax(96px, 1fr))`, gap 8 px; the entrance staggers by `min(index, 8) × 50 ms`.
- With `items.length > max` the first `max - 1` draw as tiles and the final slot is the overflow tile: the photo of the first hidden item under a scrim and "+N" (N counts that item). Pressing it opens the whole set in place. A selected item the collapse would hide opens it too. Once open the set stays open (`opened` latch). A caller that shows a different set passes a new `key`.
- The overflow tile's screen-reader text is `media.showMore` ("Show {{remaining}} more").

## `PhotoFill` (not exported by the barrel)
The one broken-image tile for both pieces. Verve's rule: never a blank cell or a broken-image glyph. Props `src`, `alt`, `fit` (`fill` \| `cover`). It draws `.vv-gallery__fallback` with the word `media.photo` ("Photo"); the tile is named (`role="img"`) only when `alt` is non-empty. Words `media.photo` and `media.showMore` live at the root of `en/common.json`; `en` only.

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/Gallery.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/PhotoFill.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/RegionDrawLayer.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/RegionImage.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/verve/media.css

## MAN-8947 — `PhotoFill`, `RegionImage` and `Gallery` — the Tours view (affected areas) — Paint — `verve/media.css` and `verve/spots.css` (2026-10-26)
section: `PhotoFill`, `RegionImage` and `Gallery` — the Tours view (affected areas) library pieces: a photo with its regions, a set of photo tiles; props, drawing, paint (`verve/media.css`)/003 Paint — `verve/media.css` and `verve/spots.css` (2026-10-26)

| class | holds |
|---|---|
| `.vv-region` | the outline: fill 30% of `--tone-dot`, a 2 px edge in it |
| `.vv-region--pressable` | `pointer-events: all`, pointer cursor; under `(hover: hover)` a hover fill of 42% (full wash), 26% (light), 14% (none), 40% (selected) |
| `.vv-region--dashed` | dashes 7 / 5 px (selected: 12 / 6 px) |
| `.vv-region--wash-light` · `.vv-region--wash-none` | fill 13% · transparent |
| `.vv-region--selected` | edge 3.5 px and fill 40%: two channels, so it survives greyscale; follows the washes, so it wins over them |
| `.vv-region--dim` | `opacity: .28`, one rule over whatever the region was given (wash, dashes, hover); on a badge `.5`, so its number stays legible. Set on every region but the focused one |
| `.vv-region-draw` | the drawing layer: crosshair, `touch-action: none`, an inset ring in `--tone-dot` of its own `data-tone="positive"` (the human region's tone) |
| `.vv-region--drawing` | the live box: composes `.vv-region` and adds the 7 / 5 px dashes a hand-drawn region wears; inert |
| `.vv-region-badge` | 22 px square, 1.5 px tone border, `--tone-soft` ground, `--tone-ink` number (11 px, 700), a 6 px invisible margin on the press; `[aria-pressed='true']` adds a two-ring shadow |
| `.vv-region-spot` (`verve/spots.css`) | a spot: a 16 px disc of `rgba(16,17,22,.72)` in a 2 px `#fff` ring with a 1 px dark hairline, centred on its point, under the badges (no z-index; RegionImage draws spots first), scaled by `--lightbox-scale` about its centre; the press widened to 34 px, 44 px under `(pointer: coarse)`; under `(hover: hover)` a solid disc and a soft halo; a `span` is inert. `.vv-region-spot--legend`: the same mark at 12 px in a line of words, in the flow (the day-one sketch's caption says what the spots are with it), on `.vv-region-spot-swatch`, a 3 px patch of the picture's white ground (`#fff`, a faint 1 px inner edge), so the legend mark is the filled dark disc the drawing shows in both themes |
| `.vv-gallery` · `.vv-gallery__tile` | the grid · a tile: 10 px radius, `--surface2` ground, hover lift under `(hover: hover)`, `[aria-current='true']` accent ring |
| `.vv-gallery__tag` · `.vv-gallery__badge` · `.vv-gallery__more` | the tag · the caller's mark · the "+N" over its scrim |
| `.vv-gallery__fallback` | the neutral tile |
| `.vv-sphere*` · `.vv-sphere .psv-*` | `SphereView`'s box and its overrides of the library's DOM: MAN-8943. It wears `.vv-region`, `.vv-region--pressable`, `--dashed`, `--wash-*`, `--selected` and `.vv-region-badge` unchanged, and overrides two (`.vv-region-badge` pointer events, `--selected` pointer events) under `.vv-sphere`: a change to those rules here moves the sphere |

- Inside the `Lightbox` (MAN-7426) the content carries `--lightbox-scale` (a number, 1 at fit; unset elsewhere, so every use falls back to 1). The edge, the dashes and the badge divide by it. why: `non-scaling-stroke` does not hold under an ancestor's CSS transform (measured: 2 px at fit, 4.5 px at 225%).
- The literal-colour exceptions: the tag's scrim `rgba(16,17,22,.5)`, the count's `.55` and the ink `#fff` (`media.css`), and the spot's disc `rgba(16,17,22,.72)` and ring `#fff` (`spots.css`). why: they sit on a picture and must not flip with the theme. The tag measures 19.9:1 over a black photo and 3.55:1 over a white one, under AA's 4.5:1; a darker scrim is the operator's call. Drawn in tokens, a spot's light dark-theme disc vanished into the day-one drawing's white ground; its disc computes 7.6:1 on that white and 7.2:1 on a room's fill, its ring 21:1 on black.

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/Gallery.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/PhotoFill.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/RegionDrawLayer.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/RegionImage.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/verve/media.css, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/verve/spots.css

## MAN-8580 — `SegmentedControl` and `DataTable` — Verve's §11 switch and §5 sortable table: props, behaviour, paint (`verve/data.css`)

`src/shared/ui/SegmentedControl.tsx` and `DataTable.tsx` are in the library because Verve draws them (§11 Plumbing "IconButton · SegmentedControl" and §5 "Data table · sortable"; MAN-571), with or without a second module. Callers (2026-10-17): `SegmentedControl` in the affected-areas module's `ToursSwitch`, `LayerSwitch` and `MarkQueue`; `DataTable` in its `ProvingTable` (the kinds) and `ProvingDetail` (a kind's sweep). No caller passes `count` today: what this row says of it was measured on a fixture, not on a screen. The `site` column names the screen each prop is for. Paint: `verve/data.css`, imported by the barrel after `media.css` and before `board.css` (MAN-740 rule 6). Both are exported from `@/shared/ui`; the type `DataTableColumn<Row>` is in `src/shared/types.ts`. The chat transcript's own `DataTable` (`src/modules/chat/transcript/shapes/DataTable.tsx`) renders react-markdown children with a CSV copy, a different job; it stays where it is.

## `SegmentedControl`
| prop | meaning | site |
|---|---|---|
| `options` | `{ value, label, count? }[]`, drawn in order; `count` is a number beside the word | Tours · Mark · Tables; the pano's layer switch; the Mark screen's queue mode |
| `value` | the chosen option's `value`. A value no option carries leaves nothing chosen and gives the first option the Tab stop | each |
| `onChange` | called with an option's `value` | each |
| `label` | the group's accessible name | each |

- A radio group: `role="radiogroup"` with `aria-label`, each option a `<button role="radio" aria-checked>`. It chooses a value and owns no panel; `Tabs` is the strip that does.
- Alt, Ctrl and Meta with an arrow are the browser's, not the group's, and a group of one option does nothing on any of these keys: it has nowhere to move and `onChange` is never called with the value it already holds.
- Roving tabindex: the chosen option (else the first) is the one Tab stop. ArrowRight and ArrowDown choose the next, ArrowLeft and ArrowUp the previous, both wrapping; Home and End go to the ends. Focus moves with the choice, as a native radio group's does.
- The count is part of the option's name ("Mark 12"), not hidden from a screen reader.
- Hit target: 32 px tall, 44 px under `(pointer: coarse)` (Verve: "32px hit target minimum; 44px on touch screens").
- A departure from Verve, the one `Tabs` already records (feedback.css): the pill does not slide. The chosen option paints its own ground and lifts, so nothing is measured and no box moves.
- A tray squeezed past its content shrinks: each label ellipsises and the count keeps its width. At 480 px and under the option padding is 8 px and the gap 5, not Verve's 15 and 7, because three options with counts need about 400 px at Verve's spacing and a 390 px phone's column is 342 (measured: they fit, none ellipsised).

## `DataTable`
| prop | meaning | site |
|---|---|---|
| `rows`, `columns`, `rowKey`, `label` | the rows, `DataTableColumn<Row>[]`, a row's identity, the table's accessible name | the proving tables |
| `sort?` | `{ column, direction: 'asc' \| 'desc' }`, held by the caller | the proving tables |
| `onSort?` | called with the pressed head's column `key`; omitted, the heads are plain words and draw no sort mark (a head that holds the caller's `sort` still shows ▲ / ▼) | the proving tables |
| `expanded?`, `onExpand?`, `renderExpanded?` | the open row's key (or null), called with a key to open or null to close, and what the open row shows under itself | a proving row's per-kind detail |

`DataTableColumn<Row>`: `key`, `label`, `align?: 'start' | 'end'`, `sortValue?: (row) => number | string | null`, `render: (row) => ReactNode`.

- A column sorts when it has `sortValue`. Its head is a `<button>` (with `onSort`) and carries the arrow: ▲ ascending and ▼ descending on the sorted head (Verve's own), a faint ↕ on one not chosen (Verve draws nothing there; the mark says "this sorts"). The three marks share one 12 px box at one size, so a head's width does not change when the sort moves and the columns do not shuffle under the press. The keyboard ring on a head is drawn inside it (`outline-offset: -2px`), because the frame clips one that stands outside. The sorted head carries `aria-sort` and reads in `--ink`; the others in `--ink-faint`.
- The table sorts, the caller owns which sort: it answers `onSort(column)` (ascending on a new column, flipped on the same one) and passes `sort` back. Numbers sort by size, text by locale with its digits read as numbers (`localeCompare`, `numeric`), a number before text. `null` (and NaN) is last in BOTH directions. Equal keys keep the caller's order, and the caller's array is never touched. A `sort` naming a column with no `sortValue` sorts nothing.
- With `renderExpanded` and `onExpand`, every row is pressable: the whole row is the press (a press that lands on a link, button, input or label inside a cell keeps its own), the row takes a tab stop, answers Enter and Space on the row itself, and carries `aria-expanded`. The open row's panel is a following `<tr>` spanning every column. `expanded` is one key, so one row is open; pressing the open row calls `onExpand(null)`.
- A table wider than its column scrolls sideways inside its frame and never breaks the page. Under `(pointer: coarse)` a sortable head is 44 px tall.
- The first column, the row's name, holds still at the frame's left edge while the table scrolls under it (`position: sticky`), head and cells alike, so a figure scrolled into view keeps the row it belongs to: the proving table shows 885 of about 1,170 px at 1280 wide (every line at its default: a set line's words, "Threshold 100% · set Oct 17", widen the name column) and 356 on a phone, measured 2026-10-17. A departure from Verve's drawing, whose four-column table sits in an `overflow: hidden` frame and never scrolls. The held cell paints a ground of its own (the head's `--canvas`, the cell's `--surface`, the row's `--accent-soft` where the row is hovered or open), and its lines are inset shadows, because a collapsed border stays where the cell was: its right edge (`--border`), the row's hairline under it, and on a row focused from the keyboard the ring's three sides that fall on it (`--accent`), since it stands above the row's own outline. The opened row's panel (`__panel`) is not held.
- While columns lie past the frame's right edge, a shade stands at that edge (`--border-strong` to clear, 24 px), and it is gone once the table is scrolled to its end: two backgrounds on the frame, the shade fixed to it (`scroll`) and a strip of its own `--surface` at the content's far end (`local`) that slides over the shade as the end arrives, and covers it from the start when nothing overflows. No script, the border and radius whole, every figure painted over it; an opaque ground (the head, the held column, a washed or opened row) covers it where it lies. With overlay scrollbars (macOS, iOS, Android, headless Chromium) it is the only sign that the table goes on.

## Paint — `verve/data.css` (210 lines, 2026-10-17)
| class | holds |
|---|---|
| `.vv-segmented` | the tray: `--surface2`, 3 px padding and gap, 10 px radius |
| `.vv-segmented__option` | 32 px tall (44 under `(pointer: coarse)`), 13 px / 500, `--ink-muted`; `[aria-checked='true']` is `--surface` ground, `--ink` and `--shadow-rest`: filled AND lifted, so it survives greyscale |
| `.vv-segmented__label` · `.vv-segmented__count` | the word, ellipsised when squeezed · the count pill on `--tone-soft` and `--tone-ink` through its own `data-tone="neutral"`; the face of `.vv-tabs__count`, spelt again because feedback.css is at its ceiling |
| `.vv-datatable` | the frame: `--border`, 12 px radius, scrolls sideways, its right edge shaded while columns lie past it; positioned, so words a cell places absolutely (a screen reader's `sr-only`) scroll and clip with the frame instead of widening the page |
| `.vv-datatable__head` · `__label` · `__sort` · `__arrow` | the head on `--canvas`: 12 px, upper-case, tracked, 700; padding on the label or button inside, so a head is one press target |
| `.vv-datatable__row` · `__cell` | a `--surface2` hairline under each row; the first cell is the row's name (`--ink`, 500), the others figures (`--ink-muted`, tabular) |
| `.vv-datatable__head:first-child` · `__cell:first-child` | the name column held: `sticky`, `left: 0`, `z-index: 1`, its own ground, its border left clear and its lines drawn as inset shadows (edge, row hairline, a focused row's ring) |
| `.vv-datatable__row--pressable` · `--open` | pointer cursor and an `--accent-soft` hover under `(hover: hover)` · the open row keeps that wash |
| `.vv-datatable__panel` | the open row's panel: `--canvas` ground |

No tone is declared in `data.css` (MAN-739 rule 4).

Contrast, light theme, Verve's own pairs reproduced as drawn (measured off `tokens.css`; the sheet's header says the same): an unsorted sortable head 3.12:1 (`--ink-faint` 12 px bold on `--canvas`), an unchosen segmented label 4.46:1 (`--ink-muted` on the `--surface2` tray), muted figures on the `--accent-soft` hover and open row 4.44:1 — each under AA's 4.5:1 for small text. The dark theme clears all three (4.74, 6.51, 5.32). A darker ink for them is the operator's call.

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/DataTable.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/SegmentedControl.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/verve/data.css

## MAN-8943 — `SphereView` — the Tours view's 360° library piece: props, files and paint (`verve/media.css`)

`src/shared/ui/SphereView.tsx` stitches six square photos of a cube into one sphere you drag and zoom (Photo Sphere Viewer on three.js) and lays areas on it as `RegionImage`'s outlines and numbered badges, by yaw and pitch. Consumer: the affected-areas pano screen (`PanoSphere.tsx`); the module's half (which view is which face, areas as looks): MAN-8942. Admitted on the barrel's *mechanism* test (MAN-740, `index.ts`'s own header). Exported from `@/shared/ui`; the types `CubeFaces`, `SphereShape`, `SphereLook`, `SphereTrouble` are in `src/shared/types.ts`. The piece knows a cube, outlines and tones; faces, standing and what a look means stay with the caller. Shared `.vv-region*` rules: MAN-8579. Rules that bite, proof and limits: MAN-8944.

## Props
| prop | meaning |
|---|---|
| `faces` | `CubeFaces \| null`: six photo URLs (object URLs included). Null: the box is a skeleton of itself. A new object naming the same six URLs is the same panorama; other URLs go through `setPanorama` on the same viewer |
| `regions` | `SphereShape[]`: `id`, `ordinal`, `polygon` and `badgeAt` (`[yawDeg, pitchDeg]`), `tone`, `edge`, `wash`. Larger boxes first: later ones draw over earlier |
| `selectedId?` | the chosen area: heavier outline, ringed badge. One chosen somewhere else turns the view to it (`markers.gotoMarker`, `8rpm`, at once under `prefers-reduced-motion`). One chosen at opening, or one the piece reported pressed, turns nothing |
| `onSelect?` | called with an area's id by its outline or its badge (the badge marker's `~badge` suffix dropped) |
| `look` | where the view opens: `{ yawDeg, pitchDeg, fovDeg }`, yaw growing turning right, pitch up, (0, 0) the front face's centre. A new value turns the view there (`8rpm`, at once under reduced motion); a value within 0.1° of what `onLook` last reported, or opened at, turns nothing |
| `onLook?` | where the view came to rest, 250 ms after a drag, zoom or turn stops (`REST_MS`); yaw folded into (−180, 180]. A report pending at unmount is flushed |
| `fullscreen` · `onFullscreen` | controlled both ways: `fullscreen` true calls the viewer's `enterFullscreen`; the viewer's own `fullscreen` event (its button, Escape) calls `onFullscreen(on)`. A fullscreen the browser refuses calls `onFullscreen(false)`; so does unmounting while fullscreen |
| `label` | the box's accessible name |
| `zoomHint` | the words of the overlay a plain scroll shows ("Hold Ctrl and scroll to zoom") |
| `onTrouble?` | `'no_webgl'` (no WebGL 2) or `'photo_failed'` (a face would not load: the library's `panorama-error`) |

Field of view runs 30°–110° (`MIN_FOV_DEG`, `MAX_FOV_DEG`); the library's zoom level is linear in it, so 90° opens at level 25.

## Files
| file | holds |
|---|---|
| `SphereView.tsx` | the barrel's piece: the box, the WebGL 2 verdict, `ErrorBoundary` + `Suspense` around the lazy canvas, the skeleton, the failure banner |
| `sphere/SphereCanvas.tsx` | the lazy half: ONE viewer per mount, three.js, the viewer and its CSS. Never named by the barrel |
| `sphere/fixedContaining.ts` | `fixedContainingRelease(stage)`: the switch `SphereCanvas` calls for the iPhone's emulated fullscreen (rules: MAN-8944) |
| `sphere/sphereLook.ts` | `toRadians`, `toDegrees`, `zoomLevelOfFov`, `fovOfZoomLevel`, `foldYaw`, `sameLook` |
| `sphere/sphereMarkers.ts` | `markerConfigsOf(shapes, selectedId)`, `regionIdOfMarker(markerId)` |
| `sphere/wheelGate.ts` | `gateWheel(stage, viewer, hint)`, which returns the function that takes it down |

Packages: `@photo-sphere-viewer/core`, `cubemap-adapter`, `markers-plugin`, each `5.15.1`, exact (`package.json`). Words in `en/common.json` `media`: `sphereLeaveFullscreen`, `sphereFailed`, `sphereFailedDetail`; `label` and `zoomHint` are the caller's.

## Paint — `verve/media.css`, the SphereView section
Outline and badge wear `.vv-region*` unchanged, toned by `data-tone` (`svgStyle: { dataTone }`); editing those rules moves the sphere too. Sphere-only rules, tokens only:
| rule | holds, and why |
|---|---|
| `.vv-sphere` | square to the parent's width (`aspect-ratio: 1`), `overflow: hidden`, `--surface2` ground, so a face still loading is never a hole; the waiting surface is `.vv-skeleton` |
| `.vv-sphere__stage` | `absolute inset-0`, `touch-action: none`: the element the library is handed, which puts its root inside and fullscreens the stage |
| `.vv-sphere .vv-region-badge` | `border-box`, `pointer-events: auto`, pointer cursor. why: `span.vv-region-badge` makes every span badge inert (RegionImage's display-only badge) and the library's `.psv-container *` is `content-box`, which grows the 22 px badge by its border |
| `.vv-sphere .vv-region--selected` | `pointer-events: none`. why: the chosen outline is drawn last and would cover a smaller area inside it and take its press; its badge is still pressed |
| `.vv-sphere .psv-navbar` | `height: 48px; bottom: -48px`; `.psv-button` `padding: 14px` (20 px icon, a 44 px press) |
| `.vv-sphere .psv-navbar:not(.psv-navbar--open)` | `visibility: hidden`. why: the library's `navbar.hide()` only slides the bar below the box, so its button kept its tab stop and tree entry; focusing it scrolled the box's overflow 48 px (the photo moved, the bar stood inside the box) and Enter on "Leave fullscreen" entered fullscreen. The slide-out ends invisibly at once. Do not remove as redundant |
| `.vv-sphere .psv-overlay*` | house type and tokens; the overlay has `pointer-events: none`. why: the library skips a wheel whose target is inside an overlay, so a Ctrl-scroll that fell through would zoom the page |

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/shared/types.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/sphere/sphereLook.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/sphere/sphereMarkers.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/SphereView.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/verve/media.css

## MAN-8944 — `SphereView` — rules that bite and its proof: the lazy chunk, one viewer per mount, the wheel gate, fullscreen, `.verify/sphere-view.mjs`

What an editor of `SphereView.tsx`, `sphere/SphereCanvas.tsx` or `sphere/wheelGate.ts` must not break. Props, files, paint: MAN-8943. The module's half: MAN-8942.

## Rules that bite
- The barrel exports `SphereView` and never `SphereCanvas`. why: three.js and the viewer load in one lazy chunk (`SphereCanvas-*.js`, 677 kB, 177 kB gzip, 2026-10-22) the first time a sphere is drawn; `dist/index.html` preloads only `vendor-react`.
- Keep the `import()` of `sphere/SphereCanvas` literal. `vite.config.js` `optimizeDeps.include` names the four packages, but it is NOT what prevents a page reload: on a cold dev server with a private cache the first sphere opens in one document load with them and without (`.verify/sphere-cold-start.mjs`). Vite's start-up scan finds them through the literal `import()`.
- WebGL 2 is asked once per page (`supportsWebGl2`: a scratch `webgl2` canvas, its context given back) before the chunk is fetched. No WebGL 2: nothing fetched or drawn, `onTrouble('no_webgl')`. why: `new Viewer` does not throw without it; it draws its own error and returns a viewer with no renderer (`SphereCanvas` reports `no_webgl` for that case too).
- One viewer per mount. The screen re-renders on every `onLook`, so nothing is keyed on an object's identity: the panorama is its six URLs, the markers are their content (`JSON.stringify` of areas and choice), and a change goes through `setPanorama` / `setMarkers`, never a new viewer. Callbacks and props the viewer's handlers read live in the `latest` ref.
- Each load asks for its photos under URLs of its OWN: the same photo plus `#sphere-<n>` (a fetch ignores the fragment). why: three.js's `FileLoader` shares one in-flight request between every loader asking for the same URL, and the viewer that made it aborts it on `destroy()`; under `React.StrictMode` (viewer, teardown, viewer) the second viewer got an AbortError the library takes for its own and waited for ever with no picture and no error. Possible outside dev too, when a sphere unmounts and another mounts on the same photos.
- Teardown calls `loseContext` on the canvas. why: `viewer.destroy()` leaves the WebGL context to garbage collection and a browser keeps about sixteen; the pano screen makes a sphere per pano and per return from Fleet. 2026-10-22: twenty mounts and unmounts leave no context warning and no viewer context alive; without `loseContext` the same run warns. One context stays alive per page: the library's own capability probe.
- Stacking is the ORDER the markers are added, never `zIndex`. why: the plugin appends every polygon to one `<svg>` in order, and `z-index` on an SVG path lifts nothing. Outlines go in the order given, the chosen one last; badges are html, so the chosen badge's `zIndex` (3, others 2) does lift.
- A badge's html is built from the tone's letters and the ordinal truncated to an integer, never from text. why: the library sets a marker's `html` as `innerHTML`. The hint's overlay title is escaped for the same reason.
- An area with fewer than three vertices, or a non-finite angle in a vertex or `badgeAt`, is left out.
- The wheel is gated by `gateWheel`; the library's `mousewheelCtrlKey` stays off. why: the library reads the Control KEY alone, so ⌘ never zooms on a Mac and a trackpad pinch (a wheel with `ctrlKey`, no key down) shows the hint while the browser zooms the page. A plain wheel is stopped at the stage in the capture phase (`stopPropagation`, never `preventDefault`: the page scrolls on) and shows the hint for 2 s; Ctrl or ⌘ goes on to the library and zooms; a fullscreen wheel zooms. The listener is passive.
- `touchmoveTwoFingers` is off: one finger turns the view, and `.vv-sphere__stage` is `touch-action: none`.
- The navbar is `['fullscreen']` only: the way out, which a phone needs (no Escape). It shows only while fullscreen (`settleNavbar`, on `fullscreen` and again on `ready`: the library opens it itself just before `ready`). Its title is `media.sphereLeaveFullscreen` (`lang.fullscreen`).
- `lang.loadError` is `''`. why: the library's overlay sentence is English only; a failed photo keeps its icon and the caller says the words (`onTrouble`).
- The stage's `requestFullscreen` is wrapped to swallow the rejection. why: the library drops the promise, so a refusal is an unhandled rejection; the `fullscreenerror` listener, on the stage because it does not bubble, tells the caller.
- Two presses on two different areas under 300 ms apart report only the first. why: the library's single-click window (`DBLCLICK_DELAY`) dispatches no click for the second; 5.15.1 has no option to turn it off.
- The iPhone's fullscreen is emulated (`psv-fullscreen-emulation`; iOS has no fullscreen API): the library makes the stage `position: fixed`, and an ancestor that is a containing block for fixed descendants (`container-type`, `transform`, `filter`, `backdrop-filter`, `perspective`, `contain`, `will-change`) makes the stage fill that ancestor and not the phone. Cerberus's panel root carries `container-type: inline-size`. `sphere/fixedContaining.ts` `fixedContainingRelease(stage)(on)`: `SphereCanvas` calls it on the viewer's `fullscreen` event with `stage.classList.contains('psv-fullscreen-emulation')`, and with `false` in teardown; while on, each such ancestor takes the neutral value with `!important` (an animation's fill beats a plain inline style), and off puts every property's inline value and priority back as found. Another fixed overlay in this app uses it, or stands in a chain with no containing block. A page-in wrapper filled `both` is one such ancestor (`SCREEN_ENTER`, MAN-8577).
- The box is `role="img"` named by `label`, and `role="group"` while fullscreen. why: the children of an image are not exposed, and the way-out button inside the box must be found. The caller's list is the keyboard's way to an area.
- A chunk that will not load (a hashed file the server no longer has) or a viewer that throws is held in the box by `ErrorBoundary`: `SphereFailed`, a `warn` `Banner` (`media.sphereFailed`, `media.sphereFailedDetail`) and a reload of the page (`viewBoundary.reload`), never a retry. why: `lazy` and the browser's module map both remember a rejected import.
- A photo that fails gives `photo_failed`; new faces recover on the same viewer.

## Proof — the live :5183 app, nothing stubbed (`.verify/` is gitignored)
| command | does |
|---|---|
| `node .verify/sphere-view.mjs [--only frame\|behaviour\|trouble\|contexts]` | Clarence Tse's kitchen pano (tour `6ad29b4c93d5140395dcaa76`, pano `6ad29b4c12f14e4d72c81901`), its six photos through the lane with the dev token, `cubeFaces` and `sphereShapes` from the module. Exits 1 on any FAIL. Shots: `.verify/shots/sphere-view/`. `frame`: face centres, 12 cube edges, outlines (numbers: MAN-8942). `behaviour`: one viewer per mount, select by badge and outline, turns, wheel gate, fullscreen on desktop and an iPhone emulation. `trouble`: `--disable-3d-apis` gives `no_webgl`, no canvas, no chunk fetched. `contexts`: twenty mounts |
| `node .verify/sphere-cold-start.mjs` | two scratch Vite servers with private caches (never the live :5183 cache), with and without the four packages in `optimizeDeps.include`; prints the documents the page loaded; exits 1 if the `with` run reloaded |

`.verify/lib/sphere-fixture.mjs` opens the app, puts the photos in the page as object URLs and mounts `SphereView` through `mountReact.mjs`; the page side is `window.__sphere` (`mount`, `unmount`, `set`, `viewer`, `events`, `ready`).

2026-10-22: `sphere-view.mjs` 100 of 100 PASS before the `visibility` navbar rule; not re-run since. Viewers survive re-renders unbuilt; a plain scroll shows the hint and neither zooms nor stops the page; Ctrl, ⌘ and a pinch zoom; fullscreen is left by the button on an iPhone emulation. 2026-10-22, `.verify/affected-areas-sphere.mjs` (MAN-8956), iPhone user agent on the Tours view: the emulated fullscreen fills 390×844 at (0,0); its button leaves it.

## Unmeasured, and known limits
- Exact cube-edge angles render wrongly in headless Chromium's software renderer: at the angles where an edge meets the view centre (e.g. (0, −45)) and within about 0.05° of them, the picture collapses to flat colour or a face swims. A box corner sits on the camera plane. A drag, `gotoMarker` or any of the piece's own looks essentially never lands there. A real GPU is not measured. The run photographs the two named edges 0.5° off (`edge-*-exact-*.png` beside them) and lists the affected looks as NOTEs.
- A native Escape in fullscreen: headless Chromium ignores a page-side Escape, so the run calls `document.exitFullscreen()`; the key is not measured.

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/sphere/fixedContaining.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/sphere/SphereCanvas.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/SphereView.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/sphere/wheelGate.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/sphere-fixture.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/sphere-cold-start.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/sphere-view.mjs, /home/lyphe/.claude/claudecodeui_lyphe/vite.config.js

## MAN-9015 — The kit Tooltip — props, the three ways it shows, and showOnFocus for the keyboard

`Tooltip` (`src/shared/ui/Tooltip.tsx`, paint `.vv-tooltip` in `feedback.css`) names a control that draws no words. It wraps one child in a `relative inline-block` div; with no `content` it renders the child bare.

## Props
| prop | default | does |
|---|---|---|
| `content` | none | the bubble's body |
| `position` | `top` | `top`, `bottom`, `left` or `right` of the wrapper, 8px off, with an arrow |
| `delay` | `350` | ms before a hover or a touch hold shows it |
| `className` | `''` | added to the bubble |
| `showOnFocus` | `false` | also show for the keyboard (below) |

## How it shows
| trigger | shows | hides |
|---|---|---|
| pointer hover | after `delay` | pointer leaves |
| touch hold | after `delay`, when the finger stays down | lift, unless the hold already showed it; the next `pointerdown` outside the wrapper |
| `showOnFocus`: a focus inside the wrapper that matches `:focus-visible` | at once, no delay | blur; Escape |
- A pointer press focuses the control too, so a focus that does not match `:focus-visible` shows nothing: hover has already given the name.
- Escape hides the bubble without moving focus (WCAG 1.4.13). The key is not stopped: an Escape that also closes a drawer or a dialog still reaches it.
- Default off. why: most callers wrap inputs, whose focus is a reader getting to work, not asking a name.
- The bubble is a `position: fixed` portal into the host window's body (`z-index` 9999), re-placed on resize and scroll, so it follows the floating chat window.
- The wrapper is a div. A div between `role="tablist"` and `role="tab"` breaks the relationship a screen reader announces the strip by, so `Tabs` titles its tabs natively instead.

## Sites that set `showOnFocus`
All with `position="right"`: `RailButton` (every view button of the views rail), `AccountRailButton` and the dock's own button (`AppSwitcherDock`). The accessible name of each is its `aria-label`; the tooltip repeats it and no native `title` stands beside it (MAN-9006).

## Proof
2026-10-25: Tab onto the rail's Chat button shows "Chat" 21–33ms after the key (`node .verify/rail-live.mjs`, MAN-9005).

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/Tooltip.tsx
