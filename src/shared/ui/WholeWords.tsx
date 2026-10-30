import { Children, type ReactNode } from 'react';

/**
 * A status call's sentence with each hyphenated word held whole: a model id, a version or a time split
 * at a hyphen (`claude-haiku-4-5-` / `20251001`) reads as two things. Drawn as a waiting line's `<why>`,
 * which hands it the interpolated sentence as its children; every other word still wraps where it likes.
 *
 * Used by `RunnerCompactionRow` and `RunnerMainSessionDactylsRow` in the settings module and by
 * `AgentLaunchDactylField` in the agent-launch module, each for its Waiting line's reason, and by the companion module's
 * `CompanionFaceSettingsView` for a failed bake's and a refused photo's sentence (`scripts/install-comfyui.sh` held
 * whole) — three modules, so it is the kit's.
 */
export function WholeWords({ children }: { children?: ReactNode }) {
  return (
    <>
      {Children.toArray(children).map((child, at) =>
        typeof child !== 'string'
          ? child
          : child.split(/(\s+)/).map((word, index) =>
              word.includes('-') ? <span key={`${at}-${index}`} className="whitespace-nowrap">{word}</span> : word,
            ),
      )}
    </>
  );
}
