import { STATION_PATH } from '@/shared/constants';

// CloudCLI's own address book: where CloudCLI is served from, and the two doors between the workspace and Kaylee Station. The
// two are pages of ONE tab, so a door is the app's own `navigate` and nothing else: no window is opened, nothing is loaded
// again, and what the page left stands as it was when it comes back. Pure functions of the router: no React, no state. It lives
// here and not in `utils.ts`, which is long enough, and so that the Router's basename has one home.

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
 * Consumed by `src/App.tsx`, for the Router's basename.
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

/**
 * Opens Kaylee Station: the station comes forward over the workspace, which stays mounted under it exactly as it is.
 *
 * Consumed by the workspace's command palette ("Open Kaylee Station", `ProjectCommandPalette`) and by the head of her panel
 * (`CompanionPanel`'s wrapper binds it to `CompanionHeader`'s station button).
 */
export function openStation(navigate: (to: string) => void): void {
  navigate(STATION_PATH);
}

/**
 * The way back to the workspace: `workspacePath` is the address it stood at when the station came forward (`useStationDoors().workspacePath()`:
 * its session, its query, its hash), or `/` when the app was opened on the station, so the workspace shows as he left it.
 *
 * Consumed by `src/modules/station`: the bar's "CloudCLI" and the phone's menu's "CloudCLI" (`StationShell` binds it for both).
 */
export function backToCloudcli(navigate: (to: string) => void, workspacePath: string): void {
  navigate(workspacePath);
}
