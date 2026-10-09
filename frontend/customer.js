// =====================================
// ANCHOR GYM - CUSTOMER DASHBOARD
// =====================================

let customerData = null;
let customerRefreshTimer = null;
let selectedNotificationIds = new Set();


// =====================================
// PAGE NAVIGATION
// =====================================

function showPage(id, button) {

    document
        .querySelectorAll(".page")
        .forEach(page => {

            page.classList.remove("active");

        });


    const page =
        document.getElementById(id);


    if (page) {

        page.classList.add("active");

    }


    document
        .querySelectorAll("nav button")
        .forEach(btn => {

            btn.classList.remove("active");

        });


    if (button) {

        button.classList.add("active");

    }


    loadPageSpecificData(id);

}


// =====================================
// SHOW PAGE BY ID
// =====================================

function showPageById(id) {

    document
        .querySelectorAll(".page")
        .forEach(page => {

            page.classList.remove("active");

        });


    const page =
        document.getElementById(id);


    if (page) {

        page.classList.add("active");

    }


    document
        .querySelectorAll("nav button")
        .forEach(btn => {

            btn.classList.remove("active");

        });


    const navButton =
        document.querySelector(
            `nav button[onclick*="showPage('${id}'"]`
        );


    if (navButton) {

        navButton.classList.add("active");

    }


    loadPageSpecificData(id);

}


// =====================================
// PAGE-SPECIFIC DATA
// =====================================

function loadPageSpecificData(id) {

    if (!customerData) {

        return;

    }


    if (id === "dashboard") {

        refreshCustomerData(false);

    }


    if (id === "membership") {

        refreshCustomerData(false);

    }


    if (id === "transactions") {

        refreshCustomerData(false);

    }


    if (id === "qr") {

        refreshCustomerData(false);

    }


    if (id === "notifications") {

        refreshCustomerData(false);

    }


    if (id === "profile") {

        refreshCustomerData(false);

    }

}


// =====================================
// LOAD LOGGED-IN CUSTOMER
// =====================================

async function loadCustomer() {

    const savedUser =
        localStorage.getItem(
            "anchorUser"
        );


    if (!savedUser) {

        window.location.href =
            "login.html";

        return;

    }


    try {

        const user =
            JSON.parse(savedUser);


        if (
            !user ||
            !user.id
        ) {

            throw new Error(
                "Invalid customer login information."
            );

        }


        customerData = user;


        displayCustomer(user);


        await refreshCustomerData(false);


        // ---------------------------------
        // AUTO REFRESH EVERY 5 SECONDS
        // ---------------------------------

        if (customerRefreshTimer) {

            clearInterval(
                customerRefreshTimer
            );

        }


        customerRefreshTimer =
            setInterval(
                function() {

                    refreshCustomerData(true);

                },
                5000
            );


    } catch (error) {

        console.error(
            "Customer loading error:",
            error
        );


        localStorage.removeItem(
            "anchorUser"
        );


        alert(
            "Unable to load your account.\n\n" +
            error.message
        );


        window.location.href =
            "login.html";

    }

}


// =====================================
// REFRESH CUSTOMER DATA
// =====================================

async function refreshCustomerData(
    silent = true
) {

    if (
        !customerData ||
        !customerData.id
    ) {

        return;

    }


    try {

        const response =
            await fetch(
                window.anchorApiUrl(
                    `/api/customer/${customerData.id}`
                ),
                {
                    cache: "no-store"
                }
            );


        const data =
            await response.json();


        if (
            !response.ok ||
            !data.success
        ) {

            throw new Error(
                data.message ||
                "Unable to refresh customer information."
            );

        }


        // ---------------------------------
        // CUSTOMER
        // ---------------------------------

        if (data.customer) {

            customerData = {
                ...customerData,
                ...data.customer
            };


            displayCustomer(
                customerData
            );

        }


        // ---------------------------------
        // MEMBERSHIP
        // ---------------------------------

        displayMembership(
            data.membership || null
        );


        // ---------------------------------
        // APPLICATION
        // ---------------------------------

        displayApplication(
            data.application || null,
            data.membership || null
        );


        // ---------------------------------
        // TRANSACTIONS
        // ---------------------------------

        displayTransactions(
            data.transactions || []
        );


        // ---------------------------------
        // NOTIFICATIONS
        // ---------------------------------

        displayNotifications(
            data.notifications || []
        );


    } catch (error) {

        console.error(
            "Customer refresh error:",
            error
        );


        if (!silent) {

            alert(
                "Unable to load your account information.\n\n" +
                error.message
            );

        }

    }

}


// =====================================
// DISPLAY CUSTOMER ACCOUNT
// =====================================

