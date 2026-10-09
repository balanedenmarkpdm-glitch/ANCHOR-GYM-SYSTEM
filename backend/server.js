require("dotenv").config();

const express = require("express");
const { Pool } = require("pg");
const bcrypt = require("bcrypt");
const { OAuth2Client } = require("google-auth-library");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const QRCode = require("qrcode");

const app = express();
const PORT = process.env.PORT || 3000;
const frontendOrigin =
    process.env.FRONTEND_URL ||
    "https://anchor-gym-system.vercel.app";

function isAllowedFrontendOrigin(origin) {
    return (
        origin === frontendOrigin ||
        /^https:\/\/anchor-gym-system-[a-z0-9]+-brunheart\.vercel\.app$/.test(
            origin || ""
        ) ||
        (process.env.GOOGLE_ALLOWED_ORIGINS || "")
            .split(",")
            .map(value => value.trim())
            .filter(Boolean)
            .includes(origin)
    );
}

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    options: "-c timezone=Asia/Manila",
    connectionTimeoutMillis: 10000,
    query_timeout: 15000,
    statement_timeout: 15000
});

const googleOAuthClient =
    new OAuth2Client();

function normalizeSignupEmail(value) {
    return String(value || "")
        .trim()
        .toLowerCase();
}

function isValidGmailAddress(value) {
    const match =
        /^([a-z0-9.]+)(?:\+([a-z0-9._-]+))?@gmail\.com$/.exec(
            normalizeSignupEmail(value)
        );

    if (!match) {
        return false;
    }

    const username =
        match[1];

    const alias =
        match[2];

    return (
        username.length >= 6 &&
        username.length <= 30 &&
        !username.startsWith(".") &&
        !username.endsWith(".") &&
        !username.includes("..") &&
        (
            !alias ||
            (
                alias.length <= 30 &&
                !alias.startsWith(".") &&
                !alias.endsWith(".") &&
                !alias.includes("..")
            )
        )
    );
}

function normalizePhilippinePhone(value) {
    return String(value || "")
        .trim()
        .replace(/[\s()-]/g, "");
}

// =====================================
// GUEST TIMER TEST MODE
// =====================================
//
// TRUE = TEST MODE
//
// When a guest checks in at or after 10:00 PM:
//
// 1 hour   -> check_in + 1 hour
// 2 hours  -> check_in + 2 hours
// 3 hours  -> check_in + 3 hours
// Day Pass -> 10:00 PM next day
//
// Examples:
//
// 11:00 PM + 1 hour = 12:00 AM
// 11:00 PM + 2 hours = 1:00 AM
// 11:00 PM + 3 hours = 2:00 AM
// Day Pass at 11:00 PM = 10:00 PM next day
//
// FALSE = NORMAL MODE
//
// All guest visits are limited by the real
// 10:00 PM same-day closing time.
//
// IMPORTANT:
// Restart server.js after changing this value.
//
const GUEST_TIMER_TEST_MODE = true;

// =====================================
// GUEST CLOSING SQL
// =====================================
//
// PostgreSQL columns in this project use
// TIMESTAMP WITHOUT TIME ZONE.
//
// We therefore compare all times as Manila
// timestamps explicitly.
//
// NORMAL MODE:
//
// 10:00 PM of the same calendar day.
//
// TEST MODE:
//
// If check-in is at or after 10:00 PM,
// closing becomes 10:00 PM of the NEXT day.
//
// Otherwise closing remains 10:00 PM
// of the same day.
//
const GUEST_DAY_CLOSING_SQL = `
    date_trunc(
        'day',
        a.check_in
    ) + INTERVAL '22 hours'
`;

const GUEST_TEST_CLOSING_SQL = `
    CASE

        WHEN a.check_in >=
        (
            date_trunc(
                'day',
                a.check_in
            ) + INTERVAL '22 hours'
        )

        THEN
            date_trunc(
                'day',
                a.check_in
            ) + INTERVAL '46 hours'

        ELSE
            date_trunc(
                'day',
                a.check_in
            ) + INTERVAL '22 hours'

    END
`;

const GUEST_CLOSING_SQL =
    GUEST_TIMER_TEST_MODE
        ? GUEST_TEST_CLOSING_SQL
        : GUEST_DAY_CLOSING_SQL;

// =====================================
// CURRENT MANILA TIME
// =====================================
//
// Converts CURRENT_TIMESTAMP into a
// TIMESTAMP WITHOUT TIME ZONE using
// Asia/Manila.
//
// This matches the attendance/check_in
// column type in the database.
//
const GUEST_NOW_SQL =
    `(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')`;

pool.on("error", (error) => {
    console.error(
        "PostgreSQL pool error:",
        error
    );
});

// =====================================
// PROJECT DIRECTORIES
// =====================================

const projectRoot =
    path.join(
        __dirname,
        ".."
    );

const frontendDir =
    path.join(
        projectRoot,
        "frontend"
    );

const uploadDir =
    path.join(
        projectRoot,
        "uploads"
    );

if (
    !fs.existsSync(
        uploadDir
    )
) {
    fs.mkdirSync(
        uploadDir,
        {
            recursive: true
        }
    );
}

// =====================================
// MIDDLEWARE
// =====================================

app.use(
    (req, res, next) => {

        const origin =
            req.get("Origin");

        if (isAllowedFrontendOrigin(origin)) {
            res.setHeader(
                "Access-Control-Allow-Origin",
                origin
            );
            res.setHeader(
                "Vary",
                "Origin"
            );
        }

        res.setHeader(
            "Access-Control-Allow-Methods",
            "GET,POST,PUT,PATCH,DELETE,OPTIONS"
        );
        res.setHeader(
            "Access-Control-Allow-Headers",
            "Content-Type,Authorization,X-Requested-With"
        );

        if (req.method === "OPTIONS") {
            return res.sendStatus(204);
        }

        next();
    }
);

app.use(
    express.json({
        limit: "10mb"
    })
);

app.use(
    express.static(
        frontendDir
    )
);

app.use(
    "/uploads",
    express.static(
        uploadDir
    )
);

// =====================================
// HOME
// =====================================

app.get(
    "/",
    (req, res) => {

        res.sendFile(
            path.join(
                frontendDir,
                "login.html"
            )
        );

    }
);

// =====================================
// NOTIFICATION HELPER
// =====================================

async function createNotification(
    database,
    userId,
    title,
    message
) {

    await database.query(
        `
        INSERT INTO notifications
        (
            user_id,
            title,
            message,
            is_read
        )
        VALUES
        (
            $1,
            $2,
            $3,
            false
        )
        `,
        [
            userId,
            title,
            message
        ]
    );

}

// =====================================
// TEST DATABASE
// =====================================

app.get(
    "/api/test-db",
    async (req, res) => {

        try {

            const result =
                await pool.query(
                    `
                    SELECT
                        NOW() AS current_time,
                        current_database() AS database_name,
                        current_user
                    `
                );

            res.json({
                success:
                    true,

                message:
                    "PostgreSQL connected!",

                data:
                    result.rows[0]
            });

        } catch (error) {

            console.error(
                "Database test error:",
                error
            );

            res.status(500).json({
                success:
                    false,

                message:
                    "PostgreSQL connection failed.",

                error:
                    error.message
            });

        }

    }
);

// =====================================
// DELETE RESTORED ARCHIVE
// =====================================

app.delete(
    "/api/admin/archived-members/:id",
    async (req, res) => {

        const client =
            await pool.connect();

        let transactionStarted =
            false;

        try {

            const archiveId =
                Number(
                    req.params.id
                );

            if (
                !Number.isInteger(
                    archiveId
                ) ||
                archiveId <= 0
            ) {

                return res.status(
                    400
                ).json({
                    success:
                        false,

                    message:
                        "Invalid archive ID."
                });

            }

            await client.query(
                "BEGIN"
            );

            transactionStarted =
                true;

            const archiveResult =
                await client.query(
                    `
                    SELECT
                        archive_id,
                        user_id,
                        member_id,
                        restored_at,
                        status
                    FROM archived_members
                    WHERE archive_id = $1
                    FOR UPDATE
                    `,
                    [
                        archiveId
                    ]
                );

            if (
                archiveResult.rows.length ===
                0
            ) {

                await client.query(
                    "ROLLBACK"
                );

                transactionStarted =
                    false;

                return res.status(
                    404
                ).json({
                    success:
                        false,

                    message:
                        "Archived member record not found."
                });

            }

            const archived =
                archiveResult.rows[0];

            if (
                !archived.restored_at &&
                String(
                    archived.status ||
                    ""
                ).toUpperCase() !==
                "RESTORED"
            ) {

                await client.query(
                    "ROLLBACK"
                );

                transactionStarted =
                    false;

                return res.status(
                    400
                ).json({
                    success:
                        false,

                    message:
                        "Only restored archived records can be deleted."
                });

            }

            const deleteResult =
                await client.query(
                    `
                    DELETE FROM archived_members
                    WHERE archive_id = $1
                    RETURNING
                        archive_id,
                        user_id,
                        member_id
                    `,
                    [
                        archiveId
                    ]
                );

            await client.query(
                "COMMIT"
            );

            transactionStarted =
                false;

            res.json({
                success:
                    true,

                message:
                    "Archived history deleted successfully.",

                archive:
                    deleteResult.rows[0]
            });

        } catch (error) {

            if (
                transactionStarted
            ) {

                try {

                    await client.query(
                        "ROLLBACK"
                    );

                } catch (
                    rollbackError
                ) {

                    console.error(
                        "Rollback error:",
                        rollbackError
                    );

                }

            }

            console.error(
                "Delete archived member error:",
                error
            );

            res.status(500).json({
                success:
                    false,

                message:
                    "Unable to delete archived member history.",

                error:
                    error.message,

                code:
                    error.code ||
                    null,

                detail:
                    error.detail ||
                    null
            });

        } finally {

            client.release();

        }

    }
);

// =====================================
// SIGN UP
// =====================================

app.post(
    "/api/signup",
    (req, res) => {
        return res.status(410).json({
            success: false,
            message: "Create customer accounts with Google sign-in so the Gmail address can be verified."
        });
    }
);

app.post(
    "/api/signup/resend",
    (req, res) => {
        return res.status(410).json({
            success: false,
            message: "Email verification is not used for signup."
        });
    }
);

app.post(
    "/api/signup/verify",
    (req, res) => {
        return res.status(410).json({
            success: false,
            message: "Email verification is not used for signup."
        });
    }
);

app.get(
    "/api/auth/config",
    (req, res) => {
        res.setHeader(
            "Cache-Control",
            "no-store"
        );

        res.json({
            success: true,
            googleClientId:
                process.env.GOOGLE_CLIENT_ID || null,
            googleEnabled: Boolean(
                process.env.GOOGLE_CLIENT_ID &&
                process.env.GOOGLE_CLIENT_SECRET
            ),
            message:
                process.env.GOOGLE_CLIENT_ID &&
                process.env.GOOGLE_CLIENT_SECRET
                    ? undefined
                    : "Google sign-in is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET on the backend."
        });
    }
);

