// PSA Certificate Generator - layout + PDF generation engine.
// Runs in the browser (script tag -> window.PSACert) and in Node (require),
// which is how the headless tests drive it.
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.PSACert = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MM = 72 / 25.4;

  // Certificate sizes. "half" is half an A4 sheet = A5.
  var SIZES = {
    a4: { w: 210, h: 297, label: 'A4', note: '210 x 297 mm' },
    half: { w: 148, h: 210, label: 'Half of A4 (A5)', note: '148 x 210 mm' },
  };

  // ---------------------------------------------------------------------------
  // Geometry
  //
  // A certificate can be A4 or A5, portrait or landscape - four very different
  // page shapes. Fixed fractions-of-the-page (what the ID generator uses for
  // its one fixed card) would distort badly between them, so everything here is
  // sized against `u`, the page's SHORTER side. A landscape A4 then gets the
  // same type sizes as a portrait A4, and an A5 gets the same design at ~70%,
  // which is what "the same certificate, smaller" should mean.
  // Vertical positions are not fixed at all: blocks are measured and flowed
  // (see buildFlow), so a four-line event title pushes the rest down and the
  // whole stack shrinks to fit if it has to.
  // ---------------------------------------------------------------------------
  var LAYOUT = {
    margin: 0.105,     // page margin, x and y, as a fraction of u
    textW: 0.85,       // max width of the centred text column (fraction of u)
    logoTop: 0.055,    // logo row sits closer to the edge than the text margin
    logoX: 0.060,
    logoH: 0.125,      // height of the logo row
    logoGap: 0.030,    // horizontal gap between logos
    logoBelow: 0.030,  // gap under the logo row before the text starts

    // Slack handling. When the blocks are shorter than the space available the
    // gaps grow (up to gapGrow x their natural size) so the certificate fills
    // its page instead of huddling in the middle; whatever slack is left after
    // that is split topBias above / the rest below, which keeps the block high
    // on the page the way the office's certificate sits.
    gapGrow: 0.45,
    topBias: 0.30,

    // Each block: size (fraction of u), gap above it, font role, line leading.
    preamble: { size: 0.0210, gap: 0.000, font: 'serif' },
    title: { size: 0.0672, gap: 0.028, font: 'display', fit: true, fitFloor: 0.62 },
    presented: { size: 0.0210, gap: 0.030, font: 'serif' },
    name: { size: 0.0560, gap: 0.024, font: 'displayName', lead: 1.20, fit: true, fitFloor: 0.72 },
    forLine: { size: 0.0210, gap: 0.030, font: 'serif', lead: 1.30 },
    event: { size: 0.0255, gap: 0.020, font: 'serif', lead: 1.32 },
    detail: { size: 0.0210, gap: 0.028, font: 'serif', lead: 1.32 },
    location: { size: 0.0210, gap: 0.026, font: 'serif', lead: 1.32 },
    given: { size: 0.0210, gap: 0.030, font: 'serif' },

    sigGap: 0.058,     // gap above the signature block
    sigImageH: 0.060,  // e-signature image height, sits on the rule
    sigRuleW: 0.300,   // minimum signature rule width
    sigName: { size: 0.0235, font: 'sigName' },
    sigTitle: { size: 0.0190, font: 'serif', lead: 1.30 },
    sigColGap: 0.060,  // gap between two signatories
  };

  // Wording. All of this is editable in the app - these are the defaults taken
  // from the office's existing certificate.
  var DEFAULT_BATCH = {
    size: 'a4',
    orientation: 'portrait',
    sheet: 'actual',        // 'actual' | 'a4' (two A5s imposed on one A4 sheet)
    frame: 'corners',       // 'corners' | 'border' | 'none'
    accent: '#333a4a',
    nameColor: '#000000',
    fontStyle: 'classic',   // 'classic' (Times) | 'trajan' (Cinzel headings)
    logos: ['PSA Seal', '', ''],
    sortNames: false,       // print A-Z rather than in the order the list came in
    preamble: 'This',
    certTitle: 'Certificate of Participation',
    presentedTo: 'is presented to',
    forLine: 'for actively participating in the',
    event: '',
    hours: '',
    trainingType: 'training',
    dateFrom: '',
    dateTo: '',
    location: '',
    givenDate: '',
    showPreamble: true,
    showPresented: true,
    showForLine: true,
    showDetail: true,
    showLocation: true,
    showGiven: true,
  };

  var DEFAULT_SETTINGS = {
    sig1Name: 'GEMMA N. OPIS',
    sig1Title: 'Chief Statistical Specialist',
    sig1Office: 'Provincial Statistical Office – Marinduque',
    sig2Enabled: false,
    sig2Name: '',
    sig2Title: '',
    sig2Office: '',
    sigEnabled: false,  // print the e-signature image; off = blank line to sign
  };

  var TITLE_PRESETS = [
    'Certificate of Participation',
    'Certificate of Appreciation',
    'Certificate of Recognition',
    'Certificate of Completion',
    'Certificate of Attendance',
    'Certificate of Training',
  ];

  // Wording that reads correctly under each title, so switching the title does
  // not leave "for actively participating in the" under a Certificate of
  // Appreciation.
  var FOR_LINES = {
    'Certificate of Participation': 'for actively participating in the',
    'Certificate of Appreciation': 'in grateful appreciation for the invaluable support extended to the',
    'Certificate of Recognition': 'in recognition of the outstanding contribution to the',
    'Certificate of Completion': 'for successfully completing the',
    'Certificate of Attendance': 'for attending the',
    'Certificate of Training': 'for successfully undergoing the',
  };

  var FIELDS = [
    { key: 'name', label: 'Full Name' },
    { key: 'role', label: 'Role (optional)' },
  ];

  var AUTO_RULES = {
    role: [/role|position|designation|capacity|remark/i, null],
    name: [/name|participant|attendee|employee/i, /role|position|event|venue/i],
  };

  // Which row holds the column headings.
  //
  // Assuming row 1 quietly cost the office a person every time: a sheet that
  // opens with a merged title ("Certificate Participants List") had that title
  // read as the headings - and because it contains the word "participants",
  // autoMap even matched it - so the real "Full Name" heading became the first
  // certificate. A hand-typed list with no headings at all lost its first name
  // the same way. So the heading row is found, not assumed.
  var HEADER_WORDS = /name|participant|attendee|employee|role|position|designation|signator/i;

  // A heading is a short label. A sentence across the top of the sheet is a
  // title, however many heading-ish words it happens to contain.
  function headerScore(row) {
    var n = 0;
    (row || []).forEach(function (cell) {
      var s = String(cell == null ? '' : cell).trim();
      if (!s || s.length > 24) return;
      if (HEADER_WORDS.test(s)) n++;
    });
    return n;
  }

  // Returns { index, headers, hasHeader }. index is -1 when the sheet has no
  // headings at all, in which case every row is a person and the columns get
  // generic labels so the mapping table still works.
  // Only the top of the sheet is searched, and on a tie the LAST row wins: a
  // title sits above the headings, never below them.
  function findHeaderRow(rows, limit) {
    var max = Math.min((rows || []).length, limit || 5);
    var best = -1, bestScore = 0;
    for (var i = 0; i < max; i++) {
      var s = headerScore(rows[i]);
      if (s && s >= bestScore) { bestScore = s; best = i; }
    }
    if (best < 0) {
      var width = 0;
      (rows || []).forEach(function (r) { width = Math.max(width, (r || []).length); });
      var generic = [];
      for (var k = 0; k < width; k++) generic.push('Column ' + (k + 1));
      return { index: -1, headers: generic, hasHeader: false };
    }
    return {
      index: best,
      headers: (rows[best] || []).map(function (h) { return String(h == null ? '' : h).trim(); }),
      hasHeader: true,
    };
  }

  // SheetJS never refuses a file. Handed a PDF, a Word document or a photo it
  // falls back to reading the raw bytes as delimited text and hands back
  // "rows", which used to fill the roster with binary gibberish and cheerfully
  // print certificates for it. Control characters are the giveaway.
  function looksBinary(rows) {
    var ctrl = 0, chars = 0;
    (rows || []).slice(0, 10).forEach(function (r) {
      (r || []).forEach(function (cell) {
        var s = String(cell == null ? '' : cell);
        chars += s.length;
        for (var i = 0; i < s.length; i++) {
          var code = s.charCodeAt(i);
          // tab, newline and carriage return are the only controls a real cell
          // has any business holding; U+FFFD means bytes that decoded to junk.
          if ((code < 32 && code !== 9 && code !== 10 && code !== 13) || code === 0xfffd) ctrl++;
        }
      });
    });
    return chars > 0 && ctrl / chars > 0.02;
  }

  function autoMap(headers) {
    var map = {}, used = {};
    ['role', 'name'].forEach(function (key) {
      var rule = AUTO_RULES[key];
      for (var i = 0; i < headers.length; i++) {
        var h = String(headers[i] || '');
        if (used[i] || !h) continue;
        if (rule[0].test(h) && !(rule[1] && rule[1].test(h))) { map[key] = i; used[i] = true; break; }
      }
    });
    // A one-column sheet of nothing but names still has to work.
    if (map.name == null && headers.length) map.name = 0;
    return map;
  }

  // ---------------------------------------------------------------------------
  // Small helpers
  // ---------------------------------------------------------------------------
  function dataUriToBytes(uri) {
    var s = String(uri || '');
    var b64 = s.slice(s.indexOf(',') + 1);
    if (typeof atob === 'function') {
      var bin = atob(b64);
      var out = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    }
    return new Uint8Array(Buffer.from(b64, 'base64'));
  }

  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];

  function parseISO(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
    return m ? { y: +m[1], m: +m[2], d: +m[3] } : null;
  }

  function ordinalSuffix(n) {
    var v = n % 100;
    if (v >= 11 && v <= 13) return 'th';
    return ['th', 'st', 'nd', 'rd'][n % 10] || 'th';
  }

  // '2026-09-15' + '2026-09-17' -> 'from 15 to 17 September 2026'
  // Collapses to 'on 17 September 2026' for a single day, and opens up to the
  // full form when the range crosses a month or a year.
  function formatDateRange(fromISO, toISO) {
    var a = parseISO(fromISO), b = parseISO(toISO);
    if (!a && !b) return '';
    if (!a) a = b;
    if (!b) b = a;
    if (a.y > b.y || (a.y === b.y && (a.m > b.m || (a.m === b.m && a.d > b.d)))) {
      var t = a; a = b; b = t;
    }
    function day(x) { return x.d + ' ' + MONTHS[x.m - 1] + ' ' + x.y; }
    if (a.y === b.y && a.m === b.m && a.d === b.d) return 'on ' + day(a);
    if (a.y === b.y && a.m === b.m) return 'from ' + a.d + ' to ' + b.d + ' ' + MONTHS[a.m - 1] + ' ' + a.y;
    if (a.y === b.y) return 'from ' + a.d + ' ' + MONTHS[a.m - 1] + ' to ' + day(b);
    return 'from ' + day(a) + ' to ' + day(b);
  }

  // 'Given this 17th day of September 2026.' as runs, so the ordinal suffix can
  // be drawn raised and smaller the way the office's certificate has it.
  function givenRuns(iso) {
    var d = parseISO(iso);
    if (!d) return null;
    return [
      { t: 'Given this ' },
      { t: String(d.d) },
      { t: ordinalSuffix(d.d), sup: true },
      { t: ' day of ' + MONTHS[d.m - 1] + ' ' + d.y + '.' },
    ];
  }

  // 'for 24 hours of foundational training'; degrades sensibly when either
  // half is blank.
  function hoursLine(hours, type) {
    var h = String(hours == null ? '' : hours).trim();
    var t = String(type || '').trim();
    var unit = h === '1' ? 'hour' : 'hours';
    if (h && t) return 'for ' + h + ' ' + unit + ' of ' + t;
    if (h) return 'for ' + h + ' ' + unit + ' of training';
    if (t) return 'for the ' + t;
    return '';
  }

  function hexToRgbArr(hex, fallback) {
    var m = /^#?([0-9a-fA-F]{6})$/.exec(String(hex || ''));
    if (!m) return fallback || [0, 0, 0];
    var n = parseInt(m[1], 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }

  function mixWhite(arr, amount) {
    return arr.map(function (c) { return c + (1 - c) * amount; });
  }

  // Certificate size in points.
  function certDims(size, orientation) {
    var s = SIZES[size] || SIZES.a4;
    var w = s.w, h = s.h;
    if (orientation === 'landscape') { var t = w; w = h; h = t; }
    return { w: w * MM, h: h * MM, wMm: w, hMm: h };
  }

  // Two A5s fit exactly on one A4 sheet: portrait A5s side by side on A4
  // landscape, landscape A5s stacked on A4 portrait. Only offered for the half
  // size - most offices only stock A4 paper, so this is how an A5 certificate
  // actually gets printed and then cut.
  function sheetPlan(batch) {
    var cert = certDims(batch.size, batch.orientation);
    var twoUp = batch.size === 'half' && batch.sheet === 'a4';
    if (!twoUp) return { cert: cert, page: { w: cert.w, h: cert.h }, perSheet: 1, twoUp: false };
    var stacked = batch.orientation === 'landscape';
    var page = stacked ? { w: 210 * MM, h: 297 * MM } : { w: 297 * MM, h: 210 * MM };
    return { cert: cert, page: page, perSheet: 2, twoUp: true, stacked: stacked };
  }

  // ---------------------------------------------------------------------------
  // PDF generation
  //
  //  opts = {
  //    PDFLib, people: [{ name, role }], batch, settings,
  //    logoBytesList: [Uint8Array, ...],        // resolved by the caller
  //    sigImageBytes, sig2ImageBytes,           // or null
  //    fontkit, displayFontBytes, displayFontBoldBytes   // Cinzel, optional
  //  }
  // ---------------------------------------------------------------------------
  async function generatePdf(opts) {
    var PDFLib = opts.PDFLib;
    var rgb = PDFLib.rgb;
    var batch = Object.assign({}, DEFAULT_BATCH, opts.batch || {});
    var settings = Object.assign({}, DEFAULT_SETTINGS, opts.settings || {});
    var people = (opts.people || []).filter(function (p) { return p && String(p.name || '').trim(); });

    var doc = await PDFLib.PDFDocument.create();
    doc.setTitle(batch.certTitle || 'Certificate');
    doc.setSubject(batch.event || '');

    var F = {
      serif: await doc.embedFont(PDFLib.StandardFonts.TimesRoman),
      serifBold: await doc.embedFont(PDFLib.StandardFonts.TimesRomanBold),
      serifItalic: await doc.embedFont(PDFLib.StandardFonts.TimesRomanItalic),
    };
    // Cinzel: an open Trajan-style face, the same one the ID card header uses.
    // Optional - without it the 'trajan' style falls back to Times bold.
    var cinzel = null, cinzelBold = null;
    if (opts.fontkit && opts.displayFontBytes && opts.displayFontBytes.length) {
      doc.registerFontkit(opts.fontkit);
      cinzel = await doc.embedFont(opts.displayFontBytes, { subset: true });
      if (opts.displayFontBoldBytes && opts.displayFontBoldBytes.length) {
        cinzelBold = await doc.embedFont(opts.displayFontBoldBytes, { subset: true });
      }
    }
    var trajan = batch.fontStyle === 'trajan' && !!cinzel;
    F.display = trajan ? (cinzelBold || cinzel) : F.serifBold;      // certificate title
    F.displayName = trajan ? (cinzelBold || cinzel) : F.serifBold;  // recipient name
    F.sigName = trajan ? (cinzelBold || cinzel) : F.serifBold;

    async function embedImage(bytes) {
      if (!bytes || !bytes.length) return null;
      if (bytes[0] === 0xff && bytes[1] === 0xd8) return doc.embedJpg(bytes);
      return doc.embedPng(bytes);
    }
    var logoImgs = [];
    var srcLogos = opts.logoBytesList || [];
    for (var li = 0; li < srcLogos.length; li++) {
      var im = await embedImage(srcLogos[li]);
      if (im) logoImgs.push(im);
    }
    var sigImg = settings.sigEnabled ? await embedImage(opts.sigImageBytes) : null;
    var sig2Img = settings.sigEnabled ? await embedImage(opts.sig2ImageBytes) : null;

    var BLACK = rgb(0, 0, 0);
    var WHITE = rgb(1, 1, 1);
    var accentArr = hexToRgbArr(batch.accent, hexToRgbArr(DEFAULT_BATCH.accent));
    function toColor(arr) { return rgb(arr[0], arr[1], arr[2]); }
    var TONE = {
      dark: toColor(accentArr),
      mid: toColor(mixWhite(accentArr, 0.28)),
      light: toColor(mixWhite(accentArr, 0.86)),
    };
    var NAME_COLOR = toColor(hexToRgbArr(batch.nameColor, [0, 0, 0]));

    var plan = sheetPlan(batch);
    var CW = plan.cert.w, CH = plan.cert.h;
    var U = Math.min(CW, CH);                // the scale unit: the shorter side
    var MARGIN = LAYOUT.margin * U;
    var TEXTW = Math.min(CW - 2 * MARGIN, LAYOUT.textW * U);

    // -------------------------------------------------------------------------
    // Text measuring / wrapping. Explicit newlines are honoured so the user can
    // force a break in a venue or event title; everything else wraps.
    // -------------------------------------------------------------------------
    function wrapText(str, font, size, maxW) {
      var out = [];
      String(str).split(/\r?\n/).forEach(function (para) {
        var words = para.split(/\s+/).filter(Boolean);
        if (!words.length) { out.push(''); return; }
        var cur = '';
        words.forEach(function (word) {
          var probe = cur ? cur + ' ' + word : word;
          if (font.widthOfTextAtSize(probe, size) <= maxW || !cur) cur = probe;
          else { out.push(cur); cur = word; }
        });
        if (cur) out.push(cur);
      });
      return out;
    }

    function runsWidth(runs, font, size) {
      var w = 0;
      runs.forEach(function (r) { w += font.widthOfTextAtSize(r.t, r.sup ? size * 0.62 : size); });
      return w;
    }

    // -------------------------------------------------------------------------
    // The flow: measure every block at a given scale, stack them with their
    // gaps, and report the total height. drawCertificate shrinks the scale
    // until the stack fits between the logo row and the bottom margin.
    // -------------------------------------------------------------------------
    function buildFlow(person, scale) {
      var items = [];
      var role = String((person && person.role) || '').trim();

      function push(spec, text, extra) {
        if (text == null || text === '') return;
        var size = spec.size * U * scale;
        var font = F[spec.font] || F.serif;
        var maxW = (extra && extra.maxW) || TEXTW;
        // The title and the name look wrong broken across two lines, so they
        // shrink to fit first and only wrap once they hit fitFloor. This also
        // absorbs the width difference between Times and Cinzel, which is wide
        // enough to wrap a title that fits comfortably in Times.
        if (spec.fit && String(text).indexOf('\n') < 0) {
          var floor = size * (spec.fitFloor || 0.70);
          while (size > floor && font.widthOfTextAtSize(String(text), size) > maxW) size -= 0.3;
        }
        var lines = wrapText(text, font, size, maxW);
        // Wrapping cannot break a single word that is wider than the column -
        // a long hyphenless venue or event token used to run out from under the
        // text column and across the corner artwork - so shrink until it fits.
        // Each pass re-wraps, because a smaller size regroups the words; the
        // floor keeps a pathological string from disappearing altogether.
        var sizeFloor = size * 0.45;
        for (var pass = 0; pass < 4 && size > sizeFloor; pass++) {
          var widest = 0;
          for (var li = 0; li < lines.length; li++) {
            widest = Math.max(widest, font.widthOfTextAtSize(lines[li], size));
          }
          if (widest <= maxW) break;
          size = Math.max(sizeFloor, size * (maxW / widest) * 0.98);
          lines = wrapText(text, font, size, maxW);
        }
        var o = Object.assign({
          kind: 'text', size: size, font: font, lead: spec.lead || 1.15,
          gap: spec.gap * U * scale, color: BLACK,
        }, extra || {});
        o.size = size;
        o.lines = lines;
        o.height = o.lines.length * size * o.lead;
        items.push(o);
      }

      if (batch.showPreamble) push(LAYOUT.preamble, batch.preamble);
      push(LAYOUT.title, batch.certTitle);
      if (batch.showPresented) push(LAYOUT.presented, batch.presentedTo);
      push(LAYOUT.name, person ? person.name : '', { color: NAME_COLOR });
      // A person's own role ("as Resource Speaker") replaces the batch line, so
      // speakers and participants can come out of one run.
      if (batch.showForLine) push(LAYOUT.forLine, role || batch.forLine);
      push(LAYOUT.event, batch.event);

      if (batch.showDetail) {
        var detail = [
          hoursLine(batch.hours, batch.trainingType),
          formatDateRange(batch.dateFrom, batch.dateTo),
        ].filter(Boolean).join('\n');
        push(LAYOUT.detail, detail);
      }
      if (batch.showLocation && String(batch.location || '').trim()) {
        push(LAYOUT.location, 'at ' + String(batch.location).trim());
      }
      if (batch.showGiven) {
        var runs = givenRuns(batch.givenDate);
        if (runs) {
          var gsize = LAYOUT.given.size * U * scale;
          items.push({
            kind: 'runs', runs: runs, size: gsize, font: F.serif,
            gap: LAYOUT.given.gap * U * scale, color: BLACK, height: gsize * 1.15,
          });
        }
      }

      // Signature block: one or two columns, measured as a unit.
      var sigs = [{
        name: settings.sig1Name, title: settings.sig1Title,
        office: settings.sig1Office, img: sigImg,
      }];
      if (settings.sig2Enabled && String(settings.sig2Name || '').trim()) {
        sigs.push({
          name: settings.sig2Name, title: settings.sig2Title,
          office: settings.sig2Office, img: sig2Img,
        });
      }
      sigs = sigs.filter(function (s) { return String(s.name || '').trim(); });
      if (sigs.length) {
        var nSize = LAYOUT.sigName.size * U * scale;
        var tSize = LAYOUT.sigTitle.size * U * scale;
        var colGap = LAYOUT.sigColGap * U * scale;
        var colW = sigs.length > 1 ? (TEXTW - colGap) / 2 : TEXTW;
        var imgH = LAYOUT.sigImageH * U * scale;
        var blocks = sigs.map(function (s) {
          var lines = [];
          [s.title, s.office].forEach(function (t) {
            if (String(t || '').trim()) {
              wrapText(t, F.serif, tSize, colW * 0.95).forEach(function (l) { lines.push(l); });
            }
          });
          return { sig: s, sub: lines };
        });
        var maxSub = 0;
        blocks.forEach(function (b) { maxSub = Math.max(maxSub, b.sub.length); });
        var anyImg = blocks.some(function (b) { return !!b.sig.img; });
        items.push({
          kind: 'sig', blocks: blocks, colW: colW, colGap: colGap,
          nSize: nSize, tSize: tSize, imgH: anyImg ? imgH : 0,
          gap: LAYOUT.sigGap * U * scale,
          ruleW: LAYOUT.sigRuleW * U * scale,
          height: (anyImg ? imgH : 0) + nSize * 1.30 + maxSub * tSize * LAYOUT.sigTitle.lead,
        });
      }

      var total = 0;
      items.forEach(function (it, i) { total += (i ? it.gap : 0) + it.height; });
      return { items: items, height: total };
    }

    // -------------------------------------------------------------------------
    // Drawing
    // -------------------------------------------------------------------------
    // Decorative corner artwork, drawn as vectors so it stays crisp and keeps
    // its proportions at any size or orientation. Coordinates are in "u" units
    // measured in from the corner each shape hangs off, in a top-down space
    // whose origin is the certificate's top-left corner (drawSvgPath's +y runs
    // down, which is why the origin is the TOP-left and not pdf-lib's usual
    // bottom-left).
    function drawFrame(page, ox, oyTop) {
      if (batch.frame === 'none') return;
      var oy = page.getHeight() - oyTop;

      function poly(pts, color) {
        var d = pts.map(function (p, i) {
          return (i ? 'L ' : 'M ') + p[0].toFixed(2) + ' ' + p[1].toFixed(2);
        }).join(' ') + ' Z';
        page.drawSvgPath(d, { x: ox, y: oy, color: color, borderWidth: 0 });
      }

      if (batch.frame === 'border') {
        var in1 = MARGIN * 0.55, in2 = in1 + U * 0.012;
        [[in1, 1.2, TONE.dark], [in2, 0.5, TONE.mid]].forEach(function (b) {
          page.drawRectangle({
            x: ox + b[0], y: page.getHeight() - oyTop - CH + b[0],
            width: CW - 2 * b[0], height: CH - 2 * b[0],
            borderColor: b[2], borderWidth: b[1],
          });
        });
        return;
      }

      // 'corners': the angular ribbon motif from the office's certificate - a
      // faceted mass at the top-right and bottom-left with smaller accents.
      // The white slivers are what separate the facets; the certificate ground
      // is white, so they are drawn in white over the dark shapes.
      // The depths are deliberately asymmetric: the top-right mass is the
      // dominant element and everything else is an accent, so the centred text
      // column always has clear white either side of it. The deepest shape
      // reaches 0.32u down the right edge, which stays above the first line of
      // text at every size (the text starts below the logo row at ~0.15 of the
      // page height, and the shapes taper away from the column's edges).
      var u = U;
      // top-right
      poly([[CW - 0.52 * u, 0], [CW, 0], [CW, 0.32 * u]], TONE.light);
      poly([[CW - 0.43 * u, 0], [CW, 0], [CW, 0.24 * u], [CW - 0.15 * u, 0.065 * u]], TONE.dark);
      poly([[CW - 0.335 * u, 0], [CW - 0.285 * u, 0], [CW, 0.215 * u], [CW, 0.163 * u]], WHITE);
      poly([[CW - 0.11 * u, 0.185 * u], [CW, 0.128 * u], [CW, 0.285 * u]], TONE.mid);
      // bottom-left
      poly([[0, CH - 0.30 * u], [0.33 * u, CH], [0, CH]], TONE.light);
      poly([[0, CH - 0.21 * u], [0.24 * u, CH], [0, CH]], TONE.dark);
      poly([[0, CH - 0.165 * u], [0, CH - 0.125 * u], [0.145 * u, CH], [0.085 * u, CH]], WHITE);
      // small wedge above the bottom-left mass
      poly([[0, CH - 0.375 * u], [0.065 * u, CH - 0.335 * u], [0, CH - 0.295 * u]], TONE.dark);
      // bottom-right
      poly([[CW - 0.245 * u, CH], [CW, CH - 0.17 * u], [CW, CH]], TONE.light);
      poly([[CW - 0.145 * u, CH], [CW, CH - 0.10 * u], [CW, CH]], TONE.dark);
    }

    function drawCertificate(page, ox, oyTop, person) {
      var PH = page.getHeight();
      // y() converts a top-down offset inside the certificate to page coords
      function y(dy) { return PH - oyTop - dy; }
      var cx = ox + CW / 2;

      page.drawRectangle({ x: ox, y: PH - oyTop - CH, width: CW, height: CH, color: WHITE });
      drawFrame(page, ox, oyTop);

      // logo row, top-left
      var logoBottom = LAYOUT.logoTop * U;
      if (logoImgs.length) {
        var lh = LAYOUT.logoH * U;
        var lx = ox + LAYOUT.logoX * U;
        logoImgs.forEach(function (im) {
          var w = im.width * (lh / im.height);
          page.drawImage(im, { x: lx, y: y(LAYOUT.logoTop * U + lh), width: w, height: lh });
          lx += w + LAYOUT.logoGap * U;
        });
        logoBottom = LAYOUT.logoTop * U + lh;
      }

      var top = logoBottom + LAYOUT.logoBelow * U;
      var bottom = CH - MARGIN;
      var avail = bottom - top;

      // Shrink until the stack fits. Wrapping changes as the size changes, so
      // this re-measures rather than scaling a single measurement.
      var scale = 1, flow = buildFlow(person, scale);
      while (flow.height > avail && scale > 0.45) {
        scale -= 0.02;
        flow = buildFlow(person, scale);
      }

      // Spend leftover room on the gaps first (up to gapGrow x), then place
      // what remains mostly below the block - see LAYOUT.gapGrow / topBias.
      var slack = Math.max(0, avail - flow.height);
      if (slack > 0) {
        var gapSum = 0;
        flow.items.forEach(function (it, i) { if (i) gapSum += it.gap; });
        if (gapSum > 0) {
          var grow = Math.min(slack, gapSum * LAYOUT.gapGrow);
          var factor = (gapSum + grow) / gapSum;
          flow.items.forEach(function (it, i) { if (i) it.gap *= factor; });
          slack -= grow;
        }
      }
      var cursor = top + slack * LAYOUT.topBias;

      flow.items.forEach(function (it, i) {
        if (i) cursor += it.gap;
        if (it.kind === 'text') {
          it.lines.forEach(function (line, k) {
            if (!line) return;
            var w = it.font.widthOfTextAtSize(line, it.size);
            page.drawText(line, {
              x: cx - w / 2,
              y: y(cursor + it.size * 0.80 + k * it.size * it.lead),
              size: it.size, font: it.font, color: it.color,
            });
          });
        } else if (it.kind === 'runs') {
          var rx = cx - runsWidth(it.runs, it.font, it.size) / 2;
          var by = y(cursor + it.size * 0.80);
          it.runs.forEach(function (r) {
            var rs = r.sup ? it.size * 0.62 : it.size;
            page.drawText(r.t, {
              x: rx, y: r.sup ? by + it.size * 0.40 : by,
              size: rs, font: it.font, color: it.color,
            });
            rx += it.font.widthOfTextAtSize(r.t, rs);
          });
        } else if (it.kind === 'sig') {
          var n = it.blocks.length;
          var totalW = n > 1 ? it.colW * 2 + it.colGap : it.colW;
          var startX = cx - totalW / 2;
          it.blocks.forEach(function (b, ci) {
            var colCx = startX + ci * (it.colW + it.colGap) + it.colW / 2;
            var nameStr = String(b.sig.name || '');
            var nameY = cursor + it.imgH + it.nSize * 0.80;
            var nw = F.sigName.widthOfTextAtSize(nameStr, it.nSize);
            if (b.sig.img) {
              var iw = b.sig.img.width * (it.imgH / b.sig.img.height);
              page.drawImage(b.sig.img, {
                x: colCx - iw / 2, y: y(cursor + it.imgH), width: iw, height: it.imgH,
              });
            }
            // the typed name sits on the signature rule, as on the office form
            var ruleW = Math.min(Math.max(it.ruleW, nw * 1.25), it.colW);
            page.drawRectangle({
              x: colCx - ruleW / 2, y: y(nameY + it.nSize * 0.16),
              width: ruleW, height: 0.7, color: BLACK,
            });
            page.drawText(nameStr, {
              x: colCx - nw / 2, y: y(nameY), size: it.nSize, font: F.sigName, color: BLACK,
            });
            var sy = nameY + it.nSize * 0.50;
            b.sub.forEach(function (line, k) {
              var lw = F.serif.widthOfTextAtSize(line, it.tSize);
              page.drawText(line, {
                x: colCx - lw / 2,
                y: y(sy + it.tSize * 0.80 + k * it.tSize * LAYOUT.sigTitle.lead),
                size: it.tSize, font: F.serif, color: BLACK,
              });
            });
          });
        }
        cursor += it.height;
      });
    }

    // -------------------------------------------------------------------------
    // Paging
    // -------------------------------------------------------------------------
    if (!people.length) people = [{ name: '' }];
    var per = plan.perSheet;
    for (var i = 0; i < people.length; i += per) {
      var page = doc.addPage([plan.page.w, plan.page.h]);
      for (var slot = 0; slot < per && i + slot < people.length; slot++) {
        var ox = 0, oy = 0;
        if (plan.twoUp) {
          if (plan.stacked) {
            ox = (plan.page.w - CW) / 2;
            oy = (plan.page.h - 2 * CH) / 2 + slot * CH;
          } else {
            ox = (plan.page.w - 2 * CW) / 2 + slot * CW;
            oy = (plan.page.h - CH) / 2;
          }
        }
        drawCertificate(page, ox, oy, people[i + slot]);
      }
      if (plan.twoUp) {
        // faint cut line down the middle of the sheet
        var g = rgb(0.72, 0.72, 0.72);
        var cut = plan.stacked
          ? { start: { x: 6, y: plan.page.h / 2 }, end: { x: plan.page.w - 6, y: plan.page.h / 2 } }
          : { start: { x: plan.page.w / 2, y: 6 }, end: { x: plan.page.w / 2, y: plan.page.h - 6 } };
        page.drawLine({ start: cut.start, end: cut.end, thickness: 0.4, color: g, dashArray: [3, 3] });
      }
    }

    return doc.save();
  }

  return {
    MM: MM,
    SIZES: SIZES,
    LAYOUT: LAYOUT,
    FIELDS: FIELDS,
    TITLE_PRESETS: TITLE_PRESETS,
    FOR_LINES: FOR_LINES,
    DEFAULT_BATCH: DEFAULT_BATCH,
    DEFAULT_SETTINGS: DEFAULT_SETTINGS,
    autoMap: autoMap,
    findHeaderRow: findHeaderRow,
    looksBinary: looksBinary,
    dataUriToBytes: dataUriToBytes,
    formatDateRange: formatDateRange,
    hoursLine: hoursLine,
    ordinalSuffix: ordinalSuffix,
    certDims: certDims,
    sheetPlan: sheetPlan,
    generatePdf: generatePdf,
  };
});
