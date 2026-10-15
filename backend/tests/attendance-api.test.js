const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { after, before, test } = require("node:test");
require("dotenv").config();

const { Pool } = require("pg");
const bcrypt = require("bcrypt");

const databaseUrl =
    process.env.TEST_DATABASE_URL ||
    process.env.DATABASE_URL;
const integrationEnabled = Boolean(databaseUrl);
const quoteIdentifier = value =>
    `"${String(value).replace(/"/g, '""')}"`;
const projectRoot = path.resolve(__dirname, "../..");

let sourcePool;
let application;
let pool;
let httpServer;
let baseUrl;
let adminToken;
let activeMemberId;
let pendingMemberId;
let revokedMemberId;
let expiredMemberId;
let archivedRecordId;
let archivedExpectedExpiration;
let activeUserId;
let testSchema;
let memberTransactionSeeded = false;

test("admin UI exposes the required application, dashboard, report, attendance, and transaction rules", () => {
    const adminHtml = fs.readFileSync(
        path.join(projectRoot, "frontend", "admin.html"),
        "utf8"
    );
    const loginHtml = fs.readFileSync(
        path.join(projectRoot, "frontend", "admin-login.html"),
        "utf8"
    );
    const adminCss = fs.readFileSync(
        path.join(projectRoot, "frontend", "admin.css"),
        "utf8"
    );
    const portalTheme = fs.readFileSync(
        path.join(projectRoot, "frontend", "portal-theme.css"),
        "utf8"
    );
    const adminJs = fs.readFileSync(
        path.join(projectRoot, "frontend", "admin.js"),
        "utf8"
    );
    const backendServer = fs.readFileSync(
        path.join(projectRoot, "backend", "server.js"),
        "utf8"
    );
    const transactionPage = adminHtml.match(
        /<section\s+id="transactions"[\s\S]*?<\/section>/
    )?.[0] || "";
    const reportPage = adminHtml.match(
        /<section\s+id="reports"[\s\S]*?<\/section>/
    )?.[0] || "";
    const reportSummary = reportPage.match(
        /<div class="attendance-stats report-stats">([\s\S]*?)<div class="card report">/
    )?.[1] || "";
    const membershipChart = adminHtml.match(
        /<div class="legend">[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/
    )?.[0] || "";

    assert.match(loginHtml, /id="adminEmail"[\s\S]*?value="admin@gmail\.com"/);
    assert.match(loginHtml, /id="adminPassword"[\s\S]*?value="admin123"/);
    assert.match(adminJs, /class="approve"/);
    assert.match(adminJs, /class="reject"/);
    assert.match(membershipChart, /dashboardActiveLegend/);
    assert.match(membershipChart, /dashboardPendingLegend/);
    assert.match(membershipChart, /dashboardRevokedLegend/);
    assert.doesNotMatch(membershipChart, /Expired/);
    assert.equal((reportSummary.match(/class="card"/g) || []).length, 4);
    assert.match(reportPage, /Visits by Hour/);
    assert.match(adminHtml, /id="attendanceMembersTableBody"/);
    assert.match(adminHtml, /applications-table-scroll/);
    assert.match(adminHtml, /attendanceMemberSearch/);
    assert.match(adminHtml, /value="inside">Inside Gym/);
    assert.match(adminHtml, /value="not-inside">Not Checked In/);
    assert.match(adminHtml, /class="chart-scroll"/);
    assert.match(adminHtml, /class="table-scroll report-table-scroll"/);
    assert.match(adminHtml, /class="table-scroll attendance-table-scroll"/);
    assert.match(adminHtml, /class="table-scroll attendance-members-table-scroll"/);
    assert.doesNotMatch(transactionPage, /<th[^>]*>\s*Action\s*<\/th>/i);
    assert.doesNotMatch(transactionPage, /\b(?:View|View Proof|View Details|Delete)\b/i);
    assert.doesNotMatch(
        adminJs.match(/async function loadTransactions[\s\S]*?\/\/ ATTENDANCE/)?.[0] || "",
        /<button|View Visit|openAttendanceVisit/
    );
    assert.match(adminJs, /attendanceMembersPageSize = 25/);
    assert.match(adminJs, /data\.membershipStatusCounts\?\.pending/);
    assert.match(adminJs, /async function viewScreenshot/);
    assert.match(adminJs, /headers: token\s*\?/);
    assert.match(backendServer, /\/api\/admin\/applications\/' \|\| a\.id \|\| '\/screenshot/);
    assert.match(portalTheme, /\.chart-scroll\s*\{[^}]*overflow-x:\s*auto/s);
    assert.match(adminCss, /\.attendance-table-scroll,\s*\.report-table-scroll,\s*\.attendance-members-table-scroll,\s*\.applications-table-scroll\s*\{[^}]*max-height:[^}]*overflow-y:\s*auto/s);
    assert.match(portalTheme, /html\[data-portal="admin"\]\s+\.approve[\s\S]*?#16A34A/);
    assert.match(portalTheme, /html\[data-portal="admin"\]\s+\.reject[\s\S]*?#DC2626/);
    assert.match(adminJs, /for \(let value = axisMaximum; value >= 0; value -= step\)/);
    assert.match(portalTheme, /\.status\.active\s*\{[^}]*#16A34A/s);
    assert.match(portalTheme, /\.status\.pending\s*\{[^}]*#EAB308/s);
    assert.match(portalTheme, /\.status\.revoked\s*\{[^}]*#DC2626/s);
});

if (!integrationEnabled) {
    test("PostgreSQL API suite requires DATABASE_URL or TEST_DATABASE_URL", {
        skip: "No PostgreSQL connection string is configured."
    }, () => {});
} else {
    before(async () => {
        sourcePool = new Pool({
            connectionString: databaseUrl,
            options: "-c timezone=Asia/Manila -c search_path=public",
            connectionTimeoutMillis: 10000,
            query_timeout: 15000
        });

        testSchema =
            `anchor_test_${process.pid}_${crypto.randomBytes(4).toString("hex")}`;
        await sourcePool.query(
            `CREATE SCHEMA ${quoteIdentifier(testSchema)}`
        );

        const sourceTables = await sourcePool.query(
            `
            SELECT table_name
            FROM information_schema.tables
            WHERE table_schema = 'public'
              AND table_type = 'BASE TABLE'
            `
        );
        const availableTables = new Set(
            sourceTables.rows.map(row => row.table_name)
        );
        const requiredTables = [
            "users",
            "members",
            "attendance",
            "guests",
            "applications",
            "archived_members",
            "notifications"
        ];
        const transactionTable = availableTables.has("member_transactions")
            ? "member_transactions"
            : availableTables.has("transactions")
                ? "transactions"
                : null;
        if (transactionTable) {
            requiredTables.push(transactionTable);
        }
        const missingTables =
            [
                ...requiredTables.filter(name => !availableTables.has(name)),
                ...(!transactionTable ? ["transactions or member_transactions"] : [])
            ];
        if (missingTables.length) {
            throw new Error(
                `PostgreSQL integration tests require public tables: ${missingTables.join(", ")}`
            );
        }

        for (const table of requiredTables) {
            await sourcePool.query(
                `CREATE TABLE ${quoteIdentifier(testSchema)}.${quoteIdentifier(table)} ` +
                `(LIKE public.${quoteIdentifier(table)} INCLUDING ALL)`
            );
        }

        const serialColumns = await sourcePool.query(
            `
            SELECT table_name, column_name
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND column_default LIKE 'nextval(%'
              AND table_name = ANY($1::text[])
            `,
            [requiredTables]
        );
        for (const { table_name: table, column_name: column } of serialColumns.rows) {
            const sequence = `${table}_${column}_test_seq`;
            await sourcePool.query(
                `CREATE SEQUENCE ${quoteIdentifier(testSchema)}.${quoteIdentifier(sequence)}`
            );
            await sourcePool.query(
                `ALTER TABLE ${quoteIdentifier(testSchema)}.${quoteIdentifier(table)} ` +
                `ALTER COLUMN ${quoteIdentifier(column)} SET DEFAULT ` +
                `nextval('${testSchema}.${sequence}'::regclass)`
            );
            await sourcePool.query(
                `ALTER SEQUENCE ${quoteIdentifier(testSchema)}.${quoteIdentifier(sequence)} ` +
                `OWNED BY ${quoteIdentifier(testSchema)}.${quoteIdentifier(table)}.${quoteIdentifier(column)}`
            );
        }

        process.env.DATABASE_SCHEMA = testSchema;
        application = require("../server");
        pool = application.pool;
        await application.ensureDashboardSchema();

        const passwordHash = await bcrypt.hash("integration-test-only", 4);
        const admin = await pool.query(
            `
            INSERT INTO users (id, full_name, email, password, phone, role)
            VALUES (980001, 'Integration Admin', 'integration-admin@example.invalid', $1, '09111110001', 'admin')
            RETURNING id
            `,
            [passwordHash]
        );
        activeUserId = 980002;
        await pool.query(
            `
            INSERT INTO users (id, full_name, email, password, phone, role)
            VALUES
                ($1, 'Test Member', 'test-member@example.invalid', $2, '09111110002', 'customer'),
                (980003, 'Pending Member', 'pending-member@example.invalid', $2, '09111110003', 'customer'),
                (980004, 'Revoked Member', 'revoked-member@example.invalid', $2, '09111110004', 'customer'),
                (980005, 'Expired Member', 'expired-member@example.invalid', $2, '09111110005', 'customer'),
                (980006, 'Archived Member', 'archived-member@example.invalid', $2, '09111110006', 'customer'),
                (980007, 'Integration Staff', 'integration-staff@example.invalid', $2, '09111110007', 'staff')
            `,
            [activeUserId, passwordHash]
        );

        const activeMember = await pool.query(
            `
            INSERT INTO members
                (user_id, member_id, registration_type, membership_plan, start_date, expiration_date, status, qr_code)
            VALUES ($1, 'TEST-ACTIVE-001', 'ONLINE', 'Monthly', CURRENT_DATE, CURRENT_DATE + 30, 'ACTIVE', 'TEST-QR-ACTIVE')
            RETURNING id
            `,
            [activeUserId]
        );
        activeMemberId = activeMember.rows[0].id;

        const pendingMember = await pool.query(
            `
            INSERT INTO members
                (user_id, member_id, registration_type, membership_plan, start_date, expiration_date, status, qr_code)
            VALUES (980003, 'TEST-PENDING-001', 'ONLINE', 'Monthly', CURRENT_DATE, CURRENT_DATE + 30, 'PENDING', 'TEST-QR-PENDING')
            RETURNING id
            `
        );
        pendingMemberId = pendingMember.rows[0].id;

        const revokedMember = await pool.query(
            `
            INSERT INTO members
                (user_id, member_id, registration_type, membership_plan, start_date, expiration_date, status, qr_code)
            VALUES (980004, 'TEST-REVOKED-001', 'ONLINE', 'Monthly', CURRENT_DATE, CURRENT_DATE + 30, 'REVOKED', 'TEST-QR-REVOKED')
            RETURNING id
            `
        );
        revokedMemberId = revokedMember.rows[0].id;

        const expiredMember = await pool.query(
            `
            INSERT INTO members
                (user_id, member_id, registration_type, membership_plan, start_date, expiration_date, status, qr_code)
            VALUES (980005, 'TEST-EXPIRED-001', 'ONLINE', 'Monthly', CURRENT_DATE - 30, CURRENT_DATE - 1, 'ACTIVE', 'TEST-QR-EXPIRED')
            RETURNING id
            `
        );
        expiredMemberId = expiredMember.rows[0].id;

        const archiveExpiry = await pool.query(
            "SELECT (CURRENT_DATE + 20)::text AS expiration_date"
        );
        archivedExpectedExpiration = archiveExpiry.rows[0].expiration_date;
        const archive = await pool.query(
            `
            INSERT INTO archived_members
                (original_member_id, user_id, member_id, full_name, email, registration_type,
                 membership_plan, start_date, expiration_date, status, archived_at, removal_reason)
            VALUES
                (991234, 980006, 'TEST-ARCHIVED-001', 'Archived Member',
                 'archived-member@example.invalid', 'ONLINE', 'Monthly',
                 CURRENT_DATE - 10, CURRENT_DATE + 20, 'REVOKED',
                 CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila', 'Integration test')
            RETURNING archive_id
            `
        );
        archivedRecordId = archive.rows[0].archive_id;

        httpServer = application.app.listen(0, "127.0.0.1");
        await new Promise((resolve, reject) => {
            httpServer.once("listening", resolve);
            httpServer.once("error", reject);
        });
        baseUrl = `http://127.0.0.1:${httpServer.address().port}`;

        const login = await fetch(`${baseUrl}/api/admin/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                email: "integration-admin@example.invalid",
                password: "integration-test-only"
            })
        });
        const loginBody = await login.json();
        assert.equal(login.status, 200, loginBody.message);
        adminToken = loginBody.token;
        assert.ok(adminToken);
        assert.equal(Number(loginBody.user.id), Number(admin.rows[0].id));
    });

    after(async () => {
        if (httpServer) {
            await new Promise(resolve => httpServer.close(resolve));
        }
        if (pool) {
            await pool.end();
        }
        if (sourcePool) {
            if (testSchema) {
                await sourcePool.query(
                    `DROP SCHEMA IF EXISTS ${quoteIdentifier(testSchema)} CASCADE`
                );
            }
            await sourcePool.end();
        }
    });

    async function api(path, options = {}) {
        const response = await fetch(`${baseUrl}${path}`, {
            ...options,
            headers: {
                Authorization: `Bearer ${adminToken}`,
                ...(options.body ? { "Content-Type": "application/json" } : {}),
                ...(options.headers || {})
            }
        });
        return {
            response,
            body: await response.json()
        };
    }

    async function createGuest({
        key,
        name = "Test Walk-In",
        phone = "09222220001",
        visitType = "GUEST",
        hours = 1,
        paymentMethod = "CASH",
        paymentReference = null,
        paymentConfirmed = true
    }) {
        return api("/api/admin/guests", {
            method: "POST",
            body: JSON.stringify({
                full_name: name,
                phone,
                visit_type: visitType,
                hours: visitType === "DAY PASS" ? null : hours,
                amount_paid: visitType === "DAY PASS" ? 100 : hours * 30,
                payment_method: paymentMethod,
                payment_reference: paymentReference,
                payment_confirmed: paymentConfirmed,
                idempotency_key: key
            })
        });
    }

    test("hard-coded admin credentials authenticate without an existing admin database row", async () => {
        const login = await fetch(`${baseUrl}/api/admin/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                email: "admin@gmail.com",
                password: "admin123"
            })
        });
        const result = await login.json();
        assert.equal(login.status, 200, result.message);
        assert.equal(result.user.email, "admin@gmail.com");
        assert.equal(result.user.role, "admin");

        const storedAccount = await pool.query(
            `
            SELECT password, role
            FROM users
            WHERE LOWER(email) = 'admin@gmail.com'
            `
        );
        assert.equal(storedAccount.rows.length, 1);
        assert.equal(storedAccount.rows[0].role, "admin");
        assert.notEqual(storedAccount.rows[0].password, "admin123");
        assert.match(storedAccount.rows[0].password, /^\$2[aby]\$/);

        const authorized = await fetch(`${baseUrl}/api/admin/attendance`, {
            headers: { Authorization: `Bearer ${result.token}` }
        });
        assert.equal(authorized.status, 200);

        await fetch(`${baseUrl}/api/admin/logout`, {
            method: "POST",
            headers: { Authorization: `Bearer ${result.token}` }
        });
    });

    test("admin APIs require a valid session and sensitive membership actions require an administrator", async () => {
        const unauthenticated = await fetch(
            `${baseUrl}/api/admin/attendance`
        );
        assert.equal(unauthenticated.status, 401);

        const staffLogin = await fetch(`${baseUrl}/api/admin/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                email: "integration-staff@example.invalid",
                password: "integration-test-only"
            })
        });
        const staffSession = await staffLogin.json();
        assert.equal(staffLogin.status, 200, staffSession.message);

        const staffAttempt = await fetch(
            `${baseUrl}/api/admin/members/${activeMemberId}/revoke`,
            {
                method: "PATCH",
                headers: {
                    Authorization: `Bearer ${staffSession.token}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({ reason: "Authorization test" })
            }
        );
        assert.equal(staffAttempt.status, 403);

        const unchanged = await pool.query(
            "SELECT status FROM members WHERE id = $1",
            [activeMemberId]
        );
        assert.equal(unchanged.rows[0].status, "ACTIVE");
    });

    test("manual check-in, visit-specific checkout, repeat visits, and no fake member payment", async () => {
        const firstCheckIn = await api("/api/admin/attendance/manual", {
            method: "POST",
            body: JSON.stringify({
                action: "CHECK_IN",
                member_record_id: activeMemberId
            })
        });
        assert.equal(firstCheckIn.response.status, 200, firstCheckIn.body.message);
        assert.equal(firstCheckIn.body.attendance.check_out, null);

        const duplicateOpen = await api("/api/admin/attendance/manual", {
            method: "POST",
            body: JSON.stringify({
                action: "CHECK_IN",
                member_record_id: activeMemberId
            })
        });
        assert.equal(duplicateOpen.response.status, 409);

        const checkout = await api(
            `/api/admin/attendance/${firstCheckIn.body.attendance.id}/checkout`,
            { method: "PATCH", body: JSON.stringify({}) }
        );
        assert.equal(checkout.response.status, 200, checkout.body.message);
        assert.ok(checkout.body.attendance.check_out);

        const secondCheckIn = await api("/api/admin/attendance/manual", {
            method: "POST",
            body: JSON.stringify({
                action: "CHECK_IN",
                member_record_id: activeMemberId
            })
        });
        assert.equal(secondCheckIn.response.status, 200, secondCheckIn.body.message);
        assert.notEqual(
            Number(secondCheckIn.body.attendance.id),
            Number(firstCheckIn.body.attendance.id)
        );

        const firstVisitAgain = await api("/api/admin/attendance/manual", {
            method: "POST",
            body: JSON.stringify({
                action: "CHECK_OUT",
                attendance_id: firstCheckIn.body.attendance.id
            })
        });
        assert.equal(firstVisitAgain.response.status, 404);

        const secondCheckout = await api(
            `/api/admin/attendance/${secondCheckIn.body.attendance.id}/checkout`,
            { method: "PATCH", body: JSON.stringify({}) }
        );
        assert.equal(secondCheckout.response.status, 200, secondCheckout.body.message);

        const history = await pool.query(
            `
            SELECT id, check_in, check_out
            FROM attendance
            WHERE member_id = $1
            ORDER BY id
            `,
            [activeMemberId]
        );
        assert.equal(history.rows.length, 2);
        assert.ok(history.rows.every(row => row.check_in && row.check_out));

        const financialRecords = await pool.query(
            "SELECT COUNT(*)::int AS count FROM member_transactions"
        );
        assert.equal(financialRecords.rows[0].count, 0);
    });

    test("membership eligibility and archived restoration preserve revoked status and dates", async () => {
        for (const memberId of [
            pendingMemberId,
            revokedMemberId,
            expiredMemberId
        ]) {
            const result = await api("/api/admin/attendance/manual", {
                method: "POST",
                body: JSON.stringify({
                    action: "CHECK_IN",
                    member_record_id: memberId
                })
            });
            assert.equal(result.response.status, 400);
        }

        const restored = await api(
            `/api/admin/archived-members/${archivedRecordId}/restore`,
            { method: "POST", body: JSON.stringify({}) }
        );
        assert.equal(restored.response.status, 200, restored.body.message);
        assert.equal(restored.body.member.status, "REVOKED");

        const restoredDates = await pool.query(
            `
            SELECT status, start_date, expiration_date::text AS expiration_date, archived_at
            FROM members
            WHERE user_id = 980006
            `
        );
        assert.equal(restoredDates.rows.length, 1);
        assert.equal(restoredDates.rows[0].status, "REVOKED");
        assert.equal(
            restoredDates.rows[0].expiration_date,
            archivedExpectedExpiration
        );
        assert.equal(restoredDates.rows[0].archived_at, null);
    });

    test("guest payment confirmation, GCash references, repeat visits, and idempotency", async () => {
        const unpaid = await createGuest({
            key: "suite-unpaid-guest",
            paymentConfirmed: false
        });
        assert.equal(unpaid.response.status, 402);

        const entry = {
            key: "suite-repeat-guest-1",
            phone: "09222220002",
            name: "Repeat Guest"
        };
        const concurrentAttempts = await Promise.all([
            createGuest(entry),
            createGuest(entry)
        ]);
        assert.equal(
            concurrentAttempts.filter(item => item.response.status === 201).length,
            1
        );
        assert.equal(
            concurrentAttempts.filter(item => item.body.duplicate === true).length,
            1
        );

        const repeatVisit = await createGuest({
            ...entry,
            key: "suite-repeat-guest-2"
        });
        assert.equal(repeatVisit.response.status, 201, repeatVisit.body.message);
        assert.notEqual(
            Number(repeatVisit.body.attendance.id),
            Number(concurrentAttempts.find(item => item.response.status === 201).body.attendance.id)
        );
        await pool.query(
            `
            UPDATE guests
            SET phone = '+63' || SUBSTRING(phone FROM 2)
            WHERE id = $1
            `,
            [repeatVisit.body.guest.id]
        );

        const duplicateGcashReference = await createGuest({
            key: "suite-gcash-1",
            phone: "09222220003",
            paymentMethod: "GCASH",
            paymentReference: "ANCHORGCASH-TEST-001"
        });
        assert.equal(duplicateGcashReference.response.status, 201);

        const reusedGcashReference = await createGuest({
            key: "suite-gcash-2",
            phone: "09222220004",
            paymentMethod: "GCASH",
            paymentReference: "ANCHORGCASH-TEST-001"
        });
        assert.equal(reusedGcashReference.response.status, 409);

        const guestCounts = await pool.query(
            "SELECT COUNT(*)::int AS count FROM guests"
        );
        assert.equal(guestCounts.rows[0].count, 3);

        const occupancy = await api("/api/admin/attendance");
        assert.equal(occupancy.response.status, 200);
        assert.ok(occupancy.body.duplicateOpenPeople >= 1);
        const distinctOpenPeople = await pool.query(
            `
            SELECT COUNT(DISTINCT CASE
                WHEN UPPER(a.user_type) = 'MEMBER' THEN
                    COALESCE(
                        CASE
                            WHEN regexp_replace(u.phone, '[^0-9]', '', 'g') LIKE '63%'
                            THEN '0' || SUBSTRING(regexp_replace(u.phone, '[^0-9]', '', 'g') FROM 3)
                            ELSE NULLIF(regexp_replace(u.phone, '[^0-9]', '', 'g'), '')
                        END,
                        'member-user:' || m.user_id::text
                    )
                WHEN UPPER(a.user_type) = 'GUEST' THEN
                    COALESCE(
                        CASE
                            WHEN regexp_replace(g.phone, '[^0-9]', '', 'g') LIKE '63%'
                            THEN '0' || SUBSTRING(regexp_replace(g.phone, '[^0-9]', '', 'g') FROM 3)
                            ELSE NULLIF(regexp_replace(g.phone, '[^0-9]', '', 'g'), '')
                        END,
                        'guest-id:' || a.guest_id::text
                    )
            END)::int AS count
            FROM attendance a
            LEFT JOIN members m ON m.id = a.member_id
            LEFT JOIN users u ON u.id = m.user_id
            LEFT JOIN guests g ON g.id = a.guest_id
            WHERE a.check_out IS NULL
            `
        );
        assert.equal(
            occupancy.body.currentOccupancy,
            distinctOpenPeople.rows[0].count
        );
        assert.equal(
            occupancy.body.currentOccupancy,
            occupancy.body.membersInside + occupancy.body.guestsInside
        );
    });

    test("extension pricing, failed payment, duplicate submission, all-day balance, timeout, and checkout", async () => {
        const firstGuest = await createGuest({
            key: "suite-extension-entry",
            phone: "09222220005",
            name: "Extension Guest"
        });
        assert.equal(firstGuest.response.status, 201, firstGuest.body.message);
        const attendanceId = firstGuest.body.attendance.id;

        const quote = await api(
            `/api/admin/attendance/${attendanceId}/extension-quote`
        );
        assert.equal(quote.response.status, 200, quote.body.message);
        assert.deepEqual(
            quote.body.options.map(option => Number(option.price)),
            [30, 60, 90, 100]
        );

        const failedPayment = await api(
            `/api/admin/attendance/${attendanceId}/extend`,
            {
                method: "POST",
                body: JSON.stringify({
                    extension_type: "EXTRA_HOURS",
                    additional_hours: 1,
                    payment_method: "CASH",
                    payment_confirmed: false,
                    idempotency_key: "suite-failed-extension"
                })
            }
        );
        assert.equal(failedPayment.response.status, 402);
        const unchangedExpiration = await pool.query(
            "SELECT expiration_time FROM attendance WHERE id = $1",
            [attendanceId]
        );
        assert.equal(unchangedExpiration.rows[0].expiration_time, null);
        const initialTransactionCount = await pool.query(
            "SELECT COUNT(*)::int AS count FROM guest_transactions WHERE attendance_id = $1",
            [attendanceId]
        );
        assert.equal(initialTransactionCount.rows[0].count, 1);

        for (const [hours, amount] of [[1, 30], [2, 60], [3, 90]]) {
            const result = await api(
                `/api/admin/attendance/${attendanceId}/extend`,
                {
                    method: "POST",
                    body: JSON.stringify({
                        extension_type: "EXTRA_HOURS",
                        additional_hours: hours,
                        amount: 0.01,
                        payment_method: "CASH",
                        payment_confirmed: true,
                        idempotency_key: `suite-extension-${hours}`
                    })
                }
            );
            assert.equal(result.response.status, 200, result.body.message);
            assert.equal(Number(result.body.amount), amount);

            if (hours === 1) {
                const duplicate = await api(
                    `/api/admin/attendance/${attendanceId}/extend`,
                    {
                        method: "POST",
                        body: JSON.stringify({
                            extension_type: "EXTRA_HOURS",
                            additional_hours: hours,
                            payment_method: "CASH",
                            payment_confirmed: true,
                            idempotency_key: "suite-extension-1"
                        })
                    }
                );
                assert.equal(duplicate.response.status, 200);
                assert.equal(duplicate.body.duplicate, true);
            }
        }

        const gcashExtension = await api(
            `/api/admin/attendance/${attendanceId}/extend`,
            {
                method: "POST",
                body: JSON.stringify({
                    extension_type: "EXTRA_HOURS",
                    additional_hours: 1,
                    amount: 0.01,
                    payment_method: "GCASH",
                    payment_reference: "ANCHOR-EXT-GCASH-001",
                    payment_confirmed: true,
                    idempotency_key: "suite-gcash-extension"
                })
            }
        );
        assert.equal(gcashExtension.response.status, 200, gcashExtension.body.message);
        assert.equal(Number(gcashExtension.body.amount), 30);

        const allDayGuest = await createGuest({
            key: "suite-all-day-entry",
            phone: "09222220006",
            name: "All-Day Guest"
        });
        assert.equal(allDayGuest.response.status, 201);
        const allDayQuote = await api(
            `/api/admin/attendance/${allDayGuest.body.attendance.id}/extension-quote`
        );
        assert.equal(allDayQuote.response.status, 200);
        assert.equal(
            Number(allDayQuote.body.options.find(
                option => option.extension_type === "ALL_DAY"
            ).remaining_balance),
            70
        );

        const allDay = await api(
            `/api/admin/attendance/${allDayGuest.body.attendance.id}/extend`,
            {
                method: "POST",
                body: JSON.stringify({
                    extension_type: "ALL_DAY",
                    additional_hours: null,
                    payment_method: "CASH",
                    payment_confirmed: true,
                    idempotency_key: "suite-all-day-upgrade"
                })
            }
        );
        assert.equal(allDay.response.status, 200, allDay.body.message);
        assert.equal(Number(allDay.body.amount), 70);
        const expectedAllDayExpiration = Math.max(
            new Date(allDayQuote.body.current_expiration).getTime(),
            new Date(allDayQuote.body.closing_time).getTime()
        );
        assert.equal(
            new Date(allDay.body.new_expiration).getTime(),
            expectedAllDayExpiration
        );
        const allDayExtension = await pool.query(
            `
            SELECT additional_hours
            FROM guest_visit_extensions
            WHERE attendance_id = $1
              AND extension_type = 'ALL_DAY'
            `,
            [allDayGuest.body.attendance.id]
        );
        assert.equal(allDayExtension.rows[0].additional_hours, null);

        const expiredGuest = await createGuest({
            key: "suite-expired-entry",
            phone: "09222220007",
            name: "Expired Guest"
        });
        assert.equal(expiredGuest.response.status, 201);
        await pool.query(
            `
            UPDATE attendance
            SET expiration_time = CURRENT_TIMESTAMP - INTERVAL '1 hour'
            WHERE id = $1
            `,
            [expiredGuest.body.attendance.id]
        );

        const expiredResult = await api(
            `/api/admin/attendance/${expiredGuest.body.attendance.id}/extend`,
            {
                method: "POST",
                body: JSON.stringify({
                    extension_type: "EXTRA_HOURS",
                    additional_hours: 1,
                    payment_method: "CASH",
                    payment_confirmed: true,
                    idempotency_key: "suite-expired-extension"
                })
            }
        );
        assert.equal(expiredResult.response.status, 200, expiredResult.body.message);
        assert.ok(new Date(expiredResult.body.new_expiration).getTime() > Date.now());

        const occupancyBeforeExpiry = await api("/api/admin/attendance");
        const guestCheckout = await api(
            `/api/admin/attendance/${expiredGuest.body.attendance.id}/checkout`,
            { method: "PATCH", body: JSON.stringify({}) }
        );
        assert.equal(guestCheckout.response.status, 404);

        const expirationState = await pool.query(
            `
            SELECT check_in, check_out, expiration_time
            FROM attendance
            WHERE id = $1
            `,
            [expiredGuest.body.attendance.id]
        );
        assert.ok(expirationState.rows[0].check_in);
        assert.equal(expirationState.rows[0].check_out, null);
        assert.ok(expirationState.rows[0].expiration_time);
        await pool.query(
            `
            UPDATE attendance
            SET expiration_time = CURRENT_TIMESTAMP - INTERVAL '1 hour'
            WHERE id = $1
            `,
            [expiredGuest.body.attendance.id]
        );
        const occupancyAfterExpiry = await api("/api/admin/attendance");
        assert.equal(
            occupancyAfterExpiry.body.currentOccupancy,
            occupancyBeforeExpiry.body.currentOccupancy - 1
        );
    });

    test("attendance filters, date reports, unique visitors, and transaction filters use persisted records", async () => {
        const memberFilter = await api("/api/admin/attendance?type=member");
        const guestFilter = await api("/api/admin/attendance?type=guest");
        const allAttendance = await api("/api/admin/attendance?type=all");
        assert.equal(memberFilter.response.status, 200);
        assert.equal(guestFilter.response.status, 200);
        assert.equal(
            allAttendance.body.attendance.length,
            memberFilter.body.attendance.length +
                guestFilter.body.attendance.length
        );
        assert.ok(memberFilter.body.attendance.every(
            record => record.user_type === "MEMBER"
        ));
        assert.ok(guestFilter.body.attendance.every(
            record => record.user_type === "GUEST"
        ));

        const dateResult = await pool.query(
            "SELECT (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')::date::text AS date"
        );
        const today = dateResult.rows[0].date;
        const reportResponses = await Promise.all([
            api("/api/admin/reports?period=daily"),
            api("/api/admin/reports?period=weekly"),
            api("/api/admin/reports?period=monthly"),
            api(`/api/admin/reports?period=custom&startDate=${today}&endDate=${today}`)
        ]);
        for (const report of reportResponses) {
            assert.equal(report.response.status, 200, report.body.message);
            assert.ok(report.body.totalVisits > 0);
            assert.equal(
                report.body.totalVisits,
                report.body.memberVisits + report.body.guestVisits
            );
            assert.equal(
                report.body.uniqueVisitors,
                report.body.memberVisitorCount + report.body.guestVisitorCount
            );
        }
        assert.equal(reportResponses[0].body.totalVisits, reportResponses[3].body.totalVisits);
        assert.equal(reportResponses[0].body.series.length, 24);
        assert.equal(reportResponses[1].body.series.length, 7);
        assert.ok(reportResponses[2].body.series.length >= 4);
        assert.equal(reportResponses[3].body.series.length, 1);
        assert.equal(reportResponses[0].body.memberVisitorCount, 1);
        assert.ok(reportResponses[0].body.guestVisitorCount < reportResponses[0].body.guestVisits);

        if (!memberTransactionSeeded) {
            await pool.query(
                `
                INSERT INTO member_transactions
                    (user_id, member_id, amount, payment_method, status)
                VALUES ($1, $2, 500, 'CASH', 'VERIFIED')
                `,
                [activeUserId, activeMemberId]
            );
            memberTransactionSeeded = true;
        }

        const memberTransactions = await api(
            "/api/admin/transactions?type=member"
        );
        const guestTransactions = await api(
            "/api/admin/transactions?type=guest"
        );
        const allTransactions = await api(
            "/api/admin/transactions?type=all"
        );
        assert.equal(memberTransactions.response.status, 200);
        assert.equal(guestTransactions.response.status, 200);
        assert.equal(allTransactions.response.status, 200);
        assert.equal(memberTransactions.body.transactions.length, 1);
        assert.ok(guestTransactions.body.transactions.length >= 5);
        assert.equal(
            allTransactions.body.transactions.length,
            memberTransactions.body.transactions.length +
                guestTransactions.body.transactions.length
        );
        assert.ok(guestTransactions.body.transactions.every(
            record => record.person_type === "GUEST"
        ));
        assert.ok(guestTransactions.body.transactions.some(
            record => record.description === "Extra 1 Hour"
        ));
        assert.ok(guestTransactions.body.transactions.some(
            record => record.description === "Extra 2 Hours"
        ));
        assert.ok(guestTransactions.body.transactions.some(
            record => record.description === "Extra 3 Hours"
        ));

        const attendanceMembers = await api("/api/admin/attendance/members");
        assert.equal(attendanceMembers.response.status, 200);
        const attendanceMemberIds = new Set(
            attendanceMembers.body.members.map(member => member.member_id)
        );
        assert.ok(attendanceMemberIds.has("TEST-ACTIVE-001"));
        assert.ok(attendanceMemberIds.has("TEST-PENDING-001"));
        assert.ok(attendanceMemberIds.has("TEST-REVOKED-001"));
        assert.ok(attendanceMemberIds.has("TEST-EXPIRED-001"));

        const dashboard = await api("/api/admin/dashboard");
        assert.equal(dashboard.response.status, 200);
        const expectedStatusCounts = await pool.query(
            `
            SELECT
                COUNT(*) FILTER (WHERE UPPER(status) = 'ACTIVE')::int AS active,
                COUNT(*) FILTER (WHERE UPPER(status) = 'PENDING')::int AS pending,
                COUNT(*) FILTER (WHERE UPPER(status) = 'REVOKED')::int AS revoked
            FROM members
            WHERE archived_at IS NULL
            `
        );
        assert.deepEqual(
            dashboard.body.membershipStatusCounts,
            expectedStatusCounts.rows[0]
        );

        const application = await pool.query(
            `
            INSERT INTO applications (
                user_id,
                membership_plan,
                amount,
                gcash_reference,
                payment_date,
                payment_screenshot,
                status
            )
            VALUES (
                $1,
                'Monthly',
                800,
                'ANCHOR-APPROVAL-TEST-001',
                CURRENT_DATE,
                'data:image/png;base64,iVBORw0KGgo=',
                'PENDING'
            )
            RETURNING id
            `,
            [activeUserId]
        );
        const applicationId = application.rows[0].id;
        const approval = await api(
            `/api/admin/applications/${applicationId}/approve`,
            { method: "POST" }
        );
        assert.equal(approval.response.status, 200, approval.body.message);
        const duplicateApproval = await api(
            `/api/admin/applications/${applicationId}/approve`,
            { method: "POST" }
        );
        assert.equal(duplicateApproval.response.status, 400);
        const approvedPayment = await pool.query(
            `
            SELECT status, amount, gcash_reference
            FROM member_transactions
            WHERE application_id = $1
            `,
            [applicationId]
        );
        assert.equal(approvedPayment.rows.length, 1);
        assert.equal(approvedPayment.rows[0].status, "VERIFIED");
        assert.equal(Number(approvedPayment.rows[0].amount), 800);
        assert.equal(
            approvedPayment.rows[0].gcash_reference,
            "ANCHOR-APPROVAL-TEST-001"
        );
        const approvedApplication = await pool.query(
            `
            SELECT status, payment_screenshot
            FROM applications
            WHERE id = $1
            `,
            [applicationId]
        );
        assert.equal(approvedApplication.rows[0].status, "APPROVED");
        assert.equal(
            approvedApplication.rows[0].payment_screenshot,
            "data:image/png;base64,iVBORw0KGgo="
        );

        const unauthorizedScreenshot = await fetch(
            `${baseUrl}/api/admin/applications/${applicationId}/screenshot`
        );
        assert.equal(unauthorizedScreenshot.status, 401);
        const authorizedScreenshot = await fetch(
            baseUrl + "/api/admin/applications/" + applicationId + "/screenshot",
            {
                headers: {
                    Authorization: ["Bearer", adminToken].join(" ")
                }
            }
        );
        assert.equal(authorizedScreenshot.status, 200);
        assert.match(
            authorizedScreenshot.headers.get("content-type") || "",
            /^image\/png/
        );

        const rejectedApplication = await pool.query(
            `
            INSERT INTO applications (
                user_id,
                membership_plan,
                amount,
                gcash_reference,
                payment_date,
                payment_screenshot,
                status
            )
            VALUES (
                980003,
                'Monthly',
                800,
                'ANCHOR-REJECT-TEST-001',
                CURRENT_DATE,
                'data:image/png;base64,iVBORw0KGgo=',
                'PENDING'
            )
            RETURNING id
            `
        );
        const rejectResponse = await api(
            `/api/admin/applications/${rejectedApplication.rows[0].id}/reject`,
            {
                method: "POST",
                body: JSON.stringify({
                    reason: "Payment reference could not be verified."
                })
            }
        );
        assert.equal(rejectResponse.response.status, 200);
        const rejectedState = await pool.query(
            `
            SELECT status, rejection_reason
            FROM applications
            WHERE id = $1
            `,
            [rejectedApplication.rows[0].id]
        );
        assert.equal(rejectedState.rows[0].status, "REJECTED");
        assert.equal(
            rejectedState.rows[0].rejection_reason,
            "Payment reference could not be verified."
        );
        const rejectedPayment = await pool.query(
            `
            SELECT COUNT(*)::int AS count
            FROM member_transactions
            WHERE application_id = $1
            `,
            [rejectedApplication.rows[0].id]
        );
        assert.equal(rejectedPayment.rows[0].count, 0);

        const deleteTransaction = await api(
            `/api/admin/transactions/${approvedPayment.rows[0].id}`,
            { method: "DELETE" }
        );
        assert.equal(deleteTransaction.response.status, 404);
    });
}
