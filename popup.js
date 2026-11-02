const DEFAULTS = { mode: "on", theme: "dark" };

chrome.storage.sync.get(DEFAULTS, (s) => {
  for (const name of Object.keys(DEFAULTS)) {
    const input = document.querySelector(`input[name="${name}"][value="${s[name]}"]`);
    if (input) input.checked = true;
  }
});

document.addEventListener("change", (e) => {
  if (e.target.matches("input[type=radio]")) {
    chrome.storage.sync.set({ [e.target.name]: e.target.value });
  }
});
