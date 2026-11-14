import { ChevronRightIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { RunRow } from '@/modules/upload-runs/RunRow';
import type { RunFriction } from '@/modules/upload-runs/utils/uploadsModel';
import { agoWord, typeWord } from '@/modules/upload-runs/utils/uploadsWords';
import { trendMark } from '@/shared/trend';
import type { UploadRunSummary, UploadTypeCounts } from '@/shared/upload-runs-types';
import { Badge, CardFoldBody, Collapsible, CollapsibleTrigger } from '@/shared/ui';


type UploadTypeListProps = {
  /** Both types' counts, as the overview carries them: Initial then Final, always both. */
  types: UploadTypeCounts[];
  /** The window's runs, newest first; a type opens to its own. */
  runs: UploadRunSummary[];
  /** Per type, whether one of its runs carries a friction row a landed heal's shape came back in. */
  regression: Record<'initial' | 'final', boolean>;
  /** The heal answer per Claude session, for the rows a type opens to; null while it is out or could not be read. */
  friction: Map<string, RunFriction> | null;
  /** The heal answer could not be read: no regression can be marked, and the list says so under its rows. */
  frictionFailed: boolean;
  now: number;
  onOpenRun: (sessionId: string) => void;
};

/** How many of a type's runs it opens to; the rest are in the Runs list beside it. */
const OPEN_ROWS = 6;

/**
 * BY UPLOAD TYPE: Initial upload and Final upload, each one row in the heal tab's kind-row anatomy, so the two tabs read
 * the same way. Both rows always stand. A type with no run says so in a neutral badge at the row's full ink: that phrase
 * is all such a row says, so it is never dimmed (a dimmed row measured 2.24:1 in light).
 *
 * A ROW, left to right: the chevron, the type's name, "N clean" in the positive tone, "N hiccups" (amber, and red only
 * once the hiccups outnumber the clean runs, so red means the type is failing more often than not, whatever the window),
 * "running" while the live run is of this type, the trend of its hiccups over the last seven days against the seven
 * before (the shared `trendMark`: a glyph and a word, a dash and "no trend" when there is no earlier week), and the
 * regression mark when a stumble a heal had already fixed came back in one of this type's runs. The whole row is the
 * press, at least 44 px tall. Both rows start closed, so the two types and How often under them are read in one glance:
 * the regression is said on the row itself, in red, and needs no opening to be seen.
 *
 * It opens to the type's runs, the hiccups first and each group newest first, since a type is opened to see what went
 * wrong with it. Each is the same row the Runs list draws and a press that opens its sheet. The regression mark's own
 * hint says where the stumble itself is named: in a run's sheet, under The agent's own friction, on the row that came back.
 *
 * A CLOSED TYPE IS OUT OF REACH, not only out of sight: its body is the kit's `CardFoldBody`, which takes the folded rows
 * out of the Tab order and the accessibility tree. A bare fold only clips, and each type holds up to six run presses
 * from the start, so a keyboard reader would walk twelve buttons nobody can see.
 *
 * NOT READ IS NEVER NONE. When the heal ledger could not be read no regression can be marked, so the list says that under
 * its rows: two rows with no red mark must not read as "nothing came back".
 *
 * Used by this module's `UploadsBody`, at the top of the left column.
 */
export function UploadTypeList({ types, runs, regression, friction, frictionFailed, now, onOpenRun }: UploadTypeListProps) {
  const { t } = useTranslation();
  const k = 'cerberus.uploads.types';

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <ul className="flex min-w-0 flex-col gap-2" data-uploads-types>
        {types.map((row) => {
          const name = typeWord(t, row.upload_type);
          const ofType = runs.filter((run) => run.upload_type === row.upload_type && !run.dry_run);
          const own = [...ofType.filter((run) => run.verdict === 'hiccup'), ...ofType.filter((run) => run.verdict !== 'hiccup')];
          const quiet = row.clean + row.hiccups + row.live === 0;
          const trend = trendMark(row.trend);
          const returned = regression[row.upload_type];
          return (
            <li key={row.upload_type} className="min-w-0 rounded-lg border border-border" data-uploads-type={row.upload_type}>
              <Collapsible className="min-w-0">
                <CollapsibleTrigger
                  className="group flex min-h-11 w-full min-w-0 flex-wrap items-center gap-2 rounded-lg px-3 py-2 text-left hover:bg-muted"
                  aria-label={t(`${k}.toggle`, { type: name })}
                >
                  <ChevronRightIcon className="h-4 w-4 flex-none text-muted-foreground transition-transform duration-200 group-data-[state=open]:rotate-90" aria-hidden="true" />
                  <span className="text-sm font-medium">{name}</span>
                  {quiet ? (
                    <Badge as="span" tone="neutral">{t(`${k}.none`)}</Badge>
                  ) : (
                    <>
                      <Badge as="span" tone="positive">{t(`${k}.clean`, { count: row.clean })}</Badge>
                      {row.hiccups > 0 && <Badge as="span" tone={row.hiccups > row.clean ? 'danger' : 'warn'}>{t(`${k}.hiccups`, { count: row.hiccups })}</Badge>}
                      {row.live === 1 && <Badge as="span" tone="info">{t(`${k}.running`)}</Badge>}
                      <Badge as="span" tone={trend.tone} title={t(`${k}.trendTitle`)}>
                        <span aria-hidden="true">{trend.glyph}</span>&nbsp;{trend.word}
                      </Badge>
                    </>
                  )}
                  {returned && <Badge as="span" tone="danger" className="min-w-0 break-words" title={t(`${k}.regressionTitle`)}>{t(`${k}.regression`)}</Badge>}
                  {row.last_at !== null && <span className="ml-auto flex-none text-xs text-muted-foreground">{t(`${k}.last`, { ago: agoWord(t, row.last_at, now) })}</span>}
                </CollapsibleTrigger>
                <CardFoldBody className="min-w-0">
                  {own.length === 0 ? (
                    <p className="border-t border-border px-3 py-2 text-xs text-muted-foreground">{t(`${k}.noRuns`)}</p>
                  ) : (
                    <>
                      <ul className="flex min-w-0 flex-col divide-y divide-border border-t border-border">
                        {own.slice(0, OPEN_ROWS).map((run) => (
                          <RunRow key={run.session_id} run={run} friction={run.claude_session_id === null ? undefined : friction?.get(run.claude_session_id)} now={now} onOpenRun={onOpenRun} />
                        ))}
                      </ul>
                      {own.length > OPEN_ROWS && (
                        <p className="border-t border-border px-3 py-2 text-xs text-muted-foreground">{t(`${k}.moreInRuns`, { count: own.length - OPEN_ROWS })}</p>
                      )}
                    </>
                  )}
                </CardFoldBody>
              </Collapsible>
            </li>
          );
        })}
      </ul>
      {frictionFailed && <p className="m-0 text-xs text-muted-foreground" data-uploads-types-unread>{t(`${k}.regressionUnread`)}</p>}
    </div>
  );
}
