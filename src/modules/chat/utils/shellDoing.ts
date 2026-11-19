/** What a shell command is doing, for the core's form: looking at files, changing them, or anything else (running a program). */
export type ShellDoing = 'reading' | 'writing' | 'running';

/** Commands that only look: at files, at a repository's history, at the store's rows. */
const LOOKS: ReadonlySet<string> = new Set([
  'cat', 'head', 'tail', 'less', 'grep', 'egrep', 'fgrep', 'rg', 'ag', 'sed', 'awk', 'ls', 'tree', 'find', 'fd', 'wc', 'sort', 'uniq',
  'cut', 'tr', 'nl', 'column', 'jq', 'yq', 'diff', 'cmp', 'stat', 'file', 'du', 'df', 'realpath', 'readlink', 'basename', 'dirname',
  'which', 'type', 'pwd', 'xxd', 'od', 'strings', 'md5sum', 'sha256sum', 'git', 'docstore',
]);

/** Steps that neither look nor change: moving about, saying, setting a name. They leave the verdict to the rest of the line. */
const NEUTRAL: ReadonlySet<string> = new Set([
  'cd', 'echo', 'printf', 'true', 'false', 'export', 'set', 'unset', 'test', '[', '[[', ':', 'sleep', 'for', 'done', 'fi', 'case', 'esac', 'break',
  'continue', 'exit', 'return', 'local', 'read', 'shift', 'wait',
]);

/** Commands that change files. */
const CHANGES: ReadonlySet<string> = new Set([
  'patch-file', 'tee', 'mv', 'cp', 'rm', 'rmdir', 'mkdir', 'touch', 'chmod', 'chown', 'ln', 'rsync', 'install', 'truncate', 'patch', 'dd', 'unzip', 'tar',
]);

/** A git or docstore verb that only looks; every other verb of theirs changes something. */
const GIT_LOOKS: ReadonlySet<string> = new Set([
  'log', 'show', 'diff', 'status', 'blame', 'grep', 'branch', 'rev-parse', 'ls-files', 'describe', 'shortlog', 'reflog', 'cat-file', 'ls-tree', 'remote',
  'config', 'check-ignore', 'rev-list', 'merge-tree', 'ls-remote', 'for-each-ref', 'merge-base',
]);
const DOCSTORE_LOOKS: ReadonlySet<string> = new Set(['get', 'search', 'govern', 'list', 'history', 'atlas', 'show', 'find', 'check', 'health']);

/** git's own options that take the next word as their value (`git -C <repo> log`): that word is no verb. */
const GIT_VALUED_OPTIONS: ReadonlySet<string> = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--exec-path']);

/** Prefixes that run the command after them, and the shell's own words that stand before one: the command after is the one that counts. */
const WRAPPERS: ReadonlySet<string> = new Set(['sudo', 'env', 'nice', 'time', 'command', 'xargs', 'nohup', 'do', 'then', 'else', 'if', 'elif', 'while', 'until', '!']);

/** A `>` or `>>` into a file: not a numbered stream's (`2>err`, `2>&1`), not an arrow (`->`, `=>`), not the null device. */
const WRITES_A_FILE = /(^|[^0-9&<>=-])>>?\s*(?!&|\/dev\/null\b)\S/;

/** One step of a line, as `classifySegment` judges it. */
type StepVerdict = ShellDoing | 'neutral';

function classifySegment(segment: string): StepVerdict {
  // Name assignments and wrappers stand before the command they set up; `timeout 30 grep …` runs grep.
  const words = segment.trim().split(/\s+/).filter(Boolean);
  // A `case` arm's pattern (`/tmp/heph.*)`) stands before its command the same way.
  const setsUp = (word: string) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(word) || WRAPPERS.has(word) || (word.endsWith(')') && !word.includes('('));
  while (words.length > 0 && (setsUp(words[0]) || (words[0] === 'timeout' && /^\d/.test(words[1] ?? '')))) {
    words.splice(0, words[0] === 'timeout' ? 2 : 1);
  }
  if (WRITES_A_FILE.test(segment)) return 'writing';
  // A subshell's or group's opening bracket stands before its first command: `( cd "$D" && … )`.
  const head = (words[0] ?? '').replace(/^[({]+/, '').replace(/^.*\//, '');
  if (!head) return 'neutral';
  if (NEUTRAL.has(head)) return 'neutral';
  if (CHANGES.has(head)) return 'writing';
  const verb = words.slice(1).find((word, index, rest) => !word.startsWith('-') && !(head === 'git' && GIT_VALUED_OPTIONS.has(rest[index - 1] ?? '')));
  if (head === 'git') return GIT_LOOKS.has(verb ?? '') ? 'reading' : 'writing';
  if (head === 'docstore') return DOCSTORE_LOOKS.has(verb ?? '') ? 'reading' : 'writing';
  // `sed -i` / `perl -i` edit in place; plain sed prints.
  if (head === 'sed') return words.some((word) => /^-[a-zA-Z]*i/.test(word) || word.startsWith('--in-place')) ? 'writing' : 'reading';
  if (head === 'find') return words.some((word) => word === '-delete' || word === '-exec' || word === '-execdir') ? 'running' : 'reading';
  if (LOOKS.has(head)) return 'reading';
  return 'running';
}

/**
 * WHAT A SHELL COMMAND IS DOING, read off its text: the line is cut into its steps (`&&`, `||`, `;`, `|`, new lines), and
 *
 * - any step that changes a file (a write into one, a command that moves or makes files, `sed -i`, a git or docstore verb that
 *   is not a look) makes it `writing`;
 * - otherwise any step that runs a program of its own (a script, a probe, a server's client) makes it `running`;
 * - otherwise, with at least one step that looks at files (`grep`, `cat`, `sed -n`, `git log`, `docstore get`), it is `reading`.
 *
 * A heredoc's body is the program's input, never steps of the line: only the line that opens it is judged. A quoted span is
 * data (a pattern's `|` or `>` is no pipe and no write), and a command substitution's command is a step of its own
 * (`D=$(cat /tmp/p) && grep …` looks twice). Used by `coreDoingOf`, for a shell tool's form.
 */
export function shellDoingOf(command: string): ShellDoing {
  const lines: string[] = [];
  let heredocEnd: string | null = null;
  for (const line of command.split('\n')) {
    if (heredocEnd !== null) {
      if (line.trim() === heredocEnd) heredocEnd = null;
      continue;
    }
    lines.push(line);
    const opened = /<<-?\s*['"]?([A-Za-z_][A-Za-z0-9_]*)['"]?/.exec(line);
    if (opened) heredocEnd = opened[1];
  }
  const unquoted = lines.join('\n').replace(/'[^']*'|"(?:[^"\\]|\\.)*"/g, 'Q').replace(/\$\(|`/g, ';');
  const verdicts = unquoted.split(/&&|\|\||[;|\n]/).map(classifySegment);
  if (verdicts.includes('writing')) return 'writing';
  if (verdicts.includes('running')) return 'running';
  return verdicts.includes('reading') ? 'reading' : 'running';
}
