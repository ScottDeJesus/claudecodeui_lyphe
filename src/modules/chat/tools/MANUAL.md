<!-- docstore export; edit rows with docstore write, never this file -->

## MAN-737 — tools

The tool rendering system: every tool's display lives in toolConfigs.ts rather than in scattered conditionals, built from two base patterns — OneLineDisplay for compact tools and CollapsibleDisplay for expandable ones — with results routed through ToolRenderer.

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat/tools/

## MAN-728 — Overview
section: README/000 Overview

Config-driven architecture for rendering tool executions in chat. All tool display behavior is defined in `toolConfigs.ts` — no scattered conditionals. Two base display patterns: **OneLineDisplay** for compact tools, **CollapsibleDisplay** for tools with expandable content.

Non-error tool results route through `ToolRenderer` with `mode="result"` (single source of truth). Error results are handled inline in `MessageComponent` with a red error box.

---

## MAN-729 — Architecture
section: README/001 Architecture

```
tools/
├── components/
│   ├── OneLineDisplay.tsx          # Compact one-line tool display
│   ├── CollapsibleDisplay.tsx      # Expandable tool display (uses children pattern)
│   ├── CollapsibleSection.tsx      # <details>/<summary> wrapper
│   ├── ContentRenderers/
│   │   ├── ToolDiffViewer.tsx          # File diff viewer (memoized)
│   │   ├── MarkdownContent.tsx     # Markdown renderer
│   │   ├── FileListContent.tsx     # Comma-separated clickable file list
│   │   ├── TodoListContent.tsx     # Todo items with status badges
│   │   ├── TaskListContent.tsx     # Task tracker with progress bar
│   │   └── TextContent.tsx         # Plain text / JSON / code
├── configs/
│   └── toolConfigs.ts              # All tool configs + ToolDisplayConfig type
└── ToolRenderer.tsx                # Main router (React.memo wrapped)
```

---

## MAN-730 — OneLineDisplay
section: README/002 Display Patterns/003 OneLineDisplay

Used by: PowerShell, Read, Grep, Glob, WebSearch, WebFetch, TodoRead, TaskCreate, TaskUpdate, TaskGet (Bash has its own `BashCommandDisplay`)

Renders as a single line inside the shared tool-row frame (`toolRow.ts`), the same 32px row every collapsed tool wears. Supports multiple rendering modes based on `action`:

- **open-file** — Shows filename only (truncated from full path), clickable to open
- **jump-to-results** — Shows pattern with anchor link to result section
- **copy** — Shows value with hover copy button
- **none** — Plain display

```tsx
<OneLineDisplay
  toolName="Read"
  icon="file"               // Registry icon name, drawn by ToolRowIcon (wrench if unknown)
  label="Read"              // Tool label
  value="/path/to/file.ts"  // Main display value
  secondary="description"   // Optional secondary text (italic)
  action="open-file"        // Action type
  onAction={() => ...}      // Click handler
  colorScheme={{             // Per-tool colors
    primary: 'text-...',
    icon: 'text-...'
  }}
  resultId="tool-result-x"  // For jump-to-results anchor
  toolResult={...}          // For conditional jump arrow
  toolId="x"                // Tool use ID
/>
```

## MAN-731 — CollapsibleDisplay
section: README/002 Display Patterns/004 CollapsibleDisplay

Used by: Edit, Write, ApplyPatch, Grep/Glob results, TodoWrite, TaskList/TaskGet results, ExitPlanMode, Default

Wraps `CollapsibleSection` (`<details>`/`<summary>`). A call (`framed`) sits in the shared tool-row frame with a 32px header; a result below it keeps a `border-l-2` accent colored by tool category. Accepts **children** directly (not contentProps).

```tsx
<CollapsibleDisplay
  toolName="Edit"
  toolId="123"
  title="filename.ts"           // Section title (can be clickable)
  defaultOpen={false}
  onTitleClick={() => ...}      // Makes title a clickable link (for edit tools)
  showRawParameters={true}      // Show raw JSON toggle
  rawContent="..."              // Raw JSON string
  toolCategory="edit"           // Drives border color
>
  <ToolDiffViewer {...} />          // Content as children
</CollapsibleDisplay>
```

