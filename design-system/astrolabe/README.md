Astrolabe is the design language for working alongside a companion that sees everything you can see and does everything you can do. Because the companion holds the whole picture, the screen doesn't have to. It holds a few living objects in place of many panels. Each one tells you several things at once, stays whisper-quiet until it is needed or you click it, and moves like a physical thing. It is the visualizer's own behaviour, applied to everything: a still core that comes alive only when there is something to say. Night is its native light; Day is the same instrument on a porcelain bench.

## Principles

Three principles decide every screen and every component, and the first outranks the other two. They are what make an Astrolabe screen feel like a different application, not the same one in a new theme. Where anything further down this page disagrees with them, they win.

1. **Multipurpose.** Top priority. Every visual object encodes several layers of important detail at once and keeps them current: a single object can be the navigation, the progress tracker and the status gauge together. Never spawn a separate panel for each metric.
2. **Minimalistic.** Zero walls of text by default, and the lowest possible visual noise. Everything on screen is either needed right now or whisper-quiet until you deliberately click it to inspect it.
3. **Futuristic, experimental and living.** Unconventional, game-inspired physical mechanics. The whole interface feels alive and kinetic, never a static dashboard of boxes.

### Multipurpose

- **One object, several readings.** Before you draw an object, list what it tells you: where it takes you, how far along it is, what state it is in. If the list has one item, the object is not finished.
- **Add a layer, not a panel.** Something new to show goes onto the object it belongs to, in its shape, its fill, its motion or its position. Draw a new object only when nothing on screen can carry it.
- **Every layer is live.** An object changes as its detail changes, and that change is how you learn of it.

### Minimalistic

- **No walls of text by default.** A paragraph, a list, a log or a table is on screen only when it is the thing you are working on, or after you open it.
- **Two volumes, nothing between.** Everything on screen is either needed right now or whisper-quiet. A quiet object is a hairline in its signal colour, and quiet text is `ink-muted` or `ink-faint`; `accent` is spent only on what is needed now.
- **Inspect on a deliberate click.** A quiet object opens when you click it, and what opens is its detail: the words, the list, the history. It closes when you are done.

### Futuristic, experimental and living

- **Mechanics before looks.** Decide what an object does when you press it and when its signal changes before you decide how it looks. It has weight, it answers your touch, and it moves on the two springs, `ease-lock` and `ease-lobe`. Borrow from games and instruments, not from dashboards: a lock-on, an orbit, a gauge that fills, a part that docks.
- **Alive, not busy.** An object sits still until there is something to say or you touch it, then it moves like a physical thing. It never moves just to get attention.
- **Never a dashboard of boxes.** No screen is a grid of cards or panels. Reach for the unconventional object before the stock widget.
- **The core's shape is its state.** Idle, listening, speaking, thinking, reading and writing are six physical forms of one body, and reading and writing point at the thing they act on. Never add a label, a spinner or a badge beside the core to say what it is doing.
- **Alive, alien, recognizable.** Show the machinery, not a mask: no faces, eyes or avatars. Familiar instruments — a dial, a waveform, a gauge, a transcript — that move only with real signal.

## Quiet until it's true

The second principle, over time.

- **At rest, everything whispers.** When nothing is happening, the screen is your work, the core, and the few objects that carry everything else, each at its quietest. Build this state first.
- **Loud only while it is true.** A chat asks, a run finishes, the companion speaks, you start a sentence: that is when the object it belongs to comes up to full strength, and it goes quiet again when that stops being true. Never raise what might happen, what used to be, or what is empty.
- **Empty means absent.** No empty states, no zero counts, no idle panels, no "nothing here yet". If a place has nothing in it, the place is not drawn.
- **Controls arrive with what they act on.** Stop exists while the voice speaks; Queue exists while something waits to be queued. A control for something that isn't happening is noise.
- **Detail is one click away, and anything absent is one call away.** Click an object and its detail opens. For what has no object on screen, say it, type it, or press the core: the companion brings it.