function displayCustomer(user) {

    const fullName =
        user.full_name || "Customer";


    const firstName =
        fullName
            .trim()
            .split(/\s+/)[0] ||
        "Customer";


    // ---------------------------------
    // TOP RIGHT USER
    // ---------------------------------

    const topbarName =
        document.getElementById(
            "topbarCustomerName"
        );


    const topbarUser =
        document.querySelector(
            ".topbar .user"
        );


    if (topbarUser) {

        const initials =
            getInitials(fullName);


        const avatar =
            topbarUser.querySelector(
                ".avatar"
            );


        if (avatar) {

            avatar.textContent =
                initials;

        }


        if (topbarName) {

            topbarName.textContent =
                fullName;

        } else {

            const oldText =
                topbarUser.querySelector(
                    "span"
                );


            if (oldText) {

                oldText.textContent =
                    fullName;

            }

        }

    }


    // ---------------------------------
    // WELCOME
    // ---------------------------------

    const welcome =
        document.getElementById(
            "dashboardWelcome"
        );


    if (welcome) {

        welcome.textContent =
            `Welcome back, ${firstName}!`;

    }


    // ---------------------------------
    // PROFILE
    // ---------------------------------

    const profileName =
        document.getElementById(
            "profileFullName"
        );


    const profileEmail =
        document.getElementById(
            "profileEmail"
        );


    const profilePhone =
        document.getElementById(
            "profilePhone"
        );


    if (profileName) {

        profileName.value =
            user.full_name || "";

    }


    if (profileEmail) {

        profileEmail.value =
            user.email || "";

    }


    if (profilePhone) {

        profilePhone.value =
            user.phone || "";

    }

}


// =====================================
// DISPLAY MEMBERSHIP
// =====================================

function displayMembership(
    membership
) {

    // ---------------------------------
    // NO MEMBERSHIP
    // ---------------------------------

    if (!membership) {

        displayNoMembership();

        return;

    }


    const status =
        String(
            membership.status || ""
        ).toUpperCase();


    const plan =
        membership.membership_plan ||
        membership.plan ||
        "Monthly";


    const memberId =
        membership.member_id ||
        "—";


    const startDate =
        membership.start_date ||
        membership.registration_date ||
        membership.created_at ||
        null;


    const expirationDate =
        membership.expiration_date ||
        membership.end_date ||
        membership.expires_at ||
        null;


    const daysRemaining =
        calculateDaysRemaining(
            expirationDate
        );


    // ---------------------------------
    // DASHBOARD STAT CARDS
    // ---------------------------------

    setText(
        "dashboardMembershipStatus",
        status || "PENDING"
    );


    setText(
        "dashboardPlan",
        plan
    );


    setText(
        "dashboardMemberId",
        memberId
    );


    if (status === "ACTIVE") {

        setText(
            "dashboardMembershipDescription",
            "Your membership is active."
        );

    } else {

        setText(
            "dashboardMembershipDescription",
            "Your membership is not active."
        );

    }


    if (expirationDate) {

        setText(
            "dashboardDaysRemaining",
            daysRemaining >= 0
                ? daysRemaining
                : 0
        );


        setText(
            "dashboardExpiration",
            `Expires ${formatDate(expirationDate)}`
        );

    } else {

        setText(
            "dashboardDaysRemaining",
            "—"
        );


        setText(
            "dashboardExpiration",
            "No membership expiration."
        );

    }


    // ---------------------------------
    // DASHBOARD MEMBERSHIP CARD
    // ---------------------------------

    const badge =
        document.getElementById(
            "dashboardMembershipBadge"
        );


    const title =
        document.getElementById(
            "dashboardMembershipTitle"
        );


    const details =
        document.getElementById(
            "dashboardMembershipDetails"
        );


    if (badge) {

        badge.textContent =
            `● ${status || "PENDING"}`;

    }


    if (title) {

        if (status === "ACTIVE") {

            title.textContent =
                "Active Membership";

        } else if (status === "EXPIRED") {

            title.textContent =
                "Membership Expired";

        } else if (status === "SUSPENDED") {

            title.textContent =
                "Membership Suspended";

        } else {

            title.textContent =
                "Membership Pending";

        }

    }


    if (details) {

        if (status === "ACTIVE") {

            details.textContent =
                `Your ${plan} membership is active. Member ID: ${memberId}.`;

        } else {

            details.textContent =
                `Membership status: ${status || "PENDING"}.`;

        }

    }


    // ---------------------------------
    // MEMBERSHIP PROGRESS BOX
    // ---------------------------------

    const progressBox =
        document.getElementById(
            "membershipProgressBox"
        );


    if (progressBox) {

        if (status === "ACTIVE") {

            progressBox.innerHTML = `

                <strong>
                    Your membership is ACTIVE.
                </strong>

                <br><br>

                Plan:
                <strong>
                    ${escapeHtml(plan)}
                </strong>

                <br>

                Member ID:
                <strong>
                    ${escapeHtml(memberId)}
                </strong>

                <br>

                Expiration:
                <strong>
                    ${
                        expirationDate
                            ? formatDate(expirationDate)
                            : "—"
                    }
                </strong>

                <br>

                Days Remaining:
                <strong>
                    ${
                        expirationDate
                            ? Math.max(
                                0,
                                daysRemaining
                              )
                            : "—"
                    }
                </strong>

            `;

        } else {

            progressBox.innerHTML = `

                Membership Status:
                <strong>
                    ${escapeHtml(status || "PENDING")}
                </strong>

                <br><br>

                Your membership is not currently active.

            `;

        }

    }


    // ---------------------------------
    // MY MEMBERSHIP PAGE
    // ---------------------------------

    setText(
        "membershipPageStatus",
        `● ${status || "PENDING"}`
    );


    setText(
        "membershipPageTitle",
        getMembershipTitle(status)
    );


    const membershipDescription =
        document.getElementById(
            "membershipPageDescription"
        );


    if (membershipDescription) {

        membershipDescription.textContent =
            getMembershipDescription(
                status
            );

    }


    setText(
        "membershipMemberId",
        memberId
    );


    setText(
        "membershipPlan",
        plan
    );


    setText(
        "membershipStartDate",
        startDate
            ? formatDate(startDate)
            : "—"
    );


    setText(
        "membershipExpiration",
        expirationDate
            ? formatDate(expirationDate)
            : "—"
    );


    setText(
        "membershipDaysRemaining",
        expirationDate
            ? Math.max(
                0,
                daysRemaining
              )
            : "—"
    );


    // ---------------------------------
    // QR CODE
    // ---------------------------------

    displayQR(
        membership
    );

}


