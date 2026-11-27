// http_listener.mjs — a throwaway HTTP listener on 127.0.0.1 for the warden's http kind, recording each request line.
//
//   import { startListener } from "../lib/http_listener.mjs";
//   const listener = await startListener("ok");   // "ok" answers 200 · "redirect" 302 to the target asked · "silent" never answers
//   listener.origin    "http://127.0.0.1:<port>", a port the system picked
//   listener.lines     ["GET /src/main.tsx?t=… HTTP/1.1", …], also printed to stderr as each arrives
//   listener.targets   the request targets alone, byte for byte as they reached the socket
//   await listener.close();                        // drops every connection, then closes
//
// It binds 127.0.0.1 only and writes nothing; the case that starts it closes it in a finally.

import http from "node:http";

export async function startListener(mode = "ok") {
  const lines = [];
  const targets = [];
  const server = http.createServer((request, response) => {
    targets.push(request.url);
    lines.push(`${request.method} ${request.url} HTTP/${request.httpVersion}`);
    console.error(`listener (${mode}) heard: ${lines.at(-1)}`);
    if (mode === "silent") return;
    if (mode === "redirect") {
      response.writeHead(302, { Location: request.url });
      response.end();
      return;
    }
    response.writeHead(200, { "Content-Type": "text/plain" });
    response.end("ok");
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address();
  return {
    origin: `http://127.0.0.1:${port}`,
    lines,
    targets,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
