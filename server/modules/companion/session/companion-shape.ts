import { createHash } from 'node:crypto';

import type { SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

import type { CompanionProvider } from '@/shared/companion-provider.js';

/**
 * THE SHAPE OF HER SESSION: a fingerprint of the two things the CLI records ONCE, in the first request of a conversation, and
 * keeps on every resume of it — her tools (each one's name, description and input schema, as her MCP server serves them) and her
 * system prompt — and of the ENDPOINT the conversation was opened on (the provider). A new tool NAME reaches a resumed session
 * (the CLI re-lists the server's tools); a parameter added to a tool that already exists, or a changed prompt, does not: the resumed conversation goes on with the shape it began with. So a change
 * to either is dark to her until she starts a new conversation, and `session/companion-session.ts` stores this fingerprint with
 * the session id and resumes only a conversation whose fingerprint is the launch's own. The prompt is the composed one (her soul pages,
 * read at each launch, then her plumbing: `companion-prompt.ts`), so an edit to either soul page is a new shape at her next launch, and
 * a fresh conversation from a handover, exactly as an edit to the plumbing is.
 *
 * PURE: no clock, no I/O. The same tools, prompt and provider give the same text whatever order the tools were built in or the keys of a
 * schema were written in; anything the CLI would show her differently gives other text. The MODEL is not in it (a switch between
 * two Claude models is applied live, `setModel`, and the conversation survives it), nor are the settings that ride with every
 * message (the register). The PROVIDER is: a conversation is held by the endpoint that opened it, so one opened on Claude is never
 * resumed on DeepSeek (nor the reverse), and a model change that crosses endpoints finds a held id with another shape and starts a fresh
 * conversation through the ordinary refusal (`companion-refusal.ts`).
 *
 * THE `claude` PROVIDER ADDS NOTHING TO THE TEXT, so a fingerprint taken before the provider existed is the one a Claude launch takes now:
 * a conversation held at the day the DeepSeek model arrived keeps resuming, where a `provider` member written for every provider would
 * have made every held shape stale and every conversation fresh. Only a provider other than Claude is written into it.
 *
 * Consumer: `session/companion-session.ts`, once for every launch it plans.
 */

/** JSON text with the keys of every object sorted, so two equal values write equal text whatever order their keys were built in. Arrays keep their order: it is part of what they say. */
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value)
      .filter(([, member]) => member !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    return `{${entries.map(([key, member]) => `${JSON.stringify(key)}:${stableJson(member)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/**
 * The fingerprint of a session begun with `tools` and `systemPrompt` on `provider`: a hex SHA-256 over each tool's name, description and JSON
 * schema (tools in name order, the schema in zod's INPUT mode: that is the side the bridge serves, where a property wrapped in `.transform()`
 * keeps its constraints instead of reading as `{}`), the composed prompt (`fillSystemPrompt`: soul pages and plumbing, the operator's
 * name filled in) and, for a provider other than `claude`, the provider's name. A schema zod cannot represent is written as `{}` rather than
 * thrown: the fingerprint must never be the reason her launch fails. Consumed by
 * `session/companion-session.ts`.
 */
export function sessionShapeOf(tools: ReadonlyArray<SdkMcpToolDefinition<any>>, systemPrompt: string, provider: CompanionProvider): string {
  const served = [...tools]
    .sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0))
    .map((definition) => ({
      name: definition.name,
      description: definition.description,
      schema: z.toJSONSchema(z.object(definition.inputSchema as z.ZodRawShape), { unrepresentable: 'any', io: 'input' }),
    }));
  const fingerprinted = provider === 'claude' ? { tools: served, systemPrompt } : { tools: served, systemPrompt, provider };
  return createHash('sha256').update(stableJson(fingerprinted)).digest('hex');
}
