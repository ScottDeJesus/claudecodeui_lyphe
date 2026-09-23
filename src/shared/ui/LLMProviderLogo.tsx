import type { LLMProvider } from '@/shared/types';
import { ClaudeCodeMark } from '@/shared/ui/ClaudeCodeMark';
import ClaudeLogo from '@/shared/ui/ClaudeLogo';
import CodexLogo from '@/shared/ui/CodexLogo';
import CursorLogo from '@/shared/ui/CursorLogo';
import DeepSeekLogo from '@/shared/ui/DeepSeekLogo';
import OpenCodeLogo from '@/shared/ui/OpenCodeLogo';

type LLMProviderLogoProps = {
  provider?: LLMProvider | string | null;
  className?: string;
  /**
   * Which of Claude's two marks to draw, for a call site that means one of them specifically.
   *
   * `brand`, the default, is `ClaudeLogo`: the company's starburst, the mark of the provider an
   * account or a session is opened on.
   *
   * `mascot` is `ClaudeCodeMark`: the pixel figure the coding agent itself wears, drawn where the
   * mark answers WHO is working inside a conversation — the chat transcript's assistant turns and
   * the subagent rows (the inline panel, and the pinned and gutter rows drawn from `PinnedAgentRow`
   * and `SoulLaunchPinRow`). It reads the same "Claude" label either way, so it is the mark that
   * changes and nothing beside it.
   *
   * The opt-in is here rather than a second door, and the call site passes one prop rather than
   * branching itself: which figure a PROVIDER is drawn with is this door's business, and a module
   * that names a provider and reaches past it for `ClaudeCodeMark` is how the two marks drift apart.
   * The composer's DeepSeek chip is the one consumer that draws the glyph itself, and it is not
   * naming a provider: it is a toggle, one side per state, so it draws the mascot directly while
   * the builds run on Claude and the whale through this door while they run on DeepSeek. Only the
   * Claude branch answers to `claudeMark` — every other provider has one mark and ignores it.
   */
  claudeMark?: 'brand' | 'mascot';
};

/** Used by the chat, onboarding, project-workspace, settings and sidebar modules to show which coding agent a session or project belongs to. */
export function LLMProviderLogo({
  provider = 'claude',
  className = 'w-5 h-5',
  claudeMark = 'brand',
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

  return claudeMark === 'mascot'
    ? <ClaudeCodeMark className={className} />
    : <ClaudeLogo className={className} />;
}
