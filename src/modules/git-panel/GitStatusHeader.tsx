import { RefreshCw } from 'lucide-react';

import { Badge, Button, Chip } from '@/shared/ui';
import type { Tone, UpstreamPosition } from '@/shared/types';

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
 * How far ahead of the upstream this branch is, said in words.
 *
 * "We don't know" never looks like zero. Without an upstream, or without an answer from the
 * read at all, the badge carries the em dash and says WHICH, because "0 not pushed", "nothing
 * committed", "no tracking ref" and "the read failed" are four different facts and only one
 * of them is good news. A failed read is the one that is an error, so it alone is amber.
 */
function describeUpstream(upstream: UpstreamPosition): { tone: Tone; label: string } {
  switch (upstream.kind) {
    case 'unread':
      return { tone: 'warn', label: "— Couldn't read upstream" };
    case 'no-commits':
      return { tone: 'neutral', label: '— No commits yet' };
    case 'no-upstream':
      return { tone: 'neutral', label: '— No upstream yet' };
    case 'tracked':
      if (upstream.ahead === 0) {
        return { tone: 'positive', label: '✓ Everything is pushed' };
      }
      return { tone: 'info', label: `${upstream.ahead} of yours ${upstream.ahead === 1 ? 'is' : 'are'} not pushed` };
  }
}

/**
 * Rendered by GitPanel above its tabs: which branch, how it stands against the upstream, and
 * who does the committing.
 *
 * The branch is an inert Chip rather than a button because switching branches is not
 * something this panel does any more — a token that takes focus and then does nothing is
 * worse than a label. The only control here is the read it can repeat.
 */
export default function GitStatusHeader({ branch, upstream, loading, onRefresh }: GitStatusHeaderProps) {
  const position = describeUpstream(upstream);

  return (
    <div className="flex flex-none flex-wrap items-center gap-2.5 px-4 py-3">
      <Chip selected>{branch}</Chip>

      {/* GitPanel draws nothing until the first read lands, so this is always a landed
          answer — and a refresh keeps the previous one on screen rather than blinking it out. */}
      <Badge tone={position.tone}>{position.label}</Badge>

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
