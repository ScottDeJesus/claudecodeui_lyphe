import { ChevronRightIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { EntryRow } from '@/modules/scheduling-report/EntryRow';
import { agoWord } from '@/modules/scheduling-report/utils/schedulingWords';
import type { SchedulingEntry, SchedulingKindCounts } from '@/shared/scheduling-report-types';
import { trendMark } from '@/shared/trend';
import { Badge, CardFoldBody, Collapsible, CollapsibleTrigger } from '@/shared/ui';

type SchedulingKindListProps = {
  /** The three kinds' counts, as the overview carries them: book, change, cancel, always all three. */
  kinds: SchedulingKindCounts[];
  /** The window's entries, newest first; a kind opens to its own. */
  entries: SchedulingEntry[];
  /** The clock each kind's last session is aged against, epoch ms. */
  now: number;
  onOpenEntry: (id: string) => void;
};

/** How many of a kind's sessions it opens to; the rest are in the Sessions list beside it. */
const OPEN_ROWS = 6;

/**
 * BY WHAT WAS DONE: Book a visit, Change a visit and Cancel a visit, each one row in the heal tab's kind-row anatomy, so
 * the tabs read the same way. All three rows always stand. A kind with no session says so in a neutral badge at the row's
 * full ink: that phrase is all such a row says, so it is never dimmed.
 *
 * A ROW, left to right: the chevron, the kind's name, "N clean" in the positive tone, "N speed bumps" (amber, and red
 * only once the bumps outnumber the clean sessions, so red means the kind is going wrong more often than not, whatever
 * the window), the trend of its bumps over the last seven days against the seven before (the shared `trendMark`: a glyph
 * and a word, a dash and "no trend" when there is no earlier week), and when its last session was. The whole row is the
 * press, at least 44 px tall. All three start closed, so the three kinds and How often under them are read in one glance.
 *
 * It opens to the kind's sessions, the speed bumps first and each group newest first, since a kind is opened to see what
 * went wrong with it. Each is the same row the Sessions list draws and a press that opens its sheet. PEOPLE's sessions
 * only, whether or not machine calls are listed: the row's counts leave a machine's out, and the rows it opens to must be
 * the ones it counted.
 *
 * A CLOSED KIND IS OUT OF REACH, not only out of sight: its body is the kit's `CardFoldBody`, which takes the folded rows
 * out of the Tab order and the accessibility tree.
 *
 * Used by this module's `SchedulingBody`, at the top of the left column.
 */
export function SchedulingKindList({ kinds, entries, now, onOpenEntry }: SchedulingKindListProps) {
  const { t } = useTranslation();
  const k = 'cerberus.scheduling.kinds';

  return (
    <ul className="flex min-w-0 flex-col gap-2" data-scheduling-kinds>
      {kinds.map((row) => {
        const name = t(`cerberus.scheduling.kind.${row.kind}`);
        const ofKind = entries.filter((entry) => entry.kind === row.kind && entry.actor_kind === 'person');
        const own = [...ofKind.filter((entry) => entry.verdict === 'hiccup'), ...ofKind.filter((entry) => entry.verdict !== 'hiccup')];
        const quiet = row.clean + row.hiccups === 0;
        const trend = trendMark(row.trend);
        return (
          <li key={row.kind} className="min-w-0 rounded-lg border border-border" data-scheduling-kind={row.kind}>
            <Collapsible className="min-w-0">
              <CollapsibleTrigger
                className="group flex min-h-11 w-full min-w-0 flex-wrap items-center gap-2 rounded-lg px-3 py-2 text-left hover:bg-muted"
                aria-label={t(`${k}.toggle`, { kind: name })}
              >
                <ChevronRightIcon className="h-4 w-4 flex-none text-muted-foreground transition-transform duration-200 group-data-[state=open]:rotate-90" aria-hidden="true" />
                <span className="text-sm font-medium">{name}</span>
                {quiet ? (
                  <Badge as="span" tone="neutral">{t(`${k}.none`)}</Badge>
                ) : (
                  <>
                    <Badge as="span" tone="positive">{t(`${k}.clean`, { count: row.clean })}</Badge>
                    {row.hiccups > 0 && <Badge as="span" tone={row.hiccups > row.clean ? 'danger' : 'warn'}>{t(`${k}.bumps`, { count: row.hiccups })}</Badge>}
                    <Badge as="span" tone={trend.tone} title={t(`${k}.trendTitle`)}>
                      <span aria-hidden="true">{trend.glyph}</span>&nbsp;{trend.word}
                    </Badge>
                  </>
                )}
                {row.last_at !== null && <span className="ml-auto flex-none text-xs text-muted-foreground">{t(`${k}.last`, { ago: agoWord(t, row.last_at, now) })}</span>}
              </CollapsibleTrigger>
              <CardFoldBody className="min-w-0">
                {own.length === 0 ? (
                  <p className="border-t border-border px-3 py-2 text-xs text-muted-foreground">{t(`${k}.noSessions`)}</p>
                ) : (
                  <>
                    <ul className="flex min-w-0 flex-col divide-y divide-border border-t border-border">
                      {own.slice(0, OPEN_ROWS).map((entry) => <EntryRow key={entry.id} entry={entry} onOpenEntry={onOpenEntry} />)}
                    </ul>
                    {own.length > OPEN_ROWS && (
                      <p className="border-t border-border px-3 py-2 text-xs text-muted-foreground">{t(`${k}.moreInSessions`, { count: own.length - OPEN_ROWS })}</p>
                    )}
                  </>
                )}
              </CardFoldBody>
            </Collapsible>
          </li>
        );
      })}
    </ul>
  );
}
