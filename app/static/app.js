"use strict";
const $ = (s) => document.querySelector(s);
const grid = $("#grid"), viewer = $("#viewer"), stage = $("#stage"), vimg = $("#vimg"), sheet = $("#sheet");

let F = {};                 // current filters, mirrored in location.hash
let items = [], total = 0, loading = false, done = false, gen = 0;
let viewerOpen = false, pendingPatch = null;

/* ---------- filters <-> hash ---------- */
function parseHash() {
  const p = new URLSearchParams(location.hash.slice(1));
  return { q: p.get("q") || "", artist: p.get("artist") || "", tag: p.getAll("tag"), sort: p.get("sort") || "new",
    rating: p.get("rating") || "", starred: p.get("starred") === "1", seed: +p.get("seed") || 1, view: p.get("view") || "grid" };
}
function hashOf(f) {
  const p = new URLSearchParams();
  if (f.view !== "grid") p.set("view", f.view);
  if (f.q) p.set("q", f.q);
  if (f.artist) p.set("artist", f.artist);
  f.tag.forEach((t) => p.append("tag", t));
  if (f.sort !== "new") p.set("sort", f.sort);
  if (f.sort === "random") p.set("seed", f.seed);
  if (f.rating) p.set("rating", f.rating);
  if (f.starred) p.set("starred", "1");
  return p.toString();
}
function go(patch) {            // navigate to modified filters; closes the viewer first if open
  if (viewerOpen) { pendingPatch = patch; history.back(); return; }
  const n = { ...F, ...patch };
  if (!("view" in patch)) n.view = "grid";
  location.hash = hashOf(n);
}
window.addEventListener("hashchange", apply);

function apply() {
  F = parseHash();
  $("#tabBrowse").classList.toggle("on", F.view === "grid");
  $("#tabArtists").classList.toggle("on", F.view === "artists");
  $("#browse").hidden = F.view !== "grid";
  $("#artistsView").hidden = F.view !== "artists";
  $("#search").value = F.q;
  $("#sortSel").value = F.sort; $("#ratingSel").value = F.rating; $("#starredChk").checked = F.starred;
  if (F.view === "artists") { loadArtists(); renderFilters(); return; }
  gen++; items = []; total = 0; done = false; loading = false;
  grid.innerHTML = ""; grid.style.height = "0";
  $("#empty").hidden = true;
  window.scrollTo(0, 0);
  renderFilters();
  loadMore();
}

function renderFilters() {
  const box = $("#filters"); box.innerHTML = "";
  const chip = (label, onclick) => { const b = document.createElement("button"); b.className = "chip x"; b.textContent = label; b.onclick = onclick; box.append(b); };
  if (F.view !== "grid") return;
  if (F.artist) chip("artist: " + F.artist, () => go({ artist: "" }));
  F.tag.forEach((t) => chip("#" + t, () => go({ tag: F.tag.filter((x) => x !== t) })));
  if (F.rating) chip(F.rating, () => go({ rating: "" }));
  if (F.starred) chip("★ starred", () => go({ starred: false }));
  const n = document.createElement("span"); n.id = "count"; n.textContent = total ? total.toLocaleString() + " items" : ""; box.append(n);
}

