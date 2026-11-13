import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { eventLines } from '@/modules/upload-runs/utils/uploadsWords';
import type { UploadRunEvent } from '@/shared/upload-runs-types';
import { Badge, Button, Timeline } from '@/shared/ui';

type RunEventsProps = {
  /** The page of events on screen, in order. */
  events: UploadRunEvent[];
  /** How many events the run holds in all, as its counts say. */
  total: number;
  /** Older events were not asked for yet. */
  hasEarlier: boolean;
  /** The run is live and its stream is open: the feed grows at its foot. */
  live: boolean;
  /** The run was read back from disk: the answers a person typed and the server's own notes were never kept. */
  imported: boolean;
  onShowEarlier: () => void;
};

/**
 * INSIDE THE RUN: every event in order, oldest at the top, each one readable line in the shared Timeline: who spoke (the
 * agent, a tool by its name, the person who answered, the server), what was said or done, and its clock to the second. A
 * line opens to the whole of what it carried.
 *
 * WHAT A LINE IS. The brief is one folded line that opens to its text. A tool call is one line with its result folded
 * into it: its one-line summary, then whether it worked and what came back, amber when it failed. A question the run
 * stopped on is amber, and the answer typed is its own line under the name of who typed it. Quiet spells, rate limits,
 * stream trouble, state changes and the ending each say what happened in a sentence. A kind this screen has no words for
 * is a neutral line under its own name. Everything the agent, a tool or a person wrote is text, never markup.
 *
 * A PANE OF ITS OWN, with its own scroll and a ceiling on its height, so a run of fifteen hundred events does not push
 * the flow, the confirmation and the friction out of reach below it. The newest 500 are read first; Show earlier, at the
 * pane's top where the older lines will arrive, asks for the page before. The same press stands beside the sentence
 * over the pane ("The newest 500 of 1,500 events"), since the pane rests at its foot and its top can be forty screens
 * of scrolling away: the sentence that says there is more is where the way to it belongs.
 *
 * IT OPENS AT ITS FOOT, the newest line: the ending of a run that is over, the line just written of one that is live.
 * That is the pane's own layout and no script: it is a reversed column around one block in reading order, and a reversed
 * column rests at its end. So a run of 1,500 events opens on how it ended, never on event 1,001, and a page that Show
 * earlier puts above leaves the reader's line where it was.
 *
 * THE OPEN LINE IS REMEMBERED BY ITS EVENT, never by its place. The Timeline keeps a position, and positions move here:
 * Show earlier puts a page above, a live run adds lines below, and a result arriving folds into its call's line. So this
 * holds the open event's id and hands the Timeline the place that event stands at now.
 *
 * Used by this module's `RunSheet`, as its second section, keyed by the run so another run's feed starts with no line open.
 */
export function RunEvents({ events, total, hasEarlier, live, imported, onShowEarlier }: RunEventsProps) {
  const { t } = useTranslation();
  const e = 'cerberus.uploads.sheet.events';
  const lines = useMemo(() => eventLines(t, events), [t, events]);
  // The event whose line is open, by its id; null with none open. Held here, since the Timeline can only keep a position and this feed's positions move.
  const [openId, setOpenId] = useState<string | null>(null);
  const openAt = openId === null ? -1 : lines.findIndex((line) => line.id === openId);

  return (
    <div className="flex min-w-0 flex-col gap-2.5" data-uploads-events={events.length}>
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
        <span>{hasEarlier ? t(`${e}.showing`, { shown: events.length.toLocaleString(), total: total.toLocaleString() }) : t(`${e}.count`, { count: Math.max(total, events.length) })}</span>
        {hasEarlier && (
          <Button variant="outline" size="sm" className="h-7 px-2.5 text-xs finger:h-11" onClick={onShowEarlier} data-uploads-show-earlier="head">
            {t(`${e}.showEarlier`)}
          </Button>
        )}
        {live && <Badge as="span" tone="info">{t(`${e}.following`)}</Badge>}
      </div>
      {imported && <p className="m-0 text-xs leading-relaxed text-muted-foreground">{t(`${e}.importedNote`)}</p>}

      {events.length === 0 ? (
        <p className="m-0 rounded-lg border border-dashed border-input px-4 py-3.5 text-[13px] text-muted-foreground">{t(live ? `${e}.noneYet` : `${e}.none`)}</p>
      ) : (
        <div
          className="flex max-h-[min(30rem,60vh)] min-w-0 flex-col-reverse overflow-y-auto rounded-lg border border-border px-3 py-1"
          tabIndex={0}
          role="log"
          aria-label={t(`${e}.label`)}
          data-uploads-events-pane
          // FILL: followNewest — a ref on this pane. Its layout already rests it at its foot when it opens (live or ended) and holds the reader's line when Show earlier prepends a page; what is left for the fill is the live case alone: once the reader has scrolled up, lines that arrive must not move what they are reading (the Fix output pane's rule, `cerberus/sheet/FixOutput.tsx` :156-160).
        >
          {/* One block in reading order inside the reversed column: the column only sets where the scroll rests. */}
          <div className="min-w-0">
            {hasEarlier && (
              <div className="flex justify-center py-2">
                <Button variant="outline" size="sm" className="h-8 max-md:h-11" onClick={onShowEarlier} data-uploads-show-earlier="pane">
                  {t(`${e}.showEarlier`)}
                </Button>
              </div>
            )}
            <Timeline
              events={lines}
              density="full"
              openIndex={openAt === -1 ? null : openAt}
              onToggle={(index) => setOpenId((current) => (current === lines[index].id ? null : lines[index].id))}
            />
          </div>
        </div>
      )}
    </div>
  );
}
