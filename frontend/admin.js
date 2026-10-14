// =====================================
// ANCHOR GYM - ADMIN DASHBOARD
// =====================================

let refreshTimer = null;
let countdownTimer = null;
let qrScanner = null;
let qrScanBusy = false;
let lastScannedQr = null;
let reportPeriod = "daily";
let attendanceRecords = [];
let transactionFilter = "all";
let activeGuestExtensionId = null;
let guestExtensionQuote = null;
let guestExtensionRequestKey = null;
let gymClosingTime = "22:00";

const guestPhoneInput =
    document.getElementById(
        "guestPhone"
    );

if (guestPhoneInput) {

    guestPhoneInput.addEventListener(
        "input",
        () => {

            guestPhoneInput.value =
                guestPhoneInput.value
                    .replace(/\D/g, "")
                    .slice(0, 11);

        }
    );

}


// =====================================
// CHECK ADMIN ACCESS
// =====================================

function checkAdminAccess() {

    const loggedIn =
        window.anchorSession.get(
            "anchorAdminLoggedIn"
        );

    if (
        loggedIn !==
        "true"
    ) {

        window.location.href =
            "admin-login.html";

        return false;
    }

    return true;
}


// =====================================
// API REQUEST
// =====================================

async function apiRequest(
    url,
    options = {}
) {

    const response =
        await fetch(
            window.anchorApiUrl(url),
            {
                cache:
                    "no-store",
                ...options
            }
        );

    const text =
        await response.text();

    let data;

    try {

        data =
            JSON.parse(
                text
            );

    } catch (error) {

        throw new Error(
            `Invalid server response from ${url}. HTTP ${response.status}`
        );
    }

    if (
        !response.ok ||
        data.success === false
    ) {

        throw new Error(
            data.message ||
            data.error ||
            `Request failed. HTTP ${response.status}`
        );
    }

    return data;
}


// =====================================
// PAGE NAVIGATION
// =====================================

function showPage(
    id,
    button = null
) {

    if (
        id !== "attendance" &&
        qrScanner
    ) {

        void stopQrScanner();

    }


    document
        .querySelectorAll(
            ".page"
        )
        .forEach(
            page => {

                page.classList.remove(
                    "active"
                );

            }
        );


    const page =
        document.getElementById(
            id
        );


    if (page) {

        page.classList.add(
            "active"
        );

    }


    document
        .querySelectorAll(
            ".sidebar button"
        )
        .forEach(
            item => {

                item.classList.remove(
                    "active"
                );

            }
        );


    if (button) {

        button.classList.add(
            "active"
        );

    } else {

        const sidebarButton =
            document.querySelector(
                `.sidebar button[onclick*="showPage('${id}'"]`
            );


        if (sidebarButton) {

            sidebarButton.classList.add(
                "active"
            );

        }

    }


    loadPageData(
        id
    );

}


// =====================================
// SHOW PAGE BY ID
// =====================================

function showPageById(
    id
) {

    const button =
        document.querySelector(
            `.sidebar button[onclick*="showPage('${id}'"]`
        );


    showPage(
        id,
        button
    );

}


// =====================================
// LOAD PAGE DATA
// =====================================

async function loadPageData(
    id
) {

    if (
        id ===
        "dashboard"
    ) {

        await Promise.all([
            loadAdminDashboard(),
            loadApplications(),
            loadMembers(),
            loadTransactions(),
            loadAttendance(),
            loadReports()
        ]);

    }


    if (
        id ===
        "members"
    ) {

        await loadMembers();

    }


    if (
        id ===
        "archived-members"
    ) {

        await loadArchivedMembers();

    }


    if (
        id ===
        "applications"
    ) {

        await loadApplications();

    }


    if (
        id ===
        "transactions"
    ) {

        await loadTransactions();

    }


    if (
        id ===
        "attendance"
    ) {

        await loadAttendance();

    }


    if (
        id ===
        "guests"
    ) {

        updateGuestPricing();

    }


    if (
        id ===
        "reports"
    ) {

        await loadReports();

    }


    if (
        id ===
        "equipment"
    ) {

        await loadEquipment();

    }

}


// =====================================
// ADMIN DASHBOARD
// =====================================

async function loadAdminDashboard() {

    try {

        const data =
            await apiRequest(
                "/api/admin/dashboard"
            );


        setText(
            "dashboardTotalMembers",
            data.totalRegistered ??
            0
        );


        setText(
            "dashboardActiveMembers",
            data.activeMembers ??
            0
        );


        setText(
            "dashboardPendingCount",
            data.pendingApplications ??
            0
        );


        setText(
            "dashboardRejectedCount",
            data.rejectedApplications ??
            0
        );


        setText(
            "dashboardOccupancy",
            `${data.occupancy ?? 0} / ${data.capacity ?? 120}`
        );


        setText(
            "dashboardMembersInside",
            data.membersInside ??
            0
        );


        setText(
            "dashboardGuestsInside",
            data.guestsInside ??
            0
        );

        setText(
            "attendanceTimedOutGuests",
            data.timedOutGuests ??
            0
        );


        setText(
            "dashboardActiveLegend",
            data.activeMembers ??
            0
        );


        setText(
            "dashboardExpiredLegend",
            data.expiredMembers ??
            0
        );


        setText(
            "dashboardRevokedLegend",
            data.revokedMembers ??
            0
        );


        updateMembershipPie({
            active: data.activeMembers,
            expired: data.expiredMembers,
            revoked: data.revokedMembers
        });


        updateOccupancyBar(
            data.occupancy ??
            0,

            data.capacity ??
            120
        );


    } catch (error) {

        console.error(
            "Dashboard loading error:",
            error
        );

    }

}

function updateMembershipPie(
    counts
) {

    const chart =
        document.getElementById(
            "dashboardMembershipTotal"
        );

    if (!chart) {
        return;
    }

    const segments = [
        {
            value: Number(counts.active) || 0,
            color: "#19d87d"
        },
        {
            value: Number(counts.expired) || 0,
            color: "#f3ad29"
        },
        {
            value: Number(counts.revoked) || 0,
            color: "#a78bfa"
        }
    ];

    const total =
        segments.reduce(
            (sum, segment) =>
                sum + Math.max(0, segment.value),
            0
        );

    setText(
        "dashboardMembershipTotal",
        total
    );

    if (total === 0) {
        chart.style.background =
            "conic-gradient(#252c34 0 100%)";
        return;
    }

    let currentPercent = 0;

    const gradientStops =
        segments
            .filter(segment => segment.value > 0)
            .map(segment => {

                const startPercent =
                    currentPercent;

                currentPercent +=
                    (segment.value / total) * 100;

                return `${segment.color} ${startPercent}% ${currentPercent}%`;

            });

    chart.style.background =
        `conic-gradient(${gradientStops.join(", ")})`;
}


// =====================================
// APPLICATIONS
// =====================================

async function loadApplications() {

    try {

        const data =
            await apiRequest(
                "/api/admin/applications"
            );


        const applications =
            data.applications ||
            [];


        const pendingApplications =
            applications.filter(
                application =>
                    getStatus(
                        application.status
                    ) ===
                    "PENDING"
            );


        const rejectedApplications =
            applications.filter(
                application =>
                    getStatus(
                        application.status
                    ) ===
                    "REJECTED"
            );


        setText(
            "applicationCount",
            pendingApplications.length
        );


        setText(
            "dashboardPendingCount",
            pendingApplications.length
        );


        setText(
            "dashboardRejectedCount",
            rejectedApplications.length
        );

        const recentDecisionsBody =
            document.getElementById(
                "recentDecisionsBody"
            );

        if (recentDecisionsBody) {

            const recentDecisions =
                applications
                    .filter(application => {
                        const status =
                            getStatus(application.status);

                        return (
                            status === "APPROVED" ||
                            status === "VERIFIED" ||
                            status === "REJECTED"
                        );
                    })
                    .slice(0, 5);

            recentDecisionsBody.innerHTML =
                recentDecisions.length === 0
                    ? `
                        <tr>
                            <td colspan="4" style="text-align:center;">
                                No completed application decisions yet.
                            </td>
                        </tr>
                    `
                    : recentDecisions
                        .map(createRecentDecisionRow)
                        .join("");
        }


        // ---------------------------------
        // PENDING DASHBOARD
        // ---------------------------------

        const pendingDashboard =
            document.getElementById(
                "pendingApplicationsDashboard"
            );


        if (pendingDashboard) {

            if (
                pendingApplications.length ===
                0
            ) {

                pendingDashboard.innerHTML = `
                    <p>
                        No pending applications.
                    </p>
                `;

            } else {

                pendingDashboard.innerHTML =
                    pendingApplications
                        .slice(
                            0,
                            5
                        )
                        .map(
                            application =>
                                `
                                <div class="pending-row">

                                    <div>

                                        <strong>
                                            ${escapeHtml(
                                                application.full_name ||
                                                "Unknown"
                                            )}
                                        </strong>

                                        <small>
                                            ${escapeHtml(
                                                application.email ||
                                                ""
                                            )}
                                        </small>

                                    </div>

                                    <div>

                                        <strong>
                                            ₱${Number(
                                                application.amount ||
                                                0
                                            ).toLocaleString()}
                                        </strong>

                                        <small>
                                            ${escapeHtml(
                                                application.membership_plan ||
                                                "Monthly"
                                            )}
                                        </small>

                                    </div>

                                    <div>

                                        <button
                                            class="approve"
                                            type="button"
                                            onclick="approveApplication(${application.id})">

                                            Approve

                                        </button>

                                        <button
                                            class="reject"
                                            type="button"
                                            onclick="rejectApplication(${application.id})">

                                            Reject

                                        </button>

                                    </div>

                                </div>
                                `
                        )
                        .join("");

            }

        }


        // ---------------------------------
        // APPLICATION TABLE
        // ---------------------------------

        const tableBody =
            document.getElementById(
                "applicationsTableBody"
            );


        if (tableBody) {

            if (
                pendingApplications.length ===
                0
            ) {

                tableBody.innerHTML = `
                    <tr>
                        <td
                            colspan="7"
                            style="text-align:center;">
                            No pending applications.
                        </td>
                    </tr>
                `;

            } else {

                tableBody.innerHTML =
                    pendingApplications
                        .map(
                            application =>
                                createApplicationRow(
                                    application
                                )
                        )
                        .join("");

            }

        }


    } catch (error) {

        console.error(
            "Applications loading error:",
            error
        );

    }

}


// =====================================
// RECENT DECISION ROW
// =====================================

function createRecentDecisionRow(
    application
) {

    const status =
        getStatus(
            application.status
        );

    return `
        <tr>
            <td>${escapeHtml(application.full_name || "-")}</td>
            <td>₱${Number(application.amount || 0).toLocaleString()}</td>
            <td>${escapeHtml(application.gcash_reference || "-")}</td>
            <td>
                <span class="status ${getStatusClass(status)}">
                    ${escapeHtml(status)}
                </span>
            </td>
        </tr>
    `;

}


