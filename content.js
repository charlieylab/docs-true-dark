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