app.post(
    "/api/auth/google/code",
    async (req, res) => {
        const origin =
            req.get("Origin");

        if (
            req.get("X-Requested-With") !== "XmlHttpRequest" ||
            !isAllowedFrontendOrigin(origin)
        ) {
            return res.status(403).json({
                success: false,
                message: "Google sign-in request origin could not be verified."
            });
        }

        const {
            GOOGLE_CLIENT_ID: clientId,
            GOOGLE_CLIENT_SECRET: clientSecret
        } = process.env;

        if (!clientId || !clientSecret) {
            return res.status(503).json({
                success: false,
                message: "Google sign-in is not configured on the backend."
            });
        }

        const code =
            String(req.body.code || "");

        if (!code) {
            return res.status(400).json({
                success: false,
                message: "Google did not provide an authorization code."
            });
        }

        try {
            const oauthClient =
                new OAuth2Client(
                    clientId,
                    clientSecret
                );

            const { tokens } =
                await oauthClient.getToken({
                    code: code,
                    redirect_uri: origin
                });

            if (!tokens.id_token) {
                return res.status(401).json({
                    success: false,
                    message: "Google did not return a verified account token."
                });
            }

            const ticket =
                await oauthClient.verifyIdToken({
                    idToken: tokens.id_token,
                    audience: clientId
                });

            const profile =
                ticket.getPayload();

            if (
                !profile ||
                profile.email_verified !== true ||
                !profile.email
            ) {
                return res.status(401).json({
                    success: false,
                    message: "Google did not verify this email address."
                });
            }

            const email =
                normalizeSignupEmail(profile.email);

            if (!isValidGmailAddress(email)) {
                return res.status(403).json({
                    success: false,
                    message: "Please use a verified Gmail account."
                });
            }

            const existingUser =
                await pool.query(
                    `
                    SELECT
                        id,
                        full_name,
                        email,
                        phone,
                        role,
                        created_at
                    FROM users
                    WHERE LOWER(email) = $1
                    `,
                    [email]
                );

            if (existingUser.rows.length > 0) {
                const user =
                    existingUser.rows[0];

                if (
                    String(user.role).toLowerCase() !==
                    "customer"
                ) {
                    return res.status(403).json({
                        success: false,
                        message: "This login is for customer accounts only."
                    });
                }

                return res.json({
                    success: true,
                    message: "Google sign-in successful.",
                    user: user
                });
            }

            return res.json({
                success: true,
                requires_phone: true,
                id_token: tokens.id_token
            });
        } catch (error) {
            console.error(
                "Google authorization code exchange error:",
                error
            );

            return res.status(401).json({
                success: false,
                message: "Unable to verify the Google sign-in. Please try again."
            });
        }
    }
);

app.post(
    "/api/auth/google",
    async (req, res) => {
        const clientId =
            process.env.GOOGLE_CLIENT_ID;

        if (!clientId) {
            return res.status(503).json({
                success: false,
                message: "Google sign-in is not configured on the backend."
            });
        }

        const idToken =
            String(req.body.id_token || "");

        if (!idToken) {
            return res.status(400).json({
                success: false,
                message: "Google did not provide an ID token."
            });
        }

        let profile;

        try {
            const ticket =
                await googleOAuthClient.verifyIdToken({
                    idToken: idToken,
                    audience: clientId
                });

            profile =
                ticket.getPayload();
        } catch (error) {
            console.error(
                "Google ID token verification error:",
                error
            );

            return res.status(401).json({
                success: false,
                message: "Unable to verify the Google sign-in. Please try again."
            });
        }

        if (
            !profile ||
            profile.email_verified !== true ||
            !profile.email
        ) {
            return res.status(401).json({
                success: false,
                message: "Google did not verify this email address."
            });
        }

        const email =
            normalizeSignupEmail(profile.email);

        if (!isValidGmailAddress(email)) {
            return res.status(403).json({
                success: false,
                message: "Please use a verified Gmail account."
            });
        }

        try {
            const existingUser =
                await pool.query(
                    `
                    SELECT
                        id,
                        full_name,
                        email,
                        phone,
                        role,
                        created_at
                    FROM users
                    WHERE LOWER(email) = $1
                    `,
                    [email]
                );

            if (existingUser.rows.length > 0) {
                const user =
                    existingUser.rows[0];

                if (
                    String(user.role).toLowerCase() !==
                    "customer"
                ) {
                    return res.status(403).json({
                        success: false,
                        message: "This login is for customer accounts only."
                    });
                }

                return res.json({
                    success: true,
                    message: "Google sign-in successful.",
                    user: user
                });
            }

            const phone =
                normalizePhilippinePhone(
                    req.body.phone
                );

            if (!phone) {
                return res.json({
                    success: true,
                    requires_phone: true,
                    id_token: idToken
                });
            }

            if (!/^09\d{9}$/.test(phone)) {
                return res.status(400).json({
                    success: false,
                    message: "Please enter a valid 11-digit Philippine mobile number starting with 09."
                });
            }

            const randomPassword =
                crypto.randomBytes(32).toString("hex");

            const passwordHash =
                await bcrypt.hash(
                    randomPassword,
                    10
                );

            const userResult =
                await pool.query(
                    `
                    INSERT INTO users
                    (
                        full_name,
                        email,
                        password,
                        phone,
                        role
                    )
                    VALUES
                    (
                        $1,
                        $2,
                        $3,
                        $4,
                        'customer'
                    )
                    RETURNING
                        id,
                        full_name,
                        email,
                        phone,
                        role,
                        created_at
                    `,
                    [
                        String(
                            profile.name ||
                            email.split("@")[0]
                        ).trim(),
                        email,
                        passwordHash,
                        phone
                    ]
                );

            return res.status(201).json({
                success: true,
                message: "Google account created successfully.",
                user: userResult.rows[0]
            });
        } catch (error) {
            console.error(
                "Google account processing error:",
                error
            );

            return res.status(500).json({
                success: false,
                message: "Unable to complete Google sign-in. Please try again."
            });
        }
    }
);

// =====================================
// LOGIN
// =====================================

app.post(
    "/api/login",
    async (req, res) => {

        try {

            const {
                email,
                password
            } = req.body;

            if (
                !email ||
                !password
            ) {

                return res.status(
                    400
                ).json({

                    success:
                        false,

                    message:
                        "Email and password are required."

                });

            }

            const normalizedEmail =
                String(
                    email
                )
                    .trim()
                    .toLowerCase();

            const result =
                await pool.query(
                    `
                    SELECT
                        id,
                        full_name,
                        email,
                        phone,
                        password,
                        role,
                        created_at
                    FROM users
                    WHERE LOWER(email) = $1
                    `,
                    [
                        normalizedEmail
                    ]
                );

            if (
                result.rows.length ===
                0
            ) {

                return res.status(
                    401
                ).json({

                    success:
                        false,

                    message:
                        "Invalid email or password."

                });

            }

            const user =
                result.rows[0];

            const passwordMatch =
                await bcrypt.compare(
                    password,
                    user.password
                );

            if (
                !passwordMatch
            ) {

                return res.status(
                    401
                ).json({

                    success:
                        false,

                    message:
                        "Invalid email or password."

                });

            }

            if (
                String(
                    user.role
                ).toLowerCase() !==
                "customer"
            ) {

                return res.status(
                    403
                ).json({

                    success:
                        false,

                    message:
                        "This login is for customer accounts only."

                });

            }

            delete user.password;

            res.json({

                success:
                    true,

                message:
                    "Login successful.",

                user

            });

        } catch (error) {

            console.error(
                "Login error:",
                error
            );

            res.status(
                500
            ).json({

                success:
                    false,

                message:
                    "Unable to login.",

                error:
                    error.message

            });

        }

    }
);

// =====================================
// CUSTOMER DASHBOARD
// =====================================

app.delete(
    "/api/customer/:userId/notifications/:notificationId",
    async (req, res) => {

        try {

            const userId =
                Number(req.params.userId);

            const notificationId =
                Number(req.params.notificationId);

            if (
                !Number.isSafeInteger(userId) ||
                userId <= 0 ||
                !Number.isSafeInteger(notificationId) ||
                notificationId <= 0
            ) {

                return res.status(400).json({
                    success: false,
                    message: "Invalid customer or notification ID."
                });

            }

            const result =
                await pool.query(
                    `
                    DELETE FROM notifications n
                    USING users u
                    WHERE n.id = $1
                      AND n.user_id = $2
                      AND u.id = n.user_id
                      AND LOWER(u.role) = 'customer'
                    RETURNING n.id
                    `,
                    [
                        notificationId,
                        userId
                    ]
                );

            if (result.rows.length === 0) {

                return res.status(404).json({
                    success: false,
                    message: "Customer notification not found."
                });

            }

            res.json({
                success: true,
                message: "Notification deleted successfully.",
                notification: result.rows[0]
            });

        } catch (error) {

            console.error(
                "Delete customer notification error:",
                error
            );

            res.status(500).json({
                success: false,
                message: "Unable to delete customer notification.",
                error: error.message,
                code: error.code || null
            });

        }

    }
);

