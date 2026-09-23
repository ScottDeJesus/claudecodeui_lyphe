import { ChevronRightIcon, ExternalLinkIcon, InboxIcon } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { usePaletteOps } from '@/modules/command-palette';
import { agoWord, byUrgency, classTone, classWord, transcriptRef, trendMark } from '@/modules/heal/healState';
import type { HealItem, HealKindRow } from '@/modules/heal/healTypes';
import { api, readApiJson } from '@/shared/api';
import { Badge, Button, Chip, Collapsible, CollapsibleContent, CollapsibleTrigger, EmptyState, Spinner } from '@/shared/ui';
import { cn } from '@/shared/utils';

/**
 * Friction BY KIND — the door's own word, which is what a heal is scoped to.
 *
 * ONE ROW PER KIND, IN TRIAGE ORDER: a regression first (a cause a heal claimed has come back —
 * the one red thing on this list), then the most live rows, then the all-ignored kinds last and
 * greyed, because they are refusals by design and read as noise on purpose.
 *
 * THE CAUSE CLASS SITS BESIDE THE KIND ONLY WHERE ONE IS KNOWN. A kind whose rows carry no `klass`
 * shows the kind alone — never a guessed class — since only a judged class can feed a heal's
 * claims or mark a regression. A null trend prints a dash and SAYS "no trend"; an arrow would be
 * a fabricated reading of a window that does not exist.
 *
 * Each kind opens to its items, and an item shows enough to open its transcript line: the source
 * door, the tool, the row's own words, and the `file.jsonl:line` reference that is the press.
 */
export function HealKindList({ kinds }: { kinds: HealKindRow[] }) {
  const { t } = useTranslation();
  // The workspace's own file opener: the healed item's transcript is a path in the SAME project this
  // workspace has open, so the press brings the Files tab forward at the row's line rather than
  // teaching this module a second way to open a file.
  const { openFileReference } = usePaletteOps();
  const onOpenItem = (item: HealItem) => {
    if (item.transcript) openFileReference(item.transcript, item.transcript_line ?? undefined);
  };

  if (kinds.length === 0) {
    return (
      <div className="flex items-center justify-center px-4 py-8">
        <EmptyState
          icon={InboxIcon}
          title={t('heal.kinds.empty.title', { defaultValue: 'No friction since the last heal' })}
          message={t('heal.kinds.empty.message', { defaultValue: 'Every door is filing quietly. The next row filed lights this list.' })}
        />
      </div>
    );
  }

  const ordered = [...kinds].sort(byUrgency);
  return (
    <ul className="flex min-w-0 flex-col gap-2" data-heal-kinds>
      {ordered.map((row) => (
        <KindRow key={row.kind} row={row} onOpenItem={onOpenItem} />
      ))}
    </ul>
  );
}

/**
 * One kind's rows as this row holds them: what the read answered, and how that read is going.
 *
 * `items: null` is NO READ HAS ANSWERED YET, and it is a state of its own rather than `[]`. The poll's
 * `row.items` is empty by design, so a row seeded from it is indistinguishable from a row that asked
 * and was told there is nothing — and `[]` draws "No rows are filed under this kind right now" for
 * every frame between opening and the response, an empty answer the reader was never given. Absent
 * rows and zero rows are different sentences; only one of them was earned.
 */
type KindRows = { items: HealItem[] | null; reading: boolean; failure: string | null };

