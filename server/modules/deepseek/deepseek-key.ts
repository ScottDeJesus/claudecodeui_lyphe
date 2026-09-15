/**
 * The name this key goes by, in the process environment and in `.env` alike. The plan runner's
 * own Python hook reads the same name out of the same file (`~/.claude/hooks/plan_runner/deepseek.py`),
 * and two spellings of one credential is how a working key reads as missing.
 */
const KEY_NAME = 'DEEPSEEK_API_KEY';

/** `export DEEPSEEK_API_KEY=…` is a line a shell-minded editor writes and systemd rejects; the prefix is not part of the name. */
const EXPORT_PREFIX = /^export\s+/;

/**
 * The value, with one layer of matching quotes removed.
 *
 * BOTH halves of this reader run their value through here, because the two things that fill them
 * disagree about quotes: `systemd`'s EnvironmentFile strips them, and `server/load-env.ts` — which
 * fills `process.env` for every process this app runs — copies the value verbatim. Normalising at
 * the point of use is what keeps a quoted `.env` from reading as a REFUSED key on the half that
 * wins. Only MATCHING quotes are stripped: a value that begins with one and does not end with it
 * was never quoted, and truncating it would corrupt a key rather than clean it.
 */
function unquote(value: string): string {
  const first = value.charAt(0);
  const last = value.charAt(value.length - 1);
  if (value.length >= 2 && (first === '"' || first === "'") && last === first) {
    return value.slice(1, -1);
  }
  return value;
}

/**
 * The key as one line of a `.env` assigns it.
 *
 * Line-wise and LAST-wins, which is `systemd`'s own `EnvironmentFile` rule: a later line overrides
 * an earlier one, so a key appended under an old commented-out one resolves the way the unit
 * itself would resolve it. A commented line is not an assignment, and a key set to nothing counts
 * as no key — an empty bearer token is a refusal waiting to happen, not a credential.
 */
function readKeyFromFile(contents: string): string | null {
  let found: string | null = null;

  for (const rawLine of contents.split('\n')) {
    const line = rawLine.replace(/\r$/, '').trim();
    if (!line || line.startsWith('#')) continue;

    const assignment = line.replace(EXPORT_PREFIX, '');
    const separator = assignment.indexOf('=');
    if (separator < 0) continue;

    if (assignment.slice(0, separator).trim() !== KEY_NAME) continue;

    const value = unquote(assignment.slice(separator + 1).trim());
    found = value.length > 0 ? value : null;
  }

  return found;
}

type DeepseekKeyReaderDependencies = {
  /** The `.env` the systemd unit reads, resolved by the composition root from the application root. */
  envPath: string;
  readEnvironment: () => NodeJS.ProcessEnv;
  readFileImpl: (filePath: string) => Promise<string>;
};

/**
 * Resolves the DeepSeek key the moment it is needed, process environment first and `.env` second.
 *
 * Both halves are load-bearing, and the mechanism is `server/load-env.ts`: it copies every `.env`
 * key into `process.env` ONCE, at process start. So the environment carries this key only on a
 * process that booted after it was pasted — and `/proc/<pid>/environ` can never show it on one that
 * did not, because that file is the environment as EXEC saw it, not the mutations `load-env.ts`
 * makes after exec. The process serving this route booted before the key existed, which is why the
 * file half answers. The environment still wins where it is set, so an operator who exports the key
 * over the unit is obeyed rather than overruled, and systemd's `EnvironmentFile` — read before this
 * module ever runs — can only add to what the file says.
 *
 * Read on EVERY call, never cached and never at module load. This surface is where a key gets
 * pasted: a `.env` edited while the server is running is invisible to the environment half for the
 * whole life of that process, so a cached read would leave a key added a minute ago reading as
 * missing until the next restart — and the answer to "why does it still say unknown" would be a
 * restart nobody asked for. The file is a few kilobytes; the read is a rounding error beside the
 * HTTPS call that follows it.
 *
 * One divergence between the two halves is known and deliberately NOT cured here: `load-env.ts`
 * keeps the FIRST assignment of a name and `readKeyFromFile` keeps the LAST (systemd's own rule,
 * and the plan runner's), so a `.env` carrying two live assignments hands each half a different
 * key — and the environment wins, so the route follows whichever one that bootstrap happened to
 * see. Curing it means ONE parser behind both halves, which lives in shared bootstrap code every
 * module reads; that is a follow-up, not a line for this file.
 *
 * The value is returned and never logged, echoed, or put in a thrown message: every path that
 * cannot produce one returns `null`, which the service turns into the calm `unconfigured` unknown.
 */
export function createDeepseekKeyReader(
  dependencies: DeepseekKeyReaderDependencies,
): () => Promise<string | null> {
  return async function readApiKey(): Promise<string | null> {
    // Unquoted HERE too, and not for tidiness: the environment half is filled by
    // `server/load-env.ts`, which copies a value out of `.env` VERBATIM — quotes and all — and the
    // environment half wins. Without this, `DEEPSEEK_API_KEY="sk-…"` reaches the vendor as
    // `Bearer "sk-…"`, the vendor answers 401, and the panel tells the person their key was
    // REFUSED while it is perfectly good. Applying the same normalisation to both halves is what
    // makes "the environment wins" a precedence between two equivalent values rather than a
    // precedence between two different keys.
    const fromEnvironment = unquote(dependencies.readEnvironment()[KEY_NAME]?.trim() ?? '');
    if (fromEnvironment.length > 0) return fromEnvironment;

    try {
      return readKeyFromFile(await dependencies.readFileImpl(dependencies.envPath));
    } catch {
      // No `.env`, or one this process may not read. Either way this host holds no key it can
      // name, which is `unconfigured` — not a fault to report and not an error to act on.
      return null;
    }
  };
}
