import {
  BookMarkedIcon,
  CheckIcon,
  ChevronDownIcon,
  ClipboardListIcon,
  GlobeIcon,
  ScrollTextIcon,
  StickyNoteIcon,
  XIcon,
  type LucideIcon,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { api } from '@/shared/api';
import type { MemoryCandidateFull, MemoryCandidateLean, MemoryCandidateRead } from '@/shared/types';
import { Badge, Button, Card, Spinner } from '@/shared/ui';
import { cn } from '@/shared/utils';

type MemoryCandidateRowProps = {
  candidate: MemoryCandidateLean;
  /** The refusal to show: this tab's freshest one, or the copy Descent recorded on the row. */
  refusal: string | null;
  busy: boolean;
  onReview: (id: string, approve: boolean) => void;
};

/**
 * Where each memory wants to land, as a glyph.
 *
 * The five targets are five different destinations and the words for them are long
 * ("your REQUIREMENTS.md shelf"), so the shape is what a person sorts the queue by at a
 * glance — a globe for the one that reaches everywhere, a scroll and a clipboard for the
 * two shelves, a bookmark and a note for the two memory files.
 */
const TARGET_ICONS: Record<string, LucideIcon> = {
  memory: BookMarkedIcon,
  topic: StickyNoteIcon,
  rules: ScrollTextIcon,
  requirements: ClipboardListIcon,
  claude: GlobeIcon,
};

/**
 * One proposed memory, as a card a person can decide on — and, once expanded, read whole.
 *
 * The list is LEAN by design: it carries no body, so the full text is fetched for the ONE card
 * that was opened rather than for all hundred. Every string here is operator-authored free
 * text and reaches the DOM as a text node; the body often LOOKS like markdown and is still
 * shown as what it is, which is how Descent's own panel draws it.
 *
 * There is no confirmation dialog before filing. Expanding to read IS the deliberate step, and
 * the amber `global` badge is the guard on the one target that reaches every session.
 */
export function MemoryCandidateRow({ candidate, refusal, busy, onReview }: MemoryCandidateRowProps) {
  const { t } = useTranslation();

  // Whether this card is open. Local because it is one person's place in one list — nothing
  // outside the row acts on it, and lifting it would re-render the whole queue on a click.
  const [expanded, setExpanded] = useState(false);
  // The whole memory, once read. Three states, and they are three different sentences:
  // `undefined` is "never asked" (so the next expand retries), `null` is Descent saying no row
  // carries this id, and an object is the text itself.
  const [full, setFull] = useState<MemoryCandidateFull | null | undefined>(undefined);
  // True while the by-id read is in flight, so the card says it is reading rather than looking
  // empty for as long as the request takes.
  const [reading, setReading] = useState(false);
  // Set when the read could not be made at all. Kept apart from `full` so the card can say so
  // in words while still counting as "never asked" — the next expand tries again.
  const [readFailed, setReadFailed] = useState(false);

  // The open flag read synchronously after an await: a read that lands for a card the person
  // closed meanwhile must be dropped, not painted into a collapsed row.
  const expandedRef = useRef(false);
  // Mount flag: a read that resolves after the queue was replaced must not set state.
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const toggle = useCallback(() => {
    const opening = !expandedRef.current;
    expandedRef.current = opening;
    setExpanded(opening);
    // Collapsing keeps whatever was read: the text of a pending memory does not change while
    // it waits, so re-opening should be instant rather than another request.
    if (!opening || full !== undefined || reading) return;

    setReading(true);
    setReadFailed(false);
    void (async () => {
      try {
        const response = await api.descent.memory.candidate(candidate.id);
        const answer = (await response.json()) as MemoryCandidateRead;
        if (!expandedRef.current || !mountedRef.current) return;
        if (answer.reachable) setFull(answer.candidate);
        else setReadFailed(true);
      } catch {
        if (expandedRef.current && mountedRef.current) setReadFailed(true);
      } finally {
        if (mountedRef.current) setReading(false);
      }
    })();
  }, [candidate.id, full, reading]);

  const onHeadingKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    toggle();
  };

  // Plain English for where this memory wants to land. An unknown sixth target renders as its
  // own raw word — blank would be worse than untranslated.
  const targetWords = t(`memory.target.${candidate.target}`, { defaultValue: candidate.target });
  const TargetIcon = TARGET_ICONS[candidate.target] ?? StickyNoteIcon;

  // A card reviewed elsewhere reads WHOLE: Descent's by-id read has no status filter
  // (store_memory.py:343-349), so a full read can land carrying `approved` or `rejected` rather
  // than a null. That is the same news as no-such-id — this memory is no longer waiting — so it
  // gets the same words in place of the body. The buttons stay: a press answers 422 in Descent's
  // own text through the refusal path, and the next refresh drops the row.
  const noLongerPending = full === null || (full !== undefined && full.status !== 'pending');

  return (
    <li data-candidate-id={candidate.id}>
      <Card>
        <div
          role="button"
          tabIndex={0}
          aria-expanded={expanded}
          title={t('memory.expand')}
          onClick={toggle}
          onKeyDown={onHeadingKeyDown}
          className="flex cursor-pointer items-start gap-3 px-4 pb-3 pt-4"
        >
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-primary/25 bg-primary/10 text-primary">
            <TargetIcon className="h-4 w-4" />
          </span>

          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium">{candidate.name}</span>
              {/* The blast tag: the global file reaches every session in every project and takes
                  no size cap, so it can never be filed by reflex. */}
              {candidate.target === 'claude' && (
                <Badge tone="warn" title={t('memory.blast.title')}>
                  {t('memory.blast.label')}
                </Badge>
              )}
            </span>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              {candidate.project ? `${targetWords} · ${candidate.project}` : targetWords}
            </span>
          </span>

          {/* The one glyph that is state rather than category: which way it points is the only
              thing on the card saying whether the body below is open. */}
          <ChevronDownIcon
            aria-hidden="true"
            className={cn(
              'mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200',
              expanded && 'rotate-180',
            )}
          />
        </div>

        {refusal && <p className="px-4 pb-3 text-xs text-muted-foreground">{refusal}</p>}

        {expanded && (
          // The memory's own text, inset on its own surface: the body is what the card is
          // ABOUT, and a plain divider leaves it looking like more chrome.
          <div className="mx-4 mb-3 rounded-xl border border-border bg-muted/50 p-3">
            {reading && <Spinner size={20} label={t('memory.reading')} />}
            {!reading && readFailed && <p className="text-xs text-muted-foreground">{t('memory.unreachable')}</p>}
            {!reading && !readFailed && noLongerPending && (
              <p className="text-xs text-muted-foreground">{t('memory.gone')}</p>
            )}
            {!reading && full && !noLongerPending && (
              <>
                <pre className="whitespace-pre-wrap text-xs">{full.body}</pre>
                {full.rationale && (
                  <p className="mt-2 text-xs text-muted-foreground">{`${t('memory.rationale')}: ${full.rationale}`}</p>
                )}
                {full.indexLine && (
                  <p className="mt-1 text-xs text-muted-foreground">{`${t('memory.indexLine')}: ${full.indexLine}`}</p>
                )}
              </>
            )}
          </div>
        )}

        {/* No rule above the actions: a divider there splits one card into two stacked boxes,
            and the queue is a column of seven of them. */}
        <div className="flex gap-2 px-4 pb-4">
          <Button
            size="sm"
            variant="default"
            disabled={busy}
            title={t('memory.actions.fileTitle')}
            onClick={() => onReview(candidate.id, true)}
          >
            <CheckIcon aria-hidden="true" />
            {t('memory.actions.file')}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            title={t('memory.actions.discardTitle')}
            onClick={() => onReview(candidate.id, false)}
          >
            <XIcon aria-hidden="true" />
            {t('memory.actions.discard')}
          </Button>
        </div>
      </Card>
    </li>
  );
}
