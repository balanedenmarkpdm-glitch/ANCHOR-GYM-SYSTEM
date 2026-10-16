const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { after, before, test } = require("node:test");
require("dotenv").config();

const { Pool } = require("pg");
const bcrypt = require("bcrypt");
const {
    isAllowedFrontendOrigin,
    isLocalDevelopmentOrigin
} = require("../cors");

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
let activeCustomerToken;
let activeMemberId;
let pendingMemberId;
let revokedMemberId;
let expiredMemberId;
let archivedRecordId;
let archivedExpectedExpiration;
let activeUserId;
let testSchema;
let memberTransactionSeeded = false;

test("CORS permits local frontend development and configured production origins only", () => {
    const productionOrigin = "https://anchor-gym-system.vercel.app";
    const previewOrigin =
        "https://anchor-gym-system-123-brunheart.vercel.app";

    for (const origin of [
        "http://localhost:8765",
        "http://127.0.0.1:8766",
        "http://[::1]:3000"
    ]) {
        assert.equal(isLocalDevelopmentOrigin(origin), true);
        assert.equal(
            isAllowedFrontendOrigin(origin, productionOrigin),
            true
        );
    }

    assert.equal(isAllowedFrontendOrigin(productionOrigin, productionOrigin), true);
    assert.equal(isAllowedFrontendOrigin(previewOrigin, productionOrigin), true);
    assert.equal(
        isAllowedFrontendOrigin(
            "https://untrusted.example",
            productionOrigin,
            ["https://untrusted.example"]
        ),
        true
    );

    for (const origin of [
        "https://localhost:8765",
        "http://localhost.example:8765",
        "http://192.168.1.20:8765",
        "not-an-origin"
    ]) {
        assert.equal(isAllowedFrontendOrigin(origin, productionOrigin), false);
    }
});

test("package scripts use the backend entry point and provide a JavaScript syntax check", () => {
    const packageJson = JSON.parse(
        fs.readFileSync(path.join(projectRoot, "package.json"), "utf8")
    );

    assert.equal(packageJson.name, "anchor-gym-system");
    assert.equal(packageJson.main, "backend/server.js");
    assert.equal(packageJson.scripts.start, "node backend/server.js");
    assert.equal(
        fs.existsSync(path.join(projectRoot, packageJson.main)),
        true
    );
    assert.match(packageJson.scripts.check, /node --check backend\/server\.js/);
});

