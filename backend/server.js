require("dotenv").config();

const express = require("express");
const { Pool } = require("pg");
const bcrypt = require("bcrypt");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const QRCode = require("qrcode");

const app = express();
const PORT = process.env.PORT || 3000;

const pool = new Pool({
    connectionString: process.env.DATABASE_URL
});

pool.on("error", (error) => {
    console.error("PostgreSQL pool error:", error);
});

const projectRoot = path.join(__dirname, "..");
const frontendDir = path.join(projectRoot, "frontend");
const uploadDir = path.join(projectRoot, "uploads");

if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, {
        recursive: true
    });
}

app.use(
    express.json({
        limit: "10mb"
    })
);

app.use(express.static(frontendDir));

app.use(
    "/uploads",
    express.static(uploadDir)
);

app.get("/", (req, res) => {
    res.sendFile(
        path.join(frontendDir, "login.html")
    );
});

app.get("/api/test-db", async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT
                NOW() AS current_time,
                current_database() AS database_name,
                current_user
        `);

        res.json({
            success: true,
            message: "PostgreSQL connected!",
            data: result.rows[0]
        });
    } catch (error) {
        console.error("Database test error:", error);

        res.status(500).json({
            success: false,
            message: "PostgreSQL connection failed.",
            error: error.message
        });
    }
});

app.delete(
    "/api/admin/archived-members/:id",
    async (req, res) => {
        const client = await pool.connect();
        let transactionStarted = false;

        try {
            const archiveId = Number(req.params.id);

            if (
                !Number.isInteger(archiveId) ||
                archiveId <= 0
            ) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid archive ID."
                });
            }

            await client.query("BEGIN");
            transactionStarted = true;

            const archiveResult = await client.query(
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
                [archiveId]
            );

            if (archiveResult.rows.length === 0) {
                await client.query("ROLLBACK");
                transactionStarted = false;

                return res.status(404).json({
                    success: false,
                    message: "Archived member record not found."
                });
            }

            const archived = archiveResult.rows[0];

            if (
                !archived.restored_at &&
                String(archived.status || "").toUpperCase() !== "RESTORED"
            ) {
                await client.query("ROLLBACK");
                transactionStarted = false;

                return res.status(400).json({
                    success: false,
                    message:
                        "Only restored archived records can be deleted."
                });
            }

            const deleteResult = await client.query(
                `
                DELETE FROM archived_members
                WHERE archive_id = $1
                RETURNING
                    archive_id,
                    user_id,
                    member_id
                `,
                [archiveId]
            );

            await client.query("COMMIT");
            transactionStarted = false;

            res.json({
                success: true,
                message:
                    "Archived history deleted successfully.",
                archive:
                    deleteResult.rows[0]
            });
        } catch (error) {
            if (transactionStarted) {
                try {
                    await client.query("ROLLBACK");
                } catch (rollbackError) {
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
                success: false,
                message:
                    "Unable to delete archived member history.",
                error:
                    error.message,
                code:
                    error.code || null,
                detail:
                    error.detail || null
            });
        } finally {
            client.release();
        }
    }
);

app.post("/api/signup", async (req, res) => {
    try {
        const {
            fullName,
            full_name,
            email,
            password,
            phone
        } = req.body;

        const finalFullName = fullName || full_name;

        if (
            !finalFullName ||
            !email ||
            !password ||
            !phone
        ) {
            return res.status(400).json({
                success: false,
                message: "Please complete all required fields."
            });
        }

        const normalizedEmail = String(email)
            .trim()
            .toLowerCase();

        const existingUser = await pool.query(
            `
            SELECT id
            FROM users
            WHERE LOWER(email) = $1
            `,
            [normalizedEmail]
        );

        if (existingUser.rows.length > 0) {
            return res.status(400).json({
                success: false,
                message: "An account with this email already exists."
            });
        }

        const hashedPassword = await bcrypt.hash(
            password,
            10
        );

        const result = await pool.query(
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
                String(finalFullName).trim(),
                normalizedEmail,
                hashedPassword,
                String(phone).trim()
            ]
        );

        res.status(201).json({
            success: true,
            message: "Account created successfully.",
            user: result.rows[0]
        });
    } catch (error) {
        console.error("Signup error:", error);

        res.status(500).json({
            success: false,
            message: "Unable to create account.",
            error: error.message,
            code: error.code || null
        });
    }
});

app.post("/api/login", async (req, res) => {
    try {
        const {
            email,
            password
        } = req.body;

        if (!email || !password) {
            return res.status(400).json({
                success: false,
                message: "Email and password are required."
            });
        }

        const normalizedEmail = String(email)
            .trim()
            .toLowerCase();

        const result = await pool.query(
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
            [normalizedEmail]
        );

        if (result.rows.length === 0) {
            return res.status(401).json({
                success: false,
                message: "Invalid email or password."
            });
        }

        const user = result.rows[0];

        const passwordMatch = await bcrypt.compare(
            password,
            user.password
        );

        if (!passwordMatch) {
            return res.status(401).json({
                success: false,
                message: "Invalid email or password."
            });
        }

        if (
            String(user.role).toLowerCase() !==
            "customer"
        ) {
            return res.status(403).json({
                success: false,
                message: "This login is for customer accounts only."
            });
        }

        delete user.password;

        res.json({
            success: true,
            message: "Login successful.",
            user
        });
    } catch (error) {
        console.error("Login error:", error);

        res.status(500).json({
            success: false,
            message: "Unable to login.",
            error: error.message
        });
    }
});

app.get("/api/customer/:userId", async (req, res) => {
    try {
        const userId = Number(req.params.userId);

        if (!Number.isInteger(userId)) {
            return res.status(400).json({
                success: false,
                message: "Invalid customer ID."
            });
        }

        const userResult = await pool.query(
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
            [userId]
        );

        if (userResult.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Customer account not found."
            });
        }

        const memberResult = await pool.query(
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
            [userId]
        );

        let membership =
            memberResult.rows.length > 0
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

        const applicationResult = await pool.query(
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
            [userId]
        );

        let application =
            applicationResult.rows.length > 0
                ? applicationResult.rows[0]
                : null;

        if (
            application &&
            !membership &&
            String(application.status)
                .trim()
                .toUpperCase() === "APPROVED"
        ) {
            application = {
                ...application,
                membership_removed: true
            };
        }

        const transactionResult = await pool.query(
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
            [userId]
        );

        res.json({
            success: true,
            user: userResult.rows[0],
            customer: userResult.rows[0],
            membership,
            application,
            transactions: transactionResult.rows
        });
    } catch (error) {
        console.error("Customer dashboard error:", error);

        res.status(500).json({
            success: false,
            message: "Unable to load customer data.",
            error: error.message
        });
    }
});

app.post("/api/applications", async (req, res) => {
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
            return res.status(400).json({
                success: false,
                message: "Customer account is required."
            });
        }

        if (
            !gcash_reference ||
            !String(gcash_reference).trim()
        ) {
            return res.status(400).json({
                success: false,
                message: "GCash reference number is required."
            });
        }

        if (!payment_date) {
            return res.status(400).json({
                success: false,
                message: "Payment date is required."
            });
        }

        if (!payment_screenshot) {
            return res.status(400).json({
                success: false,
                message: "Payment screenshot is required."
            });
        }

        const fixedAmount = 800;

        if (Number(amount) !== fixedAmount) {
            return res.status(400).json({
                success: false,
                message: "Membership fee must be exactly ₱800."
            });
        }

        const userResult = await pool.query(
            `
            SELECT id
            FROM users
            WHERE id = $1
              AND LOWER(role) = 'customer'
            `,
            [user_id]
        );

        if (userResult.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Customer account not found."
            });
        }

        const referenceResult = await pool.query(
            `
            SELECT id
            FROM applications
            WHERE LOWER(gcash_reference) = LOWER($1)
            `,
            [String(gcash_reference).trim()]
        );

        if (referenceResult.rows.length > 0) {
            return res.status(400).json({
                success: false,
                message:
                    "This GCash reference number has already been submitted."
            });
        }

        const pendingResult = await pool.query(
            `
            SELECT id
            FROM applications
            WHERE user_id = $1
              AND UPPER(status) = 'PENDING'
            `,
            [user_id]
        );

        if (pendingResult.rows.length > 0) {
            return res.status(400).json({
                success: false,
                message: "You already have a pending application."
            });
        }

        let screenshotPath = null;

        try {
            const matches = String(
                payment_screenshot
            ).match(
                /^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/i
            );

            if (!matches) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Invalid payment screenshot. Use PNG, JPG, JPEG, or WEBP."
                });
            }

            const extension = matches[1]
                .toLowerCase()
                .replace("jpeg", "jpg");

            const imageData = Buffer.from(
                matches[2],
                "base64"
            );

            if (
                imageData.length >
                8 * 1024 * 1024
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Payment screenshot is too large. Maximum is 8MB."
                });
            }

            const filename =
                `${Date.now()}-${crypto.randomUUID()}.${extension}`;

            const filepath = path.join(
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

            return res.status(400).json({
                success: false,
                message:
                    "Unable to save payment screenshot."
            });
        }

        const result = await pool.query(
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
                membership_plan || "Monthly",
                fixedAmount,
                String(
                    gcash_reference
                ).trim(),
                screenshotPath,
                payment_date
            ]
        );

        res.status(201).json({
            success: true,
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

        res.status(500).json({
            success: false,
            message:
                "Unable to submit membership application.",
            error: error.message,
            code: error.code || null,
            detail: error.detail || null
        });
    }
});

app.get("/api/admin/applications", async (req, res) => {
    try {
        const result = await pool.query(`
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
        `);

        res.json({
            success: true,
            applications: result.rows
        });
    } catch (error) {
        console.error(
            "Admin applications error:",
            error
        );

        res.status(500).json({
            success: false,
            message: "Unable to load applications.",
            error: error.message
        });
    }
});

app.post(
    "/api/admin/applications/:id/approve",
    async (req, res) => {
        const client = await pool.connect();
        let transactionStarted = false;

        try {
            const applicationId =
                Number(req.params.id);

            if (
                !Number.isInteger(
                    applicationId
                )
            ) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid application ID."
                });
            }

            await client.query("BEGIN");
            transactionStarted = true;

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
                    [applicationId]
                );

            if (
                applicationResult.rows.length ===
                0
            ) {
                await client.query("ROLLBACK");
                transactionStarted = false;

                return res.status(404).json({
                    success: false,
                    message: "Application not found."
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
                await client.query("ROLLBACK");
                transactionStarted = false;

                return res.status(400).json({
                    success: false,
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
                    [application.user_id]
                );

            const today = new Date();

            const startDate =
                today.toISOString().slice(0, 10);

            let memberId = null;
            let expirationDate = null;

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
                    new Date(baseDate);

                newExpiration.setMonth(
                    newExpiration.getMonth() + 1
                );

                expirationDate =
                    newExpiration
                        .toISOString()
                        .slice(0, 10);

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
                    ).padStart(6, "0")}`;

                const qrCode =
                    `ANCHOR-${crypto.randomUUID()}`;

                const expiration =
                    new Date(today);

                expiration.setMonth(
                    expiration.getMonth() + 1
                );

                expirationDate =
                    expiration
                        .toISOString()
                        .slice(0, 10);

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
                    newMember.rows[0].member_id;
            }

            await client.query(
                `
                UPDATE applications
                SET
                    status = 'APPROVED',
                    rejection_reason = NULL
                WHERE id = $1
                `,
                [applicationId]
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

            await client.query("COMMIT");
            transactionStarted = false;

            res.json({
                success: true,
                message:
                    "Application approved. Membership is now ACTIVE.",
                member_id: memberId,
                expiration_date: expirationDate
            });
        } catch (error) {
            if (transactionStarted) {
                try {
                    await client.query("ROLLBACK");
                } catch (rollbackError) {
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

            res.status(500).json({
                success: false,
                message:
                    "Unable to approve application.",
                error:
                    error.message,
                code:
                    error.code || null,
                detail:
                    error.detail || null
            });
        } finally {
            client.release();
        }
    }
);

