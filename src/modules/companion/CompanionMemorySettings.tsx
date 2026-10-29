import { ExternalLink } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useCompanionMemorySettings } from '@/modules/companion/hooks/useCompanionMemorySettings';
import { resolveDocSpaceOrigin } from '@/modules/widgets';
import { Banner, Button, ConfirmDialog, SettingRow, SettingsCard, Spinner, buttonVariants } from '@/shared/ui';
import { cn } from '@/shared/utils';

type CompanionMemorySettingsViewProps = {
  /** Her name as he set it: every sentence of the card names her by it. */
  name: string;
  /**
   * Her bank as the card last read it: how many memories it holds, or `count: null` with the door's sentence as `reason`
   * when it could not be read. Null only while the FIRST read is out: a read after a clear keeps this one drawn until its
   * answer replaces it, so the card never falls back to its waiting row.
   */
  reading: { count: number | null; reason: string | null } | null;
  /** Her DocSpace page's address (`page-kaylee-memory`), which Open her memory opens in a new tab. */
  pageHref: string;
  /**
   * A clear is out: true from the confirm until the server has answered and the read after it has landed, refused or not
   * (a clear refused part way has forgotten some), so the question never stands over a count the clear already changed.
   */
  clearing: boolean;
  /** Clears her whole memory. Called from the confirm alone, never from the press that asks. */
  onClear: () => void;
};

/**
 * Settings > Voice > Companion's "Her memory": how many things she keeps of what he told her to keep, where to read them,
 * and how to clear them, which is his act alone (her panel's Clear wipes her conversation and never this). Exported for
 * this file's CompanionMemorySettings and for `.verify/kaylee-memory-card.mjs`, which draws each state in its place:
 * after the talk button's card, directly above her four fields.
 *
 * READ, it is a card in the talk button's shape: "Her memory", the count under it ("Kaylee keeps 3 things you told her
 * to keep." in the ink; "Kaylee keeps nothing yet." in the muted ink), then one line at the card's width: Open her
 * memory, a link to her read-only DocSpace page in a new tab, and Clear her memory while she keeps one thing or more.
 * The count is a polite live region, so what a clear leaves is announced.
 *
 * CLEAR ASKS FIRST, in a ConfirmDialog raised over the Settings modal: what she forgets, that the docstore's history
 * keeps it, and that his conversation with her is untouched. The confirm is destructive and busy while the clear is
 * out, Cancel held with it, and Escape and the backdrop refused. A refused clear leaves the question up, the toast the
 * card's wrapper raises standing above it, for another try or Cancel. A clear that went through leaves nothing to clear:
 * the question goes with Clear, and focus moves to Open her memory instead of falling to the page.
 *
 * Under a finger both controls are 44px tall, Verve's touch floor, as the module's other controls keep it: Clear stands
 * 8px from Open and raises a destructive question.
 *
 * WAITING for the first read, it is the section's own waiting row ("Reading her memory…"). UNREADABLE (the count null),
 * a warn Banner in the card's place carries the door's sentence: no count to show, nothing to clear.
 */
