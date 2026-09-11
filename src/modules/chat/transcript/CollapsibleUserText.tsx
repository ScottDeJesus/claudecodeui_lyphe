import { useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDownIcon } from 'lucide-react';

import { useIsExportingTranscript } from '@/modules/chat/context/TranscriptRenderContext';

/** Height a long turn folds to. */
const FOLDED_PX = 240;
/** Only fold what is clearly long: folding a turn that is one line over hides one line. */
const FOLD_OVER_PX = 320;

/**
 * Remembers which turns the reader opened, by anchor. The transcript unmounts rows far from
 * the viewport; state kept in the component would fold an opened turn again on the way back,
 * and the row would come back shorter than the placeholder that stood in for it.
 */
const openedTurns = new Set<string>();

type CollapsibleUserTextProps = {
  turnKey: string;
  children: ReactNode;
};

/**
 * Used by MessageComponent to fold a long operator turn down to its first lines, with a
 * fade at the fold and a toggle under it. Short turns render untouched, and an exported
 * transcript always shows every turn in full — a document has nothing to click.
 */
export default function CollapsibleUserText({ turnKey, children }: CollapsibleUserTextProps) {
  const { t } = useTranslation('chat');
  const isExporting = useIsExportingTranscript();
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [isLong, setIsLong] = useState(false);
  const [isOpen, setIsOpen] = useState(() => openedTurns.has(turnKey));

  useLayoutEffect(() => {
    const element = contentRef.current;
    if (!element) return undefined;
    const measure = () => setIsLong(element.scrollHeight > FOLD_OVER_PX);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const isFolded = isLong && !isOpen && !isExporting;

  const toggle = () => {
    const next = !isOpen;
    if (next) openedTurns.add(turnKey);
    else openedTurns.delete(turnKey);
    setIsOpen(next);
  };

  return (
    <>
      <div
        className="overflow-hidden"
        style={isFolded ? {
          maxHeight: FOLDED_PX,
          maskImage: 'linear-gradient(to bottom, black 65%, transparent)',
          WebkitMaskImage: 'linear-gradient(to bottom, black 65%, transparent)',
        } : undefined}
      >
        <div ref={contentRef}>{children}</div>
      </div>
      {isLong && !isExporting && (
        <button
          type="button"
          onClick={toggle}
          aria-expanded={isOpen}
          className="mt-1 inline-flex items-center gap-1 rounded text-xs font-medium text-accent-ink hover:underline"
        >
          {isOpen ? t('message.showLess') : t('message.showMore')}
          <ChevronDownIcon className={`h-3.5 w-3.5 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        </button>
      )}
    </>
  );
}