/* ---------- grid ---------- */
function qs() {
  const p = new URLSearchParams();
  ["q", "artist", "sort", "rating"].forEach((k) => F[k] && p.set(k, F[k]));
  F.tag.forEach((t) => p.append("tag", t));
  if (F.starred) p.set("starred", "true");
  if (F.sort === "random") p.set("seed", F.seed);
  return p;
}
async function loadMore() {
  if (loading || done) return;
  loading = true;
  const g = gen, p = qs();
  p.set("offset", items.length); p.set("limit", 200);
  if (!items.length) p.set("count", "true");
  let r;
  try { r = await (await fetch("/api/items?" + p)).json(); } catch { if (g === gen) loading = false; return; }
  if (g !== gen) return;
  loading = false;
  if (r.total != null) { total = r.total; renderFilters(); }
  if (r.items.length < 200) done = true;
  for (const it of r.items) { it.el = makeTile(items.length); items.push(it); decorate(it); grid.append(it.el); }
  $("#empty").hidden = items.length > 0;
  layout();
  if (viewerOpen) updateNav();
}
function makeTile(i) {
  const el = document.createElement("div"); el.className = "tile"; el.dataset.i = i; return el;
}
function decorate(it) {
  if (it.k === "image") {
    const im = document.createElement("img");
    im.loading = "lazy"; im.decoding = "async"; im.alt = ""; im.draggable = false;
    im.src = "/thumb/" + it.id;
    im.onload = () => im.classList.add("ok");
    it.el.append(im);
  } else { it.el.classList.add("file"); it.el.textContent = it.t; }
  if (it.s) addStar(it);
}
function addStar(it) { const s = document.createElement("span"); s.className = "star"; s.textContent = "★"; it.el.append(s); }
grid.addEventListener("click", (e) => { const t = e.target.closest(".tile"); if (t) openViewer(+t.dataset.i); });

function layout() {
  const W = grid.clientWidth; if (!W) return;
  const H = W < 600 ? 120 : W < 1100 ? 180 : 230, gap = 4;
  let row = [], sum = 0, y = 0;
  const flush = (last) => {
    if (!row.length) return;
    const avail = W - gap * (row.length - 1);
    let h = avail / sum; if (last) h = Math.min(h, H);
    let x = 0;
    for (const { it, r } of row) {
      const w = r * h, s = it.el.style;
      s.left = x + "px"; s.top = y + "px"; s.width = w + "px"; s.height = h + "px";
      x += w + gap;
    }
    y += h + gap; row = []; sum = 0;
  };
  for (const it of items) {
    const r = Math.min(2.5, Math.max(0.4, it.w && it.h ? it.w / it.h : 1));
    row.push({ it, r }); sum += r;
    if (sum * H + gap * (row.length - 1) >= W) flush(false);
  }
  flush(true);
  grid.style.height = y + "px";
}
let lastW = 0;
new ResizeObserver(() => { if (grid.clientWidth !== lastW) { lastW = grid.clientWidth; layout(); } }).observe(grid);
new IntersectionObserver((e) => { if (e[0].isIntersecting) loadMore(); }, { rootMargin: "1500px" }).observe($("#sentinel"));

/* ---------- artists ---------- */
let artists = null;
async function loadArtists() {
  if (!artists) artists = await (await fetch("/api/artists")).json();
  renderArtists();
}
function renderArtists() {
  const f = $("#artistFilter").value.trim().toLowerCase(), list = $("#artistList");
  list.innerHTML = "";
  const frag = document.createDocumentFragment();
  for (const a of artists) {
    if (f && !a.name.toLowerCase().includes(f)) continue;
    const d = document.createElement("div"); d.className = "artist";
    const im = document.createElement("img"); im.loading = "lazy"; im.src = "/thumb/" + a.cover; im.alt = "";
    const n = document.createElement("div"); n.textContent = a.name + " "; const s = document.createElement("small"); s.textContent = a.n; n.append(s);
    d.append(im, n); d.onclick = () => go({ view: "grid", artist: a.name });
    frag.append(d);
  }
  list.append(frag);
}
$("#artistFilter").addEventListener("input", () => artists && renderArtists());

