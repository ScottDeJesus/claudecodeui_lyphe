import { useLayoutEffect } from 'react';
import type { RefObject } from 'react';

import { useHostWindow } from '@/shared/context/HostWindowContext';
import { resizeObserverIn } from '@/shared/utils';

/** A computed length in px; a value that reads as nothing is 0. */
const px = (value: string): number => Number.parseFloat(value) || 0;

/**
 * Writes whether the field shows its first line in its box: the field's height down to the box's clipping edge (its content
 * edge, inside its padding), against its top border, its top padding and one line of words. Its foot (bottom padding and border)
 * is not counted: the box clips it anyway.
 */
function writeRoom(box: HTMLElement, field: HTMLElement) {
  const view = box.ownerDocument.defaultView;
  if (!view) return;
  const style = view.getComputedStyle(field);
  const firstLine = px(style.borderTopWidth) + px(style.paddingTop) + px(style.lineHeight);
  const clipAt = box.getBoundingClientRect().bottom - px(view.getComputedStyle(box).paddingBottom);
  const fieldBox = field.getBoundingClientRect();
  box.dataset.fieldRoom = Math.min(fieldBox.bottom, clipAt) - fieldBox.top + 0.5 < firstLine ? 'none' : 'line';
}

/**
 * THE FIELD STEPS ASIDE WHOLE BELOW ITS FIRST LINE (the dock's head line, `CompanionDraftCard`'s `headLine`). Its box gives way
 * down to nothing, and between nothing and a first line of words it would show a sliver: the field's top border, a line cut
 * through its glyphs, and under a finger a press smaller than the touch law's 44 px. So while the field shows less than its first
 * line its box's `data-field-room` reads `none`, and the card draws the box's content transparent and untouchable (opacity and
 * pointer events, which move nothing, so the write never feeds back into the size it reads). The field alone holds its box, so
 * none of its room goes to anything else. A field that holds the focus is never hidden (the card keys its classes on
 * `:not(:focus-within)`), so he always sees what he types: the dock gives a focused field its room back where its cap leaves
 * room for it, and the field shows what that room holds where it does not. It keeps its place in the tab order meanwhile.
 * Written as the box appears and on each of its resizes, an event, never a poll; nothing is written while `active` is false
 * (her panel).
 *
 * Used by this module's CompanionDraftCard.
 */
export function useFieldRoom(boxRef: RefObject<HTMLElement | null>, fieldRef: RefObject<HTMLElement | null>, active: boolean) {
  const hostWindow = useHostWindow();
  useLayoutEffect(() => {
    const box = boxRef.current;
    const field = fieldRef.current;
    if (!active || box === null || field === null) return undefined;
    writeRoom(box, field);
    const observer = resizeObserverIn(hostWindow, () => writeRoom(box, field));
    observer?.observe(box);
    return () => observer?.disconnect();
  }, [boxRef, fieldRef, active, hostWindow]);
}
