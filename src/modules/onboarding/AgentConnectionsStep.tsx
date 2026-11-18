import type { LLMProvider, ProviderAuthStatusMap } from '@/shared/types';
import AgentConnectionCard from '@/modules/onboarding/AgentConnectionCard';

type AgentConnectionsStepProps = {
  providerStatuses: ProviderAuthStatusMap;
  onOpenProviderLogin: (provider: LLMProvider) => void;
};

const providerCards = [
  {
    provider: 'claude' as const,
    title: 'Claude Code',
    connectedClassName: 'bg-[var(--info-soft)] border-border',
    iconContainerClassName: 'bg-[var(--info-soft)]',
    loginButtonClassName: 'bg-primary hover:bg-primary/90',
  },
  {
    provider: 'cursor' as const,
    title: 'Cursor',
    connectedClassName: 'bg-[var(--info-soft)] border-border',
    iconContainerClassName: 'bg-[var(--info-soft)]',
    loginButtonClassName: 'bg-primary hover:bg-primary/90',
  },
  {
    provider: 'codex' as const,
    title: 'OpenAI Codex',
    connectedClassName: 'bg-muted border-border',
    iconContainerClassName: 'bg-muted',
    loginButtonClassName: 'bg-primary hover:bg-primary/90',
  },
  {
    provider: 'opencode' as const,
    title: 'OpenCode',
    connectedClassName: 'bg-muted border-border',
    iconContainerClassName: 'bg-muted',
    loginButtonClassName: 'bg-primary hover:bg-primary/90',
  },
];

/** Rendered by Onboarding as its second step, listing every CLI provider the user can log into. */
export default function AgentConnectionsStep({
  providerStatuses,
  onOpenProviderLogin,
}: AgentConnectionsStepProps) {
  return (
    <div className="space-y-4">
      <div className="text-center">
        <h2 className="font-serif text-xl font-bold tracking-tight text-foreground">Connect Your AI Agents</h2>
        <p className="mx-auto mt-1 max-w-sm text-sm leading-relaxed text-muted-foreground">
          Login to one or more AI coding assistants. All are optional.
        </p>
      </div>

      <div className="-mr-1 max-h-[38vh] space-y-2 overflow-y-auto pr-1">
        {providerCards.map((providerCard) => (
          <AgentConnectionCard
            key={providerCard.provider}
            provider={providerCard.provider}
            title={providerCard.title}
            status={providerStatuses[providerCard.provider]}
            connectedClassName={providerCard.connectedClassName}
            iconContainerClassName={providerCard.iconContainerClassName}
            loginButtonClassName={providerCard.loginButtonClassName}
            onLogin={() => onOpenProviderLogin(providerCard.provider)}
          />
        ))}
      </div>

      <p className="text-center text-xs text-muted-foreground">You can configure these later in Settings.</p>
    </div>
  );
}
