// Runs inside embedded pages (Share dialog, pickers, contact cards). The
// parent page darkens the whole frame with an invert filter (see ui.css);
// here we undo that for pictures and for the translucent dimming layer, so
// avatars keep their colours and the backdrop dims instead of turning hazy.
(() => {
  if (window.top === window) return;

  const DEFAULTS = { mode: "on", theme: "dark" };
  const INVERT = "invert(1) hue-rotate(180deg)";

  function start() {
    const style = document.createElement("style");
    style.textContent = `
      img, video, canvas, picture, [role="img"][style*="background-image"] {
        filter: ${INVERT} !important;
      }`;
    (document.head || document.documentElement).appendChild(style);

    // The dimming layer is a near-black, semi-transparent element covering
    // the frame. Inverted by the parent it would become a white haze, so
    // flip it here; the parent's filter then turns it back to black.
    const flipScrim = (el) => {
      if (!el || el.dataset.tddScrim) return;
      const r = el.getBoundingClientRect();
      if (r.width < innerWidth * 0.8 || r.height < innerHeight * 0.8) return;
      const m = getComputedStyle(el).backgroundColor.match(/[\d.]+/g);
      if (!m || m.length < 4) return;
      const [red, green, blue, alpha] = m.map(Number);
      if (alpha < 0.05 || alpha > 0.95 || Math.max(red, green, blue) > 90) return;
      el.dataset.tddScrim = "1";
      el.style.setProperty("background-color", `rgba(255, 255, 255, ${alpha})`, "important");
    };
    let queued = false;
    const scan = () => {
      queued = false;
      flipScrim(document.documentElement);
      flipScrim(document.body);
      // Only the corners: the dialog itself sits in the middle.
      for (const [x, y] of [[4, 4], [innerWidth - 4, 4], [4, innerHeight - 4], [innerWidth - 4, innerHeight - 4]]) {
        document.elementsFromPoint(x, y).forEach(flipScrim);
      }
    };
    const queue = () => {
      if (!queued) {
        queued = true;
        requestAnimationFrame(scan);
      }
    };
    new MutationObserver(queue).observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["class", "style"],
    });
    addEventListener("resize", queue);
    queue();
  }

  try {
    // Only act when this frame lives in a Google Docs document tab that the
    // extension is darkening; the same frames also appear in Gmail, Drive...
    chrome.runtime.sendMessage({ type: "tdd-frame" }, (res) => {
      if (chrome.runtime.lastError || !res?.inDocument) return;
      chrome.storage.sync.get(DEFAULTS, (s) => {
        const active =
          s.mode === "on" ||
          (s.mode === "auto" && matchMedia("(prefers-color-scheme: dark)").matches);
        if (active) start();
      });
    });
  } catch (_) {
    // Extension was reloaded while this tab stayed open.
  }
})();