// =====================================
// APPLICATION ROW
// =====================================

function createApplicationRow(
    application
) {

    const status =
        getStatus(
            application.status
        );


    const screenshot =
        application.payment_screenshot
            ? `
                <button
                    type="button"
                    onclick="viewScreenshot('${escapeAttribute(
                        application.payment_screenshot
                    )}')">

                    View

                </button>
            `
            : "None";


    const actions =
        status ===
        "PENDING"
            ? `
                <button
                    class="approve"
                    type="button"
                    onclick="approveApplication(${application.id})">

                    Approve

                </button>

                <button
                    class="reject"
                    type="button"
                    onclick="rejectApplication(${application.id})">

                    Reject

                </button>
            `
            : escapeHtml(
                status
            );


    return `
        <tr>

            <td>
                ${escapeHtml(
                    application.full_name ||
                    "-"
                )}
            </td>

            <td>
                ₱${Number(
                    application.amount ||
                    0
                ).toLocaleString()}
            </td>

            <td>
                ${escapeHtml(
                    application.gcash_reference ||
                    "-"
                )}
            </td>

            <td>
                ${formatDate(
                    application.payment_date
                )}
            </td>

            <td>
                ${screenshot}
            </td>

            <td>

                <span
                    class="status ${getStatusClass(status)}">

                    ${escapeHtml(
                        status
                    )}

                </span>

            </td>

            <td>
                ${actions}
            </td>

        </tr>
    `;

}


// =====================================
// APPROVE APPLICATION
// =====================================

async function approveApplication(
    applicationId
) {

    try {

        const applicationsData =
            await apiRequest(
                "/api/admin/applications"
            );


        const application =
            (
                applicationsData.applications ||
                []
            ).find(
                item =>
                    Number(
                        item.id
                    ) ===
                    Number(
                        applicationId
                    )
            );


        if (!application) {

            alert(
                "Application not found."
            );

            return;

        }


        const customerData =
            await apiRequest(
                `/api/customer/${application.user_id}`
            );


        const membership =
            customerData.membership;


        if (membership) {

            const currentStatus =
                getStatus(
                    membership.status
                );


            if (
                currentStatus ===
                "ACTIVE"
            ) {

                const proceed =
                    confirm(
                        "This customer already has an active membership. Approving this application will renew the membership. Continue?"
                    );


                if (!proceed) {

                    return;

                }

            }

        }


        const confirmed =
            confirm(
                `Approve the membership application for ${application.full_name || "this customer"}?`
            );


        if (!confirmed) {

            return;

        }


        const data =
            await apiRequest(
                `/api/admin/applications/${applicationId}/approve`,
                {
                    method:
                        "POST"
                }
            );


        alert(
            data.message ||
            "Application approved."
        );


        await Promise.all([
            loadAdminDashboard(),
            loadApplications(),
            loadMembers(),
            loadTransactions()
        ]);


    } catch (error) {

        console.error(
            "Approve application error:",
            error
        );


        alert(
            error.message ||
            "Unable to approve application."
        );

    }

}


// =====================================
// REASON DIALOG
// =====================================

function askForReason(
    title,
    reasons
) {

    return new Promise(
        resolve => {

            const existing =
                document.getElementById(
                    "reasonDialogOverlay"
                );


            if (existing) {

                existing.remove();

            }


            const overlay =
                document.createElement(
                    "div"
                );


            overlay.id =
                "reasonDialogOverlay";


            overlay.style.position =
                "fixed";

            overlay.style.inset =
                "0";

            overlay.style.background =
                "rgba(0, 0, 0, 0.55)";

            overlay.style.display =
                "flex";

            overlay.style.alignItems =
                "center";

            overlay.style.justifyContent =
                "center";

            overlay.style.zIndex =
                "99999";

            overlay.style.padding =
                "20px";


            const dialog =
                document.createElement(
                    "div"
                );


            dialog.style.background =
                "#ffffff";

            dialog.style.width =
                "100%";

            dialog.style.maxWidth =
                "500px";

            dialog.style.borderRadius =
                "12px";

            dialog.style.padding =
                "24px";

            dialog.style.boxShadow =
                "0 20px 50px rgba(0,0,0,0.25)";

            dialog.style.boxSizing =
                "border-box";


            const heading =
                document.createElement(
                    "h2"
                );


            heading.textContent =
                title;


            heading.style.marginTop =
                "0";


            const label =
                document.createElement(
                    "label"
                );


            label.textContent =
                "Select Reason";


            label.style.display =
                "block";

            label.style.marginBottom =
                "8px";

            label.style.fontWeight =
                "600";


            const select =
                document.createElement(
                    "select"
                );


            select.style.width =
                "100%";

            select.style.padding =
                "12px";

            select.style.borderRadius =
                "8px";

            select.style.border =
                "1px solid #ccc";

            select.style.boxSizing =
                "border-box";


            const defaultOption =
                document.createElement(
                    "option"
                );


            defaultOption.value =
                "";

            defaultOption.textContent =
                "Select a reason";


            select.appendChild(
                defaultOption
            );


            reasons.forEach(
                reason => {

                    const option =
                        document.createElement(
                            "option"
                        );


                    option.value =
                        reason;


                    option.textContent =
                        reason;


                    select.appendChild(
                        option
                    );

                }
            );


            const otherGroup =
                document.createElement(
                    "div"
                );


            otherGroup.style.display =
                "none";

            otherGroup.style.marginTop =
                "15px";


            const otherLabel =
                document.createElement(
                    "label"
                );


            otherLabel.textContent =
                "Please specify";


            otherLabel.style.display =
                "block";

            otherLabel.style.marginBottom =
                "8px";

            otherLabel.style.fontWeight =
                "600";


            const otherTextarea =
                document.createElement(
                    "textarea"
                );


            otherTextarea.rows =
                4;

            otherTextarea.placeholder =
                "Enter the reason";


            otherTextarea.style.width =
                "100%";

            otherTextarea.style.padding =
                "12px";

            otherTextarea.style.borderRadius =
                "8px";

            otherTextarea.style.border =
                "1px solid #ccc";

            otherTextarea.style.boxSizing =
                "border-box";

            otherTextarea.style.resize =
                "vertical";


            otherGroup.appendChild(
                otherLabel
            );


            otherGroup.appendChild(
                otherTextarea
            );


            select.addEventListener(
                "change",
                () => {

                    if (
                        select.value ===
                        "Other..."
                    ) {

                        otherGroup.style.display =
                            "block";

                    } else {

                        otherGroup.style.display =
                            "none";

                        otherTextarea.value =
                            "";

                    }

                }
            );


            const buttons =
                document.createElement(
                    "div"
                );


            buttons.style.display =
                "flex";

            buttons.style.justifyContent =
                "flex-end";

            buttons.style.gap =
                "10px";

            buttons.style.marginTop =
                "20px";


            const cancelButton =
                document.createElement(
                    "button"
                );


            cancelButton.type =
                "button";

            cancelButton.textContent =
                "Cancel";


            cancelButton.style.padding =
                "10px 18px";


            const confirmButton =
                document.createElement(
                    "button"
                );


            confirmButton.type =
                "button";

            confirmButton.textContent =
                "Continue";


            confirmButton.className =
                "red-button";


            confirmButton.style.padding =
                "10px 18px";


            cancelButton.addEventListener(
                "click",
                () => {

                    overlay.remove();

                    resolve(
                        null
                    );

                }
            );


            confirmButton.addEventListener(
                "click",
                () => {

                    let finalReason =
                        select.value;


                    if (
                        !finalReason
                    ) {

                        alert(
                            "Please select a reason."
                        );

                        return;

                    }


                    if (
                        finalReason ===
                        "Other..."
                    ) {

                        finalReason =
                            otherTextarea
                                .value
                                .trim();


                        if (
                            !finalReason
                        ) {

                            alert(
                                "Please enter the reason."
                            );

                            return;

                        }

                    }


                    overlay.remove();

                    resolve(
                        finalReason
                    );

                }
            );


            overlay.addEventListener(
                "click",
                event => {

                    if (
                        event.target ===
                        overlay
                    ) {

                        overlay.remove();

                        resolve(
                            null
                        );

                    }

                }
            );


            buttons.appendChild(
                cancelButton
            );


            buttons.appendChild(
                confirmButton
            );


            dialog.appendChild(
                heading
            );


            dialog.appendChild(
                label
            );


            dialog.appendChild(
                select
            );


            dialog.appendChild(
                otherGroup
            );


            dialog.appendChild(
                buttons
            );


            overlay.appendChild(
                dialog
            );


            document.body.appendChild(
                overlay
            );

        }
    );

}


// =====================================
// REJECT APPLICATION
// =====================================

async function rejectApplication(
    applicationId
) {

    const reason =
        await askForReason(
            "Reason for Rejection",
            [
                "Invalid payment proof",
                "Incorrect GCash reference",
                "Payment amount is incorrect",
                "Payment screenshot is unclear",
                "Duplicate application",
                "Incomplete information",
                "Payment could not be verified",
                "Other..."
            ]
        );


    if (
        reason ===
        null
    ) {

        return;

    }


    try {

        const data =
            await apiRequest(
                `/api/admin/applications/${applicationId}/reject`,
                {
                    method:
                        "POST",

                    headers: {
                        "Content-Type":
                            "application/json"
                    },

                    body:
                        JSON.stringify({
                            reason:
                                reason
                        })
                }
            );


        alert(
            data.message ||
            "Application rejected."
        );


        await Promise.all([
            loadAdminDashboard(),
            loadApplications()
        ]);


    } catch (error) {

        console.error(
            "Reject application error:",
            error
        );


        alert(
            error.message ||
            "Unable to reject application."
        );

    }

}


// =====================================
// MEMBERS
// =====================================

