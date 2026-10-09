import { query } from '@anthropic-ai/claude-agent-sdk';

import { userFacingEnv } from '@/shared/child-env.js';
import { resolveClaudeCodeExecutablePath } from '@/shared/claude-cli-path.js';
import type { CerberusDiagnosisSubmission } from '@/shared/cerberus-types.js';

import { diagnosisWorkingDirectory } from './diagnosis-agent.js';

/**
 * The summary audit: a second, cheap model reads a diagnosis's SUMMARY against the EVIDENCE lines it quotes and names every
 * clause that states something as found which no evidence line shows.
 *
 * WHY. The gates before it hold what was QUOTED (`diagnosis-quotes.ts`, `diagnosis-absence.ts`); a summary's claims are prose, and
 * no lexical gate tells a claim an evidence line shows from one it does not. The prompt asks the agent to "state as found only
 * what an evidence line copies, and say 'suggests' for a cause you infer" — and two fresh Haiku diagnoses (2026-10-07) wrote
 * "indicating it was never started or has been disabled in the application startup configuration" and "because the approval_engine
 * sweeper has not run … causing scheduled uploads to queue" over evidence that showed neither, the second with a service restart
 * proposed. Measured on Haiku before this was built: five summaries, three reads each, the same verdict every time.
 *
 * WHAT HOLDS THE BAR. The auditor sees the summary and the evidence lines and nothing else: the bar is the one the prompt states,
 * so a clause true by a read the evidence list does not quote is named, and the agent answers by adding the line or hedging.
 * The check's own value (a count of overdue items) is given to the agent, not read, and is not a finding.
 *
 * IT NEVER STOPS A DIAGNOSIS. The auditor is a courtesy to the sheet's reader, not a gate that can fail one: when it cannot answer
 * (the SDK fails, 30 s pass, the reply holds no list) the submission goes through unaudited and the reason is logged, and
 * `diagnosis-deps.ts` refuses on its word at most twice per diagnosis. The model is `CERBERUS_DIAG_AUDIT_MODEL`, else Haiku.
 *
 * Consumers: `diagnosis-deps.ts`, whose `submit` awaits `unsupportedClauses` last, after every lexical gate has passed.
 */

/** The model that audits a summary, when `CERBERUS_DIAG_AUDIT_MODEL` names none. */
const DEFAULT_AUDIT_MODEL = 'claude-haiku-4-5-20251001';

/** How long the auditor has before the submission goes through unaudited. */
const AUDIT_TIMEOUT_MS = 30_000;

const AUDIT_SYSTEM_PROMPT = [
  'You audit the SUMMARY of a diagnosis against the EVIDENCE lines it quotes. The evidence lines are the only things the diagnosing agent actually read and copied.',
  'A summary may state something as FOUND (a plain statement of fact; "because", "causing", "preventing", "indicating that it is") only when an evidence line shows it. A cause, an effect or a configuration that no evidence line shows must be hedged ("may", "might", "suggests", "could") or left out.',
  'Go through the summary clause by clause. List each clause that states, without a hedge, something no evidence line shows. Copy each clause exactly as written. A figure in the check\'s own value (such as a count of overdue items) is given to the agent, not read, so it is not a finding. Do not list a clause that is hedged, and do not list a clause an evidence line shows.',
  'Reply with one JSON object and nothing else: {"unsupported": ["<clause>", ...]} — an empty list when every unhedged clause is shown.',
].join('\n\n');

/** The auditor's reply as a list, or null when it holds none: the model fences its JSON and sometimes explains it, so the list is looked for, not the whole reply parsed. */
function clausesIn(reply: string): string[] | null {
  const found = /"unsupported"\s*:\s*(\[(?:[^\]"]|"(?:[^"\\]|\\.)*")*\])/.exec(reply);
  if (!found) return null;
  try {
    const list: unknown = JSON.parse(found[1]);
    return Array.isArray(list) ? list.filter((clause): clause is string => typeof clause === 'string' && clause.trim() !== '') : null;
  } catch {
    return null;
  }
}

/**
 * The clauses of `submission.summary` that state something as found which none of its evidence lines shows, in the summary's own words;
 * empty when the summary holds to its evidence, and null when the auditor could not answer (logged).
 *
 * Consumers: `diagnosis-deps.ts`.
 */
export async function unsupportedClauses(submission: Pick<CerberusDiagnosisSubmission, 'summary' | 'evidence'>): Promise<string[] | null> {
  const abortController = new AbortController();
  const timer = setTimeout(() => abortController.abort(), AUDIT_TIMEOUT_MS);
  try {
    const executable = resolveClaudeCodeExecutablePath(process.env.CLAUDE_CLI_PATH);
    const evidence = submission.evidence.length > 0 ? submission.evidence.map((line) => `- ${line}`).join('\n') : '(none)';
    const conversation = query({
      prompt: `SUMMARY:\n${submission.summary}\n\nEVIDENCE:\n${evidence}`,
      options: {
        model: process.env.CERBERUS_DIAG_AUDIT_MODEL || DEFAULT_AUDIT_MODEL,
        systemPrompt: AUDIT_SYSTEM_PROMPT,
        tools: [],
        strictMcpConfig: true,
        settingSources: [],
        persistSession: false,
        cwd: diagnosisWorkingDirectory(),
        maxTurns: 1,
        abortController,
        env: userFacingEnv(),
        ...(executable ? { pathToClaudeCodeExecutable: executable } : {}),
      },
    });
    try {
      for await (const message of conversation) {
        // The same proof the diagnosing agent gets (INV-7153): the options are a promise, the CLI's own list is the check.
        if (message.type === 'system' && message.subtype === 'init' && message.tools.length > 0) {
          console.warn(`[Cerberus] the summary audit session held tools (${message.tools.join(', ')}); it was not run and the summary goes through unaudited`);
          return null;
        }
        if (message.type !== 'result') continue;
        if (message.subtype !== 'success') break;
        const clauses = clausesIn(message.result);
        if (clauses === null) console.warn('[Cerberus] the summary audit answered without a list; the summary goes through unaudited');
        return clauses;
      }
    } finally {
      conversation.close();
    }
    console.warn('[Cerberus] the summary audit ended without an answer; the summary goes through unaudited');
    return null;
  } catch (error) {
    console.warn(`[Cerberus] the summary audit could not run (${error instanceof Error ? error.message : String(error)}); the summary goes through unaudited`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** The refusal the agent reads when `clauses` were named: which clauses, and the two ways out. */
export function unsupportedSentence(clauses: string[]): string {
  const named = clauses.map((clause) => `“${clause.replace(/[.\s]+$/, '')}”`).join('; ');
  return (
    `The summary states as found what no evidence line shows: ${named}. State as found only what an evidence line copies — add the read line ` +
    'that shows it, say "suggests" or "may" for a cause you infer, or leave the clause out'
  );
}