app.get(
    "/api/customer/:userId",
    async (req, res) => {

        try {

            const userId =
                Number(
                    req.params.userId
                );

            if (
                !Number.isInteger(
                    userId
                )
            ) {

                return res.status(
                    400
                ).json({

                    success:
                        false,

                    message:
                        "Invalid customer ID."

                });

            }

            const userResult =
                await pool.query(
                    `
                    SELECT
                        id,
                        full_name,
                        email,
                        phone,
                        role,
                        created_at
                    FROM users
                    WHERE id = $1
                      AND LOWER(role) = 'customer'
                    `,
                    [
                        userId
                    ]
                );

            if (
                userResult.rows.length ===
                0
            ) {

                return res.status(
                    404
                ).json({

                    success:
                        false,

                    message:
                        "Customer account not found."

                });

            }

            const memberResult =
                await pool.query(
                    `
                    SELECT
                        id,
                        user_id,
                        member_id,
                        registration_type,
                        membership_plan,
                        start_date,
                        expiration_date,
                        status,
                        qr_code
                    FROM members
                    WHERE user_id = $1
                    ORDER BY id DESC
                    LIMIT 1
                    `,
                    [
                        userId
                    ]
                );

            let membership =
                memberResult.rows.length >
                0
                    ? memberResult.rows[0]
                    : null;

            if (
                membership &&
                membership.qr_code
            ) {

                membership.qr_image =
                    await QRCode.toDataURL(
                        membership.qr_code
                    );

            }

            const applicationResult =
                await pool.query(
                    `
                    SELECT
                        id,
                        user_id,
                        membership_plan,
                        amount,
                        gcash_reference,
                        payment_screenshot,
                        payment_date,
                        status,
                        rejection_reason,
                        created_at
                    FROM applications
                    WHERE user_id = $1
                    ORDER BY
                        created_at DESC,
                        id DESC
                    LIMIT 1
                    `,
                    [
                        userId
                    ]
                );

            let application =
                applicationResult.rows.length >
                0
                    ? applicationResult.rows[0]
                    : null;

            if (
                application &&
                !membership &&
                String(
                    application.status
                )
                    .trim()
                    .toUpperCase() ===
                    "APPROVED"
            ) {

                let removalReason =
                    null;

                try {

                    const removalResult =
                        await pool.query(
                            `
                            SELECT
                                removal_reason
                            FROM archived_members
                            WHERE user_id = $1
                            ORDER BY
                                archived_at DESC,
                                archive_id DESC
                            LIMIT 1
                            `,
                            [
                                userId
                            ]
                        );

                    if (
                        removalResult.rows.length >
                        0
                    ) {

                        removalReason =
                            removalResult.rows[0]
                                .removal_reason;

                    }

                } catch (
                    removalLookupError
                ) {

                    console.error(
                        "Removal reason lookup error:",
                        removalLookupError
                    );

                }

                application = {
                    ...application,

                    membership_removed:
                        true,

                    removal_reason:
                        removalReason
                };

            }

            const transactionResult =
                await pool.query(
                    `
                    SELECT
                        id,
                        application_id,
                        amount,
                        payment_method,
                        gcash_reference,
                        transaction_date,
                        status
                    FROM transactions
                    WHERE user_id = $1
                    ORDER BY
                        transaction_date DESC,
                        id DESC
                    `,
                    [
                        userId
                    ]
                );

            const notificationResult =
                await pool.query(
                    `
                    SELECT
                        id,
                        user_id,
                        title,
                        message,
                        is_read,
                        created_at
                    FROM notifications
                    WHERE user_id = $1
                    ORDER BY
                        created_at DESC,
                        id DESC
                    `,
                    [
                        userId
                    ]
                );

            res.json({

                success:
                    true,

                user:
                    userResult.rows[0],

                customer:
                    userResult.rows[0],

                membership,

                application,

                transactions:
                    transactionResult.rows,

                notifications:
                    notificationResult.rows

            });

        } catch (error) {

            console.error(
                "Customer dashboard error:",
                error
            );

            res.status(
                500
            ).json({

                success:
                    false,

                message:
                    "Unable to load customer data.",

                error:
                    error.message,

                code:
                    error.code ||
                    null,

                detail:
                    error.detail ||
                    null

            });

        }

    }
);

// =====================================
// SUBMIT APPLICATION
// =====================================

app.post(
    "/api/applications",
    async (req, res) => {

        try {

            const {
                user_id,
                membership_plan,
                amount,
                gcash_reference,
                payment_date,
                payment_screenshot
            } = req.body;

            if (!user_id) {

                return res.status(
                    400
                ).json({

                    success:
                        false,

                    message:
                        "Customer account is required."

                });

            }

            if (
                !gcash_reference ||
                !String(
                    gcash_reference
                ).trim()
            ) {

                return res.status(
                    400
                ).json({

                    success:
                        false,

                    message:
                        "GCash reference number is required."

                });

            }

            if (!payment_date) {

                return res.status(
                    400
                ).json({

                    success:
                        false,

                    message:
                        "Payment date is required."

                });

            }

            if (!payment_screenshot) {

                return res.status(
                    400
                ).json({

                    success:
                        false,

                    message:
                        "Payment screenshot is required."

                });

            }

            const fixedAmount =
                800;

            if (
                Number(
                    amount
                ) !==
                fixedAmount
            ) {

                return res.status(
                    400
                ).json({

                    success:
                        false,

                    message:
                        "Membership fee must be exactly ₱800."

                });

            }

            const userResult =
                await pool.query(
                    `
                    SELECT id
                    FROM users
                    WHERE id = $1
                      AND LOWER(role) = 'customer'
                    `,
                    [
                        user_id
                    ]
                );

            if (
                userResult.rows.length ===
                0
            ) {

                return res.status(
                    404
                ).json({

                    success:
                        false,

                    message:
                        "Customer account not found."

                });

            }

            const referenceResult =
                await pool.query(
                    `
                    SELECT id
                    FROM applications
                    WHERE LOWER(gcash_reference) = LOWER($1)
                    `,
                    [
                        String(
                            gcash_reference
                        ).trim()
                    ]
                );

            if (
                referenceResult.rows.length >
                0
            ) {

                return res.status(
                    400
                ).json({

                    success:
                        false,

                    message:
                        "This GCash reference number has already been submitted."

                });

            }

            const pendingResult =
                await pool.query(
                    `
                    SELECT id
                    FROM applications
                    WHERE user_id = $1
                      AND UPPER(status) = 'PENDING'
                    `,
                    [
                        user_id
                    ]
                );

            if (
                pendingResult.rows.length >
                0
            ) {

                return res.status(
                    400
                ).json({

                    success:
                        false,

                    message:
                        "You already have a pending application."

                });

            }

            let screenshotPath =
                null;

            try {

                const matches =
                    String(
                        payment_screenshot
                    ).match(
                        /^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/i
                    );

                if (!matches) {

                    return res.status(
                        400
                    ).json({

                        success:
                            false,

                        message:
                            "Invalid payment screenshot. Use PNG, JPG, JPEG, or WEBP."

                    });

                }

                const extension =
                    matches[1]
                        .toLowerCase()
                        .replace(
                            "jpeg",
                            "jpg"
                        );

                const imageData =
                    Buffer.from(
                        matches[2],
                        "base64"
                    );

                if (
                    imageData.length >
                    8 *
                    1024 *
                    1024
                ) {

                    return res.status(
                        400
                    ).json({

                        success:
                            false,

                        message:
                            "Payment screenshot is too large. Maximum is 8MB."

                    });

                }

                const filename =
                    `${Date.now()}-${crypto.randomUUID()}.${extension}`;

                const filepath =
                    path.join(
                        uploadDir,
                        filename
                    );

                fs.writeFileSync(
                    filepath,
                    imageData
                );

                screenshotPath =
                    `/uploads/${filename}`;

            } catch (error) {

                console.error(
                    "Screenshot save error:",
                    error
                );

                return res.status(
                    400
                ).json({

                    success:
                        false,

                    message:
                        "Unable to save payment screenshot."

                });

            }

            const result =
                await pool.query(
                    `
                    INSERT INTO applications
                    (
                        user_id,
                        membership_plan,
                        amount,
                        gcash_reference,
                        payment_screenshot,
                        payment_date,
                        status
                    )
                    VALUES
                    (
                        $1,
                        $2,
                        $3,
                        $4,
                        $5,
                        $6,
                        'PENDING'
                    )
                    RETURNING
                        id,
                        user_id,
                        membership_plan,
                        amount,
                        gcash_reference,
                        payment_screenshot,
                        payment_date,
                        status,
                        created_at
                    `,
                    [
                        user_id,

                        membership_plan ||
                            "Monthly",

                        fixedAmount,

                        String(
                            gcash_reference
                        ).trim(),

                        screenshotPath,

                        payment_date
                    ]
                );

            res.status(
                201
            ).json({

                success:
                    true,

                message:
                    "Membership application submitted. Status: PENDING.",

                application:
                    result.rows[0]

            });

        } catch (error) {

            console.error(
                "Application submission error:",
                error
            );

            res.status(
                500
            ).json({

                success:
                    false,

                message:
                    "Unable to submit membership application.",

                error:
                    error.message,

                code:
                    error.code ||
                    null,

                detail:
                    error.detail ||
                    null

            });

        }

    }
);

// =====================================
// ADMIN APPLICATIONS
// =====================================

app.get(
    "/api/admin/applications",
    async (req, res) => {

        try {

            const result =
                await pool.query(
                    `
                    SELECT
                        a.id,
                        a.user_id,
                        u.full_name,
                        u.email,
                        u.phone,
                        a.membership_plan,
                        a.amount,
                        a.gcash_reference,
                        a.payment_screenshot,
                        a.payment_date,
                        a.status,
                        a.rejection_reason,
                        a.created_at
                    FROM applications a
                    JOIN users u
                        ON u.id = a.user_id
                    ORDER BY
                        a.created_at DESC,
                        a.id DESC
                    `
                );

            res.json({

                success:
                    true,

                applications:
                    result.rows

            });

        } catch (error) {

            console.error(
                "Admin applications error:",
                error
            );

            res.status(
                500
            ).json({

                success:
                    false,

                message:
                    "Unable to load applications.",

                error:
                    error.message

            });

        }

    }
);

// =====================================
// APPROVE APPLICATION
// =====================================

