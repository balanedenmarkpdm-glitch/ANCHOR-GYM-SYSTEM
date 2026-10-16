const LOCAL_DEVELOPMENT_HOSTS = new Set([
    "localhost",
    "127.0.0.1",
    "[::1]"
]);

function isLocalDevelopmentOrigin(origin) {
    if (!origin) {
        return false;
    }

    try {
        const url = new URL(origin);

        return (
            url.protocol === "http:" &&
            LOCAL_DEVELOPMENT_HOSTS.has(url.hostname) &&
            url.origin === origin
        );
    } catch {
        return false;
    }
}

function isAllowedFrontendOrigin(
    origin,
    frontendOrigin,
    additionalOrigins = []
) {
    return (
        isLocalDevelopmentOrigin(origin) ||
        origin === frontendOrigin ||
        /^https:\/\/anchor-gym-system-[a-z0-9]+-brunheart\.vercel\.app$/.test(
            origin || ""
        ) ||
        additionalOrigins.includes(origin)
    );
}

module.exports = {
    isAllowedFrontendOrigin,
    isLocalDevelopmentOrigin
};
