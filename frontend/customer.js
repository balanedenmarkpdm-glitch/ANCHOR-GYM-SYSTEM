// =====================================
// ANCHOR GYM - CUSTOMER DASHBOARD
// =====================================

let customerData = null;
let customerRefreshTimer = null;
let selectedNotificationIds = new Set();
let profileEditMode = false;
let selectedProfilePhotoData = null;
let attendanceReportPeriod = "weekly";
let attendanceReportRequestId = 0;
let rotatingQrMemberId = null;
let rotatingQrExpiry = 0;
let rotatingQrTimeout = null;
let rotatingQrCountdown = null;
let rotatingQrLoading = false;


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

function showPageById(id, refreshData = true) {

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


    loadPageSpecificData(id, refreshData);

}


// =====================================
// PAGE-SPECIFIC DATA
// =====================================

function loadPageSpecificData(id, refreshData = true) {

    if (!customerData || !refreshData) {

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

    if (id === "attendance-report") {

        loadAttendanceReport();

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

    if (id === "apply") {

        updatePaymentDatePicker();

    }

}

function getCurrentManilaDate() {
    const parts =
        new Intl.DateTimeFormat(
            "en-US",
            {
                timeZone: "Asia/Manila",
                year: "numeric",
                month: "2-digit",
                day: "2-digit"
            }
        ).formatToParts(new Date());
    const values =
        Object.fromEntries(
            parts.map(part => [part.type, part.value])
        );

    return `${values.year}-${values.month}-${values.day}`;
}

function updatePaymentDatePicker() {
    const paymentDateInput =
        document.getElementById("paymentDate");

    if (!paymentDateInput) {
        return;
    }

    const today =
        getCurrentManilaDate();

    paymentDateInput.max = today;

    if (!paymentDateInput.value || paymentDateInput.value > today) {
        paymentDateInput.value = today;
    }
}


// =====================================
// LOAD LOGGED-IN CUSTOMER
// =====================================

async function loadCustomer() {

    const savedUser =
        window.anchorSession.get(
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


        window.anchorSession.remove(
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
        document.getElementById(
            "topbarProfileButton"
        );


    if (topbarUser) {

        const initials =
            getInitials(fullName);


        const avatar =
            topbarUser.querySelector(
                ".avatar"
            );


        if (avatar) {
            renderCustomerAvatar(
                avatar,
                initials,
                user.profile_name
            );

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


    if (profileName && !profileEditMode) {

        profileName.value =
            user.full_name || "";

    }


    if (profileEmail) {

        profileEmail.value =
            user.email || "";

    }


    if (profilePhone && !profileEditMode) {

        profilePhone.value =
            user.phone || "";

    }

    const profilePhotoPreview =
        document.getElementById(
            "profilePhotoPreview"
        );

    if (profilePhotoPreview && !profileEditMode) {
        renderCustomerAvatar(
            profilePhotoPreview,
            getInitials(fullName),
            user.profile_name
        );
    }

}

function renderCustomerAvatar(
    element,
    initials,
    photoPath
) {
    if (photoPath) {
        const imageSource =
            photoPath.startsWith("data:image/")
                ? photoPath
                : window.anchorApiUrl(photoPath);
        const currentImage =
            element.querySelector("img");

        if (
            currentImage &&
            currentImage.dataset.source === imageSource
        ) {
            return;
        }

        const image =
            document.createElement("img");

        image.src = imageSource;
        image.alt = "Customer profile photo";
        image.dataset.source = imageSource;
        element.replaceChildren(image);
        return;
    }

    element.replaceChildren();
    element.textContent =
        initials || "C";
}

function setProfileEditMode(enabled) {
    profileEditMode = enabled;

    const fullName =
        document.getElementById("profileFullName");
    const phone =
        document.getElementById("profilePhone");
    const currentPassword =
        document.getElementById("profileCurrentPassword");
    const photoInput =
        document.getElementById("profilePhoto");

    fullName.readOnly = !enabled;
    phone.readOnly = !enabled;
    currentPassword.disabled = !enabled;
    currentPassword.value = "";
    setProfilePasswordVisibility(
        "profileCurrentPassword",
        false
    );
    photoInput.hidden = !enabled;

    document.getElementById("editProfileButton").hidden =
        enabled;
    document.getElementById("saveProfileButton").hidden =
        !enabled;
    document.getElementById("cancelProfileButton").hidden =
        !enabled;

    if (enabled) {
        fullName.focus();
    }
}

function readProfilePhoto(file) {
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
        return Promise.reject(
            new Error("Choose a JPG, PNG, or WEBP image.")
        );
    }

    if (file.size > 5 * 1024 * 1024) {
        return Promise.reject(
            new Error("Profile photos must be 5MB or smaller.")
        );
    }

    return new Promise(
        (resolve, reject) => {
            const reader =
                new FileReader();

            reader.onload = () =>
                resolve(String(reader.result));
            reader.onerror = () =>
                reject(new Error("Unable to read the selected photo."));
            reader.readAsDataURL(file);
        }
    );
}

function initializeProfileEditor() {
    const profileForm =
        document.getElementById("customerProfileForm");
    const editButton =
        document.getElementById("editProfileButton");
    const cancelButton =
        document.getElementById("cancelProfileButton");
    const photoInput =
        document.getElementById("profilePhoto");
    const profileMessage =
        document.getElementById("profileMessage");

    editButton.addEventListener(
        "click",
        function() {
            profileMessage.textContent = "";
            selectedProfilePhotoData = null;
            document.getElementById("profileCurrentPassword").value = "";
            photoInput.value = "";
            setProfileEditMode(true);
        }
    );

    cancelButton.addEventListener(
        "click",
        function() {
            selectedProfilePhotoData = null;
            photoInput.value = "";
            setProfileEditMode(false);
            displayCustomer(customerData);
            profileMessage.textContent = "";
        }
    );

    document.getElementById("profilePhone").addEventListener(
        "input",
        function(event) {
            event.currentTarget.value =
                event.currentTarget.value
                    .replace(/\D/g, "")
                    .slice(0, 11);
        }
    );

    photoInput.addEventListener(
        "change",
        async function() {
            const file = photoInput.files[0];

            if (!file) {
                selectedProfilePhotoData = null;
                return;
            }

            try {
                selectedProfilePhotoData =
                    await readProfilePhoto(file);
                renderCustomerAvatar(
                    document.getElementById("profilePhotoPreview"),
                    getInitials(customerData.full_name),
                    selectedProfilePhotoData
                );
                profileMessage.textContent = "";
            } catch (error) {
                photoInput.value = "";
                selectedProfilePhotoData = null;
                profileMessage.textContent = error.message;
            }
        }
    );

    profileForm.addEventListener(
        "submit",
        async function(event) {
            event.preventDefault();

            const fullName =
                document.getElementById("profileFullName").value.trim();
            const phone =
                document.getElementById("profilePhone").value.replace(/\D/g, "");

            if (!fullName) {
                profileMessage.textContent = "Enter your full name.";
                return;
            }

            if (!/^09\d{9}$/.test(phone)) {
                profileMessage.textContent =
                    "Enter an 11-digit Philippine mobile number starting with 09.";
                return;
            }

            const saveButton =
                document.getElementById("saveProfileButton");

            saveButton.disabled = true;
            profileMessage.textContent = "Saving your profile...";

            try {
                const body = {
                    full_name: fullName,
                    phone: phone,
                    current_password:
                        document.getElementById("profileCurrentPassword").value
                };

                if (selectedProfilePhotoData) {
                    body.profile_name =
                        selectedProfilePhotoData;
                }

                const response =
                    await fetch(
                        window.anchorApiUrl(
                            `/api/customer/${customerData.id}/profile`
                        ),
                        {
                            method: "PUT",
                            headers: {
                                "Content-Type": "application/json"
                            },
                            body: JSON.stringify(body)
                        }
                    );

                const data =
                    await response.json();

                if (!response.ok || !data.success) {
                    throw new Error(
                        data.message || "Unable to save profile changes."
                    );
                }

                customerData = {
                    ...customerData,
                    ...data.user
                };

                window.anchorSession.set(
                    "anchorUser",
                    JSON.stringify(customerData),
                    Boolean(window.localStorage.getItem("anchorUser"))
                );

                selectedProfilePhotoData = null;
                photoInput.value = "";
                setProfileEditMode(false);
                displayCustomer(customerData);
                profileMessage.textContent = "Profile updated.";
            } catch (error) {
                console.error("Profile update error:", error);
                profileMessage.textContent = error.message;
            } finally {
                saveButton.disabled = false;
            }
        }
    );
}

function setProfilePasswordVisibility(inputId, visible) {
    const input =
        document.getElementById(inputId);
    const toggle =
        document.querySelector(
            `[data-password-target="${inputId}"]`
        );

    if (!input || !toggle) {
        return;
    }

    toggle.disabled = input.disabled;
    input.type = visible ? "text" : "password";
    toggle.textContent = visible ? "Hide" : "Show";
    const passwordName = {
        profileCurrentPassword: "current password",
        changePasswordCurrent: "current password",
        changePasswordNew: "new password",
        changePasswordConfirm: "password confirmation"
    }[inputId] || "password";
    toggle.setAttribute(
        "aria-label",
        `${visible ? "Hide" : "Show"} ${passwordName}`
    );
    toggle.setAttribute(
        "aria-pressed",
        String(visible)
    );
}

function initializePasswordVisibilityToggles() {
    document
        .querySelectorAll("[data-password-target]")
        .forEach(toggle => {
            toggle.addEventListener(
                "click",
                function() {
                    const inputId =
                        toggle.dataset.passwordTarget;
                    const input =
                        document.getElementById(inputId);

                    if (input) {
                        setProfilePasswordVisibility(
                            inputId,
                            input.type === "password"
                        );
                    }
                }
            );
        });
}

function initializeChangePasswordForm() {
    const form =
        document.getElementById("changePasswordForm");
    const message =
        document.getElementById("changePasswordMessage");
    const submitButton =
        document.getElementById("changePasswordButton");
    const newPasswordInput =
        document.getElementById("changePasswordNew");
    const passwordStrength =
        document.getElementById("changePasswordStrength");
    const passwordStrengthLabel =
        document.getElementById("changePasswordStrengthLabel");
    const passwordStrengthMeter =
        passwordStrength.querySelector('[role="meter"]');

    const updatePasswordStrength = function() {
        const strength =
            window.anchorPasswordStrength(newPasswordInput.value);

        passwordStrength.dataset.strength = strength.state;
        passwordStrengthLabel.textContent = strength.label;
        passwordStrengthMeter.setAttribute(
            "aria-valuenow",
            String(strength.score)
        );
        passwordStrengthMeter.setAttribute(
            "aria-valuetext",
            strength.label
        );
        passwordStrengthMeter.firstElementChild.style.width =
            `${strength.score * 25}%`;
    };

    newPasswordInput.addEventListener(
        "input",
        updatePasswordStrength
    );
    updatePasswordStrength();

    form.addEventListener(
        "submit",
        async function(event) {
            event.preventDefault();

            const currentPassword =
                document.getElementById("changePasswordCurrent").value;
            const newPassword =
                document.getElementById("changePasswordNew").value;
            const confirmPassword =
                document.getElementById("changePasswordConfirm").value;

            if (newPassword.length < 6) {
                message.textContent =
                    "New password must be at least 6 characters.";
                return;
            }

            if (newPassword !== confirmPassword) {
                message.textContent =
                    "The new passwords do not match.";
                return;
            }

            submitButton.disabled = true;
            message.textContent = "Changing your password...";

            try {
                const response =
                    await fetch(
                        window.anchorApiUrl(
                            `/api/customer/${customerData.id}/password`
                        ),
                        {
                            method: "PUT",
                            headers: {
                                "Content-Type": "application/json"
                            },
                            body: JSON.stringify({
                                current_password: currentPassword,
                                new_password: newPassword
                            })
                        }
                    );

                const data =
                    await response.json();

                if (!response.ok || !data.success) {
                    throw new Error(
                        data.message || "Unable to change your password."
                    );
                }

                form.reset();
                form.querySelectorAll("[data-password-target]").forEach(
                    toggle => {
                        setProfilePasswordVisibility(
                            toggle.dataset.passwordTarget,
                            false
                        );
                    }
                );
                message.textContent = "Password changed successfully.";
            } catch (error) {
                console.error("Password change error:", error);
                message.textContent = error.message;
            } finally {
                submitButton.disabled = false;
            }
        }
    );
}

initializeProfileEditor();
initializePasswordVisibilityToggles();
initializeChangePasswordForm();


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
    const isActive =
        status === "ACTIVE" &&
        (!expirationDate || daysRemaining >= 0);

    setMembershipActiveStyle(isActive);


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

    setMembershipActiveStyle(false);

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


function setMembershipActiveStyle(active) {
    [
        "dashboardMembershipStatus",
        "dashboardPlan",
        "dashboardDaysRemaining",
        "dashboardMemberId",
        "membershipPageStatus",
        "membershipPageTitle",
        "membershipMemberId",
        "membershipPlan",
        "membershipDaysRemaining"
    ].forEach(id => {
        document
            .getElementById(id)
            ?.classList.toggle("membership-active-value", active);
    });
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

        case "REVOKED":
            return "Membership Revoked";

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

        case "REVOKED":
            return "Your membership has been revoked. Please contact the gym for assistance.";

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

    const topbarNotificationCount =
        document.getElementById(
            "topbarNotificationCount"
        );

    if (topbarNotificationCount) {
        topbarNotificationCount.textContent =
            unreadCount > 99
                ? "99+"
                : String(unreadCount);
        topbarNotificationCount.hidden =
            unreadCount === 0;
    }


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
// LOAD ATTENDANCE REPORT
// =====================================

function getAttendanceReportDateRange(period) {
    const [year, month, day] =
        getCurrentManilaDate()
            .split("-")
            .map(Number);
    const today =
        new Date(Date.UTC(year, month - 1, day));
    let start =
        new Date(today);
    let end =
        new Date(today);

    if (period === "weekly") {
        const daysSinceMonday =
            (today.getUTCDay() + 6) % 7;
        start.setUTCDate(today.getUTCDate() - daysSinceMonday);
        end.setUTCDate(start.getUTCDate() + 6);
    } else if (period === "monthly") {
        start =
            new Date(Date.UTC(year, month - 1, 1));
        end =
            new Date(Date.UTC(year, month, 0));
    }

    return {
        startDate: start.toISOString().slice(0, 10),
        endDate: end.toISOString().slice(0, 10)
    };
}


function formatAttendanceChartDate(date) {
    return new Intl.DateTimeFormat(
        "en-US",
        {
            timeZone: "UTC",
            month: "2-digit",
            day: "2-digit"
        }
    ).format(date);
}


function attendanceDateKey(date) {
    return date.toISOString().slice(0, 10);
}


function getAttendanceDateKey(dateValue) {
    const date =
        new Date(dateValue);

    if (Number.isNaN(date.getTime())) {
        return "";
    }

    const parts =
        new Intl.DateTimeFormat(
            "en-US",
            {
                timeZone: "Asia/Manila",
                year: "numeric",
                month: "2-digit",
                day: "2-digit"
            }
        ).formatToParts(date);
    const values =
        Object.fromEntries(
            parts.map(part => [part.type, part.value])
        );

    return `${values.year}-${values.month}-${values.day}`;
}


function getAttendanceChartSeries(visits, period, startDate, endDate) {
    const counts = new Map();

    if (period === "daily") {
        for (let hour = 0; hour < 24; hour += 1) {
            counts.set(hour, 0);
        }

        visits.forEach(visit => {
            const date =
                new Date(visit.check_in);

            if (!Number.isNaN(date.getTime())) {
                const hour =
                    Number(new Intl.DateTimeFormat(
                        "en-US",
                        {
                            timeZone: "Asia/Manila",
                            hour: "numeric",
                            hourCycle: "h23"
                        }
                    ).format(date));
                counts.set(hour, (counts.get(hour) || 0) + 1);
            }
        });

        return Array.from(counts, ([hour, total]) => ({
            label: new Intl.DateTimeFormat(
                "en-US",
                {
                    timeZone: "UTC",
                    hour: "numeric"
                }
            ).format(new Date(Date.UTC(2020, 0, 1, hour))),
            visits: total
        }));
    }

    let start =
        new Date(`${startDate}T00:00:00.000Z`);
    const end =
        new Date(`${endDate}T00:00:00.000Z`);

    if (period === "monthly") {
        start.setUTCDate(
            start.getUTCDate() -
            ((start.getUTCDay() + 6) % 7)
        );

        for (
            let date = new Date(start);
            date <= end;
            date.setUTCDate(date.getUTCDate() + 7)
        ) {
            const key =
                attendanceDateKey(date);
            counts.set(key, 0);
        }
    } else {
        for (
            let date = new Date(start);
            date <= end;
            date.setUTCDate(date.getUTCDate() + 1)
        ) {
            counts.set(attendanceDateKey(date), 0);
        }
    }

    visits.forEach(visit => {
        const dateKey =
            getAttendanceDateKey(visit.check_in);

        if (!dateKey) {
            return;
        }

        let bucketKey = dateKey;
        if (period === "monthly") {
            const date =
                new Date(`${dateKey}T00:00:00.000Z`);
            date.setUTCDate(
                date.getUTCDate() -
                ((date.getUTCDay() + 6) % 7)
            );
            bucketKey =
                attendanceDateKey(date);
        }

        if (counts.has(bucketKey)) {
            counts.set(bucketKey, counts.get(bucketKey) + 1);
        }
    });

    return Array.from(counts, ([dateKey, total]) => {
        const date =
            new Date(`${dateKey}T00:00:00.000Z`);
        const monthDay =
            formatAttendanceChartDate(date);
        const label =
            period === "weekly"
                ? `${new Intl.DateTimeFormat("en-US", {
                    timeZone: "UTC",
                    weekday: "short"
                }).format(date)} ${monthDay}`
                : monthDay;

        return {
            label,
            visits: total
        };
    });
}


function renderAttendanceReportChart(series, period) {
    const chart =
        document.getElementById("attendanceReportBars");
    const yAxis =
        document.getElementById("attendanceReportYAxis");
    const description =
        document.getElementById("attendanceReportChartDescription");
    const title = {
        daily: "Visits by Hour",
        weekly: "Visits by Day",
        monthly: "Visits by Week",
        custom: "Visits by Date"
    }[period];
    const periodDescription = {
        daily: "hourly visits today",
        weekly: "visits by day this week",
        monthly: "visits by week this month",
        custom: "visits by date in the selected range"
    }[period];

    if (!chart || !yAxis) {
        return;
    }

    setText("attendanceReportChartTitle", title);

    if (
        series.length === 0 ||
        series.every(item => item.visits === 0)
    ) {
        yAxis.innerHTML = "<span>0</span>";
        chart.innerHTML =
            '<div class="attendance-report-chart-empty">No attendance data for this period.</div>';
        chart.setAttribute(
            "aria-label",
            `${title} chart showing ${periodDescription}; no attendance data`
        );

        if (description) {
            description.textContent =
                `${title} chart showing ${periodDescription}. No attendance data.`;
        }

        return;
    }

    const max =
        Math.max(1, ...series.map(item => item.visits));
    const rawStep =
        max / 4;
    const magnitude =
        10 ** Math.floor(Math.log10(rawStep));
    const fraction =
        rawStep / magnitude;
    const stepFactor =
        fraction <= 1 ? 1 :
            fraction <= 2 ? 2 :
                fraction <= 5 ? 5 : 10;
    const step =
        stepFactor * magnitude;
    const axisMaximum =
        Math.ceil(max / step) * step;
    const ticks = [];

    for (
        let value = axisMaximum;
        value >= 0;
        value -= step
    ) {
        ticks.push(Number(value.toFixed(6)));
    }

    yAxis.innerHTML =
        ticks.map(value => `<span>${value}</span>`).join("");
    chart.innerHTML =
        series.map(item => `
            <div
                class="attendance-report-bar"
                role="listitem"
                aria-label="${escapeHtml(`${item.label}: ${item.visits} visits`)}"
                style="--bar-height:${item.visits === 0 ? 0 : item.visits / axisMaximum * 100}%">
                <span class="attendance-report-bar-value">${item.visits}</span>
                <span class="attendance-report-bar-label">${escapeHtml(item.label)}</span>
            </div>
        `).join("");
    chart.setAttribute(
        "aria-label",
        `${title} chart showing ${periodDescription}`
    );

    if (description) {
        description.textContent =
            `${title} chart showing ${periodDescription}. ` +
            series.map(item => `${item.label}: ${item.visits} visits`).join("; ");
    }
}


async function loadAttendanceReport(period = attendanceReportPeriod) {

    const tableBody =
        document.getElementById(
            "attendanceReportBody"
        );

    const status =
        document.getElementById(
            "attendanceReportStatus"
        );

    if (
        !customerData ||
        !customerData.id ||
        !tableBody ||
        !status
    ) {

        return;

    }

    if (!["daily", "weekly", "monthly", "custom"].includes(period)) {

        return;

    }

    attendanceReportPeriod = period;
    const requestedPeriod = period;
    const requestId =
        ++attendanceReportRequestId;
    const startDateInput =
        document.getElementById("attendanceReportStartDate");
    const endDateInput =
        document.getElementById("attendanceReportEndDate");

    if (period !== "custom") {
        const dateRange =
            getAttendanceReportDateRange(period);

        if (startDateInput) {
            startDateInput.value = dateRange.startDate;
        }

        if (endDateInput) {
            endDateInput.value = dateRange.endDate;
        }
    }

    const startDate =
        startDateInput?.value || "";
    const endDate =
        endDateInput?.value || "";

    ["daily", "weekly", "monthly", "custom"].forEach(reportPeriod => {

        const button =
            document.getElementById(
                `attendanceReport${reportPeriod.charAt(0).toUpperCase()}${reportPeriod.slice(1)}`
            );

        if (button) {

            const isActive =
                reportPeriod === attendanceReportPeriod;

            button.classList.toggle(
                "active",
                isActive
            );

            button.setAttribute(
                "aria-pressed",
                String(isActive)
            );

        }

    });

    if (
        requestedPeriod === "custom" &&
        (!startDate || !endDate || startDate > endDate)
    ) {
        status.textContent =
            "Choose a valid start and end date, then apply the custom range.";
        tableBody.innerHTML = `
            <tr>
                <td colspan="4" style="text-align:center;">
                    Choose a valid start and end date.
                </td>
            </tr>
        `;
        setText("attendanceReportVisits", "0");
        setText("attendanceReportCompleted", "0");
        setText("attendanceReportActive", "0");
        renderAttendanceReportChart([], requestedPeriod);
        return;
    }

    status.textContent =
        "Loading your attendance history...";

    tableBody.innerHTML = `
        <tr>
            <td colspan="4" style="text-align:center;">
                Loading your attendance history...
            </td>
        </tr>
    `;

    try {

        const query =
            new URLSearchParams({
                period: requestedPeriod
            });

        if (requestedPeriod === "custom") {
            query.set("startDate", startDate);
            query.set("endDate", endDate);
        }

        const response =
            await fetch(
                window.anchorApiUrl(
                    `/api/customer/${customerData.id}/attendance?${query.toString()}`
                ),
                {
                    cache: "no-store",
                    headers: getCustomerAuthorizationHeaders()
                }
            );

        const data =
            await response.json();

        if (requestId !== attendanceReportRequestId) {

            return;

        }

        if (
            !response.ok ||
            !data.success ||
            !Array.isArray(data.attendance)
        ) {

            throw new Error(
                data.message ||
                "Unable to load your attendance history."
            );

        }

        const visits =
            data.attendance;

        const periodLabel =
            requestedPeriod.charAt(0).toUpperCase() +
            requestedPeriod.slice(1);
        const chartDateRange =
            requestedPeriod === "custom"
                ? { startDate, endDate }
                : getAttendanceReportDateRange(requestedPeriod);
        const chartSeries =
            getAttendanceChartSeries(
                visits,
                requestedPeriod,
                chartDateRange.startDate,
                chartDateRange.endDate
            );

        renderAttendanceReportChart(
            chartSeries,
            requestedPeriod
        );

        const completedVisits =
            visits.filter(
                visit => Boolean(visit.check_out)
            ).length;

        const activeVisits =
            visits.length -
            completedVisits;

        setText(
            "attendanceReportVisits",
            String(visits.length)
        );

        setText(
            "attendanceReportCompleted",
            String(completedVisits)
        );

        setText(
            "attendanceReportActive",
            String(activeVisits)
        );

        if (visits.length === 0) {

            tableBody.innerHTML = `
                <tr>
                    <td colspan="4" style="text-align:center;">
                        No attendance records yet.
                    </td>
                </tr>
            `;

            status.textContent =
                `0 visit(s) in the selected period.`;

            return;

        }

        tableBody.innerHTML =
            visits
                .map(
                    visit => `
                        <tr>
                            <td>${escapeHtml(formatAttendanceDate(visit.check_in))}</td>
                            <td>${escapeHtml(formatAttendanceTime(visit.check_in))}</td>
                            <td>
                                ${
                                    visit.check_out
                                        ? escapeHtml(formatAttendanceTime(visit.check_out))
                                        : '<span class="attendance-report-open">Still checked in</span>'
                                }
                            </td>
                            <td>${escapeHtml(formatAttendanceDuration(visit.duration_minutes))}</td>
                        </tr>
                    `
                )
                .join("");

        status.textContent =
            `${visits.length} visit(s) in the selected ${periodLabel.toLowerCase()} period.`;

    } catch (error) {

        if (requestId !== attendanceReportRequestId) {

            return;

        }

        console.error(
            "Attendance report loading error:",
            error
        );

        renderAttendanceReportChart([], requestedPeriod);
        setText("attendanceReportVisits", "0");
        setText("attendanceReportCompleted", "0");
        setText("attendanceReportActive", "0");

        tableBody.innerHTML = `
            <tr>
                <td colspan="4" style="text-align:center;">
                    Unable to load your attendance history.
                </td>
            </tr>
        `;

        status.textContent =
            error.message ||
            "Unable to load your attendance history.";

    }

}


function formatAttendanceDate(dateValue) {

    if (!dateValue) {

        return "—";

    }

    const date =
        new Date(dateValue);

    if (Number.isNaN(date.getTime())) {

        return "—";

    }

    return new Intl.DateTimeFormat(
        "en-US",
        {
            timeZone: "Asia/Manila",
            month: "short",
            day: "numeric",
            year: "numeric"
        }
    ).format(date);

}


function formatAttendanceTime(dateValue) {

    if (!dateValue) {

        return "—";

    }

    const date =
        new Date(dateValue);

    if (Number.isNaN(date.getTime())) {

        return "—";

    }

    return new Intl.DateTimeFormat(
        "en-US",
        {
            timeZone: "Asia/Manila",
            hour: "numeric",
            minute: "2-digit"
        }
    ).format(date);

}


function formatAttendanceDuration(durationMinutes) {

    const minutes =
        Number(durationMinutes);

    if (!Number.isFinite(minutes) || minutes < 0) {

        return "—";

    }

    const hours =
        Math.floor(minutes / 60);

    const remainingMinutes =
        Math.floor(minutes % 60);

    if (hours === 0) {

        return `${remainingMinutes} min`;

    }

    return remainingMinutes === 0
        ? `${hours} hr`
        : `${hours} hr ${remainingMinutes} min`;

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
                ${formatTableCurrency(transaction.amount)}
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
                    class="status ${getStatusClass(status)}">

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
                ${formatTableCurrency(transaction.amount)}
            </td>


            <td>

                <span
                    class="status ${getStatusClass(status)}">

                    ${escapeHtml(status)}

                </span>

            </td>

        </tr>

    `;

}


// =====================================
// DISPLAY QR
// =====================================

function getCustomerAuthorizationHeaders() {

    const token =
        window.anchorSession.get(
            "anchorCustomerToken"
        );

    return token
        ? {
            Authorization: `Bearer ${token}`
        }
        : {};

}


function clearRotatingQrTimers() {

    if (rotatingQrTimeout) {

        clearTimeout(rotatingQrTimeout);
        rotatingQrTimeout = null;

    }

    if (rotatingQrCountdown) {

        clearInterval(rotatingQrCountdown);
        rotatingQrCountdown = null;

    }

}


async function loadRotatingQr(memberId) {

    if (rotatingQrLoading) {

        return;

    }

    if (
        !customerData ||
        !customerData.id ||
        !window.anchorSession.get("anchorCustomerToken")
    ) {

        displayNoQR(
            "Please sign in again to load your rotating QR code."
        );

        return;

    }

    rotatingQrLoading = true;

    const container =
        document.getElementById(
            "qrCodeContainer"
        );

    const status =
        document.getElementById(
            "qrStatus"
        );

    const description =
        document.getElementById(
            "qrDescription"
        );

    if (status) {

        status.textContent =
            "● REFRESHING";

    }

    const requestStartedAt =
        Date.now();

    try {

        const response =
            await fetch(
                window.anchorApiUrl(
                    "/api/customer/attendance-qr"
                ),
                {
                    cache: "no-store",
                    headers: getCustomerAuthorizationHeaders()
                }
            );

        const data =
            await response.json();

        if (
            !response.ok ||
            !data.success ||
            !data.qr_image ||
            !data.expires_at ||
            !Number.isFinite(Number(data.expires_in)) ||
            Number(data.expires_in) <= 0
        ) {

            throw new Error(
                data.message ||
                "Unable to generate your rotating QR code."
            );

        }

        if (Number(memberId) !== Number(rotatingQrMemberId)) {

            rotatingQrLoading = false;
            return;

        }

        const expiresAt =
            new Date(data.expires_at).getTime();

        const localExpiry =
            requestStartedAt +
            Number(data.expires_in) * 1000;

        if (
            Number.isNaN(expiresAt) ||
            localExpiry <= Date.now()
        ) {

            throw new Error(
                "The QR code expired before it could be displayed. Please try again."
            );

        }

        rotatingQrExpiry = localExpiry;
        rotatingQrLoading = false;

        if (container) {

            container.innerHTML = `
                <img
                    src="${escapeAttribute(data.qr_image)}"
                    alt="Rotating ANCHOR Gym member QR code"
                    style="
                        width:220px;
                        max-width:100%;
                        height:auto;
                        display:block;
                        margin:0 auto;
                    "
                >
            `;

        }

        if (status) {

            status.textContent =
                "● ACTIVE - ROTATING";

        }

        if (description) {

            description.textContent =
                "Show this code to staff. It refreshes every 30 seconds and can only be scanned once.";

        }

        clearRotatingQrTimers();

        const countdown =
            document.getElementById(
                "qrRefreshCountdown"
            );

        const updateCountdown = function() {

            const secondsRemaining =
                Math.max(
                    0,
                    Math.ceil(
                        (rotatingQrExpiry - Date.now()) / 1000
                    )
                );

            if (countdown) {

                countdown.textContent =
                    secondsRemaining > 0
                        ? `Refreshes in ${secondsRemaining} seconds.`
                        : "Refreshing QR code...";

            }

        };

        updateCountdown();

        rotatingQrCountdown =
            setInterval(
                updateCountdown,
                1000
            );

        rotatingQrTimeout =
            setTimeout(
                function() {
                    loadRotatingQr(memberId);
                },
                Math.max(
                    0,
                    expiresAt - Date.now()
                )
            );

    } catch (error) {

        rotatingQrLoading = false;

        console.error(
            "Rotating member QR loading error:",
            error
        );

        if (status) {

            status.textContent =
                "● QR UNAVAILABLE";

        }

        if (description) {

            description.textContent =
                error.message ||
                "Unable to generate your rotating QR code.";

        }

        const countdown =
            document.getElementById(
                "qrRefreshCountdown"
            );

        if (countdown) {

            countdown.textContent =
                "Trying again in 5 seconds...";

        }

        clearRotatingQrTimers();

        rotatingQrTimeout =
            setTimeout(
                function() {
                    loadRotatingQr(memberId);
                },
                5000
            );

    }

}


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

    const memberId =
        Number(membership.id);

    if (!Number.isSafeInteger(memberId) || memberId <= 0) {

        displayNoQR();

        return;

    }

    if (rotatingQrMemberId !== memberId) {

        clearRotatingQrTimers();
        rotatingQrExpiry = 0;
        rotatingQrMemberId = memberId;

    }

    if (qrStatus) {

        qrStatus.textContent =
            "● ACTIVE - ROTATING";

    }

    if (qrTitle) {

        qrTitle.textContent =
            "Your ANCHOR QR Code";

    }

    if (
        qrContainer &&
        rotatingQrExpiry <= Date.now()
    ) {

        qrContainer.textContent =
            "Generating secure QR code...";

    }

    if (rotatingQrExpiry <= Date.now() && !rotatingQrTimeout) {

        loadRotatingQr(memberId);

    }

}


// =====================================
// NO QR
// =====================================

function displayNoQR(message) {

    clearRotatingQrTimers();
    rotatingQrExpiry = 0;
    rotatingQrMemberId = null;

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
            message ||
            "Your QR code will be generated after your membership application is approved.";

    }

    const countdown =
        document.getElementById(
            "qrRefreshCountdown"
        );

    if (countdown) {

        countdown.textContent = "";

    }

}


// =====================================
// SUBMIT APPLICATION
// =====================================

async function submitApplication() {

    const savedUser =
        window.anchorSession.get(
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


        window.anchorSession.remove(
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
    const today =
        getCurrentManilaDate();

    paymentDateInput.max = today;


    // ---------------------------------
    // VALIDATION
    // ---------------------------------

    if (!reference) {

        alert(
            "Please enter your GCash reference number."
        );

        return;

    }

    if (reference.length < 10 || reference.length > 13) {
        alert(
            "GCash reference number must be between 10 and 13 characters."
        );
        return;
    }


    if (!paymentDate) {

        alert(
            "Please select the payment date."
        );

        return;

    }

    if (paymentDate > today) {
        alert(
            "Payment date cannot be in the future."
        );
        paymentDateInput.value = today;
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
                    getCurrentManilaDate();


                screenshotInput.value =
                    "";

                clearPaymentScreenshotPreview();


                // ---------------------------------
                // REFRESH DATA
                // ---------------------------------

                await refreshCustomerData(
                    false
                );


                // ---------------------------------
                // GO TO APPLICATION STATUS
                // ---------------------------------

                showPageById(
                    "dashboard",
                    false
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

const paymentScreenshotInput =
    document.getElementById("paymentScreenshot");

const paymentScreenshotPreview =
    document.getElementById("paymentScreenshotPreview");

let paymentScreenshotPreviewUrl = null;

function clearPaymentScreenshotPreview() {
    if (paymentScreenshotPreviewUrl) {
        URL.revokeObjectURL(paymentScreenshotPreviewUrl);
        paymentScreenshotPreviewUrl = null;
    }

    if (paymentScreenshotPreview) {
        paymentScreenshotPreview.removeAttribute("src");
        paymentScreenshotPreview.hidden = true;
    }
}

if (
    paymentScreenshotInput &&
    paymentScreenshotPreview
) {
    paymentScreenshotInput.addEventListener(
        "change",
        function() {
            clearPaymentScreenshotPreview();

            const file =
                paymentScreenshotInput.files &&
                paymentScreenshotInput.files[0];

            if (!file) {
                return;
            }

            paymentScreenshotPreviewUrl =
                URL.createObjectURL(file);

            paymentScreenshotPreview.src =
                paymentScreenshotPreviewUrl;
            paymentScreenshotPreview.hidden = false;
        }
    );
}


async function logout() {

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

    clearRotatingQrTimers();

    const customerToken =
        window.anchorSession.get(
            "anchorCustomerToken"
        );

    if (customerToken) {

        try {

            const response =
                await fetch(
                    window.anchorApiUrl(
                        "/api/customer/logout"
                    ),
                    {
                        method: "POST",
                        headers: {
                            Authorization: `Bearer ${customerToken}`
                        }
                    }
                );

            if (!response.ok) {

                throw new Error(
                    "Unable to end the customer session."
                );

            }

        } catch (error) {

            console.error(
                "Customer logout error:",
                error
            );

        }

    }

    window.anchorSession.remove(
        "anchorUser"
    );

    window.anchorSession.remove(
        "anchorCustomerToken"
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

function formatTableCurrency(value) {
    if (
        (typeof value !== "number" && typeof value !== "string") ||
        (typeof value === "string" && value.trim() === "")
    ) {
        return "—";
    }

    const amount = Number(value);
    return Number.isFinite(amount)
        ? `₱${amount.toLocaleString()}`
        : "—";
}

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

    if (normalized === "revoked") {
        return "revoked";
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

        updatePaymentDatePicker();
        setInterval(
            updatePaymentDatePicker,
            60 * 1000
        );
        window.addEventListener(
            "focus",
            updatePaymentDatePicker
        );

        loadCustomer();

    }
);