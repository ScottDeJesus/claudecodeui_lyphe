/*
 * HER CARDS' LINES, for `fake/cards.ts` only: the text of each fixture card exactly as the reader that puts it up writes it
 * (`server/modules/companion/eyes/`), and the fifteen items of the walk she takes him through. Nothing in the app imports
 * this file.
 *
 * - A list of runs as `list_runs recent` prints one (`run-list.ts`): `<plan title> › <task title, 70 characters> · <state> ·
 *   <when> · run <id>`, fifteen at most, then the eyes' closing line (`cappedLines`). The run ids are as long as the house's,
 *   longer than a phone is wide.
 * - The inbox as `list_alerts waiting` prints it: each section's line, the roadmap's asks under it two spaces in.
 * - A diff as `read_git diff` puts it on a card: the project's line, `=== modified <path>` over each file's hunks, the lines
 *   longer than a phone is wide, a file cut with the reader's own "… <n> more lines" line.
 * - A plan page as `read_card design` puts it on a card: its intro, then the dispatcher's own design text (the waiting
 *   feature's, as `dispatcher show` printed it, its `model:` line dropped), cut at its fourth section as a card is cut.
 * - A DocSpace page as `read_doc whole` puts it on a card (`doc-render.ts`'s `pageText`): its title, its description, its
 *   blocks under their numbered heads.
 * - Her own note (`show_note`), in her words; and a run's report (`read_run result`), a soul's head line then its report.
 */

/** `list_runs recent`, as it lands on a card: fifteen runs, newest first, then how many more it held. */
export const RUNS_LINES = [
  'Her cards on the stage › Her cards, composed on fixtures: the note, list, diff, plan page and… · in review · since today 04:05 · run chain-kaylee-station--cards--views-20261030-040537-ca77',
  'What needs you › "What needs you", composed on fixtures · fixing · since today 02:36 · run chain-kaylee-station--what-needs-you--views-20261030-023659-2a84',
  'Where things stand › His sessions and the roadmap, read for the rail on the server · building · since today 02:36 · run chain-kaylee-station--where-things-stand--read-20261030-023657-997f',
  'Her cards on the stage › His pin and his walk: PUT /notes/:id/pin and the companion_note_pinned… · done · today 03:58 · run chain-kaylee-station--cards--pin-walk-20261030-023701-61a9',
  'Her cards on the stage › Her tools say what they put up: toPanel and answerRead take a card\'s… · done · today 03:41 · run chain-kaylee-station--cards--tools-20261030-023700-8478',
  'Her cards on the stage › A diff\'s lines become one drawing in the kit: DiffLines in @/shared/ui… · done · today 03:12 · run chain-kaylee-station--cards--diff-kit-20261030-023659-68bb',
  'Since you last looked › The week\'s landings, read whole for the strip · done · today 03:02 · run chain-kaylee-station--since-you-last-looked--read-20261030-023701-f308',
  'Memory corner › "What I\'m keeping", composed on fixtures · done · today 02:58 · run chain-kaylee-station--memory-corner--view-20261030-024032-931a',
  'Kaylee at the center › Her face, her state in words and her controls, each extracted into a com… · failed at review · today 02:51 · run chain-kaylee-station--center--extract-20261030-023657-bbe0',
  'Restorly uploads handoff › hephaestus "Move the uploads tab\'s handoff into the" · done · today 01:44 · run soul-hephaestus-20261030-014102-77c1',
  'Kaylee Station\'s shell › The docstore says what landed · done · today 02:21 · run chain-kaylee-station--shell--docs-20261030-020818-8171',
  'Her face › Her face, whole: the portrait on every surface she is drawn on · done · today 01:39 · run chain-kaylee--face--whole-20261030-012617-128a',
  'Drybook visit hours › hephaestus "Count the visit hours per room for" · stopped · yesterday 23:12 · run soul-hephaestus-20261029-224418-0b2e',
  'Cerberus fleet check › athena "Review the fleet check\'s red rows and" · done · yesterday 21:07 · run soul-athena-20261029-205530-c4d9',
  'Backup restore drill › hephaestus "Restore last night\'s backup into a scratch" · done · yesterday 19:40 · run soul-hephaestus-20261029-191207-5e10',
  'And 4 more; give a phrase to narrow.',
].join('\n');

