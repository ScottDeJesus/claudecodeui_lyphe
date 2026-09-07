/**
 * The git panel's delegation hook.
 *
 * A package rather than a file because the run has two halves that are read separately: what
 * the agent's own frames prove (`runEvidence`) and what git says afterwards (`useGitDelegation`).
 * Only the hook leaves this directory.
 */
export { useGitDelegation } from '@/modules/git-panel/hooks/git-delegation/useGitDelegation';
