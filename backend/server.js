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
const databaseSchema = process.env.DATABASE_SCHEMA || "public";
if (!/^[a-z_][a-z0-9_]*$/.test(databaseSchema)) {
    throw new Error("DATABASE_SCHEMA must be a lowercase PostgreSQL schema identifier.");
}
const BUILT_IN_ADMIN_EMAIL = "admin@gmail.com";
const BUILT_IN_ADMIN_PASSWORD = "admin123";
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

function requireAdministrator(req, res) {
    if (req.adminUser?.role === "admin") {
        return true;
    }

    res.status(403).json({
        success: false,
        message: "Administrator authorization is required for this action."
    });
    return false;
}

function isBuiltInAdminLogin(email, password) {
    const submitted = Buffer.from(password);
    const expected = Buffer.from(BUILT_IN_ADMIN_PASSWORD);

    return (
        email === BUILT_IN_ADMIN_EMAIL &&
        submitted.length === expected.length &&
        crypto.timingSafeEqual(submitted, expected)
    );
}

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    options: `-c timezone=Asia/Manila -c search_path=${databaseSchema}`,
    connectionTimeoutMillis: 10000,
    query_timeout: 15000,
    statement_timeout: 15000
});

async function ensureBuiltInAdminAccount() {
    const client = await pool.connect();
    let transactionStarted = false;

    try {
        await client.query("BEGIN");
        transactionStarted = true;
        await client.query(
            "SELECT pg_advisory_xact_lock(hashtext($1))",
            [`built-in-admin:${BUILT_IN_ADMIN_EMAIL}`]
        );

        const existing = await client.query(
            `
            SELECT id, full_name, email, role
            FROM users
            WHERE LOWER(email) = $1
            ORDER BY CASE
                WHEN LOWER(role) = 'admin' THEN 0
                WHEN LOWER(role) = 'staff' THEN 1
                ELSE 2
            END, id
            LIMIT 1
            FOR UPDATE
            `,
            [BUILT_IN_ADMIN_EMAIL]
        );

        let user = existing.rows[0];
        if (!user) {
            const passwordHash = await bcrypt.hash(
                BUILT_IN_ADMIN_PASSWORD,
                12
            );
            const inserted = await client.query(
                `
                INSERT INTO users (full_name, email, password, phone, role)
                VALUES ('ANCHOR Gym Administrator', $1, $2, '', 'admin')
                RETURNING id, full_name, email, role
                `,
                [BUILT_IN_ADMIN_EMAIL, passwordHash]
            );
            user = inserted.rows[0];
        }

        if (!["admin", "staff"].includes(String(user.role).toLowerCase())) {
            await client.query("ROLLBACK");
            transactionStarted = false;
            return null;
        }

        await client.query("COMMIT");
        transactionStarted = false;
        return user;
    } catch (error) {
        if (transactionStarted) {
            try {
                await client.query("ROLLBACK");
            } catch (rollbackError) {
                console.error("Built-in admin rollback error:", rollbackError);
            }
        }
        throw error;
    } finally {
        client.release();
    }
}

