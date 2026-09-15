import type { LLMProvider } from '@/shared/types';
import ClaudeLogo from '@/shared/ui/ClaudeLogo';
import CodexLogo from '@/shared/ui/CodexLogo';
import CursorLogo from '@/shared/ui/CursorLogo';
import DeepSeekLogo from '@/shared/ui/DeepSeekLogo';
import OpenCodeLogo from '@/shared/ui/OpenCodeLogo';

type LLMProviderLogoProps = {
  provider?: LLMProvider | string | null;
  className?: string;
};

/** Used by the chat, onboarding, project-workspace, settings and sidebar modules to show which coding agent a session or project belongs to. */
export function LLMProviderLogo({
  provider = 'claude',
  className = 'w-5 h-5',
}: LLMProviderLogoProps) {
  if (provider === 'cursor') {
    return <CursorLogo className={className} />;
  }

  if (provider === 'codex') {
    return <CodexLogo className={className} />;
  }

  if (provider === 'opencode') {
    return <OpenCodeLogo className={className} />;
  }

  // NOT a member of `LLMProvider` (`'claude' | 'cursor' | 'codex' | 'opencode'`), and deliberately
  // so: that union is the set of coding agents a SESSION can be opened on, and DeepSeek is not
  // one — no session runs on it, no model menu lists it, and nothing about it is selectable. What
  // it is, is the endpoint a BUILD SOUL can be dispatched to, which is why the prop admits a bare
  // string and why the mark belongs here beside the others rather than in a second icon set.
  if (provider === 'deepseek') {
    return <DeepSeekLogo className={className} />;
  }

  return <ClaudeLogo className={className} />;
}