async function loadMembers() {

    try {

        const data =
            await apiRequest(
                "/api/admin/members"
            );


        const members =
            data.members ||
            [];


        const active =
            members.filter(
                member =>
                    getStatus(
                        member.status
                    ) ===
                    "ACTIVE"
            );


        setText(
            "dashboardActiveMembers",
            active.length
        );


        const body =
            document.getElementById(
                "membersTableBody"
            );


        if (!body) {

            return;

        }


        if (
            members.length ===
            0
        ) {

            body.innerHTML = `
                <tr>
                    <td
                        colspan="8"
                        style="text-align:center;">
                        No member data available yet.
                    </td>
                </tr>
            `;

            updateBulkSelection(
                "membersTableBody",
                "selectAllMembers",
                "archiveSelectedMembersButton",
                "membersSelectedCount"
            );

            return;

        }


        body.innerHTML =
            members
                .map(
                    member =>
                        `
                        <tr>

                            <td>
                                <input
                                    class="row-select"
                                    type="checkbox"
                                    data-selectable="member"
                                    data-record-id="${Number(member.id)}"
                                    aria-label="Select ${escapeAttribute(
                                        member.full_name ||
                                        member.member_id ||
                                        "member"
                                    )}"
                                    onchange="updateBulkSelection('membersTableBody', 'selectAllMembers', 'archiveSelectedMembersButton', 'membersSelectedCount')">
                            </td>

                            <td>
                                ${escapeHtml(
                                    member.member_id ||
                                    "-"
                                )}
                            </td>

                            <td>
                                ${escapeHtml(
                                    member.full_name ||
                                    "-"
                                )}
                            </td>

                            <td>
                                ${escapeHtml(
                                    member.registration_type ||
                                    "-"
                                )}
                            </td>

                            <td>
                                ${escapeHtml(
                                    member.membership_plan ||
                                    "-"
                                )}
                            </td>

                            <td>
                                ${formatDate(
                                    member.expiration_date
                                )}
                            </td>

                            <td>

                                <span
                                    class="status ${getStatusClass(
                                        member.status
                                    )}">

                                    ${escapeHtml(
                                        getStatus(
                                            member.status
                                        )
                                    )}

                                </span>

                            </td>

                            <td>
                                ${
                                    getStatus(member.status) === "REVOKED"
                                        ? `
                                            <button
                                                class="restore-button"
                                                type="button"
                                                onclick="restoreRevokedMember(${Number(member.id)})">
                                                Restore
                                            </button>
                                        `
                                        : `
                                            <button
                                                class="remove-button"
                                                type="button"
                                                onclick="revokeMember(${Number(member.id)})">
                                                Revoke
                                            </button>
                                        `
                                }
                            </td>

                        </tr>
                        `
                )
                .join("");

        filterTableRows(
            "membersSearch",
            "membersTableBody"
        );

        updateBulkSelection(
            "membersTableBody",
            "selectAllMembers",
            "archiveSelectedMembersButton",
            "membersSelectedCount"
        );

    } catch (error) {

        console.error(
            "Members loading error:",
            error
        );

    }

}


// =====================================
// REVOKE MEMBER
// =====================================

async function revokeMember(
    memberId
) {

    const reason =
        await askForReason(
            "Reason for Revoking Member",
            [
                "Membership violation",
                "Expired membership",
                "Customer requested revocation",
                "False or invalid information",
                "Repeated rule violation",
                "Payment issue",
                "Misconduct",
                "Other..."
            ]
        );


    if (
        reason ===
        null
    ) {

        return;

    }


    const confirmed =
        confirm(
            `Are you sure you want to revoke this membership?\n\nReason: ${reason}`
        );


    if (!confirmed) {

        return;

    }


    try {

        const data =
            await apiRequest(
                `/api/admin/members/${memberId}/revoke`,
                {
                    method: "PATCH",

                    headers: {
                        "Content-Type": "application/json"
                    },

                    body: JSON.stringify({ reason })
                }
            );


        alert(
            data.message ||
            "Membership revoked successfully."
        );


        await Promise.all([
            loadMembers(),
            loadArchivedMembers(),
            loadAdminDashboard(),
            loadTransactions(),
            loadAttendance(),
            loadApplications()
        ]);


    } catch (error) {

        console.error("Revoke member error:", error);


        alert(
            error.message ||
            "Unable to revoke membership."
        );

    }

}

async function restoreRevokedMember(memberId) {

    if (!confirm("Restore this revoked membership and resume its remaining days?")) {
        return;
    }

    try {
        const data = await apiRequest(
            `/api/admin/members/${memberId}/restore`,
            { method: "POST" }
        );

        alert(data.message || "Membership restored successfully.");
        await Promise.all([
            loadMembers(),
            loadArchivedMembers(),
            loadAdminDashboard(),
            loadAttendance()
        ]);
    } catch (error) {
        console.error("Restore revoked member error:", error);
        alert(error.message || "Unable to restore membership.");
    }

}

async function archiveSelectedMembers() {

    const selectedIds =
        getSelectedRecordIds(
            "membersTableBody"
        );

    if (!selectedIds.length) {
        return;
    }

    const reason =
        await askForReason(
            "Reason for Removing Members",
            [
                "Membership violation",
                "Expired membership",
                "Customer requested removal",
                "False or invalid information",
                "Repeated rule violation",
                "Payment issue",
                "Misconduct",
                "Other..."
            ]
        );

    if (reason === null) {
        return;
    }

    const confirmed =
        confirm(
            `Archive ${selectedIds.length} selected member(s)?\n\nReason: ${reason}`
        );

    if (!confirmed) {
        return;
    }

    const failedIds = [];

    for (const memberId of selectedIds) {

        try {

            await apiRequest(
                `/api/admin/members/${memberId}`,
                {
                    method: "DELETE",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        reason
                    })
                }
            );

        } catch (error) {

            console.error(
                `Unable to archive selected member ${memberId}:`,
                error
            );

            failedIds.push(memberId);

        }
    }

    await Promise.all([
        loadMembers(),
        loadArchivedMembers(),
        loadAdminDashboard(),
        loadTransactions(),
        loadAttendance(),
        loadApplications()
    ]);

    if (failedIds.length) {

        alert(
            `${selectedIds.length - failedIds.length} member(s) archived. ` +
            `Unable to archive member ID(s): ${failedIds.join(", ")}. ` +
            "A member currently inside the gym cannot be removed until checked out."
        );

        return;
    }

    alert(
        `${selectedIds.length} member(s) archived successfully.`
    );
}


function filterTableRows(
    inputId,
    tableBodyId
) {

    const input =
        document.getElementById(inputId);

    const body =
        document.getElementById(tableBodyId);

    if (!input || !body) {
        return;
    }

    const searchText =
        input.value.trim().toLowerCase();

    body.querySelectorAll("tr").forEach(
        row => {

            const rowText =
                row.textContent.toLowerCase();

            row.hidden =
                Boolean(searchText) &&
                !rowText.includes(searchText);

        }
    );

    if (tableBodyId === "membersTableBody") {
        updateBulkSelection(
            "membersTableBody",
            "selectAllMembers",
            "archiveSelectedMembersButton",
            "membersSelectedCount"
        );
    }

    if (tableBodyId === "archivedMembersTableBody") {
        updateArchiveMemberSelection();
    }
}


function getSelectedRecordIds(
    tableBodyId,
    selectableType = null
) {

    const body =
        document.getElementById(tableBodyId);

    if (!body) {
        return [];
    }

    return Array.from(
        body.querySelectorAll(
            "input.row-select:checked"
        )
    )
        .filter(
            checkbox =>
                !checkbox.closest("tr").hidden &&
                (
                    !selectableType ||
                    checkbox.dataset.selectable === selectableType
                )
        )
        .map(
            checkbox =>
                Number(checkbox.dataset.recordId)
        )
        .filter(Number.isInteger);
}


function updateBulkSelection(
    tableBodyId,
    selectAllId,
    buttonId,
    countId,
    selectableType = null
) {

    const body =
        document.getElementById(tableBodyId);

    const selectAll =
        document.getElementById(selectAllId);

    const button =
        document.getElementById(buttonId);

    const count =
        document.getElementById(countId);

    if (!body) {
        return;
    }

    const eligibleCheckboxes =
        Array.from(
            body.querySelectorAll("input.row-select")
        )
            .filter(
                checkbox =>
                    !checkbox.closest("tr").hidden &&
                    (
                        !selectableType ||
                        checkbox.dataset.selectable === selectableType
                    )
            );

    const checkedCount =
        eligibleCheckboxes.filter(
            checkbox => checkbox.checked
        ).length;

    if (count) {
        count.textContent =
            `${checkedCount} selected`;
    }

    if (button) {
        button.disabled =
            checkedCount === 0;
    }

    if (selectAll) {
        selectAll.checked =
            eligibleCheckboxes.length > 0 &&
            checkedCount === eligibleCheckboxes.length;

        selectAll.indeterminate =
            checkedCount > 0 &&
            checkedCount < eligibleCheckboxes.length;

        selectAll.disabled =
            eligibleCheckboxes.length === 0;
    }
}


function toggleSelectAllRows(
    tableBodyId,
    selectAllId,
    buttonId,
    countId,
    selectableType = null
) {

    const body =
        document.getElementById(tableBodyId);

    const selectAll =
        document.getElementById(selectAllId);

    if (!body || !selectAll) {
        return;
    }

    body.querySelectorAll("input.row-select").forEach(
        checkbox => {

            const row =
                checkbox.closest("tr");

            const eligible =
                !row.hidden &&
                (
                    !selectableType ||
                    checkbox.dataset.selectable === selectableType
                );

            if (eligible) {
                checkbox.checked =
                    selectAll.checked;
            }

        }
    );

    updateBulkSelection(
        tableBodyId,
        selectAllId,
        buttonId,
        countId,
        selectableType
    );
}

function getSelectedArchiveIds(
    selectableType
) {

    const body =
        document.getElementById(
            "archivedMembersTableBody"
        );

    if (!body) {
        return [];
    }

    return Array.from(
        body.querySelectorAll(
            "input.archive-row-select:checked"
        )
    )
        .filter(
            checkbox =>
                !checkbox.closest("tr").hidden &&
                checkbox.dataset.selectable === selectableType
        )
        .map(
            checkbox =>
                Number(checkbox.dataset.recordId)
        )
        .filter(Number.isInteger);
}


function updateArchiveMemberSelection() {

    const body =
        document.getElementById(
            "archivedMembersTableBody"
        );

    const selectAll =
        document.getElementById(
            "selectAllArchivedMembers"
        );

    const restoreButton =
        document.getElementById(
            "restoreSelectedArchivedMembersButton"
        );

    const deleteButton =
        document.getElementById(
            "deleteSelectedArchivedMembersButton"
        );

    const count =
        document.getElementById(
            "archivedMembersSelectedCount"
        );

    if (!body) {
        return;
    }

    const visibleCheckboxes =
        Array.from(
            body.querySelectorAll(
                "input.archive-row-select"
            )
        )
            .filter(
                checkbox =>
                    !checkbox.closest("tr").hidden
            );

    const selectedCheckboxes =
        visibleCheckboxes.filter(
            checkbox =>
                checkbox.checked
        );

    const selectedCount =
        selectedCheckboxes.length;

    if (count) {
        count.textContent =
            `${selectedCount} selected`;
    }

    if (restoreButton) {
        restoreButton.disabled =
            !selectedCheckboxes.some(
                checkbox =>
                    checkbox.dataset.selectable === "archived"
            );
    }

    if (deleteButton) {
        deleteButton.disabled =
            !selectedCheckboxes.some(
                checkbox =>
                    checkbox.dataset.selectable === "restored"
            );
    }

    if (selectAll) {
        selectAll.checked =
            visibleCheckboxes.length > 0 &&
            selectedCount === visibleCheckboxes.length;

        selectAll.indeterminate =
            selectedCount > 0 &&
            selectedCount < visibleCheckboxes.length;

        selectAll.disabled =
            visibleCheckboxes.length === 0;
    }
}


