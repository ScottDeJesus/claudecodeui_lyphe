import { useCallback } from 'react';

import type { LLMProvider, ProviderModelsDefinition } from '@/shared/types';
import { resolveModelLabel } from '@/modules/chat/utils/modelLabels';

/**
 * The one question the transcript asks of the model catalog: what does a person call this model id?
 *
 * Answers `null` for an id nothing names — the catalog does not carry it and it is not one DeepSeek
 * answers with, which the resolver names off the id itself — so a caller decides its own fallback (a
 * message header names the provider; an agent row names nothing) rather than printing an identifier.
 * Its identity changes only when the provider or the catalog does, so it is safe in a dependency list.
 *
 * Used by ChatMessagesPane (message headers, agent rows in the transcript, exports) and by
 * ChatInterface (the pinned agents strip and the gutter widget's copy of those rows).
 */
export function useModelLabelResolver(
  provider: LLMProvider,
  providerModelCatalog: Partial<Record<LLMProvider, ProviderModelsDefinition>>,
): (modelId: string) => string | null {
  return useCallback(
    (modelId: string): string | null => resolveModelLabel(
      providerModelCatalog[provider]?.OPTIONS ?? [],
      modelId,
      providerModelCatalog[provider]?.LABELS_BY_MODEL_ID,
    ),
    [provider, providerModelCatalog],
  );
}
