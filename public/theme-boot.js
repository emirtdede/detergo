/*
 * First-paint theme and language bootstrap.
 *
 * This lives in `public/` (copied verbatim to the dist root) because the
 * application CSP is `script-src 'self'`: an inline script in index.html would
 * be blocked. It must stay dependency-free and synchronous so the very first
 * paint already uses the persisted theme instead of flashing the default.
 *
 * localStorage here is only a cache. The authoritative copy of both values
 * lives in the Rust settings file and is applied again by
 * `applyThemeToDom` / `applyLanguageToDom` once the IPC call resolves.
 */
(function () {
  var LEGACY_THEME = {
    black: "dark-black",
    transparent: "dark-black",
    "dark-transparent": "dark-black",
    white: "light-white",
    "white-transparent": "light-white",
    "light-transparent": "light-white",
  };
  var VALID_THEME = /^(dark|light)-(black|gray|blue|purple|green|red|orange|yellow)$/;
  var DEFAULT_THEME = "dark-black";
  var DEFAULT_LANG = "en";
  var RTL = /^(ar|he|fa|ur)$/;

  function read(key, fallback) {
    try {
      return localStorage.getItem(key) || fallback;
    } catch (e) {
      return fallback;
    }
  }

  var root = document.documentElement;

  var theme = read("dev_cleaner_theme", DEFAULT_THEME);
  if (LEGACY_THEME[theme]) {
    theme = LEGACY_THEME[theme];
  } else if (!VALID_THEME.test(theme)) {
    theme = DEFAULT_THEME;
  }
  root.setAttribute("data-theme", theme);

  var lang = read("dev_cleaner_lang", DEFAULT_LANG);
  root.setAttribute("lang", lang);
  root.setAttribute("dir", RTL.test(lang) ? "rtl" : "ltr");
})();
