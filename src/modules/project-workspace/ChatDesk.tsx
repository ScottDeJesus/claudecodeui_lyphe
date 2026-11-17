import '@/modules/project-workspace/chatDesk.css';

import { useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';

import { RoadmapCircle } from '@/modules/roadmap';
import { SessionFollowups } from '@/modules/session-panel';
import { ChatCorePlaceProvider } from '@/shared/context/ChatCorePlaceContext';

/** Where the roadmap's circle rests over the side column: its middle this far down, and its radius. The station's own two numbers. */
const CIRCLE_TOP = 66;
const CIRCLE_RADIUS = 33;

type ChatDeskProps = {
  /** The side column's width in px, or 0 for none: a narrow screen, the chat floating, no project chosen (`useChatDeskSide`). */
  side: number;
  /** The chat's head (`ChatHead`), the first line over the chat; null while another header stands in for it. */
  head: ReactNode;
  /** The chat's pane. It keeps one place in the tree whether or not the column is drawn, so the chat is never remounted by a resize. */
  children: ReactNode;
};

/**
 * THE CHAT'S SCREEN, LAID OUT. On a narrow screen it is the head and the chat under it, one column, the chat's core beside its line.
 *
 * AT A DESK IT IS THE STATION'S ARRANGEMENT: a column at the start, and the chat beside it as a surface of its own, wider (its words
 * run to 1100 px). In the column, from the top: the roadmap as its small circle (`RoadmapCircle`: a press stands the whole stack up
 * over the chat's screen, the back arrow or Escape lays it down), the chat's core, and the chat's follow-ups with their ticks
 * (`SessionFollowups`). The core is the composer's own (`ChatCore`), drawn into the box kept for it here (`ChatCorePlaceProvider`),
 * so its rings, its readings and its presses are the ones it has beside the line.
 *
 * What the chat put on its panel is reached from the head (`SessionPanelSwitch`) and stands in the chat's place, at every width.
 *
 * Used by `WorkspaceMain`, as the Chat view's pane.
 */
export function ChatDesk({ side, head, children }: ChatDeskProps) {
  // The box the core is drawn into. State, not a ref: the core's portal is made when the box arrives and unmade when it leaves.
  const [corePlace, setCorePlace] = useState<HTMLDivElement | null>(null);
  const beside = side > 0;

  return (
    <ChatCorePlaceProvider value={beside ? corePlace : null}>
      <div data-chat-desk={beside ? 'side' : 'plain'} className="chat-desk" style={{ '--chat-side': `${side}px` } as CSSProperties}>
        {beside && (
          <aside data-chat-side="" className="chat-desk__side">
            <div ref={setCorePlace} data-chat-core-place="" className="chat-desk__core" />
            <SessionFollowups className="chat-desk__followups" />
          </aside>
        )}
        <div className="chat-desk__main">
          {head}
          <div className="chat-desk__body">{children}</div>
        </div>
        {beside && <RoadmapCircle rest={{ cx: side / 2, cy: CIRCLE_TOP, radius: CIRCLE_RADIUS }} />}
      </div>
    </ChatCorePlaceProvider>
  );
}
