import type { TFunction } from 'i18next';

import type { Project, Tone } from '@/shared/types';

/** What the header says about the connection, and the tone it says it in. */
export type ShellConnectionState = { tone: Tone; label: string };

/**
 * The connection, in one word and one tone.
 *
 * Restarting and starting up are both `info` because both are the same thing to a reader —
 * something is happening, wait — and neither is a state to celebrate or worry about.
 */
export function readShellConnection(
  state: { isRestarting: boolean; isInitialized: boolean; isConnected: boolean },
  t: TFunction<'chat'>,
): ShellConnectionState {
  if (state.isRestarting) return { tone: 'info', label: t('shell.status.restarting') };
  if (!state.isInitialized) return { tone: 'info', label: t('shell.status.starting') };
  if (state.isConnected) return { tone: 'positive', label: t('shell.status.connected') };
  return { tone: 'neutral', label: t('shell.status.notConnected') };
}

/**
 * The header's meta line: only facts the app actually holds, joined by a middle dot.
 *
 * What is deliberately NOT here is the shell binary's name. The prototype's line reads
 * "zsh · ~/code/… · started 4m ago", but nothing in the shell socket protocol ever tells the
 * client which shell the server spawned, so naming one would be inventing it. The start time
 * appears only once there is a live session to have started, for the same reason.
 *
 * An empty string means the app holds nothing worth stating, and the header draws no line.
 */
export function readShellMeta(
  facts: {
    project: Project;
    isPlainShell: boolean;
    initialCommand: string | null;
    sessionName: string | null;
    connectedAt: Date | null;
  },
  t: TFunction<'chat'>,
): string {
  const startedAt = facts.connectedAt?.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

  return [
    facts.isPlainShell ? facts.initialCommand : facts.sessionName,
    facts.project.fullPath || facts.project.path,
    startedAt ? t('shell.meta.started', { time: startedAt }) : null,
  ]
    .filter(Boolean)
    .join(' · ');
}
