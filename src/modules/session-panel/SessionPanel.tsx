import { useTranslation } from 'react-i18next';

import { FollowupsContext, FollowupsWidgetBody } from '@/modules/followups';
import { useSessionPanel } from '@/modules/session-panel/context/sessionPanelContext';
import { usePanelVersion } from '@/modules/session-panel/hooks/usePanelVersion';
import { PanelStage } from '@/modules/session-panel/PanelStage';
import { Button, SegmentedControl, Spinner } from '@/shared/ui';

/**
 * THE CHAT'S PANEL: the one place the chat has to itself, in front of the talk when the reader switches to it. It shows one
 * thing at a time, which the chat put there with its `panel` command: a diagram, a picture, a web page, or a page of its own.
 * Over the thing is what it is called and which version is on show; under it, once there is more than one, the line of its
 * versions to walk back along, with Latest to come back. On the panel's edge are the chat's follow-ups, in the app's own groups
 * and words (the followups module's body), each with its tick; where the page draws them apart (the chat's side column at a
 * desk, `followupsApart`) the panel leaves them out.
 *
 * A chat with follow-ups and nothing shown has a panel of follow-ups alone. The panel scrolls as a whole: nothing in it is
 * squeezed to make room.
 *
 * It draws only what the provider read (`SessionPanelProvider`), and nothing when there is no provider or nothing to show.
 *
 * Used by `SessionPanelLayout`, in the chat's place.
 */
export function SessionPanel() {
  const { t } = useTranslation();
  const panel = useSessionPanel();
  const viewing = panel?.viewing ?? null;
  const version = usePanelVersion(viewing?.id ?? null);

  if (panel === null || panel.form === 'none') return null;
  const { versions, followups, onLatest, lookAt } = panel;
  const newest = versions.length === 0 ? null : versions[versions.length - 1];
  const hasFollowups = !panel.followupsApart && (followups.items?.length ?? 0) > 0;

  return (
    <section
      data-session-panel={panel.form}
      data-panel-version={viewing?.id}
      aria-label={viewing ? t('sessionPanel.named', { title: viewing.title }) : t('sessionPanel.name')}
      className="session-panel min-h-0 min-w-0 flex-col gap-3 overflow-y-auto px-4 pb-4 pt-1 [scrollbar-width:thin] [&>*]:flex-none"
    >
      {viewing !== null && newest !== null && (
        <>
          <header className="flex min-h-9 flex-wrap items-center gap-x-3 gap-y-1">
            <p className="min-w-0 truncate font-mono text-[10px] font-medium uppercase leading-[14px] tracking-[0.18em] text-muted-foreground" title={viewing.title}>
              {t('sessionPanel.named', { title: viewing.title })}
            </p>
            <span data-panel-version-words className="mr-auto flex-none font-mono text-xs text-[var(--ink-faint)]">
              {t('sessionPanel.version', { kind: t(`sessionPanel.kind.${viewing.kind}`), n: viewing.version, of: newest.version })}
            </span>
            {!onLatest && <Button variant="outline" size="sm" className="h-8 finger:h-11" data-panel-latest onClick={() => lookAt(null)}>{t('sessionPanel.latest')}</Button>}
          </header>

          {/* A web page takes all the height the panel has left: it is a window onto a page, not a thing with a size of its own. */}
          <div data-panel-stage={viewing.kind} className="grid min-h-[240px] place-items-center py-2 data-[panel-stage=page]:min-h-[360px] data-[panel-stage=page]:flex-1 data-[panel-stage=page]:place-items-stretch max-[879.98px]:min-h-0 max-[879.98px]:data-[panel-stage=page]:min-h-[360px]">
            {version === null
              ? <Spinner label={t('sessionPanel.reading')} />
              : version === 'gone'
                ? <p data-panel-gone className="text-sm text-muted-foreground">{t('sessionPanel.versionGone')}</p>
                : <PanelStage key={version.id} version={version} />}
          </div>

          {versions.length > 1 && (
            <div data-panel-versions className="max-w-full overflow-x-auto [scrollbar-width:thin]">
              <SegmentedControl
                label={t('sessionPanel.versions', { title: viewing.title })}
                options={versions.map((item) => ({ value: String(item.id), label: t('sessionPanel.v', { n: item.version }) }))}
                value={String(viewing.id)}
                onChange={(id) => lookAt(Number(id) === newest.id ? null : Number(id))}
              />
            </div>
          )}
        </>
      )}

      {hasFollowups && (
        <div data-panel-followups className={viewing !== null ? 'border-t border-border pt-3' : undefined}>
          <FollowupsContext.Provider value={followups}>
            <FollowupsWidgetBody />
          </FollowupsContext.Provider>
        </div>
      )}
    </section>
  );
}