/* ---------- header / menu ---------- */
$("#searchForm").addEventListener("submit", (e) => { e.preventDefault(); $("#search").blur(); go({ q: $("#search").value.trim() }); });
$("#menuBtn").onclick = () => { $("#menu").hidden = false; refreshStatus(); };
$("#menuClose").onclick = () => { $("#menu").hidden = true; };
$("#menu").addEventListener("click", (e) => { if (e.target.id === "menu") $("#menu").hidden = true; });
$("#sortSel").onchange = (e) => go({ sort: e.target.value, seed: Math.floor(Math.random() * 1e9) });
$("#ratingSel").onchange = (e) => go({ rating: e.target.value });
$("#starredChk").onchange = (e) => go({ starred: e.target.checked });
$("#shuffleBtn").onclick = () => { $("#menu").hidden = true; go({ sort: "random", seed: Math.floor(Math.random() * 1e9) }); };
$("#reindexBtn").onclick = async () => { await fetch("/api/reindex", { method: "POST" }); artists = null; setTimeout(refreshStatus, 800); };
async function refreshStatus() {
  const s = await (await fetch("/api/status")).json();
  const sel = $("#ratingSel");
  if (sel.options.length === 1) s.ratings.forEach((r) => sel.add(new Option(r, r)));
  sel.value = F.rating;
  $("#statusTxt").textContent = s.running
    ? `Scanning… ${s.scanned.toLocaleString()} files (${s.added} new)`
    : `${s.items.toLocaleString()} items indexed.` + (s.finished ? ` Last scan: +${s.added} new, ${s.updated} updated, ${s.removed} removed.` : "") + (s.error ? " Error: " + s.error : "");
  if (s.running) setTimeout(() => !$("#menu").hidden && refreshStatus(), 1500);
}

/* ---------- viewer ---------- */
const V = { i: 0, scale: 1, x: 0, y: 0 };
const detailCache = new Map();
let chromeTimer = null;

function openViewer(i) {
  viewerOpen = true;
  history.pushState({ v: 1 }, "", location.href);
  document.body.classList.add("noscroll");
  viewer.hidden = false; viewer.classList.remove("chromeless");
  show(i);
}
function hideViewer() {
  viewerOpen = false; viewer.hidden = true; sheet.classList.remove("open");
  document.body.classList.remove("noscroll"); vimg.removeAttribute("src");
  const t = items[V.i]; if (t && t.el) t.el.scrollIntoView({ block: "nearest" });
}
window.addEventListener("popstate", () => {
  if (viewerOpen && !(history.state && history.state.v)) {
    hideViewer();
    if (pendingPatch) { const p = pendingPatch; pendingPatch = null; go(p); }
  }
});
const closeViewer = () => history.back();

function applyTransform(animate) {
  vimg.style.transition = animate ? "transform .2s ease-out" : "none";
  vimg.style.transform = `translate(${V.x}px, ${V.y}px) scale(${V.scale})`;
}
function resetZoom() { V.scale = 1; V.x = V.y = 0; applyTransform(false); vimg.style.opacity = 1; }

function show(i) {
  if (i < 0 || i >= items.length) return;
  V.i = i; resetZoom();
  const it = items[i];
  $("#vTitle").textContent = it.t;
  $("#vStar").classList.toggle("on", !!it.s); $("#vStar").textContent = it.s ? "★" : "☆";
  const isImg = it.k === "image";
  vimg.hidden = !isImg; $("#nofile").hidden = isImg;
  if (isImg) {
    vimg.src = "/thumb/" + it.id;                       // instant placeholder
    const hi = new Image();
    hi.onload = () => { if (V.i === i) vimg.src = hi.src; };
    hi.src = "/preview/" + it.id;
  } else {
    $("#nofileName").textContent = it.t; $("#nofileLink").href = "/file/" + it.id;
  }
  for (const j of [i + 1, i - 1, i + 2]) if (items[j] && items[j].k === "image") new Image().src = "/preview/" + items[j].id;
  if (i >= items.length - 6) loadMore();
  updateNav();
  if (sheet.classList.contains("open")) renderSheet(it);
}
function updateNav() { $("#vPrev").style.visibility = V.i > 0 ? "" : "hidden"; $("#vNext").style.visibility = V.i < items.length - 1 ? "" : "hidden"; }
const next = () => show(V.i + 1), prev = () => show(V.i - 1);
$("#vPrev").onclick = prev; $("#vNext").onclick = next; $("#vClose").onclick = closeViewer;