/** `list_alerts waiting`, as it lands on a card: the inbox's three sections, the roadmap's asks under it. */
export const INBOX_LINES = [
  'Memory: 2 proposals waiting (read_memory)',
  'Heal: 3 live (read_heal)',
  'Roadmap: 3 asks waiting on you (list_roadmap waiting)',
  '  kaylee-station--what-needs-you · waiting on your Accept',
  '  kaylee-desk (epic) · waiting on your Accept',
  '  kaylee-station--cards · 2 questions open',
].join('\n');

/** `read_git diff claudecodeui_lyphe`, as it lands on a card: two files, the second cut by the reader. */
export const DIFF_LINES = [
  'claudecodeui_lyphe: 2 changed files, both read.',
  '=== modified src/modules/station/StationShell.tsx',
  '@@ -33,10 +33,13 @@ type StationShellViewProps = {',
  '  * themselves; the rest are their own height. The conversation keeps a floor of 3.5rem whatever else stands in her',
  '  * column, so her newest line stays in sight (her panel\'s own rule); the dock gives way before it does. Below laptop',
  '  * the column is a stack, where these read as their own heights.',
  '+ *',
  '+ * The corner is the rail\'s foot whatever stands above it (`mt-auto`, its hairline its own), so it never rises to the',
  '+ * rail\'s head while the sessions are not drawn; under the sessions, which take the room, the margin is nothing.',
  '  */',
  ' const SLOT_BOX: Record<BodySlot, string> = {',
  '   sessions: \'min-h-0 flex-1\',',
  '-  corner: \'shrink-0\',',
  '+  corner: \'mt-auto shrink-0 border-t border-border\',',
  '   head: \'shrink-0\',',
  '   conversation: \'min-h-14 flex-1\',',
  '   dock: \'min-h-0 flex-[0_1_auto]\',',
  '=== modified src/modules/station/MemoryCorner.tsx',
  '@@ -118,9 +118,10 @@ export function MemoryCornerView({ tier, lines, open, onOpenChange, failure, onReread, pageUrl, scrollRef }: Memo',
  '   const count = lines === null ? null : lines.count;',
  '-  const label = count === null ? t(\'station.memory.title\', { defaultValue: "What I\'m keeping" }) : t(\'station.memory.count\', { count });',
  '+  const label = count === null',
  '+    ? t(\'station.memory.unreadable\', { defaultValue: "What I\'m keeping, which can\'t be read just now" })',
  '+    : t(\'station.memory.count\', { count, defaultValue_one: "What I\'m keeping, {{count}} memory", defaultValue_other: "What I\'m keeping, {{count}} memories" });',
  '   return (',
  '     <Collapsible data-station-corner="" open={open} onOpenChange={onOpenChange} className="flex min-h-0 flex-col">',
  '… 14 more lines of this diff are not shown',
].join('\n');

/** `read_card <the waiting feature> design`, as it lands on a card: the intro, then the dispatcher's design, cut. */
export const PLAN_LINES = [
  'The design of kaylee station what needs you:',
  'kaylee-station--what-needs-you — loaded — approved 2026-10-30',
  'approved by: app:card',
  'repo: /home/lyphe/.claude/claudecodeui_lyphe',
  'waits on: kaylee-station--shell',
  'goal:',
  '  3. RIGHT RAIL — "What needs you". A stacked inbox: Accept prompts, design questions with options, permission requests, follow-ups she filed, health checks that are red. Each item has one primary action (Queue, Answer, Allow, Open) and shows the spoken words that will fire it. Nothing fires without his word.',
  '  ',
  '  Deliver: … a "waiting on you" state (two Accepts and one red check) …',
  'delivers:',
  '  "What needs you", the station\'s right rail.',
  '  ',
  '  AT ITS HEAD, when one stands: the action waiting for his word. It is her card as her panel draws it: the act and its target, the prompt or his carried words, "Say “…”", when it lapses, and the × that withdraws it.',
  '  ',
  '  UNDER IT, A STACKED INBOX in his order, each item showing:',
  '  - its kind in words;',
  '  - what it is about;',
  '  - one line of it;',
  '  - its one act;',
  '  - the words that fire it.',
  '  ',
  '  PRESSING AN ITEM OR ITS ACT puts its whole on the stage, with the control that fires it in reach. Nothing fires from the rail itself, and nothing fires without his press or his spoken word.',
  '  ',
  '  WHEN NOTHING WAITS: "Nothing needs you."',
  'architecture:',
  '  THE INBOX IS SERVED WHOLE BY ONE READ OF HERS, because the words that fire each item are hers.',
  '  - An item\'s spoken words must be exactly what her check of his word accepts: `sayOf(action, spoken)` over the target\'s spoken name (`hands/action-prompts.ts`, the card book\'s `spoken`, `card-lines.ts`).',
  '  - Those live on the server, so the inbox is composed there: `station/station-needs.ts`, `stationNeeds(userId, house)`. It reads the house\'s own readers, one per kind, in his order.',
  'decisions:',
  '  - Where the inbox is composed: on the server, in one read of hers, because the words that fire an item are hers to say back.',
  '  - What a press does: puts the item\'s whole on the stage, where its owner\'s own form fires it; nothing fires from the rail… narrow it to see the rest',
].join('\n');

