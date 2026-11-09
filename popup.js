const DEFAULTS = { mode: "on", theme: "dark" };

// chrome.storage only exists inside the extension; fall back to memory so
// the page can also be previewed as a plain HTML file.
const store = globalThis.chrome?.storage?.sync ?? {
  data: { ...DEFAULTS },
  get(defaults, cb) { cb({ ...defaults, ...this.data }); },
  set(values) { Object.assign(this.data, values); },
};

const body = document.body;
const sw = document.getElementById("switch");
const auto = document.getElementById("auto");
const status = document.getElementById("status");
const themes = document.getElementById("themes");
const systemDark = matchMedia("(prefers-color-scheme: dark)");

let state = { ...DEFAULTS };

function render() {
  const dark = state.mode === "on" || (state.mode === "auto" && systemDark.matches);
  body.classList.toggle("is-dark", dark);
  sw.setAttribute("aria-checked", String(dark));
  sw.classList.toggle("is-auto", state.mode === "auto");
  auto.checked = state.mode === "auto";
  themes.classList.toggle("is-off", !dark);
  status.textContent =
    state.mode === "auto"
      ? `跟隨系統（目前${dark ? "深色" : "淺色"}）`
      : dark ? "深色模式已開啟" : "深色模式已關閉";
  for (const b of document.querySelectorAll(".swatch")) {
    b.classList.toggle("active", b.dataset.theme === state.theme);
  }
}

function update(values) {
  state = { ...state, ...values };
  store.set(values);
  render();
}

// Skip the entrance animation: show the saved state instantly, then enable
// transitions for the user's own clicks.
body.style.transition = "none";
document.documentElement.classList.add("no-anim");
store.get(DEFAULTS, (s) => {
  state = s;
  render();
  requestAnimationFrame(() => requestAnimationFrame(() => {
    body.style.transition = "";
    document.documentElement.classList.remove("no-anim");
  }));
});

sw.addEventListener("click", () => {
  update({ mode: body.classList.contains("is-dark") ? "off" : "on" });
});
auto.addEventListener("change", () => {
  update({ mode: auto.checked ? "auto" : body.classList.contains("is-dark") ? "on" : "off" });
});
themes.addEventListener("click", (e) => {
  const b = e.target.closest(".swatch");
  if (b) update({ theme: b.dataset.theme });
});
systemDark.addEventListener("change", render);