async function toggleStar() {
  const it = items[V.i]; it.s = it.s ? 0 : 1;
  await fetch(`/api/items/${it.id}/star?value=${!!it.s}`, { method: "POST" });
  const old = it.el.querySelector(".star"); if (old) old.remove(); if (it.s) addStar(it);
  const d = detailCache.get(it.id); if (d) d.starred = it.s;
  $("#vStar").classList.toggle("on", !!it.s); $("#vStar").textContent = it.s ? "★" : "☆";
}
$("#vStar").onclick = toggleStar;

async function renderSheet(it) {
  const body = $("#sheetBody"); body.textContent = "";
  let d = detailCache.get(it.id);
  if (!d) { d = await (await fetch("/api/items/" + it.id)).json(); detailCache.set(it.id, d); }
  if (items[V.i] !== it) return;
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  body.append(el("h2", "", d.title));
  const meta = el("div", "meta");
  const a = el("a", "", d.artist); a.href = "#"; a.onclick = (e) => { e.preventDefault(); go({ artist: d.artist }); };
  meta.append("by ", a, ` · ${d.date || "unknown date"}`);
  body.append(meta);
  const bits = [d.rating, d.category, d.species, d.theme, d.width ? `${d.width}×${d.height}` : "", fmtSize(d.size),
    d.favorites ? `♥ ${d.favorites.toLocaleString()}` : "", d.views ? `${d.views.toLocaleString()} views` : ""].filter(Boolean);
  body.append(el("div", "meta", bits.join(" · ")));
  if (d.tags.length) {
    const t = el("div", "tags");
    d.tags.forEach((x) => { const c = el("button", "chip", "#" + x); c.onclick = () => go({ tag: [...F.tag.filter((y) => y !== x), x] }); t.append(c); });
    body.append(t);
  }
  const links = el("div", "links");
  const orig = el("a", "btn", "Original"); orig.href = "/file/" + d.id; orig.target = "_blank"; links.append(orig);
  if (d.source_url) { const s = el("a", "btn", "Source page"); s.href = d.source_url; s.target = "_blank"; s.rel = "noreferrer"; links.append(s); }
  body.append(links);
  if (d.description) body.append(el("div", "desc", d.description));
}
const fmtSize = (n) => (n > 1e6 ? (n / 1e6).toFixed(1) + " MB" : Math.round(n / 1e3) + " KB");
function toggleSheet(force) {
  const open = force != null ? force : !sheet.classList.contains("open");
  sheet.classList.toggle("open", open);
  if (open) renderSheet(items[V.i]);
}
$("#vInfo").onclick = () => toggleSheet();

/* gestures: swipe to navigate / close, pinch + double-tap zoom, drag to pan, wheel zoom */
const ptrs = new Map();
let g = null, lastTap = { t: 0, x: 0, y: 0 }, tapTimer = null;

function zoomAt(s2, px, py) {               // px,py relative to stage centre
  s2 = Math.min(8, Math.max(1, s2));
  V.x = px - (px - V.x) * s2 / V.scale; V.y = py - (py - V.y) * s2 / V.scale; V.scale = s2;
  if (s2 === 1) V.x = V.y = 0; else clampPan();
}
function clampPan() {
  const r = stage.getBoundingClientRect();
  const mx = Math.max(0, (vimg.clientWidth * V.scale - r.width) / 2), my = Math.max(0, (vimg.clientHeight * V.scale - r.height) / 2);
  V.x = Math.min(mx, Math.max(-mx, V.x)); V.y = Math.min(my, Math.max(-my, V.y));
}
const rel = (e) => { const r = stage.getBoundingClientRect(); return [e.clientX - r.left - r.width / 2, e.clientY - r.top - r.height / 2]; };

