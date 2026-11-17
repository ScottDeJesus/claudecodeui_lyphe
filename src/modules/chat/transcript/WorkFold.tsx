import { useId, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { useIsExportingTranscript } from '@/modules/chat/context/TranscriptRenderContext';
import { getToolConfig } from '@/modules/chat/tools';
import { formatToolDisplayName } from '@/modules/chat/tools/configs/toolConfigs';
import { DiffStatsBadge } from '@/modules/chat/tools/DiffStatsBadge';
import { replyMaterialOf } from '@/modules/chat/transcript/replyMark';
import { parseToolPayload, summarizeDiff } from '@/modules/chat/utils/messageTransforms';
import type { ChatMessage, DiffLine } from '@/shared/types';
import { FoldChevron } from '@/shared/ui';

type WorkFoldProps = {
  /** Every tool call of the run, in order: what the line counts and names. A thinking row is the run's too, and is not counted. */
  calls: ChatMessage[];
  /** The app's diff, for the lines the run's edits added and removed. */
  createDiff: (oldStr: string, newStr: string) => DiffLine[];
  /**
   * Whether the turn the run belongs to has ended. An ended turn's work is one line that opens to its rows; while the turn runs each row
   * stands on its own line, so what is happening is seen as it happens.
   */
  finished: boolean;
  /**
   * Whose turn it is, when this run opens the turn: the model's name and the id its mark's colour is read from. The run then wears the
   * turn's mark (on its line, or over its rows while the turn runs), since the row that would have worn it is inside the run. Null for a
   * run that follows something the session said.
   */
  opens: { model: string; name: string } | null;
  /** The run's rows, as the transcript draws them. */
  children: ReactNode;
};

/** A tool by the name its row wears, and how many calls of it the run made, in the order each was first called. */
function namesOf(calls: ChatMessage[]): Array<{ label: string; count: number }> {
  const counts = new Map<string, number>();
  for (const call of calls) {
    const name = call.toolName ?? '';
    // The row's own name for the call: the surface's (a Checklist, a Question) before the tool's label, as the rows say it.
    const label = getToolConfig(name).input.label || formatToolDisplayName(name);
    if (label !== '') counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts].map(([label, count]) => ({ label, count }));
}

/**
 * A RUN OF A TURN'S WORK: the tool calls and thoughts between two things the session said. While the turn runs it is the rows themselves, one
 * to a line, close together. Once the turn has ended it is ONE LINE: the word Work, how many calls, the lines its edits added and removed, how
 * many calls failed, and the tools by name ("Read ×3 · Grep · Edit ×2 · Bash ×2"). A press opens the line to the rows, each still folded on
 * its own; a second press closes it. So a finished reply reads as what was said, with what was done one press away.
 *
 * The rows of a closed line are not drawn at all. An exported transcript has no press, so there the line stands open.
 *
 * `data-chat-work` reads `live`, `closed` or `open`. Used by `ChatMessagesPane`, around each run of work rows in a turn.
 */
export function WorkFold({ calls, createDiff, finished, opens, children }: WorkFoldProps) {
  const { t } = useTranslation('chat');
  const isExporting = useIsExportingTranscript();
  const rowsId = useId();
  // Whether a finished run's line stands open. The reader's press alone opens it; a run is closed each time it is drawn anew.
  const [opened, setOpened] = useState(false);
  const open = opened || isExporting;

  const names = useMemo(() => namesOf(calls), [calls]);
  const failed = useMemo(() => calls.filter((call) => Boolean(call.toolResult?.isError)).length, [calls]);
  const diff = useMemo(() => {
    let added = 0;
    let removed = 0;
    for (const call of calls) {
      const config = getToolConfig(call.toolName ?? '').input;
      if (config.contentType !== 'diff' || !config.getContentProps) continue;
      const content = config.getContentProps(parseToolPayload(call.toolInput) ?? {});
      if (typeof content?.oldContent !== 'string' || typeof content?.newContent !== 'string') continue;
      const stats = summarizeDiff(createDiff(content.oldContent, content.newContent));
      added += stats.added;
      removed += stats.removed;
    }
    return { added, removed };
  }, [calls, createDiff]);

  // Whose turn it is: a loop in the colour of the model, its name the mark's title and its label for a reader.
  const mark = opens === null ? null : (
    <span
      role="img"
      data-reply-mark={replyMaterialOf(opens.model)}
      aria-label={t('messageTypes.writtenBy', { defaultValue: 'Written by {{model}}', model: opens.name })}
      title={opens.name}
    />
  );

  if (!finished) {
    return (
      <div data-chat-work="live" className="chat-work">
        {mark !== null && <div className="mb-1.5 px-3 sm:px-0">{mark}</div>}
        {children}
      </div>
    );
  }

  return (
    <div data-chat-work={open ? 'open' : 'closed'} className="chat-work px-3 sm:px-0">
      <button
        type="button"
        data-chat-work-line=""
        aria-expanded={open}
        aria-controls={rowsId}
        // An export draws the rows and no press: there is nothing to open in a file.
        disabled={isExporting}
        onClick={() => setOpened((now) => !now)}
        className="group flex min-h-[30px] w-full items-center gap-2 py-1 text-left text-xs text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring finger:min-h-11"
      >
        {mark}
        {!isExporting && <FoldChevron collapsed={!open} />}
        <span className="flex-shrink-0 font-medium text-foreground">{t('work.label', { defaultValue: 'Work' })}</span>
        <span className="flex-shrink-0 tabular-nums">{`×${calls.length}`}</span>
        <DiffStatsBadge stats={diff} className="flex-shrink-0" />
        {failed > 0 && (
          <span data-tone="danger" className="flex-shrink-0 text-tone-ink">{t('work.failed', { defaultValue: '{{count}} failed', count: failed })}</span>
        )}
        <span aria-hidden="true" className="flex-shrink-0 text-[10px] text-muted-foreground/40">/</span>
        <span className="min-w-0 truncate">{names.map(({ label, count }) => (count > 1 ? `${label} ×${count}` : label)).join(' · ')}</span>
      </button>
      {open && <div id={rowsId} data-chat-work-rows="">{children}</div>}
    </div>
  );
}
