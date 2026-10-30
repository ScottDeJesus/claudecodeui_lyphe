import { ExternalLink } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { PaneSide } from '@/shared/types';
import { EmptyState } from '@/shared/ui';
import { isBlockedAsMixedContent } from '@/shared/utils';

type AppPaneProps = {
  /** The resolved url. The layer resolves it; this file resolves nothing and fetches nothing. */
  src: string;
  /** The application's name — the frame's accessible name. */
  title: string;
  /** Which half of the layer this frame is, drawn as `data-pane-side` so `useFrontPane` can tell which frame holds focus. */
  side: PaneSide;
};

/**
 * One application, full-bleed: an iframe and nothing else. No title bar, no close button, no
 * watchdog — the FAB floats above every pane and is the way out, and a chrome strip here would
 * take height from the application for a control that already exists.
 *
 * The one thing drawn instead of the frame is a card, for an address the browser would block: a
 * plain-http application inside this page while it is open over https is mixed content, and the
 * browser drops it without a word, leaving the reader a blank pane. This is the one place every way
 * of putting an application up passes through (a row, the dual-screen row action, the companion's
 * order, a project link), so the check lives here and no opener has to remember it. The card's
 * action opens the address in a tab, which the browser does allow.
 *
 * Rendered by AppSwitcherLayer, which keys it on the app and its slot's reload nonce, so a Reload
 * remounts the frame.
 */
export function AppPane({ src, title, side }: AppPaneProps) {
  const { t } = useTranslation();

  if (isBlockedAsMixedContent(src, window.location.protocol)) {
    return (
      // `data-pane-side` and a focus target of its own, so a press inside the card makes this the
      // front pane the way a press inside a frame does (`useFrontPane`), and the palette's
      // "Open in tab" then opens THIS application.
      <div
        data-pane-side={side}
        tabIndex={-1}
        className="flex h-full w-full items-center justify-center bg-background p-4 outline-none"
      >
        <EmptyState
          icon={ExternalLink}
          title={t('applications.mixedContentTitle')}
          message={t('applications.mixedContentMessage', { name: title })}
          actionLabel={t('applications.openInNewTab')}
          // `noopener`: the application is a separate origin and gets no handle back on this page —
          // the drawer's own new-tab act says the same.
          onAction={() => window.open(src, '_blank', 'noopener')}
        />
      </div>
    );
  }

  return (
    // Deliberately NO `sandbox`, though the house's other two cross-origin frames carry one
    // (WidgetFrame.tsx, DocSpaceFrame.tsx). A sandbox without `allow-same-origin` cuts the framed
    // app's SameSite=Lax session cookie, which is the whole premise of the EIS framing grant in
    // R-EISBE-7 — and these are the operator's own applications on his own host, not untrusted
    // embeds. The geolocation grant below is what the hub's weather tile needs: without `allow` a
    // frame is refused it.
    <iframe
      src={src}
      title={title}
      data-pane-side={side}
      referrerPolicy="no-referrer"
      allow="geolocation"
      className="h-full w-full border-0"
    />
  );
}
