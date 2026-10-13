import os
import re
import threading
import time
from contextlib import asynccontextmanager
from typing import List, Optional

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from . import db, indexer, thumbs

IMAGES_DIR = os.environ.get("IMAGES_DIR", "/images")
DATA_DIR = os.environ.get("DATA_DIR", "/data")
REINDEX_MINUTES = int(os.environ.get("REINDEX_MINUTES", "30"))
THUMB_WORKERS = int(os.environ.get("THUMB_WORKERS", "2"))
STATIC_DIR = os.path.join(os.path.dirname(__file__), "static")

SOURCE_URLS = {"furaffinity": "https://www.furaffinity.net/view/{}/"}


def _sync_and_warm():
    indexer.run(IMAGES_DIR)
    thumbs.warm(DATA_DIR, IMAGES_DIR, THUMB_WORKERS)


def _periodic():
    while REINDEX_MINUTES > 0:
        time.sleep(REINDEX_MINUTES * 60)
        _sync_and_warm()


@asynccontextmanager
async def lifespan(app):
    os.makedirs(DATA_DIR, exist_ok=True)
    db.init(os.path.join(DATA_DIR, "index.sqlite3"))
    threading.Thread(target=_sync_and_warm, daemon=True).start()
    threading.Thread(target=_periodic, daemon=True).start()
    yield


app = FastAPI(lifespan=lifespan)

SORTS = {
    "new": "i.date DESC, i.id DESC",
    "old": "i.date ASC, i.id ASC",
    "fav": "i.favorites DESC, i.id DESC",
    "views": "i.views DESC, i.id DESC",
    "added": "i.mtime DESC, i.id DESC",
}


def _fts_query(q):
    toks = re.findall(r"\w+", q, flags=re.UNICODE)
    return " ".join(f'"{t}"*' for t in toks)


def _where(q, artist, tags, rating, site, starred):
    w, a = [], []
    if q:
        fq = _fts_query(q)
        if fq:
            w.append("i.id IN (SELECT rowid FROM fts WHERE fts MATCH ?)")
            a.append(fq)
    if artist:
        w.append("i.artist = ? COLLATE NOCASE")
        a.append(artist)
    for t in tags or []:
        w.append("EXISTS (SELECT 1 FROM tags t WHERE t.item_id = i.id AND t.tag = ?)")
        a.append(t.lower())
    if rating:
        w.append("i.rating = ?")
        a.append(rating)
    if site:
        w.append("i.site = ?")
        a.append(site)
    if starred:
        w.append("i.starred = 1")
    return (" WHERE " + " AND ".join(w)) if w else "", a


@app.get("/api/items")
def items(q: str = "", artist: str = "", tag: List[str] = Query(default=[]), rating: str = "",
          site: str = "", starred: bool = False, sort: str = "new", seed: int = 1,
          offset: int = 0, limit: int = Query(200, le=500), count: bool = False):
    c = db.connect()
    where, args = _where(q, artist, tag, rating, site, starred)
    if sort == "random":
        order = f"((i.id * 2654435761 + {int(seed)}) % 4294967296)"
    else:
        order = SORTS.get(sort, SORTS["new"])
    rows = c.execute(
        f"SELECT i.id, i.width w, i.height h, i.title t, i.artist a, i.kind k, i.starred s "
        f"FROM items i{where} ORDER BY {order} LIMIT ? OFFSET ?", [*args, limit, offset]).fetchall()
    out = {"items": [dict(r) for r in rows]}
    if count:
        out["total"] = c.execute(f"SELECT COUNT(*) FROM items i{where}", args).fetchone()[0]
    return out


@app.get("/api/items/{item_id}")
def item(item_id: int):
    c = db.connect()
    r = c.execute("SELECT * FROM items WHERE id=?", (item_id,)).fetchone()
    if not r:
        raise HTTPException(404)
    d = dict(r)
    d["tags"] = [t[0] for t in c.execute("SELECT tag FROM tags WHERE item_id=? ORDER BY tag", (item_id,))]
    d["filename"] = os.path.basename(d.pop("path"))
    src = SOURCE_URLS.get(d["site"])
    d["source_url"] = src.format(d["post_id"]) if src and d["post_id"] else None
    return d


@app.post("/api/items/{item_id}/star")
def star(item_id: int, value: bool = True):
    c = db.connect()
    c.execute("UPDATE items SET starred=? WHERE id=?", (int(value), item_id))
    c.commit()
    return {"starred": value}


@app.get("/api/artists")
def artists():
    rows = db.connect().execute(
        "SELECT artist name, COUNT(*) n, MAX(id) cover FROM items WHERE artist != '' "
        "GROUP BY artist COLLATE NOCASE ORDER BY artist COLLATE NOCASE").fetchall()
    return [dict(r) for r in rows]


@app.get("/api/tags")
def tags(q: str = "", limit: int = Query(60, le=500)):
    like = q.lower().replace("%", "").replace("_", r"\_") + "%"
    rows = db.connect().execute(
        "SELECT tag name, COUNT(*) n FROM tags WHERE tag LIKE ? ESCAPE '\\' GROUP BY tag "
        "ORDER BY n DESC LIMIT ?", (like, limit)).fetchall()
    return [dict(r) for r in rows]


@app.get("/api/status")
def status():
    c = db.connect()
    return {**indexer.status, "items": c.execute("SELECT COUNT(*) FROM items").fetchone()[0],
            "ratings": [r[0] for r in c.execute("SELECT DISTINCT rating FROM items WHERE rating != '' ORDER BY rating")]}


@app.post("/api/reindex")
def reindex():
    if not indexer.status["running"]:
        threading.Thread(target=_sync_and_warm, daemon=True).start()
    return {"started": True}


def _media(item_id):
    r = db.connect().execute("SELECT path, size, kind FROM items WHERE id=?", (item_id,)).fetchone()
    if not r:
        raise HTTPException(404)
    p = os.path.join(IMAGES_DIR, r["path"])
    if not os.path.isfile(p):
        raise HTTPException(404)
    return p, r


IMMUTABLE = {"Cache-Control": "public, max-age=31536000, immutable"}


@app.get("/thumb/{item_id}")
def thumb(item_id: int):
    p, r = _media(item_id)
    if r["kind"] != "image":
        raise HTTPException(404)
    try:
        return FileResponse(thumbs.ensure_thumb(DATA_DIR, p, item_id), media_type="image/webp", headers=IMMUTABLE)
    except Exception:
        raise HTTPException(404)


@app.get("/preview/{item_id}")
def preview(item_id: int):
    p, r = _media(item_id)
    if r["kind"] == "image":
        try:
            pv = thumbs.ensure_preview(DATA_DIR, p, item_id, r["size"])
            if pv:
                return FileResponse(pv, media_type="image/webp", headers=IMMUTABLE)
        except Exception:
            pass
    return FileResponse(p, headers={"Cache-Control": "public, max-age=86400"})


@app.get("/file/{item_id}")
def original(item_id: int):
    p, _ = _media(item_id)
    return FileResponse(p, headers={"Cache-Control": "public, max-age=86400"})


app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")