**Tool category colors** (via `border-l-2`, on result sections only — tool rows carry no stripe):
| Category | Tools | Color |
|----------|-------|-------|
| `edit` | Edit, Write, ApplyPatch | amber |
| `bash` | Bash | green |
| `search` | Grep, Glob | gray |
| `todo` | TodoWrite, TodoRead | violet |
| `task` | TaskCreate/Update/List/Get | violet |
| `plan` | ExitPlanMode | indigo |
| `default` | everything else | neutral gray |

---

## MAN-732 — Content Renderers
section: README/005 Content Renderers

Specialized components for different content types, rendered as children of `CollapsibleDisplay`:

| contentType | Component | Used by |
|---|---|---|
| `diff` | `DiffViewer` | Edit, Write, ApplyPatch |
| `markdown` | `MarkdownContent` | ExitPlanMode |
| `file-list` | `FileListContent` | Grep/Glob results |
| `todo-list` | `TodoListContent` | TodoWrite, TodoRead |
| `task` | `TaskListContent` | TaskList, TaskGet results |
| `text` | `TextContent` | Default fallback |
| `success-message` | inline SVG | TodoWrite result |

---

## MAN-733 — Adding a New Tool
section: README/006 Adding a New Tool

**Step 1:** Add config to `configs/toolConfigs.ts`

```typescript
MyTool: {
  input: {
    type: 'one-line',              // or 'collapsible'
    label: 'MyTool',
    getValue: (input) => input.some_field,
    action: 'open-file',
    colorScheme: {
      primary: 'text-purple-600 dark:text-purple-400',
      border: 'border-purple-400 dark:border-purple-500'
    }
  },
  result: {
    hideOnSuccess: true            // Only show errors
  }
}
```

**Step 2:** If the tool needs a category color, add it to `getToolCategory()` in `ToolRenderer.tsx`.

**That's it.** The ToolRenderer auto-routes based on config.

---

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat/tools/configs/toolConfigs.ts

## MAN-734 — ToolDisplayConfig
section: README/007 Configuration Reference/008 ToolDisplayConfig

```typescript
type ToolDisplayConfig = {
  input: {
    type: 'one-line' | 'collapsible' | 'hidden';

    // One-line
    icon?: string;
    label?: string;
    getValue?: (input) => string;
    getSecondary?: (input) => string | undefined;
    action?: 'copy' | 'open-file' | 'jump-to-results' | 'none';
    style?: string;                              // 'terminal' for Bash
    wrapText?: boolean;
    colorScheme?: {
      primary?: string;
      secondary?: string;
      background?: string;
      border?: string;
      icon?: string;
    };

    // Collapsible
    title?: string | ((input) => string);
    defaultOpen?: boolean;
    contentType?: 'diff' | 'markdown' | 'file-list' | 'todo-list' | 'text' | 'task';
    getContentProps?: (input, helpers?) => any;
    actionButton?: 'none';
  };

  result?: {
    hidden?: boolean;                            // Never show
    hideOnSuccess?: boolean;                     // Only show errors
    type?: 'one-line' | 'collapsible' | 'special';
    title?: string | ((result) => string);
    defaultOpen?: boolean;
    contentType?: 'markdown' | 'file-list' | 'todo-list' | 'text' | 'success-message' | 'task';
    getMessage?: (result) => string;
    getContentProps?: (result) => any;
  };
};
```

---

## MAN-735 — All Configured Tools
section: README/009 All Configured Tools

| Tool | Input | Result | Notes |
|------|-------|--------|-------|
| Bash | terminal one-line | hide success | Dark command pill, green accent |
| Read | one-line (open-file) | hidden | Shows filename, clicks to open |
| Edit | collapsible (diff) | hide success | Amber border, clickable filename |
| Write | collapsible (diff) | hide success | "New" badge on diff |
| ApplyPatch | collapsible (diff) | hide success | "Patch" badge on diff |
| Grep | one-line (jump) | collapsible file-list | Collapsed by default |
| Glob | one-line (jump) | collapsible file-list | Collapsed by default |
| TodoWrite | collapsible (todo-list) | success message | |
| TodoRead | one-line | collapsible todo-list | |
| TaskCreate | one-line | hide success | Shows task subject |
| TaskUpdate | one-line | hide success | Shows `#id → status` |
| TaskList | one-line | collapsible task | Progress bar, status icons |
| TaskGet | one-line | collapsible task | Task details with status |
| ExitPlanMode | collapsible (markdown) | collapsible markdown | Also registered as `exit_plan_mode` |
| Default | collapsible (code) | collapsible text | Fallback for unknown tools |

