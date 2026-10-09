window.ANCHOR_API_BASE_URL =
    "https://anchor-gym-system.onrender.com";

window.anchorApiUrl = function(path) {
    return new URL(
        path,
        window.ANCHOR_API_BASE_URL
    ).toString();
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
