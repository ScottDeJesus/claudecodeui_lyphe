import { forgetCompanionClientIdIn } from '@/shared/utils';

// CloudCLI's own address book, for the pages that stand outside its workspace (Kaylee Station today): where CloudCLI is
// served from, the ways a station reaches back into it, and the door the workspace opens the station by. Pure functions
// of the window and the router — no React, no state. It lives here and not in `utils.ts`, which is long enough, and so
// that the Router's basename has one home.

/**
 * Where the pressing page stands, as the doors need it: `phone` and `pwa` (CloudCLI running as the home-screen app,
 * `useDeviceSettings().isPWA`). On either the doors stay in this window: a new window would leave the app for the browser.
 *
 * `phone` is each caller's own reading, and the three do not all draw the line in the same place. The station's bar passes
 * `useStation().phone` (a window under 768 px wide, or a touch window under 500 px tall: a phone on its side); the
 * workspace's two doors into the station, the palette's row and the head of her panel, pass `useDeviceSettings().isMobile`
 * (under 768 px). So a phone held on its side in a plain browser tab gets the station in a window of its own from them, and
 * that window's bar then navigates in place; in the home-screen app all three agree through `pwa`.
 */
export type CloudcliDoorWhere = { phone: boolean; pwa: boolean };

const DEPLOYMENT_ASSET_DIRECTORIES = new Set(['assets', 'static', 'icons', 'images']);

/**
 * Detect the router basename from explicit runtime config or deployment hints.
 *
 * CloudCLI can be served from a path prefix by a reverse proxy, for example:
 *   /ai/manifest.json
 *   /ai/assets/index-abc123.js
 *   /ai/icons/icon-192x192.png
 *
 * React Router needs that prefix as its basename, but the packaged app should
 * also keep working when served directly from the domain root. The direct-root
 * case is easy to misread because asset URLs such as /icons/icon-192x192.png
 * contain a directory even though there is no application basename.
 *
 * Consumed by `src/App.tsx` (the Router's basename) and by this file's two doors, which build a URL under it.
 */
export function routerBasename(): string {
  // Deployments can pin the router basename by setting window.__ROUTER_BASENAME__ in
  // index.html, so read it through a local widening instead of augmenting global Window.
  const explicitBasename =
    typeof window !== 'undefined'
      ? (window as Window & { __ROUTER_BASENAME__?: string }).__ROUTER_BASENAME__ || ''
      : '';
  if (explicitBasename) {
    // Keep the deployment escape hatch authoritative. A trailing slash is
    // harmless for humans but React Router expects a normalized basename.
    return explicitBasename.replace(/\/+$/, '');
  }

  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return '';
  }

  const candidatePaths = [
    { kind: 'manifest' as const, value: document.querySelector('link[rel="manifest"]')?.getAttribute('href') },
    { kind: 'script' as const, value: document.querySelector('script[type="module"][src]')?.getAttribute('src') },
    ...Array.from(
      document.querySelectorAll(
        'link[rel~="icon"][href], link[rel="apple-touch-icon"][href], link[rel="apple-touch-icon-precomposed"][href], link[rel="mask-icon"][href]'
      )
    ).map((node) => ({
      kind: 'icon' as const,
      value: node.getAttribute('href'),
    })),
  ].filter((candidate): candidate is { kind: 'manifest' | 'script' | 'icon'; value: string } => Boolean(candidate.value));

  let detectedBasename = '';
  for (const candidate of candidatePaths) {
    try {
      const candidateUrl = new URL(candidate.value, document.baseURI || window.location.href);
      if (candidateUrl.origin !== window.location.origin) {
        continue;
      }

      const pathname = candidateUrl.pathname;
      const normalizedPathname = pathname.replace(/\/+$/, '');

      let normalized = '';
      if (candidate.kind === 'script') {
        const match = normalizedPathname.match(/^(.*)\/assets\//);
        normalized = match?.[1] ? match[1].replace(/\/+$/, '') : '';
      } else {
        const manifestMatch = normalizedPathname.match(/^(.*)\/(?:manifest\.json|site\.webmanifest)$/);
        const iconMatch = normalizedPathname.match(
          /^(.*)\/(?:favicon(?:\.[^/]+)?|apple-touch-icon(?:-[^/]+)?(?:\.[^/]+)?|mask-icon(?:\.[^/]+)?|[^/]*icon[^/]*)$/
        );
        const match = candidate.kind === 'manifest' ? manifestMatch : iconMatch;
        if (match?.[1]) {
          const segments = match[1].split('/').filter(Boolean);

          // Strip directories that describe where static files live, not where
          // the app is mounted. This must also run for a single segment:
          //   /icons/icon-192x192.png       -> ''
          //   /ai/icons/icon-192x192.png    -> '/ai'
          // The previous implementation only stripped while more than one
          // segment remained, which incorrectly turned root deployments into a
          // Router basename of /icons and caused a blank page after login.
          while (segments.length > 0 && DEPLOYMENT_ASSET_DIRECTORIES.has(segments[segments.length - 1])) {
            segments.pop();
          }

          normalized = segments.length > 0 ? `/${segments.join('/')}` : '';
        }
      }

      if (normalized.length > detectedBasename.length) {
        detectedBasename = normalized;
      }
    } catch {
      // Ignore invalid candidate URLs and continue checking other hints.
    }
  }

  return detectedBasename;
}

/** The address of `path` (a path under CloudCLI's router: `/session/<id>`, `/?runner=<plan>`, `/`) on this origin, under the basename. */
function cloudcliUrl(path: string): string {
  return `${window.location.origin}${routerBasename()}${path}`;
}

