#!/usr/bin/env python3
"""
Download data from URLs listed in an Excel sheet.
Reads URLs from a column, downloads each URL's content, and saves to files.
"""

import argparse
import os
import re
import sys
from pathlib import Path
from urllib.parse import urlparse

import pandas as pd
import requests


def sanitize_filename(url: str, index: int) -> str:
    """Create a safe filename from URL or index."""
    parsed = urlparse(url)
    name = (parsed.netloc or "download") + (parsed.path or "").strip("/")
    name = re.sub(r"[^\w\-_.]", "_", name)[:80]
    if not name:
        name = f"download_{index}"
    return name or f"download_{index}"


def find_url_column(df: pd.DataFrame, column: str | None) -> str:
    """Find the column containing URLs (by name or auto-detect)."""
    if column:
        if column not in df.columns:
            raise ValueError(f"Column '{column}' not found. Available: {list(df.columns)}")
        return column
    # Auto-detect: first column that looks like it has URLs
    for col in df.columns:
        sample = df[col].dropna().astype(str).head(20)
        if sample.str.match(r"https?://", na=False).any():
            return col
    raise ValueError(
        "No URL column found. Pass --url-column with the column name that contains URLs."
    )


def download_url(url: str, session: requests.Session, timeout: int = 30) -> tuple[bytes, str | None]:
    """Download content from URL. Returns (content, content_type)."""
    resp = session.get(url, timeout=timeout)
    resp.raise_for_status()
    content_type = resp.headers.get("Content-Type", "").split(";")[0].strip()
    return resp.content, content_type


def get_extension(content_type: str, url: str) -> str:
    """Guess file extension from Content-Type or URL."""
    ct_map = {
        "application/json": ".json",
        "text/html": ".html",
        "text/plain": ".txt",
        "text/csv": ".csv",
        "application/xml": ".xml",
        "text/xml": ".xml",
        "application/pdf": ".pdf",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
        "application/vnd.ms-excel": ".xls",
    }
    ext = ct_map.get(content_type)
    if ext:
        return ext
    path = urlparse(url).path
    if "." in path:
        return "." + path.rsplit(".", 1)[-1].lower()
    return ".bin"


def run(
    excel_path: str,
    output_dir: str = "downloads",
    url_column: str | None = None,
    sheet_name: str | int | None = 0,
    timeout: int = 30,
) -> pd.DataFrame:
    """Read Excel, download each URL, save files. Returns DataFrame with status."""
    excel_path = Path(excel_path)
    if not excel_path.exists():
        raise FileNotFoundError(f"Excel file not found: {excel_path}")

    out = Path(output_dir)
    out.mkdir(parents=True, exist_ok=True)

    df = pd.read_excel(excel_path, sheet_name=sheet_name, engine="openpyxl")
    col = find_url_column(df, url_column)

    urls = df[col].dropna().astype(str).str.strip()
    urls = urls[urls.str.match(r"https?://", na=False)].unique()

    session = requests.Session()
    session.headers.update({"User-Agent": "Excel-URL-Downloader/1.0"})

    results = []
    for i, url in enumerate(urls):
        row = {"url": url, "saved_path": "", "status": "pending", "error": ""}
        try:
            content, content_type = download_url(url, session, timeout=timeout)
            ext = get_extension(content_type or "", url)
            base = sanitize_filename(url, i)
            if not base.endswith(ext):
                base += ext
            # Avoid overwrites
            path = out / base
            n = 0
            while path.exists():
                n += 1
                path = out / f"{path.stem}_{n}{path.suffix}"
            path.write_bytes(content)
            row["saved_path"] = str(path)
            row["status"] = "ok"
        except Exception as e:
            row["status"] = "error"
            row["error"] = str(e)
        results.append(row)

    result_df = pd.DataFrame(results)
    summary_path = out / "download_summary.csv"
    result_df.to_csv(summary_path, index=False)
    print(f"Downloaded {sum(r['status'] == 'ok' for r in results)} of {len(results)} URLs.")
    print(f"Summary saved to: {summary_path}")
    return result_df


def main():
    parser = argparse.ArgumentParser(
        description="Download data from URLs listed in an Excel sheet."
    )
    parser.add_argument(
        "excel_file",
        help="Path to the Excel file (.xlsx) containing URLs",
    )
    parser.add_argument(
        "-o", "--output-dir",
        default="downloads",
        help="Directory to save downloaded files (default: downloads)",
    )
    parser.add_argument(
        "-c", "--url-column",
        default=None,
        help="Column name that contains URLs (auto-detected if not set)",
    )
    parser.add_argument(
        "-s", "--sheet",
        default=0,
        help="Sheet name or index (default: 0)",
    )
    parser.add_argument(
        "-t", "--timeout",
        type=int,
        default=30,
        help="Request timeout in seconds (default: 30)",
    )
    args = parser.parse_args()

    try:
        sheet = args.sheet
        if isinstance(sheet, str) and sheet.isdigit():
            sheet = int(sheet)
        run(
            excel_path=args.excel_file,
            output_dir=args.output_dir,
            url_column=args.url_column or None,
            sheet_name=sheet,
            timeout=args.timeout,
        )
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
