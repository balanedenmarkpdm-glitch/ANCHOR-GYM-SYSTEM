/* =========================
   CUSTOMER LOGIN
========================= */

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
                            password: password
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


                // Save logged-in customer information
                localStorage.setItem(
                    "anchorUser",
                    JSON.stringify(data.user)
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


if (googleLogin) {

    googleLogin.addEventListener(
        "click",
        function() {

            alert(
                "Google authentication will open here."
            );

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


            if (
                password.type ===
                "password"
            ) {

                password.type = "text";

                this.textContent = "Hide";

            } else {

                password.type = "password";

                this.textContent = "Show";

            }

        }
    );

}


/* =========================
   SIGN UP
========================= */

const signupForm =
    document.getElementById("signupForm");


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

            if (!/^[^\s@]+@gmail\.com$/i.test(email)) {

                alert(
                    "Please use a valid Gmail address ending in @gmail.com."
                );

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


            try {

                const response =
                    await fetch(window.anchorApiUrl("/api/signup"), {

                        method: "POST",

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

                    alert(
                        data.message ||
                        "Unable to create account."
                    );

                    return;
                }


                alert(
                    "Customer account created successfully!"
                );


                // Go to customer login
                window.location.href =
                    "login.html";


            } catch (error) {

                console.error(
                    "Signup error:",
                    error
                );

                alert(
                    "Unable to connect to the server."
                );

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

            toggle.textContent =
                showPassword
                    ? "Hide"
                    : "Show";

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


if (forgotForm) {

    forgotForm.addEventListener(
        "submit",
        function(event) {

            event.preventDefault();


            const email =
                document
                    .getElementById("forgotEmail")
                    .value
                    .trim();


            if (!email) {

                alert(
                    "Please enter your email."
                );

                return;
            }


            /*
                REAL SYSTEM:

                Forgot Password
                       ↓
                    server.js
                       ↓
                   Nodemailer
                       ↓
                   Email Link
                       ↓
                 New Password
            */


            alert(
                "Password reset link sent to " +
                email
            );

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

            toggleAdminPassword.textContent =
                isPasswordHidden
                    ? "Hide"
                    : "Show";

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


if (adminLoginForm) {

    adminLoginForm.addEventListener(
        "submit",
        function(event) {

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


            // =================================
            // HARD-CODED ADMIN / STAFF LOGIN
            // =================================

            if (
                email === "admin@gmail.com" &&
                password === "admin123"
            ) {

                // Remove customer session
                localStorage.removeItem(
                    "anchorUser"
                );


                // Save admin session
                localStorage.setItem(
                    "anchorAdminLoggedIn",
                    "true"
                );


                localStorage.setItem(
                    "anchorAdminRole",
                    "admin"
                );


                if (
                    rememberMe &&
                    rememberMe.checked
                ) {

                    localStorage.setItem(
                        "anchorAdminRemember",
                        "true"
                    );

                } else {

                    localStorage.removeItem(
                        "anchorAdminRemember"
                    );

                }


                // Go to admin dashboard
                window.location.href =
                    "admin.html";


                return;

            }


            // =================================
            // WRONG CREDENTIALS
            // =================================

            localStorage.removeItem(
                "anchorAdminLoggedIn"
            );


            localStorage.removeItem(
                "anchorAdminRole"
            );


            if (error) {

                error.textContent =
                    "Invalid admin email or password.";

            }


            document.getElementById(
                "adminPassword"
            ).value = "";

        }
    );

}