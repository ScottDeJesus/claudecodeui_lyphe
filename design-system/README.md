# Astrolabe, the design system

This folder is the design language LypheCLI is drawn in, kept here so it can be read beside the code. It is reference only: nothing in it is imported, built, linted or shipped with the app.

- **Start with** [astrolabe/README.md](astrolabe/README.md), the brand book: the three principles (Multipurpose, Minimalistic, Futuristic and living), the places, working with the companion, voice and copy, colour, type, space, motion, states, materials, iconography and accessibility.
- **Tokens** are in [astrolabe/tokens.json](astrolabe/tokens.json): every colour (Night and Day), type style, space, size, radius and motion value, each with a line on what it is for.
- **Components** each have a folder under [astrolabe/components](astrolabe/components) with a `README.md` (what it is, what to give it, when not to use it) and a `preview.html` (a worked example of its use). The index is below.
- **The code** of all of them is [astrolabe/components/bundle.js](astrolabe/components/bundle.js) and [bundle.css](astrolabe/components/bundle.css), with their props typed in [index.d.ts](astrolabe/components/index.d.ts).
- **Icons** as files are in [astrolabe/assets/Icons](astrolabe/assets/Icons).

## Where it comes from

It is a copy of the Astrolabe design system on claude.ai, taken on 18 November 2026 (last changed there on 17 November 2026: "New marks: menu, settings."). The live one is at https://claude.ai/artifact/GdrU5MLGGe9CEW1eyW5Sxj and is the one to look at when you want to see the components drawn and moving. If the two disagree, the live one is newer; copy it here again.

The `preview.html` files are examples to read, not pages to open: each expects React 18, the tokens and the bundle to be loaded for it, which the design system's own gallery does.

## How the app uses it

The app does not load the bundle. It carries Astrolabe's values under its own names in `src/shared/ui/verve/tokens.css`, and its own kit in `src/shared/ui` is built to these rules. Where the two differ, check which is newer before changing either: things asked for in the app are not always carried back here.

## Components

### Objects

- [ArcGauge](astrolabe/components/ArcGauge/README.md): One value on a 240° ring, springing to each new reading, with its number in the middle.
- [AtWork](astrolabe/components/AtWork/README.md) (a whole page): The instrument docked beside your work, on a loop.
- [Core](astrolabe/components/Core/README.md): The companion's body: a raymarched ferrofluid that takes a different physical form for each thing it is doing.
- [Home](astrolabe/components/Home/README.md) (a whole page): The home screen.
- [Orbit](astrolabe/components/Orbit/README.md): What is waiting, as beads on the core's orbit: each arrives on the lobe and leaves on the settle, and the orbit drifts while anything waits.
- [Rail](astrolabe/components/Rail/README.md): A long run as a spine of marks, one for each turn: where you are in it, what is in it, and the way to any part of it.
- [Rings](astrolabe/components/Rings/README.md): Sets of things you turn through, as rings around the core.
- [SignalLoop](astrolabe/components/SignalLoop/README.md): The loop in small: an agent at work, wherever work is listed — a chat's row, a status line, a helper's entry.
- [Spinner](astrolabe/components/Spinner/README.md): Something on its way — a read, a load, a turn being prepared: the instrument's thinking loop with its words.
- [Track](astrolabe/components/Track/README.md): One thing's course as a line you read along: its steps, how far it has got and what it is doing, in one object.

### Places

- [Arrival](astrolabe/components/Arrival/README.md): How anything that was not on screen comes onto it and leaves it: mounted when it becomes true, settled away when it stops.
- [Key](astrolabe/components/Key/README.md): A keycap: the key that reaches something.
- [Opening](astrolabe/components/Opening/README.md): What a deliberate click opened, hung from the mark it came out of.
- [Scene](astrolabe/components/Scene/README.md): The screen as an instrument and your work.
- [Sheet](astrolabe/components/Sheet/README.md): A summoned panel over a dimmed ground: history, settings, anything that is not on screen until you call it up.
- [Summon](astrolabe/components/Summon/README.md): The one call away: drawn out of the core, a line you say or type, and results that arrive as you go.

### Companion

