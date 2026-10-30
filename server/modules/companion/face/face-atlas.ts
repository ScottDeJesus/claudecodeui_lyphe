import { createHash } from 'node:crypto';

import sharp from 'sharp';

import type { CompanionFaceManifest } from '@/shared/companion-types.js';

import { FacePhotoInvalid, MIN_PHOTO_SIDE, sentences } from './face-refusal.js';
import { FACE_FRAMING, type FaceFraming } from './face-recipe.js';

/**
 * The picture work of the bake, all of it sharp: the photo made ready, the cut of each generator crop to the disc's
 * square, the packing of the cut frames onto WebP sheets, and the contact sheet he reads to tune the recipe.
 */

/** The longest side `photo.png` keeps: the generator sees a face of a few hundred pixels either way, and a phone photo is far more. */
const PHOTO_MAX_SIDE = 2048;
/** The side of the crop the node's preview is: LivePortrait's own working size (nodes.py `prepare_source`). */
const PREVIEW_SIDE = 512;
/** Cells per row of a sheet, and per column: 8 × 8 cells of 256 px is a 2048 px sheet. */
const SHEET_CELLS = 8;
const WEBP_QUALITY = 82;

const CONTACT_CELL = 128;
const CONTACT_COLUMNS = 10;
const CONTACT_LABEL_HEIGHT = 30;
const CONTACT_GAP = 8;

/**
 * Makes an uploaded photo ready for the bake: EXIF orientation applied, alpha flattened onto white, colour in sRGB, at most
 * 2048 px on the long side, as a PNG. `photoId` is the id of the UPLOADED bytes, not of the PNG. A photo whose shorter
 * side is under 512 px, or that is no image sharp can read, is a `FacePhotoInvalid` with the sentence for his screen.
 * Consumed by `face-files.ts` (`storePhoto`).
 */
export async function normalizePhoto(bytes: Buffer): Promise<{ png: Buffer; photoId: string; width: number; height: number }> {
  let metadata: sharp.Metadata;
  try {
    metadata = await sharp(bytes).metadata();
  } catch {
    throw new FacePhotoInvalid(sentences.unreadable());
  }
  const turned = (metadata.orientation ?? 1) >= 5; // EXIF 5-8 are the quarter turns, which swap width and height
  const orientedWidth = (turned ? metadata.height : metadata.width) ?? 0;
  const orientedHeight = (turned ? metadata.width : metadata.height) ?? 0;
  const shortSide = Math.min(orientedWidth, orientedHeight);
  if (shortSide === 0) throw new FacePhotoInvalid(sentences.unreadable());
  if (shortSide < MIN_PHOTO_SIDE) throw new FacePhotoInvalid(sentences.tooSmall(shortSide));

  // The header read above says nothing of the pixels: a cut-off or damaged file is only found out here, as a decoder's error.
  let data: Buffer;
  let info: sharp.OutputInfo;
  try {
    ({ data, info } = await sharp(bytes)
      .rotate()
      .flatten({ background: '#ffffff' })
      .toColourspace('srgb')
      .resize({ width: PHOTO_MAX_SIDE, height: PHOTO_MAX_SIDE, fit: 'inside', withoutEnlargement: true })
      .png()
      .toBuffer({ resolveWithObject: true }));
  } catch {
    throw new FacePhotoInvalid(sentences.unreadable());
  }

  return { png: data, photoId: createHash('sha256').update(bytes).digest('hex').slice(0, 12), width: info.width, height: info.height };
}

/**
 * The photo with a band on every side, `pad` times its size (width on the sides, height above and below). The node shifts a
 * crop that runs off the image, which would move the face off the crop's centre; the band keeps every crop inside, and it
 * lies outside the disc. The sides are mirrored pixels. Above and below they are NOT: a vertical mirror holds the face
 * itself, upside down, at the very x of the real one, and the node takes the face box nearest the image's horizontal
 * centre — measured on the seed photo, it chose the reflection. A replicated edge row has no face in it. Consumed by
 * `face-bake.ts`, which hands the result to ComfyUI.
 */