app.post(
    "/api/admin/applications/:id/approve",
    async (req, res) => {

        const client =
            await pool.connect();

        let transactionStarted =
            false;

        try {

            const applicationId =
                Number(
                    req.params.id
                );

            if (
                !Number.isInteger(
                    applicationId
                )
            ) {

                return res.status(
                    400
                ).json({

                    success:
                        false,

                    message:
                        "Invalid application ID."

                });

            }

            await client.query(
                "BEGIN"
            );

            transactionStarted =
                true;

            const applicationResult =
                await client.query(
                    `
                    SELECT
                        id,
                        user_id,
                        membership_plan,
                        amount,
                        gcash_reference,
                        payment_date,
                        status
                    FROM applications
                    WHERE id = $1
                    FOR UPDATE
                    `,
                    [
                        applicationId
                    ]
                );

            if (
                applicationResult.rows.length ===
                0
            ) {

                await client.query(
                    "ROLLBACK"
                );

                transactionStarted =
                    false;

                return res.status(
                    404
                ).json({

                    success:
                        false,

                    message:
                        "Application not found."

                });

            }

            const application =
                applicationResult.rows[0];

            if (
                String(
                    application.status
                )
                    .trim()
                    .toUpperCase() !==
                "PENDING"
            ) {

                await client.query(
                    "ROLLBACK"
                );

                transactionStarted =
                    false;

                return res.status(
                    400
                ).json({

                    success:
                        false,

                    message:
                        `Application is already ${application.status}.`

                });

            }

            const memberResult =
                await client.query(
                    `
                    SELECT
                        id,
                        member_id,
                        start_date,
                        expiration_date,
                        status,
                        qr_code
                    FROM members
                    WHERE user_id = $1
                    ORDER BY id DESC
                    LIMIT 1
                    FOR UPDATE
                    `,
                    [
                        application.user_id
                    ]
                );

            const today =
                new Date();

            const startDate =
                today
                    .toISOString()
                    .slice(
                        0,
                        10
                    );

            let memberId =
                null;

            let expirationDate =
                null;

            if (
                memberResult.rows.length >
                0
            ) {

                const member =
                    memberResult.rows[0];

                memberId =
                    member.member_id;

                const existingExpiration =
                    member.expiration_date
                        ? new Date(
                            member.expiration_date
                        )
                        : today;

                const baseDate =
                    existingExpiration >
                    today
                        ? existingExpiration
                        : today;

                const newExpiration =
                    new Date(
                        baseDate
                    );

                newExpiration.setMonth(
                    newExpiration.getMonth() +
                    1
                );

                expirationDate =
                    newExpiration
                        .toISOString()
                        .slice(
                            0,
                            10
                        );

                await client.query(
                    `
                    UPDATE members
                    SET
                        membership_plan = $1,
                        start_date = $2,
                        expiration_date = $3,
                        status = 'ACTIVE'
                    WHERE id = $4
                    `,
                    [
                        application.membership_plan ||
                            "Monthly",

                        startDate,

                        expirationDate,

                        member.id
                    ]
                );

            } else {

                const newMemberId =
                    `GYM-${String(
                        application.user_id
                    ).padStart(
                        6,
                        "0"
                    )}`;

                const qrCode =
                    `ANCHOR-${crypto.randomUUID()}`;

                const expiration =
                    new Date(
                        today
                    );

                expiration.setMonth(
                    expiration.getMonth() +
                    1
                );

                expirationDate =
                    expiration
                        .toISOString()
                        .slice(
                            0,
                            10
                        );

                const newMember =
                    await client.query(
                        `
                        INSERT INTO members
                        (
                            user_id,
                            member_id,
                            registration_type,
                            membership_plan,
                            start_date,
                            expiration_date,
                            status,
                            qr_code
                        )
                        VALUES
                        (
                            $1,
                            $2,
                            'ONLINE',
                            $3,
                            $4,
                            $5,
                            'ACTIVE',
                            $6
                        )
                        RETURNING
                            id,
                            member_id
                        `,
                        [
                            application.user_id,
                            newMemberId,
                            application.membership_plan ||
                                "Monthly",
                            startDate,
                            expirationDate,
                            qrCode
                        ]
                    );

                memberId =
                    newMember.rows[0]
                        .member_id;

            }

            await client.query(
                `
                UPDATE applications
                SET
                    status = 'APPROVED',
                    rejection_reason = NULL
                WHERE id = $1
                `,
                [
                    applicationId
                ]
            );

            await client.query(
                `
                INSERT INTO transactions
                (
                    user_id,
                    application_id,
                    amount,
                    payment_method,
                    gcash_reference,
                    transaction_date,
                    status
                )
                VALUES
                (
                    $1,
                    $2,
                    $3,
                    'GCASH',
                    $4,
                    NOW(),
                    'VERIFIED'
                )
                `,
                [
                    application.user_id,
                    applicationId,
                    application.amount,
                    application.gcash_reference
                ]
            );

            await createNotification(
                client,
                application.user_id,
                "Membership Application Approved",
                `Your membership application has been approved. Your membership is now ACTIVE until ${expirationDate}.`
            );

            await client.query(
                "COMMIT"
            );

            transactionStarted =
                false;

            res.json({

                success:
                    true,

                message:
                    "Application approved. Membership is now ACTIVE.",

                member_id:
                    memberId,

                expiration_date:
                    expirationDate

            });

        } catch (error) {

            if (
                transactionStarted
            ) {

                try {

                    await client.query(
                        "ROLLBACK"
                    );

                } catch (
                    rollbackError
                ) {

                    console.error(
                        "Rollback error:",
                        rollbackError
                    );

                }

            }

            console.error(
                "Approval error:",
                error
            );

            res.status(
                500
            ).json({

                success:
                    false,

                message:
                    "Unable to approve application.",

                error:
                    error.message,

                code:
                    error.code ||
                    null,

                detail:
                    error.detail ||
                    null

            });

        } finally {

            client.release();

        }

    }
);

// =====================================
// REJECT APPLICATION
// =====================================

app.post(
    "/api/admin/applications/:id/reject",
    async (req, res) => {

        const client =
            await pool.connect();

        let transactionStarted =
            false;

        try {

            const applicationId =
                Number(
                    req.params.id
                );

            if (
                !Number.isInteger(
                    applicationId
                )
            ) {

                return res.status(
                    400
                ).json({

                    success:
                        false,

                    message:
                        "Invalid application ID."

                });

            }

            const reason =
                String(
                    req.body.reason ||
                    ""
                ).trim();

            if (!reason) {

                return res.status(
                    400
                ).json({

                    success:
                        false,

                    message:
                        "Rejection reason is required."

                });

            }

            await client.query(
                "BEGIN"
            );

            transactionStarted =
                true;

            const result =
                await client.query(
                    `
                    UPDATE applications
                    SET
                        status = 'REJECTED',
                        rejection_reason = $1
                    WHERE id = $2
                      AND UPPER(status) = 'PENDING'
                    RETURNING
                        id,
                        user_id,
                        status,
                        rejection_reason
                    `,
                    [
                        reason,
                        applicationId
                    ]
                );

            if (
                result.rows.length ===
                0
            ) {

                await client.query(
                    "ROLLBACK"
                );

                transactionStarted =
                    false;

                return res.status(
                    404
                ).json({

                    success:
                        false,

                    message:
                        "Pending application not found."

                });

            }

            const rejectedApplication =
                result.rows[0];

            await createNotification(
                client,
                rejectedApplication.user_id,
                "Membership Application Rejected",
                `Your membership application was rejected. Reason: ${reason}`
            );

            await client.query(
                "COMMIT"
            );

            transactionStarted =
                false;

            res.json({

                success:
                    true,

                message:
                    "Application rejected and customer notified.",

                application:
                    rejectedApplication

            });

        } catch (error) {

            if (
                transactionStarted
            ) {

                try {

                    await client.query(
                        "ROLLBACK"
                    );

                } catch (
                    rollbackError
                ) {

                    console.error(
                        "Rollback error:",
                        rollbackError
                    );

                }

            }

            console.error(
                "Rejection error:",
                error
            );

            res.status(
                500
            ).json({

                success:
                    false,

                message:
                    "Unable to reject application.",

                error:
                    error.message,

                code:
                    error.code ||
                    null,

                detail:
                    error.detail ||
                    null

            });

        } finally {

            client.release();

        }

    }
);

// =====================================
// ADMIN DASHBOARD
// =====================================

app.get(
    "/api/admin/dashboard",
    async (req, res) => {

        try {

            const registeredResult =
                await pool.query(
                    `
                    SELECT
                        COUNT(*)::int AS total_registered
                    FROM users
                    WHERE LOWER(role) = 'customer'
                    `
                );

            const membersResult =
                await pool.query(
                    `
                    SELECT
                        COUNT(*)::int AS total_members,

                        COUNT(*) FILTER (
                            WHERE UPPER(status) = 'ACTIVE'
                        )::int AS active_members,

                        COUNT(*) FILTER (
                            WHERE UPPER(status) = 'EXPIRED'
                        )::int AS expired_members,

                        COUNT(*) FILTER (
                            WHERE UPPER(status) = 'SUSPENDED'
                        )::int AS suspended_members

                    FROM members
                    `
                );

            const applicationsResult =
                await pool.query(
                    `
                    SELECT

                        COUNT(*) FILTER (
                            WHERE UPPER(status) = 'PENDING'
                        )::int AS pending_applications,

                        COUNT(*) FILTER (
                            WHERE UPPER(status) = 'REJECTED'
                        )::int AS rejected_applications

                    FROM applications
                    `
                );

            const attendanceResult =
                await pool.query(
                    `
                    SELECT

                        COUNT(*) FILTER (
                            WHERE UPPER(user_type) = 'MEMBER'
                              AND check_out IS NULL
                        )::int AS members_inside,

                        COUNT(*) FILTER (
                            WHERE UPPER(user_type) = 'GUEST'
                              AND check_out IS NULL
                        )::int AS guests_inside

                    FROM attendance
                    `
                );

            const timedOutGuestsResult =
                await pool.query(
                    `
                    SELECT
                        COUNT(*)::int AS timed_out_guests
                    FROM attendance a
                    JOIN guests g
                        ON g.id = a.guest_id
                    WHERE UPPER(a.user_type) = 'GUEST'
                      AND a.check_out IS NOT NULL
                      AND
                      (
                          CASE
                              WHEN UPPER(g.visit_type) = 'DAY PASS'
                              THEN ${GUEST_CLOSING_SQL}
                              WHEN g.hours IS NOT NULL
                              THEN LEAST(
                                  a.check_in + (g.hours * INTERVAL '1 hour'),
                                  ${GUEST_CLOSING_SQL}
                              )
                              ELSE ${GUEST_CLOSING_SQL}
                          END
                      ) <= ${GUEST_NOW_SQL}
                    `
                );

            const totalRegistered =
                Number(
                    registeredResult.rows[0]
                        .total_registered ||
                    0
                );

            const totalMembers =
                Number(
                    membersResult.rows[0]
                        .total_members ||
                    0
                );

            const activeMembers =
                Number(
                    membersResult.rows[0]
                        .active_members ||
                    0
                );

            const expiredMembers =
                Number(
                    membersResult.rows[0]
                        .expired_members ||
                    0
                );

            const suspendedMembers =
                Number(
                    membersResult.rows[0]
                        .suspended_members ||
                    0
                );

            const pendingApplications =
                Number(
                    applicationsResult.rows[0]
                        .pending_applications ||
                    0
                );

            const rejectedApplications =
                Number(
                    applicationsResult.rows[0]
                        .rejected_applications ||
                    0
                );

            const membersInside =
                Number(
                    attendanceResult.rows[0]
                        .members_inside ||
                    0
                );

            const guestsInside =
                Number(
                    attendanceResult.rows[0]
                        .guests_inside ||
                    0
                );

            const timedOutGuests =
                Number(
                    timedOutGuestsResult.rows[0]
                        .timed_out_guests ||
                    0
                );

            const occupancy =
                membersInside +
                guestsInside;

            res.json({

                success:
                    true,

                totalRegistered,

                totalMembers,

                activeMembers,

                expiredMembers,

                suspendedMembers,

                pendingApplications,

                rejectedApplications,

                membersInside,

                guestsInside,

                timedOutGuests,

                occupancy,

                capacity:
                    120

            });

        } catch (error) {

            console.error(
                "Dashboard error:",
                error
            );

            res.status(
                500
            ).json({

                success:
                    false,

                message:
                    "Unable to load dashboard data.",

                error:
                    error.message

            });

        }

    }
);

// =====================================
// ADMIN MEMBERS
// =====================================

app.get(
    "/api/admin/members",
    async (req, res) => {

        try {

            const result =
                await pool.query(
                    `
                    SELECT
                        m.id,
                        m.user_id,
                        m.member_id,
                        u.full_name,
                        u.email,
                        m.registration_type,
                        m.membership_plan,
                        m.start_date,
                        m.expiration_date,
                        m.status
                    FROM members m
                    JOIN users u
                        ON u.id = m.user_id
                    ORDER BY m.id DESC
                    `
                );

            res.json({

                success:
                    true,

                members:
                    result.rows

            });

        } catch (error) {

            console.error(
                "Members error:",
                error
            );

            res.status(
                500
            ).json({

                success:
                    false,

                message:
                    "Unable to load members.",

                error:
                    error.message

            });

        }

    }
);

