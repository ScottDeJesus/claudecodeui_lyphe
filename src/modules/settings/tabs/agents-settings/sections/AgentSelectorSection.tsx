import { LLMProviderLogo, PillBar, Pill } from '@/shared/ui';
import type { AgentContextByProvider, AgentProvider } from '@/shared/types';

type AgentSelectorSectionProps = {
  agents: AgentProvider[];
  selectedAgent: AgentProvider;
  onSelectAgent: (agent: AgentProvider) => void;
  agentContextById: AgentContextByProvider;
};

const AGENT_NAMES: Record<AgentProvider, string> = {
  claude: 'Claude',
  cursor: 'Cursor',
  codex: 'Codex',
  opencode: 'OpenCode',
};

/** Rendered by AgentsSettingsTab to pick which agent provider the tab is configuring. */
export default function AgentSelectorSection({
  agents,
  selectedAgent,
  onSelectAgent,
  agentContextById,
}: AgentSelectorSectionProps) {
  return (
    // The strip scrolls sideways when the pane is too narrow for the four providers' names, the way
    // the Settings tab bar does on a phone; the pills keep their words instead of shrinking to
    // "C  C…  C•  O…" beside each other. From 768px the pane is the window less the 192px rail, so
    // a window a little over 768px, or larger text, is narrower than the strip too; the tab's own
    // `overflow-hidden` would have cut the last provider off.
    <div className="scrollbar-hide flex-shrink-0 overflow-x-auto border-b border-border px-3 py-2 md:px-4 md:py-3">
      <PillBar className="w-max min-w-full md:min-w-0">
        {agents.map((agent) => (
          <Pill
            key={agent}
            isActive={selectedAgent === agent}
            onClick={() => onSelectAgent(agent)}
            className="flex-1 justify-center md:flex-initial"
          >
            <LLMProviderLogo provider={agent} className="h-4 w-4 flex-shrink-0" />
            <span>{AGENT_NAMES[agent]}</span>
            {/* Signed in: the theme's own positive mark, the same for every provider. */}
            {agentContextById[agent].authStatus.authenticated && (
              <span data-tone="positive" className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-tone-dot" />
            )}
          </Pill>
        ))}
      </PillBar>
    </div>
  );
}
