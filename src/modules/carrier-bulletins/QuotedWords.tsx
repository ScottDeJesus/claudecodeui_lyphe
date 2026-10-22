type PageQuoteProps = {
  /** The page's own words, as the reading quoted them. */
  words: string;
};

/**
 * The page's own words, drawn as a quote: a rule at the start of the block and the words in italics, so a reader tells at
 * a glance what the bulletin prints from what Claude or the house says about it. A text node, never markup (R-CERB-25:
 * a vendor-authored string is an XSS source).
 *
 * Used by the carrier-bulletins module's `RequirementList`, `JudgedList` and `SetAside`.
 */
export function PageQuote({ words }: PageQuoteProps) {
  return (
    <blockquote className="m-0 border-l-2 border-border pl-3 text-[13px] italic leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">
      {words}
    </blockquote>
  );
}

type LabeledProps = {
  /** The house's word for what follows ("Why", "Same as", "What it asks"), from `cerberus.bulletins.*`. */
  label: string;
  /** The words it labels — Claude's reason, a rule's words, a duty's doubt — drawn as their own text node. */
  words: string;
};

/**
 * A label and the words it introduces, as two text nodes: the words never pass through `t()`, so nothing in them is read
 * as anything but text.
 *
 * Used by the carrier-bulletins module's `JudgedList` and `SetAside`.
 */
export function Labeled({ label, words }: LabeledProps) {
  return (
    <p className="text-[12.5px] leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">
      <span className="font-medium text-foreground">{label}</span> {words}
    </p>
  );
}
