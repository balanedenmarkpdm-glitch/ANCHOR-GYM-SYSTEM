let refreshTimer = null;

let qrScanner = null;

let qrScanBusy = false;

function checkAdminAccess() {
    const loggedIn =
        localStorage.getItem(
            "anchorAdminLoggedIn"
        );

    if (loggedIn !== "true") {
        window.location.href =
            "admin-login.html";
        return false;
    }

    return true;
}

async function apiRequest(
    url,
    options = {}
) {
    const response =
        await fetch(
            url,
            {
                cache: "no-store",
                ...options
            }
        );

    const text =
        await response.text();

    let data;

    try {
        data =
            JSON.parse(text);
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

function showPage(
    id,
    button = null
) {
    document
        .querySelectorAll(".page")
        .forEach(
            (page) => {
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
            (item) => {
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

    loadPageData(id);
}

function showPageById(id) {
    const button =
        document.querySelector(
            `.sidebar button[onclick*="showPage('${id}'"]`
        );

    showPage(
        id,
        button
    );
}

async function loadPageData(id) {
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
            "dashboardMembershipTotal",
            data.totalMembers ??
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
                (application) =>
                    getStatus(
                        application.status
                    ) ===
                    "PENDING"
            );

        const rejectedApplications =
            applications.filter(
                (application) =>
                    getStatus(
                        application.status
                    ) ===
                    "REJECTED"
            );

        const approvedApplications =
            applications.filter(
                (application) =>
                    getStatus(
                        application.status
                    ) ===
                    "APPROVED"
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
                            (application) =>
                                createRecentApplicationRow(
                                    application
                                )
                        )
                        .join("");
            }
        }

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
                            (application) => `
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
                                            onclick="approveApplication(${application.id})"
                                        >
                                            Approve
                                        </button>

                                        <button
                                            type="button"
                                            onclick="rejectApplication(${application.id})"
                                        >
                                            Reject
                                        </button>
                                    </div>
                                </div>
                            `
                        )
                        .join("");
            }
        }

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
                            (application) =>
                                createApplicationRow(
                                    application
                                )
                        )
                        .join("");
            }
        }

        void approvedApplications;
    } catch (error) {
        console.error(
            "Applications loading error:",
            error
        );
    }
}

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
                <span class="status ${getStatusClass(status)}">
                    ${escapeHtml(status)}
                </span>
            </td>
        </tr>
    `;
}

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
                    )}')"
                >
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
                    onclick="approveApplication(${application.id})"
                >
                    Approve
                </button>
                <button
                    type="button"
                    onclick="rejectApplication(${application.id})"
                >
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
                <span class="status ${getStatusClass(status)}">
                    ${escapeHtml(status)}
                </span>
            </td>
            <td>
                ${actions}
            </td>
        </tr>
    `;
}

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
                (item) =>
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

