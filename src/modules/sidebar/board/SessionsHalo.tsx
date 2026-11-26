import { useMemo } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { useSimpleChatList } from '@/modules/sidebar/hooks/useSimpleChatList';
import { chatMarks, subagentDots } from '@/modules/sidebar/utils/simpleChatMarks';
import { useSessionHostLiveSet } from '@/shared/context/SessionHostLivenessContext';
import { useAwaitingInputSessionIdSet, useBusySessionIdSet, useSubagentRunningSessionIdSet } from '@/shared/context/SessionProtectionContext';
import { useSubagentModelsBySession } from '@/shared/context/subagentModelsContext';
import type { HoopSlot, HoopSlotState, RecentConversationListItem } from '@/shared/types';
import { Hoop } from '@/shared/ui';

type SessionsHaloProps = {
  /** False until the halo's page has been on screen once: until then no page of the feed is read and no socket subscription is held. */
  enabled: boolean;
  /** The hoop's width, in px. It is as deep as it leans at that width (`hoopHeightFor`); the words stand under it. */
  width: number;
  /**
   * How far the hoop is tipped toward the reader, as the share of its width its depth takes; absent, the hoop's own lean. A hoop
   * round a larger core leans less, so its opening has the room for that core.
   */
  lean?: number;
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
  /**
   * The chat the hoop stands in, by id, where it stands in one: the hoop arrives with that chat at the front, and comes back to it when
   * the chat on screen changes. Absent where the hoop belongs to no chat (the station), which opens on the first chat that waits.
   */
  current?: string | null;
  /** The chat at the front, pressed (or Enter on the hoop): its page shows it. */
  onOpenChat: (sessionId: string) => void;
  /** What stands in the hoop's middle: the companion's core. It is drawn over the canvas, so its own press stays its own. */
  children: ReactNode;
};

/**
 * THE HALO: the simple chat list as the kit's hoop (`Hoop`) round the companion's core, a slot for every chat, the chats of a folder side
 * by side. It is the sessions board (`SessionsBoard`) in one object: the same feed (`useSimpleChatList`, a copy of its rows kept on the
 * same frames) and the same four marks (`chatMarks`), each drawn in its own place on the slot, so the whole of what is running, waiting,
 * unread or asleep reads at a glance without a list: the square (dark asleep, lit awake, dashes turning while its turn runs, the accent
 * breathing while it waits on the reader), the top edge lit for a reply unread, a bead at the foot for each subagent at work.
 *
 * Turned and pressed as every hoop is: the slot at the front is read out under it (its folder, its name, its state in the board's own
 * words), a press on another slot brings it round, and A PRESS ON THE SLOT AT THE FRONT, or Enter, OPENS ITS CHAT (`onOpenChat`). With a mouse a
 * press on ANY slot opens its chat and stands at the front at once, no turn drawn (`openOnTurn`); a finger turns first and opens on the second press.
 *
 * THE ORDER is the feed's: folders in the order the list draws them, each folder's chats in its own order, the chats in no folder last. It
 * reads one page of the feed, as the board does before "Load more"; a list longer than a page shows its first page.
 *
 * THE CORE'S DEALINGS WITH A CHAT are drawn on it (`link`): while the companion reads a chat or writes to one, a line runs between the core
 * and that chat's slot, and a bead travels it the way the words go.
 *
 * `data-sessions-halo` marks its root and reads how many chats it holds; `data-hoop-front` the chat at the front, by id.
 *
 * IN A CHAT (`current`) it arrives turned to that chat, so the slot at the front is where the reader is and the rest are a turn away.
 *
 * Exported through the sidebar barrel for the station's scene (`StationKaylee`), which stands the companion's core in its middle, and
 * for the chat's desk (project-workspace's `ChatDesk`), which stands the chat's own core there.
 */
export function SessionsHalo({ enabled, width, lean, names, reading, link, coreRadius, current = null, onOpenChat, children }: SessionsHaloProps) {
  const { t } = useTranslation(['sidebar', 'common']);
  const busySessionIds = useBusySessionIdSet();
  const awaitingInputSessionIds = useAwaitingInputSessionIdSet();
  const subagentRunningSessionIds = useSubagentRunningSessionIdSet();
  const subagentModels = useSubagentModelsBySession();
  const liveHostSessionIds = useSessionHostLiveSet();
  // The feed keeps the chat the hoop stands in in view; at the station no chat is open, so it is asked to keep none.
  const { items } = useSimpleChatList(current, enabled);

  const slots = useMemo(() => {
    const slotOf = (chat: RecentConversationListItem, folder: string | null, folderName: string | null): HoopSlot => {
      const marks = chatMarks({
        unread: chat.unread,
        isSelected: false,
        isRunning: busySessionIds.has(chat.sessionId),
        isAwaitingInput: awaitingInputSessionIds.has(chat.sessionId),
        isSubagentRunning: subagentRunningSessionIds.has(chat.sessionId),
      });
      // Only a Claude chat can have a session host, so only one can be asleep, and none is until the server's first census has arrived.
      const asleep = liveHostSessionIds !== null && chat.provider === 'claude' && !liveHostSessionIds.has(chat.sessionId);
      const state: HoopSlotState = marks.awaitingInput ? 'waiting' : marks.running ? 'working' : asleep ? 'asleep' : 'idle';
      const beads = subagentDots(marks.subagents, subagentModels.get(chat.sessionId));
      // How it stands, in the board's own words: its state, then a reply unread and subagents at work.
      const words = [
        state === 'waiting' ? t('simpleList.awaitingInput') : state === 'working' ? t('simpleList.running') : state === 'idle' ? t('board.idle') : t('board.asleep'),
        marks.unread ? t('simpleList.unread') : null,
        beads.length > 0 ? t('simpleList.subagentsRunning') : null,
      ].filter(Boolean).join(' · ');
      return {
        id: chat.sessionId,
        group: folder,
        groupName: folderName,
        title: chat.sessionTitle || t('simpleList.newChat'),
        words,
        state,
        edge: marks.unread ? 1 : 0,
        beads,
      };
    };
    const inFolders = items.flatMap((item) => (item.kind === 'folder' ? item.folder.chats.map((chat) => slotOf(chat, item.folder.folderId, item.folder.name)) : []));
    const loose = items.flatMap((item) => (item.kind === 'chat' ? [slotOf(item.chat, null, null)] : []));
    return [...inFolders, ...loose];
  }, [items, busySessionIds, awaitingInputSessionIds, subagentRunningSessionIds, subagentModels, liveHostSessionIds, t]);

  return (
    <Hoop
      slots={slots}
      width={width}
      lean={lean}
      names={names}
      reading={reading}
      label={t('board.halo')}
      link={link}
      coreRadius={coreRadius}
      current={current}
      onOpen={onOpenChat}
      openOnTurn="mouse"
      marks={{ 'data-sessions-halo': slots.length }}
    >
      {children}
    </Hoop>
  );
}