function toggleSelectAllArchivedMembers(
    selected
) {

    const body =
        document.getElementById(
            "archivedMembersTableBody"
        );

    if (!body) {
        return;
    }

    body.querySelectorAll(
        "input.archive-row-select"
    ).forEach(
        checkbox => {

            if (!checkbox.closest("tr").hidden) {
                checkbox.checked =
                    selected;
            }

        }
    );

    updateArchiveMemberSelection();
}


// =====================================
// ARCHIVED MEMBERS
// =====================================

async function loadArchivedMembers() {

    const body =
        document.getElementById(
            "archivedMembersTableBody"
        );


    if (!body) {

        return;

    }


    try {

        const data =
            await apiRequest(
                "/api/admin/archived-members"
            );


        const archivedMembers =
            data.archivedMembers ||
            [];


        if (
            archivedMembers.length ===
            0
        ) {

            body.innerHTML = `
                <tr>
                    <td
                        colspan="9"
                        style="text-align:center;">
                        No archived memberships.
                    </td>
                </tr>
            `;

            updateArchiveMemberSelection();

            return;

        }


        body.innerHTML =
            archivedMembers
                .map(
                    member => {

                        const revoked =
                            member.record_type === "REVOKED" ||
                            getStatus(member.status) === "REVOKED";

                        const restored =
                            !revoked &&
                            (
                                Boolean(member.restored_at) ||
                                getStatus(member.status) === "RESTORED"
                            );


                        const displayStatus =
                            revoked
                                ? "REVOKED"
                                : restored
                                ? "RESTORED"
                                : "ARCHIVED";


                        const action =
                            revoked
                                ? `
                                    <button
                                        class="restore-button"
                                        type="button"
                                        onclick="restoreRevokedMember(${Number(member.original_member_id)})">
                                        Restore
                                    </button>
                                `
                                : restored
                                ? `
                                    <button
                                        class="remove-button"
                                        type="button"
                                        onclick="deleteArchivedMember(${member.archive_id})">

                                        Delete

                                    </button>
                                `
                                : `
                                    <button
                                        class="restore-button"
                                        type="button"
                                        onclick="restoreArchivedMember(${member.archive_id})">

                                        Restore

                                    </button>
                                `;


                        return `
                            <tr>

                                <td>
                                    ${
                                        revoked
                                            ? ""
                                            : `
                                                <input
                                                    class="archive-row-select"
                                                    type="checkbox"
                                                    data-selectable="${restored ? "restored" : "archived"}"
                                                    data-record-id="${Number(member.archive_id)}"
                                                    aria-label="Select ${restored ? "restored" : "archived"} member ${escapeAttribute(
                                                        member.full_name ||
                                                        member.member_id ||
                                                        "record"
                                                    )}"
                                                    onchange="updateArchiveMemberSelection()">
                                            `
                                    }
                                </td>

                                <td>
                                    ${escapeHtml(
                                        member.member_id ||
                                        "-"
                                    )}
                                </td>

                                <td>
                                    ${escapeHtml(
                                        member.full_name ||
                                        "-"
                                    )}
                                </td>

                                <td>
                                    ${escapeHtml(
                                        member.membership_plan ||
                                        "-"
                                    )}
                                </td>

                                <td>
                                    ${formatDate(
                                        member.start_date
                                    )}
                                </td>

                                <td>
                                    ${formatDate(
                                        member.expiration_date
                                    )}
                                </td>

                                <td>
                                    ${formatDateTime(
                                        member.archived_at
                                    )}
                                </td>

                                <td>

                                    <span
                                        class="status ${getStatusClass(
                                            displayStatus
                                        )}">

                                        ${displayStatus}

                                    </span>

                                </td>

                                <td>
                                    ${action}
                                </td>

                            </tr>
                        `;

                    }
                )
                .join("");

        filterTableRows(
            "archivedMembersSearch",
            "archivedMembersTableBody"
        );

        updateArchiveMemberSelection();

    } catch (error) {

        console.error(
            "Archived members loading error:",
            error
        );


        body.innerHTML = `
            <tr>
                <td
                    colspan="9"
                    style="text-align:center;">
                    Unable to load archived memberships.
                </td>
            </tr>
        `;

    }

}


// =====================================
// RESTORE MEMBER
// =====================================

async function restoreArchivedMember(
    archiveId
) {

    const confirmed =
        confirm(
            "Restore this archived membership?"
        );


    if (!confirmed) {

        return;

    }


    try {

        const data =
            await apiRequest(
                `/api/admin/archived-members/${archiveId}/restore`,
                {
                    method:
                        "POST"
                }
            );


        alert(
            data.message ||
            "Membership restored successfully."
        );


        await Promise.all([
            loadArchivedMembers(),
            loadMembers(),
            loadAdminDashboard(),
            loadTransactions(),
            loadApplications(),
            loadAttendance()
        ]);


    } catch (error) {

        console.error(
            "Restore member error:",
            error
        );


        alert(
            error.message ||
            "Unable to restore membership."
        );

    }

}


// =====================================
// DELETE ARCHIVED MEMBER
// =====================================

async function deleteArchivedMember(
    archiveId
) {

    const confirmed =
        confirm(
            "Are you sure you want to permanently delete this restored archive history?"
        );


    if (!confirmed) {

        return;

    }


    try {

        const data =
            await apiRequest(
                `/api/admin/archived-members/${archiveId}`,
                {
                    method:
                        "DELETE"
                }
            );


        alert(
            data.message ||
            "Archived history deleted successfully."
        );


        await loadArchivedMembers();


    } catch (error) {

        console.error(
            "Delete archived member error:",
            error
        );


        alert(
            error.message ||
            "Unable to delete archived member history."
        );

    }

}

async function restoreSelectedArchivedMembers() {

    const archiveIds =
        getSelectedArchiveIds("archived");

    if (!archiveIds.length) {
        return;
    }

    const confirmed =
        confirm(
            `Restore ${archiveIds.length} selected archived membership(s)?`
        );

    if (!confirmed) {
        return;
    }

    const failedIds = [];

    for (const archiveId of archiveIds) {

        try {

            await apiRequest(
                `/api/admin/archived-members/${archiveId}/restore`,
                {
                    method: "POST"
                }
            );

        } catch (error) {

            console.error(
                `Unable to restore archived member record ${archiveId}:`,
                error
            );

            failedIds.push(archiveId);

        }
    }

    await Promise.all([
        loadArchivedMembers(),
        loadMembers(),
        loadAdminDashboard(),
        loadTransactions(),
        loadApplications(),
        loadAttendance()
    ]);

    if (failedIds.length) {
        alert(
            `${archiveIds.length - failedIds.length} membership(s) restored. ` +
            `Unable to restore archive ID(s): ${failedIds.join(", ")}.`
        );

        return;
    }

    alert(
        `${archiveIds.length} membership(s) restored successfully.`
    );
}


async function deleteSelectedArchivedMembers() {

    const archiveIds =
        getSelectedArchiveIds("restored");

    if (!archiveIds.length) {
        return;
    }

    const confirmed =
        confirm(
            `Permanently delete the history for ${archiveIds.length} selected restored membership(s)?`
        );

    if (!confirmed) {
        return;
    }

    const failedIds = [];

    for (const archiveId of archiveIds) {

        try {

            await apiRequest(
                `/api/admin/archived-members/${archiveId}`,
                {
                    method: "DELETE"
                }
            );

        } catch (error) {

            console.error(
                `Unable to delete restored archive record ${archiveId}:`,
                error
            );

            failedIds.push(archiveId);

        }
    }

    await loadArchivedMembers();

    if (failedIds.length) {
        alert(
            `${archiveIds.length - failedIds.length} archive history record(s) deleted. ` +
            `Unable to delete archive ID(s): ${failedIds.join(", ")}.`
        );

        return;
    }

    alert(
        `${archiveIds.length} archive history record(s) deleted successfully.`
    );
}


// =====================================
// TRANSACTIONS
// =====================================

async function loadTransactions(
    filterType = transactionFilter
) {

    try {

        if (!["all", "member", "guest"].includes(filterType)) {
            return;
        }

        transactionFilter = filterType;
        document
            .querySelectorAll("[data-transaction-filter]")
            .forEach(button => {
                button.setAttribute(
                    "aria-pressed",
                    String(button.dataset.transactionFilter === transactionFilter)
                );
            });

        const data =
            await apiRequest(
                `/api/admin/transactions?type=${encodeURIComponent(transactionFilter)}`
            );

        const memberBody =
            document.getElementById(
                "memberTransactionsTableBody"
            );

        const guestBody =
            document.getElementById(
                "guestTransactionsTableBody"
            );

        const memberTransactions =
            data.memberTransactions || [];
        const guestTransactions =
            data.guestTransactions || [];
        const transactionCards =
            document.querySelectorAll(".transactions-grid > .card");

        if (transactionCards[0]) {
            transactionCards[0].hidden = transactionFilter === "guest";
        }
        if (transactionCards[1]) {
            transactionCards[1].hidden = transactionFilter === "member";
        }

        if (memberBody) {
            memberBody.innerHTML = memberTransactions.length
                ? memberTransactions.map(transaction => `
                    <tr>
                        <td>${Number(transaction.id)}</td>
                        <td>${escapeHtml(transaction.full_name || "-")}</td>
                        <td>₱${Number(transaction.amount || 0).toLocaleString()}</td>
                        <td>${escapeHtml(transaction.gcash_reference || "-")}</td>
                        <td>
                            <span class="status ${getStatusClass(transaction.status)}">
                                ${escapeHtml(getStatus(transaction.status) || "-")}
                            </span>
                        </td>
                    </tr>
                `).join("")
                : `
                    <tr>
                        <td colspan="5" style="text-align:center;">
                            No member transactions available.
                        </td>
                    </tr>
                `;
        }

        if (guestBody) {
            guestBody.innerHTML = guestTransactions.length
                ? guestTransactions.map(transaction => `
                    <tr>
                        <td>${Number(transaction.id)}</td>
                        <td>${escapeHtml(transaction.guest_name || "-")}</td>
                        <td>${transaction.check_in ? formatDateTime(transaction.check_in) : "-"}</td>
                        <td>${transaction.check_out ? formatDateTime(transaction.check_out) : "-"}</td>
                        <td>${escapeHtml(transaction.extension_type || transaction.visit_type || "Guest visit")}</td>
                        <td>${transaction.additional_hours ? `${Number(transaction.additional_hours)} hour(s)` : "-"}</td>
                        <td>₱${Number(transaction.amount || 0).toLocaleString()}</td>
                        <td>${escapeHtml(transaction.payment_method || "-")}</td>
                        <td>
                            <span class="status ${getStatusClass(transaction.payment_status || "CONFIRMED")}">
                                ${escapeHtml(transaction.payment_status || "CONFIRMED")}
                            </span>
                        </td>
                        <td>${escapeHtml(transaction.transaction_reference || "-")}</td>
                        <td>${formatDateTime(transaction.transaction_date)}</td>
                    </tr>
                `).join("")
                : `
                    <tr>
                        <td colspan="11" style="text-align:center;">
                            No guest transactions available.
                        </td>
                    </tr>
                `;
        }

    } catch (error) {

        console.error(
            "Transactions loading error:",
            error
        );

    }

}


