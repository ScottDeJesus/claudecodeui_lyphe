/**
 * The one frame and line every collapsed tool row wears, so a Read, an Edit, a Bash run
 * and a collapsed group all stand the same 32px tall and read in the same order:
 * icon, label, facts about the call, `/`, what it acted on — then the copy button and
 * line count, with the outcome rightmost. The whole row is the toggle; there is no
 * caret and no coloured stripe. A 1px border, 6px of padding, and an 18px line: the compact outcome pill is
 * the tallest thing a row carries.
 *
 * Used by BashCommandDisplay, OneLineDisplay, CollapsibleSection (via ToolRenderer's
 * framed call card) and ToolGroupContainer.
 */
export const TOOL_ROW_FRAME = 'overflow-hidden rounded-lg border border-border/60 bg-muted/40';

/** The header line inside the frame. `min-h` holds the height when no pill is showing. */
export const TOOL_ROW_HEADER = 'flex min-h-[30px] items-center gap-2 px-2.5 py-1.5 text-xs';

/** The tool's name after its icon. */
export const TOOL_ROW_LABEL = 'flex-shrink-0 text-xs font-medium text-foreground';

/** The `/` between the tool's name and what it acted on. */
export const TOOL_ROW_SEPARATOR = 'flex-shrink-0 text-[10px] text-muted-foreground/40';
