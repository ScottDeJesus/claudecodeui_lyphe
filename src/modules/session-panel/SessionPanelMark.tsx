import { ArrowRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useSessionPanel } from '@/modules/session-panel/context/sessionPanelContext';
import { Button } from '@/shared/ui';

/**
 * THE MARK IN THE TALK WHERE THE CHAT PUT A THING ON ITS PANEL: a button that names the version ("On the panel · V3 · Sync
 * engine") and, pressed, takes the reader to it, bringing the panel in front.
 *
 * It is drawn only while that version is still on the panel's line: one that was cleared or trimmed away leaves no button that
 * goes nowhere. With no panel over this part of the page (the floating chat, an exported transcript) it draws nothing.
 *
 * Used by the chat module's transcript (`ChatMessagesPane`), at the end of the turn that showed the version.
 */
export function SessionPanelMark({ versionId }: { versionId: number }) {
  const { t } = useTranslation();
  const panel = useSessionPanel();
  const version = panel?.versions.find((item) => item.id === versionId);
  if (panel === null || version === undefined) return null;

  const newest = panel.versions[panel.versions.length - 1];
  const goThere = () => {
    panel.lookAt(version.id === newest.id ? null : version.id);
    panel.setView('panel');
  };
  return (
    <Button data-session-panel-mark={version.id} variant="outline" size="sm" className="h-8 max-w-full gap-1.5 self-start finger:h-11" onClick={goThere}>
      <ArrowRight aria-hidden="true" className="flex-none" />
      <span className="min-w-0 truncate">{t('sessionPanel.mark', { n: version.version, title: version.title })}</span>
    </Button>
  );
}