async function ensureDashboardSchema() {
    await pool.query(`
        DO $$
        BEGIN
            IF to_regclass('member_transactions') IS NULL
               AND to_regclass('transactions') IS NOT NULL THEN
                ALTER TABLE transactions RENAME TO member_transactions;
            END IF;
        END;
        $$;
    `);
    await pool.query(`
        ALTER TABLE member_transactions
        ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ
    `);
    await pool.query(`
        UPDATE member_transactions
        SET created_at = COALESCE(transaction_date, NOW())
        WHERE created_at IS NULL
    `);
    await pool.query(`
        ALTER TABLE member_transactions
        ALTER COLUMN created_at SET DEFAULT NOW(),
        ALTER COLUMN created_at SET NOT NULL
    `);
    await pool.query(`
        CREATE INDEX IF NOT EXISTS member_transactions_created_at_idx
        ON member_transactions (created_at)
    `);
    await pool.query(`
        CREATE TABLE IF NOT EXISTS guest_transactions (
            id BIGSERIAL PRIMARY KEY,
            guest_id BIGINT NOT NULL,
            guest_name TEXT NOT NULL,
            visit_type TEXT NOT NULL,
            amount NUMERIC(10, 2) NOT NULL CHECK (amount >= 0),
            payment_method TEXT NOT NULL
                CHECK (payment_method IN ('CASH', 'GCASH')),
            transaction_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            transaction_reference TEXT,
            attendance_id BIGINT,
            extension_type TEXT,
            additional_hours INTEGER,
            payment_status TEXT NOT NULL DEFAULT 'CONFIRMED'
                CHECK (payment_status IN ('PENDING', 'CONFIRMED', 'FAILED')),
            previous_expiration TIMESTAMPTZ,
            new_expiration TIMESTAMPTZ
        )
    `);
    await pool.query(`
        ALTER TABLE guest_transactions
        ADD COLUMN IF NOT EXISTS transaction_reference TEXT,
        ADD COLUMN IF NOT EXISTS attendance_id BIGINT,
        ADD COLUMN IF NOT EXISTS extension_type TEXT,
        ADD COLUMN IF NOT EXISTS additional_hours INTEGER,
        ADD COLUMN IF NOT EXISTS payment_status TEXT DEFAULT 'CONFIRMED',
        ADD COLUMN IF NOT EXISTS previous_expiration TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS new_expiration TIMESTAMPTZ
    `);
    await pool.query(`
        ALTER TABLE guest_transactions
        ALTER COLUMN payment_status SET DEFAULT 'CONFIRMED',
        ALTER COLUMN payment_status TYPE TEXT,
        ALTER COLUMN payment_status SET NOT NULL
    `);
    await pool.query(`
        ALTER TABLE guest_transactions
        ADD COLUMN IF NOT EXISTS idempotency_key TEXT
    `);
    await pool.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS guest_transactions_idempotency_key_idx
        ON guest_transactions (idempotency_key)
        WHERE idempotency_key IS NOT NULL
    `);
    await pool.query(`
        CREATE TABLE IF NOT EXISTS guest_visit_extensions (
            id BIGSERIAL PRIMARY KEY,
            attendance_id BIGINT NOT NULL,
            guest_id BIGINT NOT NULL,
            extension_type TEXT NOT NULL CHECK (extension_type IN ('EXTRA_HOURS', 'ALL_DAY')),
            additional_hours INTEGER,
            amount NUMERIC(10, 2) NOT NULL CHECK (amount >= 0),
            payment_status TEXT NOT NULL DEFAULT 'CONFIRMED'
                CHECK (payment_status IN ('PENDING', 'CONFIRMED', 'FAILED')),
            previous_expiration TIMESTAMPTZ,
            new_expiration TIMESTAMPTZ,
            transaction_reference TEXT,
            guest_transaction_id BIGINT,
            idempotency_key TEXT,
            payment_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);
    await pool.query(`
        ALTER TABLE guest_visit_extensions
        ADD COLUMN IF NOT EXISTS transaction_reference TEXT,
        ADD COLUMN IF NOT EXISTS payment_date TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS payment_status TEXT DEFAULT 'CONFIRMED',
        ADD COLUMN IF NOT EXISTS previous_expiration TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS new_expiration TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS amount NUMERIC(10, 2),
        ADD COLUMN IF NOT EXISTS additional_hours INTEGER,
        ADD COLUMN IF NOT EXISTS extension_type TEXT,
        ADD COLUMN IF NOT EXISTS attendance_id BIGINT,
        ADD COLUMN IF NOT EXISTS guest_id BIGINT,
        ADD COLUMN IF NOT EXISTS guest_transaction_id BIGINT,
        ADD COLUMN IF NOT EXISTS idempotency_key TEXT
    `);
    await pool.query(`
        DO $$
        DECLARE
            duplicate_guard RECORD;
        BEGIN
            FOR duplicate_guard IN
                SELECT conname
                FROM pg_constraint
                WHERE conrelid = 'guest_visit_extensions'::regclass
                  AND contype = 'u'
                  AND pg_get_constraintdef(oid) =
                      'UNIQUE (attendance_id, extension_type, additional_hours, payment_status)'
            LOOP
                EXECUTE format(
                    'ALTER TABLE guest_visit_extensions DROP CONSTRAINT %I',
                    duplicate_guard.conname
                );
            END LOOP;
        END;
        $$
    `);
    await pool.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS guest_visit_extensions_idempotency_key_idx
        ON guest_visit_extensions (idempotency_key)
        WHERE idempotency_key IS NOT NULL
    `);
    await pool.query(`
        ALTER TABLE attendance
        ADD COLUMN IF NOT EXISTS expiration_time TIMESTAMPTZ
    `);
    await pool.query(`
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1
                FROM information_schema.columns
                WHERE table_schema = current_schema()
                  AND table_name = 'attendance'
                  AND column_name = 'expires_at'
            ) THEN
                EXECUTE '
                    UPDATE attendance
                    SET expiration_time = expires_at
                    WHERE expiration_time IS NULL
                      AND expires_at IS NOT NULL
                ';
            END IF;
        END;
        $$
    `);
    await pool.query(`
        CREATE INDEX IF NOT EXISTS guest_transactions_created_at_idx
        ON guest_transactions (created_at)
    `);
    await pool.query(`
        CREATE INDEX IF NOT EXISTS guest_transactions_attendance_idx
        ON guest_transactions (attendance_id)
    `);
    await pool.query(`
        CREATE INDEX IF NOT EXISTS guest_visit_extensions_attendance_idx
        ON guest_visit_extensions (attendance_id)
    `);
    await pool.query(`
        UPDATE guest_transactions gt
        SET attendance_id = (
            SELECT a.id
            FROM attendance a
            WHERE a.guest_id = gt.guest_id
            ORDER BY ABS(EXTRACT(EPOCH FROM (
                (a.check_in AT TIME ZONE 'Asia/Manila') - gt.transaction_date
            ))), a.id
            LIMIT 1
        )
        WHERE gt.attendance_id IS NULL
          AND gt.extension_type IS NULL
          AND EXISTS (
              SELECT 1
              FROM attendance a
              WHERE a.guest_id = gt.guest_id
          )
    `);
    await pool.query(`
        DO $$
        DECLARE
            status_constraint RECORD;
        BEGIN
            FOR status_constraint IN
                SELECT conname
                FROM pg_constraint
                WHERE conrelid = 'members'::regclass
                  AND contype = 'c'
                  AND pg_get_constraintdef(oid) ILIKE '%status%'
                  AND (
                      pg_get_constraintdef(oid) ILIKE '%ACTIVE%'
                      OR pg_get_constraintdef(oid) ILIKE '%PENDING%'
                      OR pg_get_constraintdef(oid) ILIKE '%EXPIRED%'
                      OR pg_get_constraintdef(oid) ILIKE '%SUSPENDED%'
                      OR pg_get_constraintdef(oid) ILIKE '%REVOKED%'
                  )
            LOOP
                EXECUTE FORMAT(
                    'ALTER TABLE members DROP CONSTRAINT %I',
                    status_constraint.conname
                );
            END LOOP;
        END;
        $$;
    `);
    await pool.query(`
        UPDATE members
        SET status = CASE
            WHEN UPPER(status) IN ('SUSPENDED', 'ARCHIVED') THEN 'REVOKED'
            WHEN UPPER(status) = 'EXPIRED' THEN 'ACTIVE'
            WHEN status IS NULL THEN 'PENDING'
            ELSE UPPER(status)
        END
        WHERE status IS NULL
           OR status <> UPPER(status)
           OR UPPER(status) IN ('SUSPENDED', 'ARCHIVED', 'EXPIRED')
    `);
    await pool.query(`
        DO $$
        DECLARE
            invalid_statuses TEXT;
        BEGIN
            SELECT string_agg(DISTINCT status, ', ')
            INTO invalid_statuses
            FROM members
            WHERE status NOT IN ('ACTIVE', 'PENDING', 'REVOKED');

            IF invalid_statuses IS NOT NULL THEN
                RAISE EXCEPTION
                    'Cannot migrate member statuses safely; unsupported values: %',
                    invalid_statuses;
            END IF;
        END;
        $$
    `);
    await pool.query(`
        ALTER TABLE members
        ALTER COLUMN status SET DEFAULT 'PENDING',
        ALTER COLUMN status SET NOT NULL
    `);
    await pool.query(`
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1
                FROM pg_constraint
                WHERE conname = 'members_lifecycle_status_check'
                  AND conrelid = 'members'::regclass
            ) THEN
                ALTER TABLE members
                ADD CONSTRAINT members_lifecycle_status_check
                CHECK (status IN ('ACTIVE', 'PENDING', 'REVOKED'));
            END IF;
        END;
        $$;
    `);
    await pool.query(`
        ALTER TABLE members
        ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP WITHOUT TIME ZONE,
        ADD COLUMN IF NOT EXISTS archived_archive_id BIGINT
    `);
    await pool.query(`
        CREATE TABLE IF NOT EXISTS admin_sessions (
            token_hash CHAR(64) PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            expires_at TIMESTAMPTZ NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);
    await pool.query(`
        CREATE TABLE IF NOT EXISTS password_reset_tokens (
            token_hash CHAR(64) PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            expires_at TIMESTAMPTZ NOT NULL,
            used_at TIMESTAMPTZ,
            attempts INTEGER NOT NULL DEFAULT 0,
            verified_at TIMESTAMPTZ,
            reset_token_hash CHAR(64),
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);
    await pool.query(`
        ALTER TABLE password_reset_tokens
        ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS reset_token_hash CHAR(64)
    `);
    await pool.query(`
        CREATE INDEX IF NOT EXISTS password_reset_tokens_user_created_idx
        ON password_reset_tokens (user_id, created_at DESC)
    `);
    await pool.query(`
        CREATE INDEX IF NOT EXISTS admin_sessions_expiration_idx
        ON admin_sessions (expires_at)
    `);
    await pool.query(`
        DO $$
        BEGIN
            IF current_schema() = 'public'
               AND to_regclass('cron.job') IS NOT NULL THEN
                EXECUTE $unschedule$
                    DO $remove_job$
                    DECLARE existing_job RECORD;
                    BEGIN
                        FOR existing_job IN
                            SELECT jobid
                            FROM cron.job
                            WHERE jobname = 'anchor-gym-transaction-retention'
                        LOOP
                            PERFORM cron.unschedule(existing_job.jobid);
                        END LOOP;
                    END;
                    $remove_job$
                $unschedule$;
            END IF;
        END;
        $$
    `);
}

let customerProfilePhotoColumnReady = false;
let paymentScreenshotColumnReady = false;
let pausedDaysRemainingColumnReady = false;

async function ensurePausedDaysRemainingColumn() {
    if (pausedDaysRemainingColumnReady) {
        return;
    }

    await pool.query(
        `
        ALTER TABLE members
        ADD COLUMN IF NOT EXISTS
            paused_days_remaining INTEGER NOT NULL DEFAULT 0
                CHECK (paused_days_remaining >= 0)
        `
    );
    pausedDaysRemainingColumnReady = true;
}

async function ensureCustomerProfilePhotoColumn() {
    if (customerProfilePhotoColumnReady) {
        return;
    }

    await pool.query(
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_photo TEXT"
    );
    customerProfilePhotoColumnReady = true;
}

async function ensurePaymentScreenshotColumn() {
    if (paymentScreenshotColumnReady) {
        return;
    }

    await pool.query(
        "ALTER TABLE applications ALTER COLUMN payment_screenshot TYPE TEXT"
    );
    paymentScreenshotColumnReady = true;
}

function decodePaymentScreenshot(value) {
    const matches =
        String(value || "").match(
            /^data:image\/(png|jpeg|jpg|webp);base64,([A-Za-z0-9+/]+={0,2})$/i
        );

    if (!matches) {
        return null;
    }

    const imageData =
        Buffer.from(matches[2], "base64");

    if (imageData.length > 6 * 1024 * 1024) {
        return null;
    }

    const requestedType =
        matches[1].toLowerCase();
    const mimeType =
        requestedType === "jpg" || requestedType === "jpeg"
            ? "image/jpeg"
            : `image/${requestedType}`;
    const validSignature =
        (
            mimeType === "image/png" &&
            imageData.subarray(0, 8).equals(
                Buffer.from("89504e470d0a1a0a", "hex")
            )
        ) ||
        (
            mimeType === "image/jpeg" &&
            imageData[0] === 0xff &&
            imageData[1] === 0xd8 &&
            imageData[2] === 0xff
        ) ||
        (
            mimeType === "image/webp" &&
            imageData.toString("ascii", 0, 4) === "RIFF" &&
            imageData.toString("ascii", 8, 12) === "WEBP"
        );

    return validSignature
        ? { mimeType, imageData }
        : null;
}

function decodeProfilePhoto(value) {
    const matches =
        String(value || "").match(
            /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/i
        );

    if (!matches) {
        return null;
    }

    const imageData =
        Buffer.from(matches[2], "base64");

    if (imageData.length > 5 * 1024 * 1024) {
        return null;
    }

    const mimeType =
        matches[1].toLowerCase();
    const isPng =
        imageData.subarray(0, 8).equals(
            Buffer.from("89504e470d0a1a0a", "hex")
        );
    const isJpeg =
        imageData[0] === 0xff &&
        imageData[1] === 0xd8 &&
        imageData[2] === 0xff;
    const isWebp =
        imageData.toString("ascii", 0, 4) === "RIFF" &&
        imageData.toString("ascii", 8, 12) === "WEBP";
    const isValidImage =
        (
            mimeType === "png" &&
            isPng
        ) ||
        (
            mimeType === "jpeg" &&
            isJpeg
        ) ||
        (
            mimeType === "webp" &&
            isWebp
        );

    if (!isValidImage) {
        return null;
    }

    return {
        mimeType:
            mimeType === "jpeg"
                ? "image/jpeg"
                : `image/${mimeType}`,
        imageData: imageData
    };
}

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

function normalizedPhoneSql(column) {
    const digits = `regexp_replace(${column}, '[^0-9]', '', 'g')`;
    return `
        CASE
            WHEN ${digits} LIKE '63%'
            THEN '0' || SUBSTRING(${digits} FROM 3)
            ELSE NULLIF(${digits}, '')
        END
    `;
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
const GUEST_TIMER_TEST_MODE =
    process.env.GUEST_TIMER_TEST_MODE === "true";

const GYM_CLOSING_TIME =
    process.env.GYM_CLOSING_TIME || "22:00";

if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(GYM_CLOSING_TIME)) {
    throw new Error("GYM_CLOSING_TIME must use 24-hour HH:MM format.");
}

const [GYM_CLOSING_HOUR, GYM_CLOSING_MINUTE] =
    GYM_CLOSING_TIME.split(":").map(Number);

const GYM_CLOSING_INTERVAL =
    `${GYM_CLOSING_HOUR} hours ${GYM_CLOSING_MINUTE} minutes`;

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
    ) + INTERVAL '${GYM_CLOSING_INTERVAL}'
`;

const GUEST_TEST_CLOSING_SQL = `
    CASE

        WHEN a.check_in >=
        (
            date_trunc(
                'day',
                a.check_in
            ) + INTERVAL '${GYM_CLOSING_INTERVAL}'
        )

        THEN
            date_trunc(
                'day',
                a.check_in
            ) + INTERVAL '24 hours' + INTERVAL '${GYM_CLOSING_INTERVAL}'

        ELSE
            date_trunc(
                'day',
                a.check_in
            ) + INTERVAL '${GYM_CLOSING_INTERVAL}'

    END
`;

const GUEST_INITIAL_CLOSING_SQL =
    GUEST_TIMER_TEST_MODE
        ? GUEST_TEST_CLOSING_SQL
        : GUEST_DAY_CLOSING_SQL;

const GUEST_INITIAL_EXPIRATION_SQL = `
    CASE
        WHEN UPPER(g.visit_type) = 'DAY PASS'
        THEN ${GUEST_INITIAL_CLOSING_SQL}
        WHEN g.hours IS NOT NULL
        THEN LEAST(
            a.check_in + (g.hours * INTERVAL '1 hour'),
            ${GUEST_INITIAL_CLOSING_SQL}
        )
        ELSE ${GUEST_INITIAL_CLOSING_SQL}
    END
`;

const GUEST_CLOSING_SQL =
    `COALESCE(a.expiration_time, ${GUEST_INITIAL_EXPIRATION_SQL})`;

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

async function getCurrentOccupancy(queryable = pool) {
    const result = await queryable.query(`
        WITH open_visits AS (
            SELECT
                UPPER(a.user_type) AS user_type,
                CASE
                    WHEN UPPER(a.user_type) = 'MEMBER' THEN COALESCE(
                        ${normalizedPhoneSql("u.phone")},
                        'member-user:' || COALESCE(m.user_id::text, a.id::text)
                    )
                    WHEN UPPER(a.user_type) = 'GUEST' THEN COALESCE(
                        ${normalizedPhoneSql("g.phone")},
                        'guest-id:' || COALESCE(a.guest_id::text, a.id::text)
                    )
                END AS person_key
            FROM attendance a
            LEFT JOIN members m
                ON m.id = a.member_id
            LEFT JOIN users u
                ON u.id = m.user_id
            LEFT JOIN guests g
                ON g.id = a.guest_id
            WHERE a.check_out IS NULL
              AND UPPER(a.user_type) IN ('MEMBER', 'GUEST')
              AND (
                  UPPER(a.user_type) = 'MEMBER'
                  OR (
                      UPPER(a.user_type) = 'GUEST'
                      AND ${GUEST_CLOSING_SQL} > ${GUEST_NOW_SQL}
                  )
              )
        ),
        people_inside AS (
            SELECT
                person_key,
                BOOL_OR(user_type = 'MEMBER') AS has_member_visit
            FROM open_visits
            WHERE person_key IS NOT NULL
            GROUP BY person_key
        ),
        duplicate_people AS (
            SELECT person_key
            FROM open_visits
            WHERE person_key IS NOT NULL
            GROUP BY person_key
            HAVING COUNT(*) > 1
        )
        SELECT
            COUNT(*)::int AS occupancy,
            COUNT(*) FILTER (
                WHERE has_member_visit
            )::int AS members_inside,
            COUNT(*) FILTER (
                WHERE NOT has_member_visit
            )::int AS guests_inside,
            (SELECT COUNT(*)::int FROM duplicate_people)
                AS duplicate_open_people
        FROM people_inside
    `);

    const membersInside = Number(result.rows[0].members_inside || 0);
    const guestsInside = Number(result.rows[0].guests_inside || 0);

    return {
        membersInside,
        guestsInside,
        occupancy: Number(result.rows[0].occupancy || 0),
        duplicateOpenPeople: Number(result.rows[0].duplicate_open_people || 0)
    };
}

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

app.post("/api/admin/login", async (req, res) => {
    try {
        const email = String(req.body?.email || "").trim().toLowerCase();
        const password = String(req.body?.password || "");

        if (!email || !password) {
            return res.status(400).json({
                success: false,
                message: "Email and password are required."
            });
        }

        const isBuiltInAdmin =
            isBuiltInAdminLogin(email, password);
        let user;

        if (isBuiltInAdmin) {
            user = await ensureBuiltInAdminAccount();
            if (!user) {
                return res.status(409).json({
                    success: false,
                    message: "The built-in admin email belongs to a non-admin account. Ask an administrator to resolve the account conflict."
                });
            }
        } else {
            const result = await pool.query(
                `
                SELECT id, full_name, email, password, role
                FROM users
                WHERE LOWER(email) = $1
                  AND LOWER(role) IN ('admin', 'staff')
                ORDER BY id
                LIMIT 1
                `,
                [email]
            );

            if (
                result.rows.length === 0 ||
                !(await bcrypt.compare(password, result.rows[0].password))
            ) {
                return res.status(401).json({
                    success: false,
                    message: "Invalid admin or staff email or password."
                });
            }

            user = result.rows[0];
        }

        if (!user) {
            return res.status(401).json({
                success: false,
                message: "Invalid admin or staff email or password."
            });
        }

        const token = crypto.randomBytes(32).toString("base64url");
        const tokenHash = crypto
            .createHash("sha256")
            .update(token)
            .digest("hex");
        const sessionDays = req.body?.remember_me === true ? 30 : 1;

        await pool.query(
            `
            INSERT INTO admin_sessions (token_hash, user_id, expires_at)
            VALUES ($1, $2, NOW() + ($3::int * INTERVAL '1 day'))
            `,
            [tokenHash, user.id, sessionDays]
        );

        return res.json({
            success: true,
            token,
            expires_in: sessionDays * 24 * 60 * 60,
            user: {
                id: user.id,
                full_name: user.full_name,
                email: user.email,
                role: String(user.role).toLowerCase()
            }
        });
    } catch (error) {
        console.error("Admin login error:", error);
        return res.status(500).json({
            success: false,
            message: "Unable to sign in to the admin dashboard."
        });
    }
});

app.use("/api/admin", async (req, res, next) => {
    const authorization = String(req.get("Authorization") || "");
    const match = authorization.match(/^Bearer\s+([A-Za-z0-9_-]+)$/i);

    if (!match) {
        return res.status(401).json({
            success: false,
            message: "Admin or staff authentication is required."
        });
    }

    try {
        const tokenHash = crypto
            .createHash("sha256")
            .update(match[1])
            .digest("hex");
        const result = await pool.query(
            `
            SELECT u.id, u.full_name, u.email, LOWER(u.role) AS role
            FROM admin_sessions s
            JOIN users u
                ON u.id = s.user_id
            WHERE s.token_hash = $1
              AND s.expires_at > NOW()
              AND LOWER(u.role) IN ('admin', 'staff')
            `,
            [tokenHash]
        );

        if (result.rows.length === 0) {
            return res.status(401).json({
                success: false,
                message: "Admin session is invalid or expired. Sign in again."
            });
        }

        req.adminUser = result.rows[0];
        return next();
    } catch (error) {
        console.error("Admin session validation error:", error);
        return res.status(500).json({
            success: false,
            message: "Unable to verify the admin session."
        });
    }
});

app.post("/api/admin/logout", async (req, res) => {
    const authorization = String(req.get("Authorization") || "");
    const match = authorization.match(/^Bearer\s+([A-Za-z0-9_-]+)$/i);
    if (match) {
        const tokenHash = crypto
            .createHash("sha256")
            .update(match[1])
            .digest("hex");
        await pool.query(
            "DELETE FROM admin_sessions WHERE token_hash = $1",
            [tokenHash]
        );
    }
    return res.json({ success: true });
});

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

app.delete("/api/admin/archived-members/:id", (req, res) => {
    if (!requireAdministrator(req, res)) {
        return;
    }

    return res.status(410).json({
        success: false,
        message: "Archived membership history is retained and cannot be permanently deleted."
    });
});

// =====================================
// SIGN UP
// =====================================

app.post(
    "/api/signup",
    async (req, res) => {
        const email =
            normalizeSignupEmail(req.body.email);
        const fullName =
            String(req.body.full_name || req.body.fullName || "").trim();
        const phone =
            normalizePhilippinePhone(req.body.phone);
        const password =
            String(req.body.password || "");

        if (!isValidGmailAddress(email)) {
            return res.status(400).json({
                success: false,
                message: "Please enter a Gmail address in the format name@gmail.com. This checks the format only; it cannot confirm that the mailbox exists."
            });
        }

        if (!fullName || !phone || !password) {
            return res.status(400).json({
                success: false,
                message: "Please complete all required fields."
            });
        }

        if (!/^09\d{9}$/.test(phone)) {
            return res.status(400).json({
                success: false,
                message: "Please enter a valid 11-digit Philippine mobile number starting with 09."
            });
        }

        if (password.length < 6) {
            return res.status(400).json({
                success: false,
                message: "Password must be at least 6 characters."
            });
        }

        try {
            const passwordHash =
                await bcrypt.hash(password, 10);
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
                    VALUES ($1, $2, $3, $4, 'customer')
                    RETURNING
                        id,
                        full_name,
                        email,
                        phone,
                        role,
                        created_at
                    `,
                    [fullName, email, passwordHash, phone]
                );

            return res.status(201).json({
                success: true,
                message: "Account created. The email address was not verified.",
                user: userResult.rows[0]
            });
        } catch (error) {
            if (error.code === "23505") {
                return res.status(409).json({
                    success: false,
                    message: "An account with this email already exists."
                });
            }

            console.error("Signup account creation error:", error);
            return res.status(500).json({
                success: false,
                message: "Unable to create the account. Please try again."
            });
        }
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

app.post(
    "/api/auth/forgot-password",
    async (req, res) => {
        const email =
            normalizeSignupEmail(req.body.email);

        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            return res.status(400).json({
                success: false,
                message: "Enter a valid email address."
            });
        }

        const gmailClientId =
            String(process.env.GOOGLE_CLIENT_ID || "").trim();
        const gmailClientSecret =
            String(process.env.GOOGLE_CLIENT_SECRET || "").trim();
        const gmailRefreshToken =
            String(process.env.GMAIL_REFRESH_TOKEN || "").trim();
        const emailFrom =
            String(process.env.EMAIL_FROM || "").trim();

        if (
            !gmailClientId ||
            !gmailClientSecret ||
            !gmailRefreshToken ||
            !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailFrom)
        ) {
            return res.status(503).json({
                success: false,
                message: "Password reset email is not configured. Set GMAIL_REFRESH_TOKEN and EMAIL_FROM on the backend; use the Gmail address authorized for sending."
            });
        }

        let client;
        let tokenHash;
        let recipient;
        let verificationCode;

        try {
            client = await pool.connect();
            await client.query("BEGIN");
            await client.query(
                `
                DELETE FROM password_reset_tokens
                WHERE created_at < NOW() - INTERVAL '1 day'
                `
            );

            const userResult =
                await client.query(
                    `
                    SELECT id, full_name, email
                    FROM users
                    WHERE LOWER(email) = $1
                      AND LOWER(role) = 'customer'
                    LIMIT 1
                    FOR UPDATE
                    `,
                    [email]
                );

            if (userResult.rows.length > 0) {
                const user = userResult.rows[0];
                const recentRequests =
                    await client.query(
                        `
                        SELECT COUNT(*)::int AS count
                        FROM password_reset_tokens
                        WHERE user_id = $1
                          AND created_at > NOW() - INTERVAL '15 minutes'
                        `,
                        [user.id]
                    );

                if (recentRequests.rows[0].count < 3) {
                    verificationCode =
                        crypto.randomInt(0, 10000)
                            .toString()
                            .padStart(4, "0");
                    tokenHash =
                        crypto.createHmac("sha256", gmailClientSecret)
                            .update(verificationCode)
                            .digest("hex");

                    await client.query(
                        `
                        UPDATE password_reset_tokens
                        SET used_at = NOW()
                        WHERE user_id = $1
                          AND used_at IS NULL
                        `,
                        [user.id]
                    );

                    await client.query(
                        `
                        INSERT INTO password_reset_tokens
                            (token_hash, user_id, expires_at)
                        VALUES ($1, $2, NOW() + INTERVAL '30 minutes')
                        `,
                        [tokenHash, user.id]
                    );

                    recipient = user.email;
                }
            }

            await client.query("COMMIT");
            client.release();
            client = null;

            if (recipient && verificationCode && tokenHash) {
                const gmailClient =
                    new OAuth2Client(
                        gmailClientId,
                        gmailClientSecret
                    );
                gmailClient.setCredentials({
                    refresh_token: gmailRefreshToken
                });

                const accessToken =
                    await gmailClient.getAccessToken();

                if (!accessToken.token) {
                    throw new Error(
                        "Gmail did not provide an API access token."
                    );
                }

                const messageBoundary =
                    `anchor-${crypto.randomBytes(16).toString("hex")}`;
                const emailHtml =
                    `<p>We received a request to reset your ANCHOR password.</p>` +
                    `<p>Your password reset code is <strong>${verificationCode}</strong>.</p>` +
                    `<p>Enter this code on the password reset page within 30 minutes. If you did not request this, you can ignore this email.</p>`;
                const rawMessage =
                    [
                        `From: ${emailFrom}`,
                        `To: ${recipient}`,
                        "Subject: Reset your ANCHOR Gym System password",
                        "MIME-Version: 1.0",
                        `Content-Type: multipart/alternative; boundary="${messageBoundary}"`,
                        "",
                        `--${messageBoundary}`,
                        "Content-Type: text/plain; charset=UTF-8",
                        "Content-Transfer-Encoding: 8bit",
                        "",
                        `We received a request to reset your ANCHOR password. Enter this code on the password reset page within 30 minutes: ${verificationCode}`,
                        "",
                        "If you did not request this, you can ignore this email.",
                        "",
                        `--${messageBoundary}`,
                        "Content-Type: text/html; charset=UTF-8",
                        "Content-Transfer-Encoding: 8bit",
                        "",
                        emailHtml,
                        "",
                        `--${messageBoundary}--`
                    ].join("\r\n");
                const gmailRaw =
                    Buffer.from(rawMessage)
                        .toString("base64")
                        .replace(/\+/g, "-")
                        .replace(/\//g, "_")
                        .replace(/=+$/g, "");

                const emailResponse =
                    await fetch(
                        "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
                        {
                            method: "POST",
                            headers: {
                                Authorization: `Bearer ${accessToken.token}`,
                                "Content-Type": "application/json"
                            },
                            body: JSON.stringify({
                                raw: gmailRaw
                            }),
                            signal: AbortSignal.timeout(15000)
                        }
                    );

                if (!emailResponse.ok) {
                    const error =
                        new Error("Gmail API rejected the reset email request.");
                    error.statusCode =
                        emailResponse.status;
                    throw error;
                }
            }

            return res.json({
                success: true,
                message: "If an ANCHOR customer account exists for that email, a password reset code will be sent."
            });
        } catch (error) {
            if (client) {
                try {
                    await client.query("ROLLBACK");
                } catch (rollbackError) {
                    console.error(
                        "Password reset request rollback error:",
                        rollbackError
                    );
                }
            }

            if (tokenHash) {
                try {
                    await pool.query(
                        "DELETE FROM password_reset_tokens WHERE token_hash = $1",
                        [tokenHash]
                    );
                } catch (cleanupError) {
                    console.error(
                        "Password reset token cleanup error:",
                        cleanupError
                    );
                }
            }

            console.error("Password reset email request error:", error);
            const providerStatus =
                error && typeof error === "object"
                    ? Number(error.statusCode || 0)
                    : 0;
            let failureMessage =
                "Unable to send a password reset email right now. Please try again later.";

            if (providerStatus === 401) {
                failureMessage =
                    "Gmail authorization failed. Re-authorize the Gmail account and update GMAIL_REFRESH_TOKEN.";
            } else if (providerStatus === 403) {
                failureMessage =
                    "Gmail denied permission to send. Enable the Gmail API and authorize the account with the gmail.send permission.";
            } else if (providerStatus === 400) {
                failureMessage =
                    "Gmail rejected the sender or message. Confirm EMAIL_FROM matches the Gmail account authorized to send.";
            } else if (providerStatus === 429) {
                failureMessage =
                    "Gmail rate-limited the request. Please wait a few minutes and try again.";
            } else if (providerStatus >= 500) {
                failureMessage =
                    "Gmail is temporarily unavailable. Please try again later.";
            } else if (
                error && typeof error === "object" &&
                error.name === "TimeoutError"
            ) {
                failureMessage =
                    "The email service took too long to respond. Please try again.";
            }

            return res.status(503).json({
                success: false,
                message: failureMessage
            });
        } finally {
            if (client) {
                client.release();
            }
        }
    }
);

app.post(
    "/api/auth/verify-reset-code",
    async (req, res) => {
        const email =
            normalizeSignupEmail(req.body.email);
        const verificationCode =
            String(req.body.code || "").trim();
        const invalidCodeMessage =
            "This code is invalid, expired, or can no longer be used. Request a new code.";

        if (
            !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
            !/^\d{4}$/.test(verificationCode)
        ) {
            return res.status(400).json({
                success: false,
                message: invalidCodeMessage
            });
        }

        const gmailClientSecret =
            String(process.env.GOOGLE_CLIENT_SECRET || "").trim();
        if (!gmailClientSecret) {
            return res.status(503).json({
                success: false,
                message: "Password reset is not configured. Contact the administrator."
            });
        }

        const tokenHash =
            crypto.createHmac("sha256", gmailClientSecret)
                .update(verificationCode)
                .digest("hex");
        const resetToken =
            crypto.randomBytes(32).toString("hex");
        const resetTokenHash =
            crypto.createHash("sha256")
                .update(resetToken)
                .digest("hex");
        const client = await pool.connect();
        let transactionStarted = false;

        try {
            await client.query("BEGIN");
            transactionStarted = true;

            const userResult =
                await client.query(
                    `
                    SELECT id
                    FROM users
                    WHERE LOWER(email) = $1
                      AND LOWER(role) = 'customer'
                    LIMIT 1
                    FOR UPDATE
                    `,
                    [email]
                );

            if (userResult.rows.length === 0) {
                await client.query("ROLLBACK");
                transactionStarted = false;
                return res.status(400).json({
                    success: false,
                    message: invalidCodeMessage
                });
            }

            const userId = userResult.rows[0].id;
            const tokenResult =
                await client.query(
                    `
                    SELECT token_hash
                    FROM password_reset_tokens
                    WHERE user_id = $1
                      AND expires_at > NOW()
                      AND used_at IS NULL
                      AND attempts < 5
                    ORDER BY created_at DESC
                    LIMIT 1
                    FOR UPDATE
                    `,
                    [userId]
                );

            if (tokenResult.rows.length === 0) {
                await client.query("ROLLBACK");
                transactionStarted = false;
                return res.status(400).json({
                    success: false,
                    message: invalidCodeMessage
                });
            }

            const reset = tokenResult.rows[0];
            const suppliedHashBuffer = Buffer.from(tokenHash, "hex");
            const storedHashBuffer = Buffer.from(
                String(reset.token_hash || "").trim(),
                "hex"
            );
            const codeMatches =
                storedHashBuffer.length === suppliedHashBuffer.length &&
                crypto.timingSafeEqual(storedHashBuffer, suppliedHashBuffer);

            if (!codeMatches) {
                await client.query(
                    `
                    UPDATE password_reset_tokens
                    SET attempts = attempts + 1
                    WHERE token_hash = $1
                      AND expires_at > NOW()
                      AND used_at IS NULL
                      AND attempts < 5
                    `,
                    [reset.token_hash]
                );
                await client.query("COMMIT");
                transactionStarted = false;
                return res.status(400).json({
                    success: false,
                    message: invalidCodeMessage
                });
            }

            await client.query(
                `
                UPDATE password_reset_tokens
                SET verified_at = NOW(),
                    reset_token_hash = $2
                WHERE token_hash = $1
                `,
                [reset.token_hash, resetTokenHash]
            );
            await client.query("COMMIT");
            transactionStarted = false;
            return res.json({
                success: true,
                resetToken,
                message: "Code verified. Choose a new password."
            });
        } catch (error) {
            if (transactionStarted) {
                try {
                    await client.query("ROLLBACK");
                } catch (rollbackError) {
                    console.error(
                        "Password reset code verification rollback error:",
                        rollbackError
                    );
                }
            }

            console.error("Password reset code verification error:", error);
            return res.status(500).json({
                success: false,
                message: "Unable to verify the code right now."
            });
        } finally {
            client.release();
        }
    }
);

app.post(
    "/api/auth/reset-password",
    async (req, res) => {
        const resetToken =
            String(req.body.resetToken || "").trim();
        const password =
            String(req.body.password || "");

        if (!/^[a-f0-9]{64}$/i.test(resetToken)) {
            return res.status(400).json({
                success: false,
                message: "Verify your email code before choosing a new password."
            });
        }

        if (
            password.length < 6 ||
            Buffer.byteLength(password, "utf8") > 72
        ) {
            return res.status(400).json({
                success: false,
                message: "Password must be at least 6 characters and no more than 72 bytes."
            });
        }

        const resetTokenHash =
            crypto.createHash("sha256")
                .update(resetToken)
                .digest("hex");
        const client = await pool.connect();
        let transactionStarted = false;

        try {
            await client.query("BEGIN");
            transactionStarted = true;

            const tokenResult =
                await client.query(
                    `
                    SELECT reset.user_id
                    FROM password_reset_tokens reset
                    JOIN users u
                        ON u.id = reset.user_id
                    WHERE reset.reset_token_hash = $1
                      AND reset.verified_at > NOW() - INTERVAL '10 minutes'
                      AND reset.expires_at > NOW()
                      AND reset.used_at IS NULL
                      AND LOWER(u.role) = 'customer'
                    FOR UPDATE OF reset
                    `,
                    [resetTokenHash]
                );

            if (tokenResult.rows.length === 0) {
                await client.query("ROLLBACK");
                transactionStarted = false;
                return res.status(400).json({
                    success: false,
                    message: "Your verified code has expired. Request a new code."
                });
            }

            const userId = tokenResult.rows[0].user_id;
            const passwordHash =
                await bcrypt.hash(password, 10);

            await client.query(
                `
                UPDATE users
                SET password = $2
                WHERE id = $1
                  AND LOWER(role) = 'customer'
                `,
                [userId, passwordHash]
            );
            await client.query(
                `
                UPDATE password_reset_tokens
                SET used_at = NOW()
                WHERE reset_token_hash = $1
                  AND used_at IS NULL
                `,
                [resetTokenHash]
            );

            await client.query("COMMIT");
            transactionStarted = false;
            return res.json({
                success: true,
                message: "Password reset successfully."
            });
        } catch (error) {
            if (transactionStarted) {
                try {
                    await client.query("ROLLBACK");
                } catch (rollbackError) {
                    console.error(
                        "Password reset rollback error:",
                        rollbackError
                    );
                }
            }

            console.error("Password reset error:", error);
            return res.status(500).json({
                success: false,
                message: "Unable to reset the password right now."
            });
        } finally {
            client.release();
        }
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

app.get(
    "/api/customer/:userId/profile-photo",
    async (req, res) => {
        const userId =
            Number(req.params.userId);

        if (!Number.isSafeInteger(userId) || userId <= 0) {
            return res.status(400).json({
                success: false,
                message: "Invalid customer ID."
            });
        }

        try {
            await ensureCustomerProfilePhotoColumn();

            const result =
                await pool.query(
                    `
                    SELECT profile_photo
                    FROM users
                    WHERE id = $1
                      AND LOWER(role) = 'customer'
                    `,
                    [userId]
                );

            if (
                result.rows.length === 0 ||
                !result.rows[0].profile_photo
            ) {
                return res.status(404).json({
                    success: false,
                    message: "Customer profile photo not found."
                });
            }

            const photo =
                decodeProfilePhoto(
                    result.rows[0].profile_photo
                );

            if (!photo) {
                console.error(
                    `Stored profile photo is invalid for customer ${userId}.`
                );
                return res.status(500).json({
                    success: false,
                    message: "Unable to load the profile photo."
                });
            }

            res.setHeader(
                "Cache-Control",
                "private, max-age=31536000, immutable"
            );
            return res.type(photo.mimeType).send(photo.imageData);
        } catch (error) {
            console.error(
                "Load customer profile photo error:",
                error
            );
            return res.status(500).json({
                success: false,
                message: "Unable to load the profile photo."
            });
        }
    }
);

app.put(
    "/api/customer/:userId/profile",
    async (req, res) => {
        const userId =
            Number(req.params.userId);
        const fullName =
            String(req.body.full_name || "").trim();
        const phone =
            normalizePhilippinePhone(req.body.phone);
        const currentPassword =
            String(req.body.current_password || "");

        if (!Number.isSafeInteger(userId) || userId <= 0) {
            return res.status(400).json({
                success: false,
                message: "Invalid customer ID."
            });
        }

        if (!fullName || fullName.length > 100) {
            return res.status(400).json({
                success: false,
                message: "Enter a name up to 100 characters."
            });
        }

        if (!/^09\d{9}$/.test(phone)) {
            return res.status(400).json({
                success: false,
                message: "Enter an 11-digit Philippine mobile number starting with 09."
            });
        }

        if (!currentPassword) {
            return res.status(400).json({
                success: false,
                message: "Enter your current password to save profile changes."
            });
        }

        try {
            await ensureCustomerProfilePhotoColumn();

            const customerResult =
                await pool.query(
                    `
                    SELECT password
                    FROM users
                    WHERE id = $1
                      AND LOWER(role) = 'customer'
                    `,
                    [userId]
                );

            if (customerResult.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: "Customer account not found."
                });
            }

            const passwordMatches =
                await bcrypt.compare(
                    currentPassword,
                    customerResult.rows[0].password
                );

            if (!passwordMatches) {
                return res.status(401).json({
                    success: false,
                    message: "Your current password is incorrect."
                });
            }

            if (req.body.profile_photo !== undefined) {
                if (!decodeProfilePhoto(req.body.profile_photo)) {
                    return res.status(400).json({
                        success: false,
                        message: "Choose a valid JPG, PNG, or WEBP profile photo."
                    });
                }
            }

            const profilePhoto =
                req.body.profile_photo === undefined
                    ? null
                    : req.body.profile_photo;
            const result =
                await pool.query(
                    `
                    UPDATE users
                    SET
                        full_name = $2,
                        phone = $3,
                        profile_photo = COALESCE($4, profile_photo)
                    WHERE id = $1
                      AND LOWER(role) = 'customer'
                    RETURNING
                        id,
                        full_name,
                        email,
                        phone,
                        role,
                        created_at,
                        CASE
                            WHEN profile_photo IS NULL THEN NULL
                            ELSE '/api/customer/' || id ||
                                '/profile-photo?v=' || MD5(profile_photo)
                        END AS profile_photo
                    `,
                    [
                        userId,
                        fullName,
                        phone,
                        profilePhoto
                    ]
                );

            if (result.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: "Customer account not found."
                });
            }

            return res.json({
                success: true,
                message: "Profile updated.",
                user: result.rows[0]
            });
        } catch (error) {
            console.error(
                "Update customer profile error:",
                error
            );

            return res.status(500).json({
                success: false,
                message: "Unable to update your profile."
            });
        }
    }
);

app.put(
    "/api/customer/:userId/password",
    async (req, res) => {
        const userId =
            Number(req.params.userId);
        const currentPassword =
            String(req.body.current_password || "");
        const newPassword =
            String(req.body.new_password || "");

        if (!Number.isSafeInteger(userId) || userId <= 0) {
            return res.status(400).json({
                success: false,
                message: "Invalid customer ID."
            });
        }

        if (!currentPassword) {
            return res.status(400).json({
                success: false,
                message: "Enter your current password."
            });
        }

        if (newPassword.length < 6) {
            return res.status(400).json({
                success: false,
                message: "New password must be at least 6 characters."
            });
        }

        try {
            const customerResult =
                await pool.query(
                    `
                    SELECT password
                    FROM users
                    WHERE id = $1
                      AND LOWER(role) = 'customer'
                    `,
                    [userId]
                );

            if (customerResult.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: "Customer account not found."
                });
            }

            const passwordMatches =
                await bcrypt.compare(
                    currentPassword,
                    customerResult.rows[0].password
                );

            if (!passwordMatches) {
                return res.status(401).json({
                    success: false,
                    message: "Your current password is incorrect."
                });
            }

            const passwordHash =
                await bcrypt.hash(newPassword, 10);

            await pool.query(
                `
                UPDATE users
                SET password = $2
                WHERE id = $1
                  AND LOWER(role) = 'customer'
                `,
                [
                    userId,
                    passwordHash
                ]
            );

            return res.json({
                success: true,
                message: "Password changed successfully."
            });
        } catch (error) {
            console.error(
                "Change customer password error:",
                error
            );

            return res.status(500).json({
                success: false,
                message: "Unable to change your password."
            });
        }
    }
);

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

            await ensureCustomerProfilePhotoColumn();

            const userResult =
                await pool.query(
                    `
                    SELECT
                        id,
                        full_name,
                        email,
                        phone,
                        role,
                        created_at,
                        CASE
                            WHEN profile_photo IS NULL THEN NULL
                            ELSE '/api/customer/' || id ||
                                '/profile-photo?v=' || MD5(profile_photo)
                        END AS profile_photo
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
                      AND archived_at IS NULL
                      AND UPPER(status) <> 'REVOKED'
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

            await ensurePaymentScreenshotColumn();

            const applicationResult =
                await pool.query(
                    `
                    SELECT
                        id,
                        user_id,
                        membership_plan,
                        amount,
                        gcash_reference,
                        CASE
                            WHEN payment_screenshot IS NULL THEN NULL
                            ELSE '/api/applications/' || id || '/screenshot'
                        END AS payment_screenshot,
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
                    FROM member_transactions
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

app.get(
    "/api/admin/applications/:applicationId/screenshot",
    async (req, res) => {
        if (!requireAdministrator(req, res)) {
            return;
        }

        const applicationId =
            Number(req.params.applicationId);

        if (
            !Number.isSafeInteger(applicationId) ||
            applicationId <= 0
        ) {
            return res.status(400).json({
                success: false,
                message: "Invalid application ID."
            });
        }

        try {
            await ensurePaymentScreenshotColumn();

            const result =
                await pool.query(
                    `
                    SELECT payment_screenshot
                    FROM applications
                    WHERE id = $1
                    `,
                    [applicationId]
                );

            if (result.rows.length === 0 || !result.rows[0].payment_screenshot) {
                return res.status(404).json({
                    success: false,
                    message: "Payment screenshot not found."
                });
            }

            const storedScreenshot =
                String(result.rows[0].payment_screenshot);
            let image =
                decodePaymentScreenshot(storedScreenshot);

            if (!image && storedScreenshot.startsWith("/uploads/")) {
                const filename =
                    storedScreenshot.slice("/uploads/".length);
                const imagePath =
                    path.resolve(uploadDir, filename);
                const uploadsRoot =
                    `${path.resolve(uploadDir)}${path.sep}`;

                if (
                    !filename ||
                    path.basename(filename) !== filename ||
                    !imagePath.startsWith(uploadsRoot) ||
                    !fs.existsSync(imagePath)
                ) {
                    return res.status(404).json({
                        success: false,
                        message: "This older payment screenshot is no longer on the server. Ask the customer to upload it again."
                    });
                }

                const imageData =
                    fs.readFileSync(imagePath);
                const mimeType =
                    imageData.subarray(0, 8).equals(
                        Buffer.from("89504e470d0a1a0a", "hex")
                    )
                        ? "image/png"
                        : imageData[0] === 0xff &&
                            imageData[1] === 0xd8 &&
                            imageData[2] === 0xff
                            ? "image/jpeg"
                            : imageData.toString("ascii", 0, 4) === "RIFF" &&
                                imageData.toString("ascii", 8, 12) === "WEBP"
                                ? "image/webp"
                                : null;

                if (
                    !mimeType ||
                    imageData.length > 6 * 1024 * 1024
                ) {
                    return res.status(500).json({
                        success: false,
                        message: "The stored payment screenshot is not a supported image."
                    });
                }

                const dataUrl =
                    `data:${mimeType};base64,${imageData.toString("base64")}`;

                await pool.query(
                    `
                    UPDATE applications
                    SET payment_screenshot = $2
                    WHERE id = $1
                      AND payment_screenshot = $3
                    `,
                    [
                        applicationId,
                        dataUrl,
                        storedScreenshot
                    ]
                );

                image = { mimeType, imageData };
            }

            if (!image) {
                console.error(
                    `Stored payment screenshot is invalid for application ${applicationId}.`
                );
                return res.status(500).json({
                    success: false,
                    message: "Unable to display the payment screenshot."
                });
            }

            res.setHeader(
                "Cache-Control",
                "private, max-age=31536000, immutable"
            );
            return res.type(image.mimeType).send(image.imageData);
        } catch (error) {
            console.error(
                "Load payment screenshot error:",
                error
            );
            return res.status(500).json({
                success: false,
                message: "Unable to load the payment screenshot."
            });
        }
    }
);

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

            const paymentDate =
                String(payment_date);
            const dateParts =
                paymentDate.match(
                    /^(\d{4})-(\d{2})-(\d{2})$/
                );

            if (!dateParts) {
                return res.status(400).json({
                    success: false,
                    message: "Payment date must be a valid date."
                });
            }

            const paymentYear =
                Number(dateParts[1]);
            const paymentMonth =
                Number(dateParts[2]) - 1;
            const paymentDay =
                Number(dateParts[3]);
            const parsedPaymentDate =
                new Date(0);

            parsedPaymentDate.setUTCFullYear(
                paymentYear,
                paymentMonth,
                paymentDay
            );

            if (
                paymentYear < 1 ||
                parsedPaymentDate.getUTCFullYear() !== paymentYear ||
                parsedPaymentDate.getUTCMonth() !== paymentMonth ||
                parsedPaymentDate.getUTCDate() !== paymentDay
            ) {
                return res.status(400).json({
                    success: false,
                    message: "Payment date must be a valid date."
                });
            }

            const manilaDateParts =
                new Intl.DateTimeFormat(
                    "en-US",
                    {
                        timeZone: "Asia/Manila",
                        year: "numeric",
                        month: "2-digit",
                        day: "2-digit"
                    }
                ).formatToParts(new Date());
            const manilaDateValues =
                Object.fromEntries(
                    manilaDateParts.map(
                        part => [part.type, part.value]
                    )
                );
            const todayInManila =
                `${manilaDateValues.year}-${manilaDateValues.month}-${manilaDateValues.day}`;

            if (paymentDate > todayInManila) {
                return res.status(400).json({
                    success: false,
                    message: "Payment date cannot be in the future."
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

            const screenshotImage =
                decodePaymentScreenshot(payment_screenshot);

            if (!screenshotImage) {
                return res.status(400).json({
                    success: false,
                    message: "Upload a valid PNG, JPG, JPEG, or WEBP payment screenshot up to 6MB."
                });
            }

            await ensurePaymentScreenshotColumn();

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
                        '/api/applications/' || id || '/screenshot'
                            AS payment_screenshot,
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

                        payment_screenshot,

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

            await ensurePaymentScreenshotColumn();

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
                        CASE
                            WHEN a.payment_screenshot IS NULL THEN NULL
                            ELSE '/api/admin/applications/' || a.id || '/screenshot'
                        END AS payment_screenshot,
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

            const manilaDateResult = await client.query(
                `SELECT (${GUEST_NOW_SQL})::date::text AS today`
            );
            const startDate = manilaDateResult.rows[0].today;
            const today = new Date(`${startDate}T00:00:00.000Z`);

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

                newExpiration.setUTCMonth(
                    newExpiration.getUTCMonth() +
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

                expiration.setUTCMonth(
                    expiration.getUTCMonth() +
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

            const priorTransactions = await client.query(
                `
                SELECT id
                FROM member_transactions
                WHERE application_id = $1
                ORDER BY id
                FOR UPDATE
                `,
                [applicationId]
            );

            if (priorTransactions.rows.length > 1) {
                await client.query("ROLLBACK");
                transactionStarted = false;
                return res.status(409).json({
                    success: false,
                    message: "This application already has duplicate payment records. Resolve the existing records before approval."
                });
            }

            if (priorTransactions.rows.length === 1) {
                await client.query(
                    `
                    UPDATE member_transactions
                    SET
                        user_id = $1,
                        amount = $2,
                        payment_method = 'GCASH',
                        gcash_reference = $3,
                        transaction_date = COALESCE(transaction_date, NOW()),
                        status = 'VERIFIED'
                    WHERE id = $4
                    `,
                    [
                        application.user_id,
                        application.amount,
                        application.gcash_reference,
                        priorTransactions.rows[0].id
                    ]
                );
            } else {
                await client.query(
                    `
                    INSERT INTO member_transactions
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
            }

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
                        COUNT(*) FILTER (
                            WHERE archived_at IS NULL
                              AND UPPER(status) <> 'REVOKED'
                        )::int AS total_members,

                        COUNT(*) FILTER (
                            WHERE archived_at IS NULL
                              AND UPPER(status) = 'ACTIVE'
                              AND (
                                  expiration_date IS NULL
                                  OR expiration_date >= (${GUEST_NOW_SQL})::date
                              )
                        )::int AS active_members,

                        COUNT(*) FILTER (
                            WHERE archived_at IS NULL
                              AND UPPER(status) = 'ACTIVE'
                              AND expiration_date < (${GUEST_NOW_SQL})::date
                        )::int AS expired_members,

                        COUNT(*) FILTER (
                            WHERE archived_at IS NULL
                              AND UPPER(status) = 'PENDING'
                        )::int AS pending_members,

                        COUNT(*) FILTER (
                            WHERE archived_at IS NULL
                              AND UPPER(status) = 'ACTIVE'
                        )::int AS active_status_members,

                        COUNT(*) FILTER (
                            WHERE archived_at IS NULL
                              AND UPPER(status) = 'REVOKED'
                        )::int AS revoked_members

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
                await getCurrentOccupancy();

            const timedOutGuestsResult =
                await pool.query(
                    `
                    SELECT
                        COUNT(*)::int AS timed_out_guests
                    FROM attendance a
                    JOIN guests g
                        ON g.id = a.guest_id
                    WHERE UPPER(a.user_type) = 'GUEST'
                      AND a.check_out IS NULL
                      AND ${GUEST_CLOSING_SQL} <= ${GUEST_NOW_SQL}
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

            const revokedMembers =
                Number(
                    membersResult.rows[0]
                        .revoked_members ||
                    0
                );

            const pendingMembers =
                Number(
                    membersResult.rows[0]
                        .pending_members ||
                    0
                );

            const activeStatusMembers =
                Number(
                    membersResult.rows[0]
                        .active_status_members ||
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

            const membersInside = attendanceResult.membersInside;
            const guestsInside = attendanceResult.guestsInside;

            const timedOutGuests =
                Number(
                    timedOutGuestsResult.rows[0]
                        .timed_out_guests ||
                    0
                );

            const occupancy = attendanceResult.occupancy;

            res.json({

                success:
                    true,

                totalRegistered,

                totalMembers,

                activeMembers,

                expiredMembers,

                revokedMembers,

                membershipStatusCounts: {
                    active: activeStatusMembers,
                    pending: pendingMembers,
                    revoked: revokedMembers
                },

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

            await ensurePausedDaysRemainingColumn();

            const result =
                await pool.query(
                    `
                    SELECT
                        m.id,
                        m.user_id,
                        m.member_id,
                        u.full_name,
                        u.email,
                        u.phone,
                        m.registration_type,
                        m.membership_plan,
                        (
                            SELECT mt.amount
                            FROM member_transactions mt
                            WHERE mt.user_id = m.user_id
                            ORDER BY mt.transaction_date DESC NULLS LAST, mt.id DESC
                            LIMIT 1
                        ) AS amount,
                        m.start_date,
                        m.expiration_date,
                        m.paused_days_remaining,
                        m.status,
                        (
                            UPPER(m.status) = 'ACTIVE'
                            AND m.expiration_date < (${GUEST_NOW_SQL})::date
                        ) AS expired
                    FROM members m
                    JOIN users u
                        ON u.id = m.user_id
                    WHERE m.archived_at IS NULL
                      AND UPPER(m.status) <> 'REVOKED'
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
// REVOKE AND RESTORE MEMBERS
// =====================================

app.patch(
    "/api/admin/members/:id/revoke",
    async (req, res) => {
        if (!requireAdministrator(req, res)) {
            return;
        }

        const client = await pool.connect();
        let transactionStarted = false;

        try {

            const memberId = Number(req.params.id);
            const reason = String(req.body?.reason || "").trim();

            if (!Number.isSafeInteger(memberId) || memberId <= 0) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid member ID."
                });
            }

            if (!reason) {
                return res.status(400).json({
                    success: false,
                    message: "Revocation reason is required."
                });
            }

            await ensurePausedDaysRemainingColumn();
            await client.query("BEGIN");
            transactionStarted = true;

            const memberResult = await client.query(
                `
                SELECT
                    m.id,
                    m.user_id,
                    m.member_id,
                    m.status,
                    m.archived_at,
                    m.expiration_date,
                    u.full_name
                FROM members m
                JOIN users u
                    ON u.id = m.user_id
                WHERE m.id = $1
                FOR UPDATE OF m
                `,
                [memberId]
            );

            if (memberResult.rows.length === 0) {
                await client.query("ROLLBACK");
                transactionStarted = false;
                return res.status(404).json({
                    success: false,
                    message: "Member not found."
                });
            }

            const member = memberResult.rows[0];
            if (String(member.status || "").trim().toUpperCase() === "REVOKED") {
                await client.query("ROLLBACK");
                transactionStarted = false;
                return res.status(409).json({
                    success: false,
                    message: "This membership is already revoked."
                });
            }

            const openAttendanceResult = await client.query(
                `
                SELECT id
                FROM attendance
                WHERE member_id = $1
                  AND UPPER(user_type) = 'MEMBER'
                  AND check_out IS NULL
                LIMIT 1
                FOR UPDATE
                `,
                [memberId]
            );

            if (openAttendanceResult.rows.length > 0) {
                await client.query("ROLLBACK");
                transactionStarted = false;
                return res.status(409).json({
                    success: false,
                    message: "Check out the member before revoking the membership."
                });
            }

            const revokeResult = await client.query(
                `
                UPDATE members
                SET
                    paused_days_remaining = GREATEST(
                        COALESCE(
                            expiration_date -
                                (${GUEST_NOW_SQL})::date,
                            0
                        ),
                        0
                    ),
                    status = 'REVOKED'
                WHERE id = $1
                RETURNING
                    id,
                    user_id,
                    member_id,
                    expiration_date,
                    paused_days_remaining,
                    status
                `,
                [memberId]
            );

            await createNotification(
                client,
                member.user_id,
                "Membership Revoked",
                `Your membership has been revoked. Reason: ${reason}`
            );

            await client.query("COMMIT");
            transactionStarted = false;

            return res.json({
                success: true,
                message: "Membership revoked. Remaining membership days have been paused.",
                member: revokeResult.rows[0]
            });

        } catch (error) {

            if (transactionStarted) {
                try {
                    await client.query("ROLLBACK");
                } catch (rollbackError) {
                    console.error("Rollback error:", rollbackError);
                }
            }

            console.error("Revoke member error:", error);
            return res.status(500).json({
                success: false,
                message: "Unable to revoke membership.",
                error: error.message,
                code: error.code || null,
                detail: error.detail || null
            });

        } finally {
            client.release();
        }

    }
);

app.post(
    "/api/admin/members/:id/restore",
    async (req, res) => {
        if (!requireAdministrator(req, res)) {
            return;
        }

        const client = await pool.connect();
        let transactionStarted = false;

        try {

            const memberId = Number(req.params.id);

            if (!Number.isSafeInteger(memberId) || memberId <= 0) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid member ID."
                });
            }

            await ensurePausedDaysRemainingColumn();
            await client.query("BEGIN");
            transactionStarted = true;

            const memberResult = await client.query(
                `
                SELECT id, user_id, status
                FROM members
                WHERE id = $1
                FOR UPDATE
                `,
                [memberId]
            );

            if (memberResult.rows.length === 0) {
                await client.query("ROLLBACK");
                transactionStarted = false;
                return res.status(404).json({
                    success: false,
                    message: "Member not found."
                });
            }

            const member = memberResult.rows[0];
            if (String(member.status || "").trim().toUpperCase() !== "REVOKED") {
                await client.query("ROLLBACK");
                transactionStarted = false;
                return res.status(409).json({
                    success: false,
                    message: "Only revoked memberships can be restored."
                });
            }

            const restoreResult = await client.query(
                `
                UPDATE members
                SET
                    expiration_date =
                        (${GUEST_NOW_SQL})::date +
                        paused_days_remaining,
                    paused_days_remaining = 0,
                    status = 'ACTIVE'
                WHERE id = $1
                RETURNING
                    id,
                    user_id,
                    member_id,
                    start_date,
                    expiration_date,
                    paused_days_remaining,
                    status
                `,
                [memberId]
            );

            await createNotification(
                client,
                member.user_id,
                "Membership Restored",
                "Your membership has been restored. Your remaining membership days are active again."
            );

            await client.query("COMMIT");
            transactionStarted = false;

            return res.json({
                success: true,
                message: "Membership restored successfully.",
                member: restoreResult.rows[0]
            });

        } catch (error) {

            if (transactionStarted) {
                try {
                    await client.query("ROLLBACK");
                } catch (rollbackError) {
                    console.error("Rollback error:", rollbackError);
                }
            }

            console.error("Restore revoked membership error:", error);
            return res.status(500).json({
                success: false,
                message: "Unable to restore membership.",
                error: error.message,
                code: error.code || null,
                detail: error.detail || null
            });

        } finally {
            client.release();
        }

    }
);

