/* =========================
   CUSTOMER LOGIN
========================= */

const rememberedCustomerEmailKey =
    "anchorRememberedCustomerEmail";

const customerEmailInput =
    document.getElementById("email");

const customerRememberMe =
    document.getElementById("rememberMe");

if (
    customerEmailInput &&
    customerRememberMe
) {
    const rememberedCustomerEmail =
        window.localStorage.getItem(
            rememberedCustomerEmailKey
        );

    if (rememberedCustomerEmail) {
        customerEmailInput.value =
            rememberedCustomerEmail;
        customerRememberMe.checked = true;
    }

    customerRememberMe.addEventListener(
        "change",
        function() {
            if (!customerRememberMe.checked) {
                window.localStorage.removeItem(
                    rememberedCustomerEmailKey
                );
            }
        }
    );
}

function saveRememberedCustomerEmail(email, remember) {
    if (remember) {
        window.localStorage.setItem(
            rememberedCustomerEmailKey,
            email
        );
        return;
    }

    window.localStorage.removeItem(
        rememberedCustomerEmailKey
    );
}

const loginForm =
    document.getElementById("loginForm");

if (loginForm) {

    loginForm.addEventListener(
        "submit",
        async function(event) {

            event.preventDefault();

            const email =
                document
                    .getElementById("email")
                    .value
                    .trim();

            const password =
                document
                    .getElementById("password")
                    .value;

            const rememberMe =
                document.getElementById("rememberMe");

            if (!email || !password) {

                alert(
                    "Please enter your email and password."
                );

                return;
            }


            try {

                const response =
                    await fetch(window.anchorApiUrl("/api/login"), {

                        method: "POST",

                        headers: {
                            "Content-Type":
                                "application/json"
                        },

                        body: JSON.stringify({
                            email: email,
                            password: password,
                            remember_me: Boolean(
                                rememberMe &&
                                rememberMe.checked
                            )
                        })

                    });


                const data =
                    await response.json();


                if (!response.ok) {

                    alert(
                        data.message ||
                        "Invalid email or password."
                    );

                    return;
                }

                if (!data.token) {

                    throw new Error(
                        "Login succeeded without a customer session. Please try again."
                    );

                }

                window.anchorSession.set(
                    "anchorCustomerToken",
                    data.token,
                    Boolean(
                        rememberMe &&
                        rememberMe.checked
                    )
                );

                window.anchorSession.set(
                    "anchorUser",
                    JSON.stringify(data.user),
                    Boolean(
                        rememberMe &&
                        rememberMe.checked
                    )
                );

                saveRememberedCustomerEmail(
                    email,
                    Boolean(rememberMe && rememberMe.checked)
                );

                window.location.href =
                    "customer.html";


            } catch (error) {

                console.error(
                    "Login error:",
                    error
                );

                alert(
                    "Unable to connect to the server."
                );

            }

        }
    );

}


/* =========================
   GOOGLE LOGIN
========================= */

const googleLogin =
    document.getElementById("googleLogin");

const googleLoginMessage =
    document.getElementById("googleLoginMessage");

const googlePhoneForm =
    document.getElementById("googlePhoneForm");

let pendingGoogleCredential = null;

function setGoogleLoginMessage(message) {
    if (googleLoginMessage) {
        googleLoginMessage.textContent = message;
    }
}

