import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';

import { openFrameEvents } from './comfyui-socket.js';
import { FaceBakeRefusal, sentences } from './face-refusal.js';
import { FACE_FRAMING, type FaceSliders } from './face-recipe.js';

/**
 * COMFYUI AS THE BAKE'S CHILD. One bake starts one ComfyUI on a free loopback port, with `--cpu`, at nice 15 so the box's
 * services stay responsive, and stops it when the bake ends. It is ready on its own "To see the GUI go to" line — an
 * event, never a poll of the port — and an exit before that line is a refusal. A frame is one prompt on `/prompt`,
 * ended by its socket event (`comfyui-socket.ts`), with a deadline of ten minutes rather than a poll.
 */

/** A frame not done in this long is a failure: a deadline, not a poll. */
const FRAME_DEADLINE_MS = 10 * 60 * 1000;
/** How long ComfyUI gets to leave after SIGTERM before SIGKILL. */
const KILL_AFTER_MS = 5000;
const NICE_LEVEL = 15;
const READY_LINE = 'To see the GUI go to';
/** How many of ComfyUI's last lines an exit carries, for the log. */
const LAST_LINES = 30;

/** ComfyUI ended while the bake needed it; `lastLines` are its final words, for the server's log. */
export class ComfyUIExit extends Error {
  constructor(message: string, readonly lastLines: string[]) {
    super(message);
    this.name = 'ComfyUIExit';
  }
}

/** One started ComfyUI. `renderFrame` answers the node's 512 px preview PNG for a source image and a slider set. */
export type ComfyUI = { renderFrame(sourceName: string, sliders: FaceSliders): Promise<Buffer>; stop(): Promise<void> };

/** ComfyUI is installed here by `scripts/install-comfyui.sh`, unless `COMPANION_COMFYUI_DIR` says otherwise. */
const DEFAULT_COMFYUI_DIR = '/opt/comfyui';

/** Where ComfyUI is installed: `COMPANION_COMFYUI_DIR`, else `/opt/comfyui`. Read on each call. Consumed by `face-bake.ts` and `face.service.ts`. */
export function comfyuiDir(): string {
  return process.env.COMPANION_COMFYUI_DIR || DEFAULT_COMFYUI_DIR;
}

/** Whether the installer's interpreter and ComfyUI's `main.py` are there under `dir`. Consumed by `startComfyUI` (which refuses without them) and by `face.service.ts` (which queues the original's bake only with them). */
export function isComfyUIInstalled(dir: string): boolean {
  return fs.existsSync(path.join(dir, 'venv', 'bin', 'python')) && fs.existsSync(path.join(dir, 'ComfyUI', 'main.py'));
}

/** ComfyUI's own folders and its pid file under `workDir` (the faces root). Consumed by `comfyui-orphan.ts` and `face-bake.ts` (where the source image is written). */
export function comfyWorkPaths(workDir: string): { input: string; output: string; temp: string; pidFile: string } {
  const base = path.join(workDir, 'comfyui');
  return { input: path.join(base, 'input'), output: path.join(base, 'output'), temp: path.join(base, 'temp'), pidFile: path.join(workDir, 'comfyui.pid') };
}

/** A port the OS just handed out and released. Another process could take it before ComfyUI binds; ComfyUI's exit would then be the refusal. */
function freeLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as net.AddressInfo;
      probe.close(() => resolve(port));
    });
  });
}

/**
 * Starts ComfyUI for one bake and answers its door; `signal` stops it, and an abort at any moment of the start rejects with
 * the signal's reason. Throws a `FaceBakeRefusal` when it is not installed at `dir` and a `ComfyUIExit` when it ends before
 * it is ready. Consumed by `face-bake.ts`.
 */
