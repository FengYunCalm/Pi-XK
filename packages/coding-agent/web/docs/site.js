const themeButtons = document.querySelectorAll("[data-theme-toggle]");
const themeStorageKey = "pi-web-theme";
const systemPrefersLight = window.matchMedia("(prefers-color-scheme: light)");

function storedThemeMode() {
  const theme = window.localStorage.getItem(themeStorageKey);
  return theme === "light" || theme === "dark" || theme === "auto" ? theme : "auto";
}

function activeTheme() {
  return document.documentElement.dataset.theme === "light" || document.documentElement.dataset.theme === "dark"
    ? document.documentElement.dataset.theme
    : systemPrefersLight.matches
      ? "light"
      : "dark";
}

function applyThemeMode(mode) {
  if (mode === "light" || mode === "dark") {
    document.documentElement.dataset.theme = mode;
  } else {
    delete document.documentElement.dataset.theme;
  }
  window.localStorage.setItem(themeStorageKey, mode);
  updateThemeButtons(mode);
}

function updateThemeButtons(mode = storedThemeMode()) {
  const active = activeTheme();
  for (const button of themeButtons) {
    button.dataset.theme = mode;
    button.dataset.activeTheme = active;
    const icon = button.querySelector("[data-theme-icon]");
    const label = button.querySelector("[data-theme-label]");
    if (mode === "auto") {
      button.setAttribute("aria-label", `Theme: Auto (${active}). Click to use dark theme.`);
      if (icon !== null) icon.textContent = "◐";
      if (label !== null) label.textContent = "Auto";
    } else if (mode === "light") {
      button.setAttribute("aria-label", "Theme: Light. Click to use automatic theme.");
      if (icon !== null) icon.textContent = "☀";
      if (label !== null) label.textContent = "Light";
    } else {
      button.setAttribute("aria-label", "Theme: Dark. Click to use light theme.");
      if (icon !== null) icon.textContent = "☾";
      if (label !== null) label.textContent = "Dark";
    }
  }
}

updateThemeButtons();
systemPrefersLight.addEventListener("change", () => {
  if (storedThemeMode() === "auto") updateThemeButtons("auto");
});

for (const button of themeButtons) {
  button.addEventListener("click", () => {
    const currentMode = storedThemeMode();
    const nextTheme = currentMode === "auto" ? "dark" : currentMode === "dark" ? "light" : "auto";
    applyThemeMode(nextTheme);
  });
}

const copyButtons = document.querySelectorAll("[data-copy]");

for (const button of copyButtons) {
  button.addEventListener("click", async () => {
    const targetSelector = button.getAttribute("data-copy");
    const target = targetSelector === null ? null : document.querySelector(targetSelector);
    const text = target?.textContent?.replace(/^\s*\$ /gm, "").trim();
    if (!text) return;

    try {
      await navigator.clipboard.writeText(text);
      const original = button.textContent;
      button.textContent = "Copied";
      window.setTimeout(() => {
        button.textContent = original;
      }, 1400);
    } catch {
      button.textContent = "Select code";
    }
  });
}