async function submitGoogleCredential(
    credential,
    phone
) {
    const response =
        await fetch(
            window.anchorApiUrl("/api/auth/google"),
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    id_token: credential,
                    phone: phone,
                    remember_me: Boolean(
                        document.getElementById("rememberMe")?.checked
                    )
                })
            }
        );

    const data =
        await response.json();

    if (!response.ok) {
        throw new Error(
            data.message ||
            "Unable to sign in with Google."
        );
    }

    if (data.requires_phone) {
        pendingGoogleCredential = credential;

        if (googlePhoneForm) {
            googlePhoneForm.hidden = false;
            document.getElementById("googlePhone").focus();
        }

        setGoogleLoginMessage(
            "Your Google account is verified. Add your phone number to finish."
        );

        return;
    }

    if (!data.token) {

        throw new Error(
            "Google sign-in succeeded without a customer session. Please try again."
        );

    }

    window.anchorSession.set(
        "anchorCustomerToken",
        data.token,
        Boolean(
            document.getElementById("rememberMe")?.checked
        )
    );

    window.anchorSession.set(
        "anchorUser",
        JSON.stringify(data.user),
        Boolean(
            document.getElementById("rememberMe")?.checked
        )
    );

    saveRememberedCustomerEmail(
        data.user.email,
        Boolean(
            document.getElementById(
                "rememberMe"
            )?.checked
        )
    );

    window.location.href =
        "customer.html";
}

async function initializeGoogleLogin() {
    if (!googleLogin) {
        return;
    }

    const hostname =
        window.location.hostname.toLowerCase();
    const isVercelPreview =
        hostname.startsWith("anchor-gym-system-") &&
        hostname.endsWith(".vercel.app") &&
        hostname !== "anchor-gym-system.vercel.app";

    if (isVercelPreview) {
        googleLogin.addEventListener(
            "click",
            function() {
                window.location.replace(
                    "https://anchor-gym-system.vercel.app/login.html"
                );
            }
        );
        return;
    }

    try {
        const configResponse =
            await fetch(
                window.anchorApiUrl("/api/auth/config"),
                {
                    cache: "no-store"
                }
            );

        const config =
            await configResponse.json();

        if (
            !configResponse.ok ||
            !config.googleEnabled ||
            !config.googleClientId
        ) {
            throw new Error(
                config.message ||
                "Google sign-in is not configured."
            );
        }

        await new Promise(
            (resolve, reject) => {
                const script =
                    document.createElement("script");

                script.src =
                    "https://accounts.google.com/gsi/client";
                script.async = true;
                script.onload = resolve;
                script.onerror = () => reject(
                    new Error("Google sign-in could not be loaded.")
                );
                document.head.appendChild(script);
            }
        );

        const googleCodeClient =
            window.google.accounts.oauth2.initCodeClient({
                client_id: config.googleClientId,
                scope: "openid email profile",
                ux_mode: "popup",
                callback: async function(result) {
                    if (result.error || !result.code) {
                        setGoogleLoginMessage(
                            result.error_description ||
                            result.error ||
                            "Google sign-in was canceled."
                        );
                        return;
                    }

                    try {
                        const response =
                            await fetch(
                                window.anchorApiUrl(
                                    "/api/auth/google/code"
                                ),
                                {
                                    method: "POST",
                                    headers: {
                                        "Content-Type":
                                            "application/json",
                                        "X-Requested-With":
                                            "XmlHttpRequest"
                                    },
                                    body: JSON.stringify({
                                        code: result.code,
                                        remember_me: Boolean(
                                            document.getElementById(
                                                "rememberMe"
                                            )?.checked
                                        )
                                    })
                                }
                            );

                        const data =
                            await response.json();

                        if (!response.ok) {
                            throw new Error(
                                data.message ||
                                "Unable to sign in with Google."
                            );
                        }

                        if (data.requires_phone) {
                            pendingGoogleCredential =
                                data.id_token;

                            googlePhoneForm.hidden = false;
                            document.getElementById(
                                "googlePhone"
                            ).focus();

                            setGoogleLoginMessage(
                                "Your Google account is verified. Add your phone number to finish."
                            );
                            return;
                        }

                        if (!data.token) {

                            throw new Error(
                                "Google sign-in succeeded without a customer session. Please try again."
                            );

                        }

                        window.anchorSession.set(
                            "anchorCustomerToken",
                            data.token,
                            Boolean(
                                document.getElementById(
                                    "rememberMe"
                                )?.checked
                            )
                        );

                        window.anchorSession.set(
                            "anchorUser",
                            JSON.stringify(data.user),
                            Boolean(
                                document.getElementById(
                                    "rememberMe"
                                )?.checked
                            )
                        );

                        saveRememberedCustomerEmail(
                            data.user.email,
                            Boolean(
                                document.getElementById("rememberMe")?.checked
                            )
                        );

                        window.location.href =
                            "customer.html";
                    } catch (error) {
                        console.error(
                            "Google sign-in error:",
                            error
                        );

                        setGoogleLoginMessage(
                            error.message
                        );
                    }
                }
            });

        googleLogin.addEventListener(
            "click",
            function() {
                setGoogleLoginMessage("");

                try {
                    googleCodeClient.requestCode();
                } catch (error) {
                    console.error(
                        "Google sign-in launch error:",
                        error
                    );

                    setGoogleLoginMessage(
                        error.message
                    );
                }
            }
        );
    } catch (error) {
        googleLogin.hidden = true;

        console.error(
            "Google sign-in initialization error:",
            error
        );

        setGoogleLoginMessage(
            error.message
        );
    }
}

