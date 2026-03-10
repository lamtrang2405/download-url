(function () {
  'use strict';

  const URL_REGEX = /^https?:\/\//i;
  const URL_IN_TEXT = /https?:\/\/[^\s]+/g;

  function showMessage(text, type) {
    var el = document.getElementById('message');
    if (!el) return;
    el.textContent = text;
    el.className = type;
    el.classList.remove('hidden');
  }

  function hideMessage() {
    var el = document.getElementById('message');
    if (el) el.classList.add('hidden');
  }

  /** Parse CSV line handling quoted fields. Returns array of strings. */
  function parseCSVLine(line) {
    var out = [];
    var i = 0;
    while (i < line.length) {
      if (line[i] === '"') {
        var end = line.indexOf('"', i + 1);
        if (end === -1) { out.push(line.slice(i + 1).replace(/""/g, '"')); break; }
        out.push(line.slice(i + 1, end).replace(/""/g, '"'));
        i = end + 1;
        if (line[i] === ',') i++;
      } else {
        var comma = line.indexOf(',', i);
        if (comma === -1) { out.push(line.slice(i).trim()); break; }
        out.push(line.slice(i, comma).trim());
        i = comma + 1;
      }
    }
    return out;
  }

  /** Split line: TSV (tab), or semicolon (no comma), or CSV. Returns [url, name] cells. */
  function parseRow(line) {
    if (line.indexOf('\t') >= 0) {
      var t = line.split('\t');
      return [(t[0] || '').trim(), (t[1] || '').trim()];
    }
    if (line.indexOf(';') >= 0 && line.indexOf(',') === -1) {
      var s = line.split(';');
      return [(s[0] || '').trim(), (s[1] || '').trim()];
    }
    var cells = parseCSVLine(line);
    return [(cells[0] || '').trim(), (cells[1] || '').trim()];
  }

  /** CSV/TSV text -> array of { url, name }. Column 1 = URL, Column 2 = filename. */
  function parseCSVToEntries(text) {
    var lines = text.split(/\r?\n/).filter(function (l) { return l.trim(); });
    var entries = [];
    var start = 0;
    if (lines.length && lines[0]) {
      var firstCell = parseRow(lines[0])[0] || '';
      if (firstCell && !URL_REGEX.test(firstCell)) start = 1;
    }
    for (var i = start; i < lines.length; i++) {
      var cells = parseRow(lines[i]);
      var url = cells[0] || '';
      var name = cells[1] || '';
      if (!url) continue;
      if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
      entries.push({ url: url, name: name || null });
    }
    return entries;
  }

  function extractUrlsFromText(text) {
    var urls = [];
    var seen = {};
    function add(raw) {
      var url = raw.replace(/[.,;:)]+$/, '').trim();
      if (!url) return;
      if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
      if (!seen[url]) {
        seen[url] = true;
        urls.push({ url: url, name: null });
      }
    }
    text.split(/\r?\n/).forEach(function (line) {
      var matches = line.match(URL_IN_TEXT) || [];
      if (matches.length) {
        matches.forEach(add);
      } else {
        var trimmed = line.trim();
        if (trimmed && /^[a-z0-9][-a-z0-9.]*\.[a-z]{2,}/i.test(trimmed)) add(trimmed);
      }
    });
    return urls;
  }

  /** Excel buffer -> [{ url, name }]. Column A = URL, Column B = name. */
  function extractFromExcelWithNames(buffer, sheetName) {
    var workbook = XLSX.read(buffer, { type: 'array' });
    var sheetNameResolved = typeof sheetName === 'number'
      ? workbook.SheetNames[sheetName]
      : sheetName;
    var sheet = workbook.Sheets[sheetNameResolved || workbook.SheetNames[0]];
    if (!sheet) throw new Error('Sheet not found');
    var rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
    if (!rows.length) return [];
    var entries = [];
    var start = 0;
    if (rows[0] && rows[0][0] !== undefined) {
      var first = String(rows[0][0] || '').trim();
      if (first && !URL_REGEX.test(first)) start = 1;
    }
    for (var k = start; k < rows.length; k++) {
      var url = String(rows[k][0] != null ? rows[k][0] : '').trim();
      if (!url || !URL_REGEX.test(url)) continue;
      var name = String(rows[k][1] != null ? rows[k][1] : '').trim() || null;
      entries.push({ url: url, name: name });
    }
    return entries;
  }

  function extractUrlsFromExcel(buffer, urlColumn, sheetName) {
    var workbook = XLSX.read(buffer, { type: 'array' });
    var sheetNameResolved = typeof sheetName === 'number'
      ? workbook.SheetNames[sheetName]
      : sheetName;
    var sheet = workbook.Sheets[sheetNameResolved || workbook.SheetNames[0]];
    if (!sheet) throw new Error('Sheet not found');
    var rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
    if (!rows.length) return [];
    var header = rows[0].map(String);
    var colIndex = -1;
    if (urlColumn) {
      var target = urlColumn.trim().toLowerCase();
      for (var i = 0; i < header.length; i++) {
        if (header[i].trim().toLowerCase() === target) { colIndex = i; break; }
      }
      if (colIndex === -1) throw new Error('Column "' + urlColumn + '" not found.');
    } else {
      for (var j = 0; j < header.length; j++) {
        var sample = rows.slice(1, 21).map(function (r) { return String(r[j] || '').trim(); });
        if (sample.some(function (s) { return URL_REGEX.test(s); })) {
          colIndex = j;
          break;
        }
      }
      if (colIndex === -1) throw new Error('No column with URLs found.');
    }
    var out = [];
    var seen = {};
    for (var k = 1; k < rows.length; k++) {
      var val = String(rows[k][colIndex] != null ? rows[k][colIndex] : '').trim();
      if (URL_REGEX.test(val) && !seen[val]) {
        seen[val] = true;
        out.push(val);
      }
    }
    return out;
  }

  function sanitizeFilename(url, index) {
    try {
      var u = new URL(url);
      var name = (u.hostname || 'download') + (u.pathname || '').replace(/^\//, '').replace(/\//g, '_');
      name = name.replace(/[^\w\-_.]/g, '_').slice(0, 80) || ('download_' + index);
      return name;
    } catch (e) {
      return 'download_' + index;
    }
  }

  /** Safe filename from user-provided name (column 2). Always returns a string when input has content. */
  function sanitizeName(name) {
    if (name == null) return '';
    var s = String(name).replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim();
    return s.slice(0, 120);
  }

  function getExtension(contentType, url) {
    var map = {
      'application/json': '.json',
      'text/html': '.html',
      'text/plain': '.txt',
      'text/csv': '.csv',
      'application/xml': '.xml',
      'text/xml': '.xml',
      'application/pdf': '.pdf',
      'image/jpeg': '.jpg',
      'image/png': '.png',
      'image/gif': '.gif',
      'image/webp': '.webp',
      'audio/mpeg': '.mp3',
      'audio/mp3': '.mp3',
      'audio/mp4': '.m4a',
      'video/mp4': '.mp4',
      'video/x-m4v': '.m4v'
    };
    var ct = (contentType || '').split(';')[0].trim();
    if (map[ct]) return map[ct];
    var p = url.split('?')[0];
    var m = p.match(/\.[a-z0-9]+$/i);
    return m ? m[0].toLowerCase() : '.bin';
  }

  /** entries = [{ url, name? }, ...]. Uses name as filename when present. */
  function downloadAll(entries, timeoutSec, zip) {
    var timeoutMs = Math.min(120, Math.max(10, timeoutSec)) * 1000;
    var results = [];
    var i = 0;

    function next() {
      if (i >= entries.length) return Promise.resolve(results);
      var entry = entries[i];
      var url = entry.url;
      var row = { url: url, status: 'pending', error: '', filename: '' };
      var controller = new AbortController();
      var to = setTimeout(function () { controller.abort(); }, timeoutMs);
      return fetch(url, {
        signal: controller.signal,
        mode: 'cors',
        headers: { 'Accept': 'image/*,*/*' }
      }).then(function (res) {
        clearTimeout(to);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.blob();
      }).then(function (blob) {
        var contentType = blob.type || '';
        var ext = getExtension(contentType, url);
        var rawName = entry.name != null ? String(entry.name).trim() : '';
        var base = rawName ? sanitizeName(rawName) : sanitizeFilename(url, i);
        if (!base) base = sanitizeFilename(url, i);
        if (!base.endsWith(ext)) base += ext;
        row.filename = base;
        zip.file(base, blob);
        row.status = 'ok';
        results.push(row);
        i++;
        return next();
      }).catch(function (err) {
        clearTimeout(to);
        row.status = 'error';
        row.error = err.message || String(err);
        results.push(row);
        i++;
        return next();
      });
    }

    return next();
  }

  function run() {
    var form = document.getElementById('form');
    var submitBtn = document.getElementById('submitBtn');
    if (!form || !submitBtn) return;

    form.addEventListener('submit', function (e) {
      e.preventDefault();

      hideMessage();
      submitBtn.disabled = true;
      submitBtn.textContent = 'Working…';

      if (typeof JSZip === 'undefined' || typeof saveAs === 'undefined') {
        showMessage('Scripts failed to load. Check your connection and try again.', 'error');
        submitBtn.disabled = false;
        submitBtn.textContent = 'Start download';
        return;
      }

      var fileInput = document.getElementById('excel_file');
      var pasteText = (document.getElementById('paste_urls') || {}).value ? document.getElementById('paste_urls').value.trim() : '';

      function done() {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Start download';
      }

      var entries = [];

      if (fileInput && fileInput.files && fileInput.files.length) {
        var file = fileInput.files[0];
        var fileName = (file.name || '').toLowerCase();
        if (fileName.endsWith('.csv')) {
          file.text().then(function (text) {
            entries = parseCSVToEntries(text);
            if (!entries.length) {
              showMessage('No URLs in CSV. Use Column 1 = URL, Column 2 = filename.', 'error');
              done();
              return;
            }
            go(entries, done);
          }).catch(function (err) {
            showMessage(err.message || 'Failed to read CSV.', 'error');
            done();
          });
        } else {
          var sheetName = (document.getElementById('sheet_name') || {}).value;
          sheetName = (sheetName && sheetName.trim()) ? sheetName.trim() : '0';
          if (/^\d+$/.test(sheetName)) sheetName = parseInt(sheetName, 10);
          file.arrayBuffer().then(function (buf) {
            entries = extractFromExcelWithNames(buf, sheetName);
            if (!entries.length) {
              showMessage('No URLs in sheet. Use Column A = URL, Column B = filename.', 'error');
              done();
              return;
            }
            go(entries, done);
          }).catch(function (err) {
            showMessage(err.message || 'Failed to read file.', 'error');
            done();
          });
        }
        return;
      }

      if (pasteText) {
        entries = extractUrlsFromText(pasteText);
      }

      if (!entries.length) {
        showMessage('No URLs found. Upload CSV/Excel (Column 1 = URL, Column 2 = filename) or paste links.', 'error');
        done();
        return;
      }

      go(entries, done);
    });

    function go(entries, done) {
      showMessage('Downloading ' + entries.length + ' link(s)...', 'success');

      var timeout = 30;
      var timeoutEl = document.getElementById('timeout');
      if (timeoutEl && timeoutEl.value) {
        var t = parseInt(timeoutEl.value, 10);
        if (t >= 10 && t <= 120) timeout = t;
      }

      var zip = new JSZip();
      var resultsRef;
      downloadAll(entries, timeout, zip).then(function (results) {
        resultsRef = results;
        var header = 'url,filename,status,error\n';
        var lines = results.map(function (r) {
          function esc(v) {
            return '"' + String(v || '').replace(/"/g, '""') + '"';
          }
          return [esc(r.url), esc(r.filename), esc(r.status), esc(r.error)].join(',');
        });
        zip.file('download_summary.csv', header + lines.join('\n'));

        return zip.generateAsync({ type: 'blob' });
      }).then(function (blob) {
        saveAs(blob, 'downloaded_urls.zip');
        var ok = 0;
        if (resultsRef) {
          for (var i = 0; i < resultsRef.length; i++) {
            if (resultsRef[i].status === 'ok') ok++;
          }
        }
        showMessage('Done: ' + ok + ' of ' + entries.length + ' downloaded. ZIP saved.', 'success');
      }).catch(function (err) {
        showMessage(err.message || 'Unexpected error.', 'error');
      }).then(done);
    }

    function switchTab(panelId) {
      var panels = document.querySelectorAll('.panel');
      var tabs = document.querySelectorAll('.tabs button');
      panels.forEach(function (p) {
        p.classList.toggle('active', p.id === panelId);
      });
      tabs.forEach(function (t) {
        var isActive = (t.id === 'tab-download' && panelId === 'panel-download') ||
          (t.id === 'tab-txt2md' && panelId === 'panel-txt2md');
        t.classList.toggle('active', isActive);
        t.setAttribute('aria-selected', isActive ? 'true' : 'false');
      });
    }

    document.getElementById('tab-download').addEventListener('click', function () {
      switchTab('panel-download');
    });
    document.getElementById('tab-txt2md').addEventListener('click', function () {
      switchTab('panel-txt2md');
    });

    var txt2mdBtn = document.getElementById('txt2mdBtn');
    var txtFilesInput = document.getElementById('txt_files');
    if (txt2mdBtn && txtFilesInput) {
      txt2mdBtn.addEventListener('click', function () {
        var files = txtFilesInput.files;
        if (!files || files.length === 0) {
          showMessage('Please select one or more .txt files.', 'error');
          return;
        }
        if (typeof JSZip === 'undefined' || typeof saveAs === 'undefined') {
          showMessage('Scripts failed to load.', 'error');
          return;
        }
        txt2mdBtn.disabled = true;
        showMessage('Converting ' + files.length + ' file(s)...', 'success');
        var zip = new JSZip();
        var done = 0;
        function next(i) {
          if (i >= files.length) {
            zip.generateAsync({ type: 'blob' }).then(function (blob) {
              saveAs(blob, 'txt-to-md.zip');
              showMessage('Done. ' + files.length + ' file(s) converted to .md in ZIP.', 'success');
            }).catch(function (err) {
              showMessage(err.message || 'Failed to create ZIP.', 'error');
            }).then(function () {
              txt2mdBtn.disabled = false;
            });
            return;
          }
          var file = files[i];
          var base = file.name.replace(/\.txt$/i, '');
          if (!base) base = 'file_' + i;
          var reader = new FileReader();
          reader.onload = function () {
            zip.file(base + '.md', reader.result);
            next(i + 1);
          };
          reader.onerror = function () {
            zip.file(base + '.md', '[read error]');
            next(i + 1);
          };
          reader.readAsText(file, 'UTF-8');
        }
        next(0);
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  } else {
    run();
  }
})();
