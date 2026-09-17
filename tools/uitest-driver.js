// Headless UI smoke test. tools/uitest.js builds _uitest.html (index.html plus
// a script tag pointing here) and drives the real app in headless Edge, so the
// wiring - not just the engine - gets exercised.  Results land in #diag, which
// the runner reads out of --dump-dom.
(function () {
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
  function waitForPdf(label, next) {
    var tries = 0;
    document.getElementById('status').textContent = '';
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
    say('detail line: ' + document.getElementById('detailPreview').textContent);
    say('given line: ' + document.getElementById('givenPreview').textContent);
    say('sheet hint (A4): ' + document.getElementById('sheetHint').textContent);

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
        document.querySelector('#orientMode .seg[data-orient=landscape]').click();
        document.querySelector('#frameMode .seg[data-frame=border]').click();
        waitForPdf('A5 landscape border', function () {
          // hide the optional lines
          ['btnEyeDetail', 'btnEyeLocation', 'btnEyeGiven', 'btnEyePreamble'].forEach(function (id) {
            document.getElementById(id).click();
          });
          waitForPdf('optional lines hidden', function () {
            say('DONE');
          });
        });
      });
    });
  }
})();