// =====================================
// REMOVE MEMBER
// =====================================

app.delete(
    "/api/admin/members/:id",
    async (req, res) => {

        const client =
            await pool.connect();

        let transactionStarted =
            false;

        try {

            const memberId =
                Number(
                    req.params.id
                );

            if (
                !Number.isInteger(
                    memberId
                )
            ) {

                return res.status(
                    400
                ).json({

                    success:
                        false,

                    message:
                        "Invalid member ID."

                });

            }

            const reason =
                String(
                    req.body?.reason ||
                    ""
                ).trim();

            if (!reason) {

                return res.status(
                    400
                ).json({

                    success:
                        false,

                    message:
                        "Removal reason is required."

                });

            }

            await client.query(
                "BEGIN"
            );

            transactionStarted =
                true;

            const memberResult =
                await client.query(
                    `
                    SELECT
                        m.id,
                        m.user_id,
                        m.member_id,
                        m.registration_type,
                        m.membership_plan,
                        m.start_date,
                        m.expiration_date,
                        m.status,
                        m.qr_code,
                        u.full_name,
                        u.email
                    FROM members m
                    JOIN users u
                        ON u.id = m.user_id
                    WHERE m.id = $1
                    FOR UPDATE OF m
                    `,
                    [
                        memberId
                    ]
                );

            if (
                memberResult.rows.length ===
                0
            ) {

                await client.query(
                    "ROLLBACK"
                );

                transactionStarted =
                    false;

                return res.status(
                    404
                ).json({

                    success:
                        false,

                    message:
                        "Member not found."

                });

            }

            const member =
                memberResult.rows[0];

            const activeAttendance =
                await client.query(
                    `
                    SELECT id
                    FROM attendance
                    WHERE member_id = $1
                      AND check_out IS NULL
                    LIMIT 1
                    `,
                    [
                        memberId
                    ]
                );

            if (
                activeAttendance.rows.length >
                0
            ) {

                await client.query(
                    "ROLLBACK"
                );

                transactionStarted =
                    false;

                return res.status(
                    400
                ).json({

                    success:
                        false,

                    message:
                        "This member is currently inside the gym. Check out the member before removing the membership."

                });

            }

            const archiveResult =
                await client.query(
                    `
                    INSERT INTO archived_members
                    (
                        original_member_id,
                        user_id,
                        member_id,
                        full_name,
                        email,
                        registration_type,
                        membership_plan,
                        start_date,
                        expiration_date,
                        status,
                        qr_code,
                        removal_reason
                    )
                    VALUES
                    (
                        $1,
                        $2,
                        $3,
                        $4,
                        $5,
                        $6,
                        $7,
                        $8,
                        $9,
                        $10,
                        $11,
                        $12
                    )
                    RETURNING
                        archive_id,
                        original_member_id,
                        user_id,
                        member_id,
                        full_name,
                        email,
                        registration_type,
                        membership_plan,
                        start_date,
                        expiration_date,
                        status,
                        qr_code,
                        archived_at,
                        restored_at,
                        removal_reason
                    `,
                    [
                        member.id,
                        member.user_id,
                        member.member_id,
                        member.full_name,
                        member.email,
                        member.registration_type,
                        member.membership_plan,
                        member.start_date,
                        member.expiration_date,
                        member.status,
                        member.qr_code,
                        reason
                    ]
                );

            await client.query(
                `
                UPDATE attendance
                SET member_id = NULL
                WHERE member_id = $1
                `,
                [
                    memberId
                ]
            );

            const deleteResult =
                await client.query(
                    `
                    DELETE FROM members
                    WHERE id = $1
                    RETURNING
                        id,
                        member_id,
                        user_id
                    `,
                    [
                        memberId
                    ]
                );

            await createNotification(
                client,
                member.user_id,
                "Membership Removed",
                `Your membership has been removed by the gym administrator. Reason: ${reason}`
            );

            await client.query(
                "COMMIT"
            );

            transactionStarted =
                false;

            res.json({

                success:
                    true,

                message:
                    "Membership archived, removed, and customer notified successfully.",

                member:
                    deleteResult.rows[0],

                archive:
                    archiveResult.rows[0]

            });

        } catch (error) {

            if (
                transactionStarted
            ) {

                try {

                    await client.query(
                        "ROLLBACK"
                    );

                } catch (
                    rollbackError
                ) {

                    console.error(
                        "Rollback error:",
                        rollbackError
                    );

                }

            }

            console.error(
                "Archive/remove member error:",
                error
            );

            res.status(
                500
            ).json({

                success:
                    false,

                message:
                    "Unable to archive and remove membership.",

                error:
                    error.message,

                code:
                    error.code ||
                    null,

                detail:
                    error.detail ||
                    null

            });

        } finally {

            client.release();

        }

    }
);

// =====================================
// ARCHIVED MEMBERS
// =====================================

app.get(
    "/api/admin/archived-members",
    async (req, res) => {

        try {

            const result =
                await pool.query(
                    `
                    SELECT
                        archive_id,
                        original_member_id,
                        user_id,
                        member_id,
                        full_name,
                        email,
                        registration_type,
                        membership_plan,
                        start_date,
                        expiration_date,
                        status,
                        qr_code,
                        archived_at,
                        restored_at,
                        removal_reason
                    FROM archived_members
                    ORDER BY
                        archived_at DESC,
                        archive_id DESC
                    `
                );

            res.json({

                success:
                    true,

                archivedMembers:
                    result.rows

            });

        } catch (error) {

            console.error(
                "Archived members error:",
                error
            );

            res.status(
                500
            ).json({

                success:
                    false,

                message:
                    "Unable to load archived members.",

                error:
                    error.message

            });

        }

    }
);

// =====================================
// RESTORE ARCHIVED MEMBER
// =====================================

app.post(
    "/api/admin/archived-members/:id/restore",
    async (req, res) => {

        const client =
            await pool.connect();

        let transactionStarted =
            false;

        try {

            const archiveId =
                Number(
                    req.params.id
                );

            if (
                !Number.isInteger(
                    archiveId
                ) ||
                archiveId <= 0
            ) {

                return res.status(
                    400
                ).json({

                    success:
                        false,

                    message:
                        "Invalid archive ID."

                });

            }

            await client.query(
                "BEGIN"
            );

            transactionStarted =
                true;

            const archiveResult =
                await client.query(
                    `
                    SELECT
                        archive_id,
                        original_member_id,
                        user_id,
                        member_id,
                        full_name,
                        email,
                        registration_type,
                        membership_plan,
                        start_date,
                        expiration_date,
                        status,
                        qr_code,
                        archived_at,
                        restored_at,
                        removal_reason
                    FROM archived_members
                    WHERE archive_id = $1
                    FOR UPDATE
                    `,
                    [
                        archiveId
                    ]
                );

            if (
                archiveResult.rows.length ===
                0
            ) {

                await client.query(
                    "ROLLBACK"
                );

                transactionStarted =
                    false;

                return res.status(
                    404
                ).json({

                    success:
                        false,

                    message:
                        "Archived membership not found."

                });

            }

            const archived =
                archiveResult.rows[0];

            if (
                archived.restored_at
            ) {

                await client.query(
                    "ROLLBACK"
                );

                transactionStarted =
                    false;

                return res.status(
                    400
                ).json({

                    success:
                        false,

                    message:
                        "This membership has already been restored."

                });

            }

            const userResult =
                await client.query(
                    `
                    SELECT
                        id,
                        full_name,
                        email
                    FROM users
                    WHERE id = $1
                      AND LOWER(role) = 'customer'
                    FOR UPDATE
                    `,
                    [
                        archived.user_id
                    ]
                );

            if (
                userResult.rows.length ===
                0
            ) {

                await client.query(
                    "ROLLBACK"
                );

                transactionStarted =
                    false;

                return res.status(
                    404
                ).json({

                    success:
                        false,

                    message:
                        "Customer account no longer exists."

                });

            }

            const existingMemberResult =
                await client.query(
                    `
                    SELECT
                        id,
                        member_id,
                        status
                    FROM members
                    WHERE user_id = $1
                    FOR UPDATE
                    `,
                    [
                        archived.user_id
                    ]
                );

            if (
                existingMemberResult.rows.length >
                0
            ) {

                await client.query(
                    "ROLLBACK"
                );

                transactionStarted =
                    false;

                return res.status(
                    400
                ).json({

                    success:
                        false,

                    message:
                        "This customer already has a membership."

                });

            }

            let restoredMemberId =
                archived.member_id;

            const duplicateMemberResult =
                await client.query(
                    `
                    SELECT id
                    FROM members
                    WHERE member_id = $1
                    `,
                    [
                        restoredMemberId
                    ]
                );

            if (
                duplicateMemberResult.rows.length >
                0
            ) {

                restoredMemberId =
                    `GYM-${String(
                        archived.user_id
                    ).padStart(
                        6,
                        "0"
                    )}-${Date.now()}`;

            }

            const dateResult =
                await client.query(
                    `
                    SELECT
                        CASE
                            WHEN expiration_date IS NOT NULL
                                 AND expiration_date >= CURRENT_DATE
                            THEN COALESCE(
                                start_date,
                                CURRENT_DATE
                            )
                            ELSE CURRENT_DATE
                        END AS start_date,

                        CASE
                            WHEN expiration_date IS NOT NULL
                                 AND expiration_date >= CURRENT_DATE
                            THEN expiration_date
                            ELSE (
                                CURRENT_DATE +
                                INTERVAL '1 month'
                            )::date
                        END AS expiration_date

                    FROM archived_members
                    WHERE archive_id = $1
                    `,
                    [
                        archiveId
                    ]
                );

            const startDate =
                dateResult.rows[0]
                    .start_date;

            const expirationDate =
                dateResult.rows[0]
                    .expiration_date;

            const newQrCode =
                `ANCHOR-${crypto.randomUUID()}`;

            const memberResult =
                await client.query(
                    `
                    INSERT INTO members
                    (
                        user_id,
                        member_id,
                        registration_type,
                        membership_plan,
                        start_date,
                        expiration_date,
                        status,
                        qr_code
                    )
                    VALUES
                    (
                        $1,
                        $2,
                        $3,
                        $4,
                        $5,
                        $6,
                        'ACTIVE',
                        $7
                    )
                    RETURNING
                        id,
                        user_id,
                        member_id,
                        registration_type,
                        membership_plan,
                        start_date,
                        expiration_date,
                        status,
                        qr_code
                    `,
                    [
                        archived.user_id,
                        restoredMemberId,
                        archived.registration_type ||
                            "ONLINE",
                        archived.membership_plan ||
                            "Monthly",
                        startDate,
                        expirationDate,
                        newQrCode
                    ]
                );

            await client.query(
                `
                UPDATE archived_members
                SET
                    restored_at =
                        CURRENT_TIMESTAMP,

                    status =
                        'RESTORED'

                WHERE archive_id = $1
                `,
                [
                    archiveId
                ]
            );

            await client.query(
                "COMMIT"
            );

            transactionStarted =
                false;

            res.json({

                success:
                    true,

                message:
                    "Membership restored successfully.",

                member:
                    memberResult.rows[0]

            });

        } catch (error) {

            if (
                transactionStarted
            ) {

                try {

                    await client.query(
                        "ROLLBACK"
                    );

                } catch (
                    rollbackError
                ) {

                    console.error(
                        "Rollback error:",
                        rollbackError
                    );

                }

            }

            console.error(
                "Restore archived membership error:",
                error
            );

            res.status(
                500
            ).json({

                success:
                    false,

                message:
                    "Unable to restore membership.",

                error:
                    error.message,

                code:
                    error.code ||
                    null,

                detail:
                    error.detail ||
                    null

            });

        } finally {

            client.release();

        }

    }
);