app.post(
    "/api/admin/applications/:id/reject",
    async (req, res) => {
        try {
            const applicationId =
                Number(req.params.id);

            if (
                !Number.isInteger(
                    applicationId
                )
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Invalid application ID."
                });
            }

            const reason = String(
                req.body.reason || ""
            ).trim();

            if (!reason) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Rejection reason is required."
                });
            }

            const result = await pool.query(
                `
                UPDATE applications
                SET
                    status = 'REJECTED',
                    rejection_reason = $1
                WHERE id = $2
                  AND UPPER(status) = 'PENDING'
                RETURNING
                    id,
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
                return res.status(404).json({
                    success: false,
                    message:
                        "Pending application not found."
                });
            }

            res.json({
                success: true,
                message:
                    "Application rejected.",
                application:
                    result.rows[0]
            });
        } catch (error) {
            console.error(
                "Rejection error:",
                error
            );

            res.status(500).json({
                success: false,
                message:
                    "Unable to reject application.",
                error:
                    error.message
            });
        }
    }
);

app.get("/api/admin/dashboard", async (req, res) => {
    try {
        const registeredResult =
            await pool.query(`
                SELECT
                    COUNT(*)::int AS total_registered
                FROM users
                WHERE LOWER(role) = 'customer'
            `);

        const membersResult =
            await pool.query(`
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
            `);

        const applicationsResult =
            await pool.query(`
                SELECT
                    COUNT(*) FILTER (
                        WHERE UPPER(status) = 'PENDING'
                    )::int AS pending_applications,
                    COUNT(*) FILTER (
                        WHERE UPPER(status) = 'REJECTED'
                    )::int AS rejected_applications
                FROM applications
            `);

        const attendanceResult =
            await pool.query(`
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
            `);

        const totalRegistered = Number(
            registeredResult.rows[0]
                .total_registered || 0
        );

        const totalMembers = Number(
            membersResult.rows[0]
                .total_members || 0
        );

        const activeMembers = Number(
            membersResult.rows[0]
                .active_members || 0
        );

        const expiredMembers = Number(
            membersResult.rows[0]
                .expired_members || 0
        );

        const suspendedMembers = Number(
            membersResult.rows[0]
                .suspended_members || 0
        );

        const pendingApplications = Number(
            applicationsResult.rows[0]
                .pending_applications || 0
        );

        const rejectedApplications = Number(
            applicationsResult.rows[0]
                .rejected_applications || 0
        );

        const membersInside = Number(
            attendanceResult.rows[0]
                .members_inside || 0
        );

        const guestsInside = Number(
            attendanceResult.rows[0]
                .guests_inside || 0
        );

        const occupancy =
            membersInside +
            guestsInside;

        res.json({
            success: true,
            totalRegistered,
            totalMembers,
            activeMembers,
            expiredMembers,
            suspendedMembers,
            pendingApplications,
            rejectedApplications,
            membersInside,
            guestsInside,
            occupancy,
            capacity: 120
        });
    } catch (error) {
        console.error(
            "Dashboard error:",
            error
        );

        res.status(500).json({
            success: false,
            message:
                "Unable to load dashboard data.",
            error:
                error.message
        });
    }
});

app.get("/api/admin/members", async (req, res) => {
    try {
        const result = await pool.query(`
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
            ORDER BY
                m.id DESC
        `);

        res.json({
            success: true,
            members: result.rows
        });
    } catch (error) {
        console.error(
            "Members error:",
            error
        );

        res.status(500).json({
            success: false,
            message:
                "Unable to load members.",
            error:
                error.message
        });
    }
});

app.delete(
    "/api/admin/members/:id",
    async (req, res) => {
        const client = await pool.connect();
        let transactionStarted = false;

        try {
            const memberId = Number(req.params.id);

            if (!Number.isInteger(memberId)) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid member ID."
                });
            }

            await client.query("BEGIN");
            transactionStarted = true;

            const memberResult = await client.query(
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

            const activeAttendance = await client.query(
                `
                SELECT id
                FROM attendance
                WHERE member_id = $1
                  AND check_out IS NULL
                LIMIT 1
                `,
                [memberId]
            );

            if (activeAttendance.rows.length > 0) {
                await client.query("ROLLBACK");
                transactionStarted = false;

                return res.status(400).json({
                    success: false,
                    message:
                        "This member is currently inside the gym. Check out the member before removing the membership."
                });
            }

            const archiveResult = await client.query(
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
                    "Membership removed by admin."
                ]
            );

            await client.query(
                `
                UPDATE attendance
                SET member_id = NULL
                WHERE member_id = $1
                `,
                [memberId]
            );

            const deleteResult = await client.query(
                `
                DELETE FROM members
                WHERE id = $1
                RETURNING
                    id,
                    member_id,
                    user_id
                `,
                [memberId]
            );

            await client.query("COMMIT");
            transactionStarted = false;

            res.json({
                success: true,
                message:
                    "Membership archived and removed successfully.",
                member: deleteResult.rows[0],
                archive: archiveResult.rows[0]
            });
        } catch (error) {
            if (transactionStarted) {
                try {
                    await client.query("ROLLBACK");
                } catch (rollbackError) {
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

            res.status(500).json({
                success: false,
                message:
                    "Unable to archive and remove membership.",
                error: error.message,
                code: error.code || null,
                detail: error.detail || null
            });
        } finally {
            client.release();
        }
    }
);

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
                success: true,
                archivedMembers:
                    result.rows
            });
        } catch (error) {
            console.error(
                "Archived members error:",
                error
            );

            res.status(500).json({
                success: false,
                message:
                    "Unable to load archived members.",
                error:
                    error.message
            });
        }
    }
);

app.post(
    "/api/admin/archived-members/:id/restore",
    async (req, res) => {
        const client = await pool.connect();
        let transactionStarted = false;

        try {
            const archiveId = Number(req.params.id);

            if (
                !Number.isInteger(archiveId) ||
                archiveId <= 0
            ) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid archive ID."
                });
            }

            await client.query("BEGIN");
            transactionStarted = true;

            const archiveResult = await client.query(
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
                [archiveId]
            );

            if (archiveResult.rows.length === 0) {
                await client.query("ROLLBACK");
                transactionStarted = false;

                return res.status(404).json({
                    success: false,
                    message: "Archived membership not found."
                });
            }

            const archived = archiveResult.rows[0];

            if (archived.restored_at) {
                await client.query("ROLLBACK");
                transactionStarted = false;

                return res.status(400).json({
                    success: false,
                    message: "This membership has already been restored."
                });
            }

            const userResult = await client.query(
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
                [archived.user_id]
            );

            if (userResult.rows.length === 0) {
                await client.query("ROLLBACK");
                transactionStarted = false;

                return res.status(404).json({
                    success: false,
                    message: "Customer account no longer exists."
                });
            }

            const existingMemberResult = await client.query(
                `
                SELECT
                    id,
                    member_id,
                    status
                FROM members
                WHERE user_id = $1
                FOR UPDATE
                `,
                [archived.user_id]
            );

            if (existingMemberResult.rows.length > 0) {
                await client.query("ROLLBACK");
                transactionStarted = false;

                return res.status(400).json({
                    success: false,
                    message: "This customer already has a membership."
                });
            }

            let restoredMemberId = archived.member_id;

            const duplicateMemberResult = await client.query(
                `
                SELECT id
                FROM members
                WHERE member_id = $1
                `,
                [restoredMemberId]
            );

            if (duplicateMemberResult.rows.length > 0) {
                restoredMemberId =
                    `GYM-${String(archived.user_id).padStart(6, "0")}-${Date.now()}`;
            }

            const dateResult = await client.query(
                `
                SELECT
                    CASE
                        WHEN expiration_date IS NOT NULL
                             AND expiration_date >= CURRENT_DATE
                        THEN COALESCE(start_date, CURRENT_DATE)
                        ELSE CURRENT_DATE
                    END AS start_date,
                    CASE
                        WHEN expiration_date IS NOT NULL
                             AND expiration_date >= CURRENT_DATE
                        THEN expiration_date
                        ELSE (CURRENT_DATE + INTERVAL '1 month')::date
                    END AS expiration_date
                FROM archived_members
                WHERE archive_id = $1
                `,
                [archiveId]
            );

            const startDate =
                dateResult.rows[0].start_date;

            const expirationDate =
                dateResult.rows[0].expiration_date;

            const newQrCode =
                `ANCHOR-${crypto.randomUUID()}`;

            const memberResult = await client.query(
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
                    archived.registration_type || "ONLINE",
                    archived.membership_plan || "Monthly",
                    startDate,
                    expirationDate,
                    newQrCode
                ]
            );

            await client.query(
                `
                UPDATE archived_members
                SET
                    restored_at = CURRENT_TIMESTAMP,
                    status = 'RESTORED'
                WHERE archive_id = $1
                `,
                [archiveId]
            );

            await client.query("COMMIT");
            transactionStarted = false;

            res.json({
                success: true,
                message: "Membership restored successfully.",
                member: memberResult.rows[0]
            });
        } catch (error) {
            if (transactionStarted) {
                try {
                    await client.query("ROLLBACK");
                } catch (rollbackError) {
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

            res.status(500).json({
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

app.get(
    "/api/admin/transactions",
    async (req, res) => {
        try {
            const result =
                await pool.query(`
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
                `);

            res.json({
                success: true,
                transactions:
                    result.rows
            });
        } catch (error) {
            console.error(
                "Transactions error:",
                error
            );

            res.status(500).json({
                success: false,
                message:
                    "Unable to load transactions.",
                error:
                    error.message
            });
        }
    }
);

app.delete(
    "/api/admin/transactions/:id",
    async (req, res) => {
        try {
            const transactionId =
                Number(req.params.id);

            if (
                !Number.isInteger(
                    transactionId
                )
            ) {
                return res.status(400).json({
                    success: false,
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
                    [transactionId]
                );

            if (
                result.rows.length ===
                0
            ) {
                return res.status(404).json({
                    success: false,
                    message:
                        "Transaction not found."
                });
            }

            res.json({
                success: true,
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

            res.status(500).json({
                success: false,
                message:
                    "Unable to delete transaction.",
                error:
                    error.message
            });
        }
    }
);

app.get(
    "/api/admin/attendance",
    async (req, res) => {
        try {
            const result =
                await pool.query(`
                    SELECT
                        a.id,
                        a.member_id,
                        a.guest_id,
                        a.user_type,
                        a.check_in,
                        a.check_out,
                        CASE
                            WHEN UPPER(a.user_type) = 'MEMBER'
                            THEN u.full_name
                            WHEN UPPER(a.user_type) = 'GUEST'
                            THEN g.full_name
                            ELSE 'Unknown'
                        END AS full_name
                    FROM attendance a
                    LEFT JOIN members m
                        ON m.id = a.member_id
                    LEFT JOIN users u
                        ON u.id = m.user_id
                    LEFT JOIN guests g
                        ON g.id = a.guest_id
                    ORDER BY
                        a.check_in DESC,
                        a.id DESC
                `);

            res.json({
                success: true,
                attendance:
                    result.rows
            });
        } catch (error) {
            console.error(
                "Attendance error:",
                error
            );

            res.status(500).json({
                success: false,
                message:
                    "Unable to load attendance.",
                error:
                    error.message
            });
        }
    }
);

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
                return res.status(400).json({
                    success: false,
                    message:
                        "QR code is required."
                });
            }

            await client.query("BEGIN");
            transactionStarted = true;

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
                    [qrCode]
                );

            if (
                memberResult.rows.length ===
                0
            ) {
                await client.query("ROLLBACK");
                transactionStarted = false;

                return res.status(404).json({
                    success: false,
                    message:
                        "QR code does not belong to a gym member."
                });
            }

            const member =
                memberResult.rows[0];

            const status =
                String(
                    member.status || ""
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
                    ? new Date(expiration)
                    : null;

            if (expirationEnd) {
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
                expirationEnd < new Date()
            ) {
                await client.query(
                    `
                    UPDATE members
                    SET status = 'EXPIRED'
                    WHERE id = $1
                    `,
                    [member.id]
                );

                await client.query("COMMIT");
                transactionStarted = false;

                return res.status(400).json({
                    success: false,
                    message:
                        "This membership has expired."
                });
            }

            if (status !== "ACTIVE") {
                await client.query("ROLLBACK");
                transactionStarted = false;

                return res.status(400).json({
                    success: false,
                    message:
                        "This member does not have an active membership."
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
                    [member.id]
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
                        SET check_out = CURRENT_TIMESTAMP
                        WHERE id = $1
                        RETURNING
                            id,
                            member_id,
                            guest_id,
                            user_type,
                            check_in,
                            check_out
                        `,
                        [activeAttendance.id]
                    );

                attendance =
                    checkoutResult.rows[0];

                action = "CHECKED_OUT";
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
                        [member.id]
                    );

                attendance =
                    checkinResult.rows[0];

                action = "CHECKED_IN";
            }

            const occupancyResult =
                await client.query(`
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
                `);

            const membersInside =
                Number(
                    occupancyResult.rows[0]
                        .members_inside || 0
                );

            const guestsInside =
                Number(
                    occupancyResult.rows[0]
                        .guests_inside || 0
                );

            const occupancy =
                membersInside +
                guestsInside;

            await client.query("COMMIT");
            transactionStarted = false;

            res.json({
                success: true,
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
                capacity: 120
            });
        } catch (error) {
            if (transactionStarted) {
                try {
                    await client.query("ROLLBACK");
                } catch (rollbackError) {
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

            res.status(500).json({
                success: false,
                message:
                    "Unable to process QR scan.",
                error:
                    error.message,
                code:
                    error.code || null,
                detail:
                    error.detail || null
            });
        } finally {
            client.release();
        }
    }
);

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
                amount_paid,
                payment_method
            } = req.body;

            if (
                !full_name ||
                !String(full_name).trim()
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Guest name is required."
                });
            }

            const amount =
                Number(amount_paid || 0);

            if (
                Number.isNaN(amount) ||
                amount < 0
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Invalid amount paid."
                });
            }

            await client.query("BEGIN");
            transactionStarted = true;

            const guestResult =
                await client.query(
                    `
                    INSERT INTO guests
                    (
                        full_name,
                        phone,
                        visit_type,
                        amount_paid,
                        payment_method
                    )
                    VALUES
                    (
                        $1,
                        $2,
                        $3,
                        $4,
                        $5
                    )
                    RETURNING
                        id,
                        full_name,
                        phone,
                        visit_type,
                        amount_paid,
                        payment_method,
                        created_at
                    `,
                    [
                        String(
                            full_name
                        ).trim(),
                        String(
                            phone || ""
                        ).trim(),
                        String(
                            visit_type ||
                            "GUEST"
                        ).trim(),
                        amount,
                        String(
                            payment_method ||
                            ""
                        ).trim()
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
                    [guest.id]
                );

            await client.query("COMMIT");
            transactionStarted = false;

            res.status(201).json({
                success: true,
                message:
                    "Guest recorded and checked in.",
                guest,
                attendance:
                    attendanceResult.rows[0]
            });
        } catch (error) {
            if (transactionStarted) {
                try {
                    await client.query("ROLLBACK");
                } catch (rollbackError) {
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

            res.status(500).json({
                success: false,
                message:
                    "Unable to record guest.",
                error:
                    error.message,
                code:
                    error.code || null,
                detail:
                    error.detail || null
            });
        } finally {
            client.release();
        }
    }
);