export function CompanionMemorySettingsView({ name, reading, pageHref, clearing, onClear }: CompanionMemorySettingsViewProps) {
  const { t } = useTranslation('settings');
  const openRef = useRef<HTMLAnchorElement>(null);
  // Whether Clear's question is up: the question is the press's first half, so her memory is never emptied by one slip.
  const [confirming, setConfirming] = useState(false);

  const count = reading?.count ?? null;
  const clearable = count !== null && count > 0;
  // Whether she kept something when focus last followed the card: only a change moves focus, so a card that mounts takes none.
  const followedClearable = useRef(clearable);

  // The question asks about something to clear: once there is nothing (the clear went through, or her bank can no longer
  // be read) it is put away, so a count that comes back later never reopens it. Set while rendering, which React re-runs
  // at once, so the question is never drawn over a count of nothing.
  if (confirming && !clearable) setConfirming(false);

  // The clear that emptied her bank takes Clear off the page, and the closing question hands focus back to that button,
  // which is gone: focus goes to Open her memory, the card's one control left. Focus he put somewhere else stays there.
  useEffect(() => {
    if (clearable === followedClearable.current) return;
    followedClearable.current = clearable;
    if (!clearable && (document.activeElement === null || document.activeElement === document.body)) openRef.current?.focus({ preventScroll: true });
  }, [clearable]);

  if (reading === null) {
    return (
      <div data-companion-memory="loading">
        <SettingsCard className="flex items-center justify-center px-4 py-8">
          <Spinner size={24} label={t('voiceSettings.companion.memory.loading', { defaultValue: 'Reading her memory…' })} />
        </SettingsCard>
      </div>
    );
  }

  if (count === null) {
    return (
      <div data-companion-memory="unreadable">
        <Banner tone="warn">
          {reading.reason === null
            ? t('voiceSettings.companion.memory.unreadablePlain', { name, defaultValue: "{{name}}'s memory couldn't be read." })
            : t('voiceSettings.companion.memory.unreadable', { name, reason: reading.reason, defaultValue: "{{name}}'s memory couldn't be read: {{reason}}" })}
        </Banner>
      </div>
    );
  }

  return (
    <div data-companion-memory={clearable ? 'kept' : 'empty'}>
      <SettingsCard>
        <SettingRow
          label={t('voiceSettings.companion.memory.title', { defaultValue: 'Her memory' })}
          description={(
            <span role="status" data-companion-memory-count={count} className={cn(clearable && 'font-medium text-foreground')}>
              {clearable
                ? t('voiceSettings.companion.memory.count', {
                  name,
                  count,
                  defaultValue_one: '{{name}} keeps {{count}} thing you told her to keep.',
                  defaultValue_other: '{{name}} keeps {{count}} things you told her to keep.',
                })
                : t('voiceSettings.companion.memory.empty', { name, defaultValue: '{{name}} keeps nothing yet.' })}
            </span>
          )}
          className="pb-3"
        >
          {null}
        </SettingRow>
        <div className="flex flex-wrap items-center gap-2 px-4 pb-4">
          <a
            ref={openRef}
            href={pageHref}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={t('voiceSettings.companion.memory.openLabel', { defaultValue: 'Open her memory in DocSpace, in a new tab' })}
            data-companion-memory-open=""
            className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), '[@media(pointer:coarse)]:min-h-11')}
          >
            {t('voiceSettings.companion.memory.open', { defaultValue: 'Open her memory' })}
            <ExternalLink aria-hidden="true" />
          </a>
          {clearable && (
            <Button
              variant="ghost"
              size="sm"
              data-companion-memory-clear=""
              onClick={() => setConfirming(true)}
              className="text-muted-foreground hover:text-foreground [@media(pointer:coarse)]:min-h-11"
            >
              {t('voiceSettings.companion.memory.clear', { defaultValue: 'Clear her memory' })}
            </Button>
          )}
        </div>
      </SettingsCard>

      <ConfirmDialog
        open={confirming && clearable}
        // Raised over the Settings modal, a body portal at z-9999: at the default z-50 the question would open behind it.
        wrapperClassName="z-[10000]"
        title={t('voiceSettings.companion.memory.clearTitle', { name, defaultValue: "Clear {{name}}'s memory?" })}
        message={t('voiceSettings.companion.memory.clearMessage', {
          count,
          defaultValue_one: "She forgets the {{count}} thing she keeps. The docstore's history keeps what was forgotten. Your conversation with her is not touched.",
          defaultValue_other: "She forgets all {{count}} things she keeps. The docstore's history keeps what was forgotten. Your conversation with her is not touched.",
        })}
        actions={[
          { label: t('voiceSettings.companion.memory.cancel', { defaultValue: 'Cancel' }), variant: 'outline', onSelect: () => setConfirming(false), disabled: clearing },
          // Its words stay while it is busy: ConfirmDialog keys each answer by its label, so new words would be a new
          // button, and the pressed one, focus and all, would leave the page.
          { label: t('voiceSettings.companion.memory.clearConfirm', { defaultValue: 'Clear her memory' }), variant: 'destructive', onSelect: onClear, busy: clearing },
        ]}
        onDismiss={() => { if (!clearing) setConfirming(false); }}
      />
    </div>
  );
}

/**
 * Her memory card on the page: what this module's CompanionSettingsSection passes into CompanionSettingsView's `memory`
 * slot, with her name. It reads her bank when it mounts and again after a clear, points Open her memory at her DocSpace
 * page, and clears through the server, raising a toast when the clear is refused; CompanionMemorySettingsView draws it.
 */
export function CompanionMemorySettings({ name }: { name: string }) {
  const { reading, clearing, clear } = useCompanionMemorySettings(name);

  return (
    <CompanionMemorySettingsView
      name={name}
      reading={reading}
      pageHref={reading === null ? '' : `${resolveDocSpaceOrigin()}/#page=${reading.pageId}`}
      clearing={clearing}
      onClear={() => { void clear(); }}
    />
  );
}
