// Runs in the page's MAIN world at document_start, before Google Docs creates
// its canvases. Instead of inverting the canvas with a CSS filter (which also
// inverts pictures), we remap every *colour* Docs paints with. drawImage(),
// putImageData() and colour emoji are never touched, so images keep their
// exact original pixels.
(() => {
  if (window.__tddInstalled) return;
  window.__tddInstalled = true;

  const THEMES = {
    // OKLab lightness of the page background and of body text.
    dark: { bg: 0.235, fg: 0.9 },
    black: { bg: 0.0, fg: 0.88 },
    dim: { bg: 0.32, fg: 0.9 },
  };

  let cfg = {};
  try {
    cfg = JSON.parse(localStorage.getItem("tdd-settings") || "{}") || {};
  } catch (_) {}
  const mode = cfg.mode || "on"; // "on" | "off" | "auto"
  const active =
    mode === "on" ||
    (mode === "auto" && matchMedia("(prefers-color-scheme: dark)").matches);
  const themeName = THEMES[cfg.theme] ? cfg.theme : "dark";
  // ui.css keys off these attributes.
  document.documentElement.dataset.tddActive = active ? "1" : "0";
  document.documentElement.dataset.tddTheme = themeName;
  // Lets content.js know which settings this page was painted with.
  document.documentElement.dataset.tddApplied = JSON.stringify({ mode, theme: themeName });
  if (!active) return;

  const theme = THEMES[themeName];

  // ---- colour maths (sRGB <-> OKLab) -------------------------------------
  const toLin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const toSrgb = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

  function rgbToOklab(r, g, b) {
    r = toLin(r); g = toLin(g); b = toLin(b);
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    return [
      0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
      1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
      0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
    ];
  }

  function oklabToLinear(L, a, b) {
    const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
    const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
    const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
    return [
      4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
    ];
  }

  const inGamut = (rgb) => rgb.every((c) => c >= -1e-4 && c <= 1 + 1e-4);

  // Flip perceived lightness into the theme's range, keep the hue, and pull
  // chroma in just enough to stay inside sRGB.
  function remap(r, g, b) {
    const [L, A, B] = rgbToOklab(r / 255, g / 255, b / 255);
    const L2 = theme.bg + (1 - L) * (theme.fg - theme.bg);
    let rgb = oklabToLinear(L2, A, B);
    if (!inGamut(rgb)) {
      let lo = 0, hi = 1;
      for (let i = 0; i < 14; i++) {
        const k = (lo + hi) / 2;
        if (inGamut(oklabToLinear(L2, A * k, B * k))) lo = k; else hi = k;
      }
      rgb = oklabToLinear(L2, A * lo, B * lo);
    }
    return rgb.map((c) => Math.round(toSrgb(Math.min(1, Math.max(0, c))) * 255));
  }

  // ---- CSS colour string normalisation -----------------------------------
  // Keep pristine accessors before patching so the scratch context and the
  // patched setters can use them.
  const Ctx2D = window.CanvasRenderingContext2D;
  const fillDesc = Object.getOwnPropertyDescriptor(Ctx2D.prototype, "fillStyle");
  const scratch = document.createElement("canvas").getContext("2d");
  const SENTINEL = "#010203";

  function normalise(str) {
    fillDesc.set.call(scratch, SENTINEL);
    fillDesc.set.call(scratch, str);
    const out = fillDesc.get.call(scratch);
    if (out === SENTINEL && str.trim().toLowerCase() !== SENTINEL) return null;
    return out;
  }

  const cache = new Map();
  function mapColor(str) {
    let hit = cache.get(str);
    if (hit !== undefined) return hit;
    hit = str;
    const n = normalise(str);
    let m;
    if (n && n[0] === "#") {
      const [r, g, b] = remap(
        parseInt(n.slice(1, 3), 16),
        parseInt(n.slice(3, 5), 16),
        parseInt(n.slice(5, 7), 16)
      );
      hit = "#" + [r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("");
    } else if (n && (m = n.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/))) {
      const a = m[4] === undefined ? 1 : +m[4];
      const [r, g, b] = remap(+m[1], +m[2], +m[3]);
      hit = a === 0 ? n : `rgba(${r}, ${g}, ${b}, ${a})`;
    }
    if (cache.size > 4096) cache.clear();
    cache.set(str, hit);
    return hit;
  }

  // ---- patch the 2D context ----------------------------------------------
  function patchStyle(proto, prop) {
    const d = Object.getOwnPropertyDescriptor(proto, prop);
    if (!d || !d.set) return;
    Object.defineProperty(proto, prop, {
      configurable: true,
      enumerable: d.enumerable,
      get: d.get,
      set(v) {
        d.set.call(this, typeof v === "string" ? mapColor(v) : v);
      },
    });
  }

  const protos = [Ctx2D.prototype];
  if (window.OffscreenCanvasRenderingContext2D) {
    protos.push(window.OffscreenCanvasRenderingContext2D.prototype);
  }
  for (const proto of protos) {
    patchStyle(proto, "fillStyle");
    patchStyle(proto, "strokeStyle");
    patchStyle(proto, "shadowColor");
  }

  const addStop = CanvasGradient.prototype.addColorStop;
  CanvasGradient.prototype.addColorStop = function (offset, color) {
    return addStop.call(this, offset, typeof color === "string" ? mapColor(color) : color);
  };

  // Expose for debugging from DevTools.
  window.__tddMapColor = mapColor;
})();