// =====================================
// NO MEMBERSHIP
// =====================================

function displayNoMembership() {

    // ---------------------------------
    // DASHBOARD
    // ---------------------------------

    setText(
        "dashboardMembershipStatus",
        "NOT A MEMBER"
    );


    setText(
        "dashboardPlan",
        "—"
    );


    setText(
        "dashboardDaysRemaining",
        "—"
    );


    setText(
        "dashboardMemberId",
        "—"
    );


    setText(
        "dashboardMembershipDescription",
        "You do not have an active membership yet."
    );


    setText(
        "dashboardPlanDescription",
        "Apply for membership to get started."
    );


    setText(
        "dashboardExpiration",
        "No membership expiration."
    );


    setText(
        "dashboardMembershipBadge",
        "● NOT A MEMBER"
    );


    setText(
        "dashboardMembershipTitle",
        "Not Registered"
    );


    setText(
        "dashboardMembershipDetails",
        "You have a customer account, but you have not activated a gym membership yet."
    );


    const progressBox =
        document.getElementById(
            "membershipProgressBox"
        );


    if (progressBox) {

        progressBox.innerHTML = `

            You do not have an active membership.

            <br><br>

            Apply for membership and submit
            your ₱800 GCash payment proof
            for admin review.

        `;

    }


    // ---------------------------------
    // MY MEMBERSHIP
    // ---------------------------------

    setText(
        "membershipPageStatus",
        "● NOT A MEMBER"
    );


    setText(
        "membershipPageTitle",
        "No Active Membership"
    );


    setText(
        "membershipMemberId",
        "—"
    );


    setText(
        "membershipPlan",
        "—"
    );


    setText(
        "membershipStartDate",
        "—"
    );


    setText(
        "membershipExpiration",
        "—"
    );


    setText(
        "membershipDaysRemaining",
        "—"
    );


    const membershipDescription =
        document.getElementById(
            "membershipPageDescription"
        );


    if (membershipDescription) {

        membershipDescription.textContent =
            "You have a customer account, but you have not activated a gym membership yet.";

    }


    // ---------------------------------
    // QR
    // ---------------------------------

    displayNoQR();

}


// =====================================
// MEMBERSHIP TITLE
// =====================================

function getMembershipTitle(
    status
) {

    switch (status) {

        case "ACTIVE":
            return "Active Membership";

        case "EXPIRED":
            return "Membership Expired";

        case "SUSPENDED":
            return "Membership Suspended";

        case "PENDING":
            return "Membership Pending";

        default:
            return "No Active Membership";

    }

}


// =====================================
// MEMBERSHIP DESCRIPTION
// =====================================

