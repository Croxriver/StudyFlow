const AUTH_TOKEN_KEY = "local-study-manager-token";
const AUTH_USER_KEY = "local-study-manager-user";
const AUTH_TOKEN_KEY_PREFIX = `${AUTH_TOKEN_KEY}:`;
const AUTH_USER_KEY_PREFIX = `${AUTH_USER_KEY}:`;

const form = document.querySelector("[data-auth-form]");
const message = document.querySelector("[data-auth-message]");
const forgotPasswordButton = document.querySelector("#forgotPasswordButton");
const forgotPasswordDialog = document.querySelector("#forgotPasswordDialog");
const forgotPasswordForm = document.querySelector("#forgotPasswordForm");
const forgotPasswordMessage = document.querySelector("#forgotPasswordMessage");

function setMessage(text, isError = false) {
	if (!message) return;
	message.textContent = text;
	message.classList.toggle("is-error", isError);
}

function showOverlay() {
	const el = document.getElementById("authOverlay");
	if (el) el.removeAttribute("hidden");
}

function hideOverlay() {
	const el = document.getElementById("authOverlay");
	if (el) el.setAttribute("hidden", "");
}

function setForgotMessage(text, isError = false) {
	if (!forgotPasswordMessage) return;
	forgotPasswordMessage.textContent = text;
	forgotPasswordMessage.classList.toggle("is-error", isError);
}

function getFormData() {
	return Object.fromEntries(new FormData(form).entries());
}

async function requestAuth(path, payload) {
	const response = await fetch(path, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(payload),
	});
	const contentType = response.headers.get("content-type") || "";
	if (!contentType.includes("application/json")) {
		throw new Error("StudyFlow API 응답이 아닙니다. 서버의 /api 연결을 확인하세요.");
	}
	const data = await response.json().catch(() => ({}));

	if (!response.ok) {
		throw new Error(data.message || "Request failed.");
	}

	return data;
}

function saveSession(data) {
	if (!data?.token || !data?.user?.role) {
		throw new Error("로그인 응답이 올바르지 않습니다. 서버 API 연결을 확인하세요.");
	}
	migrateLegacySession();
	const role = data.user.role;
	localStorage.setItem(`${AUTH_TOKEN_KEY_PREFIX}${role}`, data.token);
	localStorage.setItem(`${AUTH_USER_KEY_PREFIX}${role}`, JSON.stringify(data.user));
	localStorage.removeItem(AUTH_TOKEN_KEY);
	localStorage.removeItem(AUTH_USER_KEY);
}

function migrateLegacySession() {
	const token = localStorage.getItem(AUTH_TOKEN_KEY);
	const user = parseStoredUser(localStorage.getItem(AUTH_USER_KEY));
	if (!token || !user.role) return;

	localStorage.setItem(`${AUTH_TOKEN_KEY_PREFIX}${user.role}`, token);
	localStorage.setItem(`${AUTH_USER_KEY_PREFIX}${user.role}`, JSON.stringify(user));
}

function parseStoredUser(value) {
	try {
		return JSON.parse(value || "{}");
	} catch {
		return {};
	}
}

function getLoginMode() {
	return new FormData(form).get("loginMode") || "teacher";
}

async function submitLogin(event) {
	event.preventDefault();
	const data = getFormData();
	const loginMode = getLoginMode();

	showOverlay();
	const result =
		loginMode === "student"
			? await requestAuth("/api/auth/student-login", {
					loginId: data.loginId,
					password: data.password,
				})
			: await requestAuth("/api/auth/login", {
					email: data.email,
					password: data.password,
				});

	saveSession(result);
	window.location.href = result.user?.role === "student" ? "./student.html" : "./index.html";
}

async function submitSignup(event) {
	event.preventDefault();
	const data = getFormData();

	if (data.password !== data.passwordConfirm) {
		setMessage("비밀번호가 일치하지 않습니다.", true);
		return;
	}

	showOverlay();
	const result = await requestAuth("/api/auth/signup", {
		email: data.email,
		password: data.password,
		name: data.name,
		phone: data.phone,
		marketingConsent: Boolean(data.marketingConsent),
	});

	saveSession(result);
	window.location.href = "./index.html";
}

async function submitPasswordReset(event) {
	event.preventDefault();
	const data = Object.fromEntries(new FormData(forgotPasswordForm).entries());

	if (data.resetPassword !== data.resetPasswordConfirm) {
		setForgotMessage("새 비밀번호가 서로 일치하지 않습니다.", true);
		return;
	}

	setForgotMessage("가입 정보를 확인하는 중입니다...");
	await requestAuth("/api/auth/reset-password", {
		email: data.resetEmail,
		name: data.resetName,
		phone: data.resetPhone,
		password: data.resetPassword,
	});

	forgotPasswordForm.reset();
	setForgotMessage("비밀번호가 변경되었습니다. 새 비밀번호로 로그인하세요.");
	setMessage("비밀번호가 변경되었습니다. 새 비밀번호로 로그인하세요.");
}

function syncLoginMode() {
	if (!form || form.dataset.authForm !== "login") return;
	const mode = getLoginMode();
	const teacherField = form.querySelector("[data-teacher-login-field]");
	const studentField = form.querySelector("[data-student-login-field]");
	const emailInput = form.querySelector("input[name='email']");
	const loginIdInput = form.querySelector("input[name='loginId']");

	if (teacherField) teacherField.hidden = mode !== "teacher";
	if (studentField) studentField.hidden = mode !== "student";
	if (emailInput) emailInput.required = mode === "teacher";
	if (loginIdInput) loginIdInput.required = mode === "student";
}

if (form) {
	syncLoginMode();
	form.querySelectorAll("input[name='loginMode']").forEach((input) => {
		input.addEventListener("change", syncLoginMode);
	});

	form.addEventListener("submit", async (event) => {
		try {
			if (form.dataset.authForm === "signup") {
				await submitSignup(event);
			} else {
				await submitLogin(event);
			}
		} catch (error) {
			hideOverlay();
			setMessage(error.message || "요청을 처리하지 못했습니다.", true);
		}
	});
}

if (forgotPasswordButton && forgotPasswordDialog) {
	forgotPasswordButton.addEventListener("click", () => {
		setForgotMessage("");
		forgotPasswordDialog.showModal();
	});
}

if (forgotPasswordForm) {
	forgotPasswordForm.addEventListener("submit", async (event) => {
		if (event.submitter?.value === "cancel") return;
		try {
			await submitPasswordReset(event);
		} catch (error) {
			setForgotMessage(error.message || "비밀번호를 재설정하지 못했습니다.", true);
		}
	});
}
