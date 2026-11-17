/// <reference types="vite/client" />

/**
 * Installed package version, injected by Vite's `define` at build time.
 * Read it through `APP_VERSION` in `@/shared/constants`, which also covers
 * runners such as `tsx` that do not apply Vite's define replacement.
 */
declare const __APP_VERSION__: string;

/**
 * The one member of the Document Picture-in-Picture API the app reads. TypeScript 5.9's lib.dom does not
 * carry the API, so chat-host's provider declares what it calls and nothing more. Optional, because the API
 * exists only in Chromium browsers on a secure context (a plain-http address has none), and the provider
 * asks `'documentPictureInPicture' in window` before it reads the member.
 *
 * An `interface` and not a `type`: adding a member to the global `Window` is declaration merging, which a
 * type alias cannot do.
 */
interface Window {
  documentPictureInPicture?: {
    /** Opens the always-on-top window. Must be called inside a user gesture, which the call spends. */
    requestWindow(options?: { width?: number; height?: number }): Promise<Window>;
  };
  /**
   * The boot reporter, defined by the first inline script of index.html before any module runs. It posts what the page saw of
   * its own boot, plus the `facts` passed here, to `/api/boot-report`, which writes one journal line. Optional because a page
   * served without that script (a probe's blank document) has none; callers ask first and never wait on it.
   */
  cloudcliBootReport?: (kind: string, facts: Record<string, unknown>) => void;
}
