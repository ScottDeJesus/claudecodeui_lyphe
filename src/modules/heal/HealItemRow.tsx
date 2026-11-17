import { ExternalLinkIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { agoWord, classTone, classWord, transcriptRef } from '@/modules/heal/healState';
import type { HealItem } from '@/modules/heal/healTypes';
import { Badge, Button, Chip } from '@/shared/ui';
import { cn } from '@/shared/utils';

/**
 * One friction row, as a kind opens to it: when it was filed, the door and tool, the row's own words, and the
 * `file.jsonl:line` that is the press to open its transcript (`onOpen`, which `useOpenFrictionLine` makes). It draws ONE
 * `<li>`; the caller owns the `<ul>` around it.
 *
 * Used by this module's HealKindList, and through the barrel by Cerberus's Uploads view for the agent's own friction in a
 * run — one drawing of a row, so the two tabs cannot word the same row differently.
 */
export function HealItemRow({ item, onOpen }: { item: HealItem; onOpen: (item: HealItem) => void }) {
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
        // The press never outgrows its row (`min-w-0 max-w-full`): a session's file name is 42 mono characters, wider than a
        // phone's column, and a press that kept its width ran past the edge and made a narrow host pan sideways. The file
        // name gives way with an ellipsis and the line number never does, since the line is the part a reader came for.
        <Button variant="ghost" size="sm" className="h-7 min-w-0 max-w-full px-2 font-mono text-xs" onClick={() => onOpen(item)} title={item.transcript}>
          <ExternalLinkIcon aria-hidden="true" />
          <span className="flex min-w-0">
            <span className="min-w-0 truncate">{transcriptRef(item.transcript, null)}</span>
            {item.transcript_line !== null && <span className="flex-none">:{item.transcript_line}</span>}
          </span>
        </Button>
      ) : (
        <span className="text-muted-foreground">{t('heal.kinds.noTranscript', { defaultValue: 'no transcript' })}</span>
      )}
    </li>
  );
}