function getMembershipDescription(
    status
) {

    switch (status) {

        case "ACTIVE":
            return "Your membership is active and ready to use.";

        case "EXPIRED":
            return "Your membership has expired. Please renew your membership.";

        case "SUSPENDED":
            return "Your membership is currently suspended. Please contact the gym.";

        case "PENDING":
            return "Your membership application is still waiting for admin approval.";

        default:
            return "You do not currently have an active gym membership.";

    }

}


// =====================================
// DISPLAY APPLICATION
// =====================================

function displayApplication(
    application,
    membership
) {

    const statusElement =
        document.getElementById(
            "customerApplicationStatus"
        );


    const messageElement =
        document.getElementById(
            "customerApplicationMessage"
        );


    if (
        !statusElement ||
        !messageElement
    ) {

        return;

    }


    if (!application) {

        statusElement.textContent =
            "NO APPLICATION";


        messageElement.textContent =
            "You have not submitted a membership application yet.";

        return;

    }


    const status =
        String(
            application.status ||
            ""
        )
            .trim()
            .toUpperCase();


    if (
        status === "APPROVED" &&
        !membership &&
        application.membership_removed === true
    ) {

        statusElement.textContent =
            "MEMBERSHIP REMOVED";


        messageElement.textContent =
            application.removal_reason
                ? `Your previous membership was removed by the gym administrator. Reason: ${application.removal_reason}`
                : "Your previous membership was approved, but the membership has been removed by the gym administrator. You may apply again to activate a new membership.";


        return;

    }


    if (
        status === "APPROVED" &&
        membership
    ) {

        statusElement.textContent =
            "APPROVED";


        messageElement.textContent =
            "Your payment has been verified and your membership has been activated.";

        return;

    }


    if (
        status === "PENDING"
    ) {

        statusElement.textContent =
            "PENDING";


        messageElement.textContent =
            "Your application and payment are currently being reviewed by the gym administrator.";

        return;

    }


    if (
        status === "REJECTED"
    ) {

        statusElement.textContent =
            "REJECTED";


        messageElement.textContent =
            application.rejection_reason
                ? `Your application was rejected. Reason: ${application.rejection_reason}`
                : "Your membership application was rejected.";

        return;

    }


    statusElement.textContent =
        status ||
        "UNKNOWN";


    messageElement.textContent =
        "Your application status has been updated.";

}


// =====================================
// DISPLAY NOTIFICATIONS
// =====================================

function displayNotifications(
    notifications
) {

    const safeNotifications =
        Array.isArray(
            notifications
        )
            ? notifications
            : [];


    const unreadCount =
        safeNotifications.filter(
            notification =>
                !isNotificationRead(
                    notification
                )
        ).length;


    setText(
        "notificationCount",
        unreadCount
    );


    const dashboardContainer =
        document.getElementById(
            "dashboardNotifications"
        );


    const notificationsContainer =
        document.getElementById(
            "notificationsContainer"
        );

    const availableNotificationIds =
        new Set(
            safeNotifications
                .map(notification => Number(notification.id))
                .filter(Number.isInteger)
        );

    selectedNotificationIds =
        new Set(
            Array.from(selectedNotificationIds)
                .filter(id => availableNotificationIds.has(id))
        );


    if (
        safeNotifications.length ===
        0
    ) {

        const emptyDashboard = `

            <div class="notification">

                <b>
                    No New Notifications
                </b>

                <p>
                    You currently have no notifications.
                </p>

            </div>

        `;


        const emptyNotifications = `

            <div class="notification">

                <b>
                    No Notifications
                </b>

                <p>
                    You currently have no notifications.
                </p>

            </div>

        `;


        if (dashboardContainer) {

            dashboardContainer.innerHTML =
                emptyDashboard;

        }


        if (notificationsContainer) {

            notificationsContainer.innerHTML =
                emptyNotifications;

        }

        updateNotificationSelection();

        return;

    }


    const dashboardNotifications =
        safeNotifications
            .slice(
                0,
                5
            )
            .map(
                notification =>
                    createNotificationHtml(
                        notification,
                        false
                    )
            )
            .join("");


    const allNotifications =
        safeNotifications
            .map(
                notification =>
                    createNotificationHtml(
                        notification,
                        true
                    )
            )
            .join("");


    if (dashboardContainer) {

        dashboardContainer.innerHTML =
            dashboardNotifications;

    }


    if (notificationsContainer) {

        notificationsContainer.innerHTML =
            allNotifications;

    }

    updateNotificationSelection();

}


// =====================================
// CREATE NOTIFICATION HTML
// =====================================

