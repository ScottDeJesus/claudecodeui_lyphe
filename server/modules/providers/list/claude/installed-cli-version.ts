/**
 * The installed Claude CLI's version, as the message path needs it: one bounded read, whose
 * `null` means "not heard" and never "different".
 *
 * This is the reading half of the retirement rule in `chat-process.ts`. A CLI process runs the
 * build it was started with, so the version on disk is one more launch argument: a message that
 * would reuse a host older than the binary retires it and spawns afresh (chat-process.ts's
 * `planLiveChanges` names the reason). That decision needs a number for the binary on disk, and
 * it needs it on the SEND path — so the read is bounded here, not left to the probe's own
 * ceilings, or a person's message would wait out a binary that will not answer `--version`.
 *
 * The reading itself is the server's ONE cached probe of that binary (`cli-version.service.ts`),
 * shared with `/api/cli-version`, so the route's report and this decision can never be two
 * answers about the same machine. It normally answers from cache in microseconds; the shared
 * in-flight probe means a cold cache is one subprocess, not one per message.
 *
 * consumer: claude-runtime.provider.js (joinProcess)
 */

import { readInstalledCliVersion } from '@/modules/cli-version/index.js';

/**
 * How long a message waits on the installed CLI's version before going in without it.
 *
 * The window is deliberately far below the probe's own 10 s ceiling. This number decides when an
 * answer is too slow to be worth the wait, and no answer at all is harmless: a null joins the
 * process the message was already going to join.
 */
const INSTALLED_VERSION_WAIT_MS = 1_500;

/**
 * The installed CLI's version, or null when it cannot be read in time.
 *
 * A null carries no opinion about the running process: a binary that cannot be named before a
 * run starts (`reason: 'chosen when a run starts'`), a `--version` that fails or hangs, and a
 * probe that threw are all "not heard", and none of them may replace a healthy process.
 */
export async function installedCliVersionForLaunch(): Promise<string | null> {
  let timer: NodeJS.Timeout | undefined;
  try {
    const reading = await Promise.race([
      readInstalledCliVersion(),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), INSTALLED_VERSION_WAIT_MS);
        timer.unref();
      })
    ]);
    return reading?.version ?? null;
  } catch (error) {
    // A probe that threw is a probe that could not answer — the same fact as a null.
    console.warn(
      '[Claude SDK] Could not read the installed Claude CLI version; the running process is left as it is:',
      error instanceof Error ? error.message : error
    );
    return null;
  } finally {
    clearTimeout(timer);
  }
}
