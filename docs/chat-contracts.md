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

`toolOutcome.ts::deriveToolOutcome` ranks four outcomes: `waiting` over `approved` over `finished`
(a shell command that ran) over `automatic`. A row blocked on a person, or one that person allowed
by hand, was not "done automatically", and saying so is the one wrong thing this badge can say.
Null is a real answer — a call still running, or one that failed, is named by `ToolStatusBadge`
already. A row finds its own prompt through `permissionKey(toolName, input)`, the permission event
carrying no tool-use id to line the two sides up by.

**Its stated limit.** A transcript records that a tool ran, never that anyone was asked, so a RELOADED
conversation shows a hand-approved call as "Done automatically". Never infer approval from a stored row.

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
