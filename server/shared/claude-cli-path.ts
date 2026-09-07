import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const moduleRequire = createRequire(import.meta.url);

const DEFAULT_CLAUDE_COMMAND = 'claude';
const CLAUDE_SCRIPT_EXTENSIONS = new Set(['.cjs', '.js', '.jsx', '.mjs', '.ts', '.tsx']);
const CLAUDE_WRAPPER_SEGMENTS = ['node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe'] as const;

export type ResolveClaudeCodeExecutablePathDependencies = {
  execFileSync?: typeof execFileSync;
  existsSync?: typeof fs.existsSync;
  platform?: NodeJS.Platform;
  readFileSync?: typeof fs.readFileSync;
};

function getPathApi(platform: NodeJS.Platform) {
  return platform === 'win32' ? path.win32 : path;
}

function stripWrappingQuotes(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function isPathLike(value: string): boolean {
  return value.includes('/') || value.includes('\\');
}

function resolveClaudeWrapperBinary(
  wrapperPath: string,
  deps: Required<ResolveClaudeCodeExecutablePathDependencies>,
): string | null {
  const pathApi = getPathApi(deps.platform);
  const directCandidate = pathApi.resolve(pathApi.dirname(wrapperPath), ...CLAUDE_WRAPPER_SEGMENTS);

  if (deps.existsSync(directCandidate)) {
    return directCandidate;
  }

  let content: string;
  try {
    content = deps.readFileSync(wrapperPath, 'utf8');
  } catch {
    return null;
  }

  const matches = content.matchAll(/["']([^"'\\\r\n]*claude\.exe)["']/gi);
  for (const match of matches) {
    const rawTarget = match[1]
      .replace(/^\$basedir[\\/]/i, '')
      .replace(/^%dp0%[\\/]/i, '')
      .replace(/^%~dp0[\\/]/i, '');
    const normalizedTarget = rawTarget.replace(/[\\/]/g, pathApi.sep);
    const candidate = pathApi.isAbsolute(normalizedTarget)
      ? normalizedTarget
      : pathApi.resolve(pathApi.dirname(wrapperPath), normalizedTarget);

    if (deps.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

/**
 * Windows has no PATH lookup to fall back on: the SDK spawns the path we hand
 * it with a raw `child_process.spawn`, which never consults PATH or PATHEXT.
 * A bare `claude` therefore fails with "native binary not found at claude"
 * even on a machine where the CLI is installed and on PATH, so an unresolved
 * default returns undefined and lets the SDK use its own bundled binary.
 */
function resolveWindowsClaudeExecutablePath(
  configuredPath: string,
  configuredExplicitly: boolean,
  deps: Required<ResolveClaudeCodeExecutablePathDependencies>,
): string | undefined {
  const pathApi = getPathApi(deps.platform);
  const extension = pathApi.extname(configuredPath).toLowerCase();
  const explicitPath = isPathLike(configuredPath) || pathApi.isAbsolute(configuredPath);
  // An explicit CLAUDE_CLI_PATH is the operator's call even when we cannot
  // verify it; only our own `claude` default defers to the SDK.
  const unresolved = configuredExplicitly ? configuredPath : undefined;

  if (CLAUDE_SCRIPT_EXTENSIONS.has(extension)) {
    return configuredPath;
  }

  if (explicitPath && extension === '.exe') {
    return configuredPath;
  }

  if (explicitPath) {
    return resolveClaudeWrapperBinary(configuredPath, deps) ?? unresolved;
  }

  try {
    const stdout = deps.execFileSync('where.exe', [configuredPath], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    });
    const candidates = stdout
      .split(/\r?\n/)
      .map((entry) => entry.trim())
      .filter(Boolean);

    for (const candidate of candidates) {
      if (pathApi.extname(candidate).toLowerCase() === '.exe') {
        return candidate;
      }
    }

    for (const candidate of candidates) {
      const resolved = resolveClaudeWrapperBinary(candidate, deps);
      if (resolved) {
        return resolved;
      }
    }
  } catch {
    return unresolved;
  }

  return unresolved;
}

/**
 * Resolves the Claude Code executable to hand the SDK.
 *
 * Returns undefined when no real executable could be found and the caller did
 * not configure one, which means "let the SDK pick its own bundled binary".
 */
export function resolveClaudeCodeExecutablePath(
  configuredPath: string | undefined = process.env.CLAUDE_CLI_PATH,
  dependencies: ResolveClaudeCodeExecutablePathDependencies = {},
): string | undefined {
  const deps: Required<ResolveClaudeCodeExecutablePathDependencies> = {
    execFileSync: dependencies.execFileSync ?? execFileSync,
    existsSync: dependencies.existsSync ?? fs.existsSync,
    platform: dependencies.platform ?? process.platform,
    readFileSync: dependencies.readFileSync ?? fs.readFileSync,
  };

  const configuredExplicitly = Boolean(stripWrappingQuotes(configuredPath || ''));
  const normalizedPath = stripWrappingQuotes(configuredPath || DEFAULT_CLAUDE_COMMAND);
  if (deps.platform !== 'win32') {
    return normalizedPath;
  }

  return resolveWindowsClaudeExecutablePath(normalizedPath, configuredExplicitly, deps);
}

/**
 * Resolves the Claude CLI binary the SDK ships for this host, or null.
 *
 * The SDK installs its native binary as an optional per-platform package; this
 * mirrors that candidate list — the glibc build first, then the musl one —
 * rather than guessing at a path.
 *
 * ONLY meaningful where the SDK actually reaches for that binary, which is
 * narrower than it sounds: `resolveClaudeCodeExecutablePath` above returns
 * `stripWrappingQuotes(configuredPath || DEFAULT_CLAUDE_COMMAND)` on every
 * non-Windows host, so `pathToClaudeCodeExecutable` is always set there and the
 * SDK's own fallback is unreachable. Only the Windows branch returns
 * `undefined`, and only then does a run use what the SDK ships. Treat this as a
 * general "the binary a run will use" answer and you report a version belonging
 * to a process this machine never starts.
 *
 * Returns null when neither package is installed.
 */
export function resolveSdkBundledClaudePath(
  platform: string = process.platform,
  architecture: string = process.arch,
): string | null {
  for (const libcSuffix of ['', '-musl']) {
    try {
      return moduleRequire.resolve(
        `@anthropic-ai/claude-agent-sdk-${platform}-${architecture}${libcSuffix}/claude`,
      );
    } catch {
      // Not installed for this host/libc pair. The next candidate, or null.
    }
  }

  return null;
}

/**
 * The exact file a provider run will spawn, or null when this process cannot
 * name it before the run starts.
 *
 * Anything that wants to say something ABOUT the CLI a run uses — its version,
 * most of all — has to ask this rather than invent a second resolution rule.
 * Two rules drift, and a reader who is told a real version belonging to a
 * binary nothing runs is worse off than one who is told nothing.
 *
 * Null is a "we don't know", never a fault, and it has two shapes:
 *
 * - The SDK resolver returned `undefined` (Windows only, nothing configured and
 *   nothing found). That is the one case where the SDK really does run the
 *   binary it ships, so that binary is the answer.
 * - The resolved path is not absolute. A bare `claude` is looked up on the
 *   spawn's PATH and a relative path against the run's own project cwd; a
 *   caller shares neither, so any file it found under that name would be a
 *   different binary wearing the right one.
 */
export function resolveSpawnedClaudeBinaryPath(
  configuredPath: string | undefined = process.env.CLAUDE_CLI_PATH,
  dependencies: ResolveClaudeCodeExecutablePathDependencies = {},
): string | null {
  const spawnPath = resolveClaudeCodeExecutablePath(configuredPath, dependencies);

  if (spawnPath === undefined) {
    return resolveSdkBundledClaudePath(dependencies.platform ?? process.platform);
  }

  const pathApi = getPathApi(dependencies.platform ?? process.platform);
  return pathApi.isAbsolute(spawnPath) ? spawnPath : null;
}