function createNotificationHtml(
    notification,
    selectable = false
) {

    const title =
        notification.title ||
        "ANCHOR Notification";


    const message =
        notification.message ||
        notification.body ||
        notification.description ||
        "";


    const createdAt =
        notification.created_at ||
        notification.createdAt ||
        null;


    const read =
        isNotificationRead(
            notification
        );


    const unreadStyle =
        read
            ? ""
            : "border-left:4px solid #dc2626;";

    const notificationId =
        Number(notification.id);

    const selectionControl =
        selectable &&
        Number.isInteger(notificationId)
            ? `
                <label class="notification-select">
                    <input
                        class="notification-checkbox"
                        type="checkbox"
                        data-notification-id="${notificationId}"
                        ${selectedNotificationIds.has(notificationId) ? "checked" : ""}
                        onchange="setNotificationSelected(${notificationId}, this.checked)">
                    Select
                </label>
              `
            : "";


    return `

        <div
            class="notification"
            style="${unreadStyle}">

            ${selectionControl}

            <b>
                ${escapeHtml(title)}
            </b>

            <p>
                ${escapeHtml(message)}
            </p>

            ${
                createdAt
                    ? `
                        <small>
                            ${escapeHtml(
                                formatDateTime(
                                    createdAt
                                )
                            )}
                        </small>
                    `
                    : ""
            }

        </div>

    `;

}

function setNotificationSelected(
    notificationId,
    selected
) {

    if (selected) {
        selectedNotificationIds.add(
            Number(notificationId)
        );
    } else {
        selectedNotificationIds.delete(
            Number(notificationId)
        );
    }

    updateNotificationSelection();
}


function toggleAllNotifications(
    selected
) {

    document
        .querySelectorAll(
            "#notificationsContainer .notification-checkbox"
        )
        .forEach(
            checkbox => {

                checkbox.checked =
                    selected;

                const notificationId =
                    Number(checkbox.dataset.notificationId);

                if (selected) {
                    selectedNotificationIds.add(notificationId);
                } else {
                    selectedNotificationIds.delete(notificationId);
                }

            }
        );

    updateNotificationSelection();
}


function updateNotificationSelection() {

    const count =
        selectedNotificationIds.size;

    const countElement =
        document.getElementById(
            "selectedNotificationsCount"
        );

    const deleteButton =
        document.getElementById(
            "deleteSelectedNotificationsButton"
        );

    const selectAll =
        document.getElementById(
            "selectAllNotifications"
        );

    const notificationCheckboxes =
        Array.from(
            document.querySelectorAll(
                "#notificationsContainer .notification-checkbox"
            )
        );

    if (countElement) {
        countElement.textContent =
            `${count} selected`;
    }

    if (deleteButton) {
        deleteButton.disabled =
            count === 0;
    }

    if (selectAll) {
        const checkedCount =
            notificationCheckboxes.filter(
                checkbox => checkbox.checked
            ).length;

        selectAll.checked =
            notificationCheckboxes.length > 0 &&
            checkedCount === notificationCheckboxes.length;

        selectAll.indeterminate =
            checkedCount > 0 &&
            checkedCount < notificationCheckboxes.length;

        selectAll.disabled =
            notificationCheckboxes.length === 0;
    }
}


async function deleteSelectedNotifications() {

    if (
        !customerData ||
        !Number.isInteger(Number(customerData.id))
    ) {
        alert("Unable to identify the customer account.");
        return;
    }

    const notificationIds =
        Array.from(selectedNotificationIds);

    if (!notificationIds.length) {
        return;
    }

    const confirmed =
        confirm(
            `Permanently delete ${notificationIds.length} selected notification(s)?`
        );

    if (!confirmed) {
        return;
    }

    const failedIds = [];

    for (const notificationId of notificationIds) {

        try {

            const response =
                await fetch(
                    window.anchorApiUrl(
                        `/api/customer/${Number(customerData.id)}/notifications/${notificationId}`
                    ),
                    {
                        method: "DELETE",
                        cache: "no-store"
                    }
                );

            const data =
                await response.json();

            if (!response.ok || data.success === false) {
                throw new Error(
                    data.message ||
                    `Unable to delete notification ${notificationId}.`
                );
            }

            selectedNotificationIds.delete(
                notificationId
            );

        } catch (error) {

            console.error(
                `Notification deletion failed for ${notificationId}:`,
                error
            );

            failedIds.push(notificationId);

        }
    }

    await refreshCustomerData(false);

    if (failedIds.length) {
        alert(
            `${notificationIds.length - failedIds.length} notification(s) deleted. ` +
            `Unable to delete notification ID(s): ${failedIds.join(", ")}.`
        );

        return;
    }

    alert(
        `${notificationIds.length} notification(s) deleted successfully.`
    );
}


// =====================================
// CHECK NOTIFICATION READ STATUS
// =====================================