export async function padPhoto(png: Buffer, pad: number = FACE_FRAMING.pad): Promise<Buffer> {
  const { width, height } = await sharp(png).metadata();
  const sideBand = Math.round((width ?? 0) * pad);
  const verticalBand = Math.round((height ?? 0) * pad);
  const sidesMirrored = await sharp(png).extend({ left: sideBand, right: sideBand, extendWith: 'mirror' }).png({ compressionLevel: 1 }).toBuffer();
  return sharp(sidesMirrored)
    .extend({ top: verticalBand, bottom: verticalBand, extendWith: 'copy' })
    .png({ compressionLevel: 1 })
    .toBuffer();
}

/**
 * The disc's square in the node's 512 px preview. The node centres the crop on the face's box, so the face's centre is
 * (256, 256) and its side is 512 / cropFactor; the square is `discSide` face sides across with its centre raised
 * `discRaise` face sides. The same pixels for every frame of a photo. Consumed by `cutFrame`.
 */
export function discSquare(framing: FaceFraming): { left: number; top: number; size: number } {
  const faceSide = PREVIEW_SIDE / framing.cropFactor;
  const size = Math.round(framing.discSide * faceSide);
  const centreX = PREVIEW_SIDE / 2;
  const centreY = PREVIEW_SIDE / 2 - framing.discRaise * faceSide;
  return { left: Math.round(centreX - size / 2), top: Math.round(centreY - size / 2), size };
}

/**
 * One frame: the disc's square cut from the node's preview and resized to `frameSize`, as a lossless PNG for packing.
 * A square that does not lie inside the preview is a recipe value to correct, so it throws and names the numbers.
 * Consumed by `face-bake.ts`, once per frame.
 */
export async function cutFrame(preview: Buffer, framing: FaceFraming = FACE_FRAMING): Promise<Buffer> {
  const { width, height } = await sharp(preview).metadata();
  if (width !== PREVIEW_SIDE || height !== PREVIEW_SIDE) {
    throw new Error(`the node's preview is ${width}x${height}, not ${PREVIEW_SIDE}x${PREVIEW_SIDE}`);
  }
  const square = discSquare(framing);
  if (square.left < 0 || square.top < 0 || square.left + square.size > PREVIEW_SIDE || square.top + square.size > PREVIEW_SIDE) {
    throw new Error(`the disc's square ${JSON.stringify(square)} runs outside the ${PREVIEW_SIDE} px preview: lower discSide or discRaise, or raise cropFactor`);
  }
  return sharp(preview)
    .extract({ left: square.left, top: square.top, width: square.size, height: square.size })
    .resize(framing.frameSize, framing.frameSize, { kernel: 'lanczos3' })
    .png({ compressionLevel: 3 })
    .toBuffer();
}

/**
 * Where each of `frameCount` frames sits: filled sheet by sheet, row by row, 8 columns by 8 rows at most, and the last
 * sheet only as tall as its frames need. These are the manifest's `sheets` and `frames`. Consumed by `face-bake.ts`.
 */
export function layoutSheets(frameCount: number): Pick<CompanionFaceManifest, 'sheets' | 'frames'> {
  const perSheet = SHEET_CELLS * SHEET_CELLS;
  const sheets: CompanionFaceManifest['sheets'] = [];
  const frames: CompanionFaceManifest['frames'] = [];
  for (let first = 0; first < frameCount; first += perSheet) {
    const held = Math.min(perSheet, frameCount - first);
    sheets.push({ file: `sheet-${sheets.length}.webp`, columns: Math.min(SHEET_CELLS, held), rows: Math.ceil(held / SHEET_CELLS) });
  }
  for (let index = 0; index < frameCount; index += 1) {
    const within = index % perSheet;
    frames.push({ sheet: Math.floor(index / perSheet), column: within % SHEET_CELLS, row: Math.floor(within / SHEET_CELLS) });
  }
  return { sheets, frames };
}

