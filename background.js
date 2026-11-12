// Fetches image bytes the page itself can't read because of CORS. Only
// Google image hosts are allowed, so the page can't use this as a proxy.
const ALLOWED = /^https:\/\/([a-z0-9-]+\.)*(googleusercontent\.com|docs\.google\.com)\//i;

function toBase64(buf) {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg?.type !== "dis-fetch") return;
  if (typeof msg.url !== "string" || !ALLOWED.test(msg.url)) {
    reply({ ok: false, error: "blocked url" });
    return;
  }
  fetch(msg.url, { credentials: "include" })
    .then(async (r) => {
      if (!r.ok) throw new Error("HTTP " + r.status);
      const type = r.headers.get("content-type") || "";
      if (!type.startsWith("image/")) throw new Error("not an image: " + type);
      reply({ ok: true, type, data: toBase64(await r.arrayBuffer()) });
    })
    .catch((e) => reply({ ok: false, error: String(e) }));
  return true; // async reply
});

// frame.js asks whether its frame is embedded in a Google Docs document tab.
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg?.type !== "tdd-frame") return;
  reply({ inDocument: /^https:\/\/docs\.google\.com\/document\//.test(sender.tab?.url || "") });
});