## How things change

An object that is already on screen does not arrive. It changes.

1. **It comes up, and goes quiet.** When something becomes true of a thing, the object that stands for it comes up to full strength where it is: a span lights, dashes crawl, a mark turns `accent`. When that stops being true it goes back to a hairline. Nothing is added to the screen to announce it.
2. **A click opens it.** Detail unfolds from the mark you clicked, on `ease-lock` over `duration-lock`, joined to the mark by a hairline, and folds back into it when you are done. One Opening at a time. It never opens itself.
3. **What has no object arrives.** The few things with no object of their own — a control for what just started, the companion's words, an action it prepared — come in an Arrival from the place that caused them, on `ease-lock`; what the companion draws out of itself arrives on `ease-lobe` over `duration-lobe`. While true they move only with their signal. When they stop being true they hold still for `duration-linger` if they resolved on their own, then leave on `ease-settle` over `duration-settle`, shrinking back the way they came. Something you dismissed settles at once.

Under reduced motion every opening, arrival and departure is a fade over `duration-fade`; signals still drive weight and size.

## The places

There are no panels and no side columns. A screen has four places, and everything is in one of them.

| Place | What is there |
|---|---|
| **The instrument** | The companion's core with its rings: everything you have, as objects. With no work on screen it is home and has the center. With work it docks at the foot. |
| **Your work** | What you are working on: a chat, a document. It has everything above the foot, and nothing lands on it. |
| **The opening** | What a click opened, hung from the mark it came out of. |
| **The foot** | The docked instrument at the start; controls for what is present in the middle; above them, the companion's line and the one action it holds for your word. |

On the things themselves, in the margin: the companion's Reticle and its Footprint.

- **One instrument, three sizes.** Home: in the center, up to `size-instrument-home`. Docked: at the foot, `size-instrument-rest`, still live. Leaned in: `size-instrument-near`, on a disc of `ground` over the corner of your work, when you reach for it with the pointer, with focus or with a touch. It moves between them on the lock spring and goes back when you leave it.
- **The instrument changing size never moves your work.** Your work keeps its place and its width at every size of the instrument.
- **What happens elsewhere shows on its object.** A run that finishes closes its span. A chat that asks turns its mark `accent`. Nothing arrives as a card at an edge, and nothing is counted in a badge.
- **What needs you is the loudest thing, and still only a mark.** In order of strength: what is waiting on you (`accent`, a gate held open), what is working (dashes, a bead), what is done (a quiet lit span), and everything else (a hairline).
- **On a narrow screen** the places are the same: the docked instrument stays at the foot and leans in to the width of the screen, and an Opening is a sheet at the foot.

## Working with the companion

The app is one space with two presences in it. Make each half of that visible.