if (googleLogin) {
    initializeGoogleLogin();
}

if (googlePhoneForm) {
    const googlePhoneInput =
        document.getElementById("googlePhone");

    googlePhoneInput.addEventListener(
        "input",
        function() {
            googlePhoneInput.value =
                googlePhoneInput.value
                    .replace(/\D/g, "")
                    .slice(0, 11);
        }
    );

    googlePhoneForm.addEventListener(
        "submit",
        async function(event) {
            event.preventDefault();

            if (!pendingGoogleCredential) {
                setGoogleLoginMessage(
                    "Please choose Continue with Google again."
                );
                googlePhoneForm.hidden = true;
                return;
            }

            try {
                await submitGoogleCredential(
                    pendingGoogleCredential,
                    googlePhoneInput.value
                );
            } catch (error) {
                console.error(
                    "Google account creation error:",
                    error
                );

                setGoogleLoginMessage(
                    error.message
                );
            }
        }
    );
}


/* =========================
   CUSTOMER PASSWORD
========================= */

const toggleLoginPassword =
    document.getElementById(
        "toggleLoginPassword"
    );


if (toggleLoginPassword) {

    toggleLoginPassword.addEventListener(
        "click",
        function() {

            const password =
                document.getElementById(
                    "password"
                );

            const visible =
                password.type === "password";

            password.type =
                visible
                    ? "text"
                    : "password";

            const label =
                visible
                    ? "Hide password"
                    : "Show password";

            this.setAttribute(
                "aria-label",
                label
            );

            this.setAttribute(
                "title",
                label
            );

            this.setAttribute(
                "aria-pressed",
                String(visible)
            );

            document.getElementById(
                "toggleLoginPasswordLabel"
            ).textContent = label;

        }
    );

}


/* =========================
   SIGN UP
========================= */

const signupForm =
    document.getElementById("signupForm");

const signupMessage =
    document.getElementById("signupMessage");

const signupPasswordInput =
    document.getElementById("signupPassword");
const signupPasswordStrength =
    document.getElementById("signupPasswordStrength");

if (signupPasswordInput && signupPasswordStrength) {
    const updateSignupPasswordStrength = function() {
        const strength =
            window.anchorPasswordStrength(signupPasswordInput.value);
        const label =
            document.getElementById("signupPasswordStrengthLabel");
        const meter =
            signupPasswordStrength.querySelector('[role="meter"]');

        signupPasswordStrength.dataset.strength =
            strength.state;
        label.textContent = strength.label;
        meter.setAttribute(
            "aria-valuenow",
            String(strength.score)
        );
        meter.setAttribute(
            "aria-valuetext",
            strength.label
        );
        meter.firstElementChild.style.width =
            `${strength.score * 25}%`;
    };

    signupPasswordInput.addEventListener(
        "input",
        updateSignupPasswordStrength
    );
    updateSignupPasswordStrength();
}

