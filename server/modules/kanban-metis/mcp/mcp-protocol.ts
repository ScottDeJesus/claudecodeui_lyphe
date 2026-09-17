/**
 * The stdio JSON-RPC 2.0 transport, and the tool-schema contract the tools are served under.
 *
 * Newline-delimited JSON on stdin and stdout, one message per line, no `Content-Length`
 * framing — the shape every CLI-side MCP server speaks and the shape
 * `server/modules/browser-use/browser-use-mcp.ts` already speaks in this repository. Nothing but
 * a JSON-RPC message is ever written to stdout: a stray `console.log` on that stream would land
 * mid-message and the client would drop the session, so diagnostics go to stderr and the tools
 * are handed an `isError` result instead of a printed line.
 *
 * A tool's declared `inputSchema` is LOAD-BEARING here, not decoration: this file checks the
 * required set and the declared type and enum of every supplied argument before the handler
 * runs, so a handler may read its arguments directly instead of re-litigating the shape. That is
 * also the one place a refusal becomes an `isError` result — a handler that throws is answering
 * "this call failed", which the model must see as a failure and never as a success.
 */

type JsonRpcId = string | number | null;

export type JsonRpcRequest = {
  jsonrpc: '2.0';
  id?: JsonRpcId;
  method: string;
  params?: Record<string, unknown>;
};

/** One declared tool: the name the client calls, and the raw JSON-Schema for its arguments. */
export type ToolDefinition = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

/**
 * What a tool handler answers with.
 *
 * `content` is the MCP text channel; `isError` must be set on every failure, because a tool that
 * reported a failed board write as a plain success would have the model record work the board
 * never did.
 */
export type ToolResult = {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
};

export type ToolHandler = (args: Record<string, unknown>) => Promise<ToolResult> | ToolResult;

/** The two things a module of tools hands the transport: what it offers, and what answers. */
export type ToolTable = {
  tools: ToolDefinition[];
  handlers: Record<string, ToolHandler>;
};

const SERVER_VERSION = '1.0.0';
const PROTOCOL_VERSION = '2024-11-05';

/**
 * The argument shapes more than one tool declares, in one home each.
 *
 * The transport validates against these very declarations, so a second copy of "the feature card
 * id" would be a second door: one tool's would drift from another's, and the drift would only show
 * up as a tool call that stopped accepting an id its neighbour still took.
 */
export const CARD_ID_ARGUMENT = {
  type: 'string',
  description: "The feature card id (e.g. 'c-3').",
};

export const TAGS_ARGUMENT = {
  type: 'array',
  items: { type: 'string' },
  description: 'A list of tag strings.',
};

export const TAG_ARGUMENT = {
  type: 'string',
  description: 'Only cards carrying this tag.',
};

/** The raw JSON-Schema every tool's arguments are declared as. */
export function toolSchema(
  properties: Record<string, Record<string, unknown>>,
  required: readonly string[]
): Record<string, unknown> {
  return { type: 'object', properties, required: [...required] };
}

/** A successful tool result: the JSON rendering of whatever the handler read off the board. */
export function textResult(value: unknown): ToolResult {
  return {
    content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }],
  };
}

/** A failed tool result. Every refused board verb reaches the model as one of these. */
export function errorResult(message: string): ToolResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}

/**
 * The declared schema, enforced before the handler sees the arguments.
 *
 * Only the three things the schemas actually declare are checked — required presence, `type`, and
 * `enum` — plus string members inside an array of strings. A value that passes is one the
 * handler's own type assertions on the declared names are entitled to trust. Anything the schema
 * does not mention is passed through untouched: a schema is a door, not a transformer.
 */
function validateArguments(descriptor: ToolDefinition, args: Record<string, unknown>): string | null {
  const schema = descriptor.inputSchema;
  const properties = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;

  for (const name of (schema.required ?? []) as string[]) {
    if (args[name] === undefined) return `${name} is required.`;
  }

  for (const [name, property] of Object.entries(properties)) {
    const value = args[name];
    if (value === undefined) continue;

    const expectedType = property.type;
    if (typeof expectedType === 'string' && !matchesType(value, expectedType)) {
      return `${name} must be ${/^[aeiou]/.test(expectedType) ? 'an' : 'a'} ${expectedType}.`;
    }
    if (Array.isArray(property.enum) && !property.enum.includes(value)) {
      return `${name} must be one of: ${(property.enum as unknown[]).join(', ')}.`;
    }

    const itemSchema = (property.items ?? {}) as Record<string, unknown>;
    if (expectedType === 'array' && typeof itemSchema.type === 'string' && Array.isArray(value)) {
      const wrong = value.find((member) => !matchesType(member, itemSchema.type as string));
      if (wrong !== undefined) return `${name} must contain only ${itemSchema.type} values.`;
    }
  }

  return null;
}

