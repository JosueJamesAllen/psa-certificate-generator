// Copies only the runtime files into dist/ for static hosting, the same way
// the ID generator does it. The app has no framework and no build - this just
// gathers the files index.html actually loads, so the published site stays
// small and doesn't carry the tools, docs or source artwork.
// Node core only, no dependencies.
//   node tools/build-dist.js
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const dist = path.join(root, 'dist');

const files = [
  'index.html',
  'style.css',
  'assets.js',
  'core.js',
  'app.js',
  'lib/xlsx.full.min.js',
  'lib/pdf-lib.min.js',
  'lib/fontkit.umd.min.js',
  'lib/cinzel-font.js',
  'lib/cinzel-bold-font.js',
  'lib/Cinzel-OFL.txt',
];

fs.rmSync(dist, { recursive: true, force: true });
files.forEach(function (rel) {
  const src = path.join(root, rel);
  const dest = path.join(dist, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
});
console.log('dist/ built:', files.length, 'files');
