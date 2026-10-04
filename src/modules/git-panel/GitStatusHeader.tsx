import { RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Badge, Button, Chip } from '@/shared/ui';
import type { Tone, UpstreamPosition } from '@/shared/types';
import { describeLastPush } from '@/modules/git-panel/utils/gitPanelUtils';

type GitStatusHeaderProps = {
  branch: string;
  /**
   * Decided once by GitPanel from the server's own flags and shared with the Changes view, so
   * the badge and the body cannot disagree about whether there is an upstream.
   */
  upstream: UpstreamPosition;
  loading: boolean;
  onRefresh: () => void;
};

/**
 * How far ahead of the upstream this branch is, said in words — or null when it tracks its
 * upstream with nothing ahead, the one position that needs no badge at all.
 *
 * "We don't know" never looks like zero. Without an upstream, or without an answer from the
 * read at all, the badge carries the em dash and says WHICH, because "nothing committed", "no
 * tracking ref" and "the read failed" are three different facts, and a missing badge must only
 * ever mean the good one. A failed read is the one that is an error, so it alone is amber.
 */
function describeUpstream(upstream: UpstreamPosition): { tone: Tone; label: string } | null {
  switch (upstream.kind) {
    case 'unread':
      return { tone: 'warn', label: "— Couldn't read upstream" };
    case 'no-commits':
      return { tone: 'neutral', label: '— No commits yet' };
    case 'no-upstream':
      return { tone: 'neutral', label: '— No upstream yet' };
    case 'tracked':
      if (upstream.ahead === 0) return null;
      return { tone: 'info', label: `${upstream.ahead} of yours ${upstream.ahead === 1 ? 'is' : 'are'} not pushed` };
  }
}

/**
 * Rendered by GitPanel above its tabs: which branch, how it stands against the upstream, when it
 * was last pushed from here, and who does the committing.
 *
 * The branch is an inert Chip rather than a button because switching branches is not
 * something this panel does any more — a token that takes focus and then does nothing is
 * worse than a label. The only control here is the read it can repeat.
 */
export default function GitStatusHeader({ branch, upstream, loading, onRefresh }: GitStatusHeaderProps) {
  const { t, i18n } = useTranslation();

  const position = describeUpstream(upstream);
  // Null for every kind of upstream but `tracked`: a branch that tracks nothing has no push to
  // report, and the badge beside this one already says why.
  const lastPush = describeLastPush(upstream, t, i18n.language);
  // The age the line shows is read once per render, so a panel left open drifts out of date the
  // way any "2 hours ago" does — and the next refresh, or the read a finished push triggers,
  // corrects it. The title's full timestamp stays exact either way.

  return (
    <div className="flex flex-none flex-wrap items-center gap-2.5 px-4 py-3">
      <Chip selected>{branch}</Chip>

      {/* GitPanel draws nothing until the first read lands, so this is always a landed
          answer — and a refresh keeps the previous one on screen rather than blinking it out. */}
      {position && <Badge tone={position.tone}>{position.label}</Badge>}

      {/* Beside the ahead line, because it answers the other half of the same question: how much
          is waiting, and when the last of it went up. */}
      {lastPush && <Badge tone="neutral" title={lastPush.title}>{lastPush.label}</Badge>}

      <span className="ml-auto text-xs text-ink-faint">
        Claude handles commits and pushes for this project
      </span>

      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8"
        aria-label="Refresh source control"
        disabled={loading}
        onClick={onRefresh}
      >
        <RefreshCw className={loading ? 'animate-spin' : undefined} />
      </Button>
    </div>
  );
}