async function rejectApplication(
    applicationId
) {
    const reason =
        prompt(
            "Enter the reason for rejecting this application:"
        );

    if (reason === null) {
        return;
    }

    const trimmedReason =
        reason.trim();

    if (!trimmedReason) {
        alert(
            "Rejection reason is required."
        );

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
                                trimmedReason
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
                (member) =>
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
                        colspan="7"
                        style="text-align:center;">
                        No member data available yet.
                    </td>
                </tr>
            `;

            return;
        }

        body.innerHTML =
            members
                .map(
                    (member) => `
                        <tr>
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
                                <span class="status ${getStatusClass(
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
                                    type="button"
                                    onclick="removeMember(${member.id})"
                                >
                                    Remove
                                </button>
                            </td>
                        </tr>
                    `
                )
                .join("");
    } catch (error) {
        console.error(
            "Members loading error:",
            error
        );
    }
}

async function removeMember(
    memberId
) {
    const confirmed =
        confirm(
            "Remove this membership and move it to Archived Members?"
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
                        "DELETE"
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
            loadAttendance()
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
                        colspan="8"
                        style="text-align:center;">
                        No archived memberships.
                    </td>
                </tr>
            `;

            return;
        }

        body.innerHTML =
            archivedMembers
                .map(
                    (member) => {
                        const restored =
                            Boolean(
                                member.restored_at
                            ) ||
                            getStatus(
                                member.status
                            ) === "RESTORED";

                        const displayStatus =
                            restored
                                ? "RESTORED"
                                : "ARCHIVED";

                        const action =
                            restored
                                ? `
                                    <button
                                        type="button"
                                        onclick="deleteArchivedMember(${member.archive_id})"
                                    >
                                        Delete
                                    </button>
                                `
                                : `
                                    <button
                                        class="red-button"
                                        type="button"
                                        onclick="restoreArchivedMember(${member.archive_id})"
                                    >
                                        Restore
                                    </button>
                                `;

                        return `
                            <tr>
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
                                    <span class="status ${getStatusClass(
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
    } catch (error) {
        console.error(
            "Archived members loading error:",
            error
        );

        body.innerHTML = `
            <tr>
                <td
                    colspan="8"
                    style="text-align:center;">
                    Unable to load archived memberships.
                </td>
            </tr>
        `;
    }
}

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
                        colspan="6"
                        style="text-align:center;">
                        No transaction data available yet.
                    </td>
                </tr>
            `;

            return;
        }

        body.innerHTML =
            transactions
                .map(
                    (transaction) => `
                        <tr>
                            <td>
                                ${transaction.id}
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
                                    type="button"
                                    onclick="deleteTransaction(${transaction.id})"
                                >
                                    Delete
                                </button>
                            </td>
                        </tr>
                    `
                )
                .join("");
    } catch (error) {
        console.error(
            "Transactions loading error:",
            error
        );
    }
}

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
                (record) =>
                    String(
                        record.user_type ||
                        ""
                    ).toUpperCase() ===
                    "MEMBER" &&
                    !record.check_out
            ).length;

        const guestsInside =
            attendance.filter(
                (record) =>
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

        const currentAttendance =
            attendance.filter(
                (record) =>
                    !record.check_out
            );

        if (
            currentAttendance.length ===
            0
        ) {
            body.innerHTML = `
                <tr>
                    <td
                        colspan="4"
                        style="text-align:center;">
                        Nobody is currently inside the gym.
                    </td>
                </tr>
            `;

            return;
        }

        body.innerHTML =
            currentAttendance
                .map(
                    (record) => `
                        <tr>
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
                                <button
                                    type="button"
                                    onclick="checkoutAttendance(${record.id})"
                                >
                                    Check Out
                                </button>
                            </td>
                        </tr>
                    `
                )
                .join("");
    } catch (error) {
        console.error(
            "Attendance loading error:",
            error
        );
    }
}

async function checkoutAttendance(
    attendanceId
) {
    const confirmed =
        confirm(
            "Check out this person?"
        );

    if (!confirmed) {
        return;
    }

    try {
        const data =
            await apiRequest(
                `/api/admin/attendance/${attendanceId}/checkout`,
                {
                    method:
                        "PATCH"
                }
            );

        alert(
            data.message ||
            "Checked out successfully."
        );

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

        alert(
            error.message ||
            "Unable to check out."
        );
    }
}

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
                                visitType ||
                                "GUEST",
                            amount_paid:
                                Number(
                                    amountPaid ||
                                    0
                                ),
                            payment_method:
                                paymentMethod ||
                                ""
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
                (camera) => {
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

function updatePeakBars(
    hourly
) {
    const hourMap =
        {};

    hourly.forEach(
        (item) => {
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
                        hourMap[hour] ||
                        0
                    )
            })
        );

    const max =
        Math.max(
            1,
            ...values.map(
                (
                    item
                ) =>
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
                    (item) => `
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
            loadMembers(),
            loadTransactions(),
            loadAttendance(),
            loadReports()
        ]);
    } catch (error) {
        console.error(
            "Admin refresh error:",
            error
        );
    }
}

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

function updateOccupancyBar(
    occupancy,
    capacity
) {
    const percentage =
        capacity > 0
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
        (
            element
        ) => {
            element.style.width =
                `${percentage}%`;
        }
    );
}

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
        max > 0
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

document.addEventListener(
    "DOMContentLoaded",
    async () => {
        if (!checkAdminAccess()) {
            return;
        }

        showPageById(
            "dashboard"
        );

        refreshTimer =
            setInterval(
                refreshAdminData,
                5000
            );
    }
);