// protects: server/modules/providers/services/provider-runtime.service.ts, server/shared/types.ts, server/shared/code-mode-types.ts, server/modules/code-mode/code-mode.module.ts, server/modules/code-mode/index.ts
// writes: none
//
// A Claude process keeps the context of the message that spawned it for its whole life (MAN-8487), so the context's
// codeMode is one object that reads the registered hooks at CALL time: always present, inert until the code-mode
// module registers, and reaching whatever was registered last, even for a context built before the registration.
// The runtime imports nothing from server/modules/code-mode/; the module registers itself.
//
// The case captures the context providerRuntimeService.run hands a runtime (lib/code_mode_chat.mjs), asks it before
// anything registers, registers a stub through useChatCodeMode, then lets createCodeModeModule() register the real
// hooks and asks the same context again. Nothing reaches the house verb: the only launch the module is asked about
// has no chat id, which it answers off without asking.

import { broken, held, runCase } from "../lib/case.mjs";
import { contextOf, openCodeModeGround } from "../lib/code_mode_chat.mjs";

type Launch = { on: boolean };
type Hooks = {
  launchFor(input: Record<string, unknown>): Promise<Launch>;
  serversChanged(input: Record<string, unknown>): Promise<void>;
};

runCase(async (t: { defer: (cleanup: () => unknown) => void }) => {
  const ground = await openCodeModeGround(t, "code-mode-hook");
  const { context, providerRuntimeService } = await contextOf();
  const codeMode = (context as { codeMode?: Hooks } | null)?.codeMode;
  if (!codeMode) return broken("the runtime context carries no codeMode");

  const noChat = { appSessionId: null, onNode: false, cwd: ground.repo, servers: {} };
  const wrong: string[] = [];

  const inert = await codeMode.launchFor(noChat);
  if (JSON.stringify(inert) !== '{"on":false}') wrong.push(`before any registration launchFor answered ${JSON.stringify(inert)}`);
  const changed = await codeMode.serversChanged({ appSessionId: "none", servers: {} });
  if (changed !== undefined) wrong.push(`before any registration serversChanged resolved ${JSON.stringify(changed)}`);

  const register = (providerRuntimeService as { useChatCodeMode?: (hooks: Hooks) => void }).useChatCodeMode;
  if (typeof register !== "function") return broken(["providerRuntimeService has no useChatCodeMode", ...wrong].join("; "));

  const stubCalls: string[] = [];
  register.call(providerRuntimeService, {
    launchFor: async () => { stubCalls.push("launchFor"); return { on: false }; },
    serversChanged: async () => { stubCalls.push("serversChanged"); },
  });
  await codeMode.launchFor(noChat);
  await codeMode.serversChanged({ appSessionId: "none", servers: {} });
  if (stubCalls.join(",") !== "launchFor,serversChanged") {
    wrong.push(`a context built before useChatCodeMode reached the registered hooks ${stubCalls.length} time(s) of 2`);
  }

  let barrel: Record<string, unknown>;
  try {
    barrel = await import("../../server/modules/code-mode/index.ts");
  } catch (error) {
    return broken([`the code-mode barrel will not load: ${String((error as Error)?.message ?? error).split("\n")[0]}`, ...wrong].join("; "));
  }
  const create = barrel.createCodeModeModule;
  if (typeof create !== "function") return broken(["the code-mode barrel exports no createCodeModeModule", ...wrong].join("; "));
  await create();

  const before = stubCalls.length;
  const moduleAnswer = await codeMode.launchFor(noChat);
  if (stubCalls.length !== before) wrong.push("after createCodeModeModule() the context still reached the stub: the module registered nothing");
  if (JSON.stringify(moduleAnswer) !== '{"on":false}') wrong.push(`the module answered a launch with no chat id ${JSON.stringify(moduleAnswer)}`);

  if (wrong.length > 0) return broken(wrong.join("; "));
  return held("the context's codeMode was inert before registration, reached a stub registered after it was built, and reached the module once createCodeModeModule() ran (off for no chat id)");
});
