// code_mode_cli.mjs — the REAL Claude CLI launched on a Code Mode chat's options, talking to a loopback stand-in for
// the Messages API, so a case sees what the CLI itself makes of the launch and spends nothing.
//
// Usage (cases/modules/<name>.ts, after lib/code_mode_chat.mjs opened its ground):
//   import { standInApi, chatOptions, runChat, toolUse, text, lastResultText } from "../lib/code_mode_cli.mjs";
//   const api = await standInApi(t, (step) => ...);        // step: "open", or the name of the tool whose result came last
//   const options = chatOptions(ground, api, "default");   // what mapCliOptionsToSDK starts a chat from, cut to the fields a launch reads
//   applyCodeModeLaunch(options, launch);                  // the seam under test
//   const run = await runChat(t, options, "prompt", { untilInit: true });
//   run.init                                              // the CLI's system/init message (tools, mcp_servers, permissionMode)
//   run.messages                                          // every SDK message, oldest first
//   api.turns                                             // each main-loop request's step, oldest first
//   api.requestTools                                      // the tool names of every request, as the model is offered them
//   api.bodies                                            // every request body, oldest first (what the model would have read)
//   lastResultText(messages)                              // the tool_result text of a request's last message
//
// The binary is the runtime's own (resolveClaudeCodeExecutablePath, server/shared/claude-cli-path.ts). Measured
// 2026-11-20 on CLI 2.1.330: system/init names the agent tool `Task` while the request offers it as `Agent`, and a tool
// the CLI does not know is dropped from the list without a word.
//
// NOTHING REAL IS SPENT OR KEPT. The CLI's env names the stand-in's URL and a made-up API key and drops the sign-in
// names, so no request leaves loopback; `persistSession: false` keeps its transcript off ~/.claude/projects. The CLI
// still loads the operator's user settings (the runtime's settingSources), as a real chat does: that is how the house's
// PreToolUse hooks reach a chat, which is part of what a case here judges.

import http from "node:http";

import { query } from "@anthropic-ai/claude-agent-sdk";

import { resolveClaudeCodeExecutablePath } from "../../server/shared/claude-cli-path.ts";

export const MADE_UP_KEY = "sk-ant-api03-standin-made-up-key-0000000000";
const SIGN_IN_NAMES = ["CLAUDE_CODE_OAUTH_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR", "ANTHROPIC_AUTH_TOKEN"];
export const EXECUTE = "mcp__cm__execute";
const RUN_TIMEOUT_MS = 90_000;

export const toolUse = (name, input) => ({ type: "tool_use", name, input });
export const text = (words) => ({ type: "text", text: words });

/** What the conversation calls for: "open", or the name of the tool whose result came last. */
function stepOf(messages) {
  const last = messages[messages.length - 1] ?? {};
  const content = Array.isArray(last.content) ? last.content : [];
  const results = content.filter((c) => c && c.type === "tool_result");
  if (last.role !== "user" || results.length === 0) return "open";
  const wanted = results[results.length - 1].tool_use_id;
  for (const message of [...messages].reverse()) {
    for (const block of Array.isArray(message.content) ? message.content : []) {
      if (block && block.type === "tool_use" && block.id === wanted) return String(block.name);
    }
  }
  return "unknown";
}

/** The tool_result text of the last message, joined. */
export function lastResultText(messages) {
  const last = messages[messages.length - 1] ?? {};
  const out = [];
  for (const block of Array.isArray(last.content) ? last.content : []) {
    if (block?.type !== "tool_result") continue;
    if (typeof block.content === "string") out.push(block.content);
    else for (const part of block.content ?? []) if (part?.type === "text") out.push(part.text);
  }
  return out.join("\n");
}

