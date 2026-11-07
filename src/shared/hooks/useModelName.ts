import { useEffect, useState } from 'react';

import { api } from '@/shared/api';
import { resolveModelLabel } from '@/shared/modelLabels';
import type { ProviderModelsDefinition } from '@/shared/types';

/** The catalog's answer shape (`GET /api/providers/claude/models`), as the chat's own loader reads it. */
type ClaudeModelsAnswer = { success?: boolean; data?: { models?: ProviderModelsDefinition } };

/** The Claude catalog once it has answered: `undefined` before, `null` when it could not be read. One per page, shared by every caller. */
let claudeCatalog: ProviderModelsDefinition | null | undefined;
/** The one request in flight for it, so a page with several callers asks once. */
let claudeCatalogAsk: Promise<ProviderModelsDefinition | null> | null = null;

/** Ask the Claude catalog once per page; a refused or unreadable answer is `null`, which names nothing. */
function askClaudeCatalog(): Promise<ProviderModelsDefinition | null> {
  claudeCatalogAsk ??= api.providers.models('claude')
    .then((response) => response.json() as Promise<ClaudeModelsAnswer>)
    .then((body) => (body.success && body.data?.models ? body.data.models : null))
    .catch(() => null)
    .then((catalog) => {
      claudeCatalog = catalog;
      return catalog;
    });
  return claudeCatalogAsk;
}

/**
 * WHAT A PERSON CALLS A MODEL, for a model word or id recorded outside a chat — a planner outing's `opus` reads `Opus 5.5`, the very
 * name an agent row gives a soul launched on it, because it is the same lookup over the same catalog (`resolveModelLabel` over the Claude
 * catalog's `OPTIONS` and `LABELS_BY_MODEL_ID`). A DeepSeek id is named off the id itself, as the lookup does for every caller.
 *
 * `null` while the catalog has not answered and for an id nothing names, so the caller decides its own fallback (the Planning card shows
 * the store's own word). The catalog is asked ONCE per page, on the first caller's mount, and every later caller reads the answer at once:
 * a planner's model word is a Claude family alias the catalog carries, so the answer does not move within a page.
 *
 * Used by the dispatcher module's `PlanningCard`, one call per line.
 */
export function useModelName(modelId: string | null): string | null {
  // The catalog this caller names with: the page's answer if one is in, else whatever arrives. Essential: the catalog is fetched, and
  // the first caller's render precedes its answer.
  const [catalog, setCatalog] = useState<ProviderModelsDefinition | null | undefined>(claudeCatalog);
  useEffect(() => {
    if (catalog !== undefined) return undefined;
    let live = true;
    void askClaudeCatalog().then((answer) => {
      if (live) setCatalog(answer);
    });
    return () => {
      live = false;
    };
  }, [catalog]);
  if (modelId === null || modelId === '') return null;
  return resolveModelLabel(catalog?.OPTIONS ?? [], modelId, catalog?.LABELS_BY_MODEL_ID);
}
