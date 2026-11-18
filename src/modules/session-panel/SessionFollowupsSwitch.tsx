import { ListChecks } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { FollowupsContext, FollowupsWidgetBody } from '@/modules/followups';
import { useSessionPanel } from '@/modules/session-panel/context/sessionPanelContext';
import { Button, Sheet } from '@/shared/ui';

/**
 * THE WAY TO THE CHAT'S NEXT STEPS: a checklist button in the chat's head, beside the panel's switch, with how many of the
 * chat's follow-ups are open. It is a toggle, and the one way to put them away again.
 *
 * AT A DESK it shows and hides them where they stand, in the chat's side column under its core (`SessionFollowups`); the choice
 * is remembered. ON A NARROW SCREEN, where the page keeps no place for them, it opens them as a window over the chat (the kit's
 * `Sheet`: its own back arrow, Escape or a press outside shuts it), with each tick working as it does in the column.
 *
 * Not drawn while the chat has no follow-up at all, or with no provider over it. Under a finger it is its mark and the count
 * alone, drawn 28 px tall to fit the chat's one-line head, with a transparent `::before` that keeps its catch at 44 px.
 *
 * Used by project-workspace's `ChatHead`, at the end of the head.
 */
export function SessionFollowupsSwitch() {
  const { t } = useTranslation();
  const panel = useSessionPanel();
  if (panel === null || (panel.followups.items?.length ?? 0) === 0) return null;

  const { followups, followupsOpen: open, followupsApart: apart, setFollowupsOpen } = panel;
  const count = followups.openCount;
  const name = count > 0 ? t('sessionPanel.followups.nameWithOpen', { count }) : t('sessionPanel.followups.name');
  return (
    <>
      <Button
        data-session-followups-switch={open ? 'open' : 'shut'}
        // Lit quietly while they are on show: they stand open most of the time at a desk, and the accent is kept for a word owed.
        variant={open ? 'tonal' : 'outline'}
        size="sm"
        className="relative h-9 flex-none gap-1.5 px-2.5 finger:h-7 finger:min-w-7 finger:px-1.5 finger:before:absolute finger:before:-inset-2 finger:before:content-['']"
        aria-pressed={open}
        aria-label={name}
        title={name}
        onClick={() => setFollowupsOpen(!open)}
      >
        <ListChecks aria-hidden="true" />
        <span className="finger:hidden">{t('sessionPanel.followups.name')}</span>
        {count > 0 && <span className="font-mono text-xs tabular-nums">{count}</span>}
      </Button>
      {!apart && (
        <Sheet open={open} onClose={() => setFollowupsOpen(false)} title={t('sessionPanel.followups.name')} width="min(420px, 100%)">
          <div data-session-followups-window="">
            <FollowupsContext.Provider value={followups}>
              <FollowupsWidgetBody />
            </FollowupsContext.Provider>
          </div>
        </Sheet>
      )}
    </>
  );
}
