import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { SpeakingDots } from '@/modules/companion/CompanionReply';
import { useWorkBody } from '@/modules/companion/hooks/useWorkBody';
import type { CompanionWorkEntry } from '@/shared/companion-types';
import { Button, FoldChevron, Spinner } from '@/shared/ui';

type CompanionWorkProps = {
  /** A run of tool calls: the ones made between two things said, in the order they were made. */
  calls: CompanionWorkEntry[];
  /** The turn being answered now, or null: a call of that turn with no end yet is still running. */
  turnId: string | null;
  /** The companion's name, for the sentence that says what is not kept. */
  name: string;
};

/** Where a call stands: still running, answered, failed, or cut off (no end, and its turn is over: a restart or a stop took it). */
type CallState = 'running' | 'done' | 'failed' | 'stopped';

const stateOf = (call: CompanionWorkEntry, turnId: string | null): CallState =>
  call.failed ? 'failed' : call.endedAt !== null ? 'done' : call.turnId !== null && call.turnId === turnId ? 'running' : 'stopped';

/** A tool's name as a row wears it: `read_session` reads "Read session". */
const nameOf = (tool: string): string => {
  const words = tool.replace(/_/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

/** The run's tools by name, with how many calls of each, in the order each was first called: "Read session ×2 · List roadmap". */
function namesOf(calls: CompanionWorkEntry[]): string {
  const counts = new Map<string, number>();
  for (const call of calls) counts.set(nameOf(call.tool), (counts.get(nameOf(call.tool)) ?? 0) + 1);
  return [...counts].map(([label, count]) => (count > 1 ? `${label} ×${count}` : label)).join(' · ');
}

/** One argument's value as text: words as they are, a list of words one to a line, anything else as the JSON it was sent as. */
function valueOf(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && value.every((item) => typeof item === 'string')) return value.join('\n');
  return JSON.stringify(value, null, 2);
}

/** One call, opened: what the tool was given, then what it answered. Read when the row opens (`useWorkBody`). */
function CallBody({ call, state, name }: { call: CompanionWorkEntry; state: CallState; name: string }) {
  const { t } = useTranslation();
  const { held, retry } = useWorkBody(call.id, true, call.endedAt !== null);
  const quiet = 'text-xs leading-relaxed text-muted-foreground';

  if (held === null) {
    return (
      <div className="py-1">
        <Spinner size={18} />
        <span className="sr-only">{t('companion.work.reading', { defaultValue: 'Opening…' })}</span>
      </div>
    );
  }
  if (held === 'gone') return <p data-companion-work-gone="" className={quiet}>{t('companion.work.gone', { defaultValue: 'No longer kept.' })}</p>;
  if (held === 'failed') {
    return (
      <div className="flex items-center gap-2">
        <p className={quiet}>{t('companion.work.unread', { defaultValue: "Couldn't open this." })}</p>
        <Button variant="outline" size="sm" className="h-8 finger:h-11" onClick={retry}>{t('companion.panel.retry')}</Button>
      </div>
    );
  }
  if (!held.kept) return <p data-companion-work-unkept="" className={quiet}>{t('companion.work.notKept', { defaultValue: "{{name}}'s memory is not stored here.", name })}</p>;

  const given = Object.entries(held.input ?? {});
  return (
    <div className="flex min-w-0 flex-col gap-2">
      {given.length > 0 && (
        <dl data-companion-work-given="" className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 font-mono text-xs leading-relaxed">
          {given.map(([key, value]) => (
            <div key={key} className="contents">
              <dt className="text-muted-foreground">{key}</dt>
              <dd className="min-w-0 whitespace-pre-wrap break-words text-foreground">{valueOf(value)}</dd>
            </div>
          ))}
        </dl>
      )}
      {held.result !== null && held.result.length > 0 ? (
        <pre
          data-companion-work-answer=""
          data-tone={state === 'failed' ? 'danger' : undefined}
          // A tab stop of its own: the keys scroll a long answer in browsers that do not make a scroller focusable.
          tabIndex={0}
          className="max-h-72 min-w-0 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-card p-2 font-mono text-xs leading-relaxed text-foreground [scrollbar-width:thin] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring data-[tone=danger]:border-tone-ink/40"
        >
          {held.result}
        </pre>
      ) : state !== 'running' && (
        <p className={quiet}>{t('companion.work.noAnswer', { defaultValue: 'No answer.' })}</p>
      )}
      {held.cut && <p className={quiet}>{t('companion.work.cut', { defaultValue: 'The rest of the answer was not kept.' })}</p>}
    </div>
  );
}

/** One call as a line: the tool, what it concerned, and how it stands. A press opens it to what it was given and what it answered. */
function CallRow({ call, turnId, name }: { call: CompanionWorkEntry; turnId: string | null; name: string }) {
  const { t } = useTranslation();
  const bodyId = useId();
  // Whether this call stands open. The reader's press alone opens it.
  const [open, setOpen] = useState(false);
  const state = stateOf(call, turnId);

  return (
    <div data-companion-work-call={state} data-tool={call.tool}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen((now) => !now)}
        className="group flex min-h-[28px] w-full items-center gap-2 py-0.5 text-left text-xs text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring finger:min-h-11"
      >
        <FoldChevron collapsed={!open} />
        <span className="flex-shrink-0 text-foreground">{nameOf(call.tool)}</span>
        {call.about !== null && <span className="min-w-0 truncate">{call.about}</span>}
        {state === 'failed' && <span data-tone="danger" className="ml-auto flex-shrink-0 text-tone-ink">{t('companion.work.failedOne', { defaultValue: 'Failed' })}</span>}
        {state === 'stopped' && <span className="ml-auto flex-shrink-0">{t('companion.work.stopped', { defaultValue: 'Stopped' })}</span>}
        {state === 'running' && <span className="ml-auto flex-shrink-0"><SpeakingDots label={t('companion.work.running', { defaultValue: 'Running' })} /></span>}
      </button>
      {open && (
        <div id={bodyId} className="mb-2 ml-[7px] border-l border-border pl-3 pt-1">
          <CallBody call={call} state={state} name={name} />
        </div>
      )}
    </div>
  );
}

