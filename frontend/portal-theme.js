(function () {
    const themeStorageKey = "anchorTheme";
    const availableThemes = new Set(["dark", "light", "original"]);
    const root = document.documentElement;
    const themeToggle = document.getElementById("themePreference");

    function applyTheme(theme) {
        if (!availableThemes.has(theme)) {
            return;
        }

        root.dataset.theme = theme;
        window.localStorage.setItem(themeStorageKey, theme);

        if (themeToggle) {
            themeToggle.value = theme;
        }
    }

    const storedTheme = window.localStorage.getItem(themeStorageKey);
    applyTheme(availableThemes.has(storedTheme) ? storedTheme : "dark");

    if (themeToggle) {
        themeToggle.addEventListener("change", function () {
            applyTheme(themeToggle.value);
        });
    }
})();
