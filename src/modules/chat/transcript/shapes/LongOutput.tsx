import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDownIcon } from 'lucide-react';

import { Collapsible, CollapsibleTrigger } from '@/shared/ui';
import { cn } from '@/shared/utils';
import { LONG_OUTPUT_LINES, LONG_OUTPUT_PREVIEW_LINES } from '@/modules/chat/transcript/shapes/detect';
import { useShapeCollapse } from '@/modules/chat/transcript/shapes/useShapeCollapse';

/**
 * What the ordinary fence draws while this wrapper holds it: the text to highlight, the class its
 * body wears, and the control to put under it. `CodeFence` owns the fence's shell — its header,
 * label and copy button — and this module owns only the clamp, so the two meet in this one type.
 */
export type OutputClamp = {
  /** The preview lines while clamped; the whole block once released, and always in an export. */
  shown: string;
  /** The fade over the last preview lines, or undefined once the whole block is showing. */
  bodyClassName: string | undefined;
  /** "Show all N lines" / "Show less", or null inside an export, where nothing can be clicked. */
  control: ReactNode;
};

type LongOutputProps = {
  /** The whole fence body. Only its line count and its first lines are read here. */
  raw: string;
  /** `shapeKey('output', raw)`: the fence body verbatim, per the plan's payload table. */
  collapseKey: string;
  /**
   * Draws the ordinary fence — `CodeFence`'s shell, never a second one. It receives the clamp on a
   * long fence and `undefined` on a short one, which it must draw exactly as it always has.
   */
  children: (clamp: OutputClamp | undefined) => ReactNode;
};

/**
 * The fade: a mask on the text itself rather than a gradient painted over it, so it needs no
 * colour of its own and reads the same on the block's light and dark backgrounds.
 */
// The last ~3 lines fade, measured from the box's bottom edge, which includes the highlighter's own
// 1rem of bottom padding — hence 5rem and not the 3.9rem three lines alone would take.
const FADE_CLASS =
  '[-webkit-mask-image:linear-gradient(to_bottom,black_calc(100%_-_5rem),transparent)] [mask-image:linear-gradient(to_bottom,black_calc(100%_-_5rem),transparent)]';

/**
 * A long fenced block shown as its first lines, faded, with a "Show all N lines" control.
 *
 * Used by `code/CodeFence.tsx` around the ordinary highlighted block, once no earlier fence shape
 * claimed it. THIS is where "long" is decided — more than `LONG_OUTPUT_LINES` lines, a number that
 * lives in `detect.ts` and nowhere else — and a fence at or under it is handed straight back to
 * `children` with no clamp and no wrapper element, so it renders byte for byte as it always has.
 * Nothing is lost by the clamp either: the control shows the rest, and the fence's own copy button
 * copies `raw` — the whole block — whatever is on screen.
 *
 * The clamp draws FEWER LINES rather than hiding overflow: a 2,000-line log is highlighted twelve
 * lines at a time until someone asks for the rest, which is most of the reason to clamp at all.
 * It is built on the shared `Collapsible`, whose trigger supplies `aria-expanded` and whose root
 * carries the open state; `CollapsibleContent` is not used because a preview is not a hidden region.
 *
 * **Fold memory.** Through `useShapeCollapse`, keyed on the body, so a block the reader opened
 * stays open after its row scrolls away and back. This one kind starts CLAMPED, so the Map's
 * `true` here records the reader's "Show all" — the release — and its absence is the preview. That
 * keeps the property the Map's "absent means expanded" default exists for: a key collision can only
 * ever show a block WHOLE, never hide content the reader did not hide.
 *
 * **Export.** `useShapeCollapse` is the one place under `shapes/` that reads
 * `useIsExportingTranscript`; its `interactive` is false in an export, and then this wrapper
 * draws the whole block with no fade and no control — on the first synchronous render, since no
 * effect runs inside `renderToStaticMarkup`.
 */
export function LongOutput({ raw, collapseKey, children }: LongOutputProps) {
  const { t } = useTranslation('chat');
  // Called before the short-fence return below, because hooks may not be skipped on some renders.
  const { collapsed: released, toggle, interactive } = useShapeCollapse(collapseKey);

  const lines = raw.split('\n');
  if (lines.length <= LONG_OUTPUT_LINES) {
    return <>{children(undefined)}</>;
  }

  const clamped = interactive && !released;
  const shown = clamped ? lines.slice(0, LONG_OUTPUT_PREVIEW_LINES).join('\n') : raw;

  const control = interactive ? (
    // Pulled up into the highlighter's bottom padding, so the control reads as the end of the
    // faded text rather than as a separate row under the block.
    <div className="-mt-2 flex justify-center px-4 pb-2">
      <CollapsibleTrigger
        data-output-toggle
        className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <ChevronDownIcon
          aria-hidden="true"
          className={cn('h-3.5 w-3.5 transition-transform duration-200', !clamped && 'rotate-180')}
        />
        {clamped ? t('shapes.showAllLines', { count: lines.length }) : t('shapes.showLess')}
      </CollapsibleTrigger>
    </div>
  ) : null;

  return (
    <Collapsible
      open={!clamped}
      onOpenChange={toggle}
      data-shape="output"
      data-collapsed={String(clamped)}
    >
      {children({ shown, bodyClassName: clamped ? FADE_CLASS : undefined, control })}
    </Collapsible>
  );
}