// =====================================
// ARCHIVE MEMBER
// =====================================

app.delete(
    "/api/admin/members/:id",
    async (req, res) => {
        if (!requireAdministrator(req, res)) {
            return;
        }

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

            if (member.archived_at) {
                await client.query("ROLLBACK");
                transactionStarted = false;
                return res.status(409).json({
                    success: false,
                    message: "This member is already archived."
                });
            }

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

            const archiveAssignment = await client.query(
                `
                UPDATE members
                SET archived_at = ${GUEST_NOW_SQL},
                    archived_archive_id = $2
                WHERE id = $1
                  AND archived_at IS NULL
                RETURNING id, member_id, user_id, status, archived_at
                `,
                [memberId, archiveResult.rows[0].archive_id]
            );

            if (archiveAssignment.rows.length === 0) {
                throw new Error("This membership is already archived.");
            }

            await createNotification(
                client,
                member.user_id,
                "Membership Archived",
                `Your membership record was archived by the gym administrator. Reason: ${reason}`
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
                    "Membership archived. Attendance and transaction history has been preserved.",

                member:
                    archiveAssignment.rows[0],

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
                        removal_reason,
                        'ARCHIVED'::text AS record_type
                    FROM archived_members
                    UNION ALL
                    SELECT
                        NULL::bigint AS archive_id,
                        m.id AS original_member_id,
                        m.user_id,
                        m.member_id,
                        u.full_name,
                        u.email,
                        m.registration_type,
                        m.membership_plan,
                        m.start_date,
                        m.expiration_date,
                        m.status,
                        m.qr_code,
                        NULL::timestamptz AS archived_at,
                        NULL::timestamptz AS restored_at,
                        'Membership revoked'::text AS removal_reason,
                        'REVOKED'::text AS record_type
                    FROM members m
                    JOIN users u
                        ON u.id = m.user_id
                    WHERE UPPER(m.status) = 'REVOKED'
                      AND m.archived_at IS NULL
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
        if (!requireAdministrator(req, res)) {
            return;
        }

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
                        status,
                        archived_at,
                        archived_archive_id
                    FROM members
                    WHERE user_id = $1
                    FOR UPDATE
                    `,
                    [
                        archived.user_id
                    ]
                );

            if (existingMemberResult.rows.length > 0) {
                const existingMember = existingMemberResult.rows[0];
                if (
                    existingMember.archived_at &&
                    Number(existingMember.archived_archive_id) === archiveId
                ) {
                    const restored = await client.query(
                        `
                        UPDATE members
                        SET archived_at = NULL,
                            archived_archive_id = NULL
                        WHERE id = $1
                        RETURNING
                            id, user_id, member_id, status,
                            start_date, expiration_date, qr_code
                        `,
                        [existingMember.id]
                    );
                    await client.query(
                        `
                        UPDATE archived_members
                        SET restored_at = CURRENT_TIMESTAMP
                        WHERE archive_id = $1
                        `,
                        [archiveId]
                    );
                    await client.query("COMMIT");
                    transactionStarted = false;
                    return res.json({
                        success: true,
                        message: "Archived member record restored without changing membership status or dates.",
                        member: restored.rows[0]
                    });
                }

                await client.query("ROLLBACK");
                transactionStarted = false;
                return res.status(409).json({
                    success: false,
                    message: "This customer already has a membership. No status or membership dates were changed."
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

            const archivedStatus = String(
                archived.status || "PENDING"
            ).trim().toUpperCase();
            const restoredStatus = ["ACTIVE", "PENDING", "REVOKED"]
                .includes(archivedStatus)
                ? archivedStatus
                : archivedStatus === "EXPIRED"
                    ? "ACTIVE"
                    : "REVOKED";

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
                        qr_code,
                        archived_at,
                        archived_archive_id
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
                        NULL,
                        NULL
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
                        archived.start_date,
                        archived.expiration_date,
                        restoredStatus,
                        newQrCode
                    ]
                );

            await client.query(
                `
                UPDATE archived_members
                SET
                    restored_at = CURRENT_TIMESTAMP

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

            const filterType = String(req.query.type || "all").trim().toLowerCase();

            if (!["all", "member", "guest"].includes(filterType)) {
                return res.status(400).json({
                    success: false,
                    message: "Transaction type must be all, member, or guest."
                });
            }

            await ensurePaymentScreenshotColumn();

            const result = await pool.query(
                `
                SELECT *
                FROM (
                    SELECT
                        'MEMBER-' || t.id::text AS transaction_id,
                        t.id AS record_id,
                        u.full_name AS customer_name,
                        COALESCE(gym_member.member_id, '—') AS member_id,
                        'MEMBER'::text AS person_type,
                        'Membership Payment'::text AS description,
                        'Membership payment (not linked to an attendance visit)'::text
                            AS related_visit,
                        NULL::timestamp without time zone AS check_in,
                        NULL::timestamp without time zone AS check_out,
                        NULL::text AS extension,
                        'Monthly'::text AS access_type,
                        t.amount,
                        t.payment_method,
                        CASE
                            WHEN UPPER(t.status) = 'VERIFIED'
                                THEN 'VERIFIED'
                            WHEN UPPER(t.status) IN (
                                'VERIFIED', 'CONFIRMED', 'APPROVED', 'SUCCESS', 'PAID'
                            ) THEN 'CONFIRMED'
                            WHEN UPPER(t.status) IN ('REJECTED', 'FAILED', 'CANCELLED')
                                THEN 'FAILED'
                            ELSE UPPER(t.status)
                        END AS payment_status,
                        COALESCE(NULLIF(t.gcash_reference, ''), '—') AS reference,
                        COALESCE(t.transaction_date, t.created_at) AS transaction_date,
                        NULL::bigint AS attendance_id,
                        CASE
                            WHEN app.payment_screenshot IS NULL THEN NULL
                            ELSE '/api/admin/applications/' ||
                                t.application_id::text || '/screenshot'
                        END AS payment_screenshot
                    FROM member_transactions t
                    JOIN users u
                        ON u.id = t.user_id
                    LEFT JOIN LATERAL (
                        SELECT m.member_id
                        FROM members m
                        WHERE m.user_id = t.user_id
                        ORDER BY
                            CASE WHEN m.id = t.member_id THEN 0 ELSE 1 END,
                            m.id DESC
                        LIMIT 1
                    ) gym_member ON TRUE
                    LEFT JOIN applications app
                        ON app.id = t.application_id
                    WHERE $1 <> 'guest'

                    UNION ALL

                    SELECT
                        'GUEST-' || gt.id::text AS transaction_id,
                        gt.id AS record_id,
                        gt.guest_name AS customer_name,
                        NULL::text AS member_id,
                        'GUEST'::text AS person_type,
                        CASE
                            WHEN gt.extension_type = 'EXTRA_HOURS'
                                THEN 'Extra ' || gt.additional_hours::text ||
                                    CASE
                                        WHEN gt.additional_hours = 1 THEN ' Hour'
                                        ELSE ' Hours'
                                    END
                            WHEN gt.extension_type = 'ALL_DAY'
                                THEN 'All-Day Access'
                            WHEN UPPER(gt.visit_type) = 'DAY PASS'
                                THEN 'Guest Day Pass'
                            ELSE 'Guest Entry Fee'
                        END AS description,
                        CASE
                            WHEN a.id IS NULL THEN 'Not linked to a visit'
                            ELSE 'Visit #' || a.id::text
                        END AS related_visit,
                        a.check_in,
                        a.check_out,
                        CASE
                            WHEN gt.extension_type = 'EXTRA_HOURS'
                                THEN gt.additional_hours::text ||
                                    CASE
                                        WHEN gt.additional_hours = 1 THEN ' hour'
                                        ELSE ' hours'
                                    END
                            ELSE NULL
                        END AS extension,
                        gt.visit_type AS access_type,
                        gt.amount,
                        gt.payment_method,
                        gt.payment_status,
                        COALESCE(NULLIF(gt.transaction_reference, ''), '—') AS reference,
                        gt.transaction_date,
                        gt.attendance_id,
                        NULL::text AS payment_screenshot
                    FROM guest_transactions gt
                    LEFT JOIN attendance a
                        ON a.id = gt.attendance_id
                    WHERE $1 <> 'member'
                ) transactions
                ORDER BY transaction_date DESC NULLS LAST, record_id DESC
                `,
                [filterType]
            );

            return res.json({
                success: true,
                type: filterType,
                transactions: result.rows
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
            const filterType = String(req.query.type || "all").trim().toLowerCase();

            if (!["all", "member", "guest"].includes(filterType)) {
                return res.status(400).json({
                    success: false,
                    message: "Attendance type must be all, member, or guest."
                });
            }

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
                        GREATEST(
                            0,
                            FLOOR(EXTRACT(EPOCH FROM (
                                COALESCE(a.check_out, ${GUEST_NOW_SQL}) - a.check_in
                            )))
                        )::int AS duration_seconds,
                        a.expiration_time,
                        g.phone AS guest_phone,
                        g.visit_type,
                        g.hours AS guest_hours,

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

                                    WHEN a.expiration_time IS NOT NULL
                                    THEN a.expiration_time

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

                                                WHEN a.expiration_time IS NOT NULL
                                                THEN a.expiration_time

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

                                                        WHEN a.expiration_time IS NOT NULL
                                                        THEN a.expiration_time

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

                                    WHEN a.expiration_time IS NOT NULL
                                    THEN a.expiration_time

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

                    WHERE $1 = 'all'
                       OR UPPER(a.user_type) = $2

                    ORDER BY
                        a.check_in DESC,
                        a.id DESC
                    `,
                    [
                        filterType,
                        filterType.toUpperCase()
                    ]
                );

            const occupancy = await getCurrentOccupancy();

            res.json({

                success:
                    true,

                attendance:
                    result.rows,

                membersInside:
                    occupancy.membersInside,

                guestsInside:
                    occupancy.guestsInside,

                currentOccupancy:
                    occupancy.occupancy,

                duplicateOpenPeople:
                    occupancy.duplicateOpenPeople,

                closingTime:
                    GYM_CLOSING_TIME

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

app.get(
    "/api/admin/attendance/:id/extension-quote",
    async (req, res) => {
        const attendanceId = Number(req.params.id);

        if (!Number.isSafeInteger(attendanceId) || attendanceId <= 0) {
            return res.status(400).json({
                success: false,
                message: "Invalid attendance ID."
            });
        }

        try {
            const visitResult = await pool.query(
                `
                SELECT
                    a.id,
                    a.check_in,
                    a.check_out,
                    g.id AS guest_id,
                    g.full_name,
                    g.amount_paid,
                    (
                        COALESCE(
                            a.expiration_time AT TIME ZONE 'Asia/Manila',
                            ${GUEST_INITIAL_EXPIRATION_SQL}
                        ) AT TIME ZONE 'Asia/Manila'
                    ) AS current_expiration,
                    (${GUEST_NOW_SQL} AT TIME ZONE 'Asia/Manila') AS now_manila,
                    (
                        date_trunc('day', ${GUEST_NOW_SQL})
                        + INTERVAL '${GYM_CLOSING_INTERVAL}'
                    ) AT TIME ZONE 'Asia/Manila' AS closing_today
                FROM attendance a
                JOIN guests g
                    ON g.id = a.guest_id
                WHERE a.id = $1
                  AND UPPER(a.user_type) = 'GUEST'
                  AND a.check_out IS NULL
                `,
                [attendanceId]
            );

            if (visitResult.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: "Active guest visit not found."
                });
            }

            const visit = visitResult.rows[0];
            const paidResult = await pool.query(
                `
                SELECT COALESCE(SUM(amount), 0)::numeric AS paid
                FROM guest_transactions
                WHERE payment_status = 'CONFIRMED'
                  AND (
                      attendance_id = $1
                      OR (attendance_id IS NULL AND guest_id = $2)
                  )
                `,
                [attendanceId, visit.guest_id]
            );
            const paidTowardVisit = Math.max(
                Number(paidResult.rows[0].paid || 0),
                Number(visit.amount_paid || 0)
            );
            const now = new Date(visit.now_manila);
            const closingToday = new Date(visit.closing_today);
            const currentExpiration = new Date(visit.current_expiration);
            const closingExpiration = new Date(
                closingToday.getTime() +
                (closingToday.getTime() <= now.getTime()
                    ? 24 * 60 * 60 * 1000
                    : 0)
            );

            return res.json({
                success: true,
                closing_time_config: GYM_CLOSING_TIME,
                attendance_id: Number(visit.id),
                guest_name: visit.full_name,
                check_in: visit.check_in,
                current_expiration: currentExpiration,
                remaining_seconds: Math.max(
                    0,
                    Math.floor((currentExpiration.getTime() - now.getTime()) / 1000)
                ),
                closing_time: closingExpiration,
                options: [
                    { extension_type: "EXTRA_HOURS", additional_hours: 1, price: 30 },
                    { extension_type: "EXTRA_HOURS", additional_hours: 2, price: 60 },
                    { extension_type: "EXTRA_HOURS", additional_hours: 3, price: 90 },
                    {
                        extension_type: "ALL_DAY",
                        additional_hours: null,
                        price: 100,
                        remaining_balance: Math.max(0, 100 - paidTowardVisit)
                    }
                ]
            });
        } catch (error) {
            console.error("Guest extension quote error:", error);
            return res.status(500).json({
                success: false,
                message: "Unable to load the guest extension quote.",
                error: error.message
            });
        }
    }
);

app.post(
    "/api/admin/attendance/:id/extend",
    async (req, res) => {
        const attendanceId = Number(req.params.id);
        const extensionType = String(req.body?.extension_type || "")
            .trim()
            .toUpperCase();
        const rawAdditionalHours = req.body?.additional_hours;
        const additionalHours =
            rawAdditionalHours === undefined ||
            rawAdditionalHours === null ||
            rawAdditionalHours === ""
                ? null
                : Number(rawAdditionalHours);
        const idempotencyKey = String(req.body?.idempotency_key || "").trim();
        const paymentMethod = String(req.body?.payment_method || "")
            .trim()
            .toUpperCase();
        const paymentReference = String(req.body?.payment_reference || "").trim();
        const paymentConfirmed = req.body?.payment_confirmed === true;

        if (!Number.isSafeInteger(attendanceId) || attendanceId <= 0) {
            return res.status(400).json({
                success: false,
                message: "Invalid attendance ID."
            });
        }

        if (
            extensionType !== "EXTRA_HOURS" &&
            extensionType !== "ALL_DAY"
        ) {
            return res.status(400).json({
                success: false,
                message: "Choose additional hours or an all-day upgrade."
            });
        }

        if (
            extensionType === "EXTRA_HOURS" &&
            ![1, 2, 3].includes(additionalHours)
        ) {
            return res.status(400).json({
                success: false,
                message: "Additional time must be 1, 2, or 3 hours."
            });
        }

        if (!idempotencyKey || idempotencyKey.length > 120) {
            return res.status(400).json({
                success: false,
                message: "A valid payment request key is required."
            });
        }

        const client = await pool.connect();
        let transactionStarted = false;

        try {
            await client.query("BEGIN");
            transactionStarted = true;

            await client.query(
                "SELECT pg_advisory_xact_lock(hashtext($1))",
                [`guest-extension:${idempotencyKey}`]
            );

            const duplicateResult = await client.query(
                `
                SELECT
                    e.attendance_id,
                    e.extension_type,
                    e.additional_hours,
                    e.amount,
                    e.new_expiration,
                    e.guest_transaction_id
                FROM guest_visit_extensions e
                WHERE e.idempotency_key = $1
                `,
                [idempotencyKey]
            );

            if (duplicateResult.rows.length > 0) {
                const duplicate = duplicateResult.rows[0];
                if (
                    Number(duplicate.attendance_id) !== attendanceId ||
                    duplicate.extension_type !== extensionType ||
                    Number(duplicate.additional_hours || 0) !==
                        Number(additionalHours || 0)
                ) {
                    await client.query("ROLLBACK");
                    transactionStarted = false;
                    return res.status(409).json({
                        success: false,
                        message: "This payment request key was already used for a different extension."
                    });
                }

                await client.query("COMMIT");
                transactionStarted = false;
                return res.json({
                    success: true,
                    duplicate: true,
                    amount: Number(duplicate.amount),
                    new_expiration: duplicate.new_expiration,
                    transaction_id: duplicate.guest_transaction_id
                });
            }

            const visitResult = await client.query(
                `
                SELECT
                    a.id,
                    a.guest_id,
                    a.check_in,
                    a.expiration_time,
                    g.full_name,
                    g.amount_paid,
                    (
                        COALESCE(
                            a.expiration_time AT TIME ZONE 'Asia/Manila',
                            ${GUEST_INITIAL_EXPIRATION_SQL}
                        ) AT TIME ZONE 'Asia/Manila'
                    ) AS current_expiration,
                    (${GUEST_NOW_SQL} AT TIME ZONE 'Asia/Manila') AS now_manila,
                    (
                        date_trunc('day', ${GUEST_NOW_SQL})
                        + INTERVAL '${GYM_CLOSING_INTERVAL}'
                    ) AT TIME ZONE 'Asia/Manila' AS closing_today
                FROM attendance a
                JOIN guests g
                    ON g.id = a.guest_id
                WHERE a.id = $1
                  AND UPPER(a.user_type) = 'GUEST'
                  AND a.check_out IS NULL
                FOR UPDATE OF a
                `,
                [attendanceId]
            );

            if (visitResult.rows.length === 0) {
                await client.query("ROLLBACK");
                transactionStarted = false;
                return res.status(404).json({
                    success: false,
                    message: "Active guest visit not found. Checked-out visits cannot be extended."
                });
            }

            const visit = visitResult.rows[0];
            const now = new Date(visit.now_manila);
            const currentExpiration = new Date(visit.current_expiration);
            const closingToday = new Date(visit.closing_today);

            if (
                Number.isNaN(now.getTime()) ||
                Number.isNaN(currentExpiration.getTime()) ||
                Number.isNaN(closingToday.getTime())
            ) {
                throw new Error("Unable to determine the guest visit expiration time.");
            }

            let amount;
            let newExpiration;

            if (extensionType === "EXTRA_HOURS") {
                amount = additionalHours * 30;
                newExpiration = new Date(
                    Math.max(currentExpiration.getTime(), now.getTime()) +
                    additionalHours * 60 * 60 * 1000
                );
            } else {
                const closingTime = new Date(
                    closingToday.getTime() +
                    (closingToday.getTime() <= now.getTime()
                        ? 24 * 60 * 60 * 1000
                        : 0)
                );
                newExpiration = new Date(
                    Math.max(
                        currentExpiration.getTime(),
                        closingTime.getTime()
                    )
                );

                const paidResult = await client.query(
                    `
                    SELECT COALESCE(SUM(amount), 0)::numeric AS paid
                    FROM guest_transactions
                    WHERE payment_status = 'CONFIRMED'
                      AND (
                          attendance_id = $1
                          OR (
                              attendance_id IS NULL
                              AND guest_id = $2
                          )
                      )
                    `,
                    [attendanceId, visit.guest_id]
                );
                const linkedPayment = Number(paidResult.rows[0].paid || 0);
                const basePayment = Number(visit.amount_paid || 0);
                const paidTowardVisit = Math.max(linkedPayment, basePayment);
                amount = Math.max(0, 100 - paidTowardVisit);
            }

            if (amount > 0) {
                if (!paymentConfirmed) {
                    await client.query("ROLLBACK");
                    transactionStarted = false;
                    return res.status(402).json({
                        success: false,
                        message: "Confirm that the guest's payment was received before extending access."
                    });
                }

                if (!["CASH", "GCASH"].includes(paymentMethod)) {
                    await client.query("ROLLBACK");
                    transactionStarted = false;
                    return res.status(400).json({
                        success: false,
                        message: "Select CASH or GCASH as the confirmed payment method."
                    });
                }

                if (
                    paymentMethod === "GCASH" &&
                    (paymentReference.length < 6 || paymentReference.length > 100)
                ) {
                    await client.query("ROLLBACK");
                    transactionStarted = false;
                    return res.status(400).json({
                        success: false,
                        message: "Enter the verified GCash reference (6 to 100 characters)."
                    });
                }
            }

            const transactionReference =
                amount <= 0
                    ? null
                    : paymentMethod === "GCASH"
                        ? paymentReference
                        : `EXT-${crypto.randomUUID()}`;
            let transactionId = null;

            if (amount > 0) {
                if (paymentMethod === "GCASH") {
                    await client.query(
                        "SELECT pg_advisory_xact_lock(hashtext($1))",
                        [`gcash-reference:${paymentReference.toLowerCase()}`]
                    );
                    const duplicateReference = await client.query(
                        `
                        SELECT id
                        FROM guest_transactions
                        WHERE payment_method = 'GCASH'
                          AND LOWER(transaction_reference) = LOWER($1)
                          AND payment_status = 'CONFIRMED'
                        LIMIT 1
                        `,
                        [paymentReference]
                    );
                    if (duplicateReference.rows.length > 0) {
                        await client.query("ROLLBACK");
                        transactionStarted = false;
                        return res.status(409).json({
                            success: false,
                            message: "This GCash reference has already been recorded."
                        });
                    }
                }

                const paymentResult = await client.query(
                    `
                    INSERT INTO guest_transactions (
                        guest_id,
                        guest_name,
                        visit_type,
                        amount,
                        payment_method,
                        transaction_reference,
                        attendance_id,
                        extension_type,
                        additional_hours,
                        payment_status,
                        previous_expiration,
                        new_expiration,
                        idempotency_key
                    )
                    VALUES (
                        $1, $2, $3, $4, $5, $6, $7, $8, $9,
                        'CONFIRMED', $10, $11, $12
                    )
                    RETURNING id
                    `,
                    [
                        visit.guest_id,
                        visit.full_name,
                        extensionType === "ALL_DAY"
                            ? "DAY PASS UPGRADE"
                            : "TIME EXTENSION",
                        amount,
                        paymentMethod,
                        transactionReference,
                        attendanceId,
                        extensionType,
                        additionalHours,
                        currentExpiration,
                        newExpiration,
                        idempotencyKey
                    ]
                );
                transactionId = paymentResult.rows[0].id;
            }

            await client.query(
                `
                INSERT INTO guest_visit_extensions (
                    attendance_id,
                    guest_id,
                    extension_type,
                    additional_hours,
                    amount,
                    payment_status,
                    previous_expiration,
                    new_expiration,
                    transaction_reference,
                    guest_transaction_id,
                    idempotency_key,
                    payment_date
                )
                VALUES (
                    $1, $2, $3, $4, $5, 'CONFIRMED',
                    $6, $7, $8, $9, $10, CURRENT_TIMESTAMP
                )
                `,
                [
                    attendanceId,
                    visit.guest_id,
                    extensionType,
                    additionalHours,
                    amount,
                    currentExpiration,
                    newExpiration,
                    transactionReference,
                    transactionId,
                    idempotencyKey
                ]
            );

            await client.query(
                `
                UPDATE attendance
                SET expiration_time = $2
                WHERE id = $1
                  AND check_out IS NULL
                `,
                [attendanceId, newExpiration]
            );

            await client.query("COMMIT");
            transactionStarted = false;

            return res.json({
                success: true,
                amount,
                extension_type: extensionType,
                additional_hours: additionalHours,
                payment_status: "CONFIRMED",
                remaining_balance: extensionType === "ALL_DAY" ? 0 : null,
                previous_expiration: currentExpiration,
                new_expiration: newExpiration,
                transaction_reference: transactionReference,
                transaction_id: transactionId
            });
        } catch (error) {
            if (transactionStarted) {
                try {
                    await client.query("ROLLBACK");
                } catch (rollbackError) {
                    console.error("Guest extension rollback error:", rollbackError);
                }
            }

            if (error.code === "23505" && idempotencyKey) {
                try {
                    const duplicate = await pool.query(
                        `
                        SELECT
                            attendance_id,
                            extension_type,
                            additional_hours,
                            amount,
                            new_expiration,
                            guest_transaction_id
                        FROM guest_visit_extensions
                        WHERE idempotency_key = $1
                        `,
                        [idempotencyKey]
                    );
                    if (duplicate.rows.length > 0) {
                        const existing = duplicate.rows[0];
                        if (
                            Number(existing.attendance_id) === attendanceId &&
                            existing.extension_type === extensionType &&
                            Number(existing.additional_hours || 0) ===
                                Number(additionalHours || 0)
                        ) {
                            return res.json({
                                success: true,
                                duplicate: true,
                                amount: Number(existing.amount),
                                new_expiration: existing.new_expiration,
                                transaction_id: existing.guest_transaction_id
                            });
                        }
                    }
                } catch (duplicateLookupError) {
                    console.error(
                        "Guest extension idempotency lookup error:",
                        duplicateLookupError
                    );
                }
            }

            console.error("Guest extension error:", error);
            return res.status(500).json({
                success: false,
                message: "Unable to extend the guest visit.",
                error: error.message,
                code: error.code || null
            });
        } finally {
            client.release();
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

            const gymHoursResult =
                await client.query(
                    `
                    SELECT
                        ${GUEST_NOW_SQL} >=
                            date_trunc(
                                'day',
                                ${GUEST_NOW_SQL}
                            ) + INTERVAL '8 hours'
                        AND ${GUEST_NOW_SQL} <
                            date_trunc(
                                'day',
                                ${GUEST_NOW_SQL}
                            ) + INTERVAL '${GYM_CLOSING_INTERVAL}'
                        AS is_open
                    `
                );

            if (
                !gymHoursResult.rows[0]
                    .is_open
            ) {

                await client.query(
                    "ROLLBACK"
                );

                transactionStarted =
                    false;

                return res.status(
                    403
                ).json({

                    success:
                        false,

                    message:
                        `Member QR check-in and check-out are available from 8:00 AM to ${GYM_CLOSING_TIME} Manila time.`

                });

            }

            const memberResult =
                await client.query(
                    `
                    SELECT
                        m.id,
                        m.user_id,
                        m.member_id,
                        m.membership_plan,
                        m.expiration_date,
                        (
                            m.expiration_date IS NOT NULL
                            AND m.expiration_date < (${GUEST_NOW_SQL})::date
                        ) AS membership_expired,
                        m.archived_at,
                        m.status,
                        m.qr_code,
                        u.full_name,
                        u.email
                    FROM members m
                    JOIN users u
                        ON u.id = m.user_id
                    WHERE m.qr_code = $1
                      AND m.archived_at IS NULL
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
                    FOR UPDATE
                    `,
                    [member.id]
                );

            if (openAttendanceResult.rows.length > 1) {
                await client.query("ROLLBACK");
                transactionStarted = false;
                return res.status(409).json({
                    success: false,
                    message: "This member has multiple open visits. Staff must select the specific visit to check out."
                });
            }

            if (
                member.membership_expired &&
                openAttendanceResult.rows.length === 0
            ) {
                await client.query("ROLLBACK");
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
                "ACTIVE" &&
                openAttendanceResult.rows.length === 0
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
                          ${GUEST_NOW_SQL} - INTERVAL '5 seconds'
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
                        "This member was scanned just now. Please wait 5 seconds before scanning again."

                });

            }

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
                                ${GUEST_NOW_SQL}
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

            const {
                membersInside,
                guestsInside,
                occupancy
            } = await getCurrentOccupancy(client);

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
                        ? "You checked in successfully."
                        : "You checked out successfully.",

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

app.get("/api/admin/attendance/members", async (req, res) => {
    try {
        const result = await pool.query(
            `
            SELECT
                m.id,
                m.member_id,
                m.status,
                m.expiration_date,
                u.full_name,
                (
                    UPPER(m.status) = 'ACTIVE'
                    AND m.archived_at IS NULL
                    AND (
                        m.expiration_date IS NULL
                        OR m.expiration_date >= (${GUEST_NOW_SQL})::date
                    )
                ) AS eligible,
                (
                    UPPER(m.status) = 'ACTIVE'
                    AND m.expiration_date IS NOT NULL
                    AND m.expiration_date < (${GUEST_NOW_SQL})::date
                ) AS expired,
                COALESCE((
                    SELECT json_agg(
                        json_build_object(
                            'id', a.id,
                            'check_in', a.check_in
                        )
                        ORDER BY a.check_in DESC, a.id DESC
                    )
                    FROM attendance a
                    WHERE a.member_id = m.id
                      AND UPPER(a.user_type) = 'MEMBER'
                      AND a.check_out IS NULL
                ), '[]'::json) AS open_visits
            FROM members m
            JOIN users u
                ON u.id = m.user_id
            WHERE m.archived_at IS NULL
              AND LOWER(u.role) = 'customer'
            ORDER BY u.full_name, m.id DESC
            `
        );

        return res.json({
            success: true,
            members: result.rows
        });
    } catch (error) {
        console.error("Attendance member list error:", error);
        return res.status(500).json({
            success: false,
            message: "Unable to load the attendance member list."
        });
    }
});

app.get("/api/admin/members/search", async (req, res) => {
    const query = String(req.query.query || "").trim();
    if (query.length < 2) {
        return res.status(400).json({
            success: false,
            message: "Enter at least two characters to search members."
        });
    }

    try {
        const result = await pool.query(
            `
            SELECT
                m.id,
                m.member_id,
                m.status,
                m.expiration_date,
                u.full_name,
                (
                    UPPER(m.status) = 'ACTIVE'
                    AND m.archived_at IS NULL
                    AND (
                        m.expiration_date IS NULL
                        OR m.expiration_date >= (${GUEST_NOW_SQL})::date
                    )
                ) AS eligible,
                COALESCE((
                    SELECT json_agg(
                        json_build_object(
                            'id', a.id,
                            'check_in', a.check_in
                        )
                        ORDER BY a.check_in DESC, a.id DESC
                    )
                    FROM attendance a
                    WHERE a.member_id = m.id
                      AND UPPER(a.user_type) = 'MEMBER'
                      AND a.check_out IS NULL
                ), '[]'::json) AS open_visits
            FROM members m
            JOIN users u
                ON u.id = m.user_id
            WHERE m.archived_at IS NULL
              AND UPPER(m.status) <> 'REVOKED'
              AND LOWER(u.role) = 'customer'
              AND (
                  m.member_id ILIKE $1
                  OR u.full_name ILIKE $1
              )
            ORDER BY u.full_name, m.id DESC
            LIMIT 20
            `,
            [`%${query}%`]
        );

        return res.json({
            success: true,
            members: result.rows.map(member => ({
                ...member,
                expired: !member.eligible &&
                    String(member.status).toUpperCase() === "ACTIVE"
            }))
        });
    } catch (error) {
        console.error("Manual member search error:", error);
        return res.status(500).json({
            success: false,
            message: "Unable to search members."
        });
    }
});

app.post(
    "/api/admin/attendance/manual",
    async (req, res) => {

        const client = await pool.connect();
        let transactionStarted = false;

        try {

            const action = String(req.body?.action || "")
                .trim()
                .toUpperCase()
                .replace(/[\s-]+/g, "_");

            if (action !== "CHECK_IN" && action !== "CHECK_OUT") {
                return res.status(400).json({
                    success: false,
                    message: "Action must be CHECK_IN or CHECK_OUT."
                });
            }

            const memberRecordId = Number(req.body?.member_record_id);
            const attendanceId = Number(req.body?.attendance_id);
            if (
                (action === "CHECK_IN" &&
                    (!Number.isSafeInteger(memberRecordId) || memberRecordId <= 0)) ||
                (action === "CHECK_OUT" &&
                    (!Number.isSafeInteger(attendanceId) || attendanceId <= 0))
            ) {
                return res.status(400).json({
                    success: false,
                    message: action === "CHECK_IN"
                        ? "Select a member from the search results."
                        : "Select the specific open visit to check out."
                });
            }

            await client.query("BEGIN");
            transactionStarted = true;

            const memberResult = action === "CHECK_IN"
                ? await client.query(
                    `
                    SELECT
                        m.id,
                        m.user_id,
                        m.member_id,
                        m.status,
                        m.archived_at,
                        m.expiration_date,
                        u.full_name,
                        (
                            m.expiration_date IS NULL OR
                            m.expiration_date >= (${GUEST_NOW_SQL})::date
                        ) AS membership_unexpired
                    FROM members m
                    JOIN users u
                        ON u.id = m.user_id
                    WHERE m.id = $1
                      AND LOWER(u.role) = 'customer'
                    FOR UPDATE OF m
                    `,
                    [memberRecordId]
                )
                : await client.query(
                    `
                    SELECT
                        m.id,
                        m.user_id,
                        m.member_id,
                        m.status,
                        m.archived_at,
                        m.expiration_date,
                        u.full_name,
                        (
                            m.expiration_date IS NULL OR
                            m.expiration_date >= (${GUEST_NOW_SQL})::date
                        ) AS membership_unexpired
                    FROM attendance a
                    JOIN members m
                        ON m.id = a.member_id
                    JOIN users u
                        ON u.id = m.user_id
                    WHERE a.id = $1
                      AND UPPER(a.user_type) = 'MEMBER'
                      AND a.check_out IS NULL
                    FOR UPDATE OF a, m
                    `,
                    [attendanceId]
                );

            if (memberResult.rows.length === 0) {
                await client.query("ROLLBACK");
                transactionStarted = false;
                return res.status(404).json({
                    success: false,
                    message: "No membership was found for this user."
                });
            }

            const member = memberResult.rows[0];
            const status = String(member.status || "").trim().toUpperCase();

            let attendance;

            if (action === "CHECK_IN") {
                if (
                    status !== "ACTIVE" ||
                    !member.membership_unexpired ||
                    member.archived_at
                ) {
                    await client.query("ROLLBACK");
                    transactionStarted = false;
                    return res.status(400).json({
                        success: false,
                        message: !member.membership_unexpired
                            ? "This membership has expired."
                            : "This member does not have an active membership."
                    });
                }

                const openAttendanceResult = await client.query(
                    `
                    SELECT id
                    FROM attendance
                    WHERE member_id = $1
                      AND UPPER(user_type) = 'MEMBER'
                      AND check_out IS NULL
                    ORDER BY check_in DESC, id DESC
                    FOR UPDATE
                    `,
                    [member.id]
                );
                if (openAttendanceResult.rows.length > 0) {
                    await client.query("ROLLBACK");
                    transactionStarted = false;
                    return res.status(409).json({
                        success: false,
                        message: "This member has an open visit. Select that specific visit to check out before starting another."
                    });
                }

                const checkinResult = await client.query(
                    `
                    INSERT INTO attendance
                        (member_id, user_type, check_in)
                    VALUES
                        ($1, 'MEMBER', ${GUEST_NOW_SQL})
                    RETURNING
                        id,
                        member_id,
                        guest_id,
                        user_type,
                        check_in,
                        check_out
                    `,
                    [member.id]
                );

                attendance = checkinResult.rows[0];
            } else {
                const checkoutResult = await client.query(
                    `
                    UPDATE attendance
                    SET check_out = ${GUEST_NOW_SQL}
                    WHERE id = $1
                      AND member_id = $2
                      AND UPPER(user_type) = 'MEMBER'
                      AND check_out IS NULL
                    RETURNING
                        id,
                        member_id,
                        guest_id,
                        user_type,
                        check_in,
                        check_out
                    `,
                    [attendanceId, member.id]
                );

                if (checkoutResult.rows.length === 0) {
                    await client.query("ROLLBACK");
                    transactionStarted = false;
                    return res.status(404).json({
                        success: false,
                        message: "The selected visit is no longer active."
                    });
                }

                attendance = checkoutResult.rows[0];
            }

            const {
                membersInside,
                guestsInside,
                occupancy
            } = await getCurrentOccupancy(client);

            await client.query("COMMIT");
            transactionStarted = false;

            return res.json({
                success: true,
                action: action === "CHECK_IN" ? "CHECKED_IN" : "CHECKED_OUT",
                message: action === "CHECK_IN"
                    ? "You checked in successfully."
                    : "You checked out successfully.",
                member: {
                    id: member.id,
                    user_id: member.user_id,
                    member_id: member.member_id,
                    full_name: member.full_name
                },
                attendance,
                membersInside,
                guestsInside,
                occupancy,
                capacity: 120
            });

        } catch (error) {

            if (transactionStarted) {
                try {
                    await client.query("ROLLBACK");
                } catch (rollbackError) {
                    console.error("Rollback error:", rollbackError);
                }
            }

            console.error("Manual attendance override error:", error);
            return res.status(500).json({
                success: false,
                message: "Unable to apply the manual attendance override.",
                error: error.message,
                code: error.code || null,
                detail: error.detail || null
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
                payment_method,
                payment_reference,
                payment_confirmed,
                idempotency_key
            } = req.body;
            const idempotencyKey = String(idempotency_key || "").trim();
            const paymentReference = String(payment_reference || "").trim();

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

            if (payment_confirmed !== true) {
                return res.status(402).json({
                    success: false,
                    message: "Confirm that payment was received or verified before checking in the guest."
                });
            }

            if (!idempotencyKey || idempotencyKey.length > 120) {
                return res.status(400).json({
                    success: false,
                    message: "A valid payment request key is required."
                });
            }

            if (
                finalPaymentMethod === "GCASH" &&
                paymentReference &&
                (paymentReference.length < 6 || paymentReference.length > 100)
            ) {
                return res.status(400).json({
                    success: false,
                    message: "Enter the verified GCash reference (6 to 100 characters)."
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

            await client.query(
                "SELECT pg_advisory_xact_lock(hashtext($1))",
                [`guest-entry:${idempotencyKey}`]
            );

            const duplicateResult = await client.query(
                `
                SELECT
                    gt.id AS transaction_id,
                    gt.transaction_reference,
                    g.id AS guest_id,
                    g.full_name,
                    a.id AS attendance_id,
                    a.check_in,
                    a.check_out
                FROM guest_transactions gt
                JOIN guests g
                    ON g.id = gt.guest_id
                LEFT JOIN attendance a
                    ON a.id = gt.attendance_id
                WHERE gt.idempotency_key = $1
                `,
                [`ENTRY:${idempotencyKey}`]
            );

            if (duplicateResult.rows.length > 0) {
                await client.query("COMMIT");
                transactionStarted = false;
                return res.json({
                    success: true,
                    duplicate: true,
                    message: "This guest payment and check-in were already recorded.",
                    guest: {
                        id: duplicateResult.rows[0].guest_id,
                        full_name: duplicateResult.rows[0].full_name
                    },
                    attendance: {
                        id: duplicateResult.rows[0].attendance_id,
                        check_in: duplicateResult.rows[0].check_in,
                        check_out: duplicateResult.rows[0].check_out
                    },
                    transaction_id: duplicateResult.rows[0].transaction_id,
                    transaction_reference:
                        duplicateResult.rows[0].transaction_reference
                });
            }

            const transactionReference =
                finalPaymentMethod === "GCASH" && paymentReference
                    ? paymentReference
                    : `GUEST-${crypto.randomUUID()}`;

            if (finalPaymentMethod === "GCASH" && paymentReference) {
                await client.query(
                    "SELECT pg_advisory_xact_lock(hashtext($1))",
                    [`gcash-reference:${paymentReference.toLowerCase()}`]
                );
                const duplicateReference = await client.query(
                    `
                    SELECT id
                    FROM guest_transactions
                    WHERE payment_method = 'GCASH'
                      AND LOWER(transaction_reference) = LOWER($1)
                      AND payment_status = 'CONFIRMED'
                    LIMIT 1
                    `,
                    [paymentReference]
                );
                if (duplicateReference.rows.length > 0) {
                    await client.query("ROLLBACK");
                    transactionStarted = false;
                    return res.status(409).json({
                        success: false,
                        message: "This GCash reference has already been recorded."
                    });
                }
            }

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
                `
                INSERT INTO guest_transactions
                (
                    guest_id,
                    guest_name,
                    visit_type,
                    amount,
                    payment_method,
                    transaction_reference,
                    attendance_id,
                    payment_status,
                    idempotency_key
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
                    'CONFIRMED',
                    $8
                )
                `,
                [
                    guest.id,
                    guest.full_name,
                    guest.visit_type,
                    guest.amount_paid,
                    guest.payment_method,
                    transactionReference,
                    attendanceResult.rows[0].id,
                    `ENTRY:${idempotencyKey}`
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
                    attendanceResult.rows[0],

                transaction_reference:
                    transactionReference

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
// Expiration is not evidence of departure.
// Only an administrator's actual checkout
// action records check_out.
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

            if (automatic) {
                return res.status(400).json({
                    success: false,
                    message: "Attendance can only be checked out after an administrator records the person's actual departure."
                });
            }

            // ---------------------------------
            // GET CURRENT ATTENDANCE + TIMER
            // ---------------------------------

            const targetResult =
                await pool.query(
                    `
                    SELECT id
                    FROM attendance
                    WHERE id = $1
                      AND check_out IS NULL
                      AND UPPER(user_type) = 'MEMBER'
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
                        "Active member attendance record not found. Guest access ends automatically when its paid time expires."

                });

            }

            // =================================
            // UPDATE CHECKOUT
            // =================================

            const result =
                await pool.query(
                    `
                    UPDATE attendance
                    SET
                        check_out = ${GUEST_NOW_SQL}

                    WHERE
                        id = $1
                        AND check_out IS NULL
                        AND UPPER(user_type) = 'MEMBER'

                    RETURNING
                        id,
                        member_id,
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
                        "Active attendance record not found."

                });

            }

            res.json({

                success:
                    true,

                message:
                    "Checked out successfully.",

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

app.delete("/api/admin/attendance/:id/remove", (req, res) => {
    if (!requireAdministrator(req, res)) {
        return;
    }

    return res.status(410).json({
        success: false,
        message: "Attendance history is retained and cannot be permanently deleted."
    });
});

// =====================================
// REPORTS
// =====================================

app.get(
    "/api/admin/reports",
    async (req, res) => {

        try {
            const period =
                String(req.query.period || "daily")
                    .trim()
                    .toLowerCase();

            if (!["daily", "weekly", "monthly", "custom"].includes(period)) {
                return res.status(400).json({
                    success: false,
                    message: "Report period must be daily, weekly, monthly, or custom."
                });
            }

            let rangeCondition;
            let reportParameters = [];
            let startDate;
            let endDate;

            if (period === "custom") {
                startDate = String(req.query.startDate || "");
                endDate = String(req.query.endDate || "");
                const isValidDate = value => {
                    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
                        return false;
                    }
                    const date = new Date(`${value}T00:00:00.000Z`);
                    return (
                        !Number.isNaN(date.getTime()) &&
                        date.toISOString().slice(0, 10) === value
                    );
                };

                if (
                    !isValidDate(startDate) ||
                    !isValidDate(endDate) ||
                    startDate > endDate
                ) {
                    return res.status(400).json({
                        success: false,
                        message: "Custom reports require valid startDate and endDate values in YYYY-MM-DD format."
                    });
                }

                rangeCondition =
                    "a.check_in >= $1::date AND a.check_in < ($2::date + INTERVAL '1 day')";
                reportParameters = [startDate, endDate];
            } else if (period === "daily") {
                rangeCondition = `
                    a.check_in >= DATE_TRUNC('day', ${GUEST_NOW_SQL})
                    AND a.check_in < DATE_TRUNC('day', ${GUEST_NOW_SQL}) + INTERVAL '1 day'
                `;
            } else if (period === "weekly") {
                rangeCondition = `
                    a.check_in >= DATE_TRUNC('week', ${GUEST_NOW_SQL})
                    AND a.check_in < DATE_TRUNC('week', ${GUEST_NOW_SQL}) + INTERVAL '7 days'
                `;
            } else {
                rangeCondition = `
                    a.check_in >= DATE_TRUNC('month', ${GUEST_NOW_SQL})
                    AND a.check_in < DATE_TRUNC('month', ${GUEST_NOW_SQL}) + INTERVAL '1 month'
                `;
            }

            const summaryResult = await pool.query(
                `
                SELECT
                    COUNT(*) FILTER (
                        WHERE UPPER(a.user_type) IN ('MEMBER', 'GUEST')
                    )::int AS total_visits,
                    COUNT(*) FILTER (
                        WHERE UPPER(a.user_type) = 'MEMBER'
                    )::int AS member_visits,
                    COUNT(*) FILTER (
                        WHERE UPPER(a.user_type) = 'GUEST'
                    )::int AS guest_visits,
                    COUNT(DISTINCT CASE
                        WHEN UPPER(a.user_type) = 'MEMBER'
                        THEN COALESCE(
                            ${normalizedPhoneSql("u.phone")},
                            'member-user:' || COALESCE(m.user_id::text, a.id::text)
                        )
                        WHEN UPPER(a.user_type) = 'GUEST'
                        THEN COALESCE(
                            ${normalizedPhoneSql("g.phone")},
                            'guest-id:' || COALESCE(a.guest_id::text, a.id::text)
                        )
                    END)::int AS unique_visitors,
                    COUNT(DISTINCT CASE
                        WHEN UPPER(a.user_type) = 'MEMBER'
                        THEN COALESCE(
                            ${normalizedPhoneSql("u.phone")},
                            'member-user:' || COALESCE(m.user_id::text, a.id::text)
                        )
                    END)::int AS member_visitor_count,
                    COUNT(DISTINCT CASE
                        WHEN UPPER(a.user_type) = 'GUEST'
                        THEN COALESCE(
                            ${normalizedPhoneSql("g.phone")},
                            'guest-id:' || COALESCE(a.guest_id::text, a.id::text)
                        )
                    END)::int AS guest_visitor_count
                FROM attendance a
                LEFT JOIN members m
                    ON m.id = a.member_id
                LEFT JOIN users u
                    ON u.id = m.user_id
                LEFT JOIN guests g
                    ON g.id = a.guest_id
                WHERE ${rangeCondition}
                  AND UPPER(a.user_type) IN ('MEMBER', 'GUEST')
                `,
                reportParameters
            );

            const chartBucket =
                period === "daily"
                    ? "hour"
                    : period === "weekly"
                        ? "day"
                        : period === "monthly"
                            ? "week"
                            : "day";
            const chartLabel =
                period === "daily"
                    ? "FMHH12 AM"
                    : period === "weekly"
                        ? "Dy MM/DD"
                        : period === "monthly"
                            ? "Mon DD"
                            : "YYYY-MM-DD";
            const bucketRange =
                period === "daily"
                    ? {
                            start: `DATE_TRUNC('day', ${GUEST_NOW_SQL})`,
                            end: `DATE_TRUNC('day', ${GUEST_NOW_SQL}) + INTERVAL '1 day'`
                    }
                    : period === "weekly"
                            ? {
                                start: `DATE_TRUNC('week', ${GUEST_NOW_SQL})`,
                                end: `DATE_TRUNC('week', ${GUEST_NOW_SQL}) + INTERVAL '7 days'`
                            }
                            : period === "monthly"
                                ? {
                                    start: `DATE_TRUNC('month', ${GUEST_NOW_SQL})`,
                                    end: `DATE_TRUNC('month', ${GUEST_NOW_SQL}) + INTERVAL '1 month'`
                                }
                                : {
                                    start: "$1::date",
                                    end: "($2::date + INTERVAL '1 day')"
                                };

            const detailResult = await pool.query(
                `
                SELECT
                    a.id,
                    TO_CHAR(
                        DATE_TRUNC('${chartBucket}', a.check_in),
                        '${chartLabel}'
                    ) AS group_label,
                    CASE
                        WHEN UPPER(a.user_type) = 'MEMBER' THEN u.full_name
                        WHEN UPPER(a.user_type) = 'GUEST' THEN g.full_name
                        ELSE 'Unknown'
                    END AS visitor_name,
                    UPPER(a.user_type) AS user_type,
                    a.check_in,
                    a.check_out,
                    GREATEST(
                        0,
                        FLOOR(EXTRACT(EPOCH FROM (
                            COALESCE(a.check_out, ${GUEST_NOW_SQL}) - a.check_in
                        )))
                    )::int AS duration_seconds,
                    CASE
                        WHEN UPPER(a.user_type) <> 'GUEST' THEN NULL
                        WHEN EXISTS (
                            SELECT 1
                            FROM guest_visit_extensions e
                            WHERE e.attendance_id = a.id
                              AND e.extension_type = 'ALL_DAY'
                              AND e.payment_status = 'CONFIRMED'
                        ) THEN 'All-day access'
                        WHEN UPPER(g.visit_type) = 'DAY PASS' THEN 'All-day pass'
                        ELSE (
                            COALESCE(g.hours, 0) + COALESCE((
                                SELECT SUM(e.additional_hours)
                                FROM guest_visit_extensions e
                                WHERE e.attendance_id = a.id
                                  AND e.extension_type = 'EXTRA_HOURS'
                                  AND e.payment_status = 'CONFIRMED'
                            ), 0)
                        )::text || ' hour(s)'
                    END AS guest_time_purchased,
                    CASE
                        WHEN a.check_out IS NOT NULL THEN 'CHECKED OUT'
                        WHEN UPPER(a.user_type) = 'GUEST'
                         AND ${GUEST_CLOSING_SQL} <= ${GUEST_NOW_SQL}
                        THEN 'TIMED OUT'
                        ELSE 'CHECKED IN'
                    END AS visit_status
                FROM attendance a
                LEFT JOIN members m
                    ON m.id = a.member_id
                LEFT JOIN users u
                    ON u.id = m.user_id
                LEFT JOIN guests g
                    ON g.id = a.guest_id
                WHERE ${rangeCondition}
                  AND UPPER(a.user_type) IN ('MEMBER', 'GUEST')
                ORDER BY a.check_in DESC, a.id DESC
                `,
                reportParameters
            );

            const seriesResult = await pool.query(
                `
                WITH buckets AS (
                    SELECT generate_series(
                        DATE_TRUNC('${chartBucket}', ${bucketRange.start}),
                        DATE_TRUNC(
                            '${chartBucket}',
                            (${bucketRange.end}) - INTERVAL '1 microsecond'
                        ),
                        INTERVAL '1 ${chartBucket}'
                    ) AS bucket
                ),
                visits AS (
                    SELECT
                        DATE_TRUNC('${chartBucket}', a.check_in) AS bucket,
                        COUNT(*)::int AS visits
                    FROM attendance a
                    WHERE ${rangeCondition}
                      AND UPPER(a.user_type) IN ('MEMBER', 'GUEST')
                    GROUP BY DATE_TRUNC('${chartBucket}', a.check_in)
                )
                SELECT
                    buckets.bucket,
                    TO_CHAR(
                        buckets.bucket,
                        '${chartLabel}'
                    ) AS label,
                    COALESCE(visits.visits, 0)::int AS visits
                FROM buckets
                LEFT JOIN visits
                    ON visits.bucket = buckets.bucket
                ORDER BY buckets.bucket
                `,
                reportParameters
            );
            const occupancy = await getCurrentOccupancy();
            const summary = summaryResult.rows[0];

            return res.json({
                success: true,
                period,
                startDate: startDate || null,
                endDate: endDate || null,
                totalVisits: Number(summary.total_visits || 0),
                memberVisits: Number(summary.member_visits || 0),
                guestVisits: Number(summary.guest_visits || 0),
                uniqueVisitors: Number(summary.unique_visitors || 0),
                memberVisitorCount: Number(summary.member_visitor_count || 0),
                guestVisitorCount: Number(summary.guest_visitor_count || 0),
                currentOccupancy: occupancy.occupancy,
                membersInside: occupancy.membersInside,
                guestsInside: occupancy.guestsInside,
                series: seriesResult.rows,
                records: detailResult.rows
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

async function startServer() {
    await ensureDashboardSchema();

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
                ? `Late-night test mode: ${GYM_CLOSING_TIME} next-day closing for check-ins at/after closing.`
                : `Normal guest mode: ${GYM_CLOSING_TIME} same-day closing.`
        );

        }
    );
}

if (require.main === module) {
    startServer().catch(error => {
        console.error("Database schema initialization failed:", error);
        void pool.end().finally(() => {
            process.exitCode = 1;
        });
    });
}

module.exports = {
    app,
    pool,
    ensureDashboardSchema,
    startServer
};