import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { useSimpleChatList } from '@/modules/sidebar/hooks/useSimpleChatList';
import { createHaloPainter, haloHeightFor, haloMiddle } from '@/modules/sidebar/utils/haloPainter';
import { chatMarks } from '@/modules/sidebar/utils/simpleChatMarks';
import { useIsPageHeld } from '@/shared/context/HeldPageContext';
import { useSessionHostLiveSet } from '@/shared/context/SessionHostLivenessContext';
import { useAwaitingInputSessionIdSet, useBusySessionIdSet, useSubagentRunningSessionIdSet } from '@/shared/context/SessionProtectionContext';
import type { RecentConversationListItem, SessionsHaloSlot } from '@/shared/types';
import { cn } from '@/shared/utils';

type SessionsHaloProps = {
  /** False until the halo's page has been on screen once: until then no page of the feed is read and no socket subscription is held. */
  enabled: boolean;
  /** The hoop's width, in px. It is as deep as it leans at that width (`haloHeightFor`); the words stand under it. */
  width: number;
  /** Whether the folders' names are written round it: a halo standing small writes none. */
  names: boolean;
  /** Whether the chat at the front is read out in words under the hoop. */
  reading: boolean;
  /**
   * The chat the core in the middle is dealing with now, by id, and the way the words go (`in`: it is read; `out`: it is written to); null for none.
   * A line is drawn from the core to that chat's slot and a bead travels it. `coreRadius` is the core's own radius in px, where the line starts.
   */
  link: { id: string; way: 'in' | 'out' } | null;
  coreRadius: number;
  /** The chat at the front, pressed (or Enter on the hoop): its page shows it. */
  onOpenChat: (sessionId: string) => void;
  /** What stands in the hoop's middle: the companion's core. It is drawn over the canvas, so its own press stays its own. */
  children: ReactNode;
};

/** The reading's first line: mono, upper case, as the roadmap's stack writes its own. */
const EYEBROW = 'font-mono text-[10px] font-medium uppercase leading-[14px] tracking-[0.14em] text-muted-foreground';

/**
 * THE HALO: the simple chat list as a hoop round the companion's core, a slot for every chat, the chats of a folder side by side. It is the
 * sessions board (`SessionsBoard`) in one object: the same feed (`useSimpleChatList`, a copy of its rows kept on the same frames) and the same four
 * marks (`chatMarks`), each drawn in its own place on the slot (`utils/haloPainter`), so the whole of what is running, waiting, unread or asleep reads
 * at a glance without a list.
 *
 * TURNING IT: a drag, the wheel, or the arrows while it has the keyboard. The slot at the front, over the pointer, is read out under the hoop: its
 * folder, its name, and its state in the board's own words. A press on any other slot brings that slot to the front. A PRESS ON THE SLOT AT THE FRONT,
 * or Enter, OPENS ITS CHAT (`onOpenChat`). On a touch screen that is the same two taps: the first shows what is chosen, the second goes to it.
 *
 * THE ORDER is the feed's: folders in the order the list draws them, each folder's chats in its own order, the chats in no folder last. It reads one
 * page of the feed, as the board does before "Load more"; a list longer than a page shows its first page.
 *
 * THE CORE'S DEALINGS WITH A CHAT are drawn on it (`link`): while the companion reads a chat or writes to one, a line runs between the core and that
 * chat's slot, and a bead travels it the way the words go.
 *
 * `data-sessions-halo` marks its root and reads how many chats it holds; `data-halo-front` the chat at the front, by id.
 *
 * Exported through the sidebar barrel for the station's scene (`StationKaylee`), which stands the companion's core in its middle.
 */
export function SessionsHalo({ enabled, width, names, reading, link, coreRadius, onOpenChat, children }: SessionsHaloProps) {
  const height = haloHeightFor(width);
  const { t } = useTranslation(['sidebar', 'common']);
  const busySessionIds = useBusySessionIdSet();
  const awaitingInputSessionIds = useAwaitingInputSessionIdSet();
  const subagentRunningSessionIds = useSubagentRunningSessionIdSet();
  const liveHostSessionIds = useSessionHostLiveSet();
  const isPageHeld = useIsPageHeld();
  // No chat is open at the halo, so the feed is asked to keep none in view.
  const { items } = useSimpleChatList(null, enabled);

  const slots = useMemo(() => {
    const slotOf = (chat: RecentConversationListItem, folder: string | null, folderName: string | null): SessionsHaloSlot => {
      const marks = chatMarks({
        unread: chat.unread,
        isSelected: false,
        isRunning: busySessionIds.has(chat.sessionId),
        isAwaitingInput: awaitingInputSessionIds.has(chat.sessionId),
        isSubagentRunning: subagentRunningSessionIds.has(chat.sessionId),
      });
      // Only a Claude chat can have a session host, so only one can be asleep, and none is until the server's first census has arrived.
      const asleep = liveHostSessionIds !== null && chat.provider === 'claude' && !liveHostSessionIds.has(chat.sessionId);
      return {
        id: chat.sessionId,
        title: chat.sessionTitle || t('simpleList.newChat'),
        folder,
        folderName,
        state: marks.awaitingInput ? 'waiting' : marks.running ? 'working' : asleep ? 'asleep' : 'idle',
        unread: marks.unread,
        helpers: marks.subagents,
      };
    };
    const inFolders = items.flatMap((item) => (item.kind === 'folder' ? item.folder.chats.map((chat) => slotOf(chat, item.folder.folderId, item.folder.name)) : []));
    const loose = items.flatMap((item) => (item.kind === 'chat' ? [slotOf(item.chat, null, null)] : []));
    return [...inFolders, ...loose];
  }, [items, busySessionIds, awaitingInputSessionIds, subagentRunningSessionIds, liveHostSessionIds, t]);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const painterRef = useRef<ReturnType<typeof createHaloPainter> | null>(null);
  // The latest slots and press, for the listeners set up once below.
  const slotsRef = useRef(slots);
  const onOpenRef = useRef(onOpenChat);
  useEffect(() => {
    slotsRef.current = slots;
    onOpenRef.current = onOpenChat;
  }, [slots, onOpenChat]);

  // The chat at the front and the chat under the pointer, by place on the hoop. The painter decides both each frame; they are state only so the
  // words and the cursor re-render when one actually changes.
  const [shown, setShown] = useState({ front: -1, hover: -1 });

  // The painter, the theme and the frame loop: set up once, for the life of the canvas.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const painter = createHaloPainter(canvas);
    painterRef.current = painter;
    painter.setSlots(slotsRef.current);

    const theme = () => painter.readTheme(canvas);
    theme();
    // The theme is a class and a few properties on the document's root: re-read the colours whenever it changes.
    const themed = new MutationObserver(theme);
    themed.observe(document.documentElement, { attributes: true });
    const calm = window.matchMedia('(prefers-reduced-motion: reduce)');
    const stillness = () => painter.setStill(calm.matches);
    stillness();
    calm.addEventListener('change', stillness);

    let frame = 0;
    const loop = (now: number) => {
      // A page held under another is not seen: nothing is drawn for it until it is back.
      if (!isPageHeld()) {
        const next = painter.frame(now);
        setShown((held) => (held.front === next.front && held.hover === next.hover ? held : next));
      }
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);

    // The wheel is the hoop's while the pointer is on it: a passive listener could not keep the page from scrolling under it.
    const onWheel = (event: WheelEvent) => {
      if (painter.wheel(event.deltaY || event.deltaX, event.timeStamp)) event.preventDefault();
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });

    return () => {
      cancelAnimationFrame(frame);
      themed.disconnect();
      calm.removeEventListener('change', stillness);
      canvas.removeEventListener('wheel', onWheel);
      painterRef.current = null;
    };
  }, [isPageHeld]);

  useEffect(() => {
    painterRef.current?.setSlots(slots);
  }, [slots]);
  useEffect(() => {
    painterRef.current?.resize(width, height, Math.min(2, window.devicePixelRatio || 1));
  }, [width, height]);
  useEffect(() => {
    painterRef.current?.setNames(names);
  }, [names]);
  const linkId = link?.id ?? null;
  const linkWay = link?.way ?? 'in';
  useEffect(() => {
    painterRef.current?.setLink(linkId === null ? null : { id: linkId, way: linkWay }, coreRadius);
  }, [linkId, linkWay, coreRadius]);
  const middle = haloMiddle(width, height);

  const at = (event: { clientX: number; clientY: number; currentTarget: HTMLCanvasElement }): [number, number] => {
    const box = event.currentTarget.getBoundingClientRect();
    return [event.clientX - box.left, event.clientY - box.top];
  };

  // What is read out: the chat under the pointer while there is one (the far half is read by pointing at it), else the one at the front.
  const read = slots[shown.hover] ?? slots[shown.front] ?? null;
  const stateWords = read === null ? '' : [
    read.state === 'waiting' ? t('simpleList.awaitingInput') : read.state === 'working' ? t('simpleList.running') : read.state === 'idle' ? t('board.idle') : t('board.asleep'),
    read.unread ? t('simpleList.unread') : null,
    read.helpers ? t('simpleList.subagentsRunning') : null,
  ].filter(Boolean).join(' · ');
  const front = slots[shown.front] ?? null;

  return (
    <div data-sessions-halo={slots.length} data-halo-front={front?.id} className="flex min-w-0 flex-none flex-col items-center" style={{ width }}>
      <div className="relative" style={{ width, height }}>
        <canvas
          ref={canvasRef}
          // A slider over the chats: the arrows turn it, and its value is the chat at the front, in words.
          role="slider"
          tabIndex={slots.length === 0 ? -1 : 0}
          aria-label={t('board.halo')}
          aria-orientation="horizontal"
          aria-valuemin={1}
          aria-valuemax={Math.max(1, slots.length)}
          aria-valuenow={shown.front + 1}
          aria-valuetext={front === null ? undefined : [front.folderName, front.title, stateWords].filter(Boolean).join(', ')}
          className={cn('absolute inset-0 block touch-none outline-none', shown.hover !== -1 && 'cursor-pointer')}
          style={{ width, height }}
          onPointerDown={(event) => {
            if (painterRef.current?.pointerDown(...at(event))) event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => { painterRef.current?.pointerMove(...at(event)); }}
          onPointerUp={(event) => {
            const press = painterRef.current?.pointerUp() ?? null;
            const chat = press === null ? undefined : slotsRef.current[press.open];
            if (chat !== undefined) onOpenRef.current(chat.id);
            // A finger leaves nothing under it once it has lifted.
            if (event.pointerType !== 'mouse') painterRef.current?.pointerLeave();
          }}
          onPointerCancel={() => { painterRef.current?.pointerUp(); painterRef.current?.pointerLeave(); }}
          onPointerLeave={() => painterRef.current?.pointerLeave()}
          onFocus={(event) => painterRef.current?.setFocused(event.currentTarget.matches(':focus-visible'))}
          onBlur={() => painterRef.current?.setFocused(false)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              const chat = slotsRef.current[painterRef.current?.front() ?? -1];
              if (chat === undefined) return;
              event.preventDefault();
              onOpenRef.current(chat.id);
            } else if (painterRef.current?.key(event.key)) {
              event.preventDefault();
            }
          }}
        />
        {/* The core, in the hoop's middle and over the canvas. The band passes clear of it, so each keeps its own presses. */}
        <div
          data-halo-middle=""
          className="pointer-events-none absolute grid -translate-x-1/2 -translate-y-1/2 place-items-center [&>*]:pointer-events-auto"
          style={{ left: middle.x, top: middle.y }}
        >
          {children}
        </div>
      </div>
      {reading && (
        // Two lines, each on one line: where it is and what it is called, then how it stands. Drawn `aria-hidden`: the slider's value says the same.
        <div data-halo-reading="" aria-hidden="true" className="flex h-[28px] w-full min-w-0 flex-col items-center text-center">
          {read !== null && (
            <>
              <p className={cn(EYEBROW, 'max-w-full truncate')}>
                {read.folderName !== null && `${read.folderName} › `}
                <span className={read.state === 'waiting' ? 'text-accent-ink' : 'text-foreground'}>{read.title}</span>
              </p>
              <p className={cn(EYEBROW, 'max-w-full truncate')}>{stateWords}</p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
