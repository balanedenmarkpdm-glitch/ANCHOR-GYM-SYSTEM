window.ANCHOR_API_BASE_URL =
    "https://anchor-gym-system.onrender.com";

window.anchorApiUrl = function(path) {
    return new URL(
        path,
        window.ANCHOR_API_BASE_URL
    ).toString();
};

window.anchorPasswordStrength = function(password) {
    if (!password) {
        return {
            score: 0,
            label: "Enter a password",
            state: "empty"
        };
    }

    let score = 0;

    if (password.length >= 6) score++;
    if (password.length >= 10) score++;
    if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
    if (/\d/.test(password)) score++;
    if (/[^A-Za-z0-9]/.test(password)) score++;

    if (password.length < 6 || score <= 1) {
        return { score: 1, label: "Weak", state: "weak" };
    }

    if (score <= 2) {
        return { score: 2, label: "Medium", state: "medium" };
    }

    if (score <= 3) {
        return { score: 3, label: "Strong", state: "strong" };
    }

    return { score: 4, label: "Very strong", state: "very-strong" };
};

window.anchorSession = {
    get: function(key) {
        const temporaryValue =
            window.sessionStorage.getItem(key);

        return temporaryValue !== null
            ? temporaryValue
            : window.localStorage.getItem(key);
    },

    set: function(key, value, remember) {
        if (remember) {
            window.localStorage.setItem(key, value);
            window.sessionStorage.removeItem(key);
            return;
        }

        window.sessionStorage.setItem(key, value);
        window.localStorage.removeItem(key);
    },

    remove: function(key) {
        window.localStorage.removeItem(key);
        window.sessionStorage.removeItem(key);
    }
};
