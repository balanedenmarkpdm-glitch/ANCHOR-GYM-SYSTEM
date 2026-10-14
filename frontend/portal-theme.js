(function () {
    const themeStorageKey = "anchorTheme";
    const root = document.documentElement;
    const themedPages = new Set([
        "customer-dashboard",
        "admin-dashboard",
        "signup",
        "forgot-password"
    ]);

    if (!themedPages.has(root.dataset.page)) {
        return;
    }

    function normalizeTheme(theme) {
        return theme === "light"
            ? "light"
            : "dark";
    }

    function renderThemeToggle(theme) {
        const themeToggle =
            document.getElementById("themeToggle");
        const themeToggleLabel =
            document.getElementById("themeToggleLabel");
        const moonIcon =
            document.getElementById("themeMoonIcon");
        const sunIcon =
            document.getElementById("themeSunIcon");

        if (
            !themeToggle ||
            !themeToggleLabel ||
            !moonIcon ||
            !sunIcon
        ) {
            return;
        }

        const isLight =
            theme === "light";
        const currentThemeLabel =
            isLight
                ? "Light mode"
                : "Dark mode";
        const nextThemeLabel =
            isLight
                ? "dark"
                : "light";

        themeToggleLabel.textContent =
            currentThemeLabel;
        themeToggle.setAttribute(
            "aria-label",
            `Switch to ${nextThemeLabel} mode`
        );
        themeToggle.setAttribute(
            "aria-pressed",
            String(isLight)
        );
        moonIcon.hidden = isLight;
        sunIcon.hidden = !isLight;
    }

    function applyTheme(theme, persist) {
        const normalizedTheme =
            normalizeTheme(theme);

        root.dataset.theme =
            normalizedTheme;

        if (persist) {
            window.localStorage.setItem(
                themeStorageKey,
                normalizedTheme
            );
        }

        renderThemeToggle(normalizedTheme);
    }

    const storedTheme =
        window.localStorage.getItem(
            themeStorageKey
        );
    const initialTheme =
        normalizeTheme(storedTheme);

    root.dataset.theme =
        initialTheme;

    if (storedTheme !== initialTheme) {
        window.localStorage.setItem(
            themeStorageKey,
            initialTheme
        );
    }

    document.addEventListener(
        "DOMContentLoaded",
        function () {
            renderThemeToggle(initialTheme);

            const themeToggle =
                document.getElementById("themeToggle");

            if (themeToggle) {
                themeToggle.addEventListener(
                    "click",
                    function () {
                        applyTheme(
                            root.dataset.theme === "light"
                                ? "dark"
                                : "light",
                            true
                        );
                    }
                );
            }
        },
        { once: true }
    );

    window.addEventListener(
        "storage",
        function (event) {
            if (event.key === themeStorageKey) {
                applyTheme(
                    event.newValue,
                    false
                );
            }
        }
    );
})();
