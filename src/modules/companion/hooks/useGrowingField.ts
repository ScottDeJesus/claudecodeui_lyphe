import { useEffect, useLayoutEffect } from 'react';
import type { RefObject } from 'react';

import { useHostWindow } from '@/shared/context/HostWindowContext';
import { resizeObserverIn } from '@/shared/utils';

type SizeBy = 'height' | 'flexBasis';

/** Writes the words' height, borders included, to `sizeBy`; a field that reads 0 (not drawn) keeps its natural size. */
function sizeToWords(field: HTMLTextAreaElement, sizeBy: SizeBy) {
  field.style[sizeBy] = 'auto';
  if (field.scrollHeight === 0) {
    field.style[sizeBy] = '';
    return;
  }
  field.style[sizeBy] = `${field.scrollHeight + field.offsetHeight - field.clientHeight}px`;
}

/**
 * Sizes a textarea to its words; its CSS caps (a max-height, or the flex room it stands in) stop it, and it scrolls
 * inside beyond that.
 *
 * `sizeBy` is the property the words' height is written to. `height` for a field in a row (the composer). `flexBasis`
 * for a field in a flex column that must give way when the column runs out of room (the draft in her dock): a fixed
 * height would hold the card at the words' height, while a basis is only where the field starts — it shrinks with the
 * column down to its own min-height (the kit's 88px floor) and scrolls inside.
 *
 * MEASURED ONLY WHILE DRAWN, AND AGAIN ONCE DRAWN. Her panel stays mounted while closed, `display: none`, where a field's
 * `scrollHeight` is 0: a height taken then held the composer at 0px (its padding alone, 16px) and the draft at its floor
 * when the panel opened, and nothing measured again until the words changed. So `drawn` is a key, nothing is measured
 * while it is false, and a field that still reads 0 is left at its natural height.
 *
 * MEASURED AGAIN WHEN ITS WIDTH CHANGES — a phone turned, a window crossing lg from the column to the sheet — because
 * the same words wrap to another height: a ResizeObserver on the field (an event, never a poll), acting only when the
 * width moved, and a frame later, so writing the height never re-enters the observer.
 *
 * THE HEIGHT COUNTS THE FIELD'S OWN BORDERS (`offsetHeight - clientHeight`): set to its `scrollHeight` alone, a bordered
 * field is 2px short and stays scrollable over nothing — a 15px scrollbar beside text that hides nothing, wherever
 * scrollbars are not overlays.
 *
 * Used by this module's CompanionComposer (her composer's field) and CompanionDraftCard (the draft's field).
 */
export function useGrowingField(
  fieldRef: RefObject<HTMLTextAreaElement | null>,
  value: string,
  drawn: boolean,
  sizeBy: SizeBy = 'height',
) {
  const hostWindow = useHostWindow();

  useLayoutEffect(() => {
    const field = fieldRef.current;
    if (!field || !drawn) return;
    sizeToWords(field, sizeBy);
  }, [fieldRef, value, drawn, sizeBy]);

  useEffect(() => {
    const field = fieldRef.current;
    if (!field || !drawn) return undefined;
    let width = field.offsetWidth;
    let frame = 0;
    const observer = resizeObserverIn(hostWindow, () => {
      if (field.offsetWidth === width) return;
      width = field.offsetWidth;
      hostWindow.cancelAnimationFrame(frame);
      frame = hostWindow.requestAnimationFrame(() => sizeToWords(field, sizeBy));
    });
    observer?.observe(field);
    return () => {
      observer?.disconnect();
      hostWindow.cancelAnimationFrame(frame);
    };
  }, [fieldRef, drawn, sizeBy, hostWindow]);
}