- **It tells you; the object shows you.** When something needs you the companion says so in one line beside the core, and the mark for that thing turns `accent`. The line settles; the mark stays until you have dealt with it.
- **Its attention is the Reticle.** Whatever the companion is reading or about to touch gets corners that sweep in and close, with a plate that says what it is doing: "Reading · Bugfixes". One reticle per agent, and it moves the moment the attention moves. Helpers it starts take the `secondary` tone.
- **Its footprint is on everything it did.** A Footprint — the core in miniature — sits on every message it sent, answer it gave, action it prepared and memory it kept, with one word: Answered, Sent, Prepared, Kept. Never replace it with a name, an initial or an avatar, and never put it on your words.
- **It prepares; your word locks it.** Anything that changes the work comes out of the core as a Prepared action, held above the foot's controls, and moves only on your word — spoken, typed or pressed. It is not a card: no panel, no frame, no shadow. The line under it is the time it has left, running down over `duration-hold`; its target is a way to the thing it will act on. Once locked the line closes and it shows your exact line. Unanswered, it dissolves.
- **Your words are a material.** Wherever your exact words are the reason something happened — an action locked, a ruling kept, a correction — set them as YourWords in `said`. Never paraphrase them, never summarize them, and never set anything generated in `said`.
- **A mark that says it needs no word.** Stop, Send, File, Listen and Back are buttons of their mark alone; the word is their title and their name for assistive tech. Anything a mark cannot say keeps its word. The way out is always the back arrow, never an Esc key cap: Esc is a key, and it still works.
- **A button looks like a button.** Anything you press to act is a Button, with its edge: full size in the foot, `small` on a line of a list. Words alone are never pressable. The only things you press that are not Buttons are objects (a ring, a slot, a row that opens, a mark on a rail), links to a file or a page (underlined), and the line that folds what is under it (it carries its chevron).
- **It acts in the open.** Everything it does happens where you can see it, in place, at a pace you can follow. Nothing changes behind a curtain and reports afterward.
- **What it did is a line; what it wrote is prose.** In a chat, each thing a session did (a thought, a file read, an edit, a run) is a ToolRow: its mark, its name and what it acted on, folded. Nothing it wrote to a file or got back from a command is on screen until you open the row. While a turn runs, each row is its own line and the one it is on carries its Reticle; when the turn ends its work folds to one row. A row says how it came out only when that is not ordinary, in the same words a session's state has everywhere: Working, Needs you, Failed. What it says to you is Prose, and it arrives as a stream while the core speaks.

## The families

Every component belongs to one of these.

