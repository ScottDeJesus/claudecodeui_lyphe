import type { AppEntry } from '@/shared/app-types.js';

/**
 * The seven applications the registry is seeded with, copied character for character from the
 * house's previous application registry on the day the switcher moved in here (2026-09-16).
 *
 * ONE consumer: `apps.store.ts`, which writes this list when the registry file does not exist yet
 * and never writes it again — a file that exists belongs to the operator, and no read repairs it.
 *
 * `{host}` is left UNRESOLVED on purpose. It is the mechanism that lets one file serve LAN,
 * Tailscale and loopback: the substitution happens in the reader's browser
 * (`src/modules/app-switcher/utils/resolveAppUrl.ts`), so the row is resolved where it is read
 * rather than where it was seeded. A seed with a host baked in would pin every reader to whichever
 * address the seeding machine happened to answer on, and `cerberus` keeps its `/dashboard` path for
 * the same reason it has one: the app's root is not its board.
 *
 * Order is meaningful and is the file's order: the drawer lists the rows top to bottom, `descent`
 * first because it is where the operator starts. Nothing sorts this list.
 */
export const DEFAULT_APPS: AppEntry[] = [
  { id: 'descent', name: 'Descent', url: 'http://{host}:7878' },
  { id: 'eis-app', name: 'EIS App', url: 'http://{host}:8004' },
  { id: 'dispatch', name: 'Dispatch', url: 'http://{host}:8003' },
  { id: 'cerberus', name: 'Cerberus', url: 'http://{host}:8001/dashboard' },
  { id: 'archpulse', name: 'ArchPulse', url: 'http://{host}:8005' },
  { id: 'storybook', name: 'EIS Storybook', url: 'http://{host}:6006' },
  { id: 'cloudcli', name: 'CloudCLI', url: 'http://{host}:5183' },
];
