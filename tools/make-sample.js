// Writes sample-participants.xlsx - the same shape the app's "Download Excel
// template" button produces, with enough rows to exercise the roster.
//   node tools/make-sample.js
const fs = require('fs');
const path = require('path');
const XLSX = require('../lib/xlsx.full.min.js');

const rows = [
  ['Full Name', 'Role'],
  ['Richard B. Calub', ''],
  ['Ma. Cristina delos Reyes-Villanueva', ''],
  ['Juan Paolo Santos', 'as Resource Speaker in the'],
  ['Ana Marie L. Reyes', ''],
  ['Jose R. Mercado Jr.', ''],
  ['Kristine Joy P. Lagman', ''],
  ['Benedict A. Solis', 'as Facilitator in the'],
  ['Maricel T. Obligado', ''],
];

const ws = XLSX.utils.aoa_to_sheet(rows);
ws['!cols'] = [{ wch: 34 }, { wch: 30 }];
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, 'Participants');
// XLSX.writeFile needs the browser build wired to fs; write the buffer instead.
const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
const out = path.join(__dirname, '..', 'sample-participants.xlsx');
fs.writeFileSync(out, buf);
console.log('wrote', path.basename(out) + ',', rows.length - 1, 'people');
