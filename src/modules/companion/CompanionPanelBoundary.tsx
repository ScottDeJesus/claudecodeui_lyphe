import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { ViewBoundary } from '@/shared/ui';

type CompanionPanelBoundaryProps = {
  /** Her panel, hooks and all: a fault anywhere inside it is held by this boundary. */
  children: ReactNode;
};

/**
 * Where the banner `ViewBoundary` draws stands when her panel cannot be drawn. The banner is a block made for a tab's column;
 * here it is laid over the page at the shell's foot, in her corner, on the card's ground, so it takes no room from the chat
 * and the applications beside her. The surround itself draws no box (`contents`), so her panel's containing block is still the
 * shell. The banner's second line names Cerberus, the first place the boundary was made for, and is not drawn here: its button
 * says what a reload does.
 */
const BANNER_PLACE = [
  'contents',
  '[&>[role=alert]]:absolute [&>[role=alert]]:bottom-3 [&>[role=alert]]:right-3 [&>[role=alert]]:z-[61]',
  '[&>[role=alert]]:w-[26rem] [&>[role=alert]]:max-w-[calc(100%-1.5rem)] [&>[role=alert]]:rounded-xl [&>[role=alert]]:bg-card [&>[role=alert]]:p-0 [&>[role=alert]]:shadow-lift',
  '[&>[role=alert]_p+p]:hidden',
].join(' ');

/**
 * Used by this module's CompanionPanel, the one panel the workspace frame draws: her panel in a boundary of her own. She stands
 * beside the workspace's own boundary, not inside it, so a fault while she draws (a render the page gives up on, a picture she
 * sent that cannot be read) would climb to the app's whole-screen error card and take the chat and every application with it.
 * Held here, only her panel gives way: a banner says she could not be shown, and the page goes on.
 */
export function CompanionPanelBoundary({ children }: CompanionPanelBoundaryProps) {
  const { t } = useTranslation();
  return (
    <div className={BANNER_PLACE}>
      <ViewBoundary view={t('companion.defaultName')}>{children}</ViewBoundary>
    </div>
  );
}