// =====================================
// ADMIN TRANSACTIONS
// =====================================

app.get(
    "/api/admin/transactions",
    async (req, res) => {

        try {

            const result =
                await pool.query(
                    `
                    SELECT
                        t.id,
                        t.user_id,
                        t.application_id,
                        u.full_name,
                        u.email,
                        t.amount,
                        t.payment_method,
                        t.gcash_reference,
                        t.transaction_date,
                        t.status
                    FROM transactions t
                    JOIN users u
                        ON u.id = t.user_id
                    ORDER BY
                        t.transaction_date DESC,
                        t.id DESC
                    `
                );

            res.json({

                success:
                    true,

                transactions:
                    result.rows

            });

        } catch (error) {

            console.error(
                "Transactions error:",
                error
            );

            res.status(
                500
            ).json({

                success:
                    false,

                message:
                    "Unable to load transactions.",

                error:
                    error.message

            });

        }

    }
);

// =====================================
// DELETE TRANSACTION
// =====================================

app.delete(
    "/api/admin/transactions/:id",
    async (req, res) => {

        try {

            const transactionId =
                Number(
                    req.params.id
                );

            if (
                !Number.isInteger(
                    transactionId
                )
            ) {

                return res.status(
                    400
                ).json({

                    success:
                        false,

                    message:
                        "Invalid transaction ID."

                });

            }

            const result =
                await pool.query(
                    `
                    DELETE FROM transactions
                    WHERE id = $1
                    RETURNING id
                    `,
                    [
                        transactionId
                    ]
                );

            if (
                result.rows.length ===
                0
            ) {

                return res.status(
                    404
                ).json({

                    success:
                        false,

                    message:
                        "Transaction not found."

                });

            }

            res.json({

                success:
                    true,

                message:
                    "Transaction deleted successfully.",

                transaction:
                    result.rows[0]

            });

        } catch (error) {

            console.error(
                "Delete transaction error:",
                error
            );

            res.status(
                500
            ).json({

                success:
                    false,

                message:
                    "Unable to delete transaction.",

                error:
                    error.message

            });

        }

    }
);

// =====================================
// ADMIN ATTENDANCE
// =====================================
//
// THIS IS THE IMPORTANT TIMER SECTION.
//
// The backend is the AUTHORITATIVE timer.
//
// The browser should use:
//     remaining_seconds
//
// It should NOT decide the guest's true
// expiration time itself.
//
// =====================================

app.get(
    "/api/admin/attendance",
    async (req, res) => {

        try {

            const result =
                await pool.query(
                    `
                    SELECT
                        a.id,
                        a.member_id,
                        a.guest_id,
                        a.user_type,
                        a.check_in,
                        a.check_out,

                        CASE

                            WHEN UPPER(
                                a.user_type
                            ) = 'MEMBER'

                            THEN
                                u.full_name

                            WHEN UPPER(
                                a.user_type
                            ) = 'GUEST'

                            THEN
                                g.full_name

                            ELSE
                                'Unknown'

                        END AS full_name,

                        CASE

                            WHEN UPPER(
                                a.user_type
                            ) = 'GUEST'

                            AND g.id IS NOT NULL

                            THEN

                                CASE

                                    WHEN UPPER(
                                        g.visit_type
                                    ) = 'DAY PASS'

                                    THEN
                                        ${GUEST_CLOSING_SQL}

                                    WHEN g.hours IS NOT NULL

                                    THEN
                                        LEAST(

                                            a.check_in +
                                            (
                                                g.hours *
                                                INTERVAL '1 hour'
                                            ),

                                            ${GUEST_CLOSING_SQL}

                                        )

                                    ELSE
                                        ${GUEST_CLOSING_SQL}

                                END

                            ELSE
                                NULL

                        END AS guest_end_time,

                        CASE

                            WHEN UPPER(
                                a.user_type
                            ) = 'GUEST'

                            AND g.id IS NOT NULL

                            THEN

                                EXTRACT(
                                    EPOCH FROM
                                    (
                                        (
                                            CASE

                                                WHEN UPPER(
                                                    g.visit_type
                                                ) = 'DAY PASS'

                                                THEN
                                                    ${GUEST_CLOSING_SQL}

                                                WHEN g.hours IS NOT NULL

                                                THEN
                                                    LEAST(

                                                        a.check_in +
                                                        (
                                                            g.hours *
                                                            INTERVAL '1 hour'
                                                        ),

                                                        ${GUEST_CLOSING_SQL}

                                                    )

                                                ELSE
                                                    ${GUEST_CLOSING_SQL}

                                            END
                                        ) AT TIME ZONE 'Asia/Manila'
                                    )
                                ) * 1000

                            ELSE
                                NULL

                        END AS guest_end_time_epoch,

                        CASE

                            WHEN UPPER(
                                a.user_type
                            ) = 'GUEST'

                            AND g.id IS NOT NULL

                            THEN

                                GREATEST(

                                    0,

                                    FLOOR(

                                        EXTRACT(
                                            EPOCH FROM
                                            (

                                                (

                                                    CASE

                                                        WHEN UPPER(
                                                            g.visit_type
                                                        ) = 'DAY PASS'

                                                        THEN
                                                            ${GUEST_CLOSING_SQL}

                                                        WHEN g.hours IS NOT NULL

                                                        THEN
                                                            LEAST(

                                                                a.check_in +
                                                                (
                                                                    g.hours *
                                                                    INTERVAL '1 hour'
                                                                ),

                                                                ${GUEST_CLOSING_SQL}

                                                            )

                                                        ELSE
                                                            ${GUEST_CLOSING_SQL}

                                                    END

                                                )

                                                -
                                                ${GUEST_NOW_SQL}

                                            )
                                        )

                                    )

                                )::int

                            ELSE
                                NULL

                        END AS remaining_seconds,

                        CASE

                            WHEN UPPER(
                                a.user_type
                            ) = 'GUEST'

                            AND g.id IS NOT NULL

                            AND

                            (

                                CASE

                                    WHEN UPPER(
                                        g.visit_type
                                    ) = 'DAY PASS'

                                    THEN
                                        ${GUEST_CLOSING_SQL}

                                    WHEN g.hours IS NOT NULL

                                    THEN
                                        LEAST(

                                            a.check_in +
                                            (
                                                g.hours *
                                                INTERVAL '1 hour'
                                            ),

                                            ${GUEST_CLOSING_SQL}

                                        )

                                    ELSE
                                        ${GUEST_CLOSING_SQL}

                                END

                            ) <=
                            ${GUEST_NOW_SQL}

                            THEN
                                TRUE

                            ELSE
                                FALSE

                        END AS timed_out

                    FROM attendance a

                    LEFT JOIN members m
                        ON m.id =
                        a.member_id

                    LEFT JOIN users u
                        ON u.id =
                        m.user_id

                    LEFT JOIN guests g
                        ON g.id =
                        a.guest_id

                    ORDER BY
                        a.check_in DESC,
                        a.id DESC

                    LIMIT 100
                    `
                );

            res.json({

                success:
                    true,

                attendance:
                    result.rows

            });

        } catch (error) {

            console.error(
                "Attendance error:",
                error
            );

            res.status(
                500
            ).json({

                success:
                    false,

                message:
                    "Unable to load attendance.",

                error:
                    error.message,

                code:
                    error.code ||
                    null,

                detail:
                    error.detail ||
                    null

            });

        }

    }
);

// =====================================
// MEMBER QR ATTENDANCE
// =====================================

