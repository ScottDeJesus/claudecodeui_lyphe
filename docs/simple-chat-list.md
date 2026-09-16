# The simple chat list

An alternative sidebar for someone who does not think in projects: no tree, no search chips, one
project picker, one New chat button, and a flat feed of the chats they started from this view —
newest first. `src/modules/sidebar/SidebarSimpleList.tsx` composes it from two module-private
hooks (`hooks/useSimpleChatList.ts`, `hooks/useSimpleChatRemove.ts`) and is rendered by
`Sidebar.tsx` in a slot `SidebarContent` never imports, so the tree's own code carries no
knowledge of this view. Settings stays reachable either way — this replaces the tree, not the
whole sidebar.

## The tag

A session is *in* the simple list because it was **created from** this view, not because some
later rule decided it belongs there. `sessions.simple_list_at` is `NULL` for every session made
from the project tree and a timestamp for one made here. The list's sort key is a separate column,
`sessions.simple_list_rank`, and the only thing that moves it is a drag — see §"Order" below. On
the client, [src/shared/types.ts](../src/shared/types.ts)'s `RecentConversationListItem` carries
`icon` and `unread` beside the row, and
[src/shared/api.ts](../src/shared/api.ts) reaches the two routes as `setSessionIcon` and
`moveSimpleListSession`. The client is the only thing that knows which composer a send came
from, so it is the client that asks to be tagged:
`useSimpleChatListPreferences().enabled` rides along as `simpleList` on the same
`POST /api/providers/sessions` every composer already makes. A conversation is never re-tagged
after creation — turning simple mode off does not detag a chat it made, and back on again does
not retroactively tag one it did not.

`GET /api/providers/sessions/recent?simpleList=true` is the same recents query the project tree's
own sidebar already calls, narrowed by one clause rather than answered by a second endpoint — the
route table, its exact query shape and its response contract live in
[server/modules/providers/README.md](../server/modules/providers/README.md), not here.

## The preference keys

`simpleChatList` (on/off) and `simpleChatProjectId` (which project a New chat here lands in) are
two flat keys in the same per-user preference store every other setting lives in — theme, sort
order, the selected provider. They are not folded into `uiPreferences`: that blob is a typed
boolean reducer (`src/shared/uiPreferences.ts`), and a project id is a `string | null`, not a
flag. The store itself — how a write reaches the mirror before the server, the legacy-key seeding
rule, why a setting born after that migration seeds nothing — is documented once, in
[src/shared/userSettings.ts](../src/shared/userSettings.ts)'s own header.

## Removing a chat

`useSimpleChatRemove` owns the whole flow so the list stays presentational. A chat nobody is
waiting on archives immediately (`DELETE /api/providers/sessions/:id`, no `force` — the row goes
to Archived, never off disk). A chat the busy set says is running asks first: confirming sends one
`chat.abort` frame and archives the moment that session id drops out of the busy set — the same
busy set the running spinner reads, fed by `chat_subscribed`/`complete` frames and a five-second
resync, never a poll this hook owns. An abort the gateway never confirms still ends: a 15 s
fallback archives anyway, so Remove is never a button that can hang forever.

## Order

A tagged chat's place is `sessions.simple_list_rank`, never its creation time: the column is
written when the chat is created, so a new chat always lands on top, and only a drag moves it
afterwards. A **mouse** press may start anywhere on the row; a **touch** press starts a drag only
from the leading icon (`data-drag-handle`), so a touch on the title still scrolls the list. What
travels is the id the row should sit *after* (`afterSessionId`, `null` for the top) — the browser
decides only which row and which side of it. The server does the arithmetic: it takes the midpoint
between the neighbours' ranks, and when no room is left between them it renumbers the whole tagged
list instead, so two rows never share a rank. The route is `PUT
/api/providers/sessions/:sessionId/simple-list-position`; its table and contract are at
[server/modules/providers/README.md](../server/modules/providers/README.md).

## Icons

`sessions.icon` holds one icon name per chat; `NULL` is the default. The picker offers 24 named
icons plus Default, and the row's leading glyph resolves the name through `SimpleChatIconGlyph`
(`src/modules/sidebar/SidebarSessionIcon.tsx`), which draws the default `MessageSquare` for `NULL`
**and** for any name it does not know — so a name whose glyph is gone degrades instead of failing.
`PUT /api/providers/sessions/:sessionId/icon` writes it.

## Unread

Unread is a fact about the server's two timestamps, never a client flag. A run's end stamps
`sessions.last_completed_at` once, from the run registry's single `recordRunCompletion` — the one
place every provider's terminal `complete` passes — and stamps `last_read_at` in the same statement
when the chat was already on screen as the run ended, so a chat you were watching never goes
unread. Otherwise the read comes from the chat's own `chat.presence` report: the presence handler in
`chat-websocket.service.ts` marks the row read when a socket reports that chat `visible`, in either
sidebar mode, and writes only a row that is still unread. The rule is one SQL fragment —
`last_read_at IS NULL OR last_read_at < last_completed_at` — evaluated in the recents page query,
not in the browser. Every change broadcasts `session_upserted`, which is what reloads the list, and
the dot is suppressed on the selected row, so the chat you have open never shows it. See
[notifications.md](notifications.md) for the presence store and the freshness window it is read
through.

## What this never touches

Tagging, filtering and archiving are all rows in `sessions` — none of it reaches the provider
transcript on disk. Archiving (the only thing Remove ever does) does not delete or rewrite the
`.jsonl` file; only a hard delete with `force=true` — a cleanup path, never a UI button — removes
it, and even that only removes the file, never edits its content. How a session's on-disk identity
is minted, mapped and merged with the filesystem watcher's own view is a separate mechanism this
feature does not change; see
[docs/architecture/03-conversation-handoff.md](architecture/03-conversation-handoff.md).

## Proving it

`.verify/probe-simple-settings.mjs` and `.verify/probe-simple-view.mjs` are the cheap smokes — the
toggle exists in Settings, and the view mounts and un-mounts cleanly. `.verify/phase-17.mjs` is the
full proof: a real tagged chat created through the sealed composer, renamed, followed into Files by
project, idle-removed, and the tree restored on toggle-off. `.verify/phase-18.mjs` covers what
phase-17 leaves untested: a busy row's stop-and-remove path (the dialog, Cancel, Confirm, and the
15 s fallback described above) and the 390 px mobile width. `.verify/probe-simple-icons-unread.mjs`
covers the two fields those two leave untouched: the leading icon and its picker (25 options,
Default included, each pick a real `PUT …/icon`, each persisting through a reload), and the
unread dot — lit by a finished run's own `session_upserted` broadcast, never a reload or an
injected frame, and cleared the moment the chat is opened or was already on screen when it ended.
`.verify/probe-simple-reorder.mjs` covers the order itself, through the real event path —
`page.mouse` on desktop, CDP `Input.dispatchTouchEvent` on a 390 px phone, never a synthetic
`PointerEvent`. Each drop sends the server the exact `afterSessionId` the drop bar implied and
persists through a reload and the server's own order, including to the very top and downward past
a row already moved; a drop back onto its own position sends nothing, a plain click still opens
the chat, a new chat still lands on top after a drag, and the click a drag swallows never eats the
very next press on a row's "Chat options" trigger.
`.verify/probe-sidebar-state-api.mjs` is the server half underneath both, with no browser at all:
it reads the four state columns over HTTP and drives the read rule through a real `chat.presence`
frame on a chat socket. See [verification.md](verification.md).
