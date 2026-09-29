import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronUp } from 'lucide-react';

import type { PendingPermissionRequest, Question } from '@/shared/types';
import { Badge, Banner, Button } from '@/shared/ui';
import { AskUserQuestionPanel } from '@/modules/chat/tools/InteractiveRenderers/AskUserQuestionPanel';
import { buildClaudeToolPermissionEntry, formatToolInputForDisplay } from '@/modules/chat/utils/chatPermissions';
import { getClaudeSettings } from '@/shared/userSettings';

type PermissionRequestsBannerProps = {
  pendingPermissionRequests: PendingPermissionRequest[];
  handlePermissionDecision: (
    requestIds: string | string[],
    decision: { allow?: boolean; message?: string; rememberEntry?: string | null; updatedInput?: unknown },
  ) => void;
  handleGrantToolPermission: (suggestion: { entry: string; toolName: string }) => { success: boolean };
};

/**
 * One standalone ask — a plan's prompt the app raised in this chat — as its answer panel, or folded to
 * a one-line bar that answers nothing: the plan still owes, the prompt stays pending, and one tap
 * opens it again. An unanswered prompt never holds the composer. The panel stays MOUNTED while folded,
 * so what was chosen or typed survives a fold and a re-open.
 */
function StandaloneQuestion({ request, onDecision }: {
  request: PendingPermissionRequest;
  onDecision: PermissionRequestsBannerProps['handlePermissionDecision'];
}) {
  const { t } = useTranslation('chat');
  const [collapsed, setCollapsed] = useState(false);
  const first = (request.input as { questions?: Question[] } | undefined)?.questions?.[0];
  return (
    <>
      {collapsed && (
        <button
          type="button"
          data-question-card="collapsed"
          onClick={() => setCollapsed(false)}
          className="flex w-full min-w-0 items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-left"
        >
          <span aria-hidden className="vv-pulse h-2 w-2 flex-shrink-0 rounded-full bg-warn-ink" />
          <span className="hidden flex-shrink-0 text-xs font-medium uppercase tracking-[0.14em] text-ink-faint sm:inline">
            {t('question.planNeedsInput', { defaultValue: 'A plan needs your word' })}
          </span>
          {first?.header && (
            <Badge as="span" tone="neutral" className="vv-badge--compact flex-shrink-0 uppercase tracking-wider">
              {first.header}
            </Badge>
          )}
          <span className="min-w-0 flex-1 truncate text-sm text-foreground">{first?.question.split('\n')[0]}</span>
          <span className="flex flex-shrink-0 items-center gap-1 text-xs font-medium text-accent-ink">
            {t('question.expand', { defaultValue: 'Open' })}
            <ChevronUp aria-hidden className="h-3.5 w-3.5" />
          </span>
        </button>
      )}
      <div className={collapsed ? 'hidden' : undefined}>
        <AskUserQuestionPanel request={request} onDecision={onDecision} onCollapse={() => setCollapsed(true)} />
      </div>
    </>
  );
}

/**
 * Rendered by chat's ChatComposer above the input to surface pending tool
 * permission requests and their allow / allow-and-remember / decline actions —
 * and every STANDALONE ask, a plan's prompt the app raised in this chat, in the
 * same question panel an inline AskUserQuestion uses: no transcript row carries
 * one, so this is the one place it can be answered.
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

  // Plan and question prompts a run raised are answered inline in the transcript — PlanDisplay and
  // QuestionAnswerContent — so they are not offered a second time here.
  const filteredRequests = pendingPermissionRequests.filter(
    (r) => !r.standalone && r.toolName !== 'ExitPlanMode' && r.toolName !== 'exit_plan_mode' && r.toolName !== 'AskUserQuestion'
  );
  const standaloneQuestions = pendingPermissionRequests.filter((r) => r.standalone && r.toolName === 'AskUserQuestion');

  if (!filteredRequests.length && !standaloneQuestions.length) {
    return null;
  }

  return (
    <div className="mx-auto mb-3 max-w-[54.25rem] space-y-2">
      {standaloneQuestions.map((request) => (
        // Keyed by the ask's own name: a re-offer of the same prompt keeps what was chosen so far, and
        // whether it was folded.
        <StandaloneQuestion key={request.promptKey ?? request.requestId} request={request} onDecision={handlePermissionDecision} />
      ))}
      {filteredRequests.map((request) => {

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
