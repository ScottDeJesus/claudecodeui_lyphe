import type { ComponentProps, ReactNode, Ref } from 'react';
import { useTranslation } from 'react-i18next';

import type { PanelPlacement } from '@/shared/types';
import { Card, ResizeGrip } from '@/shared/ui';
import { cn } from '@/shared/utils';

type GripHandler = ComponentProps<typeof ResizeGrip>['onResize'];

type ChatHostPanelProps = {
  /** Where the panel stands, from `panelPlacement`: its rect and the corner that holds the grip. */
  placement: PanelPlacement;
  /** The panel's top: ChatHostHeader, with the conversation part filled by project-workspace. */
  header: ReactNode;
  /** Handed to the body `div`, which the chat's node is adopted into. */
  bodyRef: Ref<HTMLDivElement>;
  /** The grip's live delta since the press. The caller turns it into a size for the grip's corner. */
  onResize: GripHandler;
  /** The grip's delta once, at release; the size is written then and not before. */
  onResizeEnd: GripHandler;
};

/**
 * Where the resize grip stands inside the panel, one class per corner. The kit's grip paints and the caller
 * places it; it hangs 2px in from the corner so its glyph clears the frame's rounded corner, which
 * `overflow-hidden` would otherwise cut off.
 */
const GRIP_CORNER: Record<PanelPlacement['grip'], string> = {
  'top-left': 'left-0.5 top-0.5',
  'top-right': 'right-0.5 top-0.5',
  'bottom-left': 'bottom-0.5 left-0.5',
  'bottom-right': 'bottom-0.5 right-0.5',
};

/**
 * The room the header keeps for a grip in a TOP corner: 28px, past the grip's 18px, and 36px under a finger
 * where the grip is 24px. It rides on the two custom properties ChatHostHeader reads. A bottom corner asks
 * for nothing: the grip there sits over the chat's own corner, not over anything the header holds.
 */
const HEADER_CLEARANCE: Record<PanelPlacement['grip'], string> = {
  'top-left': '[--chat-host-header-left:1.75rem] [@media(pointer:coarse)]:[--chat-host-header-left:2.25rem]',
  'top-right': '[--chat-host-header-right:1.75rem] [@media(pointer:coarse)]:[--chat-host-header-right:2.25rem]',
  'bottom-left': '',
  'bottom-right': '',
};

/**
 * The room the body keeps for a grip in a BOTTOM corner, under a finger only: 20px, so the grip's 24px box
 * (and its 2px inset) sits below the composer instead of over its corner. The composer keeps 8px from the
 * panel's edges on a phone, which puts a 24px grip on top of the send button (right) or the composer's own
 * controls (left); a mouse's 16px grip clears the composer's 24px foot on a desktop without asking for any.
 */
const BODY_CLEARANCE: Record<PanelPlacement['grip'], string> = {
  'top-left': '',
  'top-right': '',
  'bottom-left': '[@media(pointer:coarse)]:pb-5',
  'bottom-right': '[@media(pointer:coarse)]:pb-5',
};

/**
 * Used by this module's ChatHostFloating: the floating chat's frame beside the FAB, drawn over an application.
 *
 * ONE FRAME, THREE PARTS, TOP TO BOTTOM: the header, the body the chat is adopted into, and the grip at the
 * corner away from the FAB. The frame is the kit's Card — its surface, its border, its rounded corner — with the
 * two things a card resting on a page does not need: a firmer border (`border-input`, the strong one) so a dark
 * panel over a dark application still has an edge, and the scale's `--shadow-lift` (the rung between a menu and
 * a modal) so it reads as an object standing over the application and not as a pane of it. The shadow is one
 * inline style, as the composer's menus spell theirs: the token has no Tailwind name.
 *
 * `z-[45]` is set against the shell's stacking context: above the application layer (z-40) so the panel is
 * never covered by the app it floats over, below the FAB (60) so the reader's way out is always on top of it,
 * and below the mobile sidebar drawer (z-50), which still slides in over everything. Dialogs and menus stay
 * above it because they portal to `body`.
 *
 * THE BODY is a column that takes what the header leaves (`min-h-0`, so a tall transcript scrolls inside it and
 * never pushes the frame; on a phone, a grip in a bottom corner gets its own 20px band under the composer). It
 * is drawn on the canvas ground the chat has in its tab, so the composer and message cards sit on the surface
 * they were made for, and the header on the card ground above it reads as chrome. It is empty here on purpose:
 * the chat's node is moved into it by `moveTo`, so the live chat is never rendered twice and never remounted.
 *
 * The panel measures nothing and moves nothing. Every position arrives in `placement`, so a drag of the FAB
 * that re-runs `panelPlacement` re-renders this frame and nothing else.
 */
export function ChatHostPanel({ placement, header, bodyRef, onResize, onResizeEnd }: ChatHostPanelProps) {
  const { t } = useTranslation();

  return (
    <Card
      role="region"
      aria-label={t('chatHost.panelLabel')}
      data-chat-host-panel=""
      data-grip={placement.grip}
      className={cn('fixed z-[45] flex flex-col overflow-hidden border-input', HEADER_CLEARANCE[placement.grip])}
      style={{
        left: placement.left,
        top: placement.top,
        width: placement.width,
        height: placement.height,
        boxShadow: 'var(--shadow-lift)',
      }}
    >
      {header}
      <div
        ref={bodyRef}
        data-chat-host-body=""
        className={cn('flex min-h-0 flex-1 flex-col bg-background', BODY_CLEARANCE[placement.grip])}
      >
        {/* Empty for React: the chat's node is moved in by moveTo(body, true), in useFloatingPanel's layout effect. */}
      </div>
      <div className={cn('absolute', GRIP_CORNER[placement.grip])}>
        <ResizeGrip
          label={t('chatHost.resize')}
          corner={placement.grip}
          // The caller turns each delta into a size for this corner, clamped live; the size is written once, at release.
          onResize={onResize}
          onResizeEnd={onResizeEnd}
        />
      </div>
    </Card>
  );
}
