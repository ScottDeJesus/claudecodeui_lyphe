import { ExternalLink, LayoutGrid, MessageSquare, Minimize2, RotateCw, X } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useAppSwitcher } from '@/modules/app-switcher/context/AppSwitcherContext';
import { useCurrentApplication } from '@/modules/app-switcher/hooks/useCurrentApplication';
import { CHAT_TOGGLE_KEY } from '@/shared/constants';
import type { ChatDoor, SwitcherAction } from '@/shared/types';
import { formatShortcut } from '@/shared/utils';

/**
 * The switcher's five acts as data, in the order the operator reads them: Chat, Applications, Reload,
 * Close, Open in a new tab. The radial draws them as its items and the command palette as its
 * Applications group, both from this one list, so a label, an order or a disabled rule is never
 * written twice.
 *
 * Chat and Applications are always available. Reload, Close and Open in a new tab are about the
 * application in FRONT (`frontSide`'s pane) and are `disabled` while none is up. The palette keeps them in
 * place, greyed; the radial leaves a `disabled` act out and draws the rest.
 *
 * Exported through the module's barrel for project-workspace's command palette; the FAB and the
 * radial, inside the module, call it too. `chatDoor` comes from the caller because only the
 * project-workspace module knows which conversation an application brings.
 */
export function useSwitcherActions(chatDoor: ChatDoor): SwitcherAction[] {
  const { t } = useTranslation();
  const { frontSide, reload, closePane, setDrawerOpen } = useAppSwitcher();
  const current = useCurrentApplication();
  const { floating, toggle } = chatDoor;
  const src = current?.src ?? null;
  const nothingUp = current === null;

  return useMemo<SwitcherAction[]>(
    () => [
      {
        key: 'chat',
        label: floating ? t('applications.actCollapseChat') : t('applications.actChat'),
        keywords: 'chat conversation messages float window panel',
        // The same sign the floating chat's own header collapses with (ChatHostHeader), so the act that puts the
        // chat away looks like the control that does it there; the speech bubble is the act that brings it out.
        icon: floating ? Minimize2 : MessageSquare,
        disabled: false,
        shortcut: formatShortcut(CHAT_TOGGLE_KEY),
        run: toggle,
      },
      {
        key: 'applications',
        label: t('applications.actApplications'),
        keywords: 'applications apps drawer switcher list',
        icon: LayoutGrid,
        disabled: false,
        shortcut: null,
        run: () => setDrawerOpen(true),
      },
      {
        key: 'reload',
        label: t('applications.actReload'),
        keywords: 'reload refresh application app frame pane',
        icon: RotateCw,
        disabled: nothingUp,
        shortcut: null,
        run: () => reload(frontSide),
      },
      {
        key: 'close',
        label: t('applications.actClose'),
        keywords: 'close application app pane dismiss',
        icon: X,
        disabled: nothingUp,
        shortcut: null,
        run: () => closePane(frontSide),
      },
      {
        key: 'open-in-tab',
        label: t('applications.actOpenInTab'),
        keywords: 'open new tab browser external window',
        icon: ExternalLink,
        disabled: nothingUp,
        shortcut: null,
        run: () => {
          // `noopener`: the application is a separate origin and gets no handle back on this page.
          if (src !== null) window.open(src, '_blank', 'noopener');
        },
      },
    ],
    [t, floating, toggle, setDrawerOpen, nothingUp, reload, closePane, frontSide, src],
  );
}
