import { Suspense, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { DeepseekUsagePanel } from '@/modules/deepseek-spend';
import { GeminiUsagePanel } from '@/modules/gemini-spend';
import { JevPanel } from '@/modules/jev';
import { SCREEN_FRAME } from '@/shared/constants';
import { Spinner, Tabs } from '@/shared/ui';
import { cn } from '@/shared/utils';

type ApiSubTab = 'jev' | 'deepseek' | 'gemini';

const STORAGE_KEY = 'apiSubTab';

/** Exactly the three sub-tab ids; anything else a browser holds is not one of them. */
function isApiSubTab(value: string | null): value is ApiSubTab {
  return value === 'jev' || value === 'deepseek' || value === 'gemini';
}

/** The sub-tab the operator last chose, else Jev — the view the tab showed before it had sub-tabs. */
function readSubTab(): ApiSubTab {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return isApiSubTab(stored) ? stored : 'jev';
  } catch {
    return 'jev';
  }
}

/**
 * The API tab: what the house spends on the third-party services it asks — Jev, DeepSeek and Gemini — one
 * sub-tab each, under an underline strip in the git panel's in-panel register.
 *
 * ONLY THE CHOSEN VIEW IS MOUNTED. Each view reads its own doors while it is on screen (Gemini on the page's events, never a clock); a hidden
 * sibling kept alive would keep asking for numbers nobody is looking at. The choice survives a reload
 * through `localStorage`, read through a validator that accepts the three ids and nothing else.
 */
export function ApiPanel() {
  const { t } = useTranslation();
  const [subTab, setSubTab] = useState<ApiSubTab>(readSubTab);
  const tabs = [
    { id: 'jev', label: t('api.subtabs.jev') },
    { id: 'deepseek', label: t('api.subtabs.deepseek') },
    { id: 'gemini', label: t('api.subtabs.gemini') },
  ];
  const onChange = (id: string) => {
    if (!isApiSubTab(id)) return;
    setSubTab(id);
    try {
      localStorage.setItem(STORAGE_KEY, id);
    } catch {
      // localStorage unavailable: the choice lasts the session.
    }
  };

  return (
    <div className="flex h-full flex-col bg-background" data-api-panel>
      {/* The strip's rule runs the window's width; its tabs keep to the page's frame, under the head that does. */}
      <div className="flex-none border-b border-border">
        <div className={cn(SCREEN_FRAME, 'pt-2')}>
          <Tabs tabs={tabs} active={subTab} onChange={onChange} ariaLabel={t('api.subtabsLabel')} variant="underline" />
        </div>
      </div>
      <div className="min-h-0 flex-1" data-api-subtab={subTab}>
        <Suspense
          fallback={
            <div className="flex h-full items-center justify-center">
              <Spinner />
            </div>
          }
        >
          {subTab === 'jev' ? <JevPanel /> : subTab === 'deepseek' ? <DeepseekUsagePanel /> : <GeminiUsagePanel />}
        </Suspense>
      </div>
    </div>
  );
}
