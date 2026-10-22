import { Maximize2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button, Lightbox } from '@/shared/ui';
import { formatShortDate } from '@/shared/utils';

type PageImageProps = {
  /** The page's PNG as an object URL; null while it loads, when it failed, and before the page's file is known. */
  image: string | null;
  page: number;
  /** The carrier, which names the picture for assistive tech; '' while the view does not know it. */
  carrier: string;
  /** The day the file the picture is of was stored, which the caption names; null while the view does not know it. */
  stored: string | null;
  /** Whether the picture is open in the house Lightbox. Held by the view root, so a new page always opens with it shut. */
  enlarged: boolean;
  onEnlarge: () => void;
  onShrink: () => void;
};

/**
 * THE PAGE AS STORED: the PNG of this exact file's page, which the reading beside it is about.
 *
 * The box keeps a letter page's shape (8.5 × 11) whatever is in it, so the reading beside it never jumps when the picture
 * lands, and the picture is contained in it, never stretched: the wire gives no page size, and a landscape page drawn into
 * a portrait box at the box's shape would read as a squashed one. While there is no picture the box is Verve's neutral
 * tile with the page's number — never a blank cell or a broken-image glyph — as the library's photos draw theirs.
 *
 * Under it, a caption naming the file the picture is of, and Enlarge, which opens the picture in the house `Lightbox`
 * at the screen's fit, to zoom and pan as a photo is. The picture is the server's own rendering of the stored PDF; the
 * view never draws the PDF itself.
 *
 * Used by the carrier-bulletins module's `PageScreen`, beside the reading once the panel is wide and above it on a phone.
 */
export function PageImage({ image, page, carrier, stored, enlarged, onEnlarge, onShrink }: PageImageProps) {
  const { t } = useTranslation();
  const alt = carrier === '' ? t('cerberus.bulletins.page.imageAltPage', { page }) : t('cerberus.bulletins.page.imageAlt', { page, carrier });
  const day = formatShortDate(stored);

  return (
    <figure className="m-0 flex min-w-0 flex-col gap-2 [@container(min-width:720px)]:sticky [@container(min-width:720px)]:top-4">
      <div className="relative aspect-[17/22] w-full overflow-hidden ring-1 ring-border">
        {image === null ? (
          <div role="img" aria-label={alt} className="vv-gallery__fallback absolute inset-0 flex items-center justify-center">
            <span aria-hidden="true">{t('cerberus.bulletins.page.tile', { page })}</span>
          </div>
        ) : (
          <img src={image} alt={alt} draggable={false} className="absolute inset-0 size-full object-contain" />
        )}
      </div>
      <figcaption className="flex items-center justify-between gap-3">
        <span className="min-w-0 text-[12.5px] text-muted-foreground">
          {day === null ? t('cerberus.bulletins.page.captionPage', { page }) : t('cerberus.bulletins.page.caption', { page, stored: day })}
        </span>
        <Button variant="ghost" size="sm" className="flex-none max-md:h-11" disabled={image === null} onClick={onEnlarge}>
          <Maximize2 aria-hidden="true" />
          {t('cerberus.bulletins.page.enlarge')}
        </Button>
      </figcaption>
      {/* Mounted only while open, as the Lightbox asks: it opens into the top layer and gives focus back on close. */}
      {enlarged && image !== null && (
        <Lightbox label={alt} onClose={onShrink}>
          <img src={image} alt={alt} draggable={false} className="block max-h-[88vh] max-w-[92vw] shadow-2xl" />
        </Lightbox>
      )}
    </figure>
  );
}
