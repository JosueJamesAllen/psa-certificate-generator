// PSA Certificate Generator - UI layer.
// Talks to core.js (the engine) and keeps everything on this machine:
// settings, the certificate details and the logo library all in localStorage
// (see the logo library section below for why it is not IndexedDB).
// No network, no server - it runs from file://.
(function () {
  'use strict';

  var core = window.PSACert;
  var SETTINGS_KEY = 'psa-cert-settings';
  var BATCH_KEY = 'psa-cert-batch';
  var MAPPING_KEY = 'psa-cert-map:';
  var LOGOS_KEY = 'psa-cert-logos';
  var MANUAL_KEY = 'psa-cert-people';
  var BACKUP_VERSION = 1;

  function $(id) { return document.getElementById(id); }

  var settings = {};
  var batch = {};
  var logos = [];              // [{ name, dataUri, bundled? }] - see refreshLogos
  var workbook = null;
  var headers = [];
  var mapping = {};
  var excelPeople = [];        // from the sheet
  var manualPeople = [];       // typed in by hand - persisted, see loadManual
  var rosterRows = [];         // [{ tr, person, flag }] for in-place warning updates
  var pdfUrl = null;
  var pdfBytes = null;
  var regenTimer = null;
  var busy = false;
  var regenPending = false;    // a change arrived mid-generation - see generate()
  var statusIsError = false;
  var toastTimer = null;

  // ---------- loading the big libraries ----------
  // index.html used to pull in 2.8 MB of script before app.js ran, and until all
  // of it had parsed the page was dead - nothing typed, nothing clicked. Most of
  // that weight is not needed to show the form: SheetJS only matters once there
  // is a spreadsheet, pdf-lib only once there is someone to make a certificate
  // for, and Cinzel only if the Trajan lettering is picked at all.
  //
  // Injected <script> tags, not fetch(): on a file:// origin fetch and XHR are
  // blocked for local files, but a script tag loads one perfectly well. That is
  // the same reason the artwork is base64 in assets.js.
  var scriptLoads = {};
  function loadScript(src) {
    if (scriptLoads[src]) return scriptLoads[src];
    scriptLoads[src] = new Promise(function (res, rej) {
      var s = document.createElement('script');
      s.src = src;
      s.onload = function () { res(); };
      s.onerror = function () {
        delete scriptLoads[src];        // so a later attempt can try again
        rej(new Error('could not load ' + src));
      };
      document.head.appendChild(s);
    });
    return scriptLoads[src];
  }

  function ensureXlsx() {
    if (typeof XLSX !== 'undefined') return Promise.resolve();
    return loadScript('lib/xlsx.full.min.js');
  }
  function ensurePdfLib() {
    if (typeof PDFLib !== 'undefined') return Promise.resolve();
    return loadScript('lib/pdf-lib.min.js');
  }
  // The engine falls back to Times bold when the Cinzel bytes are missing, so
  // fonts that will not load cost the lettering, not the batch.
  function ensureTrajan() {
    if (window.fontkit && typeof PSA_FONT_CINZEL !== 'undefined') return Promise.resolve();
    return Promise.all([
      loadScript('lib/fontkit.umd.min.js'),
      loadScript('lib/cinzel-font.js'),
      loadScript('lib/cinzel-bold-font.js'),
    ]).catch(function () {
      setStatus('The Trajan lettering could not be loaded — printing in the classic serif.', 'error');
    });
  }

  // Start the two that nearly every session needs as soon as the form is up, so
  // they are in hand by the time they are wanted without having held up the
  // page. Cinzel is left out on purpose - most batches never ask for it.
  function warmUp() {
    ensurePdfLib().catch(function () { });
    ensureXlsx().catch(function () { });
  }

  // ---------- persistence ----------
  function todayISO() {
    var d = new Date();
    function p(n) { return (n < 10 ? '0' : '') + n; }
    // built by hand, not toISOString(), which is UTC and lands on yesterday
    // for most of the working day in Manila
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  function loadBatch() {
    var raw = null;
    try { raw = localStorage.getItem(BATCH_KEY); } catch (e) { }
    var saved = {};
    try { saved = JSON.parse(raw) || {}; } catch (e) { }
    batch = normalizeBatch(saved);
    // First run only: of all the fields this is the one with an obvious right
    // answer, and left blank it silently drops the "Given this…" line. A saved
    // batch is left alone - that date is the user's, however old it looks.
    if (!raw && !batch.givenDate) batch.givenDate = todayISO();
  }

  // The people typed in by hand are the only thing that used to evaporate on a
  // reload - the details, the settings, the logos and the column mappings all
  // survive one. Twenty names retyped is twenty names retyped.
  function loadManual() {
    var saved = [];
    try { saved = JSON.parse(localStorage.getItem(MANUAL_KEY)) || []; } catch (e) { }
    manualPeople = (Array.isArray(saved) ? saved : []).map(function (p) {
      return {
        name: String((p && p.name) || ''),
        role: String((p && p.role) || ''),
        include: p ? p.include !== false : true,
        manual: true,
      };
    });
  }
  function saveManual() {
    try {
      localStorage.setItem(MANUAL_KEY, JSON.stringify(manualPeople.map(function (p) {
        return { name: p.name, role: p.role, include: p.include };
      })));
    } catch (e) { }
  }
  // Object.assign copies the logos ARRAY by reference, so without this the app
  // would mutate core.DEFAULT_BATCH.logos as the user picks logos.
  function normalizeBatch(saved) {
    var b = Object.assign({}, core.DEFAULT_BATCH, saved || {});
    var src = (saved && saved.logos) || core.DEFAULT_BATCH.logos;
    b.logos = [0, 1, 2].map(function (i) { return String(src[i] || ''); });
    return b;
  }
  function saveBatch() {
    try { localStorage.setItem(BATCH_KEY, JSON.stringify(batch)); } catch (e) { }
  }
  function loadSettings() {
    var saved = {};
    try { saved = JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}; } catch (e) { }
    settings = Object.assign({}, core.DEFAULT_SETTINGS, saved);
  }
  function saveSettingsToStorage() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) {
      setStatus('Could not save settings - this browser’s storage is full.', 'error');
    }
  }

  // ---------- images ----------
  // Big logo files make every regeneration crawl and fill up storage, so
  // anything imported is redrawn onto a canvas at a sane size first.
  function shrinkImage(dataUri, maxPx) {
    return new Promise(function (res) {
      var im = new Image();
      im.onload = function () {
        var big = Math.max(im.width, im.height);
        if (!big || big <= maxPx) return res(dataUri);
        var s = maxPx / big;
        var c = document.createElement('canvas');
        c.width = Math.round(im.width * s);
        c.height = Math.round(im.height * s);
        c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
        try { res(c.toDataURL('image/png')); } catch (e) { res(dataUri); }
      };
      im.onerror = function () { res(dataUri); };
      im.src = dataUri;
    });
  }
  function readFileAsDataUri(file) {
    return new Promise(function (res, rej) {
      var fr = new FileReader();
      fr.onload = function () { res(fr.result); };
      fr.onerror = function () { rej(fr.error); };
      fr.readAsDataURL(file);
    });
  }

  // ---------- logo library ----------
  // Deliberately NOT IndexedDB. This app's whole point is being opened by
  // double-clicking index.html, and on a file:// origin indexedDB.open() never
  // completes in Edge/Chrome - no success, no error, the request just sits at
  // "pending" forever, so even a .catch() fallback never runs and the logo list
  // stays empty. localStorage works fine on file://, so the library is:
  //   bundled artwork (assets.js, always present) + user uploads (localStorage)
  // Uploads are shrunk to 700 px first, which keeps them well inside the ~5 MB
  // localStorage budget.
  function bundledLogos() {
    if (typeof PSA_ASSETS === 'undefined') return [];
    return PSA_ASSETS.map(function (a) {
      return { name: a.name, dataUri: a.dataUri, bundled: true };
    });
  }
  function userLogos() {
    try { return JSON.parse(localStorage.getItem(LOGOS_KEY)) || []; } catch (e) { return []; }
  }
  function saveUserLogos(list) {
    try {
      localStorage.setItem(LOGOS_KEY, JSON.stringify(list));
      return true;
    } catch (e) {
      setStatus('There is no room left in this browser’s storage for another logo. '
        + 'Delete one you no longer use and try again.', 'error');
      return false;
    }
  }
  // An upload that shares a bundled logo's name is swallowed by the de-duplication
  // in refreshLogos - bundled artwork wins - so it would be stored, invisible,
  // quietly eating storage, while the slot showed the bundled image instead. Give
  // it a number rather than let it disappear. Re-using another UPLOAD's name is
  // left alone: that is how you replace a logo with a better scan of it.
  function uniqueLogoName(name) {
    var base = String(name || '').trim() || 'Logo';
    var clash = bundledLogos().some(function (l) { return l.name === base; });
    if (!clash) return base;
    for (var n = 2; n < 100; n++) {
      if (!logoByName(base + ' (' + n + ')')) return base + ' (' + n + ')';
    }
    return base + ' (new)';
  }

  function putLogo(logo) {
    var list = userLogos().filter(function (l) { return l.name !== logo.name; });
    list.push({ name: logo.name, dataUri: logo.dataUri });
    return saveUserLogos(list);
  }
  function delLogo(name) {
    return saveUserLogos(userLogos().filter(function (l) { return l.name !== name; }));
  }

  function refreshLogos() {
    var seen = {};
    logos = bundledLogos().concat(userLogos()).filter(function (l) {
      if (!l || !l.name || seen[l.name]) return false;
      seen[l.name] = true;
      return true;
    }).sort(function (a, b) { return a.name.localeCompare(b.name); });
    renderLogoSlots();
  }

  function logoByName(name) {
    for (var i = 0; i < logos.length; i++) if (logos[i].name === name) return logos[i];
    return null;
  }

  function renderLogoSlots() {
    var slots = document.querySelectorAll('.logoslot');
    Array.prototype.forEach.call(slots, function (slot) {
      var i = +slot.getAttribute('data-slot');
      var sel = slot.querySelector('select');
      var img = slot.querySelector('.logothumb');
      var want = batch.logos[i] || '';
      sel.innerHTML = '';
      var none = document.createElement('option');
      none.value = '';
      none.textContent = i === 0 ? '— no logo —' : '— none —';
      sel.appendChild(none);
      logos.forEach(function (l) {
        var o = document.createElement('option');
        o.value = l.name;
        o.textContent = l.name;
        sel.appendChild(o);
      });
      sel.value = logoByName(want) ? want : '';
      // Only forget a chosen logo once we actually know the library is loaded -
      // otherwise an empty library would quietly wipe the user's picks.
      if (logos.length) batch.logos[i] = sel.value;
      var logo = logoByName(sel.value);
      if (logo) { img.src = logo.dataUri; img.hidden = false; } else { img.hidden = true; }
      // bundled artwork ships with the app and cannot be deleted
      slot.querySelector('.dellogo').disabled = !logo || !!logo.bundled;
    });
  }

  // ---------- excel ----------
  // The drop zone bypasses the file input's accept filter, and SheetJS will
  // happily "read" anything at all (see core.looksBinary), so a file dragged in
  // by mistake has to be turned away by name first.
  var SHEET_EXT = /\.(xlsx|xlsm|xlsb|xls|csv|txt)$/i;

  function loadFile(file) {
    if (!SHEET_EXT.test(file.name || '')) {
      setStatus('“' + file.name + '” is not a spreadsheet. Use an Excel file '
        + '(.xlsx or .xls), or a .csv list of names.', 'error');
      return;
    }
    setStatus('Reading ' + file.name + '…');
    Promise.all([ensureXlsx(), file.arrayBuffer()]).then(function (got) {
      var buf = got[1];
      workbook = XLSX.read(new Uint8Array(buf), { type: 'array' });
      $('fileName').textContent = file.name;
      $('fileInfo').hidden = false;
      var sel = $('sheetSelect');
      sel.innerHTML = '';
      workbook.SheetNames.forEach(function (n) {
        var o = document.createElement('option');
        o.value = n; o.textContent = n;
        sel.appendChild(o);
      });
      sel.hidden = workbook.SheetNames.length < 2;
      readSheet(workbook.SheetNames[0]);
    }).catch(function (e) {
      setStatus('Could not read that file: ' + e.message, 'error');
    });
  }

  function readSheet(name) {
    var sheet = workbook.Sheets[name];
    var rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
    if (!rows.length) { setStatus('That sheet is empty.', 'error'); return; }
    // A file that slipped past the name check - an .xlsx that is really
    // something else - is caught here rather than becoming a roster of junk.
    if (core.looksBinary(rows)) {
      setStatus('That file could not be read as a list of names. Open it in Excel '
        + 'and save it as .xlsx, then try again.', 'error');
      return;
    }
    // Office sheets often open with a merged title above the real headings, and
    // a quickly typed list often has none at all. Both used to cost the first
    // person on the list, so the heading row is found rather than assumed.
    var head = core.findHeaderRow(rows);
    headers = head.headers;
    if (!headers.length) { setStatus('That sheet is empty.', 'error'); return; }
    var note = $('sheetNote');
    if (!head.hasHeader) {
      note.textContent = 'No column headings found — every row is treated as a person.';
    } else if (head.index > 0) {
      note.textContent = 'Column headings read from row ' + (head.index + 1) + ' — the '
        + (head.index === 1 ? 'row above was' : head.index + ' rows above were') + ' skipped.';
    } else {
      note.textContent = '';
    }
    var saved = null;
    try { saved = JSON.parse(localStorage.getItem(MAPPING_KEY + headers.join('|'))); } catch (e) { }
    mapping = saved || core.autoMap(headers);
    excelPeople = rows.slice(head.index + 1)
      .filter(function (r) { return r.some(function (v) { return String(v).trim(); }); })
      .map(function (r) {
        return {
          name: mapping.name != null ? String(r[mapping.name] || '').trim() : '',
          role: mapping.role != null ? String(r[mapping.role] || '').trim() : '',
          include: true,
        };
      });
    $('rowCount').textContent = excelPeople.length + ' row' + (excelPeople.length === 1 ? '' : 's');
    if (!excelPeople.length) {
      setStatus('No names found in that sheet — check which column holds the full names.', 'error');
    }
    renderMapping();
    renderRoster();
    scheduleRegen();
  }

  function renderMapping() {
    var t = $('mappingTable');
    t.innerHTML = '';
    t.hidden = !headers.length;
    if (!headers.length) return;
    core.FIELDS.forEach(function (f) {
      var tr = document.createElement('tr');
      var td1 = document.createElement('td');
      td1.textContent = f.label;
      var td2 = document.createElement('td');
      var sel = document.createElement('select');
      var none = document.createElement('option');
      none.value = ''; none.textContent = '— not used —';
      sel.appendChild(none);
      headers.forEach(function (h, i) {
        var o = document.createElement('option');
        o.value = String(i);
        o.textContent = h || ('Column ' + (i + 1));
        sel.appendChild(o);
      });
      sel.value = mapping[f.key] != null ? String(mapping[f.key]) : '';
      if (f.key === 'name' && sel.value === '') sel.className = 'unmapped';
      sel.onchange = function () {
        if (sel.value === '') delete mapping[f.key];
        else mapping[f.key] = +sel.value;
        try {
          localStorage.setItem(MAPPING_KEY + headers.join('|'), JSON.stringify(mapping));
        } catch (e) { }
        readSheet($('sheetSelect').value || workbook.SheetNames[0]);
      };
      td2.appendChild(sel);
      tr.appendChild(td1);
      tr.appendChild(td2);
      t.appendChild(tr);
    });
  }

  function allPeople() { return excelPeople.concat(manualPeople); }
  // The roster order is the order the certificates come out in, so A-Z is a
  // property of the batch rather than of the table, and it is what both the
  // preview and the download use.
  function displayPeople() {
    var list = allPeople();
    if (!batch.sortNames) return list;
    return list.slice().sort(function (a, b) {
      return String(a.name || '').localeCompare(String(b.name || ''), 'en', { sensitivity: 'base' });
    });
  }
  function chosenPeople() {
    return displayPeople().filter(function (p) { return p.include && String(p.name || '').trim(); });
  }

  // Blank and duplicate names are re-flagged without rebuilding the table, so
  // that a cell being edited keeps the caret and the focus.
  function refreshWarnings() {
    var seen = {};
    rosterRows.forEach(function (r) {
      var k = String(r.person.name || '').trim().toLowerCase();
      if (k) seen[k] = (seen[k] || 0) + 1;
    });
    rosterRows.forEach(function (r) {
      var name = String(r.person.name || '').trim();
      var warn = '';
      if (!name) warn = 'No name — this row will be skipped';
      else if (seen[name.toLowerCase()] > 1) warn = 'This name appears more than once';
      r.tr.classList.toggle('warn', !!warn);
      r.flag.hidden = !warn;
      r.flag.title = warn;
    });
    var total = rosterRows.length;
    var ticked = chosenPeople().length;
    $('rosterCount').textContent = total === ticked
      ? total + (total === 1 ? ' person' : ' people')
      : ticked + ' of ' + total + ' ticked';
  }

  // A cell you can correct in place. Names arrive misspelled, and a misspelled
  // name is a certificate reprinted.
  function editableCell(person, key) {
    var td = document.createElement('td');
    td.className = 'edit';
    // plaintext-only keeps pasted formatting (and pasted markup) out; engines
    // that do not know the value reject it, so fall back to plain editing.
    td.contentEditable = 'plaintext-only';
    if (td.contentEditable !== 'plaintext-only') td.contentEditable = 'true';
    td.spellcheck = false;
    td.textContent = person[key] || '';
    td.title = person[key] || '';
    td.addEventListener('input', function () {
      // A pasted line break would wrap the name onto two lines on the
      // certificate, so all whitespace is collapsed on the way into the model.
      person[key] = td.textContent.replace(/\s+/g, ' ').trim();
      if (person.manual) saveManual();
      refreshWarnings();
      scheduleRegen();
    });
    td.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') { ev.preventDefault(); td.blur(); }
      else if (ev.key === 'Escape') { ev.preventDefault(); td.textContent = person[key] || ''; td.blur(); }
    });
    td.addEventListener('blur', function () { td.title = person[key] || ''; });
    return td;
  }

  function renderRoster() {
    var list = displayPeople();
    var t = $('rosterTable');
    rosterRows = [];
    $('rosterWrap').hidden = !list.length;
    $('rosterTools').hidden = !list.length;
    $('rosterHint').hidden = !list.length;
    t.innerHTML = '';
    if (!list.length) { updateGenerateState(); return; }

    var head = document.createElement('tr');
    ['', 'Name', 'Role', ''].forEach(function (h, i) {
      var th = document.createElement('th');
      if (i === 0) {
        var all = document.createElement('input');
        all.type = 'checkbox';
        all.checked = list.every(function (p) { return p.include; });
        all.title = 'Include everyone';
        all.onchange = function () {
          list.forEach(function (p) { p.include = all.checked; });
          saveManual();
          renderRoster();
          scheduleRegen();
        };
        th.appendChild(all);
      } else th.textContent = h;
      head.appendChild(th);
    });
    t.appendChild(head);

    list.forEach(function (p) {
      var tr = document.createElement('tr');

      var td0 = document.createElement('td');
      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = !!p.include;
      cb.onchange = function () {
        p.include = cb.checked;
        if (p.manual) saveManual();
        refreshWarnings();
        updateGenerateState();
        scheduleRegen();
      };
      td0.appendChild(cb);

      var td3 = document.createElement('td');
      td3.className = 'flag';
      var flag = document.createElement('span');
      flag.className = 'warnflag';
      flag.textContent = '⚠';
      flag.hidden = true;
      td3.appendChild(flag);
      // Rows that came out of the sheet are removed by unticking them or by
      // clearing the file; only hand-typed ones own their own delete.
      if (p.manual) {
        var del = document.createElement('button');
        del.className = 'rowdel';
        del.type = 'button';
        del.textContent = '✕';
        del.title = 'Remove';
        del.onclick = function () {
          var i = manualPeople.indexOf(p);
          if (i >= 0) manualPeople.splice(i, 1);
          saveManual();
          renderRoster();
          scheduleRegen();
        };
        td3.appendChild(del);
      }

      [td0, editableCell(p, 'name'), editableCell(p, 'role'), td3]
        .forEach(function (td) { tr.appendChild(td); });
      t.appendChild(tr);
      rosterRows.push({ tr: tr, person: p, flag: flag });
    });
    refreshWarnings();
    updateGenerateState();
  }

  // ---------- batch details <-> UI ----------
  var TEXT_FIELDS = ['certTitle', 'event', 'hours', 'trainingType', 'dateFrom', 'dateTo',
    'location', 'givenDate', 'preamble', 'presentedTo', 'forLine'];
  var EYES = [
    ['btnEyePreamble', 'showPreamble'],
    ['btnEyePresented', 'showPresented'],
    ['btnEyeForLine', 'showForLine'],
    ['btnEyeDetail', 'showDetail'],
    ['btnEyeLocation', 'showLocation'],
    ['btnEyeGiven', 'showGiven'],
  ];

  function applyBatchToUI() {
    TEXT_FIELDS.forEach(function (k) { if ($(k)) $(k).value = batch[k] == null ? '' : batch[k]; });
    $('accent').value = batch.accent;
    $('nameColor').value = batch.nameColor;
    setSegment('sizeMode', 'size', batch.size);
    setSegment('orientMode', 'orient', batch.orientation);
    setSegment('sheetMode', 'sheet', batch.sheet);
    setSegment('frameMode', 'frame', batch.frame);
    setSegment('fontMode', 'font', batch.fontStyle);
    EYES.forEach(function (e) { setEye($(e[0]), batch[e[1]]); });
    setSortButton();
    syncSheetField();
    renderPreviews();
  }

  function setSegment(wrapId, attr, value) {
    var wrap = $(wrapId);
    if (!wrap) return;
    Array.prototype.forEach.call(wrap.querySelectorAll('.seg'), function (b) {
      b.classList.toggle('on', b.getAttribute('data-' + attr) === value);
    });
  }

  function setSortButton() {
    var b = $('btnSortNames');
    b.classList.toggle('on', !!batch.sortNames);
    b.setAttribute('aria-pressed', batch.sortNames ? 'true' : 'false');
    b.title = batch.sortNames
      ? 'Printing in alphabetical order — click for the order they were added in'
      : 'Print the certificates in alphabetical order';
  }

  function setEye(btn, on) {
    if (!btn) return;
    btn.classList.toggle('off', !on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    var lbl = btn.querySelector('.eyelabel');
    if (lbl) lbl.textContent = on ? 'Shown' : 'Hidden';
    var field = btn.closest('.field');
    if (field) field.classList.toggle('dim', !on);
  }

  // A4 has no two-up option - two A4s do not fit on a sheet of A4.
  function syncSheetField() {
    var isHalf = batch.size === 'half';
    Array.prototype.forEach.call($('sheetMode').querySelectorAll('.seg'), function (b) {
      b.disabled = !isHalf;
    });
    if (!isHalf && batch.sheet !== 'actual') {
      batch.sheet = 'actual';
      setSegment('sheetMode', 'sheet', 'actual');
    }
    var plan = core.sheetPlan(batch);
    var cert = plan.cert;
    var hint;
    if (!isHalf) {
      hint = 'One certificate per A4 sheet, ' + cert.wMm + ' × ' + cert.hMm + ' mm.';
    } else if (batch.sheet === 'a4') {
      hint = 'Two certificates on one A4 sheet (' + (plan.stacked ? 'one above the other' : 'side by side')
        + '), with a dotted line to cut along.';
    } else {
      hint = 'One certificate per sheet of ' + cert.wMm + ' × ' + cert.hMm
        + ' mm paper. Most printers only hold A4 — pick “2 per A4 sheet” if yours does.';
    }
    $('sheetHint').textContent = hint;
  }

  function renderPreviews() {
    var d = core.hoursLine(batch.hours, batch.trainingType);
    var r = core.formatDateRange(batch.dateFrom, batch.dateTo);
    $('detailPreview').textContent = [d, r].filter(Boolean).join(' · ') || 'Nothing will print on this line yet.';
    var g = batch.givenDate ? new Date(batch.givenDate + 'T00:00:00') : null;
    if (g && !isNaN(g)) {
      var day = g.getDate();
      $('givenPreview').textContent = 'Prints as “Given this ' + day + core.ordinalSuffix(day)
        + ' day of ' + g.toLocaleString('en-US', { month: 'long' }) + ' ' + g.getFullYear() + '.”';
    } else {
      $('givenPreview').textContent = 'Pick a date to print the “Given this…” line.';
    }
  }

  // ---------- generating ----------
  // The status line lives at the bottom of step 3, so a message about the file
  // that was just dropped into step 1 is usually scrolled out of sight. Anything
  // that went wrong is therefore also shown as a toast at the top of the window.
  // An open <dialog> sits in the browser's top layer and would paint over a
  // toast attached to <body>, so the toast is attached to that dialog instead.
  function showToast(msg, cls) {
    var el = $('toast');
    var host = document.querySelector('dialog[open]') || document.body;
    if (el.parentNode !== host) host.appendChild(el);
    el.textContent = msg;
    el.className = 'toast' + (cls ? ' ' + cls : '');
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, cls === 'error' ? 9000 : 4000);
  }

  function setStatus(msg, cls, alsoToast) {
    var el = $('status');
    el.textContent = msg || '';
    el.className = 'hint' + (cls ? ' ' + cls : '');
    statusIsError = cls === 'error';
    if (msg && (cls === 'error' || alsoToast)) showToast(msg, cls);
  }

  function updateGenerateState() {
    var n = chosenPeople().length;
    var ok = n > 0 && !busy;
    $('btnGenerate').disabled = !ok;
    // Don't paper over the reason the list is empty - an unreadable file leaves
    // no names behind, and the error explaining why is the useful message.
    if (!n && !statusIsError) setStatus('Add at least one name to generate certificates.');
  }

  function scheduleRegen() {
    clearTimeout(regenTimer);
    regenTimer = setTimeout(function () {
      if (chosenPeople().length) generate(true);
      else clearPreview();
    }, 450);
  }

  // Untick everyone, or clear the list, and the preview used to sit there
  // showing the last batch with Download still lit - offering a file for people
  // who are no longer on the list.
  function clearPreview() {
    if (pdfUrl) { URL.revokeObjectURL(pdfUrl); pdfUrl = null; }
    pdfBytes = null;
    var frame = $('previewFrame');
    frame.removeAttribute('src');
    frame.hidden = true;
    $('previewEmpty').hidden = false;
    $('btnDownload').disabled = true;
    $('btnPrint').disabled = true;
  }

  function generate(quiet) {
    // A big batch takes longer to build than the debounce waits, so changes do
    // arrive mid-generation. Remember that one is outstanding and run it after,
    // otherwise the preview silently keeps showing the older certificate.
    if (busy) { regenPending = true; return; }
    var people = chosenPeople();
    if (!people.length) { updateGenerateState(); return; }
    busy = true;
    $('btnGenerate').disabled = true;
    if (!quiet) setStatus('Generating…');

    // Cinzel is fetched only when the Trajan lettering is actually asked for -
    // it and fontkit are a megabyte between them, for a style most batches do
    // not use.
    var wanted = [ensurePdfLib()];
    if (batch.fontStyle === 'trajan') wanted.push(ensureTrajan());

    Promise.all(wanted).then(function () {
      var logoBytes = batch.logos
        .map(function (n) { return logoByName(n); })
        .filter(Boolean)
        .map(function (l) { return core.dataUriToBytes(l.dataUri); });

      var opts = {
        PDFLib: PDFLib,
        people: people,
        batch: batch,
        settings: settings,
        logoBytesList: logoBytes,
        sigImageBytes: settings.sigImage ? core.dataUriToBytes(settings.sigImage) : null,
        sig2ImageBytes: settings.sig2Image ? core.dataUriToBytes(settings.sig2Image) : null,
      };
      if (batch.fontStyle === 'trajan' && typeof PSA_FONT_CINZEL !== 'undefined') {
        opts.fontkit = window.fontkit;
        opts.displayFontBytes = core.dataUriToBytes(PSA_FONT_CINZEL);
        if (typeof PSA_FONT_CINZEL_BOLD !== 'undefined') {
          opts.displayFontBoldBytes = core.dataUriToBytes(PSA_FONT_CINZEL_BOLD);
        }
      }
      return core.generatePdf(opts);
    }).then(function (bytes) {
      pdfBytes = bytes;
      if (pdfUrl) URL.revokeObjectURL(pdfUrl);
      pdfUrl = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
      var frame = $('previewFrame');
      frame.src = pdfUrl;
      frame.hidden = false;
      $('previewEmpty').hidden = true;
      $('btnDownload').disabled = false;
      $('btnPrint').disabled = false;
      var sheets = Math.ceil(people.length / core.sheetPlan(batch).perSheet);
      setStatus(people.length + ' certificate' + (people.length === 1 ? '' : 's') + ' on '
        + sheets + ' sheet' + (sheets === 1 ? '' : 's') + '.', 'ok');
    }).catch(function (e) {
      setStatus('Could not generate the PDF: ' + e.message, 'error');
      console.error(e);
    }).then(function () {
      busy = false;
      updateGenerateState();
      if (regenPending) { regenPending = false; scheduleRegen(); }
    });
  }

  // The title alone made every batch "certificate-of-participation.pdf", so a
  // Downloads folder ended up a row of (1), (2), (3) with nothing to tell them
  // apart. The date issued is what actually distinguishes one batch from the
  // next, and it sorts.
  function pdfFileName() {
    var title = String(batch.certTitle || '').replace(/[^\w\s-]/g, '').trim()
      .replace(/\s+/g, '-').toLowerCase();
    var when = /^\d{4}-\d{2}-\d{2}$/.test(batch.givenDate || '') ? batch.givenDate : todayISO();
    return (title || 'certificates') + '-' + when + '.pdf';
  }

  function downloadPdf() {
    if (!pdfBytes) return;
    var a = document.createElement('a');
    a.href = pdfUrl;
    a.download = pdfFileName();
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  // ---------- excel template ----------
  function downloadTemplate() {
    ensureXlsx().then(function () {
      var ws = XLSX.utils.aoa_to_sheet([
        ['Full Name', 'Role'],
        ['Richard B. Calub', ''],
        ['Juan Paolo Santos', 'as Resource Speaker in the'],
      ]);
      ws['!cols'] = [{ wch: 34 }, { wch: 34 }];
      var wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Participants');
      XLSX.writeFile(wb, 'certificate-list-template.xlsx');
    }).catch(function (e) {
      setStatus('Could not build the template: ' + e.message, 'error');
    });
  }

  // ---------- settings dialog ----------
  function openSettings() {
    var f = $('settingsForm');
    ['sig1Name', 'sig1Title', 'sig1Office', 'sig2Name', 'sig2Title', 'sig2Office']
      .forEach(function (k) { if (f[k]) f[k].value = settings[k] || ''; });
    setToggle($('btnSig2Enable'), settings.sig2Enabled);
    setToggle($('btnSigEnable'), settings.sigEnabled);
    renderSigPreviews();
    $('settingsDialog').showModal();
  }

  function setToggle(btn, on) {
    btn.classList.toggle('off', !on);
    btn.textContent = on ? 'On' : 'Off';
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  }

  function renderSigPreviews() {
    [['sigPreview', 'sigImage'], ['sig2Preview', 'sig2Image']].forEach(function (p) {
      var img = $(p[0]);
      if (settings[p[1]]) { img.src = settings[p[1]]; img.hidden = false; }
      else { img.removeAttribute('src'); img.hidden = true; }
      img.classList.toggle('sigoff', !settings.sigEnabled);
    });
  }

  function saveSettingsFromDialog() {
    var f = $('settingsForm');
    ['sig1Name', 'sig1Title', 'sig1Office', 'sig2Name', 'sig2Title', 'sig2Office']
      .forEach(function (k) { if (f[k]) settings[k] = f[k].value.trim(); });
    saveSettingsToStorage();
    scheduleRegen();
  }

  // ---------- backup / restore ----------
  function doBackup() {
    var mappings = {};
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (k && k.indexOf(MAPPING_KEY) === 0) mappings[k] = localStorage.getItem(k);
    }
    var data = {
      app: 'psa-certificate-generator',
      version: BACKUP_VERSION,
      savedAt: new Date().toISOString(),
      settings: settings,
      batch: batch,
      logos: userLogos(),   // bundled artwork ships with the app, no need to copy it
      mappings: mappings,
    };
    var url = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
    var a = document.createElement('a');
    a.href = url;
    a.download = 'PSA-Certificate-backup-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function doRestore(file) {
    file.text().then(function (txt) {
      var data = JSON.parse(txt);
      if (!data || data.app !== 'psa-certificate-generator') {
        throw new Error('That file is not a certificate generator backup.');
      }
      if (data.settings) {
        settings = Object.assign({}, core.DEFAULT_SETTINGS, data.settings);
        saveSettingsToStorage();
      }
      if (data.batch) {
        batch = normalizeBatch(data.batch);
        saveBatch();
      }
      if (data.mappings) {
        Object.keys(data.mappings).forEach(function (k) {
          if (k.indexOf(MAPPING_KEY) === 0) localStorage.setItem(k, data.mappings[k]);
        });
      }
      // Skip anything named after bundled artwork - that image ships with the
      // app already, and storing a copy under the same name only wastes room.
      (data.logos || []).forEach(function (l) {
        if (!l || !l.name || !l.dataUri) return;
        if (bundledLogos().some(function (b) { return b.name === l.name; })) return;
        putLogo(l);
      });
      refreshLogos();
      applyBatchToUI();
      renderRoster();   // a restored batch can carry a different A-Z setting
      $('settingsDialog').close();
      setStatus('Backup restored.', 'ok', true);
      scheduleRegen();
    }).catch(function (e) {
      setStatus('Could not restore: ' + e.message, 'error');
    });
  }

  // ---------- wiring ----------
  // Type-or-pick box. The arrow always opens the FULL list, whatever is already
  // in the input - a <datalist> filters against the current value, so once the
  // box said "Certificate of Participation" its list showed that one entry and
  // looked broken until you deleted the text.
  // Picking an option just writes the value and fires 'input', so the normal
  // field handler does the saving and the follow-on wording change.
  function setupCombo(input, arrow, list, options) {
    var active = -1;

    function paint() {
      Array.prototype.forEach.call(list.children, function (li, i) {
        li.classList.toggle('active', i === active);
      });
      if (active >= 0 && list.children[active]) {
        list.children[active].scrollIntoView({ block: 'nearest' });
      }
    }
    function open() {
      list.innerHTML = '';
      options.forEach(function (opt) {
        var li = document.createElement('li');
        li.textContent = opt;
        li.setAttribute('role', 'option');
        if (opt === input.value) li.setAttribute('aria-selected', 'true');
        // mousedown, not click: the input must not blur-and-close first
        li.addEventListener('mousedown', function (ev) { ev.preventDefault(); pick(opt); });
        list.appendChild(li);
      });
      list.hidden = false;
      input.setAttribute('aria-expanded', 'true');
      active = options.indexOf(input.value);
      paint();
    }
    function close() {
      list.hidden = true;
      input.setAttribute('aria-expanded', 'false');
      active = -1;
    }
    function pick(value) {
      input.value = value;
      close();
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.focus();
    }

    arrow.addEventListener('click', function () {
      if (list.hidden) { open(); input.focus(); } else close();
    });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (list.hidden) open();
        else { active = Math.min(active + 1, options.length - 1); paint(); }
      } else if (e.key === 'ArrowUp') {
        if (list.hidden) return;
        e.preventDefault();
        active = Math.max(active - 1, 0);
        paint();
      } else if (e.key === 'Enter') {
        if (list.hidden || active < 0) return;
        e.preventDefault();
        pick(options[active]);
      } else if (e.key === 'Escape') {
        if (list.hidden) return;
        e.preventDefault();
        close();
      }
    });
    input.addEventListener('blur', function () { setTimeout(close, 120); });
    document.addEventListener('click', function (e) {
      if (!list.hidden && e.target !== input && e.target !== arrow && !list.contains(e.target)) close();
    });
  }

  function bindSegment(wrapId, attr, apply) {
    $(wrapId).addEventListener('click', function (ev) {
      var b = ev.target.closest('.seg');
      if (!b || b.disabled) return;
      apply(b.getAttribute('data-' + attr));
      setSegment(wrapId, attr, b.getAttribute('data-' + attr));
      saveBatch();
      scheduleRegen();
    });
  }

  function init() {
    loadSettings();
    loadBatch();
    loadManual();

    setupCombo($('certTitle'), $('certTitleArrow'), $('certTitleList'), core.TITLE_PRESETS);

    // --- step 1: the list
    $('btnBrowse').onclick = function () { $('fileInput').click(); };
    // Clear the input as soon as the file is in hand. Edge and Chrome only fire
    // 'change' when the chosen path differs from the last one, so without this
    // the ordinary loop - fix a name in Excel, save, import the same file again
    // - looked like the app had frozen.
    $('fileInput').onchange = function () {
      var file = this.files[0];
      this.value = '';
      if (file) loadFile(file);
    };
    $('sheetSelect').onchange = function () { readSheet(this.value); };
    $('btnTemplate').onclick = downloadTemplate;
    function forgetFile() {
      workbook = null; headers = []; excelPeople = []; mapping = {};
      $('fileInfo').hidden = true;
      $('fileInput').value = '';
      $('sheetNote').textContent = '';
      renderMapping();
    }
    $('btnClearFile').onclick = function () {
      forgetFile();
      renderRoster();
      scheduleRegen();
    };
    $('btnSortNames').onclick = function () {
      batch.sortNames = !batch.sortNames;
      setSortButton();
      saveBatch();
      renderRoster();
      scheduleRegen();
    };
    $('btnClearList').onclick = function () {
      if (!confirm('Take everyone off the list?\n\n'
        + 'The certificate details, your logos and the settings are all kept.')) return;
      forgetFile();
      manualPeople = [];
      saveManual();
      renderRoster();
      scheduleRegen();
    };
    var dz = $('dropZone');
    ['dragenter', 'dragover'].forEach(function (e) {
      dz.addEventListener(e, function (ev) { ev.preventDefault(); dz.classList.add('drag'); });
    });
    ['dragleave', 'drop'].forEach(function (e) {
      dz.addEventListener(e, function (ev) { ev.preventDefault(); dz.classList.remove('drag'); });
    });
    dz.addEventListener('drop', function (ev) {
      if (ev.dataTransfer.files[0]) loadFile(ev.dataTransfer.files[0]);
    });

    $('btnAddPerson').onclick = function () {
      $('personForm').reset();
      $('personDialog').showModal();
      setTimeout(function () { $('personForm').name.focus(); }, 0);
    };
    $('btnPersonCancel').onclick = function () { $('personDialog').close(); };
    $('personDialog').addEventListener('close', function () {
      if ($('personDialog').returnValue !== 'add') return;
      var f = $('personForm');
      var name = f.name.value.trim();
      if (!name) return;
      manualPeople.push({ name: name, role: f.role.value.trim(), include: true, manual: true });
      saveManual();
      renderRoster();
      scheduleRegen();
    });

    $('btnToday').onclick = function () {
      var el = $('givenDate');
      el.value = todayISO();
      // let the ordinary field handler do the saving and the preview line
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };

    // --- step 2: the details
    TEXT_FIELDS.forEach(function (k) {
      var el = $(k);
      if (!el) return;
      el.addEventListener('input', function () {
        var prevTitle = batch.certTitle;
        batch[k] = el.value;
        // Keep the line above the event in step with the title, unless the
        // user has written their own.
        if (k === 'certTitle') {
          var wasAuto = !batch.forLine || batch.forLine === core.FOR_LINES[prevTitle];
          var next = core.FOR_LINES[el.value];
          if (wasAuto && next) {
            batch.forLine = next;
            $('forLine').value = next;
          }
        }
        saveBatch();
        renderPreviews();
        scheduleRegen();
      });
    });

    EYES.forEach(function (e) {
      $(e[0]).onclick = function () {
        batch[e[1]] = !batch[e[1]];
        setEye($(e[0]), batch[e[1]]);
        saveBatch();
        scheduleRegen();
      };
    });

    // --- step 3: size and design
    bindSegment('sizeMode', 'size', function (v) { batch.size = v; syncSheetField(); });
    bindSegment('orientMode', 'orient', function (v) { batch.orientation = v; syncSheetField(); });
    bindSegment('sheetMode', 'sheet', function (v) { batch.sheet = v; syncSheetField(); });
    bindSegment('frameMode', 'frame', function (v) { batch.frame = v; });
    bindSegment('fontMode', 'font', function (v) { batch.fontStyle = v; });

    ['accent', 'nameColor'].forEach(function (k) {
      $(k).addEventListener('input', function () {
        batch[k] = this.value;
        saveBatch();
        scheduleRegen();
      });
    });

    document.querySelectorAll('.logoslot').forEach(function (slot) {
      var i = +slot.getAttribute('data-slot');
      slot.querySelector('select').onchange = function () {
        batch.logos[i] = this.value;
        saveBatch();
        renderLogoSlots();
        scheduleRegen();
      };
      slot.querySelector('.dellogo').onclick = function () {
        var name = batch.logos[i];
        if (!name) return;
        if (!confirm('Delete "' + name + '" from the logo library on this computer?')) return;
        delLogo(name);
        batch.logos = batch.logos.map(function (n) { return n === name ? '' : n; });
        saveBatch();
        refreshLogos();
        scheduleRegen();
      };
    });

    $('btnAddLogo').onclick = function () { $('logoInput').click(); };
    $('logoInput').onchange = function () {
      var file = this.files[0];
      if (!file) return;
      var name = uniqueLogoName(file.name.replace(/\.[^.]+$/, ''));
      readFileAsDataUri(file).then(function (uri) {
        return shrinkImage(uri, 700);
      }).then(function (uri) {
        if (!putLogo({ name: name, dataUri: uri })) return;
        // drop it into the first empty slot so it shows up straight away
        var slot = batch.logos.indexOf('');
        if (slot >= 0) batch.logos[slot] = name;
        saveBatch();
        refreshLogos();
        scheduleRegen();
      }).catch(function (e) { setStatus('Could not add that logo: ' + e.message, 'error'); });
      this.value = '';
    };

    $('btnGenerate').onclick = function () { generate(false); };
    $('btnDownload').onclick = downloadPdf;
    $('btnPrint').onclick = function () {
      var frame = $('previewFrame');
      try { frame.contentWindow.focus(); frame.contentWindow.print(); }
      catch (e) { setStatus('Use the print button inside the preview instead.', 'error'); }
    };

    // --- settings
    $('btnSettings').onclick = openSettings;
    $('btnSig2Enable').onclick = function () {
      settings.sig2Enabled = !settings.sig2Enabled;
      setToggle(this, settings.sig2Enabled);
    };
    $('btnSigEnable').onclick = function () {
      settings.sigEnabled = !settings.sigEnabled;
      setToggle(this, settings.sigEnabled);
      renderSigPreviews();
    };
    [['btnSigUpload', 'sigInput', 'sigImage'], ['btnSig2Upload', 'sig2Input', 'sig2Image']]
      .forEach(function (s) {
        $(s[0]).onclick = function () { $(s[1]).click(); };
        $(s[1]).onchange = function () {
          var file = this.files[0];
          if (!file) return;
          readFileAsDataUri(file).then(function (uri) { return shrinkImage(uri, 600); })
            .then(function (uri) {
              settings[s[2]] = uri;
              renderSigPreviews();
            });
          this.value = '';
        };
      });
    $('btnSigClear').onclick = function () { delete settings.sigImage; renderSigPreviews(); };
    $('btnSig2Clear').onclick = function () { delete settings.sig2Image; renderSigPreviews(); };

    $('btnResetSettings').onclick = function () {
      if (!confirm('Reset the signatories back to the office defaults?')) return;
      settings = Object.assign({}, core.DEFAULT_SETTINGS);
      saveSettingsToStorage();
      openSettings();
    };
    $('btnBackup').onclick = doBackup;
    $('btnRestore').onclick = function () { $('restoreInput').click(); };
    $('restoreInput').onchange = function () { if (this.files[0]) doRestore(this.files[0]); this.value = ''; };
    $('settingsDialog').addEventListener('close', function () {
      if ($('settingsDialog').returnValue === 'save') saveSettingsFromDialog();
      else { loadSettings(); }
    });

    applyBatchToUI();
    renderRoster();
    refreshLogos();
    // People now survive a reload, so the preview should be waiting too.
    scheduleRegen();
    warmUp();
    window.__psaReady = true;
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