/** JSON-Schema `type` against a runtime value. `integer` excludes booleans, which `number` alone would not. */
function matchesType(value: unknown, expectedType: string): boolean {
  switch (expectedType) {
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'array':
      return Array.isArray(value);
    case 'object':
      return typeof value === 'object' && value !== null && !Array.isArray(value);
    default:
      return true;
  }
}

/**
 * One parsed message in, one answer out — or none.
 *
 * `undefined` means "say nothing", which is what a `notifications/*` frame gets: the client's
 * `notifications/initialized` is a courtesy, not a question.
 */
async function handleMessage(
  message: JsonRpcRequest,
  table: ToolTable
): Promise<ToolResult | Record<string, unknown> | undefined> {
  if (message.method === 'initialize') {
    return {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: { name: 'kanban-pm', version: SERVER_VERSION },
    };
  }

  if (message.method === 'tools/list') {
    return { tools: table.tools };
  }

  if (message.method === 'tools/call') {
    const params = message.params ?? {};
    const name = params.name;
    if (typeof name !== 'string' || name.trim() === '') {
      throw new ProtocolError(-32602, 'tools/call requires a tool name.');
    }

    const descriptor = table.tools.find((tool) => tool.name === name);
    const handler = table.handlers[name];
    if (!descriptor || !handler) {
      throw new ProtocolError(-32602, `Unknown tool: ${name}`);
    }

    const rawArguments = params.arguments;
    if (rawArguments !== undefined && (typeof rawArguments !== 'object' || rawArguments === null)) {
      return errorResult('arguments must be an object.');
    }

    const args = (rawArguments ?? {}) as Record<string, unknown>;
    const invalid = validateArguments(descriptor, args);
    if (invalid !== null) return errorResult(invalid);

    return handler(args);
  }

  if (message.method.startsWith('notifications/')) {
    return undefined;
  }

  throw new ProtocolError(-32601, `Unsupported method: ${message.method}`);
}

/** A JSON-RPC level refusal — a malformed or unknown frame, never a tool's own failure. */
class ProtocolError extends Error {
  readonly code: number;

  constructor(code: number, message: string) {
    super(message);
    this.code = code;
  }
}

function writeMessage(message: Record<string, unknown>): void {
  // MCP stdio transport uses newline-delimited JSON (one JSON-RPC message per line, no embedded
  // newlines). This is NOT the LSP Content-Length framing.
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function sendResult(id: JsonRpcId | undefined, result: unknown): void {
  if (id === undefined) return;
  writeMessage({ jsonrpc: '2.0', id, result });
}

function sendError(id: JsonRpcId | undefined, code: number, message: string): void {
  if (id === undefined) return;
  writeMessage({ jsonrpc: '2.0', id, error: { code, message } });
}

/**
 * Reads stdin to the end of the process, answering each line, and ends the process when stdin
 * closes.
 *
 * Messages are handled one at a time, in arrival order: the answers a client correlates by `id`
 * arrive in the order it asked, and a tool's HTTP round trip cannot interleave a second tool's
 * write into the board.
 */
export function startStdioTransport(table: ToolTable): void {
  let buffer = '';
  let pending: Promise<void> = Promise.resolve();
  let closing = false;

  const finish = async (): Promise<void> => {
    if (closing) return;
    closing = true;
    // Whatever arrived before the pipe closed still gets its answer written.
    await pending;
    process.exit(0);
  };

  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk: string) => {
    buffer += chunk;

    let newlineIndex: number;
    while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
      const rawMessage = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (!rawMessage) continue;

      pending = pending.then(() => respondTo(rawMessage, table));
    }
  });

  process.stdin.on('end', () => void finish());
  process.stdin.on('close', () => void finish());
}

async function respondTo(rawMessage: string, table: ToolTable): Promise<void> {
  let request: JsonRpcRequest;
  try {
    request = JSON.parse(rawMessage) as JsonRpcRequest;
  } catch (error) {
    sendError(null, -32700, `Invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }

  try {
    const result = await handleMessage(request, table);
    // A frame the transport owes no answer — a notification — writes nothing at all.
    if (result !== undefined) sendResult(request.id, result);
  } catch (error) {
    if (error instanceof ProtocolError) {
      sendError(request.id, error.code, error.message);
      return;
    }
    // A tool that threw is a tool call that FAILED, and the model has to see it as one.
    process.stderr.write(`[kanban-pm] ${error instanceof Error ? error.stack : String(error)}\n`);
    sendResult(request.id, errorResult(error instanceof Error ? error.message : String(error)));
  }
}