function sse(model, block, n) {
  const out = [];
  const event = (kind, data) => out.push(`event: ${kind}\ndata: ${JSON.stringify(data)}\n\n`);
  event("message_start", { type: "message_start", message: { id: `msg_standin_${n}`, type: "message", role: "assistant", model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 11, output_tokens: 3 } } });
  if (block.type === "tool_use") {
    event("content_block_start", { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: `toolu_standin_${n}`, name: block.name, input: {} } });
    event("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: JSON.stringify(block.input) } });
  } else {
    event("content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } });
    event("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: block.text } });
  }
  event("content_block_stop", { type: "content_block_stop", index: 0 });
  event("message_delta", { type: "message_delta", delta: { stop_reason: block.type === "tool_use" ? "tool_use" : "end_turn", stop_sequence: null }, usage: { output_tokens: 3 } });
  event("message_stop", { type: "message_stop" });
  return out.join("");
}

/**
 * A loopback Messages API. A main-loop request (one whose tools name mcp__cm__execute) is answered by
 * `script(step, messages)`; every other request (a title, a side question) by the text `ok`. Closed at the case's end.
 */
export async function standInApi(t, script) {
  const api = { url: "", turns: [], toolNames: [], mainBodies: [], requestTools: [], bodies: [] };
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      let body = {};
      try { body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); } catch { body = {}; }
      const send = (type, data) => { res.writeHead(200, { "content-type": type }); res.end(data); };
      if (req.url?.includes("count_tokens")) return send("application/json", JSON.stringify({ input_tokens: 11 }));
      const names = (body.tools ?? []).map((tool) => tool?.name).filter(Boolean);
      api.requestTools.push(names);
      api.bodies.push(body);
      let block = text("ok");
      if (names.includes(EXECUTE)) {
        const step = stepOf(body.messages ?? []);
        api.turns.push(step);
        api.toolNames.push(names);
        api.mainBodies.push(body);
        block = script(step, body.messages ?? []);
      }
      const model = String(body.model ?? "standin");
      const n = api.turns.length + 1;
      if (body.stream) return send("text/event-stream", sse(model, block, n));
      const content = block.type === "tool_use" ? [{ ...block, id: `toolu_standin_${n}` }] : [block];
      return send("application/json", JSON.stringify({ id: `msg_standin_${n}`, type: "message", role: "assistant", model, content, stop_reason: block.type === "tool_use" ? "tool_use" : "end_turn", stop_sequence: null, usage: { input_tokens: 11, output_tokens: 3 } }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  api.url = `http://127.0.0.1:${server.address().port}`;
  t.defer(() => new Promise((resolve) => { server.closeAllConnections?.(); server.close(() => resolve()); }));
  return api;
}

/**
 * The options a chat starts from, as mapCliOptionsToSDK builds them, cut to the fields a Code Mode launch reads and
 * replaces: the claude_code tools preset, the claude_code system prompt, the runtime's setting sources, an empty allow
 * list, and the process env pointed at the stand-in.
 */
export function chatOptions(ground, api, permissionMode = "default") {
  const env = { ...process.env, ANTHROPIC_BASE_URL: api.url, ANTHROPIC_API_KEY: MADE_UP_KEY };
  for (const name of SIGN_IN_NAMES) delete env[name];
  // A chat's CLI is the CloudCLI server's child, never a soul's: the names that say a process runs inside a soul or a
  // Claude session (a case runs under a dispatched soul too) would make the house's hooks treat the chat as one —
  // main_session_dactyls.py tells a soul child nothing, measured 2026-11-20.
  for (const name of Object.keys(env)) if (name.startsWith("PLAN_RUNNER_")) delete env[name];
  delete env.CLAUDE_CODE_SESSION_ID;
  delete env.DISPATCHER_SESSION;
  delete env.DISPATCHER_HOME;
  delete env.CODE_MODE_KIND;
  const executable = resolveClaudeCodeExecutablePath(process.env.CLAUDE_CLI_PATH);
  return {
    ...(executable ? { pathToClaudeCodeExecutable: executable } : {}),
    cwd: ground.repo,
    env,
    tools: { type: "preset", preset: "claude_code" },
    systemPrompt: { type: "preset", preset: "claude_code", append: "" },
    settingSources: ["project", "user", "local"],
    allowedTools: [],
    disallowedTools: [],
    permissionMode,
    persistSession: false,
    model: "claude-sonnet-4-5",
  };
}

/**
 * Runs one prompt on the real CLI. With `untilInit` it stops at the CLI's system/init. `canUseTool` answers every ask
 * with allow and records it. Never throws: a run that fails says so in `error`.
 */
export async function runChat(t, options, prompt, { untilInit = false, timeoutMs = RUN_TIMEOUT_MS } = {}) {
  const abortController = new AbortController();
  const run = { init: null, messages: [], asks: [], error: "" };
  const timer = setTimeout(() => abortController.abort(), timeoutMs);
  timer.unref?.();
  t.defer(() => abortController.abort());
  const canUseTool = async (toolName, input) => {
    run.asks.push({ toolName, input });
    return { behavior: "allow", updatedInput: input };
  };
  try {
    for await (const message of query({ prompt, options: { ...options, abortController, canUseTool } })) {
      run.messages.push(message);
      if (message.type === "system" && message.subtype === "init") {
        run.init = message;
        if (untilInit) break;
      }
      if (message.type === "result") break;
    }
  } catch (error) {
    if (!abortController.signal.aborted || !untilInit) run.error = String(error?.message ?? error).split("\n")[0];
  } finally {
    clearTimeout(timer);
    abortController.abort();
  }
  return run;
}
