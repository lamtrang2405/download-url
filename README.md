# URL Downloader — GitHub Pages app (no backend)

Import an Excel sheet or paste URL links; the app downloads everything **directly in your browser** and gives you a single ZIP.  
No Python, no Node server — pure static site, perfect for **GitHub Pages**.

**Repo:** [github.com/lamtrang2405/download-url](https://github.com/lamtrang2405/download-url)

## Use it on GitHub Pages

The main app is `index.html` at the repo root. To host it at:

> **https://lamtrang2405.github.io/download-url/**

1. Open the repo → **Settings** → **Pages**.
2. Under **Build and deployment**, set **Source** to **Deploy from a branch**.
3. Branch: **main**, Folder: **/ (root)** → **Save**.
4. Wait ~1–2 minutes. Then open `https://lamtrang2405.github.io/download-url/`.

On that page you can:

- Upload a `.xlsx` file (the URL column is auto-detected, or you can specify it).
- Or paste URLs (one per line).
- Click **Start download** → the browser fetches each URL and downloads `downloaded_urls.zip` (includes `download_summary.csv`).

> Note: Some URLs may fail because of **CORS** or authentication – that’s a browser limitation, not GitHub Pages.

## Optional: run locally

You can still run the Node or Python versions locally if you want:

- Node: `npm install` then `npm start`, open `http://localhost:5000`.
- Python CLI:  
  ```bash
  pip install -r requirements.txt
  python download_from_excel_urls.py "path/to/urls.xlsx"
  ```