/** `read_doc page-kaylee-memory whole`, as it lands on a card: `pageText` of her memory's page. */
export const PAGE_LINES = [
  '# Kaylee\'s memory',
  '',
  '## About this page',
  'What she keeps: the rules, gotchas and landmines he told her, each with the moment he said it. Read-only and live: it changes as she keeps and forgets.',
  '',
  '## 1. markdown · block blk-memory-intro',
  'How she keeps',
  'She keeps a memory only when he says it in so many words, and she reads it back before she writes it. Nothing here is a guess of hers.',
  '',
  '## 2. docstore_view · block blk-memory-rules',
  'Rules',
  'view memory-rules of kaylee:memory',
  '',
  '## 3. checklist · block blk-memory-review',
  'To review with him',
  '- [x] Probes run on Haiku, never the default model',
  '- [ ] The station\'s stage never covers her face',
  '- [ ] Nothing is pushed to her silently',
].join('\n');

/** Her own card (`show_note`), in her words. */
export const NOTE_LINES = [
  'Three things are still open tonight.',
  '',
  'The cards plan is in review: the views are with Iris, and the live phase waits on them.',
  '',
  'Restorly\'s uploads handoff wants your permission to deploy. I didn\'t answer it for you.',
  '',
  'The backup drill is green again since 03:12.',
].join('\n');

/** `read_run <the uploads chat's run> result`, as it lands on a card: the soul's head line, then its report. */
export const RUN_LINES = [
  'Soul hephaestus (builder): done, ended today 01:44. It was handed: Move the uploads tab\'s handoff into the shared drawer and keep the batch count on its tab.',
  '',
  'Its report:',
  'The uploads tab now hands a finished batch to the shared drawer instead of opening its own modal. The batch count stays on the tab until the drawer is closed, and a batch that fails to hand off says so on the tab in the warn ink.',
  '',
  'Shown on the live page at 1440×900 and 390×844: one batch of 12 photos handed off, the count kept, the drawer closed. The deploy is not run: it waits on your permission in the chat.',
].join('\n');

/** The fifteen items of her review of the Kanban lane, in order: the short titles her `walk` tool takes (120 characters at most). */
export const KANBAN_REVIEW_ITEMS = [
  'The lane\'s card count disagrees with the board after a drag between two lanes',
  'A card dropped on a collapsed lane lands in its first slot, not where it was dropped',
  'The WIP limit badge stays amber for a second after a card leaves the lane',
  'Archived cards still count toward the Done lane\'s total in the header',
  'Dragging a card by its title on a phone opens the card instead of lifting it',
  'The new-card field loses what was typed when the lane reads the board again',
  'Two cards with the same title show the same avatar stack',
  'Lane colours stop short of the card edges in the dark theme',
  'Keyboard reorder (Alt+↑ and Alt+↓) skips cards the filter hides',
  'The due-date chip reads in UTC: a day early for anything due after 17:00',
  'Moving a card to another board leaves its comment count behind',
  'Search marks a match inside a card\'s description but never scrolls to it',
  'A lane renamed while another tab has the board open keeps its old name there until a reload',
  'Swimlane headers repeat on every page of a long lane',
  'Undo after a bulk move puts the cards back but not in their order',
];