// =====================================
// ATTENDANCE
// =====================================

async function loadAttendance(
    filterType = document.getElementById("attendanceTypeFilter")?.value || "all"
) {

    try {

        if (!["all", "member", "guest"].includes(filterType)) {
            return;
        }

        const data =
            await apiRequest(
                `/api/admin/attendance?type=${encodeURIComponent(filterType)}`
            );

        if (data.closingTime) {
        gymClosingTime = data.closingTime;
        const closingLabel = formatConfiguredClosingTime(data.closingTime);
        setText("guestClosingTime", closingLabel);
        setText("guestDayPassClosingTime", closingLabel);
        setText(
            "qrScanStatus",
            `Scan a member QR code from 8:00 AM to ${closingLabel} Manila time. Record checkout only when the member actually leaves.`
        );
        }

        const attendance =
            data.attendance ||
            [];

        attendanceRecords = attendance;
        const membersInside = Number(data.membersInside || 0);
        const guestsInside = Number(data.guestsInside || 0);
        const occupancy = Number(data.currentOccupancy || 0);
        const timedOutGuests = attendance.filter(
            record =>
                String(record.user_type || "").toUpperCase() === "GUEST" &&
                !record.check_out &&
                record.timed_out === true
        ).length;
        const filterSelect =
            document.getElementById("attendanceTypeFilter");

        if (filterSelect) {
            filterSelect.value = filterType;
        }

        setText(
            "attendanceOccupancy",
            `${occupancy} / 120`
        );

        setText(
            "attendanceMembersInside",
            membersInside
        );

        setText(
            "attendanceGuestsInside",
            guestsInside
        );
        setText(
            "attendanceTimedOutGuests",
            timedOutGuests
        );

        setText(
            "dashboardOccupancy",
            `${occupancy} / 120`
        );

        setText(
            "dashboardMembersInside",
            membersInside
        );

        setText(
            "dashboardGuestsInside",
            guestsInside
        );

        updateOccupancyBar(
            occupancy,
            120
        );

        const body =
            document.getElementById(
                "attendanceTableBody"
            );

        if (!body) {
            return;
        }

        if (attendance.length === 0) {

            body.innerHTML = `
                <tr>
                    <td
                        colspan="7"
                        style="text-align:center;"
                    >
                        No attendance records found.
                    </td>
                </tr>
            `;

            updateBulkSelection(
                "attendanceTableBody",
                "selectAllAttendance",
                "deleteSelectedAttendanceButton",
                "attendanceSelectedCount",
                "guest"
            );

            return;

        }

        body.innerHTML =
            attendance
                .map(
                    record => {

                        const userType =
                            String(
                                record.user_type ||
                                ""
                            ).toUpperCase();

                        const isGuest =
                            userType === "GUEST";

                        const isCheckedOut =
                            Boolean(
                                record.check_out
                            );

                        let remainingHtml =
                            "<span>-</span>";

                        let actionHtml =
                            "";

                        if (isGuest) {

                            if (isCheckedOut) {
                                remainingHtml = `
                                    <span class="guest">CHECKED OUT</span>
                                `;

                            } else {
                                const remainingSeconds =
                                    Number(
                                        record.remaining_seconds
                                    );

                                if (
                                    Number.isFinite(
                                        remainingSeconds
                                    ) &&
                                    remainingSeconds > 0
                                ) {

                                    remainingHtml = `
                                        <span
                                            class="countdown countdown-active"
                                            data-guest-countdown="true"
                                            data-attendance-id="${escapeAttribute(
                                                record.id
                                            )}"
                                            data-remaining-seconds="${escapeAttribute(
                                                remainingSeconds
                                            )}"
                                            data-countdown-last-update=""
                                        >
                                            ${formatCountdown(
                                                remainingSeconds
                                            )}
                                        </span>

                                        <small class="countdown-note">
                                            CHECKED IN · Expires ${escapeHtml(
                                                formatGuestEndLabel(
                                                    record.guest_end_time_epoch ||
                                                    record.guest_end_time
                                                )
                                            )}
                                        </small>
                                    `;

                                } else {
                                    remainingHtml = `
                                        <span class="timed-out-label">
                                            TIMED OUT / OVERDUE
                                        </span>
                                        <small class="countdown-note">
                                            Still checked in; checkout not recorded
                                        </small>
                                    `;
                                }
                            }

                            actionHtml = `
                                <div class="attendance-actions">

                                    ${
                                        !isCheckedOut
                                            ? `
                                                <button
                                                    type="button"
                                                    class="small-btn"
                                                    onclick="openGuestExtension(${Number(record.id)})"
                                                >
                                                    Extend Time / Upgrade to All-Day
                                                </button>
                                                <button
                                                    type="button"
                                                    class="small-btn"
                                                    onclick="checkoutAttendance(${Number(record.id)})"
                                                >
                                                    Check Out
                                                </button>
                                              `
                                            : ""
                                    }

                                    <button
                                        type="button"
                                        class="remove-button"
                                        onclick="removeGuestAttendance(${Number(record.id)})"
                                    >
                                        Remove
                                    </button>

                                </div>
                            `;

                        } else {

                            remainingHtml = isCheckedOut
                                ? `<span class="guest">CHECKED OUT</span>`
                                : `<span class="countdown-active">CHECKED IN</span>`;

                            actionHtml = isCheckedOut
                                ? ""
                                : `
                                        <button
                                            type="button"
                                            class="small-btn"
                                            onclick="checkoutAttendance(${Number(record.id)})"
                                        >
                                            Check Out
                                        </button>
                                      `;
                        }

                        return `
                            <tr>

                                <td>
                                    ${
                                        isGuest
                                            ? `
                                                <input
                                                    class="row-select"
                                                    type="checkbox"
                                                    data-selectable="guest"
                                                    data-record-id="${Number(record.id)}"
                                                    aria-label="Select guest attendance record ${Number(record.id)}"
                                                    onchange="updateBulkSelection('attendanceTableBody', 'selectAllAttendance', 'deleteSelectedAttendanceButton', 'attendanceSelectedCount', 'guest')">
                                              `
                                            : ""
                                    }
                                </td>

                                <td>
                                    ${escapeHtml(
                                        record.full_name ||
                                        "-"
                                    )}
                                </td>

                                <td>
                                    ${escapeHtml(
                                        String(
                                            record.user_type ||
                                            "-"
                                        )
                                    )}
                                </td>

                                <td>
                                    ${formatDateTime(
                                        record.check_in
                                    )}
                                </td>

                                <td>
                                    ${record.check_out
                                        ? formatDateTime(record.check_out)
                                        : "-"}
                                </td>

                                <td class="countdown-cell">
                                    ${remainingHtml}
                                </td>

                                <td>
                                    ${actionHtml}
                                </td>

                            </tr>
                        `;
                    }
                )
                .join("");

        updateBulkSelection(
            "attendanceTableBody",
            "selectAllAttendance",
            "deleteSelectedAttendanceButton",
            "attendanceSelectedCount",
            "guest"
        );

        updateGuestCountdowns();

    } catch (error) {

        console.error(
            "Attendance loading error:",
            error
        );

    }
}

async function deleteSelectedGuestAttendance() {

    const selectedIds =
        getSelectedRecordIds(
            "attendanceTableBody",
            "guest"
        );

    if (!selectedIds.length) {
        return;
    }

    const confirmed =
        confirm(
            `Permanently delete ${selectedIds.length} selected guest attendance record(s)? Member attendance records cannot be deleted here.`
        );

    if (!confirmed) {
        return;
    }

    const failedIds = [];

    for (const attendanceId of selectedIds) {

        try {

            await apiRequest(
                `/api/admin/attendance/${attendanceId}/remove`,
                {
                    method: "DELETE"
                }
            );

        } catch (error) {

            console.error(
                `Unable to delete selected guest attendance ${attendanceId}:`,
                error
            );

            failedIds.push(attendanceId);

        }
    }

    await Promise.all([
        loadAttendance(),
        loadAdminDashboard(),
        loadReports()
    ]);

    if (failedIds.length) {

        alert(
            `${selectedIds.length - failedIds.length} guest attendance record(s) deleted. ` +
            `Unable to delete record ID(s): ${failedIds.join(", ")}.`
        );

        return;
    }

    alert(
        `${selectedIds.length} guest attendance record(s) deleted successfully.`
    );
}


// =====================================
// GUEST COUNTDOWN HELPERS
// =====================================

function formatConfiguredClosingTime(value) {
    const match = String(value || "").match(/^(\d{2}):(\d{2})$/);
    if (!match) {
        return "10:00 PM";
    }

    const hour = Number(match[1]);
    const minute = Number(match[2]);
    const displayHour = hour % 12 || 12;
    return `${displayHour}:${String(minute).padStart(2, "0")} ${hour >= 12 ? "PM" : "AM"}`;
}

function formatGuestEndLabel(value) {

    if (
        value === undefined ||
        value === null ||
        value === ""
    ) {

        return "10:00 PM";

    }

    let date;

    const numericValue =
        Number(value);

    if (
        Number.isFinite(numericValue) &&
        numericValue > 0
    ) {

        date =
            new Date(
                numericValue > 100000000000
                    ? numericValue
                    : numericValue * 1000
            );

    } else {

        date =
            new Date(value);

    }

    if (
        Number.isNaN(
            date.getTime()
        )
    ) {

        return "10:00 PM";

    }

    return date.toLocaleTimeString(
        "en-PH",
        {
            timeZone:
                "Asia/Manila",

            hour:
                "numeric",

            minute:
                "2-digit"
        }
    );
}


function formatCountdown(totalSeconds) {

    const seconds =
        Math.max(
            0,
            Math.floor(
                Number(totalSeconds) ||
                0
            )
        );

    const hours =
        Math.floor(
            seconds / 3600
        );

    const minutes =
        Math.floor(
            (seconds % 3600) / 60
        );

    const remainingSeconds =
        seconds % 60;

    return [
        String(hours).padStart(2, "0"),
        String(minutes).padStart(2, "0"),
        String(remainingSeconds).padStart(2, "0")
    ].join(":");
}


