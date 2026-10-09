window.ANCHOR_API_BASE_URL =
    "https://anchor-gym-system.onrender.com";

window.anchorApiUrl = function(path) {
    return new URL(
        path,
        window.ANCHOR_API_BASE_URL
    ).toString();
};