/**
 * Opens `url` in the window called `name` (`_blank` for a new tab) as a window of its OWN to her. The window keeps its opener,
 * which is what lets a second press find the window named `cloudcli` again and lets its "CloudCLI" bring this one forward; but
 * a window opened by `window.open` starts with a copy of this page's sessionStorage, which holds this page's name to her
 * (`companionClientId`), so the new window would be the same page to her: one `companion_open` answered in both, and the
 * later of the two restating the view over the other's. A window still on its initial document is therefore handed back
 * with that name forgotten, before its own page has loaded and minted one; a named window that was already open is left
 * alone, since it has long held a name of its own. (`noopener` would also cure the copy, and costs the reuse: each press
 * then opens a window the named lookup can no longer find.)
 */
function openWindowOfItsOwn(url: string, name: string): Window | null {
  const opened = window.open(url, name);
  if (opened === null) return null;
  try {
    // `about:blank` is the initial document of a window whose page is still on its way.
    if (opened.location.href === 'about:blank') forgetCompanionClientIdIn(opened);
  } catch {
    // Not readable: not a window of ours, which holds no name of ours to forget.
  }
  return opened;
}

/**
 * Like `openWindowOfItsOwn`, for a page whose window is left as it is when a press finds it already standing there. The
 * browser answers a named window asked for WITH an address by navigating it to that address, which is a new document: the
 * station's speech mid-sentence, a draft typed into it, whatever it holds, would be gone. So the name is asked for with NO
 * address: a window already open under it is handed back with its document untouched; none open is a blank window, which is
 * then sent to `url` (after the page name it inherited is forgotten, as `openWindowOfItsOwn` does). A window open under the
 * name but standing on another page of ours, or one whose location cannot be read, is sent to `url` too: the press must
 * leave him on the page he asked for.
 */
function openWindowUnlessStanding(url: string, name: string): Window | null {
  const opened = window.open('', name);
  if (opened === null) return null;
  try {
    if (opened.location.href === 'about:blank') forgetCompanionClientIdIn(opened);
    else if (opened.location.pathname === new URL(url).pathname) return opened;
  } catch {
    // Not readable: not a window standing on our page, so it is sent to it below.
  }
  opened.location.href = url;
  return opened;
}

/**
 * The one rule the doors into CloudCLI's pages follow: on a phone or in the home-screen app `navigate(path)` in this
 * window (a new window would leave the app for the browser); else the window called `windowName`, so the page that pressed
 * stays where it is and a second press finds the same window again (`open` says how: by default the window is navigated to
 * the path each time). A browser that refuses the window (a null handle) gets `navigate(path)` too, so a press is never
 * silent.
 */
function openInWindowNamed(
  path: string,
  windowName: string,
  navigate: (to: string) => void,
  where: CloudcliDoorWhere,
  open: (url: string, name: string) => Window | null = openWindowOfItsOwn,
): void {
  if (where.phone || where.pwa) {
    navigate(path);
    return;
  }
  const opened = open(cloudcliUrl(path), windowName);
  if (opened === null) {
    navigate(path);
    return;
  }
  opened.focus();
}

/**
 * Opens `path` (a path under CloudCLI's router) in CloudCLI: `navigate(path)` in this window on a phone or in the
 * home-screen app, else the window named `cloudcli`.
 *
 * Consumed by `src/modules/station`: `FocusFallback`'s press, the chat's stage, and "Open the chat" on the ask's and the follow-ups'
 * stages (through the station's `useOpenChatInCloudcli`).
 */
export function openInCloudcli(path: string, navigate: (to: string) => void, where: CloudcliDoorWhere): void {
  openInWindowNamed(path, 'cloudcli', navigate, where);
}

/**
 * Opens Kaylee Station: `navigate('/station')` in this window on a phone (the 768 px breakpoint) or in the home-screen app,
 * else the window named `kaylee-station` — the second monitor's window, which a second press brings forward as it stands
 * (its document is not navigated again, so nothing it holds is lost) rather than opening another.
 *
 * Consumed by the workspace's command palette ("Open Kaylee Station", `ProjectCommandPalette`) and by the head of her
 * panel (`CompanionPanel`'s wrapper binds it to `CompanionHeader`'s station button).
 */
export function openStation(navigate: (to: string) => void, where: CloudcliDoorWhere): void {
  openInWindowNamed('/station', 'kaylee-station', navigate, where, openWindowUnlessStanding);
}

/**
 * Whether `opener` is a CloudCLI window of this origin that is still open. Reading a cross-origin window's location
 * throws; that is the answer "not ours", so it is caught here and nowhere else.
 */
function isOurOpener(opener: Window | null): opener is Window {
  if (opener === null || opener.closed) return false;
  try {
    return opener.location.origin === window.location.origin;
  } catch {
    return false;
  }
}

/**
 * The way back to the workspace. On a phone or in the home-screen app it is `navigate('/')` in this window. On a desktop
 * it focuses the window that opened this one when that is CloudCLI's (the same origin), so the workspace he came from
 * comes forward and this window stays; with no such opener (a reload in a new tab, a bookmark) it opens CloudCLI's home
 * in a new tab.
 *
 * Consumed by `src/modules/station`: the bar's "CloudCLI" and the phone's menu's "CloudCLI" (`StationShell` binds it for both).
 */
export function backToCloudcli(navigate: (to: string) => void, where: CloudcliDoorWhere): void {
  if (where.phone || where.pwa) {
    navigate('/');
    return;
  }
  if (isOurOpener(window.opener)) {
    window.opener.focus();
    return;
  }
  openWindowOfItsOwn(cloudcliUrl('/'), '_blank');
}
