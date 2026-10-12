import { useLayoutEffect, useRef, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';

import { StatusGlyph } from '@/modules/cerberus/StatusMarks';
import type { CerberusCheckView } from '@/shared/cerberus-types';
import { cn } from '@/shared/utils';

type CheckRowsProps = {
  /** The service's checks, in key order. */
  checks: CerberusCheckView[];
  /** The key of the check the sheet shows; its row is marked. */
  selectedKey: string;
  /** The service as the sheet's title names it, for the list's accessible name. */
  serviceName: string;
  /** A press on a row: the sheet moves to that check. */
  onSelect: (check: CerberusCheckView) => void;
};

/**
 * Scrolls the box so the marked row is in view, centred, when it is not. It moves the box and nothing
 * above it (`scrollIntoView` would also scroll the sheet's body), and a row already in view is left
 * where it is, so pressing a row never makes the list jump under the pointer.
 */
function useRowInView(boxRef: RefObject<HTMLUListElement | null>, selectedKey: string) {
  useLayoutEffect(() => {
    const box = boxRef.current;
    const row = box?.querySelector<HTMLElement>('[aria-current]');
    if (!box || !row) return;
    const boxRect = box.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    if (rowRect.top >= boxRect.top && rowRect.bottom <= boxRect.bottom) return;
    box.scrollTop += rowRect.top - boxRect.top - (boxRect.height - rowRect.height) / 2;
  }, [boxRef, selectedKey]);
}

/**
 * THE SERVICE'S CHECKS, one row each in a bordered box: the status glyph, the label over its raw id
 * (or the id alone, in mono, for a check with no label yet), and the value it reported. The box is
 * capped at 260 px (a third of the screen's height on a short one) and scrolls inside itself: a service
 * can hold seventy-five checks, and an uncapped list would push the check the sheet was opened for, its
 * minutes and its lookup thousands of pixels below the fold. It opens with the marked row in view (see
 * `useRowInView`), and a row pressed while it is in view stays put. The row the sheet shows is marked
 * three ways, so colour is never the only sign (MAN-578): the canvas ground,
 * an accent rule on its left edge and `aria-current`.
 *
 * Each row is a button. Its accessible name reads the status word first, because the glyph names it
 * ("Failing Session is valid session.valid 401 from XactAnalysis…"). The glyph rings while its check
 * is failing, as it does everywhere the tab shows a check now.
 *
 * At desk width the value sits on the right, as wide as 45% of the row. On a phone it drops under the
 * label, so the label is never squeezed into a column a word wide. A row leans 3px right under the
 * pointer, the prototype's motion. Its ground changes at once: colour does not transition here
 * (MAN-739 rule 5). The focus ring is drawn inside the row, because the box clips anything outside it.
 *
 * Used by the cerberus module's `CheckSheet`, which moves the sheet on `onSelect`.
 */
export function CheckRows({ checks, selectedKey, serviceName, onSelect }: CheckRowsProps) {
  const { t } = useTranslation();
  const boxRef = useRef<HTMLUListElement>(null);
  useRowInView(boxRef, selectedKey);
  return (
    <ul
      ref={boxRef}
      aria-label={t('cerberus.sheet.checksOf', { service: serviceName })}
      className="m-0 max-h-[min(260px,32dvh)] list-none divide-y divide-border overflow-y-auto overflow-x-hidden rounded-xl border border-border p-0"
    >
      {checks.map((check) => {
        const selected = check.key === selectedKey;
        return (
          <li key={check.key}>
            <button
              type="button"
              aria-current={selected || undefined}
              onClick={() => onSelect(check)}
              className={cn(
                'relative flex w-full items-start gap-2.5 px-3.5 py-2 text-left hover:bg-background focus-visible:[outline-offset:-2px] sm:items-center',
                'transition-transform duration-move ease-enter motion-safe:hover:translate-x-[3px] motion-reduce:transition-none',
                selected && 'bg-background before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:bg-primary',
              )}
            >
              <StatusGlyph status={check.status} />
              <span className="flex min-w-0 flex-1 flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-3">
                <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2">
                  {check.label === null ? (
                    <span className="font-mono text-[13px] text-foreground [overflow-wrap:anywhere]">{check.id}</span>
                  ) : (
                    <>
                      <span className="text-sm font-medium text-foreground">{check.label}</span>
                      <span className="font-mono text-[11px] text-muted-foreground [overflow-wrap:anywhere]">{check.id}</span>
                    </>
                  )}
                </span>
                {check.value !== null && (
                  <span className="text-[12.5px] text-muted-foreground [overflow-wrap:anywhere] sm:max-w-[45%] sm:text-right">
                    {check.value}
                  </span>
                )}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
