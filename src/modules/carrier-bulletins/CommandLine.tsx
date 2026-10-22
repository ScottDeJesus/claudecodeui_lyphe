type CommandLineProps = {
  /** The command, whole: the printed question list, or a manual pull of one carrier. */
  command: string;
};

/**
 * A command the operator runs, in the tab's mono line. The view is read-only by the operator's answer of 2026-10-21 — "You
 * change a rule only by answering the printed question list, or on the Approval Rules page" — so where a person acts it
 * names the command beside the words rather than drawing a button. Plain selectable text.
 *
 * Used by the carrier-bulletins module's `CarrierPages` (a manual pull for waiting or unread pages), `ReadingColumn` (a
 * manual pull for a waiting page) and `RequirementList` (the question list beside a rule's open question).
 */
export function CommandLine({ command }: CommandLineProps) {
  return <code className="block font-mono text-[11.5px] text-secondary-foreground [overflow-wrap:anywhere]">{command}</code>;
}
