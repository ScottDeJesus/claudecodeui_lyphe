// web_walk.mjs — the house's web-walk command for a case that walks an app through it.
//   webWalk(args, {input?, env?, timeoutMs?}) -> {error, status, stdout, stderr, answer}
// error is set only when the command did not end (a timeout, a spawn failure); status is its exit code; answer is stdout's
// last line as JSON, or null. It runs the command without blocking the event loop: spawnSync held the loop for a whole
// walk, so a signed-in door's kept-alive socket the server closed meanwhile was reused dead on the next request
// (UND_ERR_SOCKET). The caller's WEB_WALK_* variables are dropped unless env names them again.
import { execFile } from "node:child_process";

export const WEB_WALK = "/home/lyphe/.claude/scripts/web-walk";
const DROPPED = ["WEB_WALK_OUT", "WEB_WALK_PICTURE_BYTES", "WEB_WALK_APPS"];
const DEFAULT_LIMIT_MS = 110000;

export function webWalk(args, { input, env = {}, timeoutMs = DEFAULT_LIMIT_MS } = {}) {
  const base = { ...process.env };
  for (const key of DROPPED) delete base[key];
  return new Promise((resolve) => {
    const child = execFile(WEB_WALK, args, { encoding: "utf8", env: { ...base, ...env }, timeout: timeoutMs, maxBuffer: 64 << 20 }, (error, stdout, stderr) => {
      const ended = !error || typeof error.code === "number";
      resolve({ error: ended ? null : error, status: ended ? (error?.code ?? 0) : null, stdout, stderr, answer: lastJson(stdout) });
    });
    child.stdin.end(input ?? "");
  });
}

function lastJson(text) {
  const last = text.split("\n").map((line) => line.trim()).filter(Boolean).pop();
  try {
    return last === undefined ? null : JSON.parse(last);
  } catch {
    return null;
  }
}
