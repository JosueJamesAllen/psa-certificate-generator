// Headless test: renders every size / orientation / sheet combination through
// the same engine the app uses, so layout changes can be eyeballed without
// clicking through the UI. Run: node tools/test-generate.js
// Then rasterize and look:  node tools/raster.mjs out/a4-portrait.pdf out/a4p 1500
const fs = require('fs');
const path = require('path');
const PDFLib = require('../lib/pdf-lib.min.js');
const fontkit = require('../lib/fontkit.umd.min.js');
const cinzelUri = require('../lib/cinzel-font.js');
const cinzelBoldUri = require('../lib/cinzel-bold-font.js');
const assets = require('../assets.js');
const core = require('../core.js');

const ROOT = path.join(__dirname, '..');
const out = path.join(ROOT, 'out');
if (!fs.existsSync(out)) fs.mkdirSync(out);

const seal = assets.find(a => a.key === 'psa-seal');

// The event from the office's real certificate, so the output can be compared
// against the scan side by side.
const batch = {
  certTitle: 'Certificate of Participation',
  event: 'Advancing CBMS through Statistical Standards and Classifications: '
    + 'Capacity Building on Statistical Survey Review and Clearance System and '
    + 'Philippine Standard Industrial Classification Revision 5',
  hours: '24',
  trainingType: 'foundational training',
  dateFrom: '2026-09-15',
  dateTo: '2026-09-17',
  location: 'PSA PSO Marinduque Training Room,\n2nd Floor, JRT 2 Building, Tampus, Boac, Marinduque',
  givenDate: '2026-09-17',
};

const people = [
  { name: 'Richard B. Calub' },
  { name: 'Ma. Cristina delos Reyes-Villanueva' },
  { name: 'Juan Paolo Santos', role: 'as Resource Speaker in the' },
  { name: 'Ana Marie L. Reyes' },
];

const common = {
  PDFLib,
  people,
  logoBytesList: [core.dataUriToBytes(seal.dataUri)],
  settings: {},
  fontkit,
  displayFontBytes: core.dataUriToBytes(cinzelUri),
  displayFontBoldBytes: core.dataUriToBytes(cinzelBoldUri),
};

const cases = [
  ['a4-portrait', { size: 'a4', orientation: 'portrait' }],
  ['a4-landscape', { size: 'a4', orientation: 'landscape' }],
  ['half-portrait-2up', { size: 'half', orientation: 'portrait', sheet: 'a4' }],
  ['half-landscape-2up', { size: 'half', orientation: 'landscape', sheet: 'a4' }],
  ['half-portrait-actual', { size: 'half', orientation: 'portrait', sheet: 'actual' }],
  ['a4-trajan-border', { size: 'a4', orientation: 'portrait', fontStyle: 'trajan', frame: 'border', accent: '#1b3a8f' }],
  ['a4-two-signatories', { size: 'a4', orientation: 'portrait' }, {
    sig2Enabled: true, sig2Name: 'LENI R. RIOFLORIDO',
    sig2Title: 'Regional Director', sig2Office: 'PSA RSSO MIMAROPA',
  }],
];

Promise.all(cases.map(([name, over, settings]) =>
  core.generatePdf(Object.assign({}, common, {
    batch: Object.assign({}, batch, over),
    settings: Object.assign({}, common.settings, settings || {}),
  })).then(bytes => {
    fs.writeFileSync(path.join(out, name + '.pdf'), bytes);
    console.log(name + '.pdf', (bytes.length / 1024).toFixed(0) + ' KB');
  })
)).catch(e => { console.error(e); process.exit(1); });
