import { ChevronLeft, ChevronRight } from 'lucide-react';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import type { ChatMessage, SubagentTranscriptTarget } from '@/shared/types';
import { useHostWindow } from '@/shared/context/HostWindowContext';
import { Button, Dialog, DialogContent, DialogTitle } from '@/shared/ui';
import { OWNS_ESCAPE } from '@/shared/ui/overlayEscape';
import { CoreHelperDots } from '@/modules/chat/composer/CoreHelperDots';
import type { CoreHelperDot, CoreHelperState } from '@/modules/chat/composer/CoreHelperDots';
import { useComposerMenuAnchor } from '@/modules/chat/hooks/useComposerMenuAnchor';
import { usePinnedSubagentRows } from '@/modules/chat/hooks/usePinnedSubagentRows';
import type { PinnedSubagentRow } from '@/modules/chat/hooks/usePinnedSubagentRows';
import { replyMaterialOf } from '@/modules/chat/transcript/replyMark';
import { SubagentTranscriptView } from '@/modules/chat/subagents/SubagentTranscriptView';
import { rowId, rowLabel, rowRunning } from '@/modules/chat/subagents/subagentRow';
import PinnedAgentRow from '@/modules/chat/transcript/PinnedAgentRow';
import SoulLaunchPinRow from '@/modules/chat/transcript/SoulLaunchPinRow';

/**
 * THE AGENTS OF THIS CONVERSATION, AS DOTS ROUND THE CHAT'S CORE: the ones running now, and the ones that finished until the
 * reader dismisses them. No window stands over the chat box for them (the operator, 2026-11-18: get rid of the subagent windows;
 * show the core spawning them as smaller colour-coded dots).
 *
 * A subagent's own row scrolls away the moment it starts working, and the agent then streams nothing into the main thread for
 * minutes. Its dot keeps it in view (`composer/CoreHelperDots`): in its model's colour, breathing while it works, a ring once it
 * has ended. It STAYS when it finishes, so the reader learns it ended without having been there to see it; only the reader's own
 * dismissal removes it (the operator's ruling of 2026-09-10: "dismiss it when it unpins, not when it's done"), and a dismissal is
 * remembered in this browser.
 *
 * A PRESS ON A DOT OPENS ITS CARD, beside the dot: the row the strip used to draw (`PinnedAgentRow`, `SoulLaunchPinRow`), so
 * nothing it said is lost: its own core in the form of what it is doing, its name and model, the newest thing it did or said,
 * what it has spent so far, its status, and Dismiss once it has ended. Under it, Open reads its transcript (a press on the row
 * does too), and with more than one helper two arrows page through them, since a dot is a small thing to hit. Escape, or a press
 * anywhere else, puts the card away.
 *
 * TWO KINDS OF HELPER SHARE THE ORBIT. An `Agent`-tool subagent is a row in the transcript; a launcher soul a session started by
 * hand is a detached child that writes nothing here, so it is joined in from the server's lane by launch id
 * (`src/modules/dispatch-souls/`). They are sorted into ONE list, because the reader is asking one question of it: what is
 * working for me right now.
 *
 * OPEN READS THE TRANSCRIPT in a dialog over the chat. The open row is tagged with the chat it was opened in, so switching chats
 * closes it rather than leaving another conversation's agent on screen.
 *
 * The rows themselves are derived by `hooks/usePinnedSubagentRows.ts`: this file is the dots' data, the card, the open dialog
 * and the memo boundary. Drawn by `ChatInterface` into the composer's core (`ChatCore`'s `helpers`), which hands it the radius of the core's outer ring.
 */
type PinnedSubagentsProps = {
  messages: ChatMessage[];
  /**
   * The launch ids THIS conversation started, read off its own tool results by the session-state
   * hook. Passed in rather than scanned in the row hook because the scan has to be memoized against
   * a transcript that changes on every streamed token, and `messages` is the strip's memo key.
   */
  soulLaunchIds: string[];
  /** The open chat, which a transcript is read through and which an open dialog belongs to. */
  sessionId: string | null;
  /** The chat's CLI session id, against which the lane's launches are anchored by their `launched_by` stamp; `null` until the provider has reported it. */
  cliSessionId: string | null;
  /** The chat's resolver from a model id to its name, so a row says "Opus 5.5" as the transcript's headers do. */
  resolveModelLabel: (modelId: string) => string | null;
  /** The radius of the outer ring of the core the dots stand round, in px. */
  ringRadius: number;
};

/** The row whose transcript is open, tagged with the chat it was opened in. */
type OpenedTranscript = {
  sessionId: string | null;
  target: SubagentTranscriptTarget & { label: string };
};

