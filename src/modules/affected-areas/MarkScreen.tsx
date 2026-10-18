import { useEffect, useRef, useState } from 'react';

import { useImageUrl } from '@/modules/affected-areas/hooks/useImageUrl';
import { useQueue } from '@/modules/affected-areas/hooks/useQueue';
import { MarkQueue } from '@/modules/affected-areas/MarkQueue';
import type { Codebook, Queue, Region } from '@/shared/affected-areas-types';
import { useHostWindow } from '@/shared/context/HostWindowContext';

type MarkScreenProps = {
  /** The kinds, their labels and groups; null until the codebook answers. */
  codebook: Codebook | null;
  /**
   * Whether the Mark screen is on view: the Tours · Mark · Tables switch shows Mark and the Tours view itself is shown.
   * Passed by the view root, which keeps this screen mounted while Tours or Tables shows. The queue is read again each
   * time this turns true after the first (what was judged elsewhere has left it) and the keys listen only while it is true.
   */
  shown: boolean;
};

/** The keys this screen answers, each the press it stands for: Y confirms, N is not a change, R opens Rename to…, S skips. */
const PRESS_OF_KEY: Record<string, string> = { y: 'confirm', n: 'not_a_change', r: 'rename', s: 'skip' };

/** A field that takes letters, or a dialog, menu or list that owns the keyboard while it is up: no key of this screen then. */
const TAKES_THE_KEYBOARD = 'input, textarea, select, [contenteditable="true"]';
const OWNS_THE_KEYBOARD = '[role="dialog"], [role="menu"], [role="listbox"]';

/**
 * THE MARK SCREEN WALKS A QUEUE THE ENGINE ORDERS: `GET /queue?mode&class&limit=20`, unsure-first by distance from
 * each kind's threshold or the random slice by hash, one area at a time, the next after every press. Skip moves on
 * without a row. The operator chooses the queue, and the tables say which marks count for which number.
 *
 * This file holds the queue, the screen's two choices and its keys; `MarkQueue` draws them, `MarkBar` presses. Y, N, R
 * and S click the very presses a pointer makes (`data-mark-press`), so a key is never a second way to mark; they are
 * this screen's alone, since on the pano screen a key would fire while a note is typed, and they wait while a field
 * has the focus or a dialog, menu or list is up (the note dialog included).
 *
 * Used by the affected-areas module's `AffectedAreasView`, behind the sub-switch's Mark.
 */
export function MarkScreen({ codebook, shown }: MarkScreenProps) {
  const hostWindow = useHostWindow();
  // ── The wires: the queue's mode and kind, its walk, the keys, and the presses that move it. Everything they hand
  //    `MarkQueue` is composition. ──
  // Which queue is walked: the operator chooses it, and the screen never changes it by itself. A new choice starts the
  // walk over in the new queue.
  const [mode, setMode] = useState<Queue['mode']>('unsure');
  // The kind the queue is narrowed to, a codebook key; '' is every kind.
  const [kind, setKind] = useState('');
  const walk = useQueue(mode, kind || undefined, shown);
  const photo = useImageUrl(walk.item?.view.sha256 ?? null);
  const onMode = (chosen: Queue['mode']): void => setMode(chosen);
  const onKind = (chosen: string): void => setKind(chosen);
  // Whether a mark is out: the bar's presses are `aria-busy` while one is. A skip then would end the batch before the engine
  // has the mark, and the next batch would serve the marked area again with its presses on, a second press writing a second
  // row. So a skip waits, as every other press does, until the answer is in.
  const markIsOut = (): boolean => hostWindow.document.querySelector('[data-mark-screen] [data-mark-bar] [data-mark-press][aria-busy="true"]') !== null;
  const onSkip = (): void => {
    if (!markIsOut()) walk.next(null);
  };
  const onMarked = (region: Region): void => walk.next(region);

  // The latest skip, for the key listener: it is attached once per `shown`, and a skip made from a stale walk would
  // move from the wrong place. A ref written after each render: nothing draws from it.
  const skipRef = useRef(onSkip);
  const hasAreaRef = useRef(walk.item !== null);
  useEffect(() => {
    skipRef.current = onSkip;
    hasAreaRef.current = walk.item !== null;
  });

  useEffect(() => {
    if (!shown) return undefined;
    const onKey = (event: KeyboardEvent) => {
      // A synthetic keydown (a browser's autofill sends them) can carry no key.
      const press = typeof event.key === 'string' ? PRESS_OF_KEY[event.key.toLowerCase()] : undefined;
      if (press === undefined || event.metaKey || event.ctrlKey || event.altKey || event.repeat || event.defaultPrevented) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest(TAKES_THE_KEYBOARD) || hostWindow.document.querySelector(OWNS_THE_KEYBOARD)) return;
      if (!hasAreaRef.current) return;
      event.preventDefault();
      if (press === 'skip') {
        skipRef.current();
        return;
      }
      hostWindow.document.querySelector<HTMLElement>(`[data-mark-screen] [data-mark-press="${press}"]`)?.click();
    };
    hostWindow.addEventListener('keydown', onKey);
    return () => hostWindow.removeEventListener('keydown', onKey);
  }, [shown, hostWindow]);

  return (
    <MarkQueue
      codebook={codebook}
      mode={mode}
      kind={kind}
      walk={walk}
      photo={photo}
      onMode={onMode}
      onKind={onKind}
      onSkip={onSkip}
      onMarked={onMarked}
    />
  );
}