/**
 * A RUN OF A TURN'S WORK IN THE COMPANION'S LOG: the tool calls made between two things said, drawn as a chat draws a session's.
 * It is ONE LINE: the word Work, how many calls, how many failed, and the tools by name ("Read session ×2 · List roadmap"), with
 * the log's own breathing dots while one of them still runs. A press opens the line to its calls, one to a line (the tool, what it concerned,
 * how it stands); a press on a call opens it to what the tool was given and what it answered, read from the server then
 * (`useWorkBody`). So the conversation reads as what was said, with what was done one press away, and nothing arrives as a feed.
 *
 * A call of the companion's own memory opens to one sentence: none of it is stored here.
 *
 * `data-companion-work` reads `closed` or `open`, and each call `data-companion-work-call` its state. Used by `CompanionLog`,
 * between the lines where the calls were made.
 */
export function CompanionWork({ calls, turnId, name }: CompanionWorkProps) {
  const { t } = useTranslation();
  const rowsId = useId();
  // Whether the line stands open. The reader's press alone opens it; a run is closed each time it is drawn anew.
  const [open, setOpen] = useState(false);
  const failed = calls.filter((call) => call.failed).length;
  const running = calls.some((call) => stateOf(call, turnId) === 'running');

  return (
    <div data-companion-entry="work" data-companion-work={open ? 'open' : 'closed'} className="min-w-0">
      <button
        type="button"
        data-companion-work-line=""
        aria-expanded={open}
        aria-controls={rowsId}
        onClick={() => setOpen((now) => !now)}
        className="group flex min-h-[30px] w-full items-center gap-2 border-b border-border/60 py-1 text-left text-xs text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring finger:min-h-11"
      >
        <FoldChevron collapsed={!open} />
        <span className="flex-shrink-0 font-medium text-foreground">{t('companion.work.label', { defaultValue: 'Work' })}</span>
        <span className="flex-shrink-0 tabular-nums">{`×${calls.length}`}</span>
        {failed > 0 && <span data-tone="danger" className="flex-shrink-0 text-tone-ink">{t('companion.work.failed', { defaultValue: '{{count}} failed', count: failed })}</span>}
        <span aria-hidden="true" className="flex-shrink-0 text-[10px] text-muted-foreground/40">/</span>
        <span className="min-w-0 truncate">{namesOf(calls)}</span>
        {running && <span className="ml-auto flex-shrink-0"><SpeakingDots label={t('companion.work.running', { defaultValue: 'Running' })} /></span>}
      </button>
      {open && (
        <div id={rowsId} data-companion-work-rows="" className="pt-1">
          {calls.map((call) => <CallRow key={call.id} call={call} turnId={turnId} name={name} />)}
        </div>
      )}
    </div>
  );
}
