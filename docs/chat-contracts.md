# The chat contracts

Six agreements the transcript, the composer and Settings all lean on. Break one and a screen says
something untrue about who did what — which model answered, or who let a tool run. Each rule names
the file that enforces it; that file's header carries the reasoning and this note does not repeat it.
Proving any of it on the running app is [verification.md](verification.md).

## 1. The model is recorded per turn, on every part of it

`claude-sessions.provider.ts` reads `message.model` off the stored row and stamps it on EVERY normalized
part of that turn — the text, each `tool_use`, the thinking. A turn reaches the transcript as a run of
rows captioned from whichever comes first, so stamping the reply alone captions every turn that thought
or used a tool with the provider's name. Read it from the row, never from the session's current
selection: a conversation can change model mid-way. The field is `model?: string` on `NormalizedMessage`
in both `server/shared/types.ts` and `src/shared/types.ts`, and on `ChatMessage` beside it.

**The live stream is the known gap.** No socket path carries a model, so a fresh reply reads
"Claude" until the session is re-read from disk. Closing it is one line in `claude-runtime.provider.js`.

## 2. A raw model id never reaches the transcript

`modelLabels.ts::resolveModelLabel` answers with the catalog's own label or with null, matching an id
to a short alias by whole dash-segments; the rule and its traps are in that file's header. A null
falls back to the provider's name, so a model the catalog never carried reads "Claude" rather than
`claude-haiku-4-5-20251001`. The composer's chip is the one place an id shows — there it was typed.

## 3. The tool badge ranks what it knows

`toolOutcome.ts::deriveToolOutcome` ranks three outcomes: `waiting` over `approved` over `finished`.
A row blocked on a person, or one that person allowed by hand, has not plainly "finished", and
saying so is the one wrong thing this badge can say.
Null is a real answer — a call still running, or one that failed, is named by `ToolStatusBadge`
already. A row finds its own prompt through `permissionKey(toolName, input)`, the permission event
carrying no tool-use id to line the two sides up by.

**Its stated limit.** A transcript records that a tool ran, never that anyone was asked, so a RELOADED
conversation shows a hand-approved call as "Finished". Never infer approval from a stored row.

## 4. The permission prompt has three actions

"Allow this time", "Allow and remember", "Leave it as it is" — allow once, allow with a stored rule,
refuse. `PermissionRequestsBanner.tsx` sends all three through one `handlePermissionDecision`: the
remembering one carries a `rememberEntry`, the refusal a message back. Send nothing and the run
waits on an answer nobody gave.

## 5. Edit mode lives in ONE store, written by merge

`<provider>Permissions.permissionMode`, in the server-synced preferences.
`useProviderPermissionMode.ts` subscribes rather than reading once, so the composer chip and
Settings → Agents show one value with no reload between them. Write it MERGED into that blob —
Settings owns the other fields under the same key, and a replaced object drops them. The
per-session `permissionMode-<sessionId>` keys are retired, and swept once per load.

## 6. An auto-saved field must survive the dialog closing

`useSettingsController.ts` debounces its save by 500 ms. A debounce whose only cleanup cancels the
timer is a DATA-LOSS bug: changing a setting and closing within half a second is the ordinary way
to use that screen, and the write was lost while the control looked inert. The timer nulls its own
ref when it fires — so a non-null ref means exactly "a change is still waiting" — and an
unmount-only effect declared AFTER it flushes that write through `saveSettingsRef`.

## 7. A widget fence is the opt-in, and only on this surface

A turn knows it is running inside CloudCLI's chat, rather than a terminal, from two things
`claude-runtime.provider.js` sets on `sdkOptions` inside `mapCliOptionsToSDK`, per turn: the SDK
child's env carries `CLAUDE_SURFACE=cloudcli`, and its system prompt gains `SURFACE_PROMPT_APPEND`
— one sentence naming the fence and the bus (`WIDGET_SIGNAL`), then a short paragraph naming the
four markdown conventions this surface draws as components (`MARKDOWN_SIGNAL`; what it names, and
why only four, is [architecture/08-rendered-shapes.md](architecture/08-rendered-shapes.md)
§"The triggers"). Both come from `surface-signal.ts` and nowhere else — never `.env`,
never a systemd unit, never `process.env` read at module load. A terminal launch of `claude` reads
neither, so their absence is what tells a turn it is not talking to CloudCLI's chat; the runner's
own souls (Heph, Athena, Prometheus, …) run a different path entirely and never pass through this
provider, so they never see the appended text either.

The opt-in itself is narrow: a fenced code block whose info string is exactly `widget` renders as
a live widget instead of highlighted source — the WHOLE word, so a hyphenated extension of it such
as `widget-config` stays an ordinary documentation label and runs nothing. Nothing else opts in: a
plain `html` fence, or any other language tag, stays a code block, because that fence does not
exist anywhere `CLAUDE_SURFACE` is not `cloudcli`.

What a widget is allowed to do is narrower still, and it is the BODY that decides — the tag admits,
it never widens. Raw HTML is the default and is what it has always been: its sandbox is
`allow-scripts` and nothing else — no `allow-same-origin`, no network of any kind — and it reaches
the rest of the app only by naming a TOPIC through `live.subscribe`, never a URL. The one other
shape is a body that parses as JSON naming a DocSpace block
(`{ "kind": "docspace", "pageId": …, "blockId": … }`), and it is a DIFFERENT frame rather than a
loosened one: it navigates to ArchPulse's own origin so the block can save what the reader edits,
it subscribes to no topics at all, and the origin it lands on must differ from this app's before
any iframe is rendered. Everything else — a body that fails to parse, one whose `kind` is something
else, one that merely contains the word — is HTML, so nothing that renders today can change shape.
The full shape of the fence, both sandboxes, the origin invariant and the bus it talks to is
[architecture/07-live-widgets.md](architecture/07-live-widgets.md) §"The DocSpace kind".

That second body shape — a fence whose content is the JSON naming a DocSpace block — renders
through `DocSpaceFrame`, an iframe pointed at ArchPulse's own origin and never at this app's:
`isForeignOrigin` refuses to mount it at all when the two origins are equal, which is what makes
the ORIGIN itself the invariant rather than any flag read off the fence. That is also why this is
the one frame whose sandbox carries `allow-same-origin` — a real origin with its own document and
a login-free API, so a grant the HTML widget's `srcDoc` sandbox never may hold is safe here
precisely because the origin differs. The widget sentence (`WIDGET_SIGNAL` in `surface-signal.ts`)
carries this in its own clause: anything that should persist, be edited by the reader, or be read back on a
later turn is steered toward a DocSpace block instead of a one-off HTML fence. The full protocol
both frames speak is still [architecture/07-live-widgets.md](architecture/07-live-widgets.md)
§"The DocSpace kind".
