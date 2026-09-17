import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * How an agent's MCP client should launch one of this server's stdio MCP programs.
 *
 * Three installs, three answers. A packaged install has the compiled sibling next to this
 * module and runs it on the node already executing. A dev checkout has neither that sibling
 * NOR a global `cloudcli` on PATH — the server there runs from TypeScript through tsx — so
 * registering the bare binary wrote an entry whose only possible outcome was
 * `ENOENT: Executable not found in $PATH: cloudcli`; it runs the TS entry through the repo's
 * own tsx instead. The bare binary stays as the last resort, for an install that has the
 * global on PATH and no sources to run.
 *
 * The `.js`/`.ts` this looks for sit beside the CALLING module, so the frame that called in
 * supplies the directory — see `callerModuleDirectory`. That is a real constraint on the call
 * site, not an implementation detail: the caller must be the module the program itself sits in,
 * because a re-export or a wrapper contributes its own directory and no amount of stack-walking
 * can tell it from a packaged install that genuinely has no sources. The two branches that follow
 * are ordered dist-first on purpose: the sibling `.js` is what a packaged install has and what a
 * dev checkout of the same tree does not, and the last resort is announced on stderr so the two
 * indistinguishable cases can still be told apart by whoever reads the log.
 *
 * Consumers: `server/modules/browser-use/browser-use.service.ts` (the entry it registers with
 * every provider's MCP config) and `server/modules/kanban-metis/index.ts` (the command a
 * spawned Metis child is handed). Two callers of one resolver, never two copies of one resolver.
 */
export function resolveMcpCommand(
  scriptBaseName: string,
  cliVerb: string
): { command: string; args: string[] } {
  const callerDirectory = callerModuleDirectory();
  const mcpScriptPath = path.join(callerDirectory, `${scriptBaseName}.js`);
  if (fs.existsSync(mcpScriptPath)) {
    return {
      command: process.execPath,
      args: [mcpScriptPath],
    };
  }

  // The caller lives in `server/modules/<module>` (or its `dist-server/server/modules/<module>`
  // twin), so the repo root is three levels up in the dev layout this branch is the only one
  // that fires from.
  const repoRoot = path.resolve(callerDirectory, '..', '..', '..');
  const tsxPath = path.join(repoRoot, 'node_modules', '.bin', 'tsx');
  const mcpSourcePath = path.join(callerDirectory, `${scriptBaseName}.ts`);
  if (fs.existsSync(tsxPath) && fs.existsSync(mcpSourcePath)) {
    return {
      // The server tsconfig, not the root one: the entry imports through the same NodeNext
      // resolution and `@/` paths the rest of server/ is built with.
      command: tsxPath,
      args: ['--tsconfig', path.join(repoRoot, 'server', 'tsconfig.json'), mcpSourcePath],
    };
  }

  // ANNOUNCED, not silent. The two branches above cover every install that has the program's
  // own file; this one is reached when neither is beside the caller — which is the packaged
  // install with a global on PATH, and ALSO an indirect caller, whose only frame names the
  // re-export rather than the module the program lives in. The second case is a mistake in the
  // call site, and it fails toward a command that is wrong rather than absent, so the line
  // below is the only thing that tells the two apart.
  process.stderr.write(
    `[mcp-command] no ${scriptBaseName}.js or ${scriptBaseName}.ts beside ${callerDirectory}; ` +
      `registering the "cloudcli ${cliVerb}" binary instead. Call resolveMcpCommand from the ` +
      `module the ${scriptBaseName} program sits in — a re-export or a wrapper cannot be located ` +
      'by the stack, and this fallback is what it gets.\n'
  );

  return {
    command: 'cloudcli',
    args: [cliVerb],
  };
}

/**
 * The directory of the module that called into this file — the folder the `<base>.js` /
 * `<base>.ts` siblings are resolved against.
 *
 * A shared file cannot name that folder from its own `import.meta.url`: it is `modules/browser-use`
 * for one caller and `modules/kanban-metis` for the other, at a depth neither of them shares with
 * `server/shared`. The stack therefore carries the only copy of the answer, and the frames of this
 * own file are skipped by module name (extension-insensitive, because the compiled twin of a `.ts`
 * frame is the same directory).
 *
 * A runtime that hands over no usable frame falls back to this file's own directory, which fails
 * both file branches and lands on the `cloudcli` binary — the same last resort an install with no
 * sources would reach anyway. It never throws: a resolver that crashed would take the server's MCP
 * registration down with it.
 */
function callerModuleDirectory(): string {
  const ownPath = fileURLToPath(import.meta.url);
  const ownModuleName = path.basename(ownPath, path.extname(ownPath));

  const previousStackTraceLimit = Error.stackTraceLimit;
  Error.stackTraceLimit = 30;
  const { stack } = new Error();
  Error.stackTraceLimit = previousStackTraceLimit;

  for (const rawLine of (stack ?? '').split('\n').slice(1)) {
    const match = /^\s*at\s+(?:.*?\s\()?([^()]+):\d+:\d+\)?\s*$/.exec(rawLine);
    if (!match) continue;

    const frameFile = match[1].startsWith('file://') ? fileURLToPath(match[1]) : match[1];
    if (!path.isAbsolute(frameFile)) continue;
    if (path.basename(frameFile, path.extname(frameFile)) === ownModuleName) continue;

    return path.dirname(frameFile);
  }

  return path.dirname(ownPath);
}
