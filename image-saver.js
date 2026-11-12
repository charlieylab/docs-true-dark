// Runs in the page's MAIN world at document_start, before Google Docs creates
// its canvases. Docs paints pictures onto <canvas> with drawImage(), so there
// is no <img> to right-click. We watch drawImage() to remember which picture
// was painted where, then show a small "copy / download" bar when the mouse
// is over one. Copy puts a real PNG on the clipboard, which LINE, Discord,
// ChatGPT, Slack, etc. all accept.
(() => {
  if (window.__disInstalled) return;
  window.__disInstalled = true;

  const MIN_SIZE = 24; // CSS px; smaller draws are icons, not pictures
  const MAX_RECORDS = 300;

  // ---- what each image source is -----------------------------------------
  // For an <img>: its URL. For an ImageBitmap: whatever it was made from.
  const bitmapOrigin = new WeakMap(); // ImageBitmap -> { blob | url | el | canvasRecs }
  // Per canvas (on-screen or offscreen): pictures painted on it, in canvas px.
  const canvasRecs = new WeakMap(); // canvas -> [{ x, y, w, h, src }]

  const origCIB = window.createImageBitmap;
  if (origCIB) {
    window.createImageBitmap = function (source, ...rest) {
      const p = origCIB.call(this, source, ...rest);
      let origin = null;
      if (source instanceof Blob) origin = { blob: source };
      else if (source instanceof HTMLImageElement) origin = srcOf(source);
      else if (canvasRecs.has(source)) origin = { canvasRecs: canvasRecs.get(source).slice() };
      else if (source instanceof ImageBitmap) origin = bitmapOrigin.get(source) || null;
      if (origin) p.then((bmp) => bitmapOrigin.set(bmp, origin), () => {});
      return p;
    };
  }

  function srcOf(source) {
    if (source instanceof HTMLImageElement) {
      const url = source.currentSrc || source.src;
      return url ? { url, el: source } : null;
    }
    if (typeof ImageBitmap !== "undefined" && source instanceof ImageBitmap) {
      const o = bitmapOrigin.get(source);
      return o && !o.canvasRecs ? o : null;
    }
    return null;
  }

  // Records carried by a canvas-like source (offscreen tile, bitmap of one).
  function nestedRecs(source) {
    if (canvasRecs.has(source)) return canvasRecs.get(source);
    if (typeof ImageBitmap !== "undefined" && source instanceof ImageBitmap) {
      return bitmapOrigin.get(source)?.canvasRecs || null;
    }
    return null;
  }

  function sourceSize(s) {
    return [s.naturalWidth || s.videoWidth || s.width || 0, s.naturalHeight || s.videoHeight || s.height || 0];
  }

  // Axis-aligned bounding box of a rect after the context's transform.
  function bbox(ctx, x, y, w, h) {
    const m = ctx.getTransform();
    const pts = [[x, y], [x + w, y], [x, y + h], [x + w, y + h]].map(([px, py]) => [
      m.a * px + m.c * py + m.e,
      m.b * px + m.d * py + m.f,
    ]);
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    const x0 = Math.min(...xs), y0 = Math.min(...ys);
    return { x: x0, y: y0, w: Math.max(...xs) - x0, h: Math.max(...ys) - y0 };
  }

  function addRec(canvas, rec) {
    if (!(rec.w > 2 && rec.h > 2)) return;
    let list = canvasRecs.get(canvas);
    if (!list) canvasRecs.set(canvas, (list = []));
    // A repaint of the same spot replaces the old entry.
    for (let i = list.length - 1; i >= 0; i--) {
      const r = list[i];
      if (Math.abs(r.x - rec.x) < 1 && Math.abs(r.y - rec.y) < 1 && Math.abs(r.w - rec.w) < 1 && Math.abs(r.h - rec.h) < 1) {
        list.splice(i, 1);
      }
    }
    list.push(rec);
    if (list.length > MAX_RECORDS) list.splice(0, list.length - MAX_RECORDS);
  }

  // Painting over an area (clear / background fill) forgets pictures inside it.
  function forget(canvas, r) {
    const list = canvasRecs.get(canvas);
    if (!list) return;
    for (let i = list.length - 1; i >= 0; i--) {
      const p = list[i];
      if (p.x >= r.x - 0.5 && p.y >= r.y - 0.5 && p.x + p.w <= r.x + r.w + 0.5 && p.y + p.h <= r.y + r.h + 0.5) {
        list.splice(i, 1);
      }
    }
  }

  function patchContext(proto) {
    if (!proto) return;
    const draw = proto.drawImage;
    proto.drawImage = function (source, ...a) {
      try {
        let sx = 0, sy = 0, sw, sh, dx, dy, dw, dh;
        const [nw, nh] = sourceSize(source);
        if (a.length >= 8) [sx, sy, sw, sh, dx, dy, dw, dh] = a;
        else if (a.length >= 4) { [dx, dy, dw, dh] = a; sw = nw; sh = nh; }
        else { [dx, dy] = a; sw = dw = nw; sh = dh = nh; }
        const canvas = this.canvas;
        const src = srcOf(source);
        if (src) {
          addRec(canvas, { ...bbox(this, dx, dy, dw, dh), src });
        } else {
          // Canvas-to-canvas copy: carry over pictures inside the copied area.
          const inner = nestedRecs(source);
          if (inner && inner.length && sw && sh) {
            const kx = dw / sw, ky = dh / sh;
            for (const r of inner) {
              const x0 = Math.max(r.x, sx), y0 = Math.max(r.y, sy);
              const x1 = Math.min(r.x + r.w, sx + sw), y1 = Math.min(r.y + r.h, sy + sh);
              if (x1 - x0 < 2 || y1 - y0 < 2) continue;
              addRec(canvas, {
                ...bbox(this, dx + (x0 - sx) * kx, dy + (y0 - sy) * ky, (x1 - x0) * kx, (y1 - y0) * ky),
                src: r.src,
              });
            }
          }
        }
      } catch (_) {
        // Never let bookkeeping break Docs' painting.
      }
      return draw.call(this, source, ...a);
    };

    const clear = proto.clearRect;
    proto.clearRect = function (x, y, w, h) {
      try { forget(this.canvas, bbox(this, x, y, w, h)); } catch (_) {}
      return clear.call(this, x, y, w, h);
    };
    const fill = proto.fillRect;
    proto.fillRect = function (x, y, w, h) {
      try {
        // Only opaque fills hide what's under them.
        if (this.globalAlpha >= 1 && this.globalCompositeOperation === "source-over") {
          forget(this.canvas, bbox(this, x, y, w, h));
        }
      } catch (_) {}
      return fill.call(this, x, y, w, h);
    };
  }
  patchContext(window.CanvasRenderingContext2D?.prototype);
  patchContext(window.OffscreenCanvasRenderingContext2D?.prototype);

  // Resizing a canvas wipes it.
  for (const Cls of [window.HTMLCanvasElement, window.OffscreenCanvas]) {
    if (!Cls) continue;
    for (const prop of ["width", "height"]) {
      const d = Object.getOwnPropertyDescriptor(Cls.prototype, prop);
      if (!d?.set) continue;
      Object.defineProperty(Cls.prototype, prop, {
        ...d,
        set(v) {
          canvasRecs.delete(this);
          d.set.call(this, v);
        },
      });
    }
  }

  // ---- hit testing --------------------------------------------------------
  function hitTest(cx, cy) {
    // Real <img> elements (Docs still uses them in a few places).
    for (const el of document.elementsFromPoint(cx, cy)) {
      if (el instanceof HTMLImageElement && el.closest(".kix-appview-editor, .kix-page, .docs-editor")) {
        const r = el.getBoundingClientRect();
        if (r.width >= MIN_SIZE && r.height >= MIN_SIZE) {
          return { rect: r, src: { url: el.currentSrc || el.src, el } };
        }
      }
    }
    let best = null;
    for (const canvas of document.querySelectorAll("canvas")) {
      const list = canvasRecs.get(canvas);
      if (!list || !list.length) continue;
      const cr = canvas.getBoundingClientRect();
      if (cx < cr.left || cx > cr.right || cy < cr.top || cy > cr.bottom || !canvas.width) continue;
      const kx = cr.width / canvas.width, ky = cr.height / canvas.height;
      for (let i = list.length - 1; i >= 0; i--) {
        const p = list[i];
        const rect = new DOMRect(cr.left + p.x * kx, cr.top + p.y * ky, p.w * kx, p.h * ky);
        if (rect.width < MIN_SIZE || rect.height < MIN_SIZE) continue;
        if (cx >= rect.left && cx <= rect.right && cy >= rect.top && cy <= rect.bottom) {
          // Prefer the smallest picture under the cursor (inline over full-page).
          if (!best || rect.width * rect.height < best.rect.width * best.rect.height) {
            best = { rect, src: p.src, canvas, canvasRect: p };
          }
          break;
        }
      }
    }
    return best;
  }

  // ---- getting the picture's bytes ----------------------------------------
  let reqId = 0;
  function fetchViaExtension(url) {
    return new Promise((resolve, reject) => {
      const id = ++reqId;
      const timer = setTimeout(() => { removeEventListener("message", onMsg); reject(new Error("timeout")); }, 15000);
      function onMsg(e) {
        if (e.source !== window || e.data?.__dis !== "fetch-result" || e.data.id !== id) return;
        clearTimeout(timer);
        removeEventListener("message", onMsg);
        if (e.data.ok) resolve(new Blob([e.data.buffer], { type: e.data.type }));
        else reject(new Error(e.data.error || "fetch failed"));
      }
      addEventListener("message", onMsg);
      postMessage({ __dis: "fetch", id, url }, "*");
    });
  }

  async function fetchDirect(url) {
    const r = await fetch(url, { mode: url.startsWith("http") ? "cors" : undefined });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const b = await r.blob();
    if (!b.type.startsWith("image/")) throw new Error("not an image");
    return b;
  }

  function canvasToBlob(c) {
    return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("toBlob failed"))), "image/png"));
  }

  // Last resort: cut the picture out of what Docs has painted on screen.
  async function cropFromCanvas(hit) {
    if (!hit.canvas || !hit.canvasRect) throw new Error("no canvas");
    const p = hit.canvasRect;
    const c = document.createElement("canvas");
    c.width = Math.round(p.w);
    c.height = Math.round(p.h);
    c.getContext("2d").drawImage(hit.canvas, p.x, p.y, p.w, p.h, 0, 0, c.width, c.height);
    return canvasToBlob(c);
  }

  async function elementToBlob(el) {
    if (!el.complete || !el.naturalWidth) throw new Error("not loaded");
    const c = document.createElement("canvas");
    c.width = el.naturalWidth;
    c.height = el.naturalHeight;
    c.getContext("2d").drawImage(el, 0, 0);
    return canvasToBlob(c); // throws if the image is cross-origin tainted
  }

  async function getBlob(hit) {
    const src = hit.src || {};
    const tries = [];
    if (src.blob) tries.push(() => Promise.resolve(src.blob));
    if (src.url) {
      if (/^(blob|data):/.test(src.url)) tries.push(() => fetchDirect(src.url));
      else {
        tries.push(() => fetchViaExtension(src.url));
        tries.push(() => fetchDirect(src.url));
      }
    }
    if (src.el) tries.push(() => elementToBlob(src.el));
    tries.push(() => cropFromCanvas(hit));
    let lastErr;
    for (const t of tries) {
      try { return await t(); } catch (e) { lastErr = e; }
    }
    throw lastErr || new Error("無法取得圖片");
  }

  async function toPng(blob) {
    if (blob.type === "image/png") return blob;
    const bmp = await origCIB.call(window, blob);
    const c = document.createElement("canvas");
    c.width = bmp.width;
    c.height = bmp.height;
    c.getContext("2d").drawImage(bmp, 0, 0);
    bmp.close?.();
    return canvasToBlob(c);
  }

  // ---- actions --------------------------------------------------------------
  async function copyImage(hit) {
    // Pass the promise straight to ClipboardItem so the click still counts
    // as the user gesture while the image is being fetched.
    const png = getBlob(hit).then(toPng);
    await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
  }

  const EXT = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp", "image/svg+xml": "svg", "image/bmp": "bmp" };
  let dlCount = 0;
  async function downloadImage(hit) {
    const blob = await getBlob(hit);
    const title = (document.title || "Docs").replace(/\s*-\s*Google\s*(文件|Docs).*$/i, "").replace(/[\\/:*?"<>|]+/g, "_").trim() || "Docs";
    const name = `${title}-圖片${++dlCount}.${EXT[blob.type] || "png"}`;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.documentElement.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 30000);
  }

  // ---- floating bar ---------------------------------------------------------
  let host, bar, toast, current = null, hideTimer = 0, toastTimer = 0;

  // Docs enforces Trusted Types, so innerHTML is blocked: build every node
  // with DOM calls instead.
  const SVG_NS = "http://www.w3.org/2000/svg";
  const ICON_COPY = [
    ["rect", { x: 8, y: 8, width: 12, height: 12, rx: 2 }],
    ["path", { d: "M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" }],
  ];
  const ICON_DL = [["path", { d: "M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 19h14" }]];

  function icon(shapes) {
    const svg = document.createElementNS(SVG_NS, "svg");
    for (const [k, v] of Object.entries({ viewBox: "0 0 24 24", width: 16, height: 16, fill: "none", stroke: "currentColor", "stroke-width": 2, "stroke-linecap": "round", "stroke-linejoin": "round" })) {
      svg.setAttribute(k, v);
    }
    for (const [tag, attrs] of shapes) {
      const el = document.createElementNS(SVG_NS, tag);
      for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
      svg.appendChild(el);
    }
    return svg;
  }

  function button(act, title, shapes, label) {
    const b = document.createElement("button");
    b.dataset.act = act;
    b.title = title;
    const span = document.createElement("span");
    span.textContent = label;
    b.append(icon(shapes), span);
    return b;
  }

  function buildUI() {
    const h = document.createElement("div");
    h.style.cssText = "position:fixed;inset:0 auto auto 0;z-index:2147483647;pointer-events:none;";
    const root = h.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = `
        .bar{position:fixed;display:none;gap:2px;padding:3px;border-radius:10px;
          background:rgba(32,33,36,.92);box-shadow:0 2px 10px rgba(0,0,0,.35);
          pointer-events:auto;font:500 12px/1 system-ui,"Microsoft JhengHei",sans-serif;
          backdrop-filter:blur(6px);}
        .bar.show{display:flex}
        button{all:unset;display:flex;align-items:center;gap:5px;padding:6px 9px;border-radius:7px;
          color:#e8eaed;cursor:pointer;white-space:nowrap}
        button:hover{background:rgba(255,255,255,.14)}
        button:active{background:rgba(255,255,255,.22)}
        button[disabled]{opacity:.5;cursor:progress}
        .toast{position:fixed;left:50%;bottom:32px;transform:translateX(-50%) translateY(8px);
          padding:10px 16px;border-radius:10px;background:#202124;color:#fff;opacity:0;
          font:500 13px/1.2 system-ui,"Microsoft JhengHei",sans-serif;
          box-shadow:0 4px 16px rgba(0,0,0,.35);transition:opacity .2s,transform .2s;pointer-events:none}
        .toast.show{opacity:1;transform:translateX(-50%) translateY(0)}
        .toast.err{background:#b3261e}`;
    bar = document.createElement("div");
    bar.className = "bar";
    bar.append(
      button("copy", "複製圖片，可直接貼到其他軟體", ICON_COPY, "複製"),
      button("download", "下載圖片", ICON_DL, "下載")
    );
    toast = document.createElement("div");
    toast.className = "toast";
    root.append(style, bar, toast);

    // Keep Docs from seeing clicks on the bar (it would move the cursor or
    // deselect the picture).
    for (const t of ["mousedown", "mouseup", "pointerdown", "pointerup", "click", "dblclick", "contextmenu"]) {
      bar.addEventListener(t, (e) => {
        e.stopPropagation();
        if (t !== "click") e.preventDefault();
      });
    }
    bar.addEventListener("mouseenter", () => clearTimeout(hideTimer));
    bar.addEventListener("mouseleave", scheduleHide);
    bar.addEventListener("click", async (e) => {
      const btn = e.target.closest("button");
      if (!btn || !current || btn.disabled) return;
      const hit = current;
      btn.disabled = true;
      try {
        if (btn.dataset.act === "copy") {
          await copyImage(hit);
          showToast("已複製圖片，可以貼到其他軟體了");
        } else {
          await downloadImage(hit);
          showToast("圖片已下載");
        }
      } catch (err) {
        console.warn("[Docs True Dark]", err);
        showToast("失敗：" + (err?.message || err), true);
      } finally {
        btn.disabled = false;
      }
    });
    document.documentElement.appendChild(h);
    host = h; // only once the bar is fully built
  }

  function showToast(text, isErr) {
    toast.textContent = text;
    toast.classList.toggle("err", !!isErr);
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("show"), 2200);
  }

  function place(hit) {
    current = hit;
    clearTimeout(hideTimer);
    bar.classList.add("show");
    const r = hit.rect;
    const bw = bar.offsetWidth, bh = bar.offsetHeight;
    // Top-right corner inside the picture, clamped to the viewport.
    let x = Math.min(r.right, innerWidth) - bw - 8;
    let y = Math.max(r.top, 0) + 8;
    x = Math.max(8, Math.max(r.left + 4, x));
    y = Math.min(y, innerHeight - bh - 8);
    bar.style.left = x + "px";
    bar.style.top = y + "px";
  }

  function scheduleHide() {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      bar.classList.remove("show");
      current = null;
    }, 350);
  }

  let pending = false, lastX = 0, lastY = 0;
  function onMove(e) {
    lastX = e.clientX;
    lastY = e.clientY;
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      if (!host) return;
      // Over the bar itself: leave it where it is.
      const br = bar.getBoundingClientRect();
      if (bar.classList.contains("show") && lastX >= br.left && lastX <= br.right && lastY >= br.top && lastY <= br.bottom) return;
      const hit = hitTest(lastX, lastY);
      if (hit) place(hit);
      else if (bar.classList.contains("show")) scheduleHide();
    });
  }

  function start() {
    if (host) return;
    buildUI();
    addEventListener("mousemove", onMove, { capture: true, passive: true });
    // Scrolling moves the picture; hide until the mouse moves again.
    addEventListener("wheel", () => { bar.classList.remove("show"); current = null; }, { capture: true, passive: true });
    addEventListener("blur", () => { bar.classList.remove("show"); current = null; });
  }
  if (document.body) start();
  else document.addEventListener("DOMContentLoaded", start, { once: true });

  // For DevTools debugging.
  window.__disHitTest = hitTest;
})();