- [Choice](astrolabe/components/Choice/README.md): A question, asked from the thing that needs the answer.
- [Exchange](astrolabe/components/Exchange/README.md): One turn between you and the companion: your words, whole, then its answer as it arrives, under its Footprint.
- [Footprint](astrolabe/components/Footprint/README.md): The companion's sign on anything it did — the core in miniature, a chrome bead in its orbit — so its work is always seen and never mistaken for yours.
- [Form](astrolabe/components/Form/README.md): What a tool needs from you before it can go on: fields, then Submit or Decline.
- [Prepared](astrolabe/components/Prepared/README.md): What the companion readied, drawn out of the core and held for your word.
- [Prose](astrolabe/components/Prose/README.md): What the session wrote, read as markdown and set to be read.
- [Questions](astrolabe/components/Questions/README.md): Several questions asked at once, answered one at a time.
- [Reticle](astrolabe/components/Reticle/README.md): The companion's attention: corners that sweep in and close on whatever it is reading or about to touch, so you always see where it is.
- [Status](astrolabe/components/Status/README.md): The instrument's state as a dot and a tracked word.
- [Stream](astrolabe/components/Stream/README.md): The companion's words as they arrive: each word lands faint and thin and settles to full, while a small working loop rides at the end.
- [ToolRow](astrolabe/components/ToolRow/README.md): One thing the session did, folded to a line: its mark, its name, what it acted on, and how it came out.
- [YourWords](astrolabe/components/YourWords/README.md): Your exact line, quoted — the anchor of anything that moved on your word.

### Controls

- [Button](astrolabe/components/Button/README.md): The dock's action button: one primary per view (Speak), quiet everywhere else.
- [Composer](astrolabe/components/Composer/README.md): The line you talk or type through, and the sign of what became of what you sent.
- [Dock](astrolabe/components/Dock/README.md): The row of controls at the foot of the instrument: centred, wrapping, `space-8` apart, at most `size-dock` wide.
- [Fader](astrolabe/components/Fader/README.md): A value on a ticked hairline.
- [FileButton](astrolabe/components/FileButton/README.md): Picks a local file from a button-shaped label; the real file input stays reachable by keyboard and screen readers.
- [Files](astrolabe/components/Files/README.md): What rides with a line: each file a chip with its name, its size, and a thumbnail if it is a picture.
- [Icon](astrolabe/components/Icon/README.md): The instrument's marks: two filled glyphs (play, stop), the stroke icons a control wears (mic, plus, back, send, close, trash, pin, chat, speaker, speaker-off, ear, ear-off, panel, lines, menu, settings), the select chevron, and the marks a ToolRow wears for what a session used.
- [SegmentedControl](astrolabe/components/SegmentedControl/README.md): Picks one of a few named modes in place.
- [Select](astrolabe/components/Select/README.md): A compact chooser for long lists (voices), labelled in the telemetry column.
- [Switch](astrolabe/components/Switch/README.md): A square knob in a square track: on is `accent` on `accent-tint`, and the knob springs across on `ease-lock`.
- [TextField](astrolabe/components/TextField/README.md): The single line you give the voice.
- [ToggleButton](astrolabe/components/ToggleButton/README.md): A two-state control that stays down while its mode is on — in the instrument, Listen.

### Openings

- [Badge](astrolabe/components/Badge/README.md): One or two words of status in one of five tones, always with its glyph so it survives greyscale.
- [BufferGauge](astrolabe/components/BufferGauge/README.md): How much is queued ahead of the voice, as a row of 24 cells.
- [Excerpt](astrolabe/components/Excerpt/README.md): The lines the companion is reading, with its read head moving down the gutter: what is behind it is read, what is ahead is faint.
- [KeyValueList](astrolabe/components/KeyValueList/README.md): Label/value rows on the telemetry grid: a `size-label` (78px) label column, values in the rest.
- [Meter](astrolabe/components/Meter/README.md): One measure, small: a ring with its figure inside.
- [Readout](astrolabe/components/Readout/README.md): The one large live number in a panel — f0 in hertz — whose weight follows voicing.
- [ReadoutRow](astrolabe/components/ReadoutRow/README.md): Inline label/value pairs for the secondary numbers under a panel.
- [Roster](astrolabe/components/Roster/README.md): The agents at work right now, each with its loop, what it is doing and for how long.
- [Steps](astrolabe/components/Steps/README.md): A plan being worked through: done steps settle with a check, the live one works, the rest wait faint.
- [Trace](astrolabe/components/Trace/README.md): What happened, newest first: the history that stays one call away instead of on screen.

### Voice

- [Notice](astrolabe/components/Notice/README.md): A one-line system notice in `accent` mono, centred above the transcript.
- [Plate](astrolabe/components/Plate/README.md): A label on a ground plate — the instrument's way of naming what it points at.
- [Rule](astrolabe/components/Rule/README.md): A heading with its hairline, drawn out of the words when it arrives.
- [Transcript](astrolabe/components/Transcript/README.md): The spoken line, where weight is loudness and opacity is time.

`Cover` has a preview only: it is the design system's title card.
