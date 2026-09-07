import type { AgentCategory, AgentContextByProvider, AgentProvider, AgentSettingsProject, ClaudePermissionsState, CodexPermissionMode, CursorPermissionsState, McpProject, PermissionMode, SkillsProject } from '@/shared/types';
import { McpServers } from '@/modules/mcp';
import { ProviderSkills } from '@/modules/skills';
import AccountContent from '@/modules/settings/tabs/agents-settings/sections/content/AccountContent';
import EditModeContent from '@/modules/settings/tabs/agents-settings/sections/content/EditModeContent';
import PermissionsContent from '@/modules/settings/tabs/agents-settings/sections/content/PermissionsContent';

/** The three modes Codex accepts, narrowed back out of the shared mode union before it is stored. */
const toCodexPermissionMode = (mode: PermissionMode): CodexPermissionMode => (
  mode === 'acceptEdits' || mode === 'bypassPermissions' ? mode : 'default'
);

type AgentCategoryContentSectionProps = {
  selectedAgent: AgentProvider;
  selectedCategory: AgentCategory;
  agentContextById: AgentContextByProvider;
  claudePermissions: ClaudePermissionsState;
  onClaudePermissionsChange: (value: ClaudePermissionsState) => void;
  cursorPermissions: CursorPermissionsState;
  onCursorPermissionsChange: (value: CursorPermissionsState) => void;
  codexPermissionMode: CodexPermissionMode;
  onCodexPermissionModeChange: (value: CodexPermissionMode) => void;
  projects: AgentSettingsProject[];
};

/** Rendered by AgentsSettingsTab to show the panel for the selected provider and category. */
export default function AgentCategoryContentSection({
  selectedAgent,
  selectedCategory,
  agentContextById,
  claudePermissions,
  onClaudePermissionsChange,
  cursorPermissions,
  onCursorPermissionsChange,
  codexPermissionMode,
  onCodexPermissionModeChange,
  projects,
}: AgentCategoryContentSectionProps) {
  return (
    <div className="min-w-0 flex-1 overflow-y-auto overflow-x-hidden p-3 md:p-4">
      {selectedCategory === 'account' && (
        <AccountContent
          agent={selectedAgent}
          authStatus={agentContextById[selectedAgent].authStatus}
          onLogin={agentContextById[selectedAgent].onLogin}
        />
      )}

      {/* Above the allow/deny lists on purpose: this one setting decides whether
          those lists are ever consulted. */}
      {selectedCategory === 'permissions' && selectedAgent === 'claude' && (
        <div className="mb-6 max-w-md">
          <EditModeContent
            agent="claude"
            value={claudePermissions.permissionMode}
            onChange={(mode) => onClaudePermissionsChange({ ...claudePermissions, permissionMode: mode })}
          />
        </div>
      )}

      {selectedCategory === 'permissions' && selectedAgent === 'cursor' && (
        <div className="mb-6 max-w-md">
          <EditModeContent
            agent="cursor"
            value={cursorPermissions.permissionMode}
            onChange={(mode) => onCursorPermissionsChange({ ...cursorPermissions, permissionMode: mode })}
          />
        </div>
      )}

      {selectedCategory === 'permissions' && selectedAgent === 'codex' && (
        <div className="max-w-md">
          <EditModeContent
            agent="codex"
            value={codexPermissionMode}
            onChange={(mode) => onCodexPermissionModeChange(toCodexPermissionMode(mode))}
          />
        </div>
      )}

      {selectedCategory === 'permissions' && selectedAgent === 'claude' && (
        <PermissionsContent
          agent="claude"
          skipPermissions={claudePermissions.skipPermissions}
          onSkipPermissionsChange={(value) => {
            onClaudePermissionsChange({ ...claudePermissions, skipPermissions: value });
          }}
          allowedTools={claudePermissions.allowedTools}
          onAllowedToolsChange={(value) => {
            onClaudePermissionsChange({ ...claudePermissions, allowedTools: value });
          }}
          disallowedTools={claudePermissions.disallowedTools}
          onDisallowedToolsChange={(value) => {
            onClaudePermissionsChange({ ...claudePermissions, disallowedTools: value });
          }}
        />
      )}

      {selectedCategory === 'permissions' && selectedAgent === 'cursor' && (
        <PermissionsContent
          agent="cursor"
          skipPermissions={cursorPermissions.skipPermissions}
          onSkipPermissionsChange={(value) => {
            onCursorPermissionsChange({ ...cursorPermissions, skipPermissions: value });
          }}
          allowedCommands={cursorPermissions.allowedCommands}
          onAllowedCommandsChange={(value) => {
            onCursorPermissionsChange({ ...cursorPermissions, allowedCommands: value });
          }}
          disallowedCommands={cursorPermissions.disallowedCommands}
          onDisallowedCommandsChange={(value) => {
            onCursorPermissionsChange({ ...cursorPermissions, disallowedCommands: value });
          }}
        />
      )}

      {selectedCategory === 'mcp' && (
        // AgentSettingsProject.name is populated from the DB projectId by
        // normalizeProjectForSettings, so we can map it straight through.
        <McpServers
          selectedProvider={selectedAgent}
          currentProjects={projects.map<McpProject>((project) => ({
            projectId: project.name,
            displayName: project.displayName,
            fullPath: project.fullPath,
            path: project.path,
          }))}
        />
      )}

      {selectedCategory === 'skills' && selectedAgent !== 'opencode' && (
        <ProviderSkills
          selectedProvider={selectedAgent}
          currentProjects={projects.map<SkillsProject>((project) => ({
            projectId: project.name,
            displayName: project.displayName,
            fullPath: project.fullPath,
            path: project.path,
          }))}
        />
      )}
    </div>
  );
}
