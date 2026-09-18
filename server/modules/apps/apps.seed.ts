import type { AppEntry } from '@/shared/app-types.js';

/**
 * The applications the registry is seeded with: this app alone. Every other row is the
 * operator's own, added through the drawer or the registry file.
 *
 * ONE consumer: `apps.store.ts`, which writes this list when the registry file does not exist yet
 * and never writes it again — a file that exists belongs to the operator, and no read repairs it.
 *
 * `{host}` is left UNRESOLVED on purpose. It is the mechanism that lets one file serve LAN,
 * Tailscale and loopback: the substitution happens in the reader's browser
 * (`src/modules/app-switcher/utils/resolveAppUrl.ts`), so the row is resolved where it is read
 * rather than where it was seeded. A seed with a host baked in would pin every reader to whichever
 * address the seeding machine happened to answer on. A row may carry a path (`…:9001/dashboard`)
 * when an app's root is not the page worth opening.
 *
 * Order is meaningful and is the file's order: the drawer lists the rows top to bottom. Nothing
 * sorts this list.
 */
export const DEFAULT_APPS: AppEntry[] = [
  { id: 'cloudcli', name: 'CloudCLI', url: 'http://{host}:5183' },
];
