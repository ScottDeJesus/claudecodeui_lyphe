import fs from 'node:fs/promises';
import sharp from 'sharp';
import { ACCENT_PALETTES, accentAssetDir } from '../../shared/accentPalettes.js';

/**
 * Every app icon, rendered from one square source: the web's tab icon, logos and PWA set, the iOS
 * touch icon, and the desktop app's macOS `.icns` and Windows `.ico`. Change the mark by replacing
 * the source and re-running `npm run icons`; nothing else draws it.
 *
 * The web set is written once for the default green (`public/`) and once more for every accent
 * palette in shared/accentPalettes.js (`public/accent/<name>/`, the same layout plus a manifest
 * whose icon paths point there). The palette copies are recoloured from this same source, the way
 * the dark mark is, never kept as files of their own. The desktop app stays green.
 *
 * Rounded icons carry a 25% corner in their alpha, the shape of the app's earlier logo tile; the macOS
 * ones also keep Apple's transparent margin so the Dock draws them at native size. The
 * iOS touch icon and the maskable PWA icon stay square and full-bleed: iOS and Android cut their
 * own shape, and a transparent corner would come out black on iOS and ringed on Android.
 */

const SOURCE = 'electron/assets/app-icon-source.png';
const PUBLIC = 'public';
const ELECTRON = 'electron/assets';

/** The source's three colours: the white tile and the mark's two greens (accent-ink light, accent dark). */
const SOURCE_COLOURS = [[255, 255, 255], [28, 125, 84], [76, 196, 147]];
/** The dark tile: Verve dark `--surface2`, a step off the dark card so the tile still reads. */
const DARK_TILE = [36, 37, 47];

function rgbOf(hex) {
  const value = parseInt(hex.slice(1), 16);
  return [value >> 16 & 255, value >> 8 & 255, value & 255];
}

/**
 * The source recoloured, rather than kept as another file to drift. The source is three colours
 * and their antialiased blends. Each pixel is split into its share of those three (barycentric,
 * least squares on the plane they span) and rebuilt from `to` — the tile, then the two marks — so
 * every edge blend lands on the matching blend of the new colours. The dark mark is the dark
 * theme's accent pair on the dark tile; an accent palette's marks are its own ladder's colours.
 */
async function recolour(to) {
  const { data, info } = await sharp(SOURCE).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const [w, a, b] = SOURCE_COLOURS;
  const u = a.map((v, i) => v - w[i]);
  const v = b.map((x, i) => x - w[i]);
  const dot = (p, q) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
  const uu = dot(u, u), uv = dot(u, v), vv = dot(v, v), det = uu * vv - uv * uv;
  const out = Buffer.alloc(data.length);
  for (let i = 0; i < data.length; i += 3) {
    const p = [data[i] - w[0], data[i + 1] - w[1], data[i + 2] - w[2]];
    const pu = dot(p, u), pv = dot(p, v);
    const s = Math.min(1, Math.max(0, (vv * pu - uv * pv) / det));
    const t = Math.min(1 - s, Math.max(0, (uu * pv - uv * pu) / det));
    for (let c = 0; c < 3; c += 1) {
      out[i + c] = Math.round(to[0][c] * (1 - s - t) + to[1][c] * s + to[2][c] * t);
    }
  }
  return sharp(out, { raw: info }).png().toBuffer();
}

function roundedMask(size) {
  const radius = Math.round(size * 0.25);
  return Buffer.from(`<svg width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${radius}" ry="${radius}"/></svg>`);
}

/** Web icons are palette-quantized: a quarter of the bytes, no visible banding on this source. The
 *  desktop icons ship inside the installer, never over the wire, so they stay full-colour. */
function encode(image, web) {
  return image.png(web ? { compressionLevel: 9, palette: true, quality: 90, effort: 10 } : { compressionLevel: 9 });
}

function rounded(size, web = true, source = SOURCE) {
  const image = sharp(source).resize(size, size, { kernel: 'lanczos3' })
    .composite([{ input: roundedMask(size), blend: 'dest-in' }]);
  return encode(image, web).toBuffer();
}

function square(size, source = SOURCE) {
  return encode(sharp(source).resize(size, size, { kernel: 'lanczos3' }), true).toBuffer();
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

/** The web's icons in `dir`: the light set, and the dark theme's tab icon and in-app logos (`AppLogo`,
 *  ThemeContext's favicon swap). The PWA, iOS and desktop icons stay light: the OS draws them, and
 *  none of them can follow a theme. */
function webIcons(dir, lightMark, darkMark) {
  return [
    ...[72, 96, 128, 144, 152, 192, 384, 512].map((size) => write(`${dir}/icons/icon-${size}x${size}.png`, rounded(size, true, lightMark))),
    ...[32, 64, 128, 256, 512].map((size) => write(`${dir}/logo-${size}.png`, rounded(size, true, lightMark))),
    write(`${dir}/favicon.png`, rounded(64, true, lightMark)),
    ...[32, 64, 128, 256, 512].map((size) => write(`${dir}/logo-dark-${size}.png`, rounded(size, true, darkMark))),
    write(`${dir}/favicon-dark.png`, rounded(64, true, darkMark)),
    write(`${dir}/icons/apple-touch-icon.png`, square(180, lightMark)),
    write(`${dir}/icons/icon-maskable-512x512.png`, square(512, lightMark)),
  ];
}

/**
 * One accent palette's web set under `public/accent/<name>/`, marks taken from its own ladder: the
 * light tile carries accent-ink and the dark accent (the roles the green marks are), the dark tile
 * the dark accent and the dark accent-ink. Its manifest is the default one with every icon path
 * moved under the palette's directory, so the installed app wears the palette too.
 */
async function accentPaletteIcons(name, palette) {
  const urlDirectory = accentAssetDir(name);
  const dir = `${PUBLIC}${urlDirectory}`;
  await fs.mkdir(`${dir}/icons`, { recursive: true });
  const lightMark = await recolour([SOURCE_COLOURS[0], rgbOf(palette.light.accentInk), rgbOf(palette.dark.accent)]);
  const darkMark = await recolour([DARK_TILE, rgbOf(palette.dark.accent), rgbOf(palette.dark.accentInk)]);
  const manifest = JSON.parse(await fs.readFile(`${PUBLIC}/manifest.json`, 'utf8'));
  manifest.icons = manifest.icons.map((icon) => ({ ...icon, src: `${urlDirectory}${icon.src}` }));
  await Promise.all([
    ...webIcons(dir, lightMark, darkMark),
    fs.writeFile(`${dir}/manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`),
  ]);
}

const darkMark = await recolour([DARK_TILE, [76, 196, 147], [169, 232, 203]]);

await Promise.all([
  ...webIcons(PUBLIC, SOURCE, darkMark),
  ...Object.entries(ACCENT_PALETTES).map(([name, palette]) => accentPaletteIcons(name, palette)),
  write(`${ELECTRON}/logo-macos.png`, macRounded(1024)),
  write(`${ELECTRON}/logo-macos.icns`, icns([
    ['icp4', 16], ['icp5', 32], ['icp6', 64], ['ic07', 128], ['ic08', 256], ['ic09', 512], ['ic10', 1024],
    ['ic11', 32], ['ic12', 64], ['ic13', 256], ['ic14', 512],
  ])),
  write(`${ELECTRON}/logo-windows.ico`, ico([16, 24, 32, 48, 64, 128, 256])),
]);
console.log('icons written');
