// CloudCLI's own address book, for the pages that stand outside its workspace (Kaylee Station today): where CloudCLI is
// served from, and the two ways a station reaches back into it. Pure functions of the window and the router — no React,
// no state. It lives here and not in `utils.ts`, which is long enough, and so that the Router's basename has one home.

/**
 * Where the pressing page stands, as the doors need it: `phone` (a window under 768 px wide, or a touch window on its
 * side — the station's `useStation().phone`) and `pwa` (CloudCLI running as the home-screen app,
 * `useDeviceSettings().isPWA`). On either the doors stay in this window: a new window would leave the app for the browser.
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
 * Opens `path` (a path under CloudCLI's router) in CloudCLI. On a phone or in the home-screen app it is `navigate(path)`
 * in this window — a new window would leave the app for the browser; on a desktop it is the window named `cloudcli`, so
 * the page that pressed stays where it is and a second press reuses the same window. A browser that refuses the window
 * (a null handle) gets `navigate(path)` too, so a press is never silent.
 *
 * Consumed by `src/modules/station`: `FocusFallback`'s press now, and the chat's stage and the follow-ups' stage later.
 */
export function openInCloudcli(path: string, navigate: (to: string) => void, where: CloudcliDoorWhere): void {
  if (where.phone || where.pwa) {
    navigate(path);
    return;
  }
  const opened = window.open(cloudcliUrl(path), 'cloudcli');
  if (opened === null) {
    navigate(path);
    return;
  }
  opened.focus();
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
 * Consumed by `src/modules/station`: the bar's "CloudCLI" (`StationShell` binds it) and, later, the phone's menu.
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
  window.open(cloudcliUrl('/'), '_blank');
}