/** The cut frames packed 8 by 8 onto WebP sheets (quality 82), in `layoutSheets`' order. Consumed by `face-bake.ts`. */
export async function packSheets(frames: Buffer[]): Promise<Buffer[]> {
  if (frames.length === 0) return [];
  const cell = (await sharp(frames[0]).metadata()).width ?? FACE_FRAMING.frameSize;
  const layout = layoutSheets(frames.length);

  return Promise.all(layout.sheets.map((sheet, sheetIndex) => {
    const cells = layout.frames
      .map((place, index) => ({ place, index }))
      .filter(({ place }) => place.sheet === sheetIndex)
      .map(({ place, index }) => ({ input: frames[index], left: place.column * cell, top: place.row * cell }));
    return sharp({ create: { width: sheet.columns * cell, height: sheet.rows * cell, channels: 3, background: '#ffffff' } })
      .composite(cells)
      .webp({ quality: WEBP_QUALITY, smartSubsample: true })
      .toBuffer();
  }));
}

function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** A frame's name on two lines, split at its last dot (`blink.mock_serious` / `closed`), so a long name still fits a 128 px cell. */
function labelSvg(name: string): Buffer {
  const dot = name.lastIndexOf('.');
  const lines = dot === -1 ? [name, ''] : [name.slice(0, dot), name.slice(dot + 1)];
  const widest = Math.max(...lines.map((line) => line.length), 1);
  const fontSize = Math.min(11, Math.floor((((CONTACT_CELL - 4) / (widest * 0.62)) * 10)) / 10); // DejaVu Sans Mono's advance is 0.6 em
  const text = lines
    .map((line, row) => `<text x="${CONTACT_CELL / 2}" y="${12 + row * 13}" text-anchor="middle">${escapeXml(line)}</text>`)
    .join('');
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${CONTACT_CELL}" height="${CONTACT_LABEL_HEIGHT}">` +
      `<g font-family="DejaVu Sans Mono, monospace" font-size="${fontSize}" fill="#1c1c1c">${text}</g></svg>`,
  );
}

/** A veil over the square's corners, the part outside the circle the page draws her in: what he reads for a collar or shoulders inside the disc is what the veil leaves bare. */
function circleVeilSvg(): Buffer {
  const radius = CONTACT_CELL / 2;
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${CONTACT_CELL}" height="${CONTACT_CELL}">` +
      `<path fill="#ffffff" fill-opacity="0.7" fill-rule="evenodd" d="M0 0H${CONTACT_CELL}V${CONTACT_CELL}H0Z ` +
      `M0 ${radius}a${radius} ${radius} 0 1 0 ${CONTACT_CELL} 0a${radius} ${radius} 0 1 0 -${CONTACT_CELL} 0Z"/></svg>`,
  );
}

/**
 * Every frame at 128 px with its name under it, ten to a row, the part outside the disc's circle veiled: the picture the
 * builder reads to tune the recipe and the Settings card shows under "See every frame". Each label is an SVG composited by
 * sharp. `names[n]` names `frames[n]`. Consumed by `face-bake.ts`.
 */
export async function contactSheet(frames: Buffer[], names: string[]): Promise<Buffer> {
  const cellWidth = CONTACT_CELL + CONTACT_GAP;
  const cellHeight = CONTACT_CELL + CONTACT_LABEL_HEIGHT + CONTACT_GAP;
  const rows = Math.ceil(frames.length / CONTACT_COLUMNS);
  const veil = circleVeilSvg();

  const layers: sharp.OverlayOptions[] = [];
  for (const [index, frame] of frames.entries()) {
    const left = CONTACT_GAP / 2 + (index % CONTACT_COLUMNS) * cellWidth;
    const top = CONTACT_GAP / 2 + Math.floor(index / CONTACT_COLUMNS) * cellHeight;
    const small = await sharp(frame).resize(CONTACT_CELL, CONTACT_CELL, { kernel: 'lanczos3' }).png().toBuffer();
    layers.push(
      { input: small, left, top },
      { input: veil, left, top },
      { input: labelSvg(names[index] ?? `frame ${index}`), left, top: top + CONTACT_CELL + 2 },
    );
  }

  return sharp({
    create: { width: CONTACT_COLUMNS * cellWidth + CONTACT_GAP / 2, height: rows * cellHeight + CONTACT_GAP / 2, channels: 3, background: '#f2f2f2' },
  })
    .composite(layers)
    .webp({ quality: 90 })
    .toBuffer();
}
