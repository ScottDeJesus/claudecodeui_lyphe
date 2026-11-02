/**
 * The DeepSeek endpoint and the model name a child of this server runs on when it is routed to DeepSeek.
 *
 * `~/.claude/hooks/plan_runner/deepseek.py` is the canonical home of both (its `BASE_URL` and `MODEL`),
 * and these are its values transcribed rather than a second opinion: every plan-runner on this box
 * already routes on them. A drift here would point a child of this server at an endpoint no other
 * child on the host uses, and nothing would say so.
 *
 * `DEEPSEEK_MODEL` is passed to the CLI VERBATIM. A Claude alias sent to this endpoint is mapped by the
 * vendor to a different model than the one named, while the CLI's own tally still says the alias.
 *
 * Consumers: `server/modules/kanban-metis` (a Flash board's Metis) and `server/modules/companion`
 * (Kaylee, when her model is DeepSeek), both through this module's barrel.
 */
export const DEEPSEEK_BASE_URL = 'https://api.deepseek.com/anthropic';
export const DEEPSEEK_MODEL = 'deepseek-flash';
