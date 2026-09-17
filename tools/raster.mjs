// Rasterizes a PDF to PNGs for visual inspection (the machine has no pdftoppm).
// One-time setup: npm i mupdf   (WASM build, no native deps)
// Usage: node tools/raster.mjs <pdf-path> <out-prefix> [width-px]
import * as mupdf from 'mupdf';
import fs from 'fs';

const [pdfPath, outPrefix, widthArg] = process.argv.slice(2);
if (!pdfPath || !outPrefix) {
  console.log('usage: node tools/raster.mjs <pdf-path> <out-prefix> [width-px]');
  process.exit(1);
}
const targetW = Number(widthArg) || 1500;
const doc = mupdf.Document.openDocument(fs.readFileSync(pdfPath), 'application/pdf');
const n = doc.countPages();
for (let i = 0; i < n; i++) {
  const page = doc.loadPage(i);
  const b = page.getBounds();
  const scale = targetW / (b[2] - b[0]);
  const pix = page.toPixmap(mupdf.Matrix.scale(scale, scale), mupdf.ColorSpace.DeviceRGB, false, true);
  const file = `${outPrefix}-p${i + 1}.png`;
  fs.writeFileSync(file, pix.asPNG());
  console.log(file, pix.getWidth() + 'x' + pix.getHeight());
}
