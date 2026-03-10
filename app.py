"""Web app: upload Excel or paste URLs, download from each URL, get a ZIP."""

import io
import zipfile
from pathlib import Path
from tempfile import mkdtemp
from uuid import uuid4

from flask import Flask, render_template, request, send_file, flash, redirect, url_for

from downloader import (
    download_urls,
    extract_urls_from_excel,
    extract_urls_from_text,
)

app = Flask(__name__)
app.secret_key = "change-in-production-" + str(uuid4())


@app.route("/", methods=["GET", "POST"])
def index():
    if request.method == "GET":
        return render_template("index.html")

    urls = []
    source = None

    # Option 1: Excel file
    file = request.files.get("excel_file")
    if file and file.filename and file.filename.lower().endswith((".xlsx", ".xls")):
        try:
            excel_bytes = file.read()
            url_column = (request.form.get("url_column") or "").strip() or None
            sheet_name = request.form.get("sheet_name", "0")
            if sheet_name.isdigit():
                sheet_name = int(sheet_name)
            urls = extract_urls_from_excel(excel_bytes, url_column=url_column, sheet_name=sheet_name)
            source = "Excel"
        except Exception as e:
            flash(f"Could not read Excel: {e}", "error")
            return redirect(url_for("index"))

    # Option 2: Paste URLs
    if not urls:
        text = (request.form.get("paste_urls") or "").strip()
        if text:
            urls = extract_urls_from_text(text)
            source = "Pasted links"

    if not urls:
        flash("Please upload an Excel file with URLs or paste URLs (one per line).", "error")
        return redirect(url_for("index"))

    timeout = int(request.form.get("timeout", "30") or "30")
    timeout = max(10, min(120, timeout))

    # Download to temp dir
    job_id = uuid4().hex[:10]
    out_dir = Path(mkdtemp(prefix=f"url_dl_{job_id}_"))

    try:
        results = download_urls(urls, out_dir, timeout=timeout)
    except Exception as e:
        flash(f"Download error: {e}", "error")
        return redirect(url_for("index"))

    # Build ZIP in memory
    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        for p in out_dir.iterdir():
            if p.is_file():
                zf.write(p, p.name)
        # Add summary CSV
        import csv
        summary = io.StringIO()
        writer = csv.DictWriter(summary, fieldnames=["url", "path", "status", "error"])
        writer.writeheader()
        for r in results:
            writer.writerow({k: r.get(k, "") for k in ["url", "path", "status", "error"]})
        zf.writestr("download_summary.csv", summary.getvalue())

    # Clean temp dir
    for p in out_dir.iterdir():
        p.unlink()
    out_dir.rmdir()

    zip_buffer.seek(0)
    return send_file(
        zip_buffer,
        mimetype="application/zip",
        as_attachment=True,
        download_name="downloaded_urls.zip",
    )


if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0", port=5000)
