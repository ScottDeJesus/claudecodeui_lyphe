import React from 'react';
import { useTranslation } from 'react-i18next';

import type { PendingPermissionRequest } from '@/shared/types';
import { Banner, Button } from '@/shared/ui';
import { buildClaudeToolPermissionEntry, formatToolInputForDisplay } from '@/modules/chat/utils/chatPermissions';
import { getClaudeSettings } from '@/modules/chat/utils/chatStorage';
import { getPermissionPanel, registerPermissionPanel } from '@/modules/chat/tools/configs/permissionPanelRegistry';
import { AskUserQuestionPanel } from '@/modules/chat/tools/InteractiveRenderers/AskUserQuestionPanel';

registerPermissionPanel('AskUserQuestion', AskUserQuestionPanel);

type PermissionRequestsBannerProps = {
  pendingPermissionRequests: PendingPermissionRequest[];
  handlePermissionDecision: (
    requestIds: string | string[],
    decision: { allow?: boolean; message?: string; rememberEntry?: string | null; updatedInput?: unknown },
  ) => void;
  handleGrantToolPermission: (suggestion: { entry: string; toolName: string }) => { success: boolean };
};

/**
 * Rendered by chat's ChatComposer above the input to surface pending tool
 * permission requests and their allow / allow-and-remember / decline actions.
 *
 * All three actions are the contract, not a menu of niceties: the run is
 * blocked on `handlePermissionDecision` and every one of them answers it.
 * The middle one additionally writes an allow rule — the only one of the three
 * that changes anything beyond this single request.
 */
export default function PermissionRequestsBanner({
  pendingPermissionRequests,
  handlePermissionDecision,
  handleGrantToolPermission,
}: PermissionRequestsBannerProps) {
  const { t } = useTranslation('chat');

  // Filter out plan tool requests — they are handled inline by PlanDisplay
  const filteredRequests = pendingPermissionRequests.filter(
    (r) => r.toolName !== 'ExitPlanMode' && r.toolName !== 'exit_plan_mode'
  );

  if (!filteredRequests.length) {
    return null;
  }

  return (
    <div className="mb-3 space-y-2">
      {filteredRequests.map((request) => {
        const CustomPanel = getPermissionPanel(request.toolName);
        if (CustomPanel) {
          return (
            <CustomPanel
              key={request.requestId}
              request={request}
              onDecision={handlePermissionDecision}
            />
          );
        }

        const rawInput = formatToolInputForDisplay(request.input);
        const permissionEntry = buildClaudeToolPermissionEntry(request.toolName, rawInput);
        const settings = getClaudeSettings();
        const alreadyAllowed = permissionEntry ? settings.allowedTools.includes(permissionEntry) : false;
        const matchingRequestIds = permissionEntry
          ? pendingPermissionRequests
              .filter(
                (item) =>
                  buildClaudeToolPermissionEntry(item.toolName, formatToolInputForDisplay(item.input)) === permissionEntry,
              )
              .map((item) => item.requestId)
          : [request.requestId];

        return (
          // `warn`, not `danger`: nothing has gone wrong and nothing has run.
          // The banner's own ▲ mark comes from the tone, so the state reads
          // without the colour.
          <Banner key={request.requestId} tone="warn">
            <div className="flex flex-col gap-2.5">
              <div>
                <span className="font-medium">
                  {t('permissions.waitingTitle', { defaultValue: 'Waiting for you' })}
                </span>
                <span className="ml-2 opacity-80">
                  {t('permissions.toolLabel', { defaultValue: 'Tool' })}:{' '}
                  <code className="rounded bg-background/40 px-1.5 py-0.5 text-xs">{request.toolName}</code>
                </span>
              </div>

              {permissionEntry && (
                <div className="text-xs opacity-80">
                  {t('permissions.ruleLabel', { defaultValue: 'Allow rule' })}:{' '}
                  <code className="rounded bg-background/40 px-1 py-0.5 text-xs">{permissionEntry}</code>
                </div>
              )}

              {rawInput && (
                <details>
                  <summary className="cursor-pointer text-xs opacity-80 hover:opacity-100">
                    {t('permissions.viewInput', { defaultValue: 'View tool input' })}
                  </summary>
                  <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-md bg-background/40 p-2 text-xs">
                    {rawInput}
                  </pre>
                </details>
              )}

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  onClick={() => handlePermissionDecision(request.requestId, { allow: true })}
                >
                  {t('permissions.allowOnce', { defaultValue: 'Allow this time' })}
                </Button>
                <Button
                  type="button"
                  variant="tonal"
                  size="sm"
                  disabled={!permissionEntry}
                  onClick={() => {
                    if (permissionEntry && !alreadyAllowed) {
                      handleGrantToolPermission({ entry: permissionEntry, toolName: request.toolName });
                    }
                    handlePermissionDecision(matchingRequestIds, { allow: true, rememberEntry: permissionEntry });
                  }}
                >
                  {alreadyAllowed
                    ? t('permissions.allowAlreadyRemembered', { defaultValue: 'Allow, already remembered' })
                    : t('permissions.allowAndRemember', { defaultValue: 'Allow and remember' })}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => handlePermissionDecision(request.requestId, { allow: false, message: 'User denied tool use' })}
                >
                  {t('permissions.leaveAsIs', { defaultValue: 'Leave it as it is' })}
                </Button>
              </div>
            </div>
          </Banner>
        );
      })}
    </div>
  );
}
