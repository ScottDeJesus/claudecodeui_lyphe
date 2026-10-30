import fs from 'node:fs';

import { comfyWorkPaths } from './comfyui.js';

/**
 * A leftover ComfyUI: one a crashed bake's process left running. The bake that starts reads the pid file beside its lock
 * and kills that process ONLY after `/proc/<pid>/cmdline` proves it is a ComfyUI `main.py` launched with THIS root's temp
 * folder, and the pid is a plain number above 1 — `kill -1` reaches every process the user owns, and a pid file is
 * only a file. Anything else in the pid file is dropped unsignalled. Consumed by `face-bake.ts`, after it holds the lock.
 */
export function reapOrphanComfyUI(workDir: string): void {
  const { pidFile, temp } = comfyWorkPaths(workDir);
  let text: string;
  try {
    text = fs.readFileSync(pidFile, 'utf8').trim();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  fs.rmSync(pidFile, { force: true });

  // A plain number: no sign, no leading zero, nothing else.
  const pid = /^[1-9][0-9]*$/.test(text) ? Number(text) : 0;
  if (!Number.isSafeInteger(pid) || pid <= 1) return;

  let argv: string[];
  try {
    argv = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; // already gone
    throw error;
  }
  const runsComfyMain = argv.some((arg) => arg.endsWith('/ComfyUI/main.py'));
  const temporary = argv.indexOf('--temp-directory');
  const usesOurTemp = temporary !== -1 && argv[temporary + 1] === temp;
  if (!runsComfyMain || !usesOurTemp) return; // the number now belongs to something else

  console.error(`[Companion] a leftover ComfyUI (pid ${pid}) from an earlier bake is stopped`);
  process.kill(pid, 'SIGKILL');
}