---

## MAN-736 — Performance
section: README/010 Performance

- **ToolRenderer** is wrapped with `React.memo` — skips re-render when props haven't changed
- **parsedData** is memoized with `useMemo` — JSON parsing only runs when input changes
- **ToolDiffViewer** memoizes `createDiff()` — expensive diff computation cached
- **MessageComponent** caches `localStorage` reads and timestamp formatting via `useMemo`
- Tool results route through `ToolRenderer` (no duplicate rendering paths)
- `CollapsibleDisplay` uses children pattern (no wasteful contentProps indirection)
- Configs are static module-level objects — zero runtime overhead for lookups

## MAN-9697 — McpElicitationPanel and mcpElicitationForm — an MCP server's form on the composer: where it is drawn, what each press answers, how a schema becomes fields and an answer is checked

An MCP server's request for input reaches the page as a `permission_request` with `toolName: 'McpElicitation'` and the request as `input` (`ElicitationRequestInput`, `src/shared/types.ts`). The server's half, and what each decision becomes (`toElicitationResult`): MAN-332. What may not be broken: INV-11419.

## Where it is drawn
- `PermissionRequestsBanner` (in the composer) sends a request whose `toolName` is `McpElicitation` to `McpElicitationPanel` and builds no Allow / Deny banner for it. The panel takes `PermissionPanelProps` (`request`, `onDecision`) like `AskUserQuestionPanel`, but stands in the banner's place above the composer, not inline in the transcript (MAN-406).
- Root `[data-mcp-elicitation]`. The form scrolls inside `max-h-[70dvh]`; Decline and Submit stay pinned under it.

## What each press answers
| press | decision |
|---|---|
| Submit (form mode) | `{ allow: true, updatedInput: { content } }`, only when no field has a problem; problems show under their fields after the first Submit and the first one is scrolled into view |
| Open link (URL mode, `http:` or `https:` only) | `{ allow: true, updatedInput: {} }`: the server maps it to `accept` with no content |
| Decline | `{ allow: false }` |
A URL that is not http(s) (`javascript:` above all) is shown as text under a sentence and offers no Open link. The companion and the station can only decline (MAN-9481).

## `mcpElicitationForm.ts` — pure, no DOM
| function | does |
|---|---|
| `readElicitationFields(requestedSchema)` | the flat object schema into `ElicitationField[]` in the server's order. Kinds: `text`, `number`, `integer`, `boolean`, `choice`, `multi`. Choices from `enum` (labelled by `enumNames`) or from `oneOf` / `anyOf` entries of `const` and `title`; a `multi` is an array whose `items` give them. `format` → input type: `email`, `uri` → `url`, `date`, `date-time` → `datetime-local`. Reads `minLength`, `maxLength`, `minimum`, `maximum`, `minItems`, `maxItems` and `default` |
| `initialElicitationValues(fields)` | the start: every field at its default; a default the input could not show starts the field empty |
| `problemWithAnswer(field, value)` | `ElicitationProblem` or `null`: a code plus the figure its sentence names; the panel words it with `mcpElicitation.*` |
| `buildElicitationContent(fields, values)` | what goes back: a boolean always (unticked is `false`); a number as a number; any other field only when answered |
| `isOpenableUrl(url)` | `true` for http(s) alone |
- A single choice is held as its POSITION in `choices` (`''` is nothing chosen), so a blank enum value is still a value; it is sent untrimmed.
- A `date-time` goes out as an ISO instant in UTC (a `datetime-local` gives local time with no offset, which RFC 3339 rejects). A local time a daylight-saving change skipped is refused, not sent shifted.
- Lengths count code points. A `format` the server's rules lack is not checked.

## Dependency and strings
- `ajv-formats` (`^3.0.1`) is a direct dependency, imported as `ajv-formats/dist/formats` (`fullFormats`, the rules file alone). why: the MCP SDK validates an accepted answer with ajv and ajv-formats in full mode, so the panel checks by the same rules.
- `mcpElicitation.*` in `chat.json`, English only.

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat/composer/PermissionRequestsBanner.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat/tools/InteractiveRenderers/McpElicitationPanel.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat/utils/mcpElicitationForm.ts
