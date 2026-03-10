# URL Downloader — Web app (no Python)

Import an Excel sheet or paste URL links; the app downloads everything and gives you a single ZIP. **Runs with Node.js only** (no Python).

## Get a live URL (hosted so you can just use it)

See **[HOSTING.md](HOSTING.md)** for the shortest way to get a public URL:

- **Render** or **Replit** (free): push this folder to GitHub, then connect the repo — you get a link like `https://your-app.onrender.com`.
- **Local only:** run `npm install` and `npm start`, then open **http://localhost:5000**.

## Run locally

```bash
npm install
npm start
```

Open **http://localhost:5000**. Upload a `.xlsx` file (with a column of URLs) or paste URLs in the text area, then click **Start download**. Your browser will get `downloaded_urls.zip` with all files and a `download_summary.csv`.

---

## Optional: Python command-line script

If you prefer the CLI with Python:

```bash
pip install -r requirements.txt
python download_from_excel_urls.py "path/to/urls.xlsx"
```

See the script’s `--help` for options (e.g. `-c` URL column, `-o` output dir, `-s` sheet).
