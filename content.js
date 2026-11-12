// Isolated-world bridge: mirrors chrome.storage settings into the page's
// localStorage (which page-hook.js reads synchronously at document_start) and
// reloads the document when they change, because the canvas only picks up new
// colours on a fresh paint.
const DEFAULTS = { mode: "on", theme: "dark" };
const KEY = "tdd-settings";

function reloadWhenVisible() {
  if (document.visibilityState === "visible") {
    location.reload();
  } else {
    document.addEventListener("visibilitychange", () => location.reload(), { once: true });
  }
}

function sync(settings, reloadIfStale) {
  const want = JSON.stringify({ mode: settings.mode, theme: settings.theme });
  try {
    localStorage.setItem(KEY, want);
  } catch (_) {
    return;
  }
  const applied = document.documentElement.dataset.tddApplied;
  if (reloadIfStale && applied && applied !== want) {
    // Guard against reload loops if something keeps them out of step.
    const n = +(sessionStorage.getItem("tdd-reloads") || 0);
    if (n < 2) {
      sessionStorage.setItem("tdd-reloads", String(n + 1));
      reloadWhenVisible();
    }
  } else {
    sessionStorage.removeItem("tdd-reloads");
  }
}

let current = DEFAULTS;
chrome.storage.sync.get(DEFAULTS, (s) => {
  current = s;
  sync(s, true);
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "sync") return;
  for (const k of Object.keys(changes)) current = { ...current, [k]: changes[k].newValue };
  sync(current, true);
});

matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
  if (current.mode === "auto") reloadWhenVisible();
});

// ---- text caret --------------------------------------------------------
// The caret is a DOM element whose colour Docs sets inline (and resets every
// time it moves), in whatever format it likes. Rather than match that string
// in CSS, look at the colour it actually renders with and lighten it when it
// is a near-black grey. Collaborators' carets are saturated colours, so
// they are left alone.
const CARET_COLOR = "#f1f3f4";

function isDark(rgb) {
  const m = rgb.match(/[\d.]+/g);
  if (!m || (m[3] !== undefined && +m[3] === 0)) return false;
  const [r, g, b] = m.map(Number);
  const chroma = Math.max(r, g, b) - Math.min(r, g, b);
  return chroma < 40 && 0.2126 * r + 0.7152 * g + 0.0722 * b < 110;
}

function fixCaret(el) {
  if (document.documentElement.dataset.tddActive !== "1") return;
  const cs = getComputedStyle(el);
  if (parseFloat(cs.borderLeftWidth) > 0 && isDark(cs.borderLeftColor)) {
    el.style.setProperty("border-color", CARET_COLOR, "important");
  }
  if (isDark(cs.backgroundColor)) {
    el.style.setProperty("background-color", CARET_COLOR, "important");
  }
}

new MutationObserver((mutations) => {
  for (const mu of mutations) {
    if (mu.type === "attributes") {
      if (mu.target.classList?.contains("kix-cursor-caret")) fixCaret(mu.target);
      continue;
    }
    for (const n of mu.addedNodes) {
      if (n.nodeType !== 1) continue;
      if (n.classList.contains("kix-cursor-caret")) fixCaret(n);
      n.querySelectorAll?.(".kix-cursor-caret").forEach(fixCaret);
    }
  }
}).observe(document.documentElement, {
  subtree: true,
  childList: true,
  attributes: true,
  attributeFilter: ["style", "class"],
});

// ---- image saver bridge ------------------------------------------------
// image-saver.js (MAIN world) has no chrome.* APIs, so
// it posts fetch requests here and we relay them to the service worker.
window.addEventListener("message", (e) => {
  if (e.source !== window || e.data?.__dis !== "fetch") return;
  const { id, url } = e.data;
  const answer = (payload) => window.postMessage({ __dis: "fetch-result", id, ...payload }, "*");
  try {
    chrome.runtime.sendMessage({ type: "dis-fetch", url }, (res) => {
      if (chrome.runtime.lastError || !res?.ok) {
        answer({ ok: false, error: chrome.runtime.lastError?.message || res?.error });
        return;
      }
      const bin = atob(res.data);
      const buf = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
      answer({ ok: true, type: res.type, buffer: buf.buffer });
    });
  } catch (err) {
    // Extension was reloaded while this tab stayed open.
    answer({ ok: false, error: String(err) });
  }
});