function isValidSignupGmailAddress(value) {
    const match =
        /^([a-z0-9.]+)(?:\+([a-z0-9._-]+))?@gmail\.com$/i.exec(
            value.trim()
        );

    if (!match) {
        return false;
    }

    const username =
        match[1].toLowerCase();

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

const signupEmailInput =
    document.getElementById("signupEmail");

if (signupEmailInput) {
    signupEmailInput.addEventListener(
        "invalid",
        function() {
            if (
                signupEmailInput.value &&
                signupMessage &&
                !isValidSignupGmailAddress(
                    signupEmailInput.value
                )
            ) {
                signupMessage.textContent =
                    "Enter a Gmail address in the format name@gmail.com. We cannot check whether the mailbox exists because verification emails are disabled.";
            }
        }
    );

    signupEmailInput.addEventListener(
        "input",
        function() {
            const validGmail =
                !signupEmailInput.value ||
                isValidSignupGmailAddress(
                    signupEmailInput.value
                );

            signupEmailInput.setCustomValidity(
                validGmail
                    ? ""
                    : "Enter a valid Gmail address, such as name@gmail.com."
            );

            if (signupMessage && validGmail) {
                signupMessage.textContent = "";
            }
        }
    );

    signupEmailInput.addEventListener(
        "blur",
        function() {
            signupEmailInput.value =
                signupEmailInput.value.trim().toLowerCase();
        }
    );
}


if (signupForm) {

    signupForm.addEventListener(
        "submit",
        async function(event) {

            event.preventDefault();


            const firstName =
                document
                    .getElementById("firstName")
                    .value
                    .trim();


            const lastName =
                document
                    .getElementById("lastName")
                    .value
                    .trim();


            const email =
                document
                    .getElementById("signupEmail")
                    .value
                    .trim();


            const phone =
                document
                    .getElementById("signupPhone")
                    .value
                    .replace(/\D/g, "");


            const password =
                document
                    .getElementById("signupPassword")
                    .value;


            const confirmPassword =
                document
                    .getElementById("signupConfirm")
                    .value;


            const terms =
                document
                    .getElementById("terms")
                    .checked;


            // =========================
            // VALIDATION
            // =========================

            if (
                !firstName ||
                !lastName ||
                !email ||
                !phone ||
                !password
            ) {

                alert(
                    "Please complete all required fields."
                );

                return;
            }

            if (!isValidSignupGmailAddress(email)) {

                const message =
                    "Enter a Gmail address in the format name@gmail.com. We cannot check whether the mailbox exists because verification emails are disabled.";

                if (signupMessage) {
                    signupMessage.textContent = message;
                }

                return;
            }


            if (!/^09\d{9}$/.test(phone)) {

                alert(
                    "Please enter a valid 11-digit Philippine mobile number starting with 09."
                );

                return;
            }


            if (!terms) {

                alert(
                    "Please accept the terms and conditions."
                );

                return;
            }


            if (password.length < 6) {

                alert(
                    "Password must be at least 6 characters."
                );

                return;
            }


            if (password !== confirmPassword) {

                alert(
                    "Passwords do not match."
                );

                return;
            }


            // Combine first and last name
            const fullName =
                firstName + " " + lastName;

            const submitButton =
                document.getElementById("signupSubmitButton");
            const controller =
                new AbortController();
            const timeoutId =
                window.setTimeout(
                    function() {
                        controller.abort();
                    },
                    35000
                );

            if (submitButton) {
                submitButton.disabled = true;
                submitButton.textContent = "Creating account...";
            }

            if (signupMessage) {
                signupMessage.textContent =
                    "Creating your account...";
            }

            try {

                const response =
                    await fetch(window.anchorApiUrl("/api/signup"), {

                        method: "POST",
                        signal: controller.signal,

                        headers: {
                            "Content-Type":
                                "application/json"
                        },

                        body: JSON.stringify({

                            full_name: fullName,
                            email: email,
                            phone: phone,
                            password: password

                        })

                    });


                const data =
                    await response.json();


                if (!response.ok) {

                    if (signupMessage) {
                        signupMessage.textContent =
                            data.message ||
                            "Unable to create account.";
                    }

                    alert(
                        data.message ||
                        "Unable to create account."
                    );

                    return;
                }

                if (!data.token) {
                    throw new Error(
                        "Account was created without a customer session. Please sign in."
                    );
                }

                window.anchorSession.set(
                    "anchorCustomerToken",
                    data.token,
                    false
                );

                window.anchorSession.set(
                    "anchorUser",
                    JSON.stringify(data.user),
                    false
                );

                window.location.href =
                    "customer.html";


            } catch (error) {

                console.error(
                    "Signup error:",
                    error
                );

                const message =
                    error.name === "AbortError"
                        ? "Signup took too long. Please try again."
                        : "Unable to connect to the server.";

                if (signupMessage) {
                    signupMessage.textContent = message;
                }

                alert(message);

            } finally {
                window.clearTimeout(timeoutId);

                if (submitButton && !signupForm.hidden) {
                    submitButton.disabled = false;
                    submitButton.textContent =
                        "Create Customer Account";
                }

            }

        }
    );

}

function bindPasswordToggle(
    toggleId,
    passwordId
) {
    const toggle =
        document.getElementById(toggleId);

    const password =
        document.getElementById(passwordId);

    if (!toggle || !password) {
        return;
    }

    toggle.setAttribute(
        "aria-controls",
        passwordId
    );

    toggle.setAttribute(
        "aria-pressed",
        "false"
    );

    toggle.addEventListener(
        "click",
        function() {
            const showPassword =
                password.type === "password";

            password.type =
                showPassword
                    ? "text"
                    : "password";

            const showIcon =
                toggle.querySelector(
                    '[data-password-icon="show"]'
                );
            const hideIcon =
                toggle.querySelector(
                    '[data-password-icon="hide"]'
                );

            if (showIcon && hideIcon) {
                showIcon.hidden = showPassword;
                hideIcon.hidden = !showPassword;
            }

            toggle.setAttribute(
                "aria-label",
                showPassword
                    ? "Hide password"
                    : "Show password"
            );

            toggle.setAttribute(
                "aria-pressed",
                String(showPassword)
            );
        }
    );
}

bindPasswordToggle(
    "toggleSignupPassword",
    "signupPassword"
);

bindPasswordToggle(
    "toggleSignupConfirm",
    "signupConfirm"
);


/* =========================
   FORGOT PASSWORD
========================= */

const forgotForm =
    document.getElementById("forgotForm");
const forgotMessage =
    document.getElementById("forgotMessage");

if (forgotForm) {
    forgotForm.addEventListener(
        "submit",
        async function(event) {
            event.preventDefault();

            const email =
                document.getElementById("forgotEmail").value.trim();
            const submitButton =
                forgotForm.querySelector('button[type="submit"]');

            forgotMessage.textContent = "";
            forgotMessage.dataset.state = "";
            forgotMessage.textContent =
                "Sending verification code. Please wait...";
            submitButton.disabled = true;

            const abortController =
                new AbortController();
            const requestTimeout =
                window.setTimeout(
                    function() {
                        abortController.abort();
                    },
                    45000
                );

            try {
                const response = await fetch(
                    window.anchorApiUrl("/api/auth/forgot-password"),
                    {
                        method: "POST",
                        signal: abortController.signal,
                        headers: {
                            "Content-Type": "application/json"
                        },
                        body: JSON.stringify({ email })
                    }
                );
                const data = await response.json();

                if (!response.ok) {
                    throw new Error(
                        data.message || "Unable to send a password reset email."
                    );
                }

                window.sessionStorage.setItem(
                    "anchorPasswordResetEmail",
                    email
                );
                window.location.href = "reset-password.html";
            } catch (error) {
                console.error("Forgot password request error:", error);
                forgotMessage.textContent =
                    error.name === "AbortError"
                        ? "The request took too long. Please try again."
                        : error.message ||
                          "Unable to send a password reset email.";
                forgotMessage.dataset.state = "error";
            } finally {
                window.clearTimeout(requestTimeout);
                submitButton.disabled = false;
            }
        }
    );
}

const verifyResetCodeForm =
    document.getElementById("verifyResetCodeForm");
const resetPasswordForm =
    document.getElementById("resetPasswordForm");

if (verifyResetCodeForm && resetPasswordForm) {
    const resetMessage =
        document.getElementById("resetPasswordMessage");
    const resetPasswordInput =
        document.getElementById("resetPassword");
    const resetPasswordConfirm =
        document.getElementById("resetPasswordConfirm");
    const resetRecipient =
        document.getElementById("resetRecipient");
    const resetCodeInputs =
        Array.from(
            document.querySelectorAll("#resetCodeInputs input")
        );
    const resendResetCodeButton =
        document.getElementById("resendResetCode");
    const requestNewResetCode =
        document.getElementById("requestNewResetCode");
    const resetEmail =
        window.sessionStorage.getItem("anchorPasswordResetEmail") || "";
    let resetToken = "";

    if (!resetEmail) {
        verifyResetCodeForm.hidden = true;
        resetMessage.textContent =
            "Request a verification code first, then enter it here.";
        resetMessage.dataset.state = "error";
        requestNewResetCode.hidden = false;
    } else {
        resetRecipient.textContent = resetEmail;
        resetCodeInputs[0].focus();
    }

    const clearCodeInputs = function() {
        resetCodeInputs.forEach(function(input) {
            input.value = "";
        });
        resetCodeInputs[0].focus();
    };

    const fillCodeInputs = function(startIndex, digits) {
        const codeDigits = digits.replace(/\D/g, "").slice(0, 4 - startIndex);

        for (let offset = 0; offset < codeDigits.length; offset += 1) {
            resetCodeInputs[startIndex + offset].value = codeDigits[offset];
        }

        const nextInput =
            resetCodeInputs[Math.min(startIndex + codeDigits.length, 3)];
        nextInput.focus();
    };

    resetCodeInputs.forEach(function(input, index) {
        input.addEventListener("input", function() {
            const digits = input.value.replace(/\D/g, "");
            input.value = "";
            if (!digits) {
                return;
            }
            fillCodeInputs(index, digits);
        });

        input.addEventListener("keydown", function(event) {
            if (
                /^\d$/.test(event.key) &&
                input.value &&
                !event.ctrlKey &&
                !event.metaKey &&
                !event.altKey
            ) {
                event.preventDefault();
                fillCodeInputs(index, event.key);
            } else if (
                event.key === "Backspace" &&
                !input.value &&
                index > 0
            ) {
                resetCodeInputs[index - 1].focus();
            } else if (event.key === "ArrowLeft" && index > 0) {
                resetCodeInputs[index - 1].focus();
            } else if (
                event.key === "ArrowRight" &&
                index < resetCodeInputs.length - 1
            ) {
                resetCodeInputs[index + 1].focus();
            }
        });

        input.addEventListener("paste", function(event) {
            event.preventDefault();
            fillCodeInputs(
                index,
                event.clipboardData.getData("text")
            );
        });
    });

    const validateResetPasswordMatch = function() {
        resetPasswordConfirm.setCustomValidity(
            resetPasswordConfirm.value &&
            resetPasswordConfirm.value !== resetPasswordInput.value
                ? "Passwords do not match."
                : ""
        );
    };

    verifyResetCodeForm.addEventListener(
        "submit",
        async function(event) {
            event.preventDefault();

            if (!verifyResetCodeForm.reportValidity()) {
                return;
            }

            const submitButton =
                verifyResetCodeForm.querySelector('button[type="submit"]');
            submitButton.disabled = true;
            resetMessage.textContent = "";
            resetMessage.dataset.state = "";

            try {
                const response = await fetch(
                    window.anchorApiUrl("/api/auth/verify-reset-code"),
                    {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json"
                        },
                        body: JSON.stringify({
                            email: resetEmail,
                            code: resetCodeInputs
                                .map(input => input.value)
                                .join("")
                        })
                    }
                );
                const data = await response.json();

                if (!response.ok) {
                    throw new Error(
                        data.message || "Unable to verify the code."
                    );
                }
                if (!/^[a-f0-9]{64}$/i.test(data.resetToken || "")) {
                    throw new Error(
                        "Code verification did not complete. Please try again."
                    );
                }

                resetToken = data.resetToken;
                verifyResetCodeForm.hidden = true;
                resetPasswordForm.hidden = false;
                resetMessage.textContent = data.message;
            } catch (error) {
                console.error("Password reset code verification error:", error);
                resetMessage.textContent =
                    error.message || "Unable to verify the code.";
                resetMessage.dataset.state = "error";
                submitButton.disabled = false;
            }
        }
    );

    resendResetCodeButton.addEventListener(
        "click",
        async function() {
            resendResetCodeButton.disabled = true;
            resetMessage.textContent = "Sending a new verification code...";
            resetMessage.dataset.state = "";

            try {
                const response = await fetch(
                    window.anchorApiUrl("/api/auth/forgot-password"),
                    {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json"
                        },
                        body: JSON.stringify({ email: resetEmail })
                    }
                );
                const data = await response.json();

                if (!response.ok) {
                    throw new Error(
                        data.message || "Unable to resend the verification code."
                    );
                }

                resetToken = "";
                clearCodeInputs();
                resetMessage.textContent =
                    "If an account matches this email, a new verification code has been sent.";
            } catch (error) {
                console.error("Password reset code resend error:", error);
                resetMessage.textContent =
                    error.message || "Unable to resend the verification code.";
                resetMessage.dataset.state = "error";
            } finally {
                resendResetCodeButton.disabled = false;
            }
        }
    );

    resetPasswordInput.addEventListener("input", validateResetPasswordMatch);
    resetPasswordConfirm.addEventListener("input", validateResetPasswordMatch);

    resetPasswordForm.addEventListener(
        "submit",
        async function(event) {
            event.preventDefault();
            validateResetPasswordMatch();

            if (!resetPasswordForm.reportValidity()) {
                return;
            }

            const submitButton =
                resetPasswordForm.querySelector('button[type="submit"]');
            submitButton.disabled = true;
            resetMessage.textContent = "";
            resetMessage.dataset.state = "";

            try {
                const response = await fetch(
                    window.anchorApiUrl("/api/auth/reset-password"),
                    {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json"
                        },
                        body: JSON.stringify({
                            resetToken,
                            password: resetPasswordInput.value
                        })
                    }
                );
                const data = await response.json();

                if (!response.ok) {
                    throw new Error(
                        data.message || "Unable to reset your password."
                    );
                }

                resetPasswordForm.hidden = true;
                window.sessionStorage.removeItem(
                    "anchorPasswordResetEmail"
                );
                resetMessage.textContent =
                    "Your password has been reset. You can now sign in.";
                window.history.replaceState(
                    {},
                    document.title,
                    window.location.pathname
                );
            } catch (error) {
                console.error("Password reset error:", error);
                resetMessage.textContent =
                    error.message || "Unable to reset your password.";
                resetMessage.dataset.state = "error";
                submitButton.disabled = false;
            }
        }
    );
}


