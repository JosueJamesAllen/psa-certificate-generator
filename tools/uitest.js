// Builds _uitest.html: index.html plus the headless driver (uitest-driver.js).
// Kept out of index.html so the shipped app carries no test code.
//   node tools/uitest.js
//   msedge --headless=new --dump-dom file:///.../_uitest.html
// (see the verify loop in CLAUDE.md for the full command)
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const inject = '<pre id="diag" style="position:fixed;left:0;bottom:0;z-index:9999;'
  + 'background:#000;color:#0f0;font:12px monospace;padding:6px"></pre>\n'
  + '<script src="tools/uitest-driver.js"></script>\n';
fs.writeFileSync(path.join(ROOT, '_uitest.html'), html.replace('</body>', inject + '</body>'));
console.log('_uitest.html written');
