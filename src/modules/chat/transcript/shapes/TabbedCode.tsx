import { Children, isValidElement, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { Tabs } from '@/shared/ui';
import { shapeKey } from '@/modules/chat/transcript/shapes/collapseState';
import type { HastNode } from '@/modules/chat/transcript/shapes/hast';
import { readCodeChildren } from '@/modules/chat/transcript/shapes/hast';
import { ShapeFrame } from '@/modules/chat/transcript/shapes/ShapeFrame';
import { useShapeInteractive } from '@/modules/chat/transcript/shapes/useShapeCollapse';

type TabbedCodeProps = {
  /** The `data-shape="tabbed-code"` wrapper `remarkShapeGroups` built: one `pre > code` per fence. */
  node?: HastNode;
  /** Those same fences, already rendered by `shapes/code` — header, label, copy button and all. */
  children?: ReactNode;
};

/**
 * Which tab each group last showed, for the life of the page, keyed like its fold.
 *
 * Module-level for the reason `collapseState.ts` is: `LazyMessageRow` unmounts a row that leaves
 * its band, and a tab choice held only in component state would snap back to the first language
 * the moment the reader scrolled away and back. Written only by a click, so it grows with human
 * effort and needs no eviction. It is not in `collapseState` because that map answers one
 * yes-or-no question per block and this one answers "which".
 */
const chosenTabs = new Map<string, number>();

/**
 * The label a fence already wears in its own header (`code/CodeFence.tsx`): the leading `\w+` of
 * its language, capitalised. A tab reading "Typescript" above a block labelled "Ts" would be two
 * names for one thing.
 */
const tabLabel = (lang: string): string => {
  const word = /^\w+/.exec(lang)?.[0] ?? lang;
  return word.charAt(0).toUpperCase() + word.slice(1);
};

/**
 * One label per fence, with no two alike. The trigger lets a language repeat among others
 * (`ts`, `py`, `ts`), and two tabs both named "Ts" are two controls a screen reader cannot tell
 * apart except by position — so every occurrence of a repeated label is numbered ("Ts 1", "Py",
 * "Ts 2") and a label that appears once is left as the fence's own.
 */
const tabLabels = (langs: string[]): string[] => {
  const labels = langs.map(tabLabel);
  const seen = new Map<string, number>();
  return labels.map((label) => {
    if (labels.indexOf(label) === labels.lastIndexOf(label)) return label;
    const occurrence = (seen.get(label) ?? 0) + 1;
    seen.set(label, occurrence);
    return `${label} ${occurrence}`;
  });
};

/**
 * Adjacent fences in different languages — the same example in TypeScript and in Python — drawn as
 * one block with a tab per language, showing one at a time.
 *
 * Used by `elements/plain.tsx`'s `ShapeDiv`, for the `tabbed-code` wrapper `remarkShapeGroups`
 * builds, and by nothing else. The trigger lives in the plugin; this only draws what it grouped.
 *
 * **Decide from `node`, render from `children`.** `readCodeChildren` reads each fence's language —
 * the tab labels — and its source, which is the fold key's payload. What a tab SHOWS is the fence
 * `children` already rendered: the ordinary highlighted block with its own copy button, clamped
 * with its "Show all" control when it is long. Nothing is redrawn from text, so nothing is lost.
 *
 * It wears `ShapeFrame`, so it folds like every shape, and composes the shared `Tabs` rather than
 * spelling a tab strip of its own. The strip is the `underline` register because it sits on the
 * frame's own surface — a filled tray there would read as a card floating on a card.
 *
 * **Export.** `useShapeInteractive` is false inside `renderToStaticMarkup` (the one place under
 * `shapes/` that reads `useIsExportingTranscript` is `useShapeCollapse.ts`, and this asks it). A
 * static page cannot switch tabs, so there it draws EVERY fence, stacked, each under its own
 * language label — hiding all but one would export a transcript missing the rest.
 */
export function TabbedCode({ node, children }: TabbedCodeProps) {
  const { t } = useTranslation('chat');
  const interactive = useShapeInteractive();
  const blocks = node ? readCodeChildren(node) : [];
  const fences = Children.toArray(children).filter(isValidElement);
  // The payload the plan fixes for this kind: every fence's language and source, joined.
  const collapseKey = shapeKey('tabbed-code', blocks.map((block) => `${block.lang}\n${block.text}`).join('\n'));
  // Which fence is showing. Seeded from the page-lifetime memory so a remounted row reopens on the
  // language the reader chose.
  const [chosen, setChosen] = useState(() => chosenTabs.get(collapseKey) ?? 0);

  // The plugin only builds this wrapper around two or more fences, one rendered child each. If the
  // tree ever disagrees with itself, the fences are drawn exactly as they would be ungrouped.
  if (blocks.length < 2 || blocks.length !== fences.length) {
    return <>{children}</>;
  }
  // Clamped at the point of use: a djb2 collision with a larger group could hand this one an index
  // it does not have, and an empty panel would render less than the markdown it replaced.
  const active = Math.min(chosen, blocks.length - 1);
  const labels = tabLabels(blocks.map((block) => block.lang));

  const choose = (id: string) => {
    const index = Number(id);
    chosenTabs.set(collapseKey, index);
    setChosen(index);
  };

  return (
    <ShapeFrame kind="tabbed-code" title={t('shapes.titles.code')} collapseKey={collapseKey}>
      {interactive ? (
        <>
          {/* Pulled out to the frame's edges so the strip's rule meets the frame's own border. The
              inner `w-max` sizes the strip to its labels: the underline register spreads its tabs
              across whatever width it is given, which suits a sidebar of icons and turns two code
              tabs into two half-width slabs. */}
          <div className="-mx-3 -mt-2 overflow-x-auto border-b border-border/70 px-1">
            <div className="w-max">
              <Tabs
                variant="underline"
                ariaLabel={t('shapes.titles.code')}
                active={String(active)}
                onChange={choose}
                // Ids are positions, not languages: the trigger allows a language to repeat so long
                // as not every fence shares one, and two tabs with one id would be one tab.
                tabs={labels.map((label, index) => ({ id: String(index), label }))}
              />
            </div>
          </div>
          <div data-tab-panel role="tabpanel" aria-label={labels[active]}>
            {fences[active]}
          </div>
        </>
      ) : (
        fences
      )}
    </ShapeFrame>
  );
}