test("frontend root routes to the customer login page locally and when hosted", () => {
    const entryPage = fs.readFileSync(
        path.join(projectRoot, "frontend", "index.html"),
        "utf8"
    );
    const vercelConfig = JSON.parse(
        fs.readFileSync(
            path.join(projectRoot, "frontend", "vercel.json"),
            "utf8"
        )
    );

    assert.match(entryPage, /url=login\.html/);
    assert.match(entryPage, /location\.replace\(["']login\.html["']\)/);
    assert.equal(
        vercelConfig.rewrites.find(route => route.source === "/")?.destination,
        "/login.html"
    );
});

test("admin UI exposes the required application, dashboard, report, attendance, and transaction rules", () => {
    const adminHtml = fs.readFileSync(
        path.join(projectRoot, "frontend", "admin.html"),
        "utf8"
    );
    const loginHtml = fs.readFileSync(
        path.join(projectRoot, "frontend", "admin-login.html"),
        "utf8"
    );
    const customerLoginHtml = fs.readFileSync(
        path.join(projectRoot, "frontend", "login.html"),
        "utf8"
    );
    const customerLoginCss = fs.readFileSync(
        path.join(projectRoot, "frontend", "login.css"),
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
    const customerCss = fs.readFileSync(
        path.join(projectRoot, "frontend", "customer.css"),
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
        /<div class="attendance-stats report-stats">([\s\S]*?)<div class="card report\b/
    )?.[1] || "";
    const membershipChart = adminHtml.match(
        /<div class="legend">[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/
    )?.[0] || "";
    const memberPage = adminHtml.match(
        /<section\s+id="members"[\s\S]*?<\/section>/
    )?.[0] || "";
    const attendanceRenderer = adminJs.match(
        /async function loadAttendance\([\s\S]*?\/\/ GUEST COUNTDOWN HELPERS/
    )?.[0] || "";
    const memberAttendanceRenderer = adminJs.match(
        /function renderAttendanceMembers\([\s\S]*?\/\/ GUEST COUNTDOWN HELPERS/
    )?.[0] || "";
    const attendancePage = adminHtml.match(
        /<section\s+id="attendance"[\s\S]*?<\/section>/
    )?.[0] || "";
    const customerJs = fs.readFileSync(
        path.join(projectRoot, "frontend", "customer.js"),
        "utf8"
    );
    const customerHtml = fs.readFileSync(
        path.join(projectRoot, "frontend", "customer.html"),
        "utf8"
    );
    const authJs = fs.readFileSync(
        path.join(projectRoot, "frontend", "auth.js"),
        "utf8"
    );
    const forgotPasswordHtml = fs.readFileSync(
        path.join(projectRoot, "frontend", "forgot-password.html"),
        "utf8"
    );
    const resetPasswordHtml = fs.readFileSync(
        path.join(projectRoot, "frontend", "reset-password.html"),
        "utf8"
    );
    const privacyPolicyHtml = fs.readFileSync(
        path.join(projectRoot, "frontend", "privacy-policy.html"),
        "utf8"
    );

    assert.match(loginHtml, /<input\b(?=[^>]*id="adminEmail")(?=[^>]*autocomplete="username")[^>]*>/);
    assert.match(loginHtml, /<input\b(?=[^>]*id="adminPassword")(?=[^>]*autocomplete="current-password")[^>]*>/);
    assert.doesNotMatch(loginHtml, /<input\b(?=[^>]*id="adminEmail")(?=[^>]*value=)[^>]*>/);
    assert.doesNotMatch(loginHtml, /<input\b(?=[^>]*id="adminPassword")(?=[^>]*value=)[^>]*>/);
    assert.doesNotMatch(customerLoginCss, /min-width:\s*320px/);
    assert.doesNotMatch(customerLoginCss, /body\.login-page\s*\{[^}]*overflow-x:\s*hidden/s);
    assert.match(customerLoginHtml, /href="privacy-policy\.html"/);
    assert.match(privacyPolicyHtml, /Privacy Policy/);
    assert.match(privacyPolicyHtml, /balanedenmark\.pdm@gmail\.com/);
    assert.match(forgotPasswordHtml, /id="forgotForm"/);
    assert.match(forgotPasswordHtml, /id="forgotMessage"/);
    assert.match(authJs, /\/api\/auth\/forgot-password/);
    assert.match(authJs, /Sending verification code\. Please wait\.\.\./);
    assert.match(authJs, /The request took too long\. Please try again\./);
    assert.match(authJs, /\/api\/auth\/verify-reset-code/);
    assert.match(authJs, /\/api\/auth\/reset-password/);
    assert.match(authJs, /isVercelPreview/);
    assert.match(authJs, /hostname\.startsWith\("anchor-gym-system-"\)/);
    assert.match(authJs, /https:\/\/anchor-gym-system\.vercel\.app\/login\.html/);
    assert.match(resetPasswordHtml, /id="verifyResetCodeForm"/);
    assert.match(resetPasswordHtml, /id="resendResetCode"/);
    assert.match(authJs, /anchorPasswordResetEmail/);
    assert.match(authJs, /\/api\/auth\/forgot-password/);
    assert.match(resetPasswordHtml, /id="resetPasswordForm"/);
    assert.match(resetPasswordHtml, /id="resetPasswordForm" hidden/);
    assert.equal(
        (resetPasswordHtml.match(/aria-label="Digit \d of 4"/g) || []).length,
        4
    );
    assert.doesNotMatch(resetPasswordHtml, /id="resetEmail"/);
    assert.match(backendServer, /crypto\.createHmac\("sha256", gmailClientSecret\)/);
    assert.match(backendServer, /attempts < 5/);
    assert.match(backendServer, /CREATE TABLE IF NOT EXISTS password_reset_tokens/);
    assert.match(backendServer, /NOW\(\) \+ INTERVAL '30 minutes'/);
    assert.match(backendServer, /GMAIL_REFRESH_TOKEN/);
    assert.match(backendServer, /EMAIL_FROM/);
    assert.match(backendServer, /https:\/\/gmail\.googleapis\.com\/gmail\/v1\/users\/me\/messages\/send/);
    assert.match(backendServer, /crypto\.createHmac\("sha256", gmailClientSecret\)/);
    assert.match(backendServer, /Gmail authorization failed/);
    assert.match(backendServer, /gmail\.send permission/);
    assert.match(
        portalTheme,
        /:root\[data-page="admin-login"\] \.auth-card label\[for="adminEmail"\],[\s\S]*?label\[for="adminPassword"\]\s*\{[^}]*color:\s*var\(--color-placeholder\)/s
    );
    assert.match(
        portalTheme,
        /:root\[data-page="signup"\] \.auth-card form label:not\(\.remember\)\s*\{\s*color:\s*var\(--color-placeholder\)/
    );
    assert.match(adminJs, /class="approve"/);
    assert.match(adminJs, /class="reject"/);
    assert.match(membershipChart, /dashboardActiveLegend/);
    assert.match(membershipChart, /dashboardPendingLegend/);
    assert.match(membershipChart, /dashboardRevokedLegend/);
    assert.match(adminHtml, /dashboard-overview-grid/);
    assert.match(adminHtml, /dashboard-detail-grid/);
    assert.match(adminHtml, /occupancy-person-count/);
    assert.match(adminHtml, /dashboard-membership-content/);
    assert.match(adminHtml, /donut-total/);
    assert.match(adminCss, /#dashboard\.active \.dashboard-membership-content/);
    assert.match(adminCss, /#dashboard\.active \.dashboard-empty-state/);
    assert.match(adminJs, /querySelector\("\.donut-total"\)/);
    assert.match(adminJs, /No pending applications\./);
    assert.doesNotMatch(membershipChart, /Expired/);
    assert.equal((reportSummary.match(/class="card"/g) || []).length, 4);
    assert.match(reportPage, /Visits by Day/);
    assert.match(adminHtml, /id="attendanceMembersTableBody"/);
    assert.doesNotMatch(adminHtml, /attendanceTimeoutAlert|manualMemberSearchForm|manualAttendanceSearch|manualAttendanceResults/);
    assert.match(adminHtml, /class="card attendance-scanner-card"/);
    assert.match(adminHtml, /class="attendance-scanner-actions"/);
    assert.match(adminHtml, /class="attendance-scan-button"/);
    assert.match(adminHtml, /class="attendance-stop-scan-button"/);
    assert.match(adminCss, /#attendance\.active \.attendance-stats\s*\{\s*grid-template-columns:\s*repeat\(5, minmax\(0, 1fr\)\)/);
    assert.match(adminCss, /#attendance\.active \.attendance-stats \.card/);
    assert.ok(
        adminHtml.indexOf("id=\"qrScanStatus\"") <
            adminHtml.indexOf("class=\"attendance-stats\""),
        "Member QR scanner should appear above the attendance summary"
    );
    assert.match(adminHtml, /applications-table-scroll/);
    assert.match(adminHtml, /class="applications-table"/);
    assert.match(adminHtml, /Reference Number/);
    assert.match(adminHtml, /Payment Proof/);
    assert.match(adminHtml, /id="applicationsPageStatus"/);
    assert.match(adminHtml, /id="applicationsPreviousPage"/);
    assert.match(adminHtml, /id="applicationsNextPage"/);
    assert.match(adminJs, /applicationsPageSize = 5/);
    assert.match(adminJs, /function renderApplicationsTable\(applications\)/);
    assert.match(adminJs, /function changeApplicationsPage\(change\)/);
    assert.match(adminJs, /application\.rejection_reason/);
    const applicationRowRenderer = adminJs.match(
        /function createApplicationRow\([\s\S]*?(?=function formatTime\()/
    )?.[0] || "";
    const applicationDecisionActions = applicationRowRenderer.match(
        /const actions =([\s\S]*?)const rejectionReason/
    )?.[1] || "";
    assert.match(applicationDecisionActions, /status ===\s*"PENDING"/);
    assert.match(applicationDecisionActions, /"APPROVED",\s*"VERIFIED"[\s\S]*?application-decision-placeholder/);
    assert.doesNotMatch(applicationDecisionActions, /"REJECTED"[\s\S]*?application-decision-placeholder/);
    assert.match(applicationRowRenderer, /No rejection reason recorded\./);
    assert.match(adminCss, /\.application-decision\s*\{[^}]*white-space:\s*normal[^}]*overflow-wrap:\s*anywhere/s);
    assert.match(adminCss, /\.application-decision-placeholder\s*\{[^}]*font-size:\s*10px/s);
    assert.match(adminCss, /\.applications-table th:nth-child\(2\)\s*\{\s*width:\s*24%;\s*\}/);
    assert.match(adminCss, /\.applications-table th:nth-child\(8\)\s*\{\s*width:\s*9%;\s*\}/);
    assert.match(adminCss, /\.applications-table th:nth-child\(9\)\s*\{\s*width:\s*10%;\s*\}/);
    assert.match(adminCss, /\.applications-table th,\s*\.applications-table td\s*\{\s*text-align:\s*center;\s*\}/);
    assert.match(adminCss, /\.application-contact > span\s*\{[^}]*justify-content:\s*flex-start[^}]*text-align:\s*left/s);
    assert.match(adminCss, /\.application-payment-date small,\s*\.application-rejection-reason\s*\{[^}]*text-align:\s*center/s);
    assert.match(adminCss, /\.main table th,\s*\.main table td\s*\{\s*text-align:\s*center;\s*\}/);
    assert.match(adminCss, /\.main table td \.member-contact-cell span,\s*\.main table td \.attendance-actions\s*\{[^}]*justify-content:\s*center/s);
    assert.match(adminCss, /\.main table td\.member-contact-cell\s*\{[^}]*text-align:\s*left/s);
    assert.match(adminCss, /\.main table td \.member-contact-cell span\s*\{[^}]*justify-content:\s*flex-start[^}]*text-align:\s*left/s);
    assert.match(adminCss, /\.main table td \.attendance-action-link\s*\{[^}]*text-align:\s*center/s);
    assert.match(adminCss, /\.applications-table \.application-decision \.approve/);
    assert.match(adminCss, /\.applications-pagination \.small-btn:disabled/);
    assert.match(adminHtml, /attendanceMemberSearch/);
    assert.match(adminHtml, /attendance-member-search-field/);
    assert.match(adminHtml, /attendance-member-filter-field/);
    assert.match(adminHtml, /member-attendance-table/);
    assert.match(adminHtml, /id="attendanceMembersPreviousPage"/);
    assert.match(adminHtml, /id="attendanceMembersNextPage"/);
    assert.match(adminCss, /\.attendance-members-card\s*\{[^}]*padding:\s*18px/s);
    assert.match(adminCss, /\.attendance-members-card > h3::after/);
    assert.match(adminCss, /\.member-attendance-table \.status::before/);
    assert.match(adminCss, /\.member-attendance-state\.inside::before/);
    assert.match(adminHtml, /value="inside">Inside Gym/);
    assert.match(adminHtml, /value="not-inside">Not Checked In/);
    assert.match(adminHtml, /class="chart-scroll"/);
    assert.match(adminHtml, /class="table-scroll report-table-scroll"/);
    assert.match(adminHtml, /class="card report admin-report-chart-card"/);
    assert.match(adminHtml, /class="admin-report-chart-title"/);
    assert.match(adminHtml, /class="card admin-report-details-card"/);
    assert.match(adminHtml, /class="admin-report-details-table"/);
    assert.doesNotMatch(adminHtml, /id="reportDateRange" hidden/);
    assert.match(adminHtml, /id="reportChartTitle">Visits by Day/);
    assert.match(adminHtml, /data-report-period="weekly"\s+aria-pressed="true"/);
    assert.match(adminHtml, /class="table-scroll attendance-table-scroll"/);
    assert.match(attendancePage, /class="card attendance-records-card"/);
    assert.match(attendancePage, /class="attendance-records-table"/);
    assert.match(adminHtml, /class="table-scroll attendance-members-table-scroll"/);
    assert.match(adminHtml, /class="table-toolbar attendance-filter-toolbar"[\s\S]*?id="attendanceTypeFilter"/);
    assert.match(transactionPage, /id="transactionTypeFilter"/);
    assert.match(transactionPage, /class="transactions-table"/);
    assert.match(transactionPage, /Plan \/ Access Type/);
    assert.match(transactionPage, /id="transactionsPageStatus"/);
    assert.match(transactionPage, /id="transactionsPreviousPage"/);
    assert.match(transactionPage, /id="transactionsNextPage"/);
    assert.match(adminJs, /transactionsPageSize = 8/);
    assert.match(adminJs, /let reportPeriod = "weekly"/);
    assert.match(adminJs, /function getReportPeriodDateRange\(period\)/);
    assert.match(adminJs, /timeZone:\s*"Asia\/Manila"/);
    assert.match(adminJs, /function renderTransactionsTable\(\)/);
    assert.match(adminJs, /transaction\.member_id/);
    assert.match(adminJs, /class="small-btn application-proof-button"/);
    assert.doesNotMatch(transactionPage, /<th[^>]*>\s*Related Visit\s*<\/th>/i);
    assert.doesNotMatch(transactionPage, /<th[^>]*>\s*Extension\s*<\/th>/i);
    assert.match(transactionPage, /<th scope="col">Screenshot<\/th>/);
    assert.match(adminJs, /View Payment<br>Screenshot/);
    assert.match(adminJs, /transaction\.payment_screenshot/);
    assert.doesNotMatch(
        adminJs.match(/async function loadTransactions[\s\S]*?\/\/ ATTENDANCE/)?.[0] || "",
        /View Visit|openAttendanceVisit/
    );
    assert.match(memberPage, /Contact Information/);
    assert.match(memberPage, /Plan &amp; Amount/);
    assert.match(adminCss, /#guests #guestForm input::placeholder[\s\S]*?color:\s*var\(--color-placeholder\)/);
    assert.match(adminCss, /#guests #guestForm > label\s*\{\s*color:\s*var\(--color-placeholder\)/);
    assert.match(adminCss, /#guestForm \.payment-confirmation\s*\{[^}]*align-items:\s*center[^}]*color:\s*var\(--color-placeholder\)/s);
    assert.match(adminCss, /#guestForm \.payment-confirmation input\[type="checkbox"\]\s*\{[^}]*min-height:\s*18px/s);
    assert.match(adminJs, /<span>Monthly<\/span>\s*<small>₱800<\/small>/);
    assert.match(memberPage, /id="archived-members"/);
    assert.match(memberPage, /id="selectAllMembers"/);
    assert.match(memberPage, /class="member-list-search"/);
    assert.match(memberPage, /class="members-list-table"/);
    assert.match(memberPage, /id="membersPageStatus"/);
    assert.match(memberPage, /id="membersPreviousPage"/);
    assert.match(memberPage, /id="membersNextPage"/);
    assert.match(memberPage, /id="revokeSelectedMembersButton"[\s\S]*?Revoke selected/);
    assert.match(adminJs, /async function revokeSelectedMembers/);
    assert.match(adminJs, /`\/api\/admin\/members\/\$\{memberId\}\/revoke`[\s\S]*?method:\s*"PATCH"/);
    assert.match(adminHtml, /id="revokeSelectedMembersButton"[\s\S]*?attendance-button-icon[\s\S]*?Revoke selected/);
    assert.match(adminJs, /data-selectable="member"/);
    assert.match(memberPage, /id="selectAllArchivedMembers"/);
    assert.match(memberPage, /class="archived-members-list-table"/);
    assert.match(memberPage, /id="archivedMembersPageStatus"/);
    assert.match(memberPage, /id="archivedMembersPreviousPage"/);
    assert.match(memberPage, /id="archivedMembersNextPage"/);
    assert.doesNotMatch(memberPage, /restoreSelectedArchivedMembersButton|Restore archived/);
    assert.match(memberPage, /id="reactivateSelectedRevokedMembersButton"[\s\S]*?Reactivate selected/);
    assert.doesNotMatch(adminJs, /async function restoreSelectedArchivedMembers/);
    assert.match(adminJs, /async function reactivateSelectedRevokedMembers/);
    assert.match(adminJs, /class="remove-button membership-action-button"[\s\S]*?attendance-button-icon[\s\S]*?Revoke/);
    assert.match(adminJs, /class="restore-button membership-action-button"[\s\S]*?attendance-button-icon[\s\S]*?Reactivate/);
    assert.match(adminJs, /data-selectable="revoked"/);
    assert.match(adminJs, /getSelectedRevokedMemberIds\(\)/);
    assert.match(adminJs, /onclick="restoreArchivedMember\(\$\{Number\(member\.archive_id\)\}\)"/);
    assert.match(adminJs, /\/api\/admin\/archived-members\/\$\{archiveId\}\/restore/);
    assert.match(adminJs, /\/api\/admin\/members\/\$\{memberId\}\/restore/);
    assert.match(adminJs, /function applyMemberTablePagination\(tableName\)/);
    assert.match(adminJs, /function changeMemberTablePage\(tableName, change\)/);
    assert.match(adminCss, /\.members-list-table \.remove-button/);
    assert.match(adminCss, /@media\s*\(max-width:\s*700px\)\s*\{[\s\S]*?\.member-list-toolbar\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)\s*auto/);
    assert.match(adminCss, /\.member-list-toolbar #revokeSelectedMembersButton,\s*\.member-list-toolbar #reactivateSelectedRevokedMembersButton\s*\{[^}]*width:\s*auto[^}]*min-width:\s*0/s);
    assert.match(adminCss, /\.members-table-scroll \.members-list-table\s*\{\s*min-width:\s*900px/s);
    assert.match(adminCss, /\.archived-members-list-table\s*\{\s*min-width:\s*980px/s);
    assert.match(adminCss, /\.card:has\(> table\)/);
    assert.match(customerCss, /\.card:has\(> table\)/);
    assert.doesNotMatch(portalTheme, /\)\s*table\s*\{\s*min-width:\s*(?:560|600)px/);
    assert.match(adminCss, /\.member-list-toolbar #revokeSelectedMembersButton\s*\{[^}]*background:\s*#DC2626[^}]*color:\s*#ffffff/s);
    assert.match(adminCss, /\.members-list-table \.membership-action-button,[\s\S]*?\.member-attendance-table \.attendance-actions \.attendance-checkout-button\s*\{[^}]*width:\s*118px[^}]*min-height:\s*34px[^}]*font-size:\s*11px/s);
    assert.match(adminHtml, /id="reactivateSelectedRevokedMembersButton"[\s\S]*?attendance-button-icon[\s\S]*?Reactivate selected/);
    assert.match(portalTheme, /\.members-list-table \.membership-action-button\.remove-button[\s\S]*?background:\s*#dc2626/);
    assert.match(portalTheme, /\.member-list-toolbar #revokeSelectedMembersButton\s*\{[^}]*background:\s*#dc2626[^}]*color:\s*#ffffff/s);
    assert.match(portalTheme, /\.members-list-table \.membership-action-button\.restore-button[\s\S]*?background:\s*#16a34a/);
    assert.doesNotMatch(adminHtml, /<button\s+onclick="showPage\('archived-members'/);
    assert.doesNotMatch(attendancePage, /<th[^>]*>\s*Check-Out\s*<\/th>/i);
    assert.match(memberAttendanceRenderer, /checkoutAttendance\(\$\{Number\(visit\.id\)\}\)/);
    assert.match(memberAttendanceRenderer, /class="remove-button attendance-checkout-button"/);
    assert.match(memberAttendanceRenderer, /class="restore-button attendance-checkin-button"/);
    assert.match(memberAttendanceRenderer, /member-attendance-state inside/);
    assert.match(memberAttendanceRenderer, /member-attendance-state not-inside/);
    assert.match(adminCss, /\.attendance-checkin-button,\s*\.attendance-checkout-button\s*\{[^}]*flex:\s*0 0 120px/s);
    assert.match(portalTheme, /\.attendance-actions \.attendance-checkin-button\s*\{[^}]*background:\s*#16a34a[^}]*color:\s*#ffffff/s);
    assert.match(portalTheme, /\.attendance-actions \.attendance-checkout-button\s*\{[^}]*background:\s*#dc2626[^}]*color:\s*#ffffff/s);
    assert.match(attendanceRenderer, /TIME OUT/);
    assert.match(attendanceRenderer, /class="attendance-action-link"/);
    assert.doesNotMatch(attendanceRenderer, /TIMED OUT \/ OVERDUE/);
    assert.match(adminJs, /attendanceMembersPageSize = 5/);
    assert.match(adminJs, /data\.membershipStatusCounts\?\.pending/);
    assert.match(adminJs, /async function viewScreenshot/);
    assert.match(adminJs, /headers: token\s*\?/);
    assert.match(backendServer, /\/api\/admin\/applications\/' \|\| a\.id \|\| '\/screenshot/);
    assert.match(customerJs, /displayMembership\(\s*data\.membership\s*\|\|\s*null\s*\)/);
    assert.match(
        customerJs.match(/function displayNoMembership\(\)[\s\S]*?function setMembershipActiveStyle/)?.[0] || "",
        /displayNoQR\(\)/
    );
    assert.match(
        customerJs.match(/function displayNoQR\([^)]*\)[\s\S]*?\/\/ SUBMIT APPLICATION/)?.[0] || "",
        /qrContainer\.innerHTML\s*=\s*"—"/
    );
    assert.match(
        customerJs.match(/function displayQR\([\s\S]*?\/\/ NO QR/)?.[0] || "",
        /status\s*!==\s*"ACTIVE"[\s\S]*?displayNoQR\(\)/
    );
    assert.match(portalTheme, /\.chart-scroll\s*\{[^}]*overflow-x:\s*auto/s);
    assert.match(portalTheme, /@media \(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?scroll-behavior:\s*auto !important/);
    assert.match(portalTheme, /\.admin-report-chart-card \.bars\s*\{[^}]*height:\s*155px[^}]*repeating-linear-gradient/s);
    assert.match(portalTheme, /\.admin-report-chart-card \.report-toggle button\s*\{[^}]*min-height:\s*28px/s);
    assert.match(portalTheme, /\.admin-report-chart-card #reportMessage::before/);
    assert.match(portalTheme, /\.admin-report-details-card\s*\{[^}]*margin-top:\s*16px[^}]*padding:\s*14px/s);
    assert.match(portalTheme, /\.admin-report-details-card \.report-table-scroll\s*\{[^}]*max-width:\s*100%[^}]*overflow:\s*auto/s);
    assert.match(portalTheme, /\.admin-report-details-table\s*\{[^}]*min-width:\s*900px[^}]*table-layout:\s*fixed/s);
    assert.match(portalTheme, /\.admin-report-details-table th:nth-child\(1\)\s*\{\s*width:\s*18%;\s*\}/);
    assert.match(portalTheme, /\.admin-report-details-table th:nth-child\(7\)\s*\{\s*width:\s*14%;\s*\}/);
    assert.match(portalTheme, /\.bars\s*\{[^}]*height:\s*270px/s);
    assert.match(adminCss, /\.attendance-table-scroll,\s*\.report-table-scroll,\s*\.attendance-members-table-scroll,\s*\.applications-table-scroll\s*\{[^}]*max-height:[^}]*overflow-y:\s*auto/s);
    assert.match(adminCss, /\.attendance-filter-toolbar\s*\{[^}]*align-items:\s*center[^}]*padding-inline:\s*0/s);
    assert.match(adminCss, /\.attendance-records-table th,\s*\.attendance-records-table td\s*\{[^}]*padding:\s*14px 12px/s);
    assert.match(adminCss, /#attendance \.attendance-records-card\s*\{[^}]*padding:\s*18px/s);
    assert.match(adminCss, /#attendance \.attendance-records-card\s*\{\s*overflow:\s*hidden\s*;/);
    assert.match(adminCss, /\.attendance-records-table\s*\{[^}]*table-layout:\s*fixed/s);
    assert.match(adminCss, /@media \(max-width:\s*920px\)\s*\{[\s\S]*?#dashboard\.active \.grid\.dashboard-overview-grid\s*\{\s*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
    assert.match(adminCss, /#transactions \.transaction-table-scroll,\s*#reports \.report-table-scroll\s*\{[^}]*overflow-x:\s*auto/s);
    assert.match(adminCss, /#transactions \.transactions-table\s*\{\s*min-width:\s*1320px/s);
    assert.match(adminCss, /#reports \.admin-report-details-table\s*\{\s*min-width:\s*1200px/s);
    assert.match(adminCss, /#transactions \.transactions-table th,\s*#reports \.admin-report-details-table th\s*\{[^}]*white-space:\s*normal[^}]*overflow-wrap:\s*anywhere/s);
    assert.match(adminCss, /\.sidebar nav\s*\{[^}]*scroll-behavior:\s*smooth/s);
    assert.match(customerCss, /\.sidebar nav\s*\{[^}]*scroll-behavior:\s*smooth/s);
    assert.match(customerCss, /\.upload input\[type="file"\]\s*\{[^}]*min-width:\s*0[^}]*max-width:\s*100%/s);
    assert.match(adminCss, /\.attendance-records-table th:nth-child\(7\)\s*\{\s*width:\s*11%/);
    assert.match(adminCss, /@media \(max-width:\s*700px\)\s*\{[\s\S]*?\.attendance-records-card\s*\{[^}]*padding:\s*14px[\s\S]*?\.attendance-members-card\s*\{[^}]*padding:\s*14px/s);
    assert.match(portalTheme, /html\[data-portal="admin"\]\s+\.approve[\s\S]*?#16A34A/);
    assert.match(portalTheme, /html\[data-portal="admin"\]\s+\.reject[\s\S]*?#DC2626/);
    assert.match(adminJs, /for \(let value = axisMaximum; value >= 0; value -= step\)/);
    assert.match(portalTheme, /\.status\.active\s*\{[^}]*#16A34A/s);
    assert.match(portalTheme, /\.status\.pending\s*\{[^}]*#EAB308/s);
    assert.match(portalTheme, /\.status\.revoked\s*\{[^}]*#DC2626/s);
    assert.match(
        portalTheme,
        /:root\[data-page="customer-dashboard"\] \.stat strong\.membership-active-value,[\s\S]*?:root\[data-page="customer-dashboard"\] \.detail-card h2\.membership-active-value\s*\{\s*color:\s*#16A34A/s
    );
    assert.match(portalTheme, /#dashboardOccupancy[\s\S]*?#16A34A/);
    assert.match(customerJs, /setMembershipActiveStyle\(isActive\)/);
    assert.match(
        customerJs.match(/function setMembershipActiveStyle\(active\)[\s\S]*?\/\/ MEMBERSHIP TITLE/)?.[0] || "",
        /"membershipPageTitle"/
    );
    assert.match(customerHtml, /id="attendance-report"/);
    assert.match(customerHtml, /id="attendanceReportBody"/);
    assert.match(customerHtml, /id="qrRefreshCountdown"/);
    assert.match(customerHtml, /attendanceReportDaily/);
    assert.match(customerHtml, /attendanceReportWeekly/);
    assert.match(customerHtml, /attendanceReportMonthly/);
    assert.match(customerHtml, /Check In/);
    assert.match(customerHtml, /Check Out/);
    assert.match(customerJs, /\/api\/customer\/\$\{customerData\.id\}\/attendance/);
    assert.match(customerJs, /period=\$\{requestedPeriod\}/);
    assert.match(customerJs, /timeZone:\s*"Asia\/Manila"/);
    assert.match(backendServer, /\/api\/customer\/:userId\/attendance/);
    assert.match(backendServer, /DATE_TRUNC\('day', \$\{GUEST_NOW_SQL\}\)/);
    assert.match(backendServer, /DATE_TRUNC\('week', \$\{GUEST_NOW_SQL\}\)/);
    assert.match(backendServer, /DATE_TRUNC\('month', \$\{GUEST_NOW_SQL\}\)/);
    assert.match(backendServer, /member_qr_tokens/);
    assert.match(backendServer, /QR_TOKEN_LIFETIME_SECONDS = 30/);
    assert.match(backendServer, /requireCustomerSession/);
    assert.match(customerJs, /\/api\/customer\/attendance-qr/);
    assert.match(customerJs, /Refreshes in \$\{secondsRemaining\} seconds/);
    assert.match(customerJs, /can only be scanned once/);
    assert.match(adminHtml, /pending-applications-heading[\s\S]*?<svg/);
    assert.match(adminCss, /#dashboard\.active \.pending-applications-heading > svg[\s\S]*?#EAB308/);
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

    test("password reset rejects expired and used codes", async () => {
        const originalPassword = await pool.query(
            "SELECT password FROM users WHERE id = $1",
            [activeUserId]
        );
        const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
        process.env.GOOGLE_CLIENT_SECRET = "integration-reset-code-secret";

        try {
            for (const state of ["expired", "used"]) {
                const code =
                    state === "expired" ? "1234" : "8765";
                const tokenHash =
                    crypto.createHmac(
                        "sha256",
                        process.env.GOOGLE_CLIENT_SECRET
                    )
                        .update(code)
                        .digest("hex");

                await pool.query(
                    `
                    INSERT INTO password_reset_tokens
                        (token_hash, user_id, expires_at, used_at)
                    VALUES (
                        $1,
                        $2,
                        CASE WHEN $3 = 'expired'
                            THEN NOW() - INTERVAL '1 minute'
                            ELSE NOW() + INTERVAL '30 minutes'
                        END,
                        CASE WHEN $3 = 'used' THEN NOW() ELSE NULL END
                    )
                    `,
                    [tokenHash, activeUserId, state]
                );

                const result = await api(
                    "/api/auth/verify-reset-code",
                    {
                        method: "POST",
                        body: JSON.stringify({
                            email: "test-member@example.invalid",
                            code
                        })
                    }
                );

                assert.equal(result.response.status, 400);
                assert.match(result.body.message, /invalid, expired/i);
            }
        } finally {
            await pool.query(
                "DELETE FROM password_reset_tokens WHERE user_id = $1",
                [activeUserId]
            );
            if (clientSecret === undefined) {
                delete process.env.GOOGLE_CLIENT_SECRET;
            } else {
                process.env.GOOGLE_CLIENT_SECRET = clientSecret;
            }
        }

        const unchangedPassword = await pool.query(
            "SELECT password FROM users WHERE id = $1",
            [activeUserId]
        );
        assert.equal(
            unchangedPassword.rows[0].password,
            originalPassword.rows[0].password
        );
    });

    test("password reset accepts one valid code and locks it after five incorrect attempts", async () => {
        const originalPassword = await pool.query(
            "SELECT password FROM users WHERE id = $1",
            [activeUserId]
        );
        const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
        process.env.GOOGLE_CLIENT_SECRET = "integration-reset-code-secret";

        try {
            const validCode = "0123";
            const tokenHash =
                crypto.createHmac(
                    "sha256",
                    process.env.GOOGLE_CLIENT_SECRET
                )
                    .update(validCode)
                    .digest("hex");

            await pool.query(
                `
                INSERT INTO password_reset_tokens
                    (token_hash, user_id, expires_at)
                VALUES ($1, $2, NOW() + INTERVAL '30 minutes')
                `,
                [tokenHash, activeUserId]
            );

            const wrongCodeHash = crypto.createHmac(
                "sha256",
                process.env.GOOGLE_CLIENT_SECRET
            ).update("9999").digest("hex");
            assert.notEqual(wrongCodeHash, tokenHash);

            for (let attempt = 0; attempt < 5; attempt += 1) {
                const result = await api(
                    "/api/auth/verify-reset-code",
                    {
                        method: "POST",
                        body: JSON.stringify({
                            email: "test-member@example.invalid",
                            code: "9999",
                            password: "new-valid-password"
                        })
                    }
                );
                assert.equal(result.response.status, 400);
            }

            const lockedOut = await api(
                "/api/auth/verify-reset-code",
                {
                    method: "POST",
                    body: JSON.stringify({
                        email: "test-member@example.invalid",
                        code: validCode
                    })
                }
            );
            assert.equal(lockedOut.response.status, 400);

            await pool.query(
                "DELETE FROM password_reset_tokens WHERE token_hash = $1",
                [tokenHash]
            );
            const successfulCode = "8765";
            const successfulHash = crypto.createHmac(
                "sha256",
                process.env.GOOGLE_CLIENT_SECRET
            ).update(successfulCode).digest("hex");
            await pool.query(
                `
                INSERT INTO password_reset_tokens
                    (token_hash, user_id, expires_at)
                VALUES ($1, $2, NOW() + INTERVAL '30 minutes')
                `,
                [successfulHash, activeUserId]
            );

            const codeVerification = await api(
                "/api/auth/verify-reset-code",
                {
                    method: "POST",
                    body: JSON.stringify({
                        email: "test-member@example.invalid",
                        code: successfulCode
                    })
                }
            );
            assert.equal(
                codeVerification.response.status,
                200,
                codeVerification.body.message
            );
            assert.match(codeVerification.body.resetToken, /^[a-f0-9]{64}$/);

            const success = await api(
                "/api/auth/reset-password",
                {
                    method: "POST",
                    body: JSON.stringify({
                        resetToken: codeVerification.body.resetToken,
                        password: "new-valid-password"
                    })
                }
            );
            assert.equal(success.response.status, 200, success.body.message);
            const updatedPassword = await pool.query(
                "SELECT password FROM users WHERE id = $1",
                [activeUserId]
            );
            assert.equal(
                await bcrypt.compare(
                    "new-valid-password",
                    updatedPassword.rows[0].password
                ),
                true
            );

            const reusedCode = await api(
                "/api/auth/reset-password",
                {
                    method: "POST",
                    body: JSON.stringify({
                        resetToken: codeVerification.body.resetToken,
                        password: "another-valid-password"
                    })
                }
            );
            assert.equal(reusedCode.response.status, 400);
        } finally {
            await pool.query(
                "UPDATE users SET password = $2 WHERE id = $1",
                [activeUserId, originalPassword.rows[0].password]
            );
            await pool.query(
                "DELETE FROM password_reset_tokens WHERE user_id = $1",
                [activeUserId]
            );
            if (clientSecret === undefined) {
                delete process.env.GOOGLE_CLIENT_SECRET;
            } else {
                process.env.GOOGLE_CLIENT_SECRET = clientSecret;
            }
        }
    });

    test("member QR requires a session and expires after one scan", async () => {
        const customerLogin = await fetch(`${baseUrl}/api/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                email: "test-member@example.invalid",
                password: "integration-test-only"
            })
        });
        const customerLoginBody = await customerLogin.json();
        assert.equal(customerLogin.status, 200, customerLoginBody.message);
        activeCustomerToken = customerLoginBody.token;
        assert.ok(activeCustomerToken);

        const unauthenticatedQr = await fetch(
            `${baseUrl}/api/customer/attendance-qr`
        );
        assert.equal(unauthenticatedQr.status, 401);

        const issuedQr = await fetch(
            `${baseUrl}/api/customer/attendance-qr`,
            {
                headers: {
                    Authorization: `Bearer ${activeCustomerToken}`
                }
            }
        );
        const issuedQrBody = await issuedQr.json();
        assert.equal(issuedQr.status, 200, issuedQrBody.message);
        assert.equal(issuedQrBody.expires_in, 30);
        assert.match(
            issuedQrBody.qr_image,
            /^data:image\/png;base64,/
        );
        assert.ok(issuedQrBody.qr_code);

        const refreshedQr = await fetch(
            `${baseUrl}/api/customer/attendance-qr`,
            {
                headers: {
                    Authorization: `Bearer ${activeCustomerToken}`
                }
            }
        );
        const refreshedQrBody = await refreshedQr.json();
        assert.equal(refreshedQr.status, 200, refreshedQrBody.message);
        assert.notEqual(refreshedQrBody.qr_code, issuedQrBody.qr_code);
        for (const qrCode of [
            issuedQrBody.qr_code,
            refreshedQrBody.qr_code
        ]) {
            const claims = JSON.parse(
                Buffer.from(qrCode.split(".")[0], "base64url").toString("utf8")
            );
            assert.equal(claims.member_id, Number(activeMemberId));
        }

        const scannedQr = await api("/api/admin/attendance/scan", {
            method: "POST",
            body: JSON.stringify({
                qr_code: issuedQrBody.qr_code
            })
        });
        assert.equal(scannedQr.response.status, 200, scannedQr.body.message);
        assert.equal(scannedQr.body.action, "CHECKED_IN");

        const replayedQr = await api("/api/admin/attendance/scan", {
            method: "POST",
            body: JSON.stringify({
                qr_code: issuedQrBody.qr_code
            })
        });
        assert.equal(replayedQr.response.status, 401);

        const expiredQr = await fetch(
            `${baseUrl}/api/customer/attendance-qr`,
            {
                headers: {
                    Authorization: `Bearer ${activeCustomerToken}`
                }
            }
        );
        const expiredQrBody = await expiredQr.json();
        assert.equal(expiredQr.status, 200);
        await pool.query(
            `
            UPDATE member_qr_tokens
            SET expires_at = NOW() - INTERVAL '1 second'
            WHERE token_hash = $1
            `,
            [
                crypto
                    .createHash("sha256")
                    .update(expiredQrBody.qr_code)
                    .digest("hex")
            ]
        );
        const expiredScan = await api("/api/admin/attendance/scan", {
            method: "POST",
            body: JSON.stringify({
                qr_code: expiredQrBody.qr_code
            })
        });
        assert.equal(expiredScan.response.status, 401);

        const manualCheckout = await api("/api/admin/attendance/manual", {
            method: "POST",
            body: JSON.stringify({
                action: "CHECK_OUT",
                attendance_id: scannedQr.body.attendance.id
            })
        });
        assert.equal(manualCheckout.response.status, 200);

        const legacyQr = await api("/api/admin/attendance/scan", {
            method: "POST",
            body: JSON.stringify({
                qr_code: "TEST-QR-ACTIVE"
            })
        });
        assert.equal(legacyQr.response.status, 401);
    });

    test("manual check-in, visit-specific checkout, repeat visits, and no fake member payment", async () => {
        const memberList = await api("/api/admin/members");
        assert.equal(memberList.response.status, 200);
        const listedMember = memberList.body.members.find(
            member => Number(member.id) === Number(activeMemberId)
        );
        assert.equal(listedMember.email, "test-member@example.invalid");
        assert.equal(listedMember.phone, "09111110002");

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
        assert.equal(history.rows.length, 3);
        assert.ok(history.rows.every(row => row.check_in && row.check_out));

        for (const period of ["daily", "weekly", "monthly"]) {
            const memberAttendanceReport = await fetch(
                `${baseUrl}/api/customer/${activeUserId}/attendance?period=${period}`,
                {
                    headers: {
                        Authorization: `Bearer ${activeCustomerToken}`
                    }
                }
            );
            const memberAttendanceBody =
                await memberAttendanceReport.json();
            assert.equal(memberAttendanceReport.status, 200);
            assert.equal(memberAttendanceBody.success, true);
            assert.equal(memberAttendanceBody.period, period);
            assert.equal(memberAttendanceBody.attendance.length, 3);
            assert.ok(memberAttendanceBody.attendance.every(
                visit => visit.check_in && visit.check_out &&
                    visit.check_in.endsWith("Z") &&
                    visit.check_out.endsWith("Z") &&
                    Number.isInteger(visit.duration_minutes) &&
                    visit.duration_minutes >= 0
            ));
            assert.deepEqual(
                memberAttendanceBody.attendance.map(visit => Number(visit.id)).sort(),
                history.rows.map(visit => Number(visit.id)).sort()
            );
        }

        const invalidMemberAttendanceReport = await fetch(
            `${baseUrl}/api/customer/not-a-customer/attendance`,
            {
                headers: {
                    Authorization: `Bearer ${activeCustomerToken}`
                }
            }
        );
        assert.equal(invalidMemberAttendanceReport.status, 400);
        const invalidAttendancePeriod = await fetch(
            `${baseUrl}/api/customer/${activeUserId}/attendance?period=yearly`,
            {
                headers: {
                    Authorization: `Bearer ${activeCustomerToken}`
                }
            }
        );
        assert.equal(invalidAttendancePeriod.status, 400);

        const financialRecords = await pool.query(
            "SELECT COUNT(*)::int AS count FROM member_transactions"
        );
        assert.equal(financialRecords.rows[0].count, 0);
    });

    test("membership eligibility and archived restoration preserve revoked status and dates", async () => {
        const revokedMember = await pool.query(
            "SELECT user_id FROM members WHERE id = $1",
            [revokedMemberId]
        );
        const revokedCustomerDashboard = await api(
            `/api/customer/${revokedMember.rows[0].user_id}`
        );
        assert.equal(revokedCustomerDashboard.response.status, 200);
        assert.equal(revokedCustomerDashboard.body.membership, null);

        const activeCustomerDashboard = await api(
            `/api/customer/${activeUserId}`
        );
        assert.equal(activeCustomerDashboard.response.status, 200);
        assert.equal(activeCustomerDashboard.body.membership.status, "ACTIVE");
        assert.equal(
            Object.prototype.hasOwnProperty.call(
                activeCustomerDashboard.body.membership,
                "qr_code"
            ),
            false
        );

        const revoke = await api(
            `/api/admin/members/${activeMemberId}/revoke`,
            {
                method: "PATCH",
                body: JSON.stringify({ reason: "Dashboard reset test" })
            }
        );
        assert.equal(revoke.response.status, 200, revoke.body.message);

        const revokedDashboard = await api(
            `/api/customer/${activeUserId}`
        );
        assert.equal(revokedDashboard.response.status, 200);
        assert.equal(revokedDashboard.body.membership, null);

        const restore = await api(
            `/api/admin/members/${activeMemberId}/restore`,
            { method: "POST", body: JSON.stringify({}) }
        );
        assert.equal(restore.response.status, 200, restore.body.message);

        const restoredDashboard = await api(
            `/api/customer/${activeUserId}`
        );
        assert.equal(restoredDashboard.response.status, 200);
        assert.equal(restoredDashboard.body.membership.status, "ACTIVE");

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

        const report = await api("/api/admin/reports?period=daily");
        assert.equal(report.response.status, 200, report.body.message);
        const hourlyReportRecord = report.body.records.find(
            record => Number(record.id) === Number(attendanceId)
        );
        const allDayReportRecord = report.body.records.find(
            record => Number(record.id) === Number(allDayGuest.body.attendance.id)
        );
        assert.equal(
            hourlyReportRecord.guest_time_purchased,
            "8 hours (₱240)"
        );
        assert.equal(
            allDayReportRecord.guest_time_purchased,
            "All-day access (₱100)"
        );

        const dayPassGuest = await createGuest({
            key: "suite-report-day-pass",
            phone: "09222220008",
            name: "Day Pass Report Guest",
            visitType: "DAY PASS"
        });
        assert.equal(dayPassGuest.response.status, 201, dayPassGuest.body.message);
        const dayPassReport = await api("/api/admin/reports?period=daily");
        const dayPassReportRecord = dayPassReport.body.records.find(
            record => Number(record.id) === Number(dayPassGuest.body.attendance.id)
        );
        assert.equal(
            dayPassReportRecord.guest_time_purchased,
            "All-day pass (₱100)"
        );

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
        const previousDayVisit = await pool.query(
            `
            INSERT INTO attendance (member_id, user_type, check_in)
            VALUES (
                $1,
                'MEMBER',
                DATE_TRUNC('day', CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')
                    - INTERVAL '1 day' + INTERVAL '12 hours'
            )
            RETURNING id, check_in, TO_CHAR(check_in, 'YYYY-MM-DD') AS visit_date
            `,
            [activeMemberId]
        );
        const autoCheckedOutCount =
            await require("../server").checkoutMembersAtClosing();
        assert.ok(autoCheckedOutCount >= 1);
        const autoCheckedOutVisit = await pool.query(
            `
            SELECT
                check_out,
                DATE_TRUNC('day', check_in) + INTERVAL '22 hours' AS closing_time
            FROM attendance
            WHERE id = $1
            `,
            [previousDayVisit.rows[0].id]
        );
        assert.equal(
            autoCheckedOutVisit.rows[0].check_out.getTime(),
            autoCheckedOutVisit.rows[0].closing_time.getTime(),
            "Open member visits should be checked out at the configured closing time"
        );
        assert.equal(
            await require("../server").checkoutMembersAtClosing(),
            0,
            "Automatic checkout should not alter visits that are already checked out"
        );
        const currentAttendance = await api("/api/admin/attendance?type=all");
        assert.equal(currentAttendance.response.status, 200);
        assert.ok(
            currentAttendance.body.attendance.every(
                record => Number(record.id) !== Number(previousDayVisit.rows[0].id)
            ),
            "Attendance should show today's visits only"
        );

        const reportResponses = await Promise.all([
            api("/api/admin/reports?period=daily"),
            api("/api/admin/reports?period=weekly"),
            api("/api/admin/reports?period=monthly"),
            api(`/api/admin/reports?period=custom&startDate=${today}&endDate=${today}`),
            api(`/api/admin/reports?period=custom&startDate=${previousDayVisit.rows[0].visit_date}&endDate=${previousDayVisit.rows[0].visit_date}`)
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
        assert.ok(
            reportResponses[4].body.records.some(
                record => Number(record.id) === Number(previousDayVisit.rows[0].id)
            ),
            "Previous-day visits should remain available in Reports"
        );
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
                    (user_id, member_id, amount, payment_method, gcash_reference, status)
                VALUES ($1, $2, 500, 'GCASH', 'TEST-MEMBER-SUBMITTED-REF', 'VERIFIED')
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
        assert.equal(
            memberTransactions.body.transactions[0].member_id,
            "TEST-ACTIVE-001"
        );
        assert.equal(
            memberTransactions.body.transactions[0].reference,
            "TEST-MEMBER-SUBMITTED-REF"
        );
        assert.equal(
            memberTransactions.body.transactions[0].access_type,
            "Monthly"
        );
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
        const memberTransactionsWithScreenshot = await api(
            "/api/admin/transactions?type=member"
        );
        assert.equal(memberTransactionsWithScreenshot.response.status, 200);
        assert.ok(memberTransactionsWithScreenshot.body.transactions.some(
            transaction =>
                transaction.payment_screenshot ===
                `/api/admin/applications/${applicationId}/screenshot`
        ));

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
