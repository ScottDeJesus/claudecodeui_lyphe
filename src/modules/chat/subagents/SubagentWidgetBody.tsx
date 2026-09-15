import { useState } from 'react';
import { BotIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { SubagentTranscriptTarget } from '@/shared/types';
import { EmptyState } from '@/shared/ui';
import { useSubagentWidgetRows } from '@/modules/chat/hooks/useSubagentWidgetRows';
import type { PinnedSubagentRow } from '@/modules/chat/hooks/usePinnedSubagentRows';
import { SubagentTranscriptView } from '@/modules/chat/subagents/SubagentTranscriptView';
import PinnedAgentRow from '@/modules/chat/transcript/PinnedAgentRow';
import SoulLaunchPinRow from '@/modules/chat/transcript/SoulLaunchPinRow';

/** The row whose transcript is open, tagged with the chat it was opened in. */
type OpenedTranscript = {
  sessionId: string | null;
  target: SubagentTranscriptTarget & { label: string };
};

/** The id a row is addressed by: an agent's spawning tool call, or a soul's launch id. */
function rowId(row: PinnedSubagentRow): string {
  return row.kind === 'agent' ? row.id : row.launch.launch_id;
}

/** Whether a row is still working — the same reading its own drawing takes. */
function rowRunning(row: PinnedSubagentRow): boolean {
  return row.kind === 'agent' ? row.summary.status === 'running' : row.launch.state === 'running';
}

/** What a row is called where a name is needed in words: the transcript's header, and the label
 * its row announces as the thing a press will open. */
function rowLabel(row: PinnedSubagentRow): string {
  return row.kind === 'agent' ? row.summary.label || row.summary.description || '' : row.launch.agent;
}

/**
 * The Subagents widget: the open chat's pinned rows, each one opening its own transcript.
 *
 * THE SAME ROWS THE STRIP DRAWS, drawn again — `useSubagentWidgetRows` is the strip's own reading,
 * so the two surfaces cannot disagree about what this chat has working for it. What the widget adds
 * is the press: a row here opens the subagent's transcript beside the conversation, which is the
 * one thing the strip above the chat box has no room to do.
 *
 * ONE ROW AT A TIME, AND NEVER ACROSS A CHAT. The open target is held WITH the session it was
 * opened in, and a target whose tag no longer matches the widget's own session is read as none:
 * switching chats therefore returns the widget to its list without an effect to remember, and a
 * transcript of somebody else's conversation can never be left on screen.
 *
 * THE FRAME IS NOT HERE. The tab, the title, the count and the scrolling belong to the
 * chat-gutters module, which draws this body inside one `GutterWidgetFrame`.
 */
export function SubagentWidgetBody({ sessionId }: { sessionId: string | null }) {
  const { t } = useTranslation();
  const { rows, dismiss } = useSubagentWidgetRows(sessionId);

  /**
   * Which row's transcript is open, and the chat it was opened in. Essential because opening a
   * transcript is a mode of this widget and not a place in the app: nothing else holds it, and
   * the tag above is what makes it end with the chat.
   */
  const [opened, setOpened] = useState<OpenedTranscript | null>(null);

  const target = opened !== null && opened.sessionId === sessionId ? opened.target : null;
  // The row the open transcript belongs to. It can be gone — aged out of the list, or dismissed
  // while its transcript was open — and then nothing is known to still be running.
  const openRow = target === null ? null : rows.find((row) => rowId(row) === target.id) ?? null;

  if (target !== null) {
    return (
      <SubagentTranscriptView
        sessionId={sessionId}
        target={target}
        label={target.label}
        running={openRow !== null && rowRunning(openRow)}
        onBack={() => setOpened(null)}
      />
    );
  }

  if (rows.length === 0) {
    return (
      <div data-testid="subagent-widget-empty">
        <EmptyState icon={BotIcon} title={t('gutters.subagents.empty')} />
      </div>
    );
  }

  return (
    <ul data-testid="subagent-widget-list" className="flex min-w-0 flex-col gap-2">
      {rows.map((row) => {
        const id = rowId(row);
        const label = rowLabel(row);
        return (
          <li
            key={row.key}
            data-testid="subagent-widget-row"
            data-row-id={id}
            data-kind={row.kind}
            data-running={String(rowRunning(row))}
            className="min-w-0"
          >
            {row.kind === 'agent' ? (
              <PinnedAgentRow
                id={row.id}
                latest={row.latest}
                summary={row.summary}
                onDismiss={dismiss}
                onOpen={() => setOpened({ sessionId, target: { kind: 'agent', id, label } })}
                openLabel={t('gutters.subagents.openRow', { name: label })}
              />
            ) : (
              <SoulLaunchPinRow
                launch={row.launch}
                onDismiss={dismiss}
                onOpen={() => setOpened({ sessionId, target: { kind: 'soul', id, label } })}
                openLabel={t('gutters.subagents.openRow', { name: label })}
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}
