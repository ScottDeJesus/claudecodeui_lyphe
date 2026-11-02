import type { CompanionModel } from '@/shared/companion-types.js';

//----------------- KAYLEE'S PROVIDER ------------
// Which endpoint a model of Kaylee's is served from. It is a SIBLING of `server/shared/utils.ts` and
// `server/shared/types.ts` rather than an addition to either, for the reason `companion-types.ts` is one of
// `types.ts`: both are far past the house ceiling of 300 lines for a module. It is server-only (the page never
// needs the word: the picker lists models, not endpoints), so it is not part of the mirrored wire contract.

/**
 * The endpoint her CLI talks to: `claude` is the house's chosen Claude account (the subscription), `deepseek` is DeepSeek's
 * Anthropic-compatible endpoint under the DeepSeek key. Valid only as the answer of `companionProviderOf`. A conversation
 * belongs to ONE provider: the CLI records it on the endpoint that opened it, and a resume on the other would hand her a
 * conversation that endpoint never held, so the provider is part of her session's shape (`companion-shape.ts`) and the
 * save of a model that changes it closes her process (`companion.service.ts`) instead of switching it live.
 */
export type CompanionProvider = 'claude' | 'deepseek';

/**
 * The provider that serves `model`: `deepseek` for the DeepSeek model, `claude` for every Claude alias. The one place the
 * mapping is written, so a model added to the picker is `claude` unless it is named here. Consumed by
 * `modules/companion/session/companion-launch.ts` (which endpoint and credentials the launch carries),
 * `modules/companion/session/companion-session.ts` (the provider the shape is taken over) and
 * `modules/companion/companion.service.ts` (whether a model change crosses endpoints).
 */
export function companionProviderOf(model: CompanionModel): CompanionProvider {
  return model === 'deepseek' ? 'deepseek' : 'claude';
}
