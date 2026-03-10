"""Core logic: extract URLs from Excel or text, download to a directory."""

import io
import re
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
    for col in df.columns:
        sample = df[col].dropna().astype(str).head(20)
        if sample.str.match(r"https?://", na=False).any():
            return col
    raise ValueError("No URL column found. Specify the column name that contains URLs.")


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


def extract_urls_from_excel(
    excel_bytes: bytes,
    url_column: str | None = None,
    sheet_name: int | str = 0,
) -> list[str]:
    """Extract unique HTTP(S) URLs from an Excel file (bytes)."""
    df = pd.read_excel(io.BytesIO(excel_bytes), sheet_name=sheet_name, engine="openpyxl")
    col = find_url_column(df, url_column)
    urls = df[col].dropna().astype(str).str.strip()
    urls = urls[urls.str.match(r"https?://", na=False)].unique().tolist()
    return urls


def extract_urls_from_text(text: str) -> list[str]:
    """Extract URLs from plain text (one per line or space-separated)."""
    import re
    url_pattern = re.compile(r"https?://[^\s]+")
    urls = []
    for line in text.splitlines():
        urls.extend(url_pattern.findall(line))
    seen = set()
    unique = []
    for u in urls:
        u = u.strip().rstrip(".,;:)")
        if u not in seen:
            seen.add(u)
            unique.append(u)
    return unique


def download_url(
    url: str, session: requests.Session, timeout: int = 30
) -> tuple[bytes, str | None]:
    """Download content from URL. Returns (content, content_type)."""
    resp = session.get(url, timeout=timeout)
    resp.raise_for_status()
    content_type = resp.headers.get("Content-Type", "").split(";")[0].strip()
    return resp.content, content_type


def download_urls(
    urls: list[str],
    output_dir: Path,
    timeout: int = 30,
) -> list[dict]:
    """Download each URL into output_dir. Returns list of {url, path, status, error}."""
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    session = requests.Session()
    session.headers.update({"User-Agent": "URL-Downloader-Web/1.0"})
    results = []
    for i, url in enumerate(urls):
        row = {"url": url, "path": "", "status": "pending", "error": ""}
        try:
            content, content_type = download_url(url, session, timeout=timeout)
            ext = get_extension(content_type or "", url)
            base = sanitize_filename(url, i)
            if not base.endswith(ext):
                base += ext
            path = output_dir / base
            n = 0
            while path.exists():
                n += 1
                path = output_dir / f"{path.stem}_{n}{path.suffix}"
            path.write_bytes(content)
            row["path"] = str(path)
            row["status"] = "ok"
        except Exception as e:
            row["status"] = "error"
            row["error"] = str(e)
        results.append(row)
    return results
