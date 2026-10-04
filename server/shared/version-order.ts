/**
 * Version ORDER: the one comparison that says whether a version is BEHIND another, and the parse it
 * stands on.
 *
 * It lives in `server/shared/` rather than beside either caller because it has two, and a second
 * comparison would be a second answer to one question: the message path (`chat-process.ts`) asks
 * whether a running process is behind the binary on disk, and the keepalive's sweep over idle hosts
 * (`session-host/idle-version-sweep.ts`), with the boot re-adoption it feeds, asks the same of a
 * process between turns.
 *
 * `versionNumbers` stays module-private: the parse is an implementation detail of the comparison,
 * and any other caller of it would be a second opinion about what a version string means.
 */

/** The leading numeric parts of a version line (`v2.1.280-beta.1` → `[2, 1, 280]`), or null. */
const versionNumbers = (version: string): number[] | null => {
  const match = /^v?(\d+(?:\.\d+)*)/.exec(version.trim());
  return match ? match[1].split('.').map(Number) : null;
};

/**
 * Whether the process on `liveVersion` is BEHIND the binary on `installedVersion` — the only
 * direction in which a version replaces a process.
 *
 * The installed side is a reading (cached at most 60 s, dropped the moment the binary changes on
 * disk) while the live side is what a process announced at its own init, which is never a reading
 * and never stale. So the two can differ because the process is old, and that is the whole point of
 * the rule — or because the reading is old, which is no reason to touch a healthy process: a
 * differing pair decided by "not equal" alone would retire a current process and spawn the very
 * same build again, once per message, for as long as the reading stood, each time paying a cold
 * start and a full resume replay. A version that cannot be ordered falls back to the plain
 * difference, because a build nobody can compare is not a reason to leave a conversation on an old
 * binary for good — and a pair like that only differs when the strings genuinely do.
 *
 * Exported because the same rule decides a retirement that no message asked for: the idle host a
 * version install leaves behind (session-host's `idle-version-sweep.ts`). A second comparison there
 * — "differs", say — would be a second answer to "is this process old", and the two would drift the
 * first time one of them learned about a build that sorts oddly. consumer: chat-process.ts,
 * idle-version-sweep.ts, claude-updates/changelog.ts (the `installed < version <= latest` window),
 * claude-updates/update-check.report.ts (whether an update is available at all, and whether a stored
 * window starts above the install reading it), claude-updates/update-check.reader.ts (whether the
 * stored notes are too narrow to keep)
 */
export const isBehindInstalled = (liveVersion: string, installedVersion: string): boolean => {
  const live = versionNumbers(liveVersion);
  const installed = versionNumbers(installedVersion);
  if (!live || !installed) return true;
  for (let index = 0; index < Math.max(live.length, installed.length); index += 1) {
    const left = live[index] ?? 0;
    const right = installed[index] ?? 0;
    if (left !== right) return left < right;
  }
  return false;
};