function KindRow({ row, onOpenItem }: { row: HealKindRow; onOpenItem: (item: HealItem) => void }) {
  const { t } = useTranslation();
  // NOTHING IN THE POLL: `summary.kinds[].items` is `[]` by design, so a kind's rows are read when the
  // reader OPENS that kind — one read, at the one moment somebody is looking at it, rather than a
  // second ledger page riding every sixty seconds.
  // A regression row opens on arrival, so it is already being read when it first paints: seeded as a
  // read in flight rather than as an answer nobody has given yet. The two go together — a row that
  // opens itself can never draw the empty answer before its own read has landed.
  const [rows, setRows] = useState<KindRows>({ items: null, reading: row.regression !== null, failure: null });
  // One read per kind per mount: closing and reopening a row is not a reason to ask again. A FAILED
  // read releases the claim, so reopening is a fresh attempt rather than a permanently empty list.
  const askedRef = useRef(false);
  const aliveRef = useRef(true);

  // The mount half is load-bearing, not redundant with `useRef(true)`: StrictMode runs this
  // cleanup once and then re-runs the effect (main.tsx:59), so without it `aliveRef` is false for
  // the component's whole life and the one real response is dropped — the wheel never stops.
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    if (askedRef.current) return;
    askedRef.current = true;
    setRows((current) => ({ ...current, reading: true, failure: null }));
    try {
      const response = await api.heal.byKind(row.kind);
      // `readApiJson` and not `response.json()`: the transport does not throw on a status, and a
      // 502/503 body read as `items ?? []` would draw a REFUSED read as the empty answer ("no rows are
      // filed under this kind") — the fabrication this file's failure branch exists to prevent.
      const payload = await readApiJson<{ items?: unknown }>(response);
      // A body carrying no rows is a REFUSAL, not an empty answer: `items` absent would otherwise draw
      // "no rows are filed under this kind right now" — the same fabrication, one status quieter.
      if (!Array.isArray(payload.items)) throw new Error('the heal worker did not report this kind’s rows');
      if (aliveRef.current) setRows({ items: payload.items, reading: false, failure: null });
    } catch (error) {
      askedRef.current = false;
      // The door answers the worker's own sentence on a refusal, so the reader gets those words.
      const reason = error instanceof Error ? error.message : null;
      if (aliveRef.current) {
        setRows((current) => ({
          ...current,
          reading: false,
          failure: reason ?? t('heal.kinds.readFailed', { defaultValue: 'This kind could not be read' }),
        }));
      }
    }
  }, [row.kind, t]);

  // A regression row opens on arrival, so its rows are read on arrival too: a kind already standing
  // open with a spinner in it is the one press this list exists to spare the reader.
  useEffect(() => {
    if (row.regression !== null) void load();
  }, [load, row.regression]);

  // Nothing live means nothing to heal: the row stays, greyed, so the reader knows the door fired
  // and the ignore table caught every one of them.
  const quiet = row.live === 0;
  const trend = trendMark(row.trend);

  return (
    <li className={cn('min-w-0 rounded-lg border border-border', quiet && 'opacity-60')} data-heal-kind={row.kind}>
      {/* A regression opens on arrival: the reader must not have to press to see the cause that came back. */}
      <Collapsible
        defaultOpen={row.regression !== null}
        onOpenChange={(open) => {
          if (open) void load();
        }}
        className="min-w-0"
      >
        {/* THE WHOLE ROW IS THE PRESS, at least 44px tall, with a chevron that turns when it opens:
            a kind name alone said nothing about opening and measured 24px on a phone. Everything
            inside is a span — a badge, a chip with no handler — so nothing pressable is nested. */}
        <CollapsibleTrigger
          className="group flex min-h-11 w-full min-w-0 flex-wrap items-center gap-2 rounded-lg px-3 py-2 text-left hover:bg-muted"
          aria-label={t('heal.kinds.toggle', { defaultValue: 'Show the rows of {{kind}}', kind: row.kind })}
        >
          <ChevronRightIcon className="h-4 w-4 flex-none text-muted-foreground transition-transform duration-200 group-data-[state=open]:rotate-90" aria-hidden="true" />
          <span className="font-mono text-sm">{row.kind}</span>
          <Badge as="span" tone={quiet ? 'neutral' : row.live >= 5 ? 'warn' : 'info'}>
            {t('heal.kinds.live', { defaultValue: '{{count}} live', count: row.live })}
          </Badge>
          {row.ignored > 0 && (
            <Badge as="span" tone="neutral">{t('heal.kinds.ignored', { defaultValue: '{{count}} ignored', count: row.ignored })}</Badge>
          )}
          <Badge as="span" tone={trend.tone} title={trend.word}>
            <span aria-hidden="true">{trend.glyph}</span>&nbsp;{trend.word}
          </Badge>
          {row.klass !== null && (
            <Chip size="sm" tone={classTone(row.klass)} title={t('heal.kinds.classTitle', { defaultValue: 'Cause class' })}>
              {classWord(row.klass)}
            </Chip>
          )}
          {row.regression !== null && (
            <Badge as="span" tone="danger" className="min-w-0 break-words">
              {t('heal.kinds.regression', {
                defaultValue: '⚠ regression · {{klass}} came back {{ago}}',
                klass: classWord(row.regression.klass),
                ago: agoWord(row.regression.since),
              })}
            </Badge>
          )}
        </CollapsibleTrigger>
        <CollapsibleContent className="min-w-0">
          {/* `items: null` draws nothing at all: it is a read nobody has made yet, and the empty answer
              is a reply — the one thing that must never stand in for a question not yet asked. */}
          {rows.reading ? (
            <div className="flex items-center justify-center border-t border-border px-3 py-3">
              <Spinner label={t('heal.kinds.reading', { defaultValue: 'Reading this kind’s rows…' })} />
            </div>
          ) : rows.failure !== null ? (
            <p className="border-t border-border px-3 py-2 text-xs text-muted-foreground">{rows.failure}</p>
          ) : rows.items === null ? null : rows.items.length === 0 ? (
            <p className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
              {t('heal.kinds.noneFiled', { defaultValue: 'No rows are filed under this kind right now.' })}
            </p>
          ) : (
            <ul className="flex flex-col divide-y divide-border border-t border-border">
              {rows.items.map((item) => (
                <ItemRow key={item.id} item={item} onOpen={onOpenItem} />
              ))}
            </ul>
          )}
        </CollapsibleContent>
      </Collapsible>
    </li>
  );
}

function ItemRow({ item, onOpen }: { item: HealItem; onOpen: (item: HealItem) => void }) {
  const { t } = useTranslation();
  return (
    <li className={cn('flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2 text-xs', item.ignored && 'text-muted-foreground')} data-heal-item={item.id}>
      <span className="w-16 flex-none font-mono text-muted-foreground">{agoWord(item.ts)}</span>
      <Badge as="span" tone="neutral">{item.tool ? `${item.source} · ${item.tool}` : item.source}</Badge>
      {item.soul && <Badge as="span" tone="info">{t('heal.kinds.soul', { defaultValue: 'soul' })}</Badge>}
      {item.klass !== null && <Chip size="sm" tone={classTone(item.klass)}>{classWord(item.klass)}</Chip>}
      {item.ignored && <Badge as="span" tone="neutral">{t('heal.kinds.ignoredOne', { defaultValue: 'ignored' })}</Badge>}
      {/* The row's own words reach the DOM as a text node: a rail's detail quotes the command it refused. */}
      <span className="line-clamp-2 w-full min-w-0 break-words leading-snug">{item.detail ?? '—'}</span>
      {item.transcript !== null ? (
        <Button variant="ghost" size="sm" className="h-7 px-2 font-mono text-xs" onClick={() => onOpen(item)} title={item.transcript}>
          <ExternalLinkIcon aria-hidden="true" />
          {transcriptRef(item.transcript, item.transcript_line)}
        </Button>
      ) : (
        <span className="text-muted-foreground">{t('heal.kinds.noTranscript', { defaultValue: 'no transcript' })}</span>
      )}
    </li>
  );
}
