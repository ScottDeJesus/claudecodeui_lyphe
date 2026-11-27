// The automatic install's switch is a write the server makes (app_config) and the Claude-updates panel shows.
// With the panel's 60 s read gone, a write that tells nothing is never seen by another open tab: flipping the
// switch must tell once after the write, through the module's write seam (onUpdateFileWritten) or a tell the
// service is handed, so the claude_updates_changed hint carries it.
//
// protects: server/modules/claude-updates/update-auto-install.service.ts, server/modules/claude-updates/update-written.ts, server/modules/claude-updates/claude-updates.module.ts
// writes: none

import { broken, held, runCase } from "../lib/case.mjs";

const AUTO_INSTALL = "../../server/modules/claude-updates/update-auto-install.service.ts";
const UPDATE_WRITTEN = "../../server/modules/claude-updates/update-written.ts";

runCase(async () => {
  const written: any = await import(UPDATE_WRITTEN);
  const service: any = await import(AUTO_INSTALL);
  const stored = new Map<string, string>();
  const order: string[] = [];
  const tell = () => order.push("tell " + (stored.size > 0 ? "after the write" : "before the write"));
  written.onUpdateFileWritten(tell);
  const config = {
    get: (key: string) => stored.get(key) ?? null,
    set: (key: string, value: string) => { stored.set(key, value); },
  };
  const autoInstall = service.createAutoInstall({
    config,
    readActivity: async () => ({ running: 0 }),
    readReadings: async () => ({ packages: [], job: null }),
    applyUpdate: async () => ({ ok: true }),
    tell,
    onChanged: tell,
    announce: tell,
  });
  autoInstall.setEnabled(true);
  if (stored.size === 0) return broken("setEnabled(true) wrote nothing to the scratch config");
  if (order.length === 0) return broken("flipping the auto-install switch wrote app_config and told nothing: no claude_updates_changed reaches another tab");
  if (order[0] !== "tell after the write") return broken("flipping the switch told before its write landed");
  return held("flipping the switch wrote the config and then told " + order.length + " time(s)");
});
