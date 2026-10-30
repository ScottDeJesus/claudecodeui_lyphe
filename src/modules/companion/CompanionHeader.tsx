import { AudioLines, Crosshair, LayoutDashboard, X } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { CompanionControls } from '@/modules/companion/CompanionControls';
import { CompanionStatus } from '@/modules/companion/CompanionStatus';
import type { CompanionModel, CompanionPicture } from '@/shared/companion-types';
import type { CompanionPresence, CompanionVoice } from '@/shared/types';
import { Button, Tooltip } from '@/shared/ui';

type CompanionHeaderProps = {
  /** Her name as he set it, or the default while the picture loads. */
  name: string;
  /** Null while the picture loads: every control waits. The controls read it (model, Live, focus, Stop, Clear); the status line does not. */
  picture: CompanionPicture | null;
  /**
   * What she is doing on this page, from `useCompanionPresence` (the only reader of her process, her activity, the page's
   * press and its player): the status line reads it alone, for its words, the chat and the files they name, and the walk's place.
   */
  presence: CompanionPresence;
  /**
   * This page's voice switch: drawn in a row of its own under the controls, "Voice on this device". Absent, there is no
   * row.
   */
  voice?: Pick<CompanionVoice, 'on' | 'setOn'>;
  onModelChange: (model: CompanionModel) => Promise<void>;
  onLiveChange: (live: boolean) => Promise<void>;
  onInterrupt: () => Promise<void>;
  onClear: () => Promise<void>;
  onClose: () => void;
  /** The station button beside her close: the door into Kaylee Station (`CompanionPanel` binds `openStation`). Absent, no button is drawn. */
  onOpenStation?: () => void;
};

/**
 * The top of her panel, in the order the eye wants it: who and what she is doing, the chat "it" means, then the
 * controls. Drawn by this module's CompanionPanel; the status line and the controls are `CompanionStatus` and
 * `CompanionControls`, the pieces the station draws too, so this file keeps only what is the panel's own.
 *
 * ROW ONE: her mark, her name, and the status line under it (`CompanionStatus`: `role="status"`, so a change is announced;
 * it draws what she is doing from `presence` alone, her process included); at the far end Stop — only while her turn runs,
 * the one urgent press, so it stands beside the way out (the controls own it and draw it into this row's `stopSlot`) — then,
 * given `onOpenStation`, the station button (on a phone her panel is the full-screen sheet he talks to her in, and the
 * command palette is two presses away behind the drawer) and the panel's own close. ROW TWO, only while she holds one: the
 * focus chat, "Focus · Kanban lanes · its project", the chat "it" and "this" mean in what she says. Then `CompanionControls`:
 * ROW THREE, the model picker, the Live switch and Clear behind its question; ROW FOUR, given `voice`, "Voice on this
 * device".
 */
export function CompanionHeader({ name, picture, presence, voice, onModelChange, onLiveChange, onInterrupt, onClear, onClose, onOpenStation }: CompanionHeaderProps) {
  const { t } = useTranslation();
  // The node row one keeps for Stop. The controls own Stop (its busy state and its refusal toast) and draw it here, so it stands
  // beside the way out as it always has; a DOM node only exists once the row has mounted, hence state, set by the ref.
  const [stopSlot, setStopSlot] = useState<HTMLElement | null>(null);
  const focus = picture?.focus ?? null;

  return (
    <div data-companion-header="" className="shrink-0 border-b border-border bg-card">
      <div className="flex items-center gap-2.5 py-2.5 pl-3 pr-2">
        <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-full bg-accent-soft text-accent-ink">
          <AudioLines className="size-4" strokeWidth={1.75} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold leading-5 text-foreground">{name}</h2>
          <CompanionStatus presence={presence} emphasis="panel" />
        </div>
        {/* `contents`: the slot has no box of its own, so the row's gap sees Stop alone, and none when no turn runs. */}
        <div ref={setStopSlot} className="contents" />
        {onOpenStation && (
          // The press is the thing itself (it opens the station), so the tooltip only repeats the name the icon carries.
          <Tooltip content={t('companion.panel.station', { defaultValue: 'Open Kaylee Station' })} position="bottom">
            <Button
              variant="ghost" size="icon" data-companion-station=""
              aria-label={t('companion.panel.station', { defaultValue: 'Open Kaylee Station' })}
              // The close's own catch; under a finger the two would overlap by 2px across the row's 10px gap, so this one steps 2px aside.
              className="relative h-8 w-8 shrink-0 text-muted-foreground before:absolute before:-inset-1 before:content-[''] hover:text-foreground [@media(pointer:coarse)]:mr-0.5 [@media(pointer:coarse)]:before:-inset-1.5"
              onClick={onOpenStation}
            >
              <LayoutDashboard aria-hidden="true" />
            </Button>
          </Tooltip>
        )}
        <Tooltip content={t('companion.panel.close', { name })} position="bottom">
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('companion.panel.close', { name })}
            // 32px to look at; a transparent catch makes it 40px to hit under a mouse and 44px under a finger, Verve's
            // touch floor — on a phone this is the sheet's only way out.
            className="relative h-8 w-8 shrink-0 text-muted-foreground before:absolute before:-inset-1 before:content-[''] hover:text-foreground [@media(pointer:coarse)]:before:-inset-1.5"
            onClick={onClose}
          >
            <X aria-hidden="true" />
          </Button>
        </Tooltip>
      </div>

      {focus && (
        <p data-companion-focus="" className="flex min-w-0 items-center gap-1.5 px-3 pb-2.5 text-xs text-muted-foreground">
          <Crosshair aria-hidden="true" className="size-3.5 shrink-0" />
          <span className="shrink-0">{t('companion.focus')}</span>
          <span className="min-w-0 truncate">
            <span className="font-medium text-foreground">{focus.name}</span>
            {' · '}
            {focus.project}
          </span>
        </p>
      )}

      <CompanionControls
        name={name}
        picture={picture}
        presence={presence}
        voice={voice}
        layout="rows"
        onModelChange={onModelChange}
        onLiveChange={onLiveChange}
        onInterrupt={onInterrupt}
        onClear={onClear}
        stopSlot={stopSlot}
      />
    </div>
  );
}
