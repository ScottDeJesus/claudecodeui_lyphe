import { useTranslation } from 'react-i18next';

import type { Tone } from '@/shared/types';
import { Badge, Card } from '@/shared/ui';
import type { TableData } from '@/modules/chat/transcript/shapes/detect';
import { checkGlyph } from '@/modules/chat/transcript/shapes/detect';
import { ShapeFrame } from '@/modules/chat/transcript/shapes/ShapeFrame';

type DecisionMatrixProps = {
  /** Headers exactly `Option | Pros | Cons` or `Option | Pros | Cons | Verdict`, and the body rows. */
  data: TableData;
  collapseKey: string;
};

/**
 * The tone of a verdict cell, WITHOUT reading its prose.
 *
 * A leading ✓ or ✗ is an explicit judgement the author wrote, and `checkGlyph` already owns that
 * grammar; anything else is neutral. Guessing a tone from words ("recommended", "avoid") would be
 * the same mistake `deltaTone` refuses to make — the shape never decides for the author whether a
 * verdict is good news, and it never decides it in one language only.
 */
const verdictTone = (cell: string): Tone => {
  const glyph = checkGlyph(cell);
  if (glyph === 'pass') return 'positive';
  if (glyph === 'fail') return 'danger';
  return 'neutral';
};

/**
 * An Option/Pros/Cons table as one card per option.
 *
 * Used by `elements/table.tsx` and nothing else. It is reached only when `hasInlineFormatting` is
 * FALSE of the table, which is what makes drawing from `data`'s cell TEXT safe here: a matrix whose
 * cells carry `code`, bold or a link declines at the branch and stays a readable table instead of
 * being flattened into cards. So this component can never render less than the author wrote.
 *
 * The shell is the shared `Card` and the verdict is the shared `Badge` — a bordered box and a toned
 * pill both already exist in `src/shared/ui/`, and a hand-rolled second spelling of either is the
 * defect this plan names by name.
 */
export function DecisionMatrix({ data, collapseKey }: DecisionMatrixProps) {
  const { t } = useTranslation('chat');
  // Exactly three or four headers reach here (`classifyTable`), so a fourth column IS the verdict.
  const verdictColumn = data.headers.length === 4 ? 3 : null;

  return (
    <ShapeFrame kind="decision-matrix" title={t('shapes.titles.options')} collapseKey={collapseKey}>
      <div className="grid gap-2 sm:grid-cols-2">
        {data.rows.map((row, index) => {
          const verdict = verdictColumn === null ? '' : (row[verdictColumn] ?? '').trim();
          return (
            <Card key={index} className="p-3">
              {/* All four headers are drawn, each over the cell it names — the same eyebrow on
                  every field, so the card is self-describing and no header word is lost when the
                  table becomes cards. `Option` and `Verdict` are fixed words the trigger requires
                  rather than the author's own, but the law does not carve an exception for that,
                  and the frame's title is a TRANSLATED app string: in `ja` it reads 選択肢, so
                  leaning on it to stand in for the word `Option` drops that word outright. */}
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div
                    data-shape-label
                    className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
                  >
                    {data.headers[0]}
                  </div>
                  {/* The option's own name is the card's headline: it is what the reader scans for. */}
                  <div className="text-sm font-semibold text-foreground">{row[0]}</div>
                </div>
                {verdict ? (
                  <div className="flex-none text-right">
                    <div
                      data-shape-label
                      className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
                    >
                      {data.headers[verdictColumn ?? 3]}
                    </div>
                    <Badge tone={verdictTone(verdict)} className="mt-0.5">
                      {verdict}
                    </Badge>
                  </div>
                ) : null}
              </div>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <div>
                  <div
                    data-shape-label
                    className="text-[11px] font-medium uppercase tracking-wide text-accent-ink"
                  >
                    {data.headers[1]}
                  </div>
                  <div className="mt-0.5 text-sm text-foreground">{row[1]}</div>
                </div>
                <div>
                  <div
                    data-shape-label
                    className="text-[11px] font-medium uppercase tracking-wide text-warn-ink"
                  >
                    {data.headers[2]}
                  </div>
                  <div className="mt-0.5 text-sm text-foreground">{row[2]}</div>
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    </ShapeFrame>
  );
}