async function updateGuestCountdowns() {

    const elements =
        document.querySelectorAll(
            '[data-guest-countdown="true"]'
        );

    if (!elements.length) {
        return;
    }

    const now = Date.now();

    for (const element of elements) {

        const attendanceId =
            Number(
                element.dataset.attendanceId
            );

        let remainingSeconds =
            Number(
                element.dataset.remainingSeconds
            );

        if (
            !Number.isFinite(attendanceId) ||
            !Number.isFinite(remainingSeconds)
        ) {
            continue;
        }

        const rawLastUpdate =
            element.dataset.countdownLastUpdate;

        let lastUpdate =
            rawLastUpdate
                ? Number(rawLastUpdate)
                : NaN;

        if (!Number.isFinite(lastUpdate)) {

            element.dataset.countdownLastUpdate =
                String(now);

            element.textContent =
                formatCountdown(remainingSeconds);

        } else {

            const elapsedSeconds =
                Math.floor(
                    (now - lastUpdate) / 1000
                );

            if (elapsedSeconds > 0) {

                remainingSeconds =
                    Math.max(
                        0,
                        remainingSeconds - elapsedSeconds
                    );

                element.dataset.remainingSeconds =
                    String(remainingSeconds);

                element.dataset.countdownLastUpdate =
                    String(
                        lastUpdate +
                        elapsedSeconds * 1000
                    );

                element.textContent =
                    formatCountdown(remainingSeconds);
            }
        }

        element.classList.remove(
            "countdown-active",
            "countdown-warning",
            "countdown-danger",
            "countdown-complete"
        );

        if (remainingSeconds <= 0) {

            element.classList.add(
                "countdown-complete"
            );

            element.textContent =
                "TIMED OUT";

            const row =
                element.closest("tr");

            const endLabel =
                row
                    ? row.querySelector(
                        ".countdown-note"
                    )
                    : null;

            if (endLabel) {
                endLabel.textContent =
                    "Overdue - guest still checked in";
            }

            continue;
        }

        if (remainingSeconds <= 60) {

            element.classList.add(
                "countdown-danger"
            );

        } else if (remainingSeconds <= 300) {

            element.classList.add(
                "countdown-warning"
            );

        } else {

            element.classList.add(
                "countdown-active"
            );
        }
    }
}


function startCountdownTimer() {

    if (countdownTimer) {

        clearInterval(
            countdownTimer
        );
    }

    updateGuestCountdowns();

    countdownTimer =
        setInterval(
            updateGuestCountdowns,
            1000
        );
}


// =====================================
// CHECKOUT ATTENDANCE
// =====================================

async function checkoutAttendance(attendanceId) {
    const confirmed = confirm(
        "Record this person's actual departure now?"
    );

    if (!confirmed) {
        return;
    }

    try {
        const data =
            await apiRequest(
                `/api/admin/attendance/${attendanceId}/checkout`,
                {
                    method: "PATCH",
                }
            );

        alert(data.message || "Checked out successfully.");

        await Promise.all([
            loadAttendance(),
            loadAdminDashboard(),
            loadReports()
        ]);
    } catch (error) {
        console.error(
            "Checkout error:",
            error
        );

        alert(error.message || "Unable to check out.");
    }
}

async function submitManualAttendance(action) {
    const memberId = document
        .getElementById("manualAttendanceMemberId")
        ?.value.trim();

    if (!memberId) {
        alert("Enter the member ID.");
        return;
    }

    if (
        action === "CHECK_OUT" &&
        !confirm("Record this member's actual departure now?")
    ) {
        return;
    }

    try {
        const data = await apiRequest(
            "/api/admin/attendance/manual",
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    member_id: memberId,
                    action
                })
            }
        );

        alert(data.message || "Attendance updated.");
        await Promise.all([
            loadAttendance(),
            loadAdminDashboard(),
            loadReports()
        ]);
    } catch (error) {
        console.error("Manual attendance error:", error);
        alert(error.message || "Unable to update attendance.");
    }
}


async function removeGuestAttendance(
    attendanceId
) {

    const confirmed =
        confirm(
            "Remove this guest attendance record? This is intended for correcting an incorrect guest entry."
        );

    if (!confirmed) {
        return;
    }

    try {

        const data =
            await apiRequest(
                `/api/admin/attendance/${attendanceId}/remove`,
                {
                    method: "DELETE"
                }
            );

        alert(
            data.message ||
            "Guest attendance record removed successfully."
        );

        await Promise.all([
            loadAttendance(),
            loadAdminDashboard(),
            loadReports()
        ]);

    } catch (error) {

        console.error(
            "Remove guest attendance error:",
            error
        );

        alert(
            error.message ||
            "Unable to remove guest attendance record."
        );
    }
}


// =====================================
// GUEST PRICING
// =====================================

