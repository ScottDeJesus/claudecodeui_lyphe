import fs from 'node:fs/promises';
import sharp from 'sharp';

/**
 * Every app icon, rendered from one square source: the web's tab icon, logos and PWA set, the iOS
 * touch icon, and the desktop app's macOS `.icns` and Windows `.ico`. Change the mark by replacing
 * the source and re-running `npm run icons`; nothing else draws it.
 *
 * Rounded icons carry a 25% corner in their alpha, the shape of the app's earlier logo tile; the macOS
 * ones also keep Apple's transparent margin so the Dock draws them at native size. The
 * iOS touch icon and the maskable PWA icon stay square and full-bleed: iOS and Android cut their
 * own shape, and a transparent corner would come out black on iOS and ringed on Android.
 */

const SOURCE = 'electron/assets/app-icon-source.png';
const PUBLIC = 'public';
const ELECTRON = 'electron/assets';

function roundedMask(size) {
  const radius = Math.round(size * 0.25);
  return Buffer.from(`<svg width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${radius}" ry="${radius}"/></svg>`);
}

/** Web icons are palette-quantized: a quarter of the bytes, no visible banding on this source. The
 *  desktop icons ship inside the installer, never over the wire, so they stay full-colour. */
function encode(image, web) {
  return image.png(web ? { compressionLevel: 9, palette: true, quality: 90, effort: 10 } : { compressionLevel: 9 });
}

function rounded(size, web = true) {
  const image = sharp(SOURCE).resize(size, size, { kernel: 'lanczos3' })
    .composite([{ input: roundedMask(size), blend: 'dest-in' }]);
  return encode(image, web).toBuffer();
}

function square(size) {
  return encode(sharp(SOURCE).resize(size, size, { kernel: 'lanczos3' }), true).toBuffer();
}

/** Apple's icon grid: the art sits in 824 of 1024, with a transparent margin all round. */
async function macRounded(size) {
  const art = Math.round(size * 824 / 1024);
  const margin = Math.floor((size - art) / 2);
  return sharp(await rounded(art, false))
    .extend({ top: margin, bottom: size - art - margin, left: margin, right: size - art - margin, background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

async function write(file, bufferPromise) {
  await fs.writeFile(file, await bufferPromise);
}

/** `.icns`: a header, then one PNG-bodied block per entry type. */
async function icns(entries) {
  const blocks = await Promise.all(entries.map(async ([type, size]) => {
    const png = await macRounded(size);
    const block = Buffer.alloc(8 + png.length);
    block.write(type, 0, 4, 'ascii');
    block.writeUInt32BE(block.length, 4);
    png.copy(block, 8);
    return block;
  }));
  const total = 8 + blocks.reduce((sum, block) => sum + block.length, 0);
  const header = Buffer.alloc(8);
  header.write('icns', 0, 4, 'ascii');
  header.writeUInt32BE(total, 4);
  return Buffer.concat([header, ...blocks], total);
}

/** `.ico`: ICONDIR, one 16-byte entry per size, then the PNG bodies (Vista+ reads PNG entries). */
async function ico(sizes) {
  const pngs = await Promise.all(sizes.map((size) => rounded(size, false)));
  const header = Buffer.alloc(6 + 16 * sizes.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(sizes.length, 4);
  let offset = header.length;
  sizes.forEach((size, index) => {
    const at = 6 + 16 * index;
    // A width or height of 0 means 256.
    header.writeUInt8(size >= 256 ? 0 : size, at);
    header.writeUInt8(size >= 256 ? 0 : size, at + 1);
    header.writeUInt16LE(1, at + 4);
    header.writeUInt16LE(32, at + 6);
    header.writeUInt32LE(pngs[index].length, at + 8);
    header.writeUInt32LE(offset, at + 12);
    offset += pngs[index].length;
  });
  return Buffer.concat([header, ...pngs]);
}

await Promise.all([
  ...[72, 96, 128, 144, 152, 192, 384, 512].map((size) => write(`${PUBLIC}/icons/icon-${size}x${size}.png`, rounded(size))),
  ...[32, 64, 128, 256, 512].map((size) => write(`${PUBLIC}/logo-${size}.png`, rounded(size))),
  write(`${PUBLIC}/favicon.png`, rounded(64)),
  write(`${PUBLIC}/icons/apple-touch-icon.png`, square(180)),
  write(`${PUBLIC}/icons/icon-maskable-512x512.png`, square(512)),
  write(`${ELECTRON}/logo-macos.png`, macRounded(1024)),
  write(`${ELECTRON}/logo-macos.icns`, icns([
    ['icp4', 16], ['icp5', 32], ['icp6', 64], ['ic07', 128], ['ic08', 256], ['ic09', 512], ['ic10', 1024],
    ['ic11', 32], ['ic12', 64], ['ic13', 256], ['ic14', 512],
  ])),
  write(`${ELECTRON}/logo-windows.ico`, ico([16, 24, 32, 48, 64, 128, 256])),
]);
console.log('icons written');
