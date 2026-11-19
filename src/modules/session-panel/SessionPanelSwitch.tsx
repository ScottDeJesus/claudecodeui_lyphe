import { PanelLeft } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useSessionPanel } from '@/modules/session-panel/context/sessionPanelContext';
import { Button } from '@/shared/ui';

/**
 * THE WAY TO THE PANEL: a switch in the chat's head between the talk and what the chat put on its panel. With no panel it is not
 * drawn. Under a finger it is its mark alone, drawn 28 px tall to fit the chat's one-line head, with a transparent `::before`
 * that keeps its catch at 44 px. The chat's follow-ups have a switch of their own beside it (`SessionFollowupsSwitch`).
 *
 * Used by project-workspace's `ChatHead`, at the end of the head.
 */
export function SessionPanelSwitch() {
  const { t } = useTranslation();
  const panel = useSessionPanel();
  if (panel === null || panel.form === 'none') return null;

  const front = panel.view === 'panel';
  const name = t('sessionPanel.name');
  return (
    <Button
      data-session-panel-switch=""
      variant={front ? 'default' : 'outline'}
      size="sm"
      className="relative h-9 flex-none gap-1.5 px-2.5 finger:h-7 finger:min-w-7 finger:px-1.5 finger:before:absolute finger:before:-inset-2 finger:before:content-['']"
      aria-pressed={front}
      aria-label={name}
      title={name}
      onClick={() => panel.setView(front ? 'talk' : 'panel')}
    >
      <PanelLeft aria-hidden="true" />
      <span className="finger:hidden">{t('sessionPanel.name')}</span>
    </Button>
  );
}
