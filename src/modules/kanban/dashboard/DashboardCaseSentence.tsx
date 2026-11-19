import { useId, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useHostWindow } from '@/shared/context/HostWindowContext';
import { Button, FoldChevron } from '@/shared/ui';
import { cn, resizeObserverIn } from '@/shared/utils';

/**
 * ONE CASE'S SENTENCE, HELD TO THREE LINES. A case promises something in the words it was written in, and those words
 * run to a paragraph (234 to 491 characters on the live store, 2026-11-19). Five of them whole put the rows that wait
 * on a person a screen and a half down a phone, so each is cut at three lines and its whole is one press away, under
 * the sentence it opens.
 *
 * THE PRESS IS DRAWN ONLY WHERE SOMETHING IS CUT. Whether three lines hold the sentence depends on the column's width,
 * so it is measured (the sentence's own box, again whenever that box changes) and never guessed from a count of
 * characters: a press that opens nothing is a control that lies. 44 px under a finger.
 */

type DashboardCaseSentenceProps = {
  /** The case's sentence, as the case was written. */
  sentence: string;
};

/** Rendered by DashboardCases, once per case it lists. Nothing else mounts it. */
export function DashboardCaseSentence({ sentence }: DashboardCaseSentenceProps) {
  const { t } = useTranslation();
  const hostWindow = useHostWindow();
  const textId = useId();
  const textRef = useRef<HTMLParagraphElement | null>(null);
  // Whether the reader opened the whole sentence. The row's own, and shut on every mount: three lines are the default.
  const [whole, setWhole] = useState(false);
  // Whether three lines cut the sentence at this width: measured, because it is what decides that the press is drawn.
  const [cut, setCut] = useState(false);

  useLayoutEffect(() => {
    const text = textRef.current;
    if (text === null || whole) return undefined;
    const measure = () => setCut(text.scrollHeight > text.clientHeight + 1);
    measure();
    const observer = resizeObserverIn(hostWindow, measure);
    observer?.observe(text);
    return () => observer?.disconnect();
  }, [hostWindow, sentence, whole]);

  return (
    <div className="flex min-w-0 flex-col items-start" data-case-sentence={whole ? 'whole' : cut ? 'cut' : 'fits'}>
      <p id={textId} ref={textRef} className={cn('break-words text-sm leading-snug text-foreground', !whole && 'line-clamp-3')}>
        {sentence}
      </p>
      {(cut || whole) && (
        <Button variant="ghost" size="sm" className="-ml-3 finger:h-11" aria-expanded={whole} aria-controls={textId} onClick={() => setWhole((open) => !open)}>
          <FoldChevron collapsed={!whole} />
          {whole ? t('kanban.dashboard.cases.sentenceLess') : t('kanban.dashboard.cases.sentenceWhole')}
        </Button>
      )}
    </div>
  );
}