export async function startComfyUI(input: { dir: string; workDir: string; signal: AbortSignal; onLine(line: string): void }): Promise<ComfyUI> {
  const { dir, workDir, signal, onLine } = input;
  if (!isComfyUIInstalled(dir)) throw new FaceBakeRefusal(sentences.notInstalled(dir));
  const python = path.join(dir, 'venv', 'bin', 'python');
  const mainScript = path.join(dir, 'ComfyUI', 'main.py');
  signal.throwIfAborted();

  const paths = comfyWorkPaths(workDir);
  for (const folder of [paths.input, paths.output, paths.temp]) fs.mkdirSync(folder, { recursive: true });
  const port = await freeLoopbackPort();

  const child = spawn(python, [
    mainScript, '--cpu', '--listen', '127.0.0.1', '--port', String(port), '--log-stdout', '--disable-auto-launch',
    '--input-directory', paths.input, '--output-directory', paths.output, '--temp-directory', paths.temp,
  ], {
    cwd: path.join(dir, 'ComfyUI'),
    // The node's own prints ("Failed to detect face!!") go through Python's stdout, which a pipe would buffer to the end.
    env: { ...process.env, PYTHONUNBUFFERED: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const lastLines: string[] = [];
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    child.once('exit', (code, exitSignal) => resolve({ code, signal: exitSignal }));
  });
  const spawned = new Promise<void>((resolve, reject) => {
    child.once('spawn', resolve);
    child.once('error', reject);
  });
  await spawned;
  if (child.pid === undefined) throw new Error('ComfyUI was not started');
  // The main thread now, and every thread it makes later (torch's workers), run at nice 15.
  os.setPriority(child.pid, NICE_LEVEL);
  fs.writeFileSync(paths.pidFile, `${child.pid}\n`);

  let stopping: Promise<void> | null = null;
  const stop = (): Promise<void> => {
    stopping ??= (async () => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGTERM');
        const killTimer = setTimeout(() => child.kill('SIGKILL'), KILL_AFTER_MS);
        await exited;
        clearTimeout(killTimer);
      }
      fs.rmSync(paths.pidFile, { force: true });
    })();
    return stopping;
  };
  const stopOnAbort = () => { void stop(); };
  signal.addEventListener('abort', stopOnAbort, { once: true });

  const readReady = new Promise<void>((resolve) => {
    for (const stream of [child.stdout, child.stderr]) {
      readline.createInterface({ input: stream }).on('line', (line) => {
        lastLines.push(line);
        if (lastLines.length > LAST_LINES) lastLines.shift();
        onLine(line);
        if (line.includes(READY_LINE)) resolve();
      });
    }
  });
  const endedEarly = exited.then(({ code, signal: exitSignal }) => {
    throw new ComfyUIExit(`ComfyUI ended (${exitSignal ?? `code ${code}`}) before it was ready`, [...lastLines]);
  });

  const clientId = randomUUID();
  let events;
  try {
    // An abort that landed after the first check and before the listener was armed fires no event: it is read here.
    signal.throwIfAborted();
    await Promise.race([readReady, endedEarly]);
    signal.throwIfAborted();
    events = await openFrameEvents(port, clientId, onLine);
  } catch (error) {
    signal.removeEventListener('abort', stopOnAbort);
    await stop();
    // An abort kills the child, which `endedEarly` reports as an exit: the cause was the abort, so the abort is what is thrown.
    if (signal.aborted) throw signal.reason;
    throw error;
  }

  // A death after ready ends every frame still waiting, with its last words.
  void exited.then(({ code, signal: exitSignal }) => {
    events.fail(new ComfyUIExit(`ComfyUI ended (${exitSignal ?? `code ${code}`}) while a frame was being made`, [...lastLines]));
  });

  const base = `http://127.0.0.1:${port}`;

  return {
    async renderFrame(sourceName, sliders) {
      const deadline = AbortSignal.any([signal, AbortSignal.timeout(FRAME_DEADLINE_MS)]);
      try {
        const prompt = {
          '1': { class_type: 'LoadImage', inputs: { image: sourceName } },
          '2': {
            class_type: 'ExpressionEditor',
            inputs: { ...sliders, src_ratio: 1, sample_ratio: 1, sample_parts: 'OnlyExpression', crop_factor: FACE_FRAMING.cropFactor, src_image: ['1', 0] },
          },
        };
        const queued = await fetch(`${base}/prompt`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ prompt, client_id: clientId }),
          signal: deadline,
        });
        if (!queued.ok) throw new Error(`ComfyUI refused the prompt (HTTP ${queued.status}): ${(await queued.text()).slice(0, 600)}`);
        const { prompt_id: promptId } = (await queued.json()) as { prompt_id: string };

        const image = await events.imageOf(promptId, deadline);
        const view = new URLSearchParams({ filename: image.filename, type: image.type, subfolder: image.subfolder ?? '' });
        const response = await fetch(`${base}/view?${view}`, { signal: deadline });
        if (!response.ok) throw new Error(`ComfyUI would not show the preview (HTTP ${response.status})`);
        return Buffer.from(await response.arrayBuffer());
      } catch (error) {
        if (signal.aborted) throw signal.reason;
        if (deadline.aborted) throw new Error(`a frame was not done within ${FRAME_DEADLINE_MS / 60000} minutes`);
        throw error;
      }
    },
    async stop() {
      signal.removeEventListener('abort', stopOnAbort);
      events.close();
      await stop();
    },
  };
}
