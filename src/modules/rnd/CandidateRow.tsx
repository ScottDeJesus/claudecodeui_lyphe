import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';

import { hostOf, statusOf } from '@/modules/rnd/rndWords';
import type { RndCandidate } from '@/shared/rnd-types';
import { Badge } from '@/shared/ui';
import { cn, formatRelativeTime } from '@/shared/utils';

type CandidateRowProps = {
  candidate: RndCandidate;
  /** Its Opening is out: the row stays lit while he reads. */
  open: boolean;
  /** A press on the row: opens it, or folds it back when it is the one already open. */
  onOpen: () => void;
  /** The row's node, for its Opening to hang from. */
  rowRef: (node: HTMLButtonElement | null) => void;
};

/**
 * ONE CANDIDATE AS A LINE: what it is, the host it was found on, how long ago it was filed (while a spike is out, how long
 * that spike has been out instead: one that never answers shows only by its age; while Opus places it, how long that has run), and where it stands. The whole row is
 * the press, a thumb high, and everything else about it is one press away in its Opening.
 *
 * THE ROW KEEPS ITS OPENING (data-ast-keeps-opening): a press on another row turns the Opening to that one without folding it
 * back first, so he reads down a list one press at a time.
 *
 * Rendered by RndPanel, one for each candidate of the view it shows.
 */
export function CandidateRow({ candidate, open, onOpen, rowRef }: CandidateRowProps) {
  const { t } = useTranslation();
  const status = statusOf(candidate);
  return (
    <li className="border-b border-border last:border-b-0">
      <button
        ref={rowRef}
        type="button"
        className={cn('flex min-h-14 w-full items-center gap-3 rounded-md px-3 py-2.5 text-left hover:bg-muted', open && 'bg-muted')}
        aria-expanded={open}
        data-ast-keeps-opening=""
        data-rnd-candidate={candidate.name}
        data-rnd-word={candidate.word}
        onClick={onOpen}
      >
        <span className="min-w-0 flex-1">
          <span className="line-clamp-2 text-sm font-medium text-foreground">{candidate.title}</span>
          <span className="mt-0.5 block truncate text-xs text-muted-foreground">
            {metaOf(candidate, t)}
          </span>
        </span>
        <Badge as="span" tone={status.tone} className="flex-none">
          {t('rnd.word.' + status.word)}
        </Badge>
      </button>
    </li>
  );
}

/** The row's second line: how long Opus has been placing it, or a spike has been out, else how long ago it was filed. */
function metaOf(candidate: RndCandidate, t: TFunction): string {
  const host = hostOf(candidate.source_url);
  if (candidate.placing?.state === 'out' && candidate.placing.at !== null) return t('rnd.row.placing', { host, age: formatRelativeTime(candidate.placing.at) });
  if (candidate.word === 'spiking' && candidate.spike !== null) return t('rnd.row.spiking', { host, age: formatRelativeTime(candidate.spike.started_at) });
  return t('rnd.row.meta', { host, age: formatRelativeTime(candidate.filed_at) });
}