stage.addEventListener("pointerdown", (e) => {
  stage.setPointerCapture(e.pointerId);
  ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (ptrs.size === 2) {
    const [a, b] = [...ptrs.values()];
    g = { mode: "pinch", d0: Math.hypot(a.x - b.x, a.y - b.y), s0: V.scale };
  } else if (ptrs.size === 1) {
    g = { mode: "one", x0: e.clientX, y0: e.clientY, t0: performance.now(), ox: V.x, oy: V.y, moved: false, axis: null };
  }
});
stage.addEventListener("pointermove", (e) => {
  if (!ptrs.has(e.pointerId)) return;
  const prevPt = ptrs.get(e.pointerId); ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (!g) return;
  if (g.mode === "pinch" && ptrs.size === 2) {
    const [a, b] = [...ptrs.values()];
    const r = stage.getBoundingClientRect();
    const cx = (a.x + b.x) / 2 - r.left - r.width / 2, cy = (a.y + b.y) / 2 - r.top - r.height / 2;
    zoomAt(g.s0 * Math.hypot(a.x - b.x, a.y - b.y) / g.d0, cx, cy);
    applyTransform(false);
  } else if (g.mode === "one") {
    const dx = e.clientX - g.x0, dy = e.clientY - g.y0;
    if (!g.moved && Math.hypot(dx, dy) > 8) g.moved = true;
    if (!g.moved) return;
    if (V.scale > 1) { V.x = g.ox + dx; V.y = g.oy + dy; clampPan(); applyTransform(false); return; }
    if (!g.axis) g.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
    if (g.axis === "x") { V.x = dx; vimg.style.opacity = 1; }
    else { V.y = Math.max(0, dy); vimg.style.opacity = Math.max(0.3, 1 - V.y / 400); }
    applyTransform(false);
  }
});
function endPtr(e) {
  if (!ptrs.has(e.pointerId)) return;
  ptrs.delete(e.pointerId);
  if (!g) return;
  if (g.mode === "pinch") { if (ptrs.size < 2) { g = null; if (V.scale < 1.05) { resetZoom(); } } return; }
  const gg = g; g = null;
  if (e.type === "pointercancel") { resetZoom(); return; }
  if (!gg.moved) { onTap(e); return; }
  if (V.scale > 1) return;
  const dt = performance.now() - gg.t0, dx = e.clientX - gg.x0, dy = e.clientY - gg.y0;
  if (gg.axis === "x" && (Math.abs(dx) > 70 || (Math.abs(dx) > 30 && Math.abs(dx) / dt > 0.5))) {
    if (dx < 0 && V.i < items.length - 1) return next();
    if (dx > 0 && V.i > 0) return prev();
  }
  if (gg.axis === "y" && (dy > 110 || (dy > 40 && dy / dt > 0.6))) return closeViewer();
  vimg.style.opacity = 1; V.x = V.y = 0; applyTransform(true);
}
stage.addEventListener("pointerup", endPtr);
stage.addEventListener("pointercancel", endPtr);

function onTap(e) {
  const now = performance.now();
  if (now - lastTap.t < 300 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 30) {
    clearTimeout(tapTimer); lastTap.t = 0;
    const [px, py] = rel(e);
    if (V.scale > 1) zoomAt(1, 0, 0); else zoomAt(2.5, px, py);
    applyTransform(true);
    return;
  }
  lastTap = { t: now, x: e.clientX, y: e.clientY };
  tapTimer = setTimeout(() => {
    if (sheet.classList.contains("open")) toggleSheet(false);
    else viewer.classList.toggle("chromeless");
  }, 280);
}
stage.addEventListener("wheel", (e) => {
  e.preventDefault();
  const [px, py] = rel(e);
  zoomAt(V.scale * Math.exp(-e.deltaY * 0.0015), px, py); applyTransform(false);
}, { passive: false });
document.addEventListener("gesturestart", (e) => e.preventDefault());   // stop Safari page-zoom
viewer.addEventListener("contextmenu", (e) => e.preventDefault());

document.addEventListener("keydown", (e) => {
  if (!viewerOpen) return;
  if (e.key === "Escape") sheet.classList.contains("open") ? toggleSheet(false) : closeViewer();
  else if (e.key === "ArrowRight") next();
  else if (e.key === "ArrowLeft") prev();
  else if (e.key === "i") toggleSheet();
  else if (e.key === "s") toggleStar();
});

apply();
