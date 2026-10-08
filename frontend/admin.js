// =====================================
// ANCHOR GYM - ADMIN DASHBOARD
// =====================================

let refreshTimer = null;
let countdownTimer = null;
let qrScanner = null;
let qrScanBusy = false;
let autoCheckoutInProgress = new Set();

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
        localStorage.getItem(
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
            url,
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
            "dashboardSuspendedLegend",
            data.suspendedMembers ??
            0
        );


        setText(
            "dashboardPendingLegend",
            data.pendingApplications ??
            0
        );

        updateMembershipPie({
            active: data.activeMembers,
            expired: data.expiredMembers,
            suspended: data.suspendedMembers,
            pending: data.pendingApplications
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
            value: Number(counts.suspended) || 0,
            color: "#ef3645"
        },
        {
            value: Number(counts.pending) || 0,
            color: "#7f8993"
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


        // ---------------------------------
        // RECENT APPLICATIONS
        // ---------------------------------

        const recentBody =
            document.getElementById(
                "recentApplicationsBody"
            );


        if (recentBody) {

            const recent =
                applications.slice(
                    0,
                    5
                );


            if (
                recent.length ===
                0
            ) {

                recentBody.innerHTML = `
                    <tr>
                        <td
                            colspan="4"
                            style="text-align:center;">
                            No applications found.
                        </td>
                    </tr>
                `;

            } else {

                recentBody.innerHTML =
                    recent
                        .map(
                            application =>
                                createRecentApplicationRow(
                                    application
                                )
                        )
                        .join("");

            }

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
                                            class="red-button"
                                            type="button"
                                            onclick="approveApplication(${application.id})">

                                            Approve

                                        </button>

                                        <button
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
// RECENT APPLICATION ROW
// =====================================

function createRecentApplicationRow(
    application
) {

    const status =
        getStatus(
            application.status
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

                <span
                    class="status ${getStatusClass(status)}">

                    ${escapeHtml(
                        status
                    )}

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
                    class="red-button"
                    type="button"
                    onclick="approveApplication(${application.id})">

                    Approve

                </button>

                <button
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

                                <button
                                    class="remove-button"
                                    type="button"
                                    onclick="removeMember(${member.id})">

                                    Remove

                                </button>

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
// REMOVE MEMBER
// =====================================

async function removeMember(
    memberId
) {

    const reason =
        await askForReason(
            "Reason for Removing Member",
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


    if (
        reason ===
        null
    ) {

        return;

    }


    const confirmed =
        confirm(
            `Are you sure you want to remove this member?\n\nReason: ${reason}`
        );


    if (!confirmed) {

        return;

    }


    try {

        const data =
            await apiRequest(
                `/api/admin/members/${memberId}`,
                {
                    method:
                        "DELETE",

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
            "Membership archived and removed successfully."
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

        console.error(
            "Remove member error:",
            error
        );


        alert(
            error.message ||
            "Unable to archive membership."
        );

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

                        const restored =
                            Boolean(
                                member.restored_at
                            ) ||
                            getStatus(
                                member.status
                            ) ===
                            "RESTORED";


                        const displayStatus =
                            restored
                                ? "RESTORED"
                                : "ARCHIVED";


                        const action =
                            restored
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

async function loadTransactions() {

    try {

        const data =
            await apiRequest(
                "/api/admin/transactions"
            );


        const transactions =
            data.transactions ||
            [];


        const body =
            document.getElementById(
                "transactionsTableBody"
            );


        if (!body) {

            return;

        }


        if (
            transactions.length ===
            0
        ) {

            body.innerHTML = `
                <tr>
                    <td
                        colspan="7"
                        style="text-align:center;">
                        No transaction data available yet.
                    </td>
                </tr>
            `;

            updateBulkSelection(
                "transactionsTableBody",
                "selectAllTransactions",
                "deleteSelectedTransactionsButton",
                "transactionsSelectedCount"
            );

            return;

        }


        body.innerHTML =
            transactions
                .map(
                    transaction =>
                        `
                        <tr>

                            <td>
                                <input
                                    class="row-select"
                                    type="checkbox"
                                    data-selectable="transaction"
                                    data-record-id="${Number(transaction.id)}"
                                    aria-label="Select transaction ${Number(transaction.id)}"
                                    onchange="updateBulkSelection('transactionsTableBody', 'selectAllTransactions', 'deleteSelectedTransactionsButton', 'transactionsSelectedCount')">
                            </td>

                            <td>
                                ${Number(transaction.id)}
                            </td>

                            <td>
                                ${escapeHtml(
                                    transaction.full_name ||
                                    "-"
                                )}
                            </td>

                            <td>
                                ₱${Number(
                                    transaction.amount ||
                                    0
                                ).toLocaleString()}
                            </td>

                            <td>
                                ${escapeHtml(
                                    transaction.gcash_reference ||
                                    "-"
                                )}
                            </td>

                            <td>
                                ${escapeHtml(
                                    transaction.status ||
                                    "-"
                                )}
                            </td>

                            <td>

                                <button
                                    class="remove-button"
                                    type="button"
                                    onclick="deleteTransaction(${transaction.id})">

                                    Delete

                                </button>

                            </td>

                        </tr>
                        `
                )
                .join("");

        updateBulkSelection(
            "transactionsTableBody",
            "selectAllTransactions",
            "deleteSelectedTransactionsButton",
            "transactionsSelectedCount"
        );

    } catch (error) {

        console.error(
            "Transactions loading error:",
            error
        );

    }

}

async function deleteSelectedTransactions() {

    const selectedIds =
        getSelectedRecordIds(
            "transactionsTableBody"
        );

    if (!selectedIds.length) {
        return;
    }

    const confirmed =
        confirm(
            `Permanently delete ${selectedIds.length} selected transaction record(s)? This does not remove memberships.`
        );

    if (!confirmed) {
        return;
    }

    const failedIds = [];

    for (const transactionId of selectedIds) {

        try {

            await apiRequest(
                `/api/admin/transactions/${transactionId}`,
                {
                    method: "DELETE"
                }
            );

        } catch (error) {

            console.error(
                `Unable to delete selected transaction ${transactionId}:`,
                error
            );

            failedIds.push(transactionId);

        }
    }

    await loadTransactions();

    if (failedIds.length) {

        alert(
            `${selectedIds.length - failedIds.length} transaction(s) deleted. ` +
            `Unable to delete transaction ID(s): ${failedIds.join(", ")}.`
        );

        return;
    }

    alert(
        `${selectedIds.length} transaction(s) deleted successfully.`
    );
}


// =====================================
// DELETE TRANSACTION
// =====================================

async function deleteTransaction(
    transactionId
) {

    const confirmed =
        confirm(
            "Delete this transaction history? This does not remove the membership."
        );


    if (!confirmed) {

        return;

    }


    try {

        const data =
            await apiRequest(
                `/api/admin/transactions/${transactionId}`,
                {
                    method:
                        "DELETE"
                }
            );


        alert(
            data.message ||
            "Transaction deleted successfully."
        );


        await loadTransactions();


    } catch (error) {

        console.error(
            "Delete transaction error:",
            error
        );


        alert(
            error.message ||
            "Unable to delete transaction."
        );

    }

}


// =====================================
// ATTENDANCE
// =====================================

async function loadAttendance() {

    try {

        const data =
            await apiRequest(
                "/api/admin/attendance"
            );

        const attendance =
            data.attendance ||
            [];

        const membersInside =
            attendance.filter(
                record =>
                    String(
                        record.user_type ||
                        ""
                    ).toUpperCase() ===
                    "MEMBER" &&
                    !record.check_out
            ).length;

        const guestsInside =
            attendance.filter(
                record =>
                    String(
                        record.user_type ||
                        ""
                    ).toUpperCase() ===
                    "GUEST" &&
                    !record.check_out
            ).length;

        const occupancy =
            membersInside +
            guestsInside;

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
                        colspan="6"
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

                                remainingHtml =
                                    record.timed_out === true
                                        ? `
                                            <span class="timed-out-label">
                                                TIMED OUT
                                            </span>
                                          `
                                        : `
                                            <span class="guest">
                                                CHECKED OUT
                                            </span>
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
                                    remainingSeconds >= 0
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
                                            Ends ${escapeHtml(
                                                formatGuestEndLabel(
                                                    record.guest_end_time_epoch ||
                                                    record.guest_end_time
                                                )
                                            )}
                                        </small>
                                    `;

                                } else {

                                    remainingHtml = `
                                        <span class="countdown countdown-warning">
                                            Timer unavailable
                                        </span>
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

                            remainingHtml =
                                "<span>-</span>";

                            actionHtml =
                                isCheckedOut
                                    ? `
                                        <span class="guest">
                                            CHECKED OUT
                                        </span>
                                      `
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

            autoCheckoutInProgress.delete(
                Number(attendanceId)
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
                "00:00:00";

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
                    "Timed out";
            }

            if (
                !autoCheckoutInProgress.has(
                    attendanceId
                )
            ) {

                autoCheckoutInProgress.add(
                    attendanceId
                );

                try {

                    await checkoutAttendance(
                        attendanceId,
                        true
                    );

                } catch (error) {

                    console.error(
                        "Automatic guest checkout error:",
                        error
                    );

                    autoCheckoutInProgress.delete(
                        attendanceId
                    );
                }
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

async function checkoutAttendance(
    attendanceId,
    skipConfirmation = false
) {

    if (!skipConfirmation) {

        const confirmed =
            confirm(
                "Check out this person?"
            );

        if (!confirmed) {
            return;
        }
    }

    try {

        const data =
            await apiRequest(
                `/api/admin/attendance/${attendanceId}/checkout`,
                {
                    method: "PATCH",

                    headers: {
                        "Content-Type":
                            "application/json"
                    },

                    body: JSON.stringify({
                        automatic:
                            skipConfirmation
                    })
                }
            );

        autoCheckoutInProgress.delete(
            Number(attendanceId)
        );

        if (!skipConfirmation) {

            alert(
                data.message ||
                "Checked out successfully."
            );
        }

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

        if (
            error.message ===
            "Active attendance record not found."
        ) {

            autoCheckoutInProgress.delete(
                Number(attendanceId)
            );

            await loadAttendance();

            if (!skipConfirmation) {

                alert(
                    "This attendance record is no longer active. The attendance list has been refreshed."
                );

            }

            return;

        }

        if (skipConfirmation) {

            autoCheckoutInProgress.delete(
                Number(attendanceId)
            );

            try {

                await loadAttendance();

            } catch (refreshError) {

                console.error(
                    "Attendance refresh after automatic checkout error:",
                    refreshError
                );
            }

            return;
        }

        alert(
            error.message ||
            "Unable to check out."
        );
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

        autoCheckoutInProgress.delete(
            Number(attendanceId)
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

                if (qrScanBusy) {

                    return;

                }


                qrScanBusy =
                    true;


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
                            data.message ||
                            "Scan successful.";

                    }


                    alert(
                        data.message ||
                        "Scan successful."
                    );


                    await Promise.all([
                        loadAttendance(),
                        loadAdminDashboard(),
                        loadReports()
                    ]);


                    await stopQrScanner();


                    showPageById(
                        "attendance"
                    );


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

            () => {}

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
        url,
        "_blank"
    );

}


// =====================================
// REPORTS
// =====================================

async function loadReports() {

    try {

        const data =
            await apiRequest(
                "/api/admin/reports"
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


        updatePeakBars(
            data.hourly ||
            []
        );


        const reportMessage =
            document.getElementById(
                "reportMessage"
            );


        if (reportMessage) {

            reportMessage.textContent =
                `Total recorded visits: ${totalVisits}`;

        }


    } catch (error) {

        console.error(
            "Reports loading error:",
            error
        );

    }

}


// =====================================
// PEAK BARS
// =====================================

function updatePeakBars(
    hourly
) {

    const hourMap =
        {};


    hourly.forEach(
        item => {

            hourMap[
                Number(
                    item.hour
                )
            ] =
                Number(
                    item.visits ||
                    0
                );

        }
    );


    const ids = [

        [
            "bar10",
            10
        ],

        [
            "bar12",
            12
        ],

        [
            "bar2",
            14
        ],

        [
            "bar4",
            16
        ],

        [
            "bar6",
            18
        ],

        [
            "bar8",
            20
        ]

    ];


    const values =
        ids.map(
            (
                [id, hour]
            ) => ({

                id,

                value:
                    Number(
                        hourMap[
                            hour
                        ] ||
                        0
                    )

            })
        );


    const max =
        Math.max(
            1,

            ...values.map(
                item =>
                    item.value
            )
        );


    values.forEach(
        (
            {
                id,
                value
            }
        ) => {

            setBarHeight(
                id,
                value,
                max
            );

        }
    );

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
        localStorage.getItem(
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
// PEAK BAR HEIGHT
// =====================================

function setBarHeight(
    id,
    value,
    max
) {

    const element =
        document.getElementById(
            id
        );


    if (!element) {

        return;

    }


    const percentage =
        max >
        0

            ? Math.min(
                100,
                Math.max(
                    0,
                    (
                        value /
                        max
                    ) *
                    100
                )
            )

            : 0;


    element.style.height =
        `${Math.max(
            5,
            percentage
        )}%`;

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
        "APPROVED"
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


    if (
        normalized ===
        "SUSPENDED"
    ) {

        return "suspended";

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


    localStorage.removeItem(
        "anchorAdminLoggedIn"
    );


    localStorage.removeItem(
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