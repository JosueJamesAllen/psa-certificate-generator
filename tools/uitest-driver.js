// Headless UI smoke test. tools/uitest.js builds _uitest.html (index.html plus
// a script tag pointing here) and drives the real app in headless Edge, so the
// wiring - not just the engine - gets exercised.  Results land in #diag, which
// the runner reads out of --dump-dom.
(function () {
  // Read before anything has had a chance to load, so this says what the page
  // itself carries rather than what has arrived since.
  var atStart = 'xlsx=' + (typeof XLSX !== 'undefined')
    + ' pdflib=' + (typeof PDFLib !== 'undefined')
    + ' fontkit=' + !!window.fontkit
    + ' cinzel=' + (typeof PSA_FONT_CINZEL !== 'undefined');
  var log = [];
  function say(s) {
    log.push(s);
    document.getElementById('diag').textContent = log.join('\n');
  }
  window.onerror = function (m, u, l) { say('JS ERROR: ' + m + ' @line ' + l); };
  window.addEventListener('unhandledrejection', function (e) {
    say('UNHANDLED REJECTION: ' + (e.reason && e.reason.message || e.reason));
  });

  function set(id, val) {
    var el = document.getElementById(id);
    el.value = val;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }
  function addPerson(name, role) {
    var f = document.getElementById('personForm');
    f.name.value = name;
    f.role.value = role || '';
    var d = document.getElementById('personDialog');
    d.returnValue = 'add';
    d.dispatchEvent(new Event('close'));
  }
  // Waits for the status line to settle on a generated-certificates message.
  // The status is blanked first, otherwise the previous run's message is still
  // sitting there and the poll returns before this regeneration has happened.
  // The CLASS has to go too: an earlier error leaves it behind, and the poll
  // below treats that as this run having failed.
  function waitForPdf(label, next) {
    var tries = 0;
    document.getElementById('status').textContent = '';
    document.getElementById('status').className = 'hint';
    (function poll() {
      var st = document.getElementById('status');
      if (/certificate/.test(st.textContent) && !document.getElementById('btnDownload').disabled) {
        say(label + ': ' + st.textContent);
        return next();
      }
      if (st.className.indexOf('error') >= 0) { say(label + ' FAILED: ' + st.textContent); return next(); }
      if (++tries > 400) { say(label + ' TIMED OUT (status: ' + st.textContent + ')'); return next(); }
      setTimeout(poll, 50);
    })();
  }

  // Builds a real .xlsx in memory and drops it on the drop zone, so the import
  // path - loadFile, the heading-row search, the mapping table and the roster -
  // is exercised the way a user exercises it.
  function dropAny(bytes, name) {
    var dt = new DataTransfer();
    dt.items.add(new File([bytes], name));
    var ev = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(ev, 'dataTransfer', { value: dt });
    document.getElementById('dropZone').dispatchEvent(ev);
  }
  function dropSheet(rows, name) {
    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Sheet1');
    dropAny(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }), name || 'list.xlsx');
  }
  // What the user actually sees after a file is refused.
  function report(label) {
    var t = document.getElementById('toast');
    say(label + ': toast=' + !t.hidden + ' ' + JSON.stringify(t.className)
      + ' | roster rows=' + (document.getElementById('rosterTable').rows.length - 1)
      + ' | ' + JSON.stringify(document.getElementById('status').textContent.slice(0, 46)));
  }
  // The import is asynchronous (File.arrayBuffer), so wait for the roster.
  function waitForRoster(label, next) {
    var tries = 0;
    (function poll() {
      var rows = document.getElementById('rosterTable').rows.length - 1;
      if (rows > 0) return next(rows);
      if (++tries > 200) { say(label + ': ROSTER NEVER APPEARED'); return next(0); }
      setTimeout(poll, 30);
    })();
  }
  function names() {
    return Array.prototype.map.call(document.getElementById('rosterTable').rows, function (r, i) {
      return i ? r.cells[1].textContent : null;
    }).filter(Boolean).join('/');
  }
  function clearFile(next) {
    document.getElementById('btnClearFile').click();
    setTimeout(next, 30);
  }

  // Size of the PDF now in the preview. Read back through its blob: URL, which
  // is fetchable even from a file:// page (a local file is not).
  // Searching the bytes for "Cinzel" would be the obvious check and does not
  // work: pdf-lib writes object streams, so every font name is inside
  // compressed data - a classic-serif PDF contains no "Times" either. The
  // embedded subset does show up plainly in the size, though: ~5 KB of font.
  function pdfSize(next) {
    fetch(document.getElementById('previewFrame').src).then(function (r) {
      return r.arrayBuffer();
    }).then(function (buf) {
      next(buf.byteLength);
    }).catch(function (e) {
      say('could not read the pdf back (' + e.message + ')');
      next(0);
    });
  }

  function waitForLogos(next) {
    var tries = 0;
    (function poll() {
      var sel = document.querySelector('.logoslot select');
      if (sel.options.length > 1) return next();
      if (++tries > 200) { say('LOGO LIBRARY NEVER LOADED'); return next(); }
      setTimeout(poll, 30);
    })();
  }
  function waitReady(cb) {
    if (window.__psaReady) return cb();
    setTimeout(function () { waitReady(cb); }, 30);
  }
  // SheetJS is no longer in a script tag - app.js pulls it in once the form is
  // up. The driver builds its own workbooks, so it has to wait for it too.
  function waitForXlsx(next) {
    var tries = 0;
    (function poll() {
      if (typeof XLSX !== 'undefined') return next();
      if (++tries > 300) { say('SHEETJS NEVER LOADED'); return next(); }
      setTimeout(poll, 30);
    })();
  }

  waitReady(function () { waitForLogos(run); });

  function run() {
    say('app ready');
    say('logos in library: ' + (document.querySelector('.logoslot select').options.length - 1));
    say('logo slot 0: ' + JSON.stringify(document.querySelector('.logoslot select').value));
    say('logo thumb shown: ' + !document.querySelector('.logothumb').hidden);
    set('event', 'Advancing CBMS through Statistical Standards and Classifications: '
      + 'Capacity Building on Statistical Survey Review and Clearance System');
    set('hours', '24');
    set('trainingType', 'foundational training');
    set('dateFrom', '2026-09-15');
    set('dateTo', '2026-09-17');
    set('location', 'PSA PSO Marinduque Training Room,\n2nd Floor, JRT 2 Building, Tampus, Boac, Marinduque');
    set('givenDate', '2026-09-17');
    // The title dropdown must show every preset even though the box already
    // holds a full title - the old <datalist> filtered itself down to one.
    var tIn = document.getElementById('certTitle');
    var tList = document.getElementById('certTitleList');
    say('title box holds: ' + JSON.stringify(tIn.value));
    document.getElementById('certTitleArrow').click();
    say('dropdown open: ' + !tList.hidden + ', options offered: ' + tList.children.length);
    say('options: ' + Array.prototype.map.call(tList.children, function (li) {
      return li.textContent.replace('Certificate of ', '');
    }).join('/'));
    tList.children[3].dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    say('after picking 4th: ' + JSON.stringify(tIn.value)
      + ' | closed: ' + tList.hidden
      + ' | forLine: ' + document.getElementById('forLine').value);

    say('detail line: ' + document.getElementById('detailPreview').textContent);
    say('given line: ' + document.getElementById('givenPreview').textContent);
    say('sheet hint (A4): ' + document.getElementById('sheetHint').textContent);

    say('libraries in the page itself: ' + atStart);
    waitForXlsx(function () { importChecks(function () { rest(); }); });
  }

  // The import cases that used to quietly lose a person: a merged title above
  // the headings, and a list with no headings at all.
  function importChecks(done) {
    dropSheet([['Full Name', 'Role'],
               ['Richard B. Calub', ''],
               ['Ana Marie L. Reyes', 'as Resource Speaker in the']], 'plain.xlsx');
    waitForRoster('plain headings', function (n) {
      say('plain headings: ' + n + ' rows [' + names() + '] note='
        + JSON.stringify(document.getElementById('sheetNote').textContent));
      clearFile(function () {
        dropSheet([['Certificate Participants List', ''],
                   ['Full Name', 'Role'],
                   ['Richard B. Calub', ''],
                   ['Ana Marie L. Reyes', '']], 'titled.xlsx');
        waitForRoster('title row', function (n2) {
          say('title above headings: ' + n2 + ' rows [' + names() + '] note='
            + JSON.stringify(document.getElementById('sheetNote').textContent));
          clearFile(function () {
            dropSheet([['Richard B. Calub'], ['Ana Marie L. Reyes'], ['Juan Paolo Santos']], 'bare.xlsx');
            waitForRoster('bare list', function (n3) {
              say('no headings at all: ' + n3 + ' rows [' + names() + '] note='
                + JSON.stringify(document.getElementById('sheetNote').textContent));
              clearFile(function () {
                // The wrong file dragged in by mistake. SheetJS reads anything
                // as delimited text, so both of these used to become a roster of
                // binary gibberish; and the complaint has to appear somewhere the
                // user is looking - the toast, not only the status line at the
                // bottom of step 3.
                dropAny(new Uint8Array([1, 2, 3, 4, 5]), 'scan.pdf');
                setTimeout(function () {
                  report('wrong file type');
                  clearFile(function () {
                    // Same bytes, but wearing a spreadsheet's name.
                    dropAny(new Uint8Array([1, 2, 3, 4, 5]), 'broken.xlsx');
                    setTimeout(function () {
                      report('unreadable .xlsx');
                      clearFile(done);
                    }, 400);
                  });
                }, 400);
              });
            });
          });
        });
      });
    });
  }

  // Correcting a name in place, printing A-Z, remembering hand-typed people,
  // and clearing the list.
  function rosterChecks(done) {
    var t = document.getElementById('rosterTable');
    var cell = t.rows[1].cells[1];
    cell.focus();
    cell.textContent = 'Zenaida  Q.\nAbueg';   // messy paste: two spaces and a line break
    cell.dispatchEvent(new Event('input', { bubbles: true }));
    setTimeout(function () {
      say('edited name -> ' + JSON.stringify(readStored()[0] && readStored()[0].name));
      say('roster count: ' + document.getElementById('rosterCount').textContent);

      // a blank name must raise the flag without a rebuild stealing the caret
      var c2 = document.getElementById('rosterTable').rows[2].cells[1];
      c2.focus();
      c2.textContent = '';
      c2.dispatchEvent(new Event('input', { bubbles: true }));
      say('blank name flagged: '
        + document.getElementById('rosterTable').rows[2].classList.contains('warn')
        + ' | caret kept: ' + (document.activeElement === c2));
      c2.textContent = 'Aaron B. Uy';
      c2.dispatchEvent(new Event('input', { bubbles: true }));

      document.getElementById('btnSortNames').click();
      say('A-Z on: ' + names() + ' | pressed='
        + document.getElementById('btnSortNames').getAttribute('aria-pressed'));
      document.getElementById('btnSortNames').click();
      say('A-Z off: ' + names());

      say('stored for next time: ' + JSON.stringify(readStored().map(function (p) { return p.name; })));
      say('download would be called: ' + fileNameProbe());

      // clearing the list must also take the preview and Download down with it
      window.confirm = function () { return true; };
      document.getElementById('btnClearList').click();
      setTimeout(function () {
        say('after clear: rows=' + (document.getElementById('rosterTable').rows.length - 1)
          + ' tools hidden=' + document.getElementById('rosterTools').hidden
          + ' stored=' + JSON.stringify(readStored())
          + ' download disabled=' + document.getElementById('btnDownload').disabled
          + ' preview hidden=' + document.getElementById('previewFrame').hidden);
        done();
      }, 900);
    }, 100);
  }
  function readStored() {
    try { return JSON.parse(localStorage.getItem('psa-cert-people')) || []; } catch (e) { return []; }
  }
  // The download name is built at click time; catch it without saving a file.
  function fileNameProbe() {
    var got = '';
    var realClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () { got = this.download; };
    document.getElementById('btnDownload').click();
    HTMLAnchorElement.prototype.click = realClick;
    return got;
  }

  function rest() {
    addPerson('Richard B. Calub', '');
    addPerson('Juan Paolo Santos', 'as Resource Speaker in the');
    addPerson('', '');   // blank name must be ignored, not crash
    say('roster rows: ' + (document.getElementById('rosterTable').rows.length - 1));

    waitForPdf('A4 portrait', function () {
      // title change should rewrite the "for ..." line
      set('certTitle', 'Certificate of Appreciation');
      say('forLine after title change: ' + document.getElementById('forLine').value);

      document.querySelector('#sizeMode .seg[data-size=half]').click();
      document.querySelector('#sheetMode .seg[data-sheet=a4]').click();
      document.querySelector('#fontMode .seg[data-font=trajan]').click();
      say('sheet hint (A5 2-up): ' + document.getElementById('sheetHint').textContent);

      waitForPdf('A5 two-up trajan', function () {
        // the Trajan fonts must arrive only once that lettering is asked for
        say('after choosing Trajan: fontkit=' + !!window.fontkit
          + ' cinzel=' + (typeof PSA_FONT_CINZEL !== 'undefined')
          + ' cinzelBold=' + (typeof PSA_FONT_CINZEL_BOLD !== 'undefined'));
        // ...and the certificate must really be set in them, rather than
        // quietly falling back to Times because the bytes turned up after the
        // PDF was already built. The same batch in each lettering, compared.
        pdfSize(function (trajanBytes) {
          document.querySelector('#fontMode .seg[data-font=classic]').click();
          waitForPdf('same batch, classic serif', function () {
            pdfSize(function (classicBytes) {
              say('Cinzel really embedded: ' + (trajanBytes - classicBytes > 2000)
                + ' (trajan ' + trajanBytes + ' B vs classic ' + classicBytes + ' B)');
              document.querySelector('#fontMode .seg[data-font=trajan]').click();
              waitForPdf('back to trajan', function () {
                document.querySelector('#orientMode .seg[data-orient=landscape]').click();
                document.querySelector('#frameMode .seg[data-frame=border]').click();
                waitForPdf('A5 landscape border', function () {
                  // hide the optional lines
                  ['btnEyeDetail', 'btnEyeLocation', 'btnEyeGiven', 'btnEyePreamble'].forEach(function (id) {
                    document.getElementById(id).click();
                  });
                  waitForPdf('optional lines hidden', function () {
                    rosterChecks(function () { say('DONE'); });
                  });
                });
              });
            });
          });
        });
      });
    });
  }
})();
