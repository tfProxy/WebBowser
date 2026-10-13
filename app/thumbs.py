import os
import threading
from concurrent.futures import ThreadPoolExecutor

from PIL import Image, ImageOps

from . import db

Image.MAX_IMAGE_PIXELS = None

THUMB_SIZE = 480
PREVIEW_SIZE = 2048
PREVIEW_MIN_BYTES = 1_500_000


def cache_path(data_dir, kind, item_id, ext="webp"):
    return os.path.join(data_dir, kind, str(item_id // 1000), f"{item_id}.{ext}")


def _render(src, dst, max_side, quality):
    with Image.open(src) as im:
        im.seek(0)
        if im.format == "JPEG":
            im.draft("RGB", (max_side * 2, max_side * 2))  # fast DCT-domain downscale
        im = ImageOps.exif_transpose(im)
        im.thumbnail((max_side, max_side), Image.LANCZOS)
        if im.mode not in ("RGB", "RGBA"):
            im = im.convert("RGBA" if "A" in im.getbands() or im.mode == "P" else "RGB")
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        tmp = f"{dst}.{threading.get_ident()}.tmp"
        im.save(tmp, "WEBP", quality=quality, method=4)
    os.replace(tmp, dst)


def ensure_thumb(data_dir, src, item_id):
    dst = cache_path(data_dir, "thumbs", item_id)
    if not os.path.exists(dst):
        _render(src, dst, THUMB_SIZE, 78)
    return dst


def ensure_preview(data_dir, src, item_id, size):
    """Returns a downscaled copy for large static images, or None if the original is fine."""
    if size < PREVIEW_MIN_BYTES or src.lower().endswith(".gif"):
        return None
    dst = cache_path(data_dir, "previews", item_id)
    if not os.path.exists(dst):
        _render(src, dst, PREVIEW_SIZE, 85)
    return dst


def warm(data_dir, root, workers):
    """Background pre-generation of thumbnails so scrolling is instant."""
    c = db.connect()
    rows = c.execute("SELECT id, path FROM items WHERE kind='image' ORDER BY date DESC, id DESC").fetchall()
    todo = [(r["id"], r["path"]) for r in rows if not os.path.exists(cache_path(data_dir, "thumbs", r["id"]))]

    def one(t):
        try:
            ensure_thumb(data_dir, os.path.join(root, t[1]), t[0])
        except Exception:
            pass

    with ThreadPoolExecutor(max_workers=max(1, workers)) as ex:
        list(ex.map(one, todo))
