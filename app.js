// PSA Certificate Generator - UI layer.
// Talks to core.js (the engine) and keeps everything on this machine:
// settings + certificate details in localStorage, the logo library in
// IndexedDB. No network, no server - it runs from file://.
(function () {
  'use strict';

  var core = window.PSACert;
  var SETTINGS_KEY = 'psa-cert-settings';
  var BATCH_KEY = 'psa-cert-batch';
  var MAPPING_KEY = 'psa-cert-map:';
  var LOGOS_KEY = 'psa-cert-logos';
  var BACKUP_VERSION = 1;

  function $(id) { return document.getElementById(id); }

  var settings = {};
  var batch = {};
  var logos = [];              // [{ name, dataUri, bundled? }] - see refreshLogos
  var workbook = null;
  var headers = [];
  var mapping = {};
  var excelPeople = [];        // from the sheet
  var manualPeople = [];       // typed in by hand
  var pdfUrl = null;
  var pdfBytes = null;
  var regenTimer = null;
  var busy = false;

  // ---------- persistence ----------
  function loadBatch() {
    var saved = {};
    try { saved = JSON.parse(localStorage.getItem(BATCH_KEY)) || {}; } catch (e) { }
    batch = normalizeBatch(saved);
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
  function loadFile(file) {
    file.arrayBuffer().then(function (buf) {
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
    headers = rows[0].map(function (h) { return String(h || '').trim(); });
    var saved = null;
    try { saved = JSON.parse(localStorage.getItem(MAPPING_KEY + headers.join('|'))); } catch (e) { }
    mapping = saved || core.autoMap(headers);
    excelPeople = rows.slice(1)
      .filter(function (r) { return r.some(function (v) { return String(v).trim(); }); })
      .map(function (r) {
        return {
          name: mapping.name != null ? String(r[mapping.name] || '').trim() : '',
          role: mapping.role != null ? String(r[mapping.role] || '').trim() : '',
          include: true,
        };
      });
    $('rowCount').textContent = excelPeople.length + ' row' + (excelPeople.length === 1 ? '' : 's');
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
  function chosenPeople() {
    return allPeople().filter(function (p) { return p.include && String(p.name || '').trim(); });
  }

  function renderRoster() {
    var list = allPeople();
    var wrap = $('rosterWrap');
    var t = $('rosterTable');
    wrap.hidden = !list.length;
    t.innerHTML = '';
    if (!list.length) { updateGenerateState(); return; }

    var seen = {};
    list.forEach(function (p) {
      var k = String(p.name || '').trim().toLowerCase();
      if (k) seen[k] = (seen[k] || 0) + 1;
    });

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
          renderRoster();
          scheduleRegen();
        };
        th.appendChild(all);
      } else th.textContent = h;
      head.appendChild(th);
    });
    t.appendChild(head);

    list.forEach(function (p, idx) {
      var tr = document.createElement('tr');
      var warn = '';
      if (!String(p.name || '').trim()) warn = 'No name - this row will be skipped';
      else if (seen[String(p.name).trim().toLowerCase()] > 1) warn = 'This name appears more than once';
      if (warn) tr.className = 'warn';

      var td0 = document.createElement('td');
      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = !!p.include;
      cb.onchange = function () { p.include = cb.checked; updateGenerateState(); scheduleRegen(); };
      td0.appendChild(cb);

      var td1 = document.createElement('td');
      td1.textContent = p.name || '—';
      td1.title = p.name || '';

      var td2 = document.createElement('td');
      td2.textContent = p.role || '';
      td2.title = p.role || '';

      var td3 = document.createElement('td');
      td3.className = 'flag';
      if (warn) {
        var w = document.createElement('span');
        w.className = 'warnflag';
        w.textContent = '⚠';
        w.title = warn;
        td3.appendChild(w);
      }
      if (idx >= excelPeople.length) {
        var del = document.createElement('button');
        del.className = 'rowdel';
        del.type = 'button';
        del.textContent = '✕';
        del.title = 'Remove';
        del.onclick = function () {
          manualPeople.splice(idx - excelPeople.length, 1);
          renderRoster();
          scheduleRegen();
        };
        td3.appendChild(del);
      }

      [td0, td1, td2, td3].forEach(function (td) { tr.appendChild(td); });
      t.appendChild(tr);
    });
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
  function setStatus(msg, cls) {
    var el = $('status');
    el.textContent = msg || '';
    el.className = 'hint' + (cls ? ' ' + cls : '');
  }

  function updateGenerateState() {
    var n = chosenPeople().length;
    var ok = n > 0 && !busy;
    $('btnGenerate').disabled = !ok;
    if (!n) setStatus('Add at least one name to generate certificates.');
  }

  function scheduleRegen() {
    clearTimeout(regenTimer);
    regenTimer = setTimeout(function () {
      if (chosenPeople().length) generate(true);
    }, 450);
  }

  function generate(quiet) {
    if (busy) return;
    var people = chosenPeople();
    if (!people.length) { updateGenerateState(); return; }
    busy = true;
    $('btnGenerate').disabled = true;
    if (!quiet) setStatus('Generating…');

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
    // Cinzel is only needed for the Trajan lettering; skip the embed otherwise.
    if (batch.fontStyle === 'trajan' && typeof PSA_FONT_CINZEL !== 'undefined') {
      opts.fontkit = window.fontkit;
      opts.displayFontBytes = core.dataUriToBytes(PSA_FONT_CINZEL);
      if (typeof PSA_FONT_CINZEL_BOLD !== 'undefined') {
        opts.displayFontBoldBytes = core.dataUriToBytes(PSA_FONT_CINZEL_BOLD);
      }
    }

    core.generatePdf(opts).then(function (bytes) {
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
    });
  }

  function downloadPdf() {
    if (!pdfBytes) return;
    var a = document.createElement('a');
    a.href = pdfUrl;
    var slug = String(batch.certTitle || 'certificates').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').toLowerCase();
    a.download = slug + '.pdf';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  // ---------- excel template ----------
  function downloadTemplate() {
    var ws = XLSX.utils.aoa_to_sheet([
      ['Full Name', 'Role'],
      ['Richard B. Calub', ''],
      ['Juan Paolo Santos', 'as Resource Speaker in the'],
    ]);
    ws['!cols'] = [{ wch: 34 }, { wch: 34 }];
    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Participants');
    XLSX.writeFile(wb, 'certificate-list-template.xlsx');
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
      (data.logos || []).forEach(function (l) {
        if (l && l.name && l.dataUri) putLogo(l);
      });
      refreshLogos();
      applyBatchToUI();
      $('settingsDialog').close();
      setStatus('Backup restored.', 'ok');
      scheduleRegen();
    }).catch(function (e) {
      setStatus('Could not restore: ' + e.message, 'error');
    });
  }

  // ---------- wiring ----------
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

    var dl = $('titlePresets');
    core.TITLE_PRESETS.forEach(function (t) {
      var o = document.createElement('option');
      o.value = t;
      dl.appendChild(o);
    });

    // --- step 1: the list
    $('btnBrowse').onclick = function () { $('fileInput').click(); };
    $('fileInput').onchange = function () { if (this.files[0]) loadFile(this.files[0]); };
    $('sheetSelect').onchange = function () { readSheet(this.value); };
    $('btnTemplate').onclick = downloadTemplate;
    $('btnClearFile').onclick = function () {
      workbook = null; headers = []; excelPeople = []; mapping = {};
      $('fileInfo').hidden = true;
      $('fileInput').value = '';
      renderMapping();
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
      manualPeople.push({ name: name, role: f.role.value.trim(), include: true });
      renderRoster();
      scheduleRegen();
    });

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
      var name = file.name.replace(/\.[^.]+$/, '');
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
    window.__psaReady = true;
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