app.patch(
    "/api/admin/attendance/:id/checkout",
    async (req, res) => {
        try {
            const attendanceId =
                Number(req.params.id);

            if (
                !Number.isInteger(
                    attendanceId
                )
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Invalid attendance ID."
                });
            }

            const result =
                await pool.query(
                    `
                    UPDATE attendance
                    SET check_out = CURRENT_TIMESTAMP
                    WHERE id = $1
                      AND check_out IS NULL
                    RETURNING
                        id,
                        member_id,
                        guest_id,
                        user_type,
                        check_in,
                        check_out
                    `,
                    [attendanceId]
                );

            if (
                result.rows.length ===
                0
            ) {
                return res.status(404).json({
                    success: false,
                    message:
                        "Active attendance record not found."
                });
            }

            res.json({
                success: true,
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

            res.status(500).json({
                success: false,
                message:
                    "Unable to check out.",
                error:
                    error.message
            });
        }
    }
);

app.get(
    "/api/admin/reports",
    async (req, res) => {
        try {
            const totalVisitsResult =
                await pool.query(`
                    SELECT COUNT(*)::int AS total_visits
                    FROM attendance
                `);

            const memberVisitsResult =
                await pool.query(`
                    SELECT COUNT(*)::int AS member_visits
                    FROM attendance
                    WHERE UPPER(user_type) = 'MEMBER'
                `);

            const guestVisitsResult =
                await pool.query(`
                    SELECT COUNT(*)::int AS guest_visits
                    FROM attendance
                    WHERE UPPER(user_type) = 'GUEST'
                `);

            const dailyResult =
                await pool.query(`
                    SELECT
                        EXTRACT(HOUR FROM check_in)::int AS hour,
                        COUNT(*)::int AS visits
                    FROM attendance
                    WHERE check_in::date = CURRENT_DATE
                    GROUP BY EXTRACT(HOUR FROM check_in)
                    ORDER BY hour
                `);

            res.json({
                success: true,
                totalVisits:
                    totalVisitsResult.rows[0]
                        .total_visits || 0,
                memberVisits:
                    memberVisitsResult.rows[0]
                        .member_visits || 0,
                guestVisits:
                    guestVisitsResult.rows[0]
                        .guest_visits || 0,
                hourly:
                    dailyResult.rows
            });
        } catch (error) {
            console.error(
                "Reports error:",
                error
            );

            res.status(500).json({
                success: false,
                message:
                    "Unable to load reports.",
                error:
                    error.message
            });
        }
    }
);

app.get(
    "/api/admin/equipment",
    async (req, res) => {
        try {
            res.json({
                success: true,
                equipment: []
            });
        } catch (error) {
            console.error(
                "Equipment error:",
                error
            );

            res.status(500).json({
                success: false,
                message:
                    "Unable to load equipment.",
                error:
                    error.message
            });
        }
    }
);

app.use(
    "/api",
    (req, res) => {
        res.status(404).json({
            success: false,
            message: "API route not found.",
            path: req.originalUrl
        });
    }
);

app.listen(PORT, "0.0.0.0", () => {
    console.log(
        `ANCHOR server running on port ${PORT}`
    );
});