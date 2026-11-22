import { cn } from '@/shared/utils';

type ExcerptProps = {
  /** The lines, as one text; a line break starts the next line. */
  text: string;
  /** What the lines are, for assistive tech: "Evidence". The pane takes focus so a keyboard can scroll it, and what takes focus needs a name. */
  label: string;
  /** Where the lines are from, as a caption over them: a file's path. Absent, the lines stand without a head. */
  path?: string;
  /** The first line's number; 1 when absent. */
  start?: number;
  /** How many lines stand at once; the rest scroll inside the pane. Absent, every line stands. */
  rows?: number;
  className?: string;
};

/** A line's height in px: astrolabe.css's --ast-row, which the pane's height is counted in. */
const ROW_PX = 16;
/** The pane's own air above and below its lines, in px. */
const PANE_PAD_PX = 8;

/**
 * THE DESIGN SYSTEM'S EXCERPT, in its still form: lines of text as they were written, each on its own row with its number in the
 * gutter, between two hairlines. A line longer than the pane scrolls sideways and never wraps, so a path or a measurement reads
 * whole. It is text, so it lives in what a click opened, never on a screen by default.
 *
 * Used by the rnd module's open candidate (CandidateOpening), for a spike's evidence.
 */
export function Excerpt({ text, label, path, start = 1, rows, className }: ExcerptProps) {
  const lines = text.split('\n').map((line, index) => ({ n: start + index, line }));
  return (
    <figure className={cn('ast-excerpt', className)}>
      {path !== undefined && (
        <figcaption className="ast-excerpt-path" title={path}>
          {path}
        </figcaption>
      )}
      <div
        className="ast-excerpt-body"
        role="group"
        aria-label={label}
        tabIndex={0}
        style={rows === undefined ? undefined : { maxHeight: rows * ROW_PX + PANE_PAD_PX * 2 }}
      >
        <pre className="ast-excerpt-pre">
          {lines.map(({ n, line }) => (
            <span key={n} className="ast-excerpt-line">
              <span className="ast-excerpt-n" aria-hidden="true">{n}</span>
              <code>{line === '' ? ' ' : line}</code>
            </span>
          ))}
        </pre>
      </div>
    </figure>
  );
}
