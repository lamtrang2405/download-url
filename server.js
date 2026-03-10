const express = require('express');
const multer = require('multer');
const archiver = require('archiver');
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');
const os = require('os');

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

app.use(express.urlencoded({ extended: true }));
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const URL_REGEX = /^https?:\/\//i;
const URL_IN_TEXT = /https?:\/\/[^\s]+/g;

function extractUrlsFromExcel(buffer, urlColumn = null, sheetName = 0) {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const name = typeof sheetName === 'number'
    ? workbook.SheetNames[sheetName]
    : sheetName;
  const sheet = workbook.Sheets[name || workbook.SheetNames[0]];
  if (!sheet) throw new Error('Sheet not found');
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  if (rows.length === 0) return [];
  const header = rows[0].map(String);
  let colIndex = -1;
  if (urlColumn) {
    colIndex = header.findIndex(h => h.trim().toLowerCase() === urlColumn.trim().toLowerCase());
    if (colIndex === -1) throw new Error(`Column "${urlColumn}" not found. Available: ${header.join(', ')}`);
  } else {
    for (let i = 0; i < header.length; i++) {
      const sample = rows.slice(1, 21).map(r => String(r[i] || '').trim());
      if (sample.some(s => URL_REGEX.test(s))) {
        colIndex = i;
        break;
      }
    }
    if (colIndex === -1) throw new Error('No column with URLs found. Specify the URL column name.');
  }
  const urls = [];
  const seen = new Set();
  for (let i = 1; i < rows.length; i++) {
    const val = String(rows[i][colIndex] ?? '').trim();
    if (URL_REGEX.test(val) && !seen.has(val)) {
      seen.add(val);
      urls.push(val);
    }
  }
  return urls;
}

function extractUrlsFromText(text) {
  const urls = [];
  const seen = new Set();
  text.split(/\r?\n/).forEach(line => {
    const matches = line.match(URL_IN_TEXT) || [];
    matches.forEach(u => {
      const url = u.replace(/[.,;:)]+$/, '').trim();
      if (url && !seen.has(url)) {
        seen.add(url);
        urls.push(url);
      }
    });
  });
  return urls;
}

function sanitizeFilename(url, index) {
  try {
    const u = new URL(url);
    let name = (u.hostname || 'download') + (u.pathname || '').replace(/^\//, '').replace(/\//g, '_');
    name = name.replace(/[^\w\-_.]/g, '_').slice(0, 80) || `download_${index}`;
    return name;
  } catch {
    return `download_${index}`;
  }
}

function getExtension(contentType, url) {
  const map = {
    'application/json': '.json',
    'text/html': '.html',
    'text/plain': '.txt',
    'text/csv': '.csv',
    'application/xml': '.xml',
    'text/xml': '.xml',
    'application/pdf': '.pdf',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
    'application/vnd.ms-excel': '.xls',
  };
  const ct = (contentType || '').split(';')[0].trim();
  if (map[ct]) return map[ct];
  const p = url.split('?')[0];
  const m = p.match(/\.([a-z0-9]+)$/i);
  return m ? '.' + m[1].toLowerCase() : '.bin';
}

async function downloadUrl(url, timeoutMs = 30000) {
  const controller = new AbortController();
  const to = setTimeout(() => controller.abort(), timeoutMs);
  const res = await fetch(url, {
    signal: controller.signal,
    headers: { 'User-Agent': 'URL-Downloader-Web/1.0' },
    redirect: 'follow',
  });
  clearTimeout(to);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const contentType = res.headers.get('Content-Type') || '';
  return { buffer: buf, contentType };
}

async function downloadAll(urls, timeoutSec = 30) {
  const timeoutMs = Math.min(120, Math.max(10, timeoutSec)) * 1000;
  const results = [];
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'url_dl_'));
  const usedNames = new Set();

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    const row = { url, path: '', status: 'pending', error: '' };
    try {
      const { buffer, contentType } = await downloadUrl(url, timeoutMs);
      const ext = getExtension(contentType, url);
      let base = sanitizeFilename(url, i);
      if (!base.endsWith(ext)) base += ext;
      let filePath = path.join(outDir, base);
      let n = 0;
      while (usedNames.has(path.basename(filePath)) || fs.existsSync(filePath)) {
        n++;
        const stem = path.basename(base, ext);
        filePath = path.join(outDir, `${stem}_${n}${ext}`);
      }
      usedNames.add(path.basename(filePath));
      fs.writeFileSync(filePath, buffer);
      row.path = filePath;
      row.status = 'ok';
    } catch (err) {
      row.status = 'error';
      row.error = err.message || String(err);
    }
    results.push(row);
  }

  return { outDir, results };
}

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.post('/download', upload.single('excel_file'), async (req, res) => {
  let urls = [];

  if (req.file && req.file.buffer && /\.(xlsx|xls)$/i.test(req.file.originalname)) {
    try {
      const urlColumn = (req.body.url_column || '').trim() || null;
      let sheetName = (req.body.sheet_name || '0').trim();
      if (/^\d+$/.test(sheetName)) sheetName = parseInt(sheetName, 10);
      urls = extractUrlsFromExcel(req.file.buffer, urlColumn, sheetName);
    } catch (e) {
      return res.status(400).send(JSON.stringify({ error: e.message }));
    }
  }

  if (urls.length === 0 && req.body.paste_urls) {
    urls = extractUrlsFromText(String(req.body.paste_urls).trim());
  }

  if (urls.length === 0) {
    return res.status(400).send(JSON.stringify({
      error: 'Provide an Excel file with URLs or paste URLs in the text area.',
    }));
  }

  const timeout = parseInt(req.body.timeout, 10) || 30;
  let outDir;
  try {
    const { outDir: dir, results } = await downloadAll(urls, timeout);
    outDir = dir;

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="downloaded_urls.zip"');
    const archive = archiver('zip', { zlib: { level: 6 } });
    archive.pipe(res);

    const files = fs.readdirSync(outDir);
    files.forEach(f => {
      archive.file(path.join(outDir, f), { name: f });
    });
    const summary = [
      'url,path,status,error',
      ...results.map(r => `"${r.url}","${r.path}","${r.status}","${r.error.replace(/"/g, '""')}"`),
    ].join('\n');
    archive.append(summary, { name: 'download_summary.csv' });
    await archive.finalize();

    archive.on('end', () => {
      try {
        files.forEach(f => fs.unlinkSync(path.join(outDir, f)));
        fs.rmdirSync(outDir);
      } catch (_) {}
    });
  } catch (e) {
    if (outDir && fs.existsSync(outDir)) {
      try {
        fs.readdirSync(outDir).forEach(f => fs.unlinkSync(path.join(outDir, f)));
        fs.rmdirSync(outDir);
      } catch (_) {}
    }
    res.status(500).send(JSON.stringify({ error: e.message || String(e) }));
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`URL Downloader running at http://localhost:${PORT}`);
});
