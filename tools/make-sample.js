// Writes sample-participants.xlsx - the same shape the app's "Download Excel
// template" button produces, with enough rows to exercise the roster.
//   node tools/make-sample.js
const fs = require('fs');
const path = require('path');
const XLSX = require('../lib/xlsx.full.min.js');

const rows = [
  // Venue and Date / time are optional per-person overrides: a blank cell uses
  // whatever step 2 says, which is what nearly every row wants. The last two
  // people here were trained in another municipality on another day.
  ['Full Name', 'Role', 'Venue', 'Date / time'],
  ['Richard B. Calub', '', '', ''],
  ['Ma. Cristina delos Reyes-Villanueva', '', '', ''],
  ['Juan Paolo Santos', 'as Resource Speaker in the', '', ''],
  ['Ana Marie L. Reyes', '', '', ''],
  ['Jose R. Mercado Jr.', '', '', ''],
  ['Kristine Joy P. Lagman', '', '', ''],
  ['Benedict A. Solis', 'as Facilitator in the', '', ''],
  ['Maricel T. Obligado', '', '', ''],
  ['Elena V. Pastrana', '', 'Municipal Hall, Santa Cruz, Marinduque', 'on 22 September 2026, 8:00 AM to 5:00 PM'],
  ['Rodel M. Ignacio', '', 'Gasan Municipal Gymnasium', 'on 24 September 2026, 8:00 AM to 5:00 PM'],
];

const ws = XLSX.utils.aoa_to_sheet(rows);
ws['!cols'] = [{ wch: 34 }, { wch: 30 }, { wch: 34 }, { wch: 34 }];
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, 'Participants');
// XLSX.writeFile needs the browser build wired to fs; write the buffer instead.
const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
const out = path.join(__dirname, '..', 'sample-participants.xlsx');
fs.writeFileSync(out, buf);
console.log('wrote', path.basename(out) + ',', rows.length - 1, 'people');
