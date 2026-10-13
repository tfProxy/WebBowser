"""Scans IMAGES_DIR for gallery-dl sidecars (<media>.json) and syncs them into SQLite."""
import json
import os
import threading
import time

from PIL import Image

from . import db

Image.MAX_IMAGE_PIXELS = None

IMAGE_EXT = {".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".avif"}

status = {"running": False, "scanned": 0, "added": 0, "updated": 0, "removed": 0,
          "started": None, "finished": None, "error": None}
_lock = threading.Lock()


def _text(v):
    return v.replace("Â ", " ").replace(" ", " ") if isinstance(v, str) else v


def _int(v):
    try:
        return int(v)
    except (TypeError, ValueError):
        return 0


def _parse(meta, rel, ext, media_path):
    kind = "image" if ext in IMAGE_EXT else "file"
    parts = rel.split("/")
    artist = (meta.get("artist_url") or meta.get("artist") or meta.get("username")
              or (parts[-2] if len(parts) > 1 else "")) or ""
    w, h = _int(meta.get("width")), _int(meta.get("height"))
    if kind == "image" and not (w and h):
        try:
            with Image.open(media_path) as im:
                w, h = im.size
        except Exception:
            w = h = 0
    tags = meta.get("tags") or []
    if isinstance(tags, str):
        tags = tags.split()
    tags = sorted({str(t).strip().lower() for t in tags if str(t).strip()})
    date = meta.get("date")
    date = str(date).replace("T", " ")[:19] if date else ""
    title = _text(meta.get("title")) or os.path.splitext(parts[-1])[0]
    return {
        "kind": kind, "site": meta.get("category") or "",
        "post_id": str(meta.get("id") or ""), "title": title, "artist": str(artist),
        "date": date, "rating": meta.get("rating") or "",
        "category": meta.get("fa_category") or "", "species": meta.get("species") or "",
        "theme": meta.get("theme") or "", "favorites": _int(meta.get("favorites")),
        "views": _int(meta.get("views")), "width": w, "height": h,
        "description": _text(meta.get("description") or ""),
    }, tags


def _walk(root):
    """Yield (relative media path, ext, sidecar path, media path) for every media file with a sidecar."""
    stack = [root]
    while stack:
        d = stack.pop()
        try:
            with os.scandir(d) as it:
                entries = list(it)
        except OSError:
            continue
        names = {e.name for e in entries if e.is_file()}
        for e in entries:
            if e.is_dir():
                stack.append(e.path)
            elif e.name.endswith(".json") and e.name[:-5] in names:
                media = e.path[:-5]
                rel = os.path.relpath(media, root).replace(os.sep, "/")
                yield rel, os.path.splitext(media)[1].lower(), e.path, media


def run(root):
    if not _lock.acquire(blocking=False):
        return
    try:
        status.update(running=True, scanned=0, added=0, updated=0, removed=0,
                      started=time.time(), finished=None, error=None)
        c = db.connect()
        existing = {r["path"]: (r["id"], r["side_mtime"]) for r in c.execute("SELECT id, path, side_mtime FROM items")}
        seen = set()
        pending = 0
        for rel, ext, side, media in _walk(root):
            seen.add(rel)
            status["scanned"] += 1
            try:
                st = os.stat(side)
                ms = os.stat(media)
            except OSError:
                continue
            prev = existing.get(rel)
            if prev and prev[1] == st.st_mtime:
                continue
            try:
                with open(side, "r", encoding="utf-8") as f:
                    meta = json.load(f)
                fields, tags = _parse(meta, rel, ext, media)
            except Exception:
                continue
            if prev:
                item_id = prev[0]
                sets = ", ".join(f"{k}=?" for k in fields)
                c.execute(f"UPDATE items SET side_mtime=?, mtime=?, size=?, {sets} WHERE id=?",
                          [st.st_mtime, ms.st_mtime, ms.st_size, *fields.values(), item_id])
                c.execute("DELETE FROM tags WHERE item_id=?", (item_id,))
                c.execute("DELETE FROM fts WHERE rowid=?", (item_id,))
                status["updated"] += 1
            else:
                cols = ", ".join(fields)
                qs = ", ".join("?" * len(fields))
                cur = c.execute(f"INSERT INTO items (path, side_mtime, mtime, size, {cols}) VALUES (?,?,?,?,{qs})",
                                [rel, st.st_mtime, ms.st_mtime, ms.st_size, *fields.values()])
                item_id = cur.lastrowid
                status["added"] += 1
            c.executemany("INSERT OR IGNORE INTO tags (item_id, tag) VALUES (?,?)", [(item_id, t) for t in tags])
            c.execute("INSERT INTO fts (rowid, title, artist, tags, description) VALUES (?,?,?,?,?)",
                      (item_id, fields["title"], fields["artist"], " ".join(tags), fields["description"]))
            pending += 1
            if pending >= 2000:
                c.commit()
                pending = 0
        # Don't wipe the index if the library mount is missing/empty.
        gone = [(i,) for p, (i, _) in existing.items() if p not in seen]
        if seen and gone:
            c.executemany("DELETE FROM tags WHERE item_id=?", gone)
            c.executemany("DELETE FROM fts WHERE rowid=?", gone)
            c.executemany("DELETE FROM items WHERE id=?", gone)
            status["removed"] = len(gone)
        c.commit()
    except Exception as e:  # surfaced via /api/status
        status["error"] = repr(e)
    finally:
        status.update(running=False, finished=time.time())
        _lock.release()
