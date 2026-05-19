const THEME_STORAGE_KEY = "local-study-manager-theme";
const DARK_THEME = "dark";
const LIGHT_THEME = "light";

function getSavedTheme() {
  return localStorage.getItem(THEME_STORAGE_KEY) === DARK_THEME ? DARK_THEME : LIGHT_THEME;
}

function applyTheme(theme) {
  const nextTheme = theme === DARK_THEME ? DARK_THEME : LIGHT_THEME;
  document.documentElement.dataset.theme = nextTheme;
  document.querySelectorAll("[data-theme-toggle]").forEach((toggle) => {
    toggle.checked = nextTheme === DARK_THEME;
  });
}

function saveTheme(theme) {
  localStorage.setItem(THEME_STORAGE_KEY, theme);
  applyTheme(theme);
}

applyTheme(getSavedTheme());

document.addEventListener("DOMContentLoaded", () => {
  applyTheme(getSavedTheme());
  document.querySelectorAll("[data-theme-toggle]").forEach((toggle) => {
    toggle.addEventListener("change", () => {
      saveTheme(toggle.checked ? DARK_THEME : LIGHT_THEME);
    });
  });
});