function isNotificationRead(
    notification
) {

    if (!notification) {

        return false;

    }


    if (
        typeof notification.is_read !==
        "undefined"
    ) {

        return (
            notification.is_read === true ||
            notification.is_read === 1 ||
            String(
                notification.is_read
            ).toLowerCase() === "true"
        );

    }


    if (
        typeof notification.read !==
        "undefined"
    ) {

        return (
            notification.read === true ||
            notification.read === 1 ||
            String(
                notification.read
            ).toLowerCase() === "true"
        );

    }


    return false;

}


// =====================================
// DISPLAY TRANSACTIONS
// =====================================

function displayTransactions(
    transactions
) {

    // ---------------------------------
    // MAIN TRANSACTION PAGE
    // ---------------------------------

    const tableBody =
        document.getElementById(
            "customerTransactionsBody"
        );


    if (tableBody) {

        if (
            transactions.length ===
            0
        ) {

            tableBody.innerHTML = `

                <tr>

                    <td
                        colspan="5"
                        style="text-align:center;">

                        No transactions yet.

                    </td>

                </tr>

            `;

        } else {

            tableBody.innerHTML =
                transactions
                    .map(
                        transaction =>
                            createTransactionRow(
                                transaction
                            )
                    )
                    .join("");

        }

    }


    // ---------------------------------
    // DASHBOARD RECENT TRANSACTIONS
    // ---------------------------------

    const recentBody =
        document.getElementById(
            "recentTransactionsBody"
        );


    if (recentBody) {

        const recent =
            transactions.slice(
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

                        No transactions yet.

                    </td>

                </tr>

            `;

        } else {

            recentBody.innerHTML =
                recent
                    .map(
                        transaction =>
                            createRecentTransactionRow(
                                transaction
                            )
                    )
                    .join("");

        }

    }

}


// =====================================
// CREATE TRANSACTION ROW
// =====================================

function createTransactionRow(
    transaction
) {

    const status =
        String(
            transaction.status ||
            "PENDING"
        ).toUpperCase();


    return `

        <tr>

            <td>
                ${escapeHtml(
                    String(
                        transaction.id ||
                        "—"
                    )
                )}
            </td>


            <td>
                ${
                    transaction.transaction_date
                        ? formatDate(
                            transaction.transaction_date
                          )
                        : "—"
                }
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
                    transaction.reference ||
                    "—"
                )}
            </td>


            <td>

                <span
                    class="${getStatusClass(status)}">

                    ${escapeHtml(status)}

                </span>

            </td>

        </tr>

    `;

}


// =====================================
// CREATE RECENT TRANSACTION ROW
// =====================================

function createRecentTransactionRow(
    transaction
) {

    const status =
        String(
            transaction.status ||
            "PENDING"
        ).toUpperCase();


    return `

        <tr>

            <td>
                ${
                    transaction.transaction_date
                        ? formatDate(
                            transaction.transaction_date
                          )
                        : "—"
                }
            </td>


            <td>
                Membership Payment
            </td>


            <td>
                ₱${Number(
                    transaction.amount ||
                    0
                ).toLocaleString()}
            </td>


            <td>

                <span
                    class="${getStatusClass(status)}">

                    ${escapeHtml(status)}

                </span>

            </td>

        </tr>

    `;

}


// =====================================
// DISPLAY QR
// =====================================

function displayQR(
    membership
) {

    const qrStatus =
        document.getElementById(
            "qrStatus"
        );


    const qrContainer =
        document.getElementById(
            "qrCodeContainer"
        );


    const qrTitle =
        document.getElementById(
            "qrTitle"
        );


    const qrDescription =
        document.getElementById(
            "qrDescription"
        );


    const status =
        String(
            membership.status ||
            ""
        ).toUpperCase();


    // ---------------------------------
    // QR ONLY AVAILABLE FOR ACTIVE
    // MEMBERSHIP
    // ---------------------------------

    if (
        status !== "ACTIVE"
    ) {

        displayNoQR();

        return;

    }


    const qrImage =
        membership.qr_image ||
        membership.qrImage;


    const qrCode =
        membership.qr_code ||
        membership.qrCode;


    if (
        !qrImage &&
        !qrCode
    ) {

        displayNoQR();

        return;

    }


    if (qrStatus) {

        qrStatus.textContent =
            "● ACTIVE";

    }


    if (qrTitle) {

        qrTitle.textContent =
            "Your ANCHOR QR Code";

    }


    if (qrDescription) {

        qrDescription.textContent =
            "Use this QR code for gym attendance and membership verification.";

    }


    if (qrContainer) {

        if (qrImage) {

            qrContainer.innerHTML = `

                <img
                    src="${escapeAttribute(qrImage)}"
                    alt="ANCHOR Gym Membership QR Code"
                    style="
                        width:220px;
                        max-width:100%;
                        height:auto;
                        display:block;
                        margin:0 auto;
                    "
                >

            `;

        } else {

            qrContainer.innerHTML = `

                <div
                    style="
                        padding:20px;
                        word-break:break-all;
                        text-align:center;
                    ">

                    ${escapeHtml(qrCode)}

                </div>

            `;

        }

    }

}


// =====================================
// NO QR
// =====================================

function displayNoQR() {

    const qrStatus =
        document.getElementById(
            "qrStatus"
        );


    const qrContainer =
        document.getElementById(
            "qrCodeContainer"
        );


    const qrTitle =
        document.getElementById(
            "qrTitle"
        );


    const qrDescription =
        document.getElementById(
            "qrDescription"
        );


    if (qrStatus) {

        qrStatus.textContent =
            "● NOT AVAILABLE";

    }


    if (qrContainer) {

        qrContainer.innerHTML =
            "—";

    }


    if (qrTitle) {

        qrTitle.textContent =
            "No QR Code Yet";

    }


    if (qrDescription) {

        qrDescription.textContent =
            "Your QR code will be generated after your membership application is approved.";

    }

}


// =====================================
// SUBMIT APPLICATION
// =====================================

async function submitApplication() {

    const savedUser =
        localStorage.getItem(
            "anchorUser"
        );


    if (!savedUser) {

        alert(
            "You are not logged in."
        );


        window.location.href =
            "login.html";


        return;

    }


    let user;


    try {

        user =
            JSON.parse(
                savedUser
            );

    } catch (error) {

        alert(
            "Invalid customer session."
        );


        localStorage.removeItem(
            "anchorUser"
        );


        window.location.href =
            "login.html";


        return;

    }


    if (
        !user ||
        !user.id
    ) {

        alert(
            "Customer ID is missing from the login session."
        );

        return;

    }


    // ---------------------------------
    // FORM ELEMENTS
    // ---------------------------------

    const referenceInput =
        document.getElementById(
            "reference"
        );


    const paymentDateInput =
        document.getElementById(
            "paymentDate"
        );


    const screenshotInput =
        document.getElementById(
            "paymentScreenshot"
        );


    if (
        !referenceInput ||
        !paymentDateInput ||
        !screenshotInput
    ) {

        alert(
            "Application form could not be found."
        );

        return;

    }


    const reference =
        referenceInput.value.trim();


    const paymentDate =
        paymentDateInput.value;


    // ---------------------------------
    // VALIDATION
    // ---------------------------------

    if (!reference) {

        alert(
            "Please enter your GCash reference number."
        );

        return;

    }


    if (!paymentDate) {

        alert(
            "Please select the payment date."
        );

        return;

    }


    if (
        !screenshotInput.files ||
        screenshotInput.files.length ===
        0
    ) {

        alert(
            "Please upload your GCash payment screenshot."
        );

        return;

    }


    const file =
        screenshotInput.files[0];


    const allowedTypes = [
        "image/png",
        "image/jpeg",
        "image/webp"
    ];


    if (
        !allowedTypes.includes(
            file.type
        )
    ) {

        alert(
            "Please upload a PNG, JPG, JPEG, or WEBP image."
        );

        return;

    }


    const maxFileSize =
        6 * 1024 * 1024;


    if (
        file.size >
        maxFileSize
    ) {

        alert(
            "Payment screenshot is too large.\n\n" +
            "Please use an image smaller than 6MB."
        );

        return;

    }


    // ---------------------------------
    // DISABLE BUTTON
    // ---------------------------------

    const submitButton =
        document.querySelector(
            'button[onclick="submitApplication()"]'
        );


    if (submitButton) {

        submitButton.disabled =
            true;

        submitButton.textContent =
            "Submitting...";

    }


    // ---------------------------------
    // READ SCREENSHOT
    // ---------------------------------

    const reader =
        new FileReader();


    reader.onload =
        async function() {

            try {

                const screenshot =
                    reader.result;


                const response =
                    await fetch(
                        window.anchorApiUrl("/api/applications"),
                        {
                            method:
                                "POST",

                            headers: {
                                "Content-Type":
                                    "application/json"
                            },

                            body:
                                JSON.stringify({

                                    user_id:
                                        user.id,

                                    membership_plan:
                                        "Monthly",

                                    amount:
                                        800,

                                    gcash_reference:
                                        reference,

                                    payment_date:
                                        paymentDate,

                                    payment_screenshot:
                                        screenshot

                                })

                        }
                    );


                const responseText =
                    await response.text();


                let data;


                try {

                    data =
                        JSON.parse(
                            responseText
                        );

                } catch (error) {

                    throw new Error(
                        `Server returned an invalid response. HTTP ${response.status}`
                    );

                }


                if (
                    !response.ok ||
                    !data.success
                ) {

                    throw new Error(
                        data.message ||
                        data.error ||
                        "Unable to submit application."
                    );

                }


                alert(
                    "Application submitted successfully!\n\n" +
                    "Your application is now PENDING for admin review."
                );


                // ---------------------------------
                // CLEAR FORM
                // ---------------------------------

                referenceInput.value =
                    "";


                paymentDateInput.value =
                    "";


                screenshotInput.value =
                    "";


                // ---------------------------------
                // REFRESH DATA
                // ---------------------------------

                await refreshCustomerData(
                    false
                );


                // ---------------------------------
                // GO TO MEMBERSHIP PAGE
                // ---------------------------------

                showPageById(
                    "membership"
                );


            } catch (error) {

                console.error(
                    "Application submission error:",
                    error
                );


                alert(
                    "Unable to submit application.\n\n" +
                    error.message
                );


            } finally {

                if (submitButton) {

                    submitButton.disabled =
                        false;

                    submitButton.textContent =
                        "Submit Application";

                }

            }

        };


    reader.onerror =
        function() {

            if (submitButton) {

                submitButton.disabled =
                    false;

                submitButton.textContent =
                    "Submit Application";

            }


            alert(
                "Unable to read the payment screenshot."
            );

        };


    reader.readAsDataURL(
        file
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


    if (customerRefreshTimer) {

        clearInterval(
            customerRefreshTimer
        );

    }


    localStorage.removeItem(
        "anchorUser"
    );


    window.location.href =
        "login.html";

}


// =====================================
// GET INITIALS
// =====================================

function getInitials(
    name
) {

    return name
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .slice(
            0,
            2
        )
        .map(
            word =>
                word
                    .charAt(0)
                    .toUpperCase()
        )
        .join("");

}


// =====================================
// FORMAT DATE
// =====================================

function formatDate(
    dateValue
) {

    if (!dateValue) {

        return "—";

    }


    const date =
        new Date(
            dateValue
        );


    if (
        Number.isNaN(
            date.getTime()
        )
    ) {

        return "—";

    }


    return date.toLocaleDateString(
        "en-US",
        {
            month:
                "short",

            day:
                "numeric",

            year:
                "numeric"
        }
    );

}


// =====================================
// FORMAT DATE + TIME
// =====================================

function formatDateTime(
    dateValue
) {

    if (!dateValue) {

        return "—";

    }


    const date =
        new Date(
            dateValue
        );


    if (
        Number.isNaN(
            date.getTime()
        )
    ) {

        return "—";

    }


    return date.toLocaleString(
        "en-US",
        {
            month:
                "short",

            day:
                "numeric",

            year:
                "numeric",

            hour:
                "numeric",

            minute:
                "2-digit"
        }
    );

}


// =====================================
// CALCULATE DAYS REMAINING
// =====================================

function calculateDaysRemaining(
    expirationDate
) {

    if (!expirationDate) {

        return -1;

    }


    const today =
        new Date();


    const expiration =
        new Date(
            expirationDate
        );


    today.setHours(
        0,
        0,
        0,
        0
    );


    expiration.setHours(
        0,
        0,
        0,
        0
    );


    const difference =
        expiration -
        today;


    return Math.ceil(
        difference /
        (
            1000 *
            60 *
            60 *
            24
        )
    );

}


// =====================================
// GET STATUS CLASS
// =====================================

function getStatusClass(
    status
) {

    const normalized =
        String(
            status ||
            ""
        ).toLowerCase();


    if (
        normalized === "active" ||
        normalized === "approved" ||
        normalized === "verified"
    ) {

        return "approved";

    }


    if (
        normalized === "rejected" ||
        normalized === "suspended"
    ) {

        return "rejected";

    }


    if (
        normalized === "expired"
    ) {

        return "expired";

    }


    return "pending";

}


// =====================================
// SET TEXT
// =====================================

function setText(
    elementId,
    value
) {

    const element =
        document.getElementById(
            elementId
        );


    if (element) {

        element.textContent =
            value;

    }

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

        .replaceAll(
            "&",
            "&amp;"
        )

        .replaceAll(
            "<",
            "&lt;"
        )

        .replaceAll(
            ">",
            "&gt;"
        )

        .replaceAll(
            '"',
            "&quot;"
        )

        .replaceAll(
            "'",
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

        .replaceAll(
            "&",
            "&amp;"
        )

        .replaceAll(
            '"',
            "&quot;"
        )

        .replaceAll(
            "'",
            "&#039;"
        )

        .replaceAll(
            "<",
            "&lt;"
        )

        .replaceAll(
            ">",
            "&gt;"
        );

}


// =====================================
// PAGE LOAD
// =====================================

document.addEventListener(
    "DOMContentLoaded",
    function() {

        loadCustomer();

    }
);