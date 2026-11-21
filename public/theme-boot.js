/*
 * First-paint theme, accessibility zoom, high contrast and language bootstrap.
 *
 * Lives in `public/` because CSP is `script-src 'self'`. Runs synchronously
 * before React mounts so there is zero flash of default theme or zoom.
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
  var VALID_THEME = /^((dark|light)-(black|gray|blue|purple|green|red|orange|yellow)|custom)$/;
  var DEFAULT_THEME = "dark-black";
  var DEFAULT_LANG = "en";
  var RTL = /^(ar|he|fa|ur)$/;

  function readFirst(keys, fallback) {
    try {
      for (var i = 0; i < keys.length; i++) {
        var value = localStorage.getItem(keys[i]);
        if (value) return value;
      }
      return fallback;
    } catch (e) {
      return fallback;
    }
  }

  var root = document.documentElement;

  var theme = readFirst(["detergo_theme", "lustra_theme", "dev_cleaner_theme"], DEFAULT_THEME);
  if (LEGACY_THEME[theme]) {
    theme = LEGACY_THEME[theme];
  } else if (!VALID_THEME.test(theme)) {
    theme = DEFAULT_THEME;
  }
  root.setAttribute("data-theme", theme);

  if (theme === "custom") {
    try {
      var rawCustom = readFirst(["detergo_custom_theme", "lustra_custom_theme"], null);
      if (rawCustom) {
        var parsed = JSON.parse(rawCustom);
        root.setAttribute("data-theme-base", parsed && parsed.base === "light" ? "light" : "dark");
      }
    } catch (e) {
      root.setAttribute("data-theme-base", "dark");
    }
  }

  var rawScale = parseInt(readFirst(["detergo_ui_scale", "lustra_ui_scale"], "100"), 10);
  if (!isNaN(rawScale) && rawScale >= 80 && rawScale <= 150) {
    root.setAttribute("data-ui-scale", String(rawScale));
    if (rawScale !== 100) {
      root.style.zoom = rawScale + "%";
    }
  }

  var hc = readFirst(["detergo_high_contrast", "lustra_high_contrast"], "false");
  if (hc === "true") {
    root.setAttribute("data-high-contrast", "true");
  }

  var lang = readFirst(["detergo_lang", "lustra_lang", "dev_cleaner_lang"], DEFAULT_LANG);
  root.setAttribute("lang", lang);
  root.setAttribute("dir", RTL.test(lang) ? "rtl" : "ltr");
})();