app.post(
    "/api/admin/attendance/scan",
    async (req, res) => {

        const client =
            await pool.connect();

        let transactionStarted =
            false;

        try {

            const qrCode =
                String(
                    req.body.qr_code ||
                    ""
                ).trim();

            if (!qrCode) {

                return res.status(
                    400
                ).json({

                    success:
                        false,

                    message:
                        "QR code is required."

                });

            }

            await client.query(
                "BEGIN"
            );

            transactionStarted =
                true;

            const memberResult =
                await client.query(
                    `
                    SELECT
                        m.id,
                        m.user_id,
                        m.member_id,
                        m.membership_plan,
                        m.expiration_date,
                        m.status,
                        m.qr_code,
                        u.full_name,
                        u.email
                    FROM members m
                    JOIN users u
                        ON u.id = m.user_id
                    WHERE m.qr_code = $1
                    LIMIT 1
                    FOR UPDATE
                    `,
                    [
                        qrCode
                    ]
                );

            if (
                memberResult.rows.length ===
                0
            ) {

                await client.query(
                    "ROLLBACK"
                );

                transactionStarted =
                    false;

                return res.status(
                    404
                ).json({

                    success:
                        false,

                    message:
                        "QR code does not belong to a gym member."

                });

            }

            const member =
                memberResult.rows[0];

            const status =
                String(
                    member.status ||
                    ""
                )
                    .trim()
                    .toUpperCase();

            const expiration =
                member.expiration_date
                    ? new Date(
                        member.expiration_date
                    )
                    : null;

            const expirationEnd =
                expiration
                    ? new Date(
                        expiration
                    )
                    : null;

            if (
                expirationEnd
            ) {

                expirationEnd.setHours(
                    23,
                    59,
                    59,
                    999
                );

            }

            if (
                expirationEnd &&
                !Number.isNaN(
                    expirationEnd.getTime()
                ) &&
                expirationEnd <
                new Date()
            ) {

                await client.query(
                    `
                    UPDATE members
                    SET status = 'EXPIRED'
                    WHERE id = $1
                    `,
                    [
                        member.id
                    ]
                );

                await client.query(
                    "COMMIT"
                );

                transactionStarted =
                    false;

                return res.status(
                    400
                ).json({

                    success:
                        false,

                    message:
                        "This membership has expired."

                });

            }

            if (
                status !==
                "ACTIVE"
            ) {

                await client.query(
                    "ROLLBACK"
                );

                transactionStarted =
                    false;

                return res.status(
                    400
                ).json({

                    success:
                        false,

                    message:
                        "This member does not have an active membership."

                });

            }

            const recentScanResult =
                await client.query(
                    `
                    SELECT id
                    FROM attendance
                    WHERE member_id = $1
                      AND UPPER(user_type) = 'MEMBER'
                      AND GREATEST(
                            check_in,
                            COALESCE(check_out, check_in)
                          ) >=
                          ${GUEST_NOW_SQL} - INTERVAL '5 minutes'
                    ORDER BY
                        check_in DESC,
                        id DESC
                    LIMIT 1
                    `,
                    [
                        member.id
                    ]
                );

            if (
                recentScanResult.rows.length >
                0
            ) {

                await client.query(
                    "ROLLBACK"
                );

                transactionStarted =
                    false;

                return res.status(
                    429
                ).json({

                    success:
                        false,

                    message:
                        "This member was scanned recently. Please wait 5 minutes before scanning again."

                });

            }

            const openAttendanceResult =
                await client.query(
                    `
                    SELECT
                        id,
                        check_in,
                        check_out
                    FROM attendance
                    WHERE member_id = $1
                      AND UPPER(user_type) = 'MEMBER'
                      AND check_out IS NULL
                    ORDER BY
                        check_in DESC,
                        id DESC
                    LIMIT 1
                    FOR UPDATE
                    `,
                    [
                        member.id
                    ]
                );

            let action;

            let attendance;

            if (
                openAttendanceResult.rows.length >
                0
            ) {

                const activeAttendance =
                    openAttendanceResult.rows[0];

                const checkoutResult =
                    await client.query(
                        `
                        UPDATE attendance
                        SET
                            check_out =
                                CURRENT_TIMESTAMP
                        WHERE id = $1
                        RETURNING
                            id,
                            member_id,
                            guest_id,
                            user_type,
                            check_in,
                            check_out
                        `,
                        [
                            activeAttendance.id
                        ]
                    );

                attendance =
                    checkoutResult.rows[0];

                action =
                    "CHECKED_OUT";

            } else {

                const checkinResult =
                    await client.query(
                        `
                        INSERT INTO attendance
                        (
                            member_id,
                            user_type
                        )
                        VALUES
                        (
                            $1,
                            'MEMBER'
                        )
                        RETURNING
                            id,
                            member_id,
                            guest_id,
                            user_type,
                            check_in,
                            check_out
                        `,
                        [
                            member.id
                        ]
                    );

                attendance =
                    checkinResult.rows[0];

                action =
                    "CHECKED_IN";

            }

            const occupancyResult =
                await client.query(
                    `
                    SELECT

                        COUNT(*) FILTER (
                            WHERE UPPER(user_type) = 'MEMBER'
                              AND check_out IS NULL
                        )::int AS members_inside,

                        COUNT(*) FILTER (
                            WHERE UPPER(user_type) = 'GUEST'
                              AND check_out IS NULL
                        )::int AS guests_inside

                    FROM attendance
                    `
                );

            const membersInside =
                Number(
                    occupancyResult.rows[0]
                        .members_inside ||
                    0
                );

            const guestsInside =
                Number(
                    occupancyResult.rows[0]
                        .guests_inside ||
                    0
                );

            const occupancy =
                membersInside +
                guestsInside;

            await client.query(
                "COMMIT"
            );

            transactionStarted =
                false;

            res.json({

                success:
                    true,

                action,

                message:
                    action === "CHECKED_IN"
                        ? `${member.full_name} checked in successfully.`
                        : `${member.full_name} checked out successfully.`,

                member: {

                    id:
                        member.id,

                    user_id:
                        member.user_id,

                    member_id:
                        member.member_id,

                    full_name:
                        member.full_name,

                    email:
                        member.email,

                    membership_plan:
                        member.membership_plan,

                    status:
                        member.status

                },

                attendance,

                membersInside,

                guestsInside,

                occupancy,

                capacity:
                    120

            });

        } catch (error) {

            if (
                transactionStarted
            ) {

                try {

                    await client.query(
                        "ROLLBACK"
                    );

                } catch (
                    rollbackError
                ) {

                    console.error(
                        "Rollback error:",
                        rollbackError
                    );

                }

            }

            console.error(
                "QR attendance error:",
                error
            );

            res.status(
                500
            ).json({

                success:
                    false,

                message:
                    "Unable to process QR scan.",

                error:
                    error.message,

                code:
                    error.code ||
                    null,

                detail:
                    error.detail ||
                    null

            });

        } finally {

            client.release();

        }

    }
);

// =====================================
// GUEST / WALK-IN
// =====================================

app.post(
    "/api/admin/guests",
    async (req, res) => {

        const client =
            await pool.connect();

        let transactionStarted =
            false;

        try {

            const {
                full_name,
                phone,
                visit_type,
                hours,
                amount_paid,
                payment_method
            } = req.body;

            const finalName =
                String(
                    full_name ||
                    ""
                ).trim();

            const finalVisitType =
                String(
                    visit_type ||
                    ""
                )
                    .trim()
                    .toUpperCase();

            const finalPaymentMethod =
                String(
                    payment_method ||
                    ""
                )
                    .trim()
                    .toUpperCase();

            if (!finalName) {

                return res.status(
                    400
                ).json({

                    success:
                        false,

                    message:
                        "Guest name is required."

                });

            }

            const finalPhone =
                String(
                    phone ||
                    ""
                ).trim();

            if (!/^09\d{9}$/.test(finalPhone)) {

                return res.status(
                    400
                ).json({

                    success:
                        false,

                    message:
                        "Enter an 11-digit Philippine mobile number starting with 09."

                });

            }

            if (
                finalVisitType !==
                "GUEST" &&
                finalVisitType !==
                "DAY PASS"
            ) {

                return res.status(
                    400
                ).json({

                    success:
                        false,

                    message:
                        "Invalid guest visit type."

                });

            }

            if (
                !finalPaymentMethod
            ) {

                return res.status(
                    400
                ).json({

                    success:
                        false,

                    message:
                        "Payment method is required."

                });

            }

            if (
                finalPaymentMethod !==
                "CASH" &&
                finalPaymentMethod !==
                "GCASH"
            ) {

                return res.status(
                    400
                ).json({

                    success:
                        false,

                    message:
                        "Invalid payment method."

                });

            }

            let finalHours =
                null;

            let finalAmount =
                0;

            if (
                finalVisitType ===
                "DAY PASS"
            ) {

                finalHours =
                    null;

                finalAmount =
                    100;

            } else {

                finalHours =
                    Number(
                        hours
                    );

                if (
                    !Number.isInteger(
                        finalHours
                    ) ||
                    finalHours < 1 ||
                    finalHours > 3
                ) {

                    return res.status(
                        400
                    ).json({

                        success:
                            false,

                        message:
                            "Guest Visit must be between 1 and 3 hours."

                    });

                }

                finalAmount =
                    finalHours *
                    30;

            }

            const submittedAmount =
                Number(
                    amount_paid
                );

            if (
                !Number.isFinite(
                    submittedAmount
                ) ||
                submittedAmount !==
                finalAmount
            ) {

                return res.status(
                    400
                ).json({

                    success:
                        false,

                    message:
                        `Payment amount must be exactly ₱${finalAmount}.`

                });

            }

            await client.query(
                "BEGIN"
            );

            transactionStarted =
                true;

            const guestResult =
                await client.query(
                    `
                    INSERT INTO guests
                    (
                        full_name,
                        phone,
                        visit_type,
                        hours,
                        amount_paid,
                        payment_method
                    )
                    VALUES
                    (
                        $1,
                        $2,
                        $3,
                        $4,
                        $5,
                        $6
                    )
                    RETURNING
                        id,
                        full_name,
                        phone,
                        visit_type,
                        hours,
                        amount_paid,
                        payment_method,
                        created_at
                    `,
                    [
                        finalName,
                        finalPhone,
                        finalVisitType,
                        finalHours,
                        finalAmount,
                        finalPaymentMethod
                    ]
                );

            const guest =
                guestResult.rows[0];

            const attendanceResult =
                await client.query(
                    `
                    INSERT INTO attendance
                    (
                        guest_id,
                        user_type
                    )
                    VALUES
                    (
                        $1,
                        'GUEST'
                    )
                    RETURNING
                        id,
                        guest_id,
                        user_type,
                        check_in,
                        check_out
                    `,
                    [
                        guest.id
                    ]
                );

            await client.query(
                "COMMIT"
            );

            transactionStarted =
                false;

            res.status(
                201
            ).json({

                success:
                    true,

                message:
                    "Guest recorded and checked in.",

                guest,

                attendance:
                    attendanceResult.rows[0]

            });

        } catch (error) {

            if (
                transactionStarted
            ) {

                try {

                    await client.query(
                        "ROLLBACK"
                    );

                } catch (
                    rollbackError
                ) {

                    console.error(
                        "Rollback error:",
                        rollbackError
                    );

                }

            }

            console.error(
                "Guest error:",
                error
            );

            res.status(
                500
            ).json({

                success:
                    false,

                message:
                    "Unable to record guest.",

                error:
                    error.message,

                code:
                    error.code ||
                    null,

                detail:
                    error.detail ||
                    null

            });

        } finally {

            client.release();

        }

    }
);

