import { parseFileRef, parseHexColor, parseKeyCombo } from '@/modules/chat/transcript/shapes/detect';
import { ColorSwatch, FileChip, KeyCaps } from '@/modules/chat/transcript/shapes/InlineMarks';

type InlineCodeProps = {
  /** The span's whole text, which is what every mark below is decided on: hex colour, key combo, file reference. */
  raw: string;
};

/**
 * Byte-identical to the class the old `CodeBlock` built — TRAILING SPACE INCLUDED.
 *
 * That class was written as `` `… text-foreground ${className || ''}` ``, and on the inline path
 * react-markdown never supplies a className: a fenced or indented block always arrives through the
 * `pre` renderer with `forceBlock`, so the suffix was always empty and the attribute always ended
 * in a space. The space is load-bearing rather than a typo, and the literal says so rather than
 * leaving the next reader to delete it.
 */
const INLINE_CODE_CLASS =
  'whitespace-pre-wrap break-words rounded-md border border-border/70 bg-muted px-1.5 py-0.5 font-mono text-[0.875em] text-foreground ';

/**
 * The inline half of the old `CodeBlock`. Its only consumer is the `shapes/code` dispatcher, which
 * routes here when a code element is not a block, so a fenced block can never reach the marks
 * below. It reads no context and takes nothing but its text.
 *
 * **Hex colour, then key combo, then file reference, then today's span** — the precedence table's
 * inline-code row. Each is tried against the WHOLE text, never a substring: `` `#fff` `` is a
 * colour and `` `color: #fff` `` is code; `` `Ctrl+C` `` is a shortcut and `` `a + b` `` is
 * arithmetic, because `parseKeyCombo` demands a modifier; `` `src/a.ts:12` `` is a file and
 * `` `import src/a.ts` `` is a line of code. The file branch uses the STRICT grammar the prose scan
 * uses, so the same characters chip identically inside a code span and outside one.
 *
 * A colour and a shortcut are drawn around or in place of the span; a file reference is drawn as
 * the chip, carrying the span's text as its label, so the author still reads what they typed. This
 * module cannot see what the span sits in, so it hands the chip the span itself as `plain`: inside a
 * link, a section heading or a table header the chip draws that instead (`ChipsSuppressedContext`).
 *
 * It is a behaviour-identical move rather than a literal one, and the three differences all rest on
 * ONE fact — an inline `code` in this pipeline has exactly one text child and no hast properties:
 *
 *   1. it renders `raw` where the old code rendered `children`. `raw` is `String(children)` with a
 *      trailing newline trimmed, and `shouldInline` already requires that there be no newline, so
 *      the two are the same string. mdast's `inlineCode` has no element children, so `children` is
 *      never anything but that string.
 *   2. it drops the old `{...props}` spread, and
 *   3. it drops the `${className || ''}` suffix (see the constant above).
 *
 * Both drops are safe only if react-markdown passes no className and no extra props on this path,
 * and that is PINNED rather than assumed. All five inline spans in
 * `.verify/artifacts/shapes-elements-baseline.html` — at offsets 494, 1664, 12030, 12407 and 12576 —
 * carry `class="… text-foreground "` and no other attribute at all. That whole artifact is pinned to
 * the PRE-MOVE renderer: it was captured with the pre-move `Markdown.tsx` swapped in from git, and
 * the post-move code then reproduced it byte for byte. So every one of the five proves the pin.
 * (Offsets move whenever the document is widened; the class string and the absent second attribute
 * are the claim, and re-measure rather than trust the numbers if you are checking this.)
 */
export function InlineCode({ raw }: InlineCodeProps) {
  const span = <code className={INLINE_CODE_CLASS}>{raw}</code>;

  const color = parseHexColor(raw);
  if (color) return <ColorSwatch color={color}>{span}</ColorSwatch>;

  const keys = parseKeyCombo(raw);
  if (keys) return <KeyCaps keys={keys} />;

  const ref = parseFileRef(raw);
  if (ref) {
    return (
      <FileChip path={ref.path} line={ref.line} plain={span}>
        {raw.trim()}
      </FileChip>
    );
  }

  return span;
}