/* =========================
   ADMIN / STAFF LOGIN
========================= */

const toggleAdminPassword =
    document.getElementById(
        "toggleAdminPassword"
    );

if (toggleAdminPassword) {

    toggleAdminPassword.addEventListener(
        "click",
        function() {

            const password =
                document.getElementById(
                    "adminPassword"
                );

            if (!password) {
                return;
            }

            const isPasswordHidden =
                password.type === "password";

            password.type =
                isPasswordHidden
                    ? "text"
                    : "password";

            const showIcon =
                toggleAdminPassword.querySelector(
                    '[data-password-icon="show"]'
                );
            const hideIcon =
                toggleAdminPassword.querySelector(
                    '[data-password-icon="hide"]'
                );

            if (showIcon && hideIcon) {
                showIcon.hidden = isPasswordHidden;
                hideIcon.hidden = !isPasswordHidden;
            }

            toggleAdminPassword.setAttribute(
                "aria-label",
                isPasswordHidden
                    ? "Hide password"
                    : "Show password"
            );

            toggleAdminPassword.setAttribute(
                "aria-pressed",
                String(isPasswordHidden)
            );

        }
    );

}

const signupPhoneInput =
    document.getElementById("signupPhone");

if (signupPhoneInput) {
    signupPhoneInput.addEventListener(
        "input",
        function() {
            signupPhoneInput.value =
                signupPhoneInput.value
                    .replace(/\D/g, "")
                    .slice(0, 11);
        }
    );
}