// =====================================
// CHECK OUT ATTENDANCE
// =====================================
//
// MANUAL CHECKOUT:
//
// Admin can manually check out.
//
// AUTOMATIC CHECKOUT:
//
// This is ONLY allowed when the server
// determines that the guest timer has
// actually reached zero.
//
// This protection prevents admin.js from
// accidentally checking out a guest early.
//
app.patch(
    "/api/admin/attendance/:id/checkout",
    async (req, res) => {

        try {

            const attendanceId =
                Number(
                    req.params.id
                );

            if (
                !Number.isInteger(
                    attendanceId
                )
            ) {

                return res.status(
                    400
                ).json({

                    success:
                        false,

                    message:
                        "Invalid attendance ID."

                });

            }

            const automatic =
                req.body &&
                req.body.automatic ===
                true;

            // ---------------------------------
            // GET CURRENT ATTENDANCE + TIMER
            // ---------------------------------

            const targetResult =
                await pool.query(
                    `
                    SELECT

                        a.id,

                        a.member_id,

                        a.guest_id,

                        a.user_type,

                        a.check_in,

                        a.check_out,

                        CASE

                            WHEN UPPER(
                                a.user_type
                            ) = 'GUEST'

                            AND g.id IS NOT NULL

                            THEN

                                CASE

                                    WHEN UPPER(
                                        g.visit_type
                                    ) = 'DAY PASS'

                                    THEN
                                        ${GUEST_CLOSING_SQL}

                                    WHEN g.hours IS NOT NULL

                                    THEN
                                        LEAST(

                                            a.check_in +
                                            (
                                                g.hours *
                                                INTERVAL '1 hour'
                                            ),

                                            ${GUEST_CLOSING_SQL}

                                        )

                                    ELSE
                                        ${GUEST_CLOSING_SQL}

                                END

                            ELSE
                                NULL

                        END AS guest_end_time,

                        CASE

                            WHEN UPPER(
                                a.user_type
                            ) = 'GUEST'

                            AND g.id IS NOT NULL

                            THEN

                                GREATEST(

                                    0,

                                    FLOOR(

                                        EXTRACT(
                                            EPOCH FROM
                                            (

                                                (

                                                    CASE

                                                        WHEN UPPER(
                                                            g.visit_type
                                                        ) = 'DAY PASS'

                                                        THEN
                                                            ${GUEST_CLOSING_SQL}

                                                        WHEN g.hours IS NOT NULL

                                                        THEN
                                                            LEAST(

                                                                a.check_in +
                                                                (
                                                                    g.hours *
                                                                    INTERVAL '1 hour'
                                                                ),

                                                                ${GUEST_CLOSING_SQL}

                                                            )

                                                        ELSE
                                                            ${GUEST_CLOSING_SQL}

                                                    END

                                                )

                                                -
                                                ${GUEST_NOW_SQL}

                                            )
                                        )

                                    )

                                )::int

                            ELSE
                                NULL

                        END AS guest_remaining_seconds

                    FROM attendance a

                    LEFT JOIN guests g
                        ON g.id =
                        a.guest_id

                    WHERE
                        a.id = $1
                        AND a.check_out IS NULL
                    `,
                    [
                        attendanceId
                    ]
                );

            if (
                targetResult.rows.length ===
                0
            ) {

                return res.status(
                    404
                ).json({

                    success:
                        false,

                    message:
                        "Active attendance record not found."

                });

            }

            const target =
                targetResult.rows[0];

            const isGuest =
                String(
                    target.user_type ||
                    ""
                )
                    .toUpperCase() ===
                "GUEST";

            // =================================
            // AUTOMATIC CHECKOUT PROTECTION
            // =================================
            //
            // If the browser says:
            //
            // "Timer reached zero"
            //
            // but the SERVER says:
            //
            // "There is still time"
            //
            // DO NOT CHECK OUT.
            //
            if (
                automatic &&
                isGuest
            ) {

                const remainingSeconds =
                    Number(
                        target.guest_remaining_seconds
                    );

                if (
                    Number.isFinite(
                        remainingSeconds
                    ) &&
                    remainingSeconds > 0
                ) {

                    return res.status(
                        409
                    ).json({

                        success:
                            false,

                        message:
                            "Guest visit has not expired yet.",

                        remaining_seconds:
                            remainingSeconds,

                        guest_end_time:
                            target.guest_end_time

                    });

                }

            }

            // =================================
            // UPDATE CHECKOUT
            // =================================

            const result =
                await pool.query(
                    `
                    UPDATE attendance
                    SET
                        check_out =
                            CASE

                                WHEN
                                    $2 = TRUE
                                    AND $3 = TRUE
                                    AND $4::timestamp IS NOT NULL
                                    AND $4::timestamp <=
                                        ${GUEST_NOW_SQL}

                                THEN
                                    $4::timestamp

                                ELSE
                                    CURRENT_TIMESTAMP

                            END

                    WHERE
                        id = $1
                        AND check_out IS NULL

                    RETURNING
                        id,
                        member_id,
                        guest_id,
                        user_type,
                        check_in,
                        check_out
                    `,
                    [
                        attendanceId,

                        automatic,

                        isGuest,

                        target.guest_end_time ||
                            null
                    ]
                );

            if (
                result.rows.length ===
                0
            ) {

                return res.status(
                    404
                ).json({

                    success:
                        false,

                    message:
                        "Active attendance record not found."

                });

            }

            res.json({

                success:
                    true,

                message:
                    automatic &&
                    isGuest
                        ? "Guest visit timed out and was checked out automatically."
                        : "Checked out successfully.",

                attendance:
                    result.rows[0]

            });

        } catch (error) {

            console.error(
                "Checkout error:",
                error
            );

            res.status(
                500
            ).json({

                success:
                    false,

                message:
                    "Unable to check out.",

                error:
                    error.message,

                code:
                    error.code ||
                    null,

                detail:
                    error.detail ||
                    null

            });

        }

    }
);

// =====================================
// REMOVE GUEST ATTENDANCE RECORD
// =====================================

app.delete(
    "/api/admin/attendance/:id/remove",
    async (req, res) => {

        try {

            const attendanceId =
                Number(
                    req.params.id
                );

            if (
                !Number.isInteger(
                    attendanceId
                )
            ) {

                return res.status(
                    400
                ).json({

                    success:
                        false,

                    message:
                        "Invalid attendance ID."

                });

            }

            const result =
                await pool.query(
                    `
                    DELETE FROM attendance
                    WHERE id = $1
                      AND UPPER(user_type) = 'GUEST'
                    RETURNING
                        id,
                        guest_id,
                        user_type,
                        check_in,
                        check_out
                    `,
                    [
                        attendanceId
                    ]
                );

            if (
                result.rows.length ===
                0
            ) {

                return res.status(
                    404
                ).json({

                    success:
                        false,

                    message:
                        "Guest attendance record not found."

                });

            }

            res.json({

                success:
                    true,

                message:
                    "Guest attendance record removed successfully.",

                attendance:
                    result.rows[0]

            });

        } catch (error) {

            console.error(
                "Remove attendance error:",
                error
            );

            res.status(
                500
            ).json({

                success:
                    false,

                message:
                    "Unable to remove guest attendance record.",

                error:
                    error.message,

                code:
                    error.code ||
                    null,

                detail:
                    error.detail ||
                    null

            });

        }

    }
);

// =====================================
// AUTOMATIC GUEST CHECKOUT
// =====================================
//
// SERVER-SIDE BACKUP TIMER.
//
// This means the guest will still be
// automatically checked out even if the
// admin browser is closed.
//
// The server checks every 30 seconds.
//
// The IMPORTANT part is:
//
//     expired.end_time <= GUEST_NOW_SQL
//
// A late-night guest in TEST MODE will
// therefore not be considered expired
// until the correct next-day time.
//
async function autoCheckoutExpiredGuests() {

    try {

        const result =
            await pool.query(
                `
                WITH expired AS (

                    SELECT

                        a.id,

                        CASE

                            WHEN UPPER(
                                g.visit_type
                            ) = 'DAY PASS'

                            THEN
                                ${GUEST_CLOSING_SQL}

                            WHEN g.hours IS NOT NULL

                            THEN
                                LEAST(

                                    a.check_in +
                                    (
                                        g.hours *
                                        INTERVAL '1 hour'
                                    ),

                                    ${GUEST_CLOSING_SQL}

                                )

                            ELSE
                                ${GUEST_CLOSING_SQL}

                        END AS end_time

                    FROM attendance a

                    JOIN guests g
                        ON g.id =
                        a.guest_id

                    WHERE

                        UPPER(
                            a.user_type
                        ) = 'GUEST'

                        AND a.check_out IS NULL

                )

                UPDATE attendance a

                SET
                    check_out =
                        expired.end_time

                FROM expired

                WHERE

                    a.id =
                    expired.id

                    AND expired.end_time <=
                        ${GUEST_NOW_SQL}

                RETURNING

                    a.id,

                    a.guest_id,

                    a.check_out
                `
            );

        if (
            result.rows.length >
            0
        ) {

            console.log(
                `Automatically checked out ${result.rows.length} expired guest visit(s).`
            );

        }

    } catch (error) {

        console.error(
            "Automatic guest checkout error:",
            error
        );

    }

}

// =====================================
// START AUTOMATIC TIMER
// =====================================

autoCheckoutExpiredGuests();

setInterval(
    autoCheckoutExpiredGuests,
    30 * 1000
);

// =====================================
// REPORTS
// =====================================

app.get(
    "/api/admin/reports",
    async (req, res) => {

        try {

            const totalVisitsResult =
                await pool.query(
                    `
                    SELECT
                        COUNT(*)::int AS total_visits
                    FROM attendance
                    `
                );

            const memberVisitsResult =
                await pool.query(
                    `
                    SELECT
                        COUNT(*)::int AS member_visits
                    FROM attendance
                    WHERE UPPER(user_type) = 'MEMBER'
                    `
                );

            const guestVisitsResult =
                await pool.query(
                    `
                    SELECT
                        COUNT(*)::int AS guest_visits
                    FROM attendance
                    WHERE UPPER(user_type) = 'GUEST'
                    `
                );

            const dailyResult =
                await pool.query(
                    `
                    SELECT
                        EXTRACT(
                            HOUR FROM check_in
                        )::int AS hour,

                        COUNT(*)::int AS visits

                    FROM attendance

                    WHERE
                        check_in::date =
                        CURRENT_DATE

                    GROUP BY
                        EXTRACT(
                            HOUR FROM check_in
                        )

                    ORDER BY
                        hour
                    `
                );

            res.json({

                success:
                    true,

                totalVisits:
                    totalVisitsResult.rows[0]
                        .total_visits ||
                    0,

                memberVisits:
                    memberVisitsResult.rows[0]
                        .member_visits ||
                    0,

                guestVisits:
                    guestVisitsResult.rows[0]
                        .guest_visits ||
                    0,

                hourly:
                    dailyResult.rows

            });

        } catch (error) {

            console.error(
                "Reports error:",
                error
            );

            res.status(
                500
            ).json({

                success:
                    false,

                message:
                    "Unable to load reports.",

                error:
                    error.message

            });

        }

    }
);

// =====================================
// EQUIPMENT
// =====================================

app.get(
    "/api/admin/equipment",
    async (req, res) => {

        try {

            res.json({

                success:
                    true,

                equipment:
                    []

            });

        } catch (error) {

            console.error(
                "Equipment error:",
                error
            );

            res.status(
                500
            ).json({

                success:
                    false,

                message:
                    "Unable to load equipment.",

                error:
                    error.message

            });

        }

    }
);

// =====================================
// API 404
// =====================================

app.use(
    "/api",
    (req, res) => {

        res.status(
            404
        ).json({

            success:
                false,

            message:
                "API route not found.",

            path:
                req.originalUrl

        });

    }
);

// =====================================
// START SERVER
// =====================================

app.listen(
    PORT,
    "0.0.0.0",
    () => {

        console.log(
            `ANCHOR server running on port ${PORT}`
        );

        console.log(
            `Guest timer test mode: ${
                GUEST_TIMER_TEST_MODE
                    ? "ON"
                    : "OFF"
            }`
        );

        console.log(
            GUEST_TIMER_TEST_MODE
                ? "Late-night test mode: 10:00 PM next-day closing for check-ins at/after 10:00 PM."
                : "Normal guest mode: 10:00 PM same-day closing."
        );

    }
);