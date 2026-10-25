import { Suspense } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

import { StandaloneShell } from '@/modules/standalone-shell';
import { IS_PLATFORM } from '@/shared/utils';
import type { LLMProvider } from '@/shared/types';

/**
 * For empty shell instances where no project is provided,
 * we use a default project object to ensure the shell can still function.
 * This prevents errors related to missing project data.
 *
 * `projectId` is set to a well-known sentinel ('default') because the empty
 * shell doesn't correspond to any real project row in the database; any API
 * call that routes through this placeholder must tolerate a missing match.
 */
const DEFAULT_PROJECT_FOR_EMPTY_SHELL = {
  projectId: 'default',
  displayName: 'default',
  fullPath: IS_PLATFORM ? '/workspace' : '',
  path: IS_PLATFORM ? '/workspace' : '',
};

type ProviderLoginModalProps = {
  isOpen: boolean;
  onClose: () => void;
  provider?: LLMProvider;
  customCommand?: string;
  isAuthenticated?: boolean;
  /** Overrides the title derived from the provider, for a caller running something other than that provider's own login. Absent everywhere else, which is what keeps those titles byte-for-byte what they were. */
  title?: string;
};

const getProviderCommand = ({
  provider,
  customCommand,
  isAuthenticated: _isAuthenticated,
}: {
  provider: LLMProvider;
  customCommand?: string;
  isAuthenticated: boolean;
}) => {
  if (customCommand) {
    return customCommand;
  }

  if (provider === 'claude') {
    return 'claude --dangerously-skip-permissions /login';
  }

  if (provider === 'cursor') {
    return 'cursor-agent login';
  }

  if (provider === 'codex') {
    // Device code, always: plain `codex login` redirects to a callback on the server's
    // own localhost, which a browser on any other device can never reach.
    return 'codex login --device-auth';
  }

  if (provider === 'opencode') {
    return 'opencode auth login';
  }

  return 'claude --dangerously-skip-permissions /login';
};

const getProviderTitle = (provider: LLMProvider) => {
  if (provider === 'claude') return 'Claude CLI Login';
  if (provider === 'cursor') return 'Cursor CLI Login';
  if (provider === 'codex') return 'Codex CLI Login';
  if (provider === 'opencode') return 'OpenCode CLI Login';
  return 'Claude CLI Login';
};

/**
 * Used by the onboarding, accounts and settings modules to run a command in an embedded shell — a provider's CLI login, and, through `customCommand` and `title`, the settings dialog's Claude Design authorization.
 *
 * It reports one thing, `onClose`. The login command's exit is deliberately not reported: `claude /login` signs in and then
 * stays at the CLI's prompt, so its exit code never arrives and anything waiting on it waits forever. Every caller reads the
 * login itself when the window closes.
 */
export default function ProviderLoginModal({
  isOpen,
  onClose,
  provider = 'claude',
  customCommand,
  isAuthenticated = false,
  title: titleOverride,
}: ProviderLoginModalProps) {
  if (!isOpen) {
    return null;
  }

  const command = getProviderCommand({ provider, customCommand, isAuthenticated });
  const title = titleOverride ?? getProviderTitle(provider);

  // Drawn on `document.body`, not where the caller mounts it. `fixed` is laid out against the
  // nearest ancestor with a `backdrop-filter` (or `transform`, `filter`, `contain`…), and the sidebar's
  // root carries `backdrop-blur-sm` — so mounted in place inside the account button, this window filled
  // the side panel instead of the screen. Settings and onboarding mounted it the same way and were
  // only spared by having no such ancestor. The portal is the same cure `SidebarModals` gives the
  // app's other dialogs; React events still bubble to the caller through it, so nothing that listened
  // for them stops hearing.
  //
  // Not the kit's `Dialog`: that one closes on Escape and on a click of its backdrop, and takes the
  // Escape away from whatever is focused. This window's content is a terminal — Escape is a key the CLI
  // uses, and a stray click must not kill a login halfway through. Only the ✕ closes it.
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black bg-opacity-50 max-md:items-stretch max-md:justify-stretch"
    >
      {/* On mobile this panel is the whole screen, so it takes the PWA safe-area inset as padding
          (`pwa-notch-safe`, src/index.css) — its title and close button are the chrome that must
          clear the status bar, and the panel's own background has to reach the screen edge. */}
      <div className="pwa-notch-safe flex h-3/4 w-full max-w-4xl flex-col rounded-lg bg-white shadow-xl dark:bg-gray-800 max-md:m-0 max-md:h-full max-md:max-w-none max-md:rounded-none md:m-4 md:h-3/4 md:max-w-4xl md:rounded-lg">
        <div className="flex items-center justify-between border-b border-gray-200 p-4 dark:border-gray-700">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">{title}</h3>
          <button
            onClick={onClose}
            className="text-gray-400 transition-colors hover:text-gray-600 dark:hover:text-gray-300"
            aria-label="Close login modal"
          >
            <X className="h-6 w-6" />
          </button>
        </div>

        <div className="flex-1 overflow-hidden">
          <Suspense fallback={null}>
            {/* The modal stays open when the command ends, so the operator can read the terminal's last output before closing. */}
            <StandaloneShell project={DEFAULT_PROJECT_FOR_EMPTY_SHELL} command={command} minimal={true} />
          </Suspense>
        </div>
      </div>
    </div>,
    document.body,
  );
}