const adminLoginForm =
    document.getElementById(
        "adminLoginForm"
    );

const rememberedAdminEmailKey =
    "anchorRememberedAdminEmail";
const adminEmailInput =
    document.getElementById("adminEmail");
const adminRememberMe =
    document.getElementById("adminRememberMe");

if (adminEmailInput && adminRememberMe) {
    const rememberedAdminEmail =
        window.localStorage.getItem(
            rememberedAdminEmailKey
        );

    if (rememberedAdminEmail) {
        adminEmailInput.value =
            rememberedAdminEmail;
        adminRememberMe.checked = true;
    }

    adminRememberMe.addEventListener(
        "change",
        function() {
            if (!adminRememberMe.checked) {
                window.localStorage.removeItem(
                    rememberedAdminEmailKey
                );
            }
        }
    );
}


if (adminLoginForm) {

    adminLoginForm.addEventListener(
        "submit",
        async function(event) {

            event.preventDefault();


            const email =
                document
                    .getElementById(
                        "adminEmail"
                    )
                    .value
                    .trim()
                    .toLowerCase();


            const password =
                document
                    .getElementById(
                        "adminPassword"
                    )
                    .value;


            const rememberMe =
                document.getElementById(
                    "adminRememberMe"
                );


            const error =
                document.getElementById(
                    "adminLoginError"
                );


            if (error) {
                error.textContent = "";
            }

            try {
                const response = await fetch(
                    window.anchorApiUrl("/api/admin/login"),
                    {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json"
                        },
                        body: JSON.stringify({
                            email,
                            password,
                            remember_me: Boolean(
                                rememberMe && rememberMe.checked
                            )
                        })
                    }
                );
                const data = await response.json();

                if (!response.ok || data.success === false) {
                    throw new Error(
                        data.message || "Invalid admin or staff email or password."
                    );
                }

                const remember = Boolean(
                    rememberMe && rememberMe.checked
                );
                window.anchorSession.remove("anchorUser");
                window.anchorSession.set(
                    "anchorAdminToken",
                    data.token,
                    remember
                );
                window.anchorSession.set(
                    "anchorAdminLoggedIn",
                    "true",
                    remember
                );
                window.anchorSession.set(
                    "anchorAdminRole",
                    data.user.role,
                    remember
                );

                if (remember) {
                    window.localStorage.setItem(
                        rememberedAdminEmailKey,
                        email
                    );
                    localStorage.setItem("anchorAdminRemember", "true");
                } else {
                    window.localStorage.removeItem(rememberedAdminEmailKey);
                    localStorage.removeItem("anchorAdminRemember");
                }

                window.location.href = "admin.html";
            } catch (loginError) {
                window.anchorSession.remove("anchorAdminToken");
                window.anchorSession.remove("anchorAdminLoggedIn");
                window.anchorSession.remove("anchorAdminRole");
                if (error) {
                    error.textContent =
                        loginError.message || "Unable to sign in.";
                }
                document.getElementById("adminPassword").value = "";
            }

        }
    );

}