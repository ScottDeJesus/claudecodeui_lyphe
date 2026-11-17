import { ExternalLink } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { MermaidDiagram } from '@/modules/markdown-preview';
import { EmbedUrlFrame, WidgetFrame, resolveEmbedUrl } from '@/modules/widgets';
import { api } from '@/shared/api';
import type { SessionPanelVersion } from '@/shared/types';
import { Lightbox, Spinner, buttonVariants } from '@/shared/ui';
import { cn } from '@/shared/utils';

/** The picture reads that are out, by version id: one read serves everyone who asks while it is out, since a response's body can be read once. */
const picturesOut = new Map<number, Promise<Blob | null>>();

/** The bytes of a version's picture file, or null when the server no longer has the file. */
function readPicture(id: number): Promise<Blob | null> {
  const out = picturesOut.get(id);
  if (out !== undefined) return out;
  const asked = (async () => {
    try {
      const response = await api.sessionPanel.picture(id);
      return response.ok ? await response.blob() : null;
    } catch {
      // The app's own network: the picture reads as gone until the panel is drawn again.
      return null;
    } finally {
      picturesOut.delete(id);
    }
  })();
  picturesOut.set(id, asked);
  return asked;
}

/**
 * A picture kept as a file on the server's machine, as an address the page can draw: its bytes need the auth header, so they are
 * fetched as a blob and handed to the image as an object URL, revoked when the picture leaves. Null while it is being read, and
 * `'gone'` when the file is no longer where the chat showed it from.
 */
function usePictureFile(id: number, isFile: boolean): string | null | 'gone' {
  // The object URL of the version now asked for, tagged with its id so one version's picture never draws as another's.
  const [held, setHeld] = useState<{ id: number; src: string | 'gone' } | null>(null);

  useEffect(() => {
    if (!isFile) return undefined;
    let current = true;
    let made: string | null = null;
    void readPicture(id).then((blob) => {
      if (!current) return;
      if (blob === null) {
        setHeld({ id, src: 'gone' });
        return;
      }
      made = URL.createObjectURL(blob);
      setHeld({ id, src: made });
    });
    return () => {
      current = false;
      if (made !== null) URL.revokeObjectURL(made);
    };
  }, [id, isFile]);

  return held !== null && held.id === id ? held.src : null;
}

/** A picture on the panel: fitted to the panel's width, and opened in the kit's viewer on a press, as a diagram is. */
function PanelPicture({ version }: { version: SessionPanelVersion }) {
  const { t } = useTranslation();
  const file = usePictureFile(version.id, version.pictureIsFile);
  // Whether the full-screen viewer is open. Local to this picture: only its own press opens it.
  const [expanded, setExpanded] = useState(false);
  const src = version.pictureIsFile ? file : version.body;

  if (src === null) return <Spinner label={t('sessionPanel.reading')} />;
  if (src === 'gone') return <p data-panel-gone className="text-sm text-muted-foreground">{t('sessionPanel.pictureGone')}</p>;
  return (
    <>
      <button type="button" className="block max-w-full cursor-zoom-in" aria-label={t('sessionPanel.enlarge', { title: version.title })} onClick={() => setExpanded(true)}>
        <img src={src} alt={version.title} className="block h-auto max-w-full border border-border" />
      </button>
      {expanded && (
        <Lightbox label={version.title} onClose={() => setExpanded(false)}>
          <img src={src} alt={version.title} className="max-h-[92vh] max-w-[94vw]" />
        </Lightbox>
      )}
    </>
  );
}

/** A web page on the panel: its address on a line with the way out to the page itself, and the page under it in the app's one embed frame. */
function PanelPage({ version }: { version: SessionPanelVersion }) {
  const { t } = useTranslation();
  // The address a reader's browser can reach: the frame makes the same correction for a loopback address (`embedUrl.ts`).
  const href = resolveEmbedUrl(version.body);
  return (
    <div data-panel-page className="flex min-h-[360px] w-full flex-1 flex-col self-stretch border border-border">
      <div className="flex min-h-9 flex-none items-center justify-between gap-3 border-b border-border pl-3 pr-1">
        <span className="min-w-0 truncate font-mono text-xs text-muted-foreground" title={href}>{href}</span>
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          aria-label={t('sessionPanel.openPage')}
          title={t('sessionPanel.openPage')}
          className={cn(buttonVariants({ variant: 'ghost', size: 'icon' }), 'size-8 flex-none finger:size-11')}
        >
          <ExternalLink aria-hidden="true" />
        </a>
      </div>
      <div className="min-h-0 flex-1">
        <EmbedUrlFrame key={version.body} url={version.body} title={version.title} framed fill />
      </div>
    </div>
  );
}

/**
 * WHAT A VERSION OF THE PANEL SHOWS, drawn by the frames the chat already has, so a thing on the panel is the same thing it would
 * be in a reply: a diagram is the markdown preview's `MermaidDiagram`, a page is the one embed frame (`EmbedUrlFrame`), a page the
 * chat wrote itself is the sandboxed `WidgetFrame`, and a picture is an image the kit's viewer opens.
 *
 * Keyed by the version's id by its caller, so walking the line mounts the version walked to and nothing carries over.
 *
 * Used by `SessionPanel`.
 */
export function PanelStage({ version }: { version: SessionPanelVersion }) {
  if (version.kind === 'diagram') return <div data-panel-diagram className="w-full min-w-0"><MermaidDiagram code={version.body} /></div>;
  if (version.kind === 'picture') return <PanelPicture version={version} />;
  if (version.kind === 'page') return <PanelPage version={version} />;
  return <div data-panel-widget className="w-full min-w-0"><WidgetFrame code={version.body} /></div>;
}
