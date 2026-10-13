import sqlite3
import threading

SCHEMA = """
CREATE TABLE IF NOT EXISTS items (
    id INTEGER PRIMARY KEY,
    path TEXT UNIQUE NOT NULL,      -- media file, relative to IMAGES_DIR, posix separators
    side_mtime REAL NOT NULL,       -- sidecar mtime, used for incremental indexing
    mtime REAL NOT NULL,            -- media file mtime ("recently added")
    size INTEGER NOT NULL,
    kind TEXT NOT NULL,             -- image | file
    site TEXT,
    post_id TEXT,
    title TEXT,
    artist TEXT,
    date TEXT,
    rating TEXT,
    category TEXT,
    species TEXT,
    theme TEXT,
    favorites INTEGER DEFAULT 0,
    views INTEGER DEFAULT 0,
    width INTEGER,
    height INTEGER,
    description TEXT,
    starred INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ix_items_date ON items(date);
CREATE INDEX IF NOT EXISTS ix_items_artist ON items(artist COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS ix_items_rating ON items(rating);
CREATE INDEX IF NOT EXISTS ix_items_fav ON items(favorites);
CREATE INDEX IF NOT EXISTS ix_items_mtime ON items(mtime);
CREATE TABLE IF NOT EXISTS tags (
    item_id INTEGER NOT NULL,
    tag TEXT NOT NULL,
    PRIMARY KEY (tag, item_id)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS ix_tags_item ON tags(item_id);
CREATE VIRTUAL TABLE IF NOT EXISTS fts USING fts5(
    title, artist, tags, description, tokenize = 'unicode61 remove_diacritics 2'
);
"""

_local = threading.local()
_path = None


def init(path):
    global _path
    _path = path
    c = connect()
    c.executescript(SCHEMA)
    c.commit()


def connect():
    """One connection per thread."""
    c = getattr(_local, "conn", None)
    if c is None:
        c = sqlite3.connect(_path, timeout=60)
        c.row_factory = sqlite3.Row
        c.execute("PRAGMA journal_mode=WAL")
        c.execute("PRAGMA synchronous=NORMAL")
        _local.conn = c
    return c
