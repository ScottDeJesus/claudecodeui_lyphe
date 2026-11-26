// protects: src/shared/utils.ts, src/modules/chat-host/ChatHostFab.tsx, src/modules/chat-host/ChatHostPanel.tsx, src/modules/chat-host/ChatHostSlot.tsx, src/modules/sidebar/SidebarSessionPickerPopover.tsx
// writes: none
//
// The chat's own pop-outs close on a press elsewhere in the chat, and the chat's button is the chat's. The floating chat
// (the scratch chat, no turn sent) is opened over Bugs with Menu → last chat; the picker under its title is opened; the
// chat's button is pressed, which folds the panel away. The picker's list must be gone with it. While the panel and the
// button are two keeps-opening regions, the list stays on the page alone (measured 2026-11-25).

import { execFile } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { broken, cannotRun, held, runCase } from "../lib/case.mjs";

const WEB_WALK = "/home/lyphe/.claude/scripts/web-walk";
const SID = "d47bf532-baa5-4d29-b38c-af943a9b4573";
const PICKER = { role: "button", name: "Reply with the single word ok. cloudcli-probe-chat" };
const FOLD = { role: "button", name: "Fold the chat down to its core" };
const LIST = { text: "New chat" };

const walk = {
  app: "cloudcli",
  sizes: ["desktop"],
  steps: [
    { go: "/session/" + SID }, { wait: 1500 }, { open: "bugs" },
    { click: "Menu" }, { wait: 800 }, { click: { text: "last chat" } }, { wait: 1500 },
    { click: PICKER }, { wait: 800 }, { see: LIST },
    { click: FOLD }, { wait: { gone: LIST } },
  ],
};

const run = (file) => new Promise((done) => {
  execFile(WEB_WALK, ["run", file], { timeout: 170000, maxBuffer: 1 << 22 }, (error, stdout, stderr) => done({ error, out: String(stdout) + String(stderr) }));
});

runCase(async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "case-chat-fab-picker-"));
  const file = path.join(dir, "walk.json");
  writeFileSync(file, JSON.stringify(walk));
  const { out } = await run(file);
  const line = (out.match(/^.*step \d+.*$/m) || [""])[0].slice(0, 300);
  if (/held: 1 of 1 variants ran every step/.test(out)) return held("the chat's button folded the chat and the picker's list went with it");
  if (/step 12\b/.test(out)) return broken("the chat's button folded the chat and the picker's list was left standing over the page: " + line);
  return cannotRun("the walk did not reach the press on the chat's button: " + (line || out.split("\n").slice(-3).join(" ").slice(0, 300)));
});