function createGuestExtensionRequestKey() {
    if (window.crypto?.randomUUID) {
        return window.crypto.randomUUID();
    }

    return `guest-extension-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function openGuestExtension(attendanceId) {
    const record = attendanceRecords.find(
        item => Number(item.id) === Number(attendanceId)
    );
    const modal = document.getElementById("guestExtensionModal");

    if (!record || !modal || record.check_out) {
        alert("This guest visit is no longer active. Refresh attendance and try again.");
        return;
    }

    activeGuestExtensionId = Number(attendanceId);
    guestExtensionRequestKey = createGuestExtensionRequestKey();
    setText("extensionGuestName", record.full_name || "-");
    setText("extensionCheckIn", formatDateTime(record.check_in));
    setText("extensionCurrentExpiration", formatGuestEndLabel(
        record.guest_end_time_epoch || record.guest_end_time
    ));
    setText(
        "extensionRemainingTime",
        Number(record.remaining_seconds) > 0
            ? formatCountdown(record.remaining_seconds)
            : "EXPIRED / OVERDUE - guest remains checked in"
    );
    document.getElementById("extensionOption").value = "EXTRA_HOURS:1";
    document.getElementById("extensionPaymentMethod").value = "";
    document.getElementById("extensionPaymentConfirmed").checked = false;
    document.getElementById("extensionModalMessage").textContent = "";
    modal.hidden = false;

    await updateGuestExtensionQuote();
}

function closeGuestExtensionModal() {
    const modal = document.getElementById("guestExtensionModal");
    if (modal) {
        modal.hidden = true;
    }
    activeGuestExtensionId = null;
    guestExtensionQuote = null;
    guestExtensionRequestKey = null;
}

async function updateGuestExtensionQuote(resetRequestKey = false) {
    if (!activeGuestExtensionId) {
        return;
    }

    if (resetRequestKey) {
        guestExtensionRequestKey = createGuestExtensionRequestKey();
    }

    const message = document.getElementById("extensionModalMessage");
    const button = document.getElementById("confirmGuestExtensionButton");
    const paymentMethod = document.getElementById("extensionPaymentMethod");
    const paymentConfirmed = document.getElementById("extensionPaymentConfirmed");

    if (message) {
        message.textContent = "Loading current visit balance...";
    }
    if (button) {
        button.disabled = true;
    }

    try {
        const quote = await apiRequest(
            `/api/admin/attendance/${activeGuestExtensionId}/extension-quote`
        );
        const [extensionType, hoursValue] =
            document.getElementById("extensionOption").value.split(":");
        const hours = hoursValue ? Number(hoursValue) : null;
        const allDayOption = quote.options.find(
            option => option.extension_type === "ALL_DAY"
        );
        const selectedOption = quote.options.find(
            option =>
                option.extension_type === extensionType &&
                Number(option.additional_hours || 0) === Number(hours || 0)
        );
        const amount = selectedOption?.remaining_balance ??
            selectedOption?.price ??
            0;
        const now = Date.now();
        const currentExpiration = new Date(quote.current_expiration);
        const previewExpiration = extensionType === "ALL_DAY"
            ? new Date(
                Math.max(
                    currentExpiration.getTime(),
                    new Date(quote.closing_time).getTime()
                )
            )
            : new Date(
                Math.max(currentExpiration.getTime(), now) +
                Number(hours) * 60 * 60 * 1000
            );

        guestExtensionQuote = {
            extensionType,
            hours,
            amount,
            allDayOption
        };

        setText("extensionGuestName", quote.guest_name || "-");
        setText("extensionCheckIn", formatDateTime(quote.check_in));
        setText("extensionCurrentExpiration", formatDateTime(currentExpiration));
        setText(
            "extensionRemainingTime",
            Number(quote.remaining_seconds) > 0
                ? formatCountdown(quote.remaining_seconds)
                : "EXPIRED / OVERDUE - guest remains checked in"
        );
        setText("extensionPrice", `₱${Number(selectedOption?.price || 0).toLocaleString()}`);
        setText(
            "extensionBalance",
            `₱${Number(amount).toLocaleString()} due`
        );
        setText("extensionNewExpiration", formatDateTime(previewExpiration));

        const requiresPayment = Number(amount) > 0;
        if (paymentMethod) {
            paymentMethod.disabled = !requiresPayment;
        }
        if (paymentConfirmed) {
            paymentConfirmed.disabled = !requiresPayment;
            if (!requiresPayment) {
                paymentConfirmed.checked = false;
            }
        }
        if (message) {
            message.textContent = requiresPayment
                ? "Review the amount and confirm receipt of payment before submitting."
                : "No additional payment is due; previous confirmed payments cover the all-day rate.";
        }
    } catch (error) {
        console.error("Guest extension quote error:", error);
        if (message) {
            message.textContent = error.message || "Unable to load extension price.";
        }
    } finally {
        if (button) {
            button.disabled = false;
        }
    }
}

async function submitGuestExtension(event) {
    event.preventDefault();

    if (!activeGuestExtensionId || !guestExtensionQuote) {
        return;
    }

    const amount = Number(guestExtensionQuote.amount);
    const method = document
        .getElementById("extensionPaymentMethod")
        .value;
    const paymentConfirmed = document
        .getElementById("extensionPaymentConfirmed")
        .checked;

    if (amount > 0 && (!method || !paymentConfirmed)) {
        setText(
            "extensionModalMessage",
            "Select the payment method and confirm the payment was received."
        );
        return;
    }

    const summary =
        `${guestExtensionQuote.extensionType === "ALL_DAY"
            ? "Upgrade to All-Day"
            : `Add ${guestExtensionQuote.hours} hour(s)`}\n` +
        `Amount due: ₱${amount.toLocaleString()}\n` +
        `Payment method: ${amount > 0 ? method : "Already paid"}\n` +
        `Access through: ${document.getElementById("extensionNewExpiration").textContent}`;

    if (!confirm(`Confirm guest extension?\n\n${summary}`)) {
        return;
    }

    const button = document.getElementById("confirmGuestExtensionButton");
    const message = document.getElementById("extensionModalMessage");
    button.disabled = true;
    if (message) {
        message.textContent = "Saving confirmed extension...";
    }

    try {
        const result = await apiRequest(
            `/api/admin/attendance/${activeGuestExtensionId}/extend`,
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    extension_type: guestExtensionQuote.extensionType,
                    additional_hours: guestExtensionQuote.hours,
                    payment_method: method || null,
                    payment_confirmed: paymentConfirmed,
                    idempotency_key: guestExtensionRequestKey
                })
            }
        );

        if (message) {
            message.textContent = result.duplicate
                ? "This extension was already recorded."
                : "Extension and payment recorded.";
        }
        closeGuestExtensionModal();
        await Promise.all([
            loadAttendance(),
            loadAdminDashboard(),
            loadReports(),
            loadTransactions()
        ]);
    } catch (error) {
        console.error("Guest extension submission error:", error);
        if (message) {
            message.textContent = error.message || "Unable to save extension.";
        }
    } finally {
        if (button && !document.getElementById("guestExtensionModal").hidden) {
            button.disabled = false;
        }
    }
}

function updateGuestPricing() {

    const visitType =
        document.getElementById(
            "guestVisitType"
        )?.value;


    const hoursGroup =
        document.getElementById(
            "guestHoursGroup"
        );


    const hoursSelect =
        document.getElementById(
            "guestHours"
        );


    const amountInput =
        document.getElementById(
            "guestAmount"
        );


    if (
        !visitType ||
        !amountInput
    ) {

        return;

    }


    if (
        visitType ===
        "DAY PASS"
    ) {

        if (hoursGroup) {

            hoursGroup.style.display =
                "none";

        }


        amountInput.value =
            "100";


        return;

    }


    if (hoursGroup) {

        hoursGroup.style.display =
            "block";

    }


    const hours =
        Number(
            hoursSelect?.value ||
            1
        );


    const amount =
        hours *
        30;


    amountInput.value =
        String(
            amount
        );

}


// =====================================
// ADD GUEST
// =====================================

async function addGuest(
    event
) {

    if (event) {

        event.preventDefault();

    }


    const fullName =
        document.getElementById(
            "guestName"
        )?.value.trim();


    const phone =
        document.getElementById(
            "guestPhone"
        )?.value.trim();


    const visitType =
        document.getElementById(
            "guestVisitType"
        )?.value;


    const hours =
        document.getElementById(
            "guestHours"
        )?.value;


    const amountPaid =
        document.getElementById(
            "guestAmount"
        )?.value;


    const paymentMethod =
        document.getElementById(
            "guestPaymentMethod"
        )?.value;


    if (!fullName) {

        alert(
            "Guest name is required."
        );

        return;

    }

    if (!/^09\d{9}$/.test(phone || "")) {

        alert(
            "Enter an 11-digit Philippine mobile number starting with 09."
        );

        return;

    }


    if (!visitType) {

        alert(
            "Visit type is required."
        );

        return;

    }


    if (!paymentMethod) {

        alert(
            "Payment method is required."
        );

        return;

    }


    const selectedHours =
        visitType ===
        "DAY PASS"
            ? null
            : Number(
                hours ||
                1
            );


    const calculatedAmount =
        visitType ===
        "DAY PASS"
            ? 100
            : selectedHours *
              30;


    const confirmed =
        confirm(
            `Record ${fullName} as ${visitType} for ₱${calculatedAmount.toLocaleString()} using ${paymentMethod}?`
        );


    if (!confirmed) {

        return;

    }


    try {

        const data =
            await apiRequest(
                "/api/admin/guests",
                {
                    method:
                        "POST",

                    headers: {
                        "Content-Type":
                            "application/json"
                    },

                    body:
                        JSON.stringify({

                            full_name:
                                fullName,

                            phone:
                                phone,

                            visit_type:
                                visitType,

                            hours:
                                selectedHours,

                            amount_paid:
                                Number(
                                    amountPaid ||
                                    calculatedAmount
                                ),

                            payment_method:
                                paymentMethod

                        })
                }
            );


        alert(
            data.message ||
            "Guest recorded and checked in."
        );


        const form =
            document.getElementById(
                "guestForm"
            );


        if (form) {

            form.reset();

        }


        updateGuestPricing();


        await Promise.all([
            loadAttendance(),
            loadAdminDashboard(),
            loadReports()
        ]);


        showPageById(
            "attendance"
        );


    } catch (error) {

        console.error(
            "Guest error:",
            error
        );


        alert(
            error.message ||
            "Unable to record guest."
        );

    }

}


// =====================================
// QR SCANNER
// =====================================

function isWithinMemberQrHours() {

    const currentTime =
        new Intl.DateTimeFormat(
            "en-GB",
            {
                timeZone: "Asia/Manila",
                hour: "2-digit",
                minute: "2-digit",
                hourCycle: "h23"
            }
        ).format(
            new Date()
        );

    const [hour, minute] =
        currentTime
            .split(":")
            .map(Number);

    const minutesSinceMidnight =
        hour * 60 + minute;
    const [closingHour, closingMinute] =
        gymClosingTime.split(":").map(Number);
    const minutesUntilClose =
        closingHour * 60 + closingMinute;

    return (
        minutesSinceMidnight >= 8 * 60 &&
        minutesSinceMidnight < minutesUntilClose
    );

}


async function scanCustomerQr() {

    if (
        typeof Html5Qrcode ===
        "undefined"
    ) {

        alert(
            "QR scanner library is not loaded."
        );

        return;

    }

    if (!isWithinMemberQrHours()) {

        const message =
            `Member QR check-in and check-out are available from 8:00 AM to ${formatConfiguredClosingTime(gymClosingTime)} Manila time.`;

        const status =
            document.getElementById(
                "qrScanStatus"
            );

        if (status) {
            status.textContent = message;
        }

        alert(message);

        return;

    }


    if (qrScanner) {

        return;

    }


    const status =
        document.getElementById(
            "qrScanStatus"
        );


    if (status) {

        status.textContent =
            "Starting camera...";

    }


    qrScanBusy =
        false;


    qrScanner =
        new Html5Qrcode(
            "qr-reader"
        );


    try {

        const cameras =
            await Html5Qrcode.getCameras();


        if (
            !cameras ||
            cameras.length ===
            0
        ) {

            throw new Error(
                "No camera was found."
            );

        }


        let cameraId =
            cameras[0].id;


        const rearCamera =
            cameras.find(
                camera => {

                    const label =
                        String(
                            camera.label ||
                            ""
                        ).toLowerCase();


                    return (
                        label.includes(
                            "back"
                        ) ||
                        label.includes(
                            "rear"
                        ) ||
                        label.includes(
                            "environment"
                        )
                    );

                }
            );


        if (rearCamera) {

            cameraId =
                rearCamera.id;

        }


        if (status) {

            status.textContent =
                "Camera ready. Scan the customer's QR code.";

        }


        await qrScanner.start(
            cameraId,
            {
                fps:
                    10,

                qrbox: {
                    width:
                        220,

                    height:
                        220
                },

                aspectRatio:
                    1
            },

            async (
                decodedText
            ) => {

                if (
                    qrScanBusy ||
                    decodedText === lastScannedQr
                ) {

                    return;

                }


                qrScanBusy =
                    true;

                lastScannedQr =
                    decodedText;

                if (!isWithinMemberQrHours()) {

                    const message =
                        `Gym QR scanning is closed at ${formatConfiguredClosingTime(gymClosingTime)}. Record checkout only when the member actually leaves.`;

                    if (status) {
                        status.textContent = message;
                    }

                    await stopQrScanner();

                    return;

                }


                try {

                    const data =
                        await apiRequest(
                            "/api/admin/attendance/scan",
                            {
                                method:
                                    "POST",

                                headers: {
                                    "Content-Type":
                                        "application/json"
                                },

                                body:
                                    JSON.stringify({
                                        qr_code:
                                            decodedText
                                    })
                            }
                        );


                    if (status) {
                        status.textContent =
                            `${data.message || "Scan successful."} Ready for the next member.`;
                    }

                    await Promise.all([
                        loadAttendance(),
                        loadAdminDashboard(),
                        loadReports()
                    ]);

                } catch (error) {

                    console.error(
                        "QR scan error:",
                        error
                    );


                    if (status) {

                        status.textContent =
                            error.message ||
                            "Unable to process QR code.";

                    }


                    alert(
                        error.message ||
                        "Unable to process QR code."
                    );


                    setTimeout(
                        () => {

                            qrScanBusy =
                                false;

                        },
                        1500
                    );


                    return;

                }


                qrScanBusy =
                    false;

            },

            () => {
                lastScannedQr = null;
            }

        );


    } catch (error) {

        console.error(
            "Camera start error:",
            error
        );


        if (status) {

            status.textContent =
                error.message ||
                "Unable to start camera.";

        }


        alert(
            error.message ||
            "Unable to start camera."
        );


        await stopQrScanner();

    }

}


// =====================================
// STOP QR SCANNER
// =====================================

async function stopQrScanner() {

    if (!qrScanner) {

        return;

    }


    try {

        await qrScanner.stop();

    } catch (error) {

        console.error(
            "QR scanner stop error:",
            error
        );

    }


    try {

        qrScanner.clear();

    } catch (error) {

        console.error(
            "QR scanner clear error:",
            error
        );

    }


    qrScanner =
        null;


    qrScanBusy =
        false;

    lastScannedQr =
        null;

}


// =====================================
// CLOSE QR SCANNER
// =====================================

async function closeQrScanner() {

    await stopQrScanner();


    const status =
        document.getElementById(
            "qrScanStatus"
        );


    if (status) {

        status.textContent =
            "Scanner closed.";

    }

}


// =====================================
// VIEW SCREENSHOT
// =====================================

function viewScreenshot(
    url
) {

    if (!url) {

        return;

    }


    window.open(
        window.anchorApiUrl(url),
        "_blank",
        "noopener,noreferrer"
    );

}


// =====================================
// REPORTS
// =====================================

async function loadReports(
    period = reportPeriod
) {

    if (!["daily", "weekly", "monthly", "custom"].includes(period)) {
        return;
    }

    const periodChanged = period !== reportPeriod;
    reportPeriod = period;
    const dateRange = document.getElementById("reportDateRange");
    const startDate = document.getElementById("reportStartDate")?.value || "";
    const endDate = document.getElementById("reportEndDate")?.value || "";
    if (dateRange) {
        dateRange.hidden = period !== "custom";
    }

    document
        .querySelectorAll("[data-report-period]")
        .forEach(button => {
            button.setAttribute(
                "aria-pressed",
                String(button.dataset.reportPeriod === reportPeriod)
            );
        });

    if (period === "custom" && (!startDate || !endDate || startDate > endDate)) {
        setText(
            "reportMessage",
            "Choose a valid start and end date, then apply the custom range."
        );
        return;
    }

    try {

        const query = new URLSearchParams({ period: reportPeriod });
        if (period === "custom") {
            query.set("startDate", startDate);
            query.set("endDate", endDate);
        }

        const data =
            await apiRequest(
                `/api/admin/reports?${query.toString()}`
            );


        const totalVisits =
            Number(
                data.totalVisits ||
                0
            );


        const memberVisits =
            Number(
                data.memberVisits ||
                0
            );


        const guestVisits =
            Number(
                data.guestVisits ||
                0
            );


        setText(
            "reportTotalVisits",
            totalVisits
        );


        setText(
            "reportMemberVisits",
            memberVisits
        );


        setText(
            "reportGuestVisits",
            guestVisits
        );

        setText("reportUniqueVisitors", Number(data.uniqueVisitors || 0));
        setText("reportMemberVisitorCount", Number(data.memberVisitorCount || 0));
        setText("reportGuestVisitorCount", Number(data.guestVisitorCount || 0));
        setText("reportCurrentOccupancy", Number(data.currentOccupancy || 0));

        updatePeakBars(
            data.series || [],
            reportPeriod,
            periodChanged || reportPeriod === "custom"
        );


        const reportMessage =
            document.getElementById(
                "reportMessage"
            );


        if (reportMessage) {

            reportMessage.textContent =
                `${totalVisits} visit(s) in the selected period; ` +
                `${Number(data.uniqueVisitors || 0)} unique visitor(s).`;

        }

        const reportBody = document.getElementById("reportAttendanceTableBody");
        if (reportBody) {
            const records = data.records || [];
            if (records.length) {
                let previousGroupLabel = null;
                reportBody.innerHTML = records.reduce((rows, record) => {
                    if (record.group_label !== previousGroupLabel) {
                        previousGroupLabel = record.group_label;
                        rows.push(`
                            <tr class="report-group-row">
                                <th colspan="8" scope="rowgroup">
                                    ${escapeHtml(record.group_label || "Visits")}
                                </th>
                            </tr>
                        `);
                    }

                    rows.push(`
                        <tr>
                            <td>${escapeHtml(record.visitor_name || "-")}</td>
                            <td>${escapeHtml(record.user_type || "-")}</td>
                            <td>${escapeHtml(formatDate(record.check_in))}</td>
                            <td>${record.check_in ? formatDateTime(record.check_in) : "-"}</td>
                            <td>${record.check_out ? formatDateTime(record.check_out) : "-"}</td>
                            <td>${formatVisitDuration(record.duration_seconds)}</td>
                            <td>${escapeHtml(record.guest_time_purchased || "-")}</td>
                            <td>
                                <span class="${record.visit_status === "TIMED OUT" ? "timed-out-label" : "visit-status"}">
                                    ${escapeHtml(record.visit_status || "-")}
                                </span>
                            </td>
                        </tr>
                    `);

                    return rows;
                }, []).join("");
            } else {
                reportBody.innerHTML = `
                    <tr>
                        <td colspan="8" style="text-align:center;">
                            No attendance records found for this period.
                        </td>
                    </tr>
                `;
            }
        }


    } catch (error) {

        console.error(
            "Reports loading error:",
            error
        );
        setText(
            "reportMessage",
            error.message || "Unable to load attendance reports."
        );

    }

    function formatVisitDuration(value) {
        const seconds = Math.max(0, Number(value) || 0);
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
    }

}


// =====================================
// PEAK BARS
// =====================================

function updatePeakBars(
    series,
    period,
    announcePeriodChange
) {
    const chart =
        document.getElementById("peakAttendanceChart");
    const yAxis =
        document.getElementById("reportYAxis");
    const description =
        document.getElementById("reportChartDescription");

    if (!chart || !yAxis) {
        return;
    }

    const values = series.map(item => ({
        label: String(item.label || ""),
        visits: Math.max(0, Number(item.visits) || 0)
    }));
    const max =
        Math.max(1, ...values.map(item => item.visits));
    const ticks =
        Array.from(
            { length: 5 },
            (_, index) => Math.round(max * (4 - index) / 4)
        );

    yAxis.innerHTML =
        ticks.map(value => `<span>${value}</span>`).join("");

    chart.innerHTML =
        values.map(item => {
            const height =
                item.visits === 0
                    ? 0
                    : Math.max(2, item.visits / max * 100);

            return `
                <div
                    class="report-bar"
                    role="listitem"
                    aria-label="${escapeAttribute(`${item.label}: ${item.visits} visits`)}"
                    style="--bar-height:${height}%">
                    <span class="report-bar-value">${item.visits}</span>
                    <span class="report-bar-label">${escapeHtml(item.label)}</span>
                </div>
            `;
        }).join("");

    const periodDescription = {
        daily: "hourly attendance for today",
        weekly: "daily attendance for the current week",
        monthly: "weekly attendance for the current month",
        custom: "daily attendance for the selected date range"
    }[period];

    chart.setAttribute(
        "aria-label",
        `Peak attendance chart showing ${periodDescription}`
    );
    if (description && (announcePeriodChange || !description.textContent)) {
        description.textContent =
            `Peak attendance chart showing ${periodDescription}. ` +
            values.map(item => `${item.label}: ${item.visits} visits`).join("; ");
    }
}


// =====================================
// EQUIPMENT
// =====================================

async function loadEquipment() {

    try {

        const data =
            await apiRequest(
                "/api/admin/equipment"
            );


        const equipment =
            data.equipment ||
            [];


        const body =
            document.getElementById(
                "equipmentTableBody"
            );


        if (!body) {

            return;

        }


        if (
            equipment.length ===
            0
        ) {

            body.innerHTML = `
                <tr>
                    <td
                        colspan="4"
                        style="text-align:center;">
                        No equipment demand data available yet.
                    </td>
                </tr>
            `;

            return;

        }


        body.innerHTML =
            equipment
                .map(
                    item =>
                        `
                        <tr>

                            <td>
                                ${escapeHtml(
                                    item.name ||
                                    "-"
                                )}
                            </td>

                            <td>
                                ${escapeHtml(
                                    item.category ||
                                    item.demand ||
                                    "-"
                                )}
                            </td>

                            <td>
                                ${escapeHtml(
                                    item.peak_time ||
                                    item.status ||
                                    "-"
                                )}
                            </td>

                            <td>
                                ${escapeHtml(
                                    item.recommendation ||
                                    item.usage ||
                                    "-"
                                )}
                            </td>

                        </tr>
                        `
                )
                .join("");


    } catch (error) {

        console.error(
            "Equipment loading error:",
            error
        );

    }

}


// =====================================
// REFRESH ADMIN DATA
// =====================================

async function refreshAdminData() {

    if (
        window.anchorSession.get(
            "anchorAdminLoggedIn"
        ) !==
        "true"
    ) {

        return;

    }


    try {

        await Promise.all([
            loadAdminDashboard(),
            loadApplications(),
            loadReports()
        ]);


    } catch (error) {

        console.error(
            "Admin refresh error:",
            error
        );

    }

}


// =====================================
// SET TEXT
// =====================================

function setText(
    id,
    value
) {

    const element =
        document.getElementById(
            id
        );


    if (element) {

        element.textContent =
            value;

    }

}


// =====================================
// OCCUPANCY BAR
// =====================================

function updateOccupancyBar(
    occupancy,
    capacity
) {

    const percentage =
        capacity >
        0

            ? Math.min(
                100,
                Math.max(
                    0,
                    (
                        occupancy /
                        capacity
                    ) *
                    100
                )
            )

            : 0;


    const elements =
        document.querySelectorAll(
            ".bar i"
        );


    elements.forEach(
        element => {

            element.style.width =
                `${percentage}%`;

        }
    );

}


// =====================================
// STATUS
// =====================================

function getStatus(
    status
) {

    return String(
        status ||
        ""
    )
        .trim()
        .toUpperCase();

}


// =====================================
// STATUS CLASS
// =====================================

function getStatusClass(
    status
) {

    const normalized =
        getStatus(
            status
        );


    if (
        normalized ===
        "ACTIVE"
    ) {

        return "active";

    }


    if (
        normalized ===
        "APPROVED" ||
        normalized ===
        "VERIFIED"
    ) {

        return "approved";

    }


    if (
        normalized ===
        "PENDING"
    ) {

        return "pending";

    }


    if (
        normalized ===
        "REJECTED"
    ) {

        return "rejected";

    }


    if (
        normalized ===
        "EXPIRED"
    ) {

        return "expired";

    }


    if (normalized === "REVOKED") {
        return "revoked";
    }

    if (normalized === "SUSPENDED") {
        return "revoked";
    }


    if (
        normalized ===
        "ARCHIVED"
    ) {

        return "expired";

    }


    if (
        normalized ===
        "RESTORED"
    ) {

        return "approved";

    }


    return "";

}


// =====================================
// FORMAT DATE
// =====================================

function formatDate(
    value
) {

    if (!value) {

        return "-";

    }


    const stringValue =
        String(
            value
        );


    const dateOnlyMatch =
        stringValue.match(
            /^(\d{4})-(\d{2})-(\d{2})$/
        );


    if (dateOnlyMatch) {

        const year =
            Number(
                dateOnlyMatch[1]
            );


        const month =
            Number(
                dateOnlyMatch[2]
            ) - 1;


        const day =
            Number(
                dateOnlyMatch[3]
            );


        const localDate =
            new Date(
                year,
                month,
                day
            );


        return localDate.toLocaleDateString(
            "en-US",
            {
                year:
                    "numeric",

                month:
                    "short",

                day:
                    "numeric"
            }
        );

    }


    const date =
        new Date(
            value
        );


    if (
        Number.isNaN(
            date.getTime()
        )
    ) {

        return "-";

    }


    return date.toLocaleDateString(
        "en-US",
        {
            timeZone:
                "Asia/Manila",

            year:
                "numeric",

            month:
                "short",

            day:
                "numeric"
        }
    );

}


// =====================================
// FORMAT DATE TIME
// =====================================

function formatDateTime(
    value
) {

    if (!value) {

        return "-";

    }


    const date =
        new Date(
            value
        );


    if (
        Number.isNaN(
            date.getTime()
        )
    ) {

        return "-";

    }


    return date.toLocaleString(
        "en-US",
        {
            timeZone:
                "Asia/Manila",

            year:
                "numeric",

            month:
                "short",

            day:
                "numeric",

            hour:
                "numeric",

            minute:
                "2-digit"
        }
    );

}


// =====================================
// ESCAPE HTML
// =====================================

function escapeHtml(
    value
) {

    return String(
        value ??
        ""
    )
        .replace(
            /&/g,
            "&amp;"
        )
        .replace(
            /</g,
            "&lt;"
        )
        .replace(
            />/g,
            "&gt;"
        )
        .replace(
            /"/g,
            "&quot;"
        )
        .replace(
            /'/g,
            "&#039;"
        );

}


// =====================================
// ESCAPE ATTRIBUTE
// =====================================

function escapeAttribute(
    value
) {

    return String(
        value ??
        ""
    )
        .replace(
            /\\/g,
            "\\\\"
        )
        .replace(
            /'/g,
            "\\'"
        )
        .replace(
            /"/g,
            "&quot;"
        );

}


// =====================================
// LOGOUT
// =====================================

function logout() {

    const confirmed =
        confirm(
            "Are you sure you want to logout?"
        );


    if (!confirmed) {

        return;

    }


    window.anchorSession.remove(
        "anchorAdminLoggedIn"
    );


    window.anchorSession.remove(
        "anchorAdminRole"
    );


    localStorage.removeItem(
        "anchorAdminRemember"
    );


    window.location.href =
        "admin-login.html";

}


// =====================================
// PAGE LOAD
// =====================================

document.addEventListener(
    "DOMContentLoaded",
    async () => {

        if (
            !checkAdminAccess()
        ) {

            return;

        }


        updateGuestPricing();


        showPageById(
            "dashboard"
        );


        refreshTimer =
            setInterval(
                refreshAdminData,
                5000
            );

        startCountdownTimer();

    }
);