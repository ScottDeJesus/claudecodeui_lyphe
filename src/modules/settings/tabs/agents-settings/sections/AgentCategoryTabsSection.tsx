import { useTranslation } from 'react-i18next';

import type { AgentCategory, AgentProvider } from '@/shared/types';
import { Tabs } from '@/shared/ui';

type AgentCategoryTabsSectionProps = {
  categories: AgentCategory[];
  selectedAgent: AgentProvider;
  selectedCategory: AgentCategory;
  onSelectCategory: (category: AgentCategory) => void;
};

/** Rendered by AgentsSettingsTab to switch between the selected provider's categories: the kit's own tab strip, in its flat register. */
export default function AgentCategoryTabsSection({
  categories,
  selectedAgent,
  selectedCategory,
  onSelectCategory,
}: AgentCategoryTabsSectionProps) {
  const { t } = useTranslation('settings');

  const label = (category: AgentCategory) => (
    category === 'account' ? t('tabs.account')
      : category === 'permissions' ? t('tabs.permissions')
        : category === 'mcp' ? t('tabs.mcpServers')
          : t('tabs.skills', { defaultValue: selectedAgent === 'opencode' ? 'Shared Skills' : 'Skills' })
  );

  return (
    <div className="flex-shrink-0 overflow-x-auto border-b border-border px-2 md:px-4">
      <Tabs
        variant="underline"
        ariaLabel={t('tabs.label', { defaultValue: 'Agent settings' })}
        tabs={categories.map((category) => ({ id: category, label: label(category) }))}
        active={selectedCategory}
        onChange={(id) => onSelectCategory(id as AgentCategory)}
      />
    </div>
  );
}
