import { useContext } from 'react';

import { createStableContext } from '@/shared/context/stableContext';
import type { PendingPermissionRequest } from '@/shared/types';

export type PermissionContextValue = {
  /** The conversation on screen — what a row's answer memory is scoped to (QuestionAnswerContent). */
  sessionId: string | null;
  pendingPermissionRequests: PendingPermissionRequest[];
  handlePermissionDecision: (
    requestIds: string | string[],
    decision: { allow?: boolean; message?: string; rememberEntry?: string | null; updatedInput?: unknown },
  ) => void;
};

const PermissionContext = createStableContext<PermissionContextValue | null>(import.meta.hot, 'PermissionContext', null);

export function usePermission(): PermissionContextValue | null {
  return useContext(PermissionContext);
}

export default PermissionContext;
