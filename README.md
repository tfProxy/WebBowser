# Gallery

Touch-friendly browser for a large gallery-dl download folder. Python (FastAPI) + SQLite, no frontend build step.

- Indexes every `<file>.json` sidecar next to its media file (title, artist, tags, rating, date, description, favorites…)
- Full-text search, tag/artist/rating filters, sorting (newest, most favorited, random, …), local ★ starring
- Justified thumbnail grid with infinite scroll; thumbnails (480px webp) and large-image previews (2048px) are cached
- Viewer: swipe left/right, swipe down to close, pinch + double-tap zoom, tap for info sheet; arrow keys on desktop
- New downloads are picked up automatically (every `REINDEX_MINUTES`) or via the menu → "Scan for new images"

## Run on Unraid (Docker)

1. Copy this folder to the server, edit the two paths in `docker-compose.yml`
   (`/images` = your gallery-dl `base-directory`, mounted read-only; `/data` = index + thumbnail cache).
2. `docker compose up -d --build`, then open `http://<tailscale-name>:8000` on the iPad
   (Safari → Share → *Add to Home Screen* gives a full-screen app).

The first scan of ~100k files takes several minutes and thumbnails are generated in the background
(newest first); anything not yet cached is generated on demand. `/data` can be deleted at any time — it is rebuilt,
except for ★ stars, which live in `index.sqlite3`.

## Run locally in VS Code

Prerequisites: Python 3.10+ and the VS Code *Python* extension (it provides the `debugpy` debugger).

1. **Create a virtual environment and install dependencies.** In a VS Code terminal (Ctrl+`) at the project root:

       python -m venv .venv
       .venv\Scripts\Activate.ps1
       pip install -r requirements.txt

   Then press Ctrl+Shift+P → *Python: Select Interpreter* → pick `.venv`.
   (If PowerShell blocks the activate script: `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`.)
2. **Point it at your images.** Open [.vscode/launch.json](.vscode/launch.json) and set `IMAGES_DIR` to your gallery-dl
   `base-directory`, i.e. the folder that contains `furaffinity/`.   The index and thumbnail cache go to `.data/` in the project (delete it any time to start fresh).
3. **Start it.** Press F5 (Run and Debug → *Gallery (local test)*). Breakpoints in `app/*.py` work, and
   `--reload` restarts the server when you edit Python files. Static files (`app/static`) are served from disk,
   so just refresh the browser after editing them.
4. **Open** <http://localhost:8000>. The first scan runs in the background and the grid fills as items are indexed
   (watch progress under ☰ menu). `http://localhost:8000/docs` shows the API.

### Testing on the iPad before deploying

Run the server on all interfaces by changing `args` in `launch.json` to
`["app.main:app", "--host", "0.0.0.0", "--port", "8000"]` (allow it through Windows Firewall when prompted), then browse to
`http://<your-pc-tailscale-name>:8000` from the iPad. Touch gestures can't be fully checked in a desktop browser;
Chrome DevTools device emulation (F12 → Ctrl+Shift+M) is a reasonable approximation for swipe and pinch (Shift+drag).

### Without VS Code's debugger

    $env:IMAGES_DIR = "C:\path\to\gallery-dl"; $env:DATA_DIR = ".data"
    uvicorn app.main:app --port 8000 --reload

## Notes

- Only media files that have a `.json` sidecar are indexed. Non-image files (pdf, swf, txt…) show as a file tile with an "Open file" button.
- Artist = `artist_url` from the sidecar (falls back to `artist`, then the folder name), so other gallery-dl sites work too;
  the "Source page" link is currently only built for FurAffinity (`SOURCE_URLS` in `app/main.py`).
- No authentication, by design: keep it reachable only over Tailscale.
