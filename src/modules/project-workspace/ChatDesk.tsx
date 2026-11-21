import '@/modules/project-workspace/chatDesk.css';

import { useEffect, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';

import { RoadmapCircle } from '@/modules/roadmap';
import { SessionFollowups } from '@/modules/session-panel';
import { SessionsHalo } from '@/modules/sidebar';
import { ChatCorePlaceProvider } from '@/shared/context/ChatCorePlaceContext';
import { useStationDoors } from '@/shared/context/StationLayerContext';
import { hoopHeightFor, hoopMiddle } from '@/shared/ui';

/** Where the roadmap's circle rests over the side column: its middle at least this far down, and its radius. The station's own two numbers. */
const CIRCLE_TOP = 66;
/** How far the circle's middle stands above the core's centre, in px: the gap the two kept when the core stood at the column's top. */
const CIRCLE_OVER_CORE = 191;
const CIRCLE_RADIUS = 33;

/** The air kept between the column's edges and the hoop of chats round the core, in px at each side. */
const HOOP_INSET = 12;
/** The core's own radius as the hoop reads it, in px: about half the square `ChatCore` draws it in there. No line is drawn from it (no `link`). */
const CORE_RADIUS = 60;
/**
 * How far the hoop round the chat's core leans (`SessionsHalo`'s `lean`): less than the station's own, so its opening is deep enough
 * for the chat's larger core with its rings and its helpers round it.
 */
const HOOP_LEAN = 0.72;

/** The hoop's reading line, drawn under its circle inside its box (the kit `Hoop`'s `data-hoop-reading`, 28 px tall): it lifts the circle, and the core in it, by half as much. */
const HOOP_READING = 28;

type ChatDeskProps = {
  /** The side column's width in px, or 0 for none: a narrow screen, the chat floating, no project chosen (`useChatDeskSide`). */
  side: number;
  /** The open chat, by id; null on a chat not yet begun. The hoop of chats round the core arrives turned to it. */
  sessionId: string | null;
  /** The chat's pane. It keeps one place in the tree whether or not the column is drawn, so the chat is never remounted by a resize. */
  children: ReactNode;
};

/**
 * THE CHAT'S SCREEN UNDER ITS HEAD, LAID OUT (the head, `ChatHead`, is every screen's, over the whole of this). On a narrow screen it
 * is the chat, one column, the chat's core beside its line.
 *
 * AT A DESK IT IS THE STATION'S ARRANGEMENT: a column at the start, and the chat beside it as a surface of its own, wider (its words
 * run to 1100 px). In the column, from the top: the roadmap as its small circle (`RoadmapCircle`: a press stands the whole stack up
 * over the chat's screen, the back arrow or Escape lays it down), the chat's core, and the chat's follow-ups with their ticks
 * (`SessionFollowups`). The core is the composer's own (`ChatCore`), drawn into the box kept for it here (`ChatCorePlaceProvider`),
 * so its rings, its readings and its presses are the ones it has beside the line.
 *
 * ROUND THE CORE, THE OTHER CHATS: the station's hoop (`SessionsHalo`), every chat a slot, this one at the front as the hoop arrives.
 * Turn it and the chat at the front is read out under it; press that chat and it opens here, in this chat's place. While the core's
 * own rings are open round it the hoop steps out of their way (the stylesheet's rule).
 *
 * What the chat put on its panel is reached from the head (`SessionPanelSwitch`) and stands in the chat's place, at every width.
 *
 * Used by `WorkspaceMain`, as the Chat view's pane.
 */
export function ChatDesk({ side, sessionId, children }: ChatDeskProps) {
  const doors = useStationDoors();
  // The box the core is drawn into. State, not a ref: the core's portal is made when the box arrives and unmade when it leaves.
  const [corePlace, setCorePlace] = useState<HTMLDivElement | null>(null);
  // The desk's own height, so the circle can stand over the core where the column puts it (level with the chat's middle).
  const [desk, setDesk] = useState<HTMLDivElement | null>(null);
  const [deskHeight, setDeskHeight] = useState(0);
  useEffect(() => {
    if (!desk) return undefined;
    const observer = new ResizeObserver(([entry]) => setDeskHeight(entry.contentRect.height));
    observer.observe(desk);
    return () => observer.disconnect();
  }, [desk]);
  // The core's centre is the chat surface's middle: its 16 px of air above and 12 px below put that 2 px under the desk's.
  const circleY = Math.max(CIRCLE_TOP, deskHeight / 2 + 2 - CIRCLE_OVER_CORE);
  const beside = side > 0;
  // The hoop's box holds the core this many px above its own middle (the circle's middle, `hoopMiddle`, and the reading line under the
  // circle); the column lowers the hoop by as much, so the core's centre, not the hoop's, is level with the chat's (`--core-lift`).
  const hoopWidth = side - 2 * HOOP_INSET;
  const hoopHeight = hoopHeightFor(hoopWidth, HOOP_LEAN);
  const coreLift = beside ? HOOP_READING / 2 + hoopHeight / 2 - hoopMiddle(hoopWidth, hoopHeight, HOOP_LEAN).y : 0;

  return (
    <ChatCorePlaceProvider value={beside ? corePlace : null}>
      <div ref={setDesk} data-chat-desk={beside ? 'side' : 'plain'} className="chat-desk" style={{ '--chat-side': `${side}px` } as CSSProperties}>
        {beside && (
          <aside data-chat-side="" className="chat-desk__side" style={{ '--core-lift': `${coreLift}px` } as CSSProperties}>
            <div className="chat-desk__core">
              <SessionsHalo
                enabled
                width={hoopWidth}
                lean={HOOP_LEAN}
                names={false}
                reading
                link={null}
                coreRadius={CORE_RADIUS}
                current={sessionId}
                onOpenChat={(id) => doors.openChatInWorkspace(id)}
              >
                {/* The core's box: as wide as the column, since the core measures the room for its open disc from it. */}
                <div ref={setCorePlace} data-chat-core-place="" className="chat-desk__place" style={{ width: side }} />
              </SessionsHalo>
            </div>
            <SessionFollowups className="chat-desk__followups" />
          </aside>
        )}
        <div className="chat-desk__main">
          <div className="chat-desk__body">{children}</div>
        </div>
        {beside && <RoadmapCircle rest={{ cx: side / 2, cy: circleY, radius: CIRCLE_RADIUS }} />}
      </div>
    </ChatCorePlaceProvider>
  );
}