- **Objects** — the living things a screen is made of, each one a way in, a measure and a sign at once: Rings (sets of things you turn through), Track (one thing's course), Rail (a long run as a spine of marks, one a turn), Core (the companion), SignalLoop and Spinner (an agent at work, small). ArcGauge (one measure) and Orbit (a count without a number) are for the places with no instrument: where there are Rings, the measure is the `gauge` hairline round the core, what waits is the marks that turned `accent`, and who is helping is the beads riding a working span.
- **Places** — where things are and how they come and go: Scene (the instrument, your work, the foot), Opening (what a click opened), Arrival (how the few things with no object come and go), Sheet (a large opening you called up), Summon (the one call away) and Key (the key that reaches it).
- **Openings** — words and lists, which live only in what a click opened: Trace, Steps, Roster, Excerpt, KeyValueList, ReadoutRow, Readout, BufferGauge, Meter (one measure, as a small ring) and Badge. A measure shown large is the ArcGauge dial, never a bar.
- **The companion** — the other presence: Reticle (its attention), Footprint (its mark), YourWords (your exact words), Prepared (an action held for your word), Stream and Exchange (what it says, as it arrives), Choice (a question, with its likely pick), Status (its state in a word), ToolRow (one thing a session did, folded to a line) and Prose (what a session wrote, read as markdown).
- **Voice** — the words that are on screen: Transcript (the spoken line), Notice (what went wrong, and the remedy), Plate (a label that names what something points at) and Rule (a heading with its hairline).
- **Controls** — Button, ToggleButton, FileButton, SegmentedControl, TextField, Select, Switch, Fader, Composer, Dock and Icon: machined, squared, and on the springs. They arrive with what they act on. Buttons, fields, selects and switches say one thing and stay plain. The three you handle carry more: a SegmentedControl's plate can be dragged and dropped, a Fader's marks are its scale and its presets, and a Composer's lower edge is the status of what you last sent.

## Voice and copy

- **No gender, anywhere.** Call the companion by its name or "the companion"; never "he" or "she". Address the person as "you"; never "he", "she" or "the user".
- The companion speaks in the first person ("I sent the brief to Bugfixes"). The interface never does: it says what is true and addresses you.
- A plate names what faces you in the fewest words: the ring's label and a number or a state in caps, then the thing's name: `RUNS · 14 / 26` over `restorly-scheduling`. An Opening's source is a label: "Chat · PM flow", "Run · nightly-4". Its lines say what is true now, in sentence case: "Finished: 212 checks, all green." No "successfully", no exclamation marks.
- Labels are nouns in uppercase mono: STATE, SOURCE, TTFB, LOOKAHEAD, CLAUSE. Buttons are one verb: SPEAK, STOP, QUEUE, DISMISS. Pickers are nouns: AUDIO FILE, VOICE.
- State words are fixed: Idle, Thinking, Speaking, Bridging, Listening, Playing. Lock words: Acquired, Slewing, Standby. Plates on a reticle say what the companion is doing: "Reading · Bugfixes", "Holding for your word", "Locked · on your word".
- Units follow the number after a space: `312 ms`, `148.25 Hz`, `−12.3 dBFS`, `0.84 s ahead`. Signed numbers carry an explicit plus or a true minus (`+0.412`, `−0.187`), never a hyphen. An em dash (—) means no value. A middle dot (·) joins qualifiers: `TTS · Samantha`, `YOU · SPOKEN · 09:31`.
- Instructions and hints are sentence case. Notices give the cause, an em dash, then the remedy: "Microphone blocked — allow it in the address bar." No emoji, no apologies.

## Colour

- Two themes with identical roles: `night` (the fallback) and `day`. Set `data-theme` on `<html>`, or on any subtree, and every token follows.
- Everything sits on `ground`. Instrument controls sit on `surface`, a translucent plate, so a live canvas reads through them; selects use `surface-solid`; the one primary button uses `surface-raised`. Openings sit on `panel`; a Prepared action sits on a plate of `ground` at `opacity-plate`, with no panel of its own; hover rows and muted fills on `panel-raised`, and `line` separates regions.
- Text: `ink` for values, typed text and your words; `ink-strong` only for the word being spoken and the big readout; `ink-quiet` for unselected options and neutral status words; `ink-muted` for labels, captions, sources, hints and the footprint's orbit; `ink-faint` as the quietest that still reads. Each holds 4.5:1 on `ground`, `surface`, `surface-solid` and `panel` in both themes and in every material.
- `accent` is the only live colour and it means "this is happening now": the focus ring, an active control, a mark that is waiting on you, the reticle and its plate, meter fills, the active status dot, notices. Never decoration, never a resting state.
- `signal-a`, `signal-b`, `signal-loop` and `signal-halo` are for canvas graphics and the secondary reticle, never text. `chrome-highlight` → `chrome-rim` is the five-stop ramp of the Mercury material: the only gradient in the system, on the Core and on the Footprint's bead, which is the core in miniature.
- Status tones (`info`, `positive`, `warn`, `danger`, each with `-dot`, `-soft`, `-ink`) are states, never decoration. Warn is gold so it is never read as the live amber; danger is for destructive or denied only.
- Materials: put the class `ast-persona-mercury`, `ast-persona-tube`, `ast-persona-wire` or `ast-persona-plasma` on a subtree to re-point `ground`, `accent`, `accent-tint`, `focus` and the signal colours together.
- An app that already speaks a stock utility palette keeps its class names and retunes the palette: every stock shade becomes the colour with the same relative luminance, the hue of the tone it stands for, and no more chroma than that tone; greys become the instrument's steel, their darkest shades the Night ground. New work uses the tokens.

## Type

- Two faces, both variable 100–900, from Google Fonts: `https://fonts.googleapis.com/css2?family=Geist:wght@100..900&family=Geist+Mono:wght@100..900&display=swap`. Geist (`--font-sans`) is what is said — the voice, your words, what you type. Geist Mono (`--font-mono`) is everything the instrument reports.
- Apply the type-style classes; never restate their sizes. An Opening's source and a panel's label are `caption-caps`; an Opening's title and lines are `field-text`; your words are `said`; state words `status-word`; button labels `control-label`; plates `canvas-plate`; panel text `telemetry`.
- The one big number is `readout`. The spoken line is `transcript`. What a session wrote is `reading`: one size for a whole reply, with its headings, code and tables sized from it. A number among a few is `figure`. The words on a folded row are `row-text`.
- Weight is a live channel. The transcript's live word runs 300–780 with loudness, spoken words keep 300 + 460·mean^0.8, unspoken words sit at 250, and your words keep a steady 380. The readout runs 200–520 with voicing. Nowhere else does weight move, and nothing else is bold, except inside Prose: there bold and italic are the writer's own marks, a heading is one step of weight, and nothing is coloured to stand out.
- Uppercase belongs to mono and is always tracked. Sans is never set in capitals, and never italic outside Prose.

## Space and layout

- The measurements are the instrument's own and unsnapped, `space-1` to `space-40`. Use 1–6 inside readouts, 8–18 inside and between controls, and 24–40 to place things in the viewport.
- Every screen is a Scene: the instrument, your work, the foot. Build home first, then the docked state, then what each mark opens.
- When the companion itself is the subject — a voice-first view — the instrument stays at home in the center, above the transcript. The transcript sits `space-40` above the foot.
- Every control is `size-control` tall. The instrument is `size-instrument-rest`, `size-instrument-near` or up to `size-instrument-home`. An Opening is `size-opening` wide. The foot's controls never exceed `size-dock`.

## Shape and line

- Corners are `radius-control` on every control, group, badge, chip and count; `radius-none` on meters and cells; `radius-round` only for dots, discs and avatars. On the instrument nothing is in between. In an application, openings, menus and toasts take `radius-panel`, and dialogs and sheets `radius-sheet`. A pill is never right.
- Structure is drawn in hairlines (`stroke-hairline`). The reticle's corners are `stroke-reticle`. Only the loop thickens, and only with the voice.
- Nothing at rest casts a shadow. Only what floats over your work does: `shadow-float` for an Opening, the leaned-in instrument, menus and popovers; `shadow-modal` for dialogs over a scrim. Each carries its own hairline, so it reads on either ground. Around the instrument itself: no shadows, no cards, no fills behind panels.

## Motion

- Nothing moves without a reason: a signal, an arrival or a departure. Canvases draw every frame and pause offscreen; numbers update every `duration-tick`.
- The two springs are the whole vocabulary. The lock — ω = 2π·2.2 rad/s, ζ = 0.62, a small overshoot, then it holds — is attention and arrival (`ease-lock`). The lobe — ω = 2π·2.3 rad/s, ζ = 0.36, it swells and wobbles like liquid — is the core and whatever the companion draws out of itself (`ease-lobe`). Departures use `ease-settle`. Nothing uses any other curve; a glide is plain friction between your hand and the catch.
- A ring is a physical thing. Held, the mark under your finger stays under it. Let go and it glides for `duration-glide`; then the nearest mark catches it on the lock spring. A mark you tap comes round in `duration-jump`. The pointer lifts while a ring turns and drops into the mark when it locks. Rings drift when left alone and hold still the moment you touch one.
- Work shows as motion, and nothing else does: dashes crawl only on a span or a step that is being worked, at one pace everywhere.
- In CSS, arrivals and departures move transform and opacity; the transcript and a Stream move weight and opacity over `duration-weight` and `duration-fade`; the instrument moves its box between its three sizes on the lock spring. Nothing else animates.
- Every control answers on the springs. A pressed button dips on the lock. A segmented selection is one plate that slides between segments, and that you can take hold of and drop on another. A fader's pointer catches on its detents. A field's focus draws an `accent` hairline under it. A switch's knob springs across; a fader's pointer and an arc gauge's ring spring to each new value. A value that changes ticks in `accent`, then settles to `ink`. A status dot or a badge's glyph re-lands on the lobe when its state changes. None of it moves at rest.
- Envelopes inside the instrument, attack / release: loudness 16 / 75 ms, low band 28 / 120 ms, mid 20 / 90 ms, high 8 / 50 ms, spikes 35 / 300 ms. State eases: thinking 70 ms in and 200 ms out, speaking 160 ms, listening 250 ms, reading 220 ms, writing 140 ms with its tendril on a spring, material crossfade 180 ms.
- Anticipation is the signature. The window is `duration-preroll`: for its first 42% the pointer sweeps, then it springs to the next clause and locks before the clause is heard. The same move, at the scale of the app: the reticle sweeps to what the companion is about to touch and locks before it acts.
- With reduced motion, drift and rotation run at 0.35×, arrivals only fade. The voice still drives size and weight.

## States

The scene:

| Moment | What is on screen |
|---|---|
| Home | The instrument in the center, every ring a hairline with its lit spans, and the composer at the foot. |
| At work | Your work, and the instrument docked at the foot, still live. |
| Something needs you | Its mark turns `accent` and holds a gate open; the companion says so in one line beside the core. Nothing lands on your work. |
| You reach for it | The instrument leans in. A plate names what faces you on each ring you touch. |
| You open a mark | Its detail unfolds from the mark. The rings hold still. |
| Your word | The companion's reticle locks on your choice, its Footprint lands with one word, and the opening folds back. |
| Settling | The mark goes quiet, the instrument returns to the foot, and the scene is at rest. |

A ring's spans:

| State | The span | The mark |
|---|---|---|
| Idle | a hairline | a quiet tick |
| Working | lit to its progress, dashes crawling ahead of a bead | a quiet tick |
| Waiting on you | lit to its progress, still | `accent`, with a gate held open |
| Done | fully lit, thinner and quieter than work in hand | a quiet tick |
| Failed | lit in `danger-dot` to where it stopped, with a bar across | a quiet tick |

The core takes a different form for each thing the companion is doing:

| State | The core | What drives it |
|---|---|---|
| Idle | a tide: a slow swell, and one long bulge that comes round | nothing; it breathes every 7.5 s |
| Listening | flattens into a dish facing you, with concentric rings standing on it | ring count follows pitch, depth follows loudness |
| Speaking | lobes, spikes only where it extrudes, a ripple on hard consonants | the voice's bands and onsets |
| Thinking, Bridging | stiffens into a polyhedron whose facets hold, then turn and re-cut | a beat, a little under one a second |
| Reading | a mouth opens toward what it reads and the surface spirals into it | `azimuth`: where the thing is |
| Writing | leans at the target and fires needles down a tendril to a bouton at its end | `azimuth`: where the target is |

The Status dot is `status-idle` in Idle and `accent` in every other state.

## Signal

- Create one reader with `Astrolabe.createSignal(analyserNode)` and pass it as `signal` to everything the voice drives: Core, Readout, Transcript, and the Composer and Summon while they listen. A function returning features or a static object also works.
- `Astrolabe.demoSignal` is synthetic — it speaks the instrument's own line on a loop. Use it only for previews, and never present it as measured.
- `state` is the authority: features move the displays only while speaking or listening.

## Agents at work

- On the instrument an agent at work is its span: dashes crawling ahead of a bead, with one smaller bead behind it for each helper. Where there are words — inside an opening, beside a name in a Roster — the same sign is a SignalLoop; the Spinner while something small is on its way; the full instrument where an agent is the subject of the view.
- `thinking` breaks the loop into turning dashes (a turn is being worked on, nothing back yet); `working` keeps it whole and breathing (tools running, output arriving); `idle` is a still ring in `status-idle`.
- The companion and the agent the view is about are `accent`; the helpers they start are `signal-b`, so you can tell at a glance who is doing the work.
- Inside an opening, pair every loop with words — "Thinking", "2 helpers running", "Reading the roadmap…" — in mono; on the instrument the plate carries the words when you touch the ring. Never show a stock spinner: where something small must wait, the Spinner is this same loop, small.

## Materials

- **Mercury** (default): polished chrome in a studio sky, with the `chrome-*` ramp as its 2D fallback and the warm `mercury` accent.
- **Tube**: amber vacuum-tube glass with a glowing filament, for slow, late, reflective sessions.
- **Wire**: a latitude–longitude wireframe with displacement contours in razor cyan, for fast debugging.
- **Plasma**: dark glass with a charge held in it, violet filaments wandering from the middle to the wall.
- A material can also say which mind is at work: in a chat, the core and the screen take the material of the model that answers (Mercury, Tube, Plasma or Wire), and `drive` on the Core is its effort.
- Each material has a mark colour, the colour its body reads as: `mercury-mark` chrome, `tube-mark` amber, `wire-mark` cyan, `plasma-mark` violet. A SignalLoop given a `material` wears it, at work and at rest, so the loop at the head of a reply says which model wrote it. The accents cannot do this: Mercury's and Tube's are too close. A model is named with its generation wherever it is named in words: "Opus 5.5", never "Opus".
- Switch by changing the material class on the subtree; the colours and the core crossfade, never cut.

## Iconography

- Four marks, all from the instrument. `play` and `stop` are filled glyphs at `size-glyph`. `mic` and `plus` are stroke icons on a 16px grid drawn at `size-icon`, `stroke-icon` wide, with round caps and joins. The plus is the file button's mark everywhere a file is added: in a Composer, to the companion, on a page. `close`, `trash`, `pin`, `chat`, `speaker` (and `speaker-off`), `ear` (and `ear-off`: listening for its name, or not), `menu` and `settings` are the two a screen keeps in its corners: the way to the places you seldom go, and the settings. `panel` and `lines` are the station's: put it away, take it down, keep it, open the transcript, the companion's voice (say it again; and that voice muted), what it shows you, what it heard. `chevron`, on the same grid, was added for the select. `back` and `send` are the two a button can wear alone. A ToolRow's marks say what a session used: `terminal`, `file`, `pencil`, `search`, `globe`, `thought`, `question`, and `tool` for anything else; `copy` and `check` are the copy button's two faces.
- The companion's own mark is the Footprint component, not an icon file: the core in miniature, a chrome bead in its orbit.
- Use the Icon component: inline SVG in `currentColor`, so an icon is always the colour of its label. The files under Icons are for `<img>` use only and are drawn in `#7b848d`, which holds 3:1 on both grounds.
- No emoji, no other icon sets. Draw any new mark on the same grid with the same stroke.

## Accessibility

- **Nothing takes focus unasked.** A mark that turns `accent` is announced politely through the companion's line, and focus stays where you are. An Opening takes focus because you opened it, and gives it back to its object when it closes. Give the core a key that turns the instrument to the newest thing waiting on you.
- Each ring is a slider named for what it holds; its value is the thing that faces you, with its state and its number. Arrows turn it and Enter opens. A Track's steps are buttons named with their number, their name and their state.
- Focus is a 1px solid `focus` outline 2px outside the control (3px inside a segmented group), at least 3:1 on every ground and surface in both themes.
- State is never colour alone: the Status word, the button label (Speak → Stop), a badge's glyph and `aria-pressed` change with it. The Footprint reads as its word and the companion's name ("Answered by Kaylee").
- Canvases are images with a label that names the state. Make the transcript a live region only when nothing else speaks the words aloud.
- The components honour `prefers-reduced-motion`.

## Building with it

- Load React 18 (`window.React`, `window.ReactDOM`), the tokens, `components/bundle.css` and `components/bundle.js`; the components live on `window.Astrolabe`.
- Start every screen from a Scene. `<Scene instrument={<Rings rings={rings}><Core/></Rings>} />` is the home screen; add `work` and the instrument docks. Put every set of things on a ring before you consider any other way of showing it, and one thing's course on a Track.
- Ask three things of every element: what else does it tell you, is it needed right now, and what does it do when you touch it. If it tells you one thing, give that to an object that is already there. If it is not needed now, it is a hairline until you click it. If it does nothing, it is a box.
- Words and lists go in an Opening, hung from the mark that was clicked: `<Opening open anchor={() => rings.current.pointOf(ring.id, item.id)} …>`.
- Two pages show it running. Home: the instrument at home, with a small workspace on three rings to turn, open and start. AtWork: the instrument docked beside your work, a chat that needs you, the lean, the question opening from its mark, your word, and rest.
