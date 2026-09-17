type AppPaneProps = {
  /** The resolved url. The layer resolves it; this file resolves nothing and fetches nothing. */
  src: string;
  /** The application's name — the frame's accessible name. */
  title: string;
};

/**
 * One application, full-bleed: an iframe and nothing else. No title bar, no close button, no
 * watchdog — the FAB floats above every pane and is the way out, and a chrome strip here would
 * take height from the application for a control that already exists.
 *
 * Rendered by AppSwitcherLayer, which keys it on the app and its slot's reload nonce, so a Reload
 * remounts the frame.
 */
export function AppPane({ src, title }: AppPaneProps) {
  return (
    // Deliberately NO `sandbox`, though the house's other two cross-origin frames carry one
    // (WidgetFrame.tsx, DocSpaceFrame.tsx). A sandbox without `allow-same-origin` cuts the framed
    // app's SameSite=Lax session cookie, which is the whole premise of the EIS framing grant in
    // R-EISBE-7 — and these are the operator's own applications on his own host, not untrusted
    // embeds. The geolocation grant below fixes the hub's defect: Descent's weather tile asks for it.
    <iframe
      src={src}
      title={title}
      referrerPolicy="no-referrer"
      allow="geolocation"
      className="h-full w-full border-0"
    />
  );
}