/** How a row stands, as its dot says it. A launch waiting for the CPU is held back, not at work. */
function stateOf(row: PinnedSubagentRow): CoreHelperState {
  if (row.kind === 'agent') {
    const { status } = row.summary;
    return status === 'running' ? 'running' : status === 'failed' ? 'failed' : status === 'stopped' ? 'stopped' : 'finished';
  }
  const { state } = row.launch;
  if (state === 'running') return row.launch.cpu_wait ? 'held' : 'running';
  return state === 'failed' ? 'failed' : state === 'stopped' ? 'stopped' : 'finished';
}

/** How wide the card is, at most, in px. */
const CARD_WIDTH = 420;
/** The air the card keeps from the window's edges and from its dot, in px. */
const CARD_EDGE = 8;

/** Where the card stands, in the window's own px: over its dot, starting a little before it, never past the window's edges. */
type CardPlace = { left: number; bottom: number; width: number; maxHeight: number };

function PinnedSubagents({ messages, soulLaunchIds, sessionId, cliSessionId, resolveModelLabel, ringRadius }: PinnedSubagentsProps) {
  const { t } = useTranslation();
  const hostWindow = useHostWindow();
  const { rows, dismiss } = usePinnedSubagentRows(messages, soulLaunchIds, cliSessionId, resolveModelLabel);
  const [opened, setOpened] = useState<OpenedTranscript | null>(null);
  // The helper whose card is open, by its row's id, or null. A row that leaves (dismissed, aged out) takes its card with it.
  const [picked, setPicked] = useState<string | null>(null);
  const layerRef = useRef<HTMLDivElement>(null);

  const target = opened !== null && opened.sessionId === sessionId ? opened.target : null;
  // The open row can be gone (dismissed or aged out) while its dialog is up; then nothing is known
  // to still be running, and the transcript reads as a record.
  const openRow = target === null ? null : rows.find((row) => rowId(row) === target.id) ?? null;

  const pickedAt = picked === null ? -1 : rows.findIndex((row) => rowId(row) === picked);
  const pickedRow = pickedAt < 0 ? null : rows[pickedAt];
  // A helper's own dot; one past the orbit's room is reached through the count that stands for it.
  const dotOf = useCallback((id: string) => {
    const layer = layerRef.current;
    if (layer === null) return null;
    return layer.querySelector<HTMLElement>(`[data-core-helper-id="${CSS.escape(id)}"]`) ?? layer.querySelector<HTMLElement>('[data-core-helper="more"]');
  }, []);
  const getDot = useCallback(() => (picked === null ? null : dotOf(picked)), [picked, dotOf]);
  /** Where a helper's card stands: over its dot, measured as it is asked for. Null for a dot that is not drawn. */
  const placeOf = useCallback((id: string): CardPlace | null => {
    const dot = dotOf(id)?.getBoundingClientRect();
    if (!dot) return null;
    const width = Math.min(CARD_WIDTH, hostWindow.innerWidth - 2 * CARD_EDGE);
    const left = Math.round(Math.min(Math.max(CARD_EDGE, dot.left - 2 * CARD_EDGE), hostWindow.innerWidth - width - CARD_EDGE));
    return { left, bottom: Math.round(hostWindow.innerHeight - dot.top + CARD_EDGE), width, maxHeight: Math.max(160, Math.round(dot.top - 2 * CARD_EDGE)) };
  }, [dotOf, hostWindow]);
  // The card's place is taken at the press that opens it (or pages it), and again when the window changes size.
  const [place, setPlace] = useState<CardPlace | null>(null);
  const pick = useCallback((id: string | null) => {
    setPicked(id);
    setPlace(id === null ? null : placeOf(id));
  }, [placeOf]);
  const closeCard = useCallback(() => pick(null), [pick]);
  // Escape and a press anywhere else put the card away (the composer popovers' own rule). Its place is the card's own: that
  // rule anchors a panel to the END of its trigger, which is right for a button at the line's end and wrong for a dot at its start.
  const { menuRef } = useComposerMenuAnchor(pickedRow !== null, closeCard, CARD_WIDTH, getDot);
  useEffect(() => {
    if (picked === null) return undefined;
    const settle = () => setPlace(placeOf(picked));
    hostWindow.addEventListener('resize', settle);
    return () => hostWindow.removeEventListener('resize', settle);
  }, [picked, placeOf, hostWindow]);

  if (rows.length === 0 && target === null) {
    return null;
  }

  const dots: CoreHelperDot[] = rows.map((row) => {
    const state = stateOf(row);
    return {
      id: rowId(row),
      material: replyMaterialOf(row.model),
      state,
      doing: 'doing' in row ? row.doing : undefined,
      label: t('gutters.subagents.dot', { name: rowLabel(row) || t('gutters.subagents.title'), state: t(`gutters.subagents.state.${state}`) }),
    };
  });
  const open = (row: PinnedSubagentRow) => {
    pick(null);
    setOpened({ sessionId, target: { kind: row.kind, id: rowId(row), label: rowLabel(row) } });
  };
  const page = (by: number) => pick(rowId(rows[(pickedAt + by + rows.length) % rows.length]));

  return (
    <>
      {rows.length > 0 && (
        <div ref={layerRef} className="contents">
          <CoreHelperDots
            dots={dots}
            ringRadius={ringRadius}
            picked={picked}
            onPick={(id) => pick(picked === id ? null : id)}
            label={t('gutters.subagents.title')}
            moreLabel={(count) => t('gutters.subagents.more', { count })}
          />
        </div>
      )}

      {pickedRow !== null && place !== null && createPortal(
        <div
          ref={menuRef}
          role="dialog"
          aria-label={rowLabel(pickedRow) || t('gutters.subagents.title')}
          // The card owns Escape while it is up — see `shared/ui/overlayEscape`.
          {...OWNS_ESCAPE}
          data-testid="pinned-subagent-card"
          className="fixed z-[100] overflow-y-auto overscroll-contain border border-border bg-popover p-1.5 text-popover-foreground"
          style={{
            left: place.left,
            bottom: place.bottom,
            maxHeight: place.maxHeight,
            width: place.width,
            borderRadius: 'var(--radius-card)',
            boxShadow: 'var(--shadow-overlay)',
            animation: 'vv-pop 0.3s var(--ease-enter) both',
          }}
        >
          {pickedRow.kind === 'agent' ? (
            <PinnedAgentRow
              key={pickedRow.key}
              id={pickedRow.id}
              latest={pickedRow.latest}
              summary={pickedRow.summary}
              provider={pickedRow.provider}
              model={pickedRow.model}
              doing={pickedRow.doing}
              modelLabel={pickedRow.modelLabel}
              onDismiss={dismiss}
              onOpen={() => open(pickedRow)}
              openLabel={t('gutters.subagents.openRow', { name: rowLabel(pickedRow) })}
            />
          ) : (
            <SoulLaunchPinRow
              key={pickedRow.key}
              launch={pickedRow.launch}
              modelLabel={pickedRow.modelLabel}
              onDismiss={dismiss}
              onOpen={() => open(pickedRow)}
              openLabel={t('gutters.subagents.openRow', { name: rowLabel(pickedRow) })}
            />
          )}
          <div className="mt-1 flex items-center gap-1.5 border-t border-border px-1 pt-1.5">
            {rows.length > 1 && (
              <>
                <Button variant="ghost" size="icon" className="h-8 w-8 finger:h-11 finger:w-11" aria-label={t('gutters.subagents.previous')} title={t('gutters.subagents.previous')} onClick={() => page(-1)}>
                  <ChevronLeft aria-hidden="true" />
                </Button>
                <span data-testid="pinned-subagent-card-place" className="font-mono text-xs tabular-nums text-muted-foreground">{`${pickedAt + 1} / ${rows.length}`}</span>
                <Button variant="ghost" size="icon" className="h-8 w-8 finger:h-11 finger:w-11" aria-label={t('gutters.subagents.next')} title={t('gutters.subagents.next')} onClick={() => page(1)}>
                  <ChevronRight aria-hidden="true" />
                </Button>
              </>
            )}
            <span className="flex-1" />
            <Button size="sm" className="finger:h-11" data-testid="pinned-subagent-card-open" onClick={() => open(pickedRow)}>
              {t('gutters.subagents.open')}
            </Button>
          </div>
        </div>,
        hostWindow.document.body,
      )}

      <Dialog open={target !== null} onOpenChange={(next) => !next && setOpened(null)}>
        <DialogContent
          data-testid="pinned-subagent-dialog"
          aria-label={target?.label || t('gutters.subagents.title')}
          className="flex h-[min(92dvh,48rem)] w-[calc(100vw-1rem)] max-w-3xl flex-col overflow-hidden rounded-3xl border-border/80 p-0 shadow-2xl sm:w-[min(94vw,48rem)]"
        >
          {target !== null ? (
            <>
              <DialogTitle className="sr-only">{target.label}</DialogTitle>
              {/* No top padding: a sticky header sticks inside the scroller's padding, and the transcript would show through the gap above it. */}
              <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-4 pb-4">
                <SubagentTranscriptView
                  sessionId={sessionId}
                  target={target}
                  label={target.label}
                  running={openRow !== null && rowRunning(openRow)}
                  onBack={() => setOpened(null)}
                />
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Memoized: the pane re-renders on every streamed row and this strip only moves when an agent starts, works, finishes or is dismissed. */
export default memo(PinnedSubagents);
