import { useCallback, useEffect, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useTranslation } from "react-i18next";

import { api } from "@/shared/api";
import type { ReleaseInfo,InstallMode } from "@/shared/types";
import { copyTextToClipboard,IS_PLATFORM } from "@/shared/utils";

type VersionUpgradeModalProps = {
    isOpen: boolean;
    onClose: () => void;
    releaseInfo: ReleaseInfo | null;
    currentVersion: string;
    latestVersion: string | null;
    installMode: InstallMode;
};

const RELOAD_COUNTDOWN_START = 120;

/** This module's only public export: rendered by the sidebar module's modal layer to show release notes and run the app upgrade. */
export function VersionUpgradeModal({
    isOpen,
    onClose,
    releaseInfo,
    currentVersion,
    latestVersion,
    installMode
}: VersionUpgradeModalProps) {
    const { t } = useTranslation('common');
    const upgradeCommand = installMode === 'npm'
        ? t('versionUpdate.npmUpgradeCommand')
        : IS_PLATFORM
            ? 'npm run update:platform'
            : 'git pull && npm install';
    const [isUpdating, setIsUpdating] = useState(false);
    const [updateOutput, setUpdateOutput] = useState('');
    const [updateError, setUpdateError] = useState('');
    const [reloadCountdown, setReloadCountdown] = useState<number | null>(null);

    useEffect(() => {
        if (!IS_PLATFORM || reloadCountdown === null) {
            return;
        }

        if (reloadCountdown <= 0) {
            // Force a hard reload (bypass cache) so stale assets from the
            // previous version aren't served after the environment updates.
            const url = new URL(window.location.href);
            url.searchParams.set('_hardReload', Date.now().toString());
            window.location.replace(url.toString());
            return;
        }

        const timeoutId = window.setTimeout(() => {
            setReloadCountdown((previousCountdown) => {
                if (previousCountdown === null) {
                    return null;
                }

                return Math.max(previousCountdown - 1, 0);
            });
        }, 1000);

        return () => window.clearTimeout(timeoutId);
    }, [reloadCountdown]);

    const handleUpdateNow = useCallback(async () => {
        setIsUpdating(true);
        setUpdateOutput('Starting update...\n');
        setReloadCountdown(IS_PLATFORM ? RELOAD_COUNTDOWN_START : null);
        setUpdateError('');

        try {
            // Call the backend API to run the update command
            const response = await api.system.update();

            // The server (or a proxy in front of it) can answer with an HTML
            // page instead of JSON — e.g. while a hosted/Docker deployment
            // restarts mid-update — so never parse the body blindly.
            const rawBody = await response.text();
            let data: { output?: string; error?: string } | null = null;
            try {
                data = JSON.parse(rawBody);
            } catch {
                data = null;
            }

            if (!data) {
                if (IS_PLATFORM) {
                    // On platform the update restarts the server, which often
                    // cuts the response short. Treat it as in progress and let
                    // the reload countdown pick up the new version.
                    setUpdateOutput(prev => prev + '\nUpdate started. The server appears to be restarting to apply it.\n');
                } else {
                    setReloadCountdown(null);
                    const message = `The update endpoint returned an unexpected response (HTTP ${response.status}). Update manually with the command below.`;
                    setUpdateError(message);
                    setUpdateOutput(prev => prev + '\n❌ Update failed: ' + message + '\n');
                }
                return;
            }

            if (response.ok) {
                setUpdateOutput(prev => prev + (data.output || '') + '\n');
                setUpdateOutput(prev => prev + '\n✅ Update completed successfully!\n');
                if (!IS_PLATFORM) {
                    setUpdateOutput(prev => prev + 'Please restart the server to apply changes.' + '\n');
                }
            } else {
                setReloadCountdown(null);
                setUpdateError(data.error || 'Update failed');
                setUpdateOutput(prev => prev + '\n❌ Update failed: ' + (data.error || 'Unknown error') + '\n');
            }
        } catch (error: any) {
            if (IS_PLATFORM) {
                // Connection dropped mid-request — expected when the platform
                // update restarts the server. Keep the countdown running.
                setUpdateOutput(prev => prev + '\nConnection to the server was interrupted — it is likely restarting to apply the update.\n');
            } else {
                setReloadCountdown(null);
                setUpdateError(error.message);
                setUpdateOutput(prev => prev + '\n❌ Update failed: ' + error.message + '\n');
            }
        } finally {
            setIsUpdating(false);
        }
    }, []);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
            {/* Backdrop */}
            <button
                className="fixed inset-0 bg-black/50 backdrop-blur-sm"
                onClick={onClose}
                aria-label={t('versionUpdate.ariaLabels.closeModal')}
            />

            {/* Modal */}
            <div className="relative mx-4 max-h-[90vh] w-full max-w-2xl space-y-4 overflow-y-auto rounded-lg border border-border bg-card p-6 shadow-xl">
                {/* Header */}
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--info-soft)]">
                            <svg className="h-5 w-5 text-[var(--info-ink)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3 3m0 0l3-3m-3 3V10" />
                            </svg>
                        </div>
                        <div>
                            <h2 className="text-lg font-semibold text-foreground">{t('versionUpdate.title')}</h2>
                            <p className="text-sm text-muted-foreground">
                                {releaseInfo?.title || t('versionUpdate.newVersionReady')}
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                        <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                {/* Version Info */}
                <div className="space-y-3">
                    <div className="flex items-center justify-between rounded-lg bg-muted p-3">
                        <span className="text-sm font-medium text-foreground">{t('versionUpdate.currentVersion')}</span>
                        <span className="font-mono text-sm text-foreground">{currentVersion}</span>
                    </div>
                    <div className="flex items-center justify-between rounded-lg border border-border bg-[var(--info-soft)] p-3">
                        <span className="text-sm font-medium text-[var(--info-ink)]">{t('versionUpdate.latestVersion')}</span>
                        <span className="font-mono text-sm text-[var(--info-ink)]">{latestVersion}</span>
                    </div>
                </div>

                {/* Changelog */}
                {releaseInfo?.body && (
                    <div className="space-y-3">
                        <div className="flex items-center justify-between">
                            <h3 className="text-sm font-medium text-foreground">{t('versionUpdate.whatsNew')}</h3>
                            {releaseInfo?.htmlUrl && (
                                <a
                                    href={releaseInfo.htmlUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="flex items-center gap-1 text-xs text-[var(--info-ink)] hover:text-[var(--info-ink)] hover:underline"
                                >
                                    {t('versionUpdate.viewFullRelease')}
                                    <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                                    </svg>
                                </a>
                            )}
                        </div>
                        <div className="max-h-64 overflow-y-auto rounded-lg border border-border bg-muted p-4">
                            <div className="prose prose-sm max-w-none text-sm text-foreground dark:prose-invert">
                                <ReactMarkdown remarkPlugins={[remarkGfm]} components={changelogComponents}>
                                    {cleanChangelog(releaseInfo.body)}
                                </ReactMarkdown>
                            </div>
                        </div>
                    </div>
                )}

                {/* Update Output */}
                {(updateOutput || updateError) && (
                    <div className="space-y-2">
                        <h3 className="text-sm font-medium text-foreground">{t('versionUpdate.updateProgress')}</h3>
                        <div className="max-h-48 overflow-y-auto rounded-lg border border-border bg-muted p-4">
                            <pre className="whitespace-pre-wrap font-mono text-xs text-[var(--pos-ink)]">{updateOutput}</pre>
                        </div>
                        {IS_PLATFORM && reloadCountdown !== null && (
                            <div className="rounded-md border border-border bg-[var(--info-soft)] px-3 py-2 text-xs text-[var(--info-ink)]">
                                {reloadCountdown === 0
                                    ? 'Refreshing the window now...'
                                    : `This environment will be updated after this time. You can close the window and return in ${Math.ceil(reloadCountdown / 60)} minutes. If the update doesn't apply, RESTART the environment.`}
                            </div>
                        )}
                        {updateError && (
                            <div className="rounded-md border border-border bg-[var(--danger-soft)] px-3 py-2 text-xs text-[var(--danger-ink)]">
                                {updateError}
                            </div>
                        )}
                    </div>
                )}

                {/* Upgrade Instructions */}
                {!isUpdating && !updateOutput && (
                    <div className="space-y-3">
                        <h3 className="text-sm font-medium text-foreground">{t('versionUpdate.manualUpgrade')}</h3>
                        <div className="rounded-lg border bg-muted p-3">
                            <code className="font-mono text-sm text-foreground">
                                {upgradeCommand}
                            </code>
                        </div>
                        <p className="text-xs text-muted-foreground">
                            {t('versionUpdate.manualUpgradeHint')}
                        </p>
                    </div>
                )}

                {/* Actions */}
                <div className="flex gap-2 pt-2">
                    <button
                        onClick={onClose}
                        className="flex-1 rounded-md bg-muted px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted"
                    >
                        {updateOutput ? t('versionUpdate.buttons.close') : t('versionUpdate.buttons.later')}
                    </button>
                    {!updateOutput && (
                        <>
                            <button
                                onClick={() => copyTextToClipboard(upgradeCommand)}
                                className="flex-1 rounded-md bg-muted px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted"
                            >
                                {t('versionUpdate.buttons.copyCommand')}
                            </button>
                            <button
                                onClick={handleUpdateNow}
                                disabled={isUpdating}
                                className="flex flex-1 items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:bg-primary/50"
                            >
                                {isUpdating ? (
                                    <>
                                        <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                                        {t('versionUpdate.buttons.updating')}
                                    </>
                                ) : (
                                    t('versionUpdate.buttons.updateNow')
                                )}
                            </button>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
};

const changelogComponents = {
    a: ({ href, children }: { href?: string; children?: ReactNode }) => (
        <a href={href} target="_blank" rel="noopener noreferrer" className="text-[var(--info-ink)] hover:underline">
            {children}
        </a>
    ),
};

// Clean up changelog by removing GitHub-specific metadata
const cleanChangelog = (body: string) => {
    if (!body) return '';

    return body
        // Remove full commit hashes (40 character hex strings)
        .replace(/\b[0-9a-f]{40}\b/gi, '')
        // Remove short commit hashes (7-10 character hex strings at start of line or after dash/space)
        .replace(/(?:^|\s|-)([0-9a-f]{7,10})\b/gi, '')
        // Remove "Full Changelog" links
        .replace(/\*\*Full Changelog\*\*:.*$/gim, '')
        // Remove compare links (e.g., https://github.com/.../compare/v1.0.0...v1.0.1)
        .replace(/https?:\/\/github\.com\/[^\/]+\/[^\/]+\/compare\/[^\s)]+/gi, '')
        // Clean up multiple consecutive empty lines
        .replace(/\n\s*\n\s*\n/g, '\n\n')
        // Trim whitespace
        .trim();
};
