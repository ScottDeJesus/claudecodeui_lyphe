import type { ClaudeUpdateJobState, ClaudeUpdateStepKey } from '@/shared/claude-update-types';

/**
 * How a job's four steps and eight states are worded — in ONE place, because two screens draw them.
 *
 * The job panel names every step; the sidebar row names the running one under "Updating Claude…".
 * Two copies of "Claude Agent SDK" are two chances for the row and the panel to disagree about what
 * is being installed while it installs, so the words live here and both read them.
 *
 * Each is a key and its English default, ready for `t(key, { defaultValue })`: the settings
 * namespace carries no `updates.*` entries, and this module adds none — the tab ships its own
 * English, translated later if the app is ever.
 */

/** What one step is called while it runs and once it has. */
export const UPDATE_STEP_LABELS: Record<ClaudeUpdateStepKey, { key: string; defaultValue: string }> = {
  cli: { key: 'updates.steps.cli', defaultValue: 'Claude Code' },
  sdk: { key: 'updates.steps.sdk', defaultValue: 'Claude Agent SDK' },
  restart: { key: 'updates.steps.restart', defaultValue: 'Restart server' },
  commit: { key: 'updates.steps.commit', defaultValue: 'Commit package files' },
};

/** One sentence per job state — what has happened, and what happens next. */
export const JOB_STATE_SENTENCES: Record<ClaudeUpdateJobState, { key: string; defaultValue: string }> = {
  installing: {
    key: 'updates.job.installing',
    defaultValue: 'Installing the new packages — this can take a minute.',
  },
  installed: {
    key: 'updates.job.installed',
    defaultValue: 'The packages are on disk; the server restart is next.',
  },
  restarting: {
    key: 'updates.job.restarting',
    defaultValue: 'The server is handing itself over so the new Agent SDK loads.',
  },
  'rolling-back': {
    key: 'updates.job.rollingBack',
    defaultValue: 'The new Agent SDK did not load; the runner is putting the old one back.',
  },
  done: { key: 'updates.job.done', defaultValue: 'Done — both packages are on the new versions.' },
  failed: {
    key: 'updates.job.failed',
    defaultValue: 'The update stopped. The log below has the last thing it said.',
  },
  'rolled-back': {
    key: 'updates.job.rolledBack',
    defaultValue: 'Rolled back — the versions from before are on disk again.',
  },
  interrupted: {
    key: 'updates.job.interrupted',
    defaultValue:
      'The runner stopped before it finished. Nothing is half-written: the cards show what is on disk now.',
  },
};
