const AUTH_TOKEN_KEY = "local-study-manager-token";
const AUTH_USER_KEY = "local-study-manager-user";
const AUTH_TOKEN_KEY_PREFIX = `${AUTH_TOKEN_KEY}:`;
const AUTH_USER_KEY_PREFIX = `${AUTH_USER_KEY}:`;
const TEACHER_LOGIN_STARTUP_KEY_PREFIX = "studyflow-teacher-login-startup:";
const ACCESS_LOG_SKIP_KEY_PREFIX = "studyflow-access-log-skip:";
const APP_LOCK_SKIP_KEY_PREFIX = "studyflow-app-lock-skip:";

const form = document.querySelector("[data-auth-form]");
const message = document.querySelector("[data-auth-message]");
const forgotPasswordButton = document.querySelector("#forgotPasswordButton");
const forgotPasswordDialog = document.querySelector("#forgotPasswordDialog");
const forgotPasswordForm = document.querySelector("#forgotPasswordForm");
const forgotPasswordMessage = document.querySelector("#forgotPasswordMessage");
const termsDialog = document.querySelector("#termsDialog");
const termsDialogTitle = document.querySelector("#termsDialogTitle");
const termsDialogFrame = document.querySelector("#termsDialogFrame");
const closeTermsDialog = document.querySelector("#closeTermsDialog");
const termsUrls = {
	agree: "https://csid.kr/service/agreement/agree.html",
	policy: "https://csid.kr/service/agreement/policy.html",
};
const signupState = {
	phone: "",
	phoneVerificationToken: "",
	email: "",
	emailVerificationToken: "",
};
const verificationCooldownTimers = new Map();

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

function normalizePhone(phone) {
	return String(phone || "").replace(/\D/g, "");
}

function setSignupStep(step) {
	if (!form || form.dataset.authForm !== "signup") return;
	const stepOrder = ["phone", "profile", "terms"];
	const activeIndex = stepOrder.indexOf(step);
	form.querySelectorAll("[data-signup-step]").forEach((panel) => {
		const active = panel.dataset.signupStep === step;
		panel.hidden = !active;
		panel.disabled = !active;
	});
	form.querySelectorAll("[data-signup-step-dot]").forEach((dot) => {
		const dotIndex = stepOrder.indexOf(dot.dataset.signupStepDot);
		dot.classList.toggle("active", dot.dataset.signupStepDot === step);
		dot.classList.toggle("is-complete", dotIndex > -1 && dotIndex < activeIndex);
	});
}

function startVerificationCooldown(button, seconds = 60) {
	if (!button) return;
	const originalText = button.dataset.originalText || button.textContent;
	button.dataset.originalText = originalText;
	clearInterval(verificationCooldownTimers.get(button));

	let remaining = Math.min(Math.max(Number(seconds) || 60, 1), 300);
	button.disabled = true;
	button.textContent = `${remaining}초 후 재요청`;

	const timer = setInterval(() => {
		remaining -= 1;
		if (remaining <= 0) {
			clearInterval(timer);
			verificationCooldownTimers.delete(button);
			button.disabled = false;
			button.textContent = originalText;
			return;
		}
		button.textContent = `${remaining}초 후 재요청`;
	}, 1000);

	verificationCooldownTimers.set(button, timer);
}

function lockVerificationTarget(input, button, seconds = 60) {
	if (!input) return;
	input.readOnly = true;
	input.classList.add("is-locked");

	const unlock = () => {
		input.readOnly = false;
		input.classList.remove("is-locked");
	};

	if (!button) return;
	const existingUnlock = button.dataset.unlockTimer;
	if (existingUnlock) clearTimeout(Number(existingUnlock));
	const timer = setTimeout(unlock, Math.min(Math.max(Number(seconds) || 60, 1), 300) * 1000);
	button.dataset.unlockTimer = String(timer);
}

async function requestAuth(path, payload) {
	const response = await fetch(path, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			...getClientHeaders(),
		},
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

function getClientHeaders() {
	if (!isNativeApp()) return {};
	return {
		"X-StudyFlow-Client": "mobile-app",
		"X-StudyFlow-Platform": window.Capacitor?.getPlatform?.() || "app",
	};
}

function isNativeApp() {
	if (typeof window.Capacitor?.isNativePlatform === "function") {
		return window.Capacitor.isNativePlatform();
	}
	return ["android", "ios"].includes(window.Capacitor?.getPlatform?.());
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

function markTeacherLoginStartup(user) {
	if (user?.role !== "teacher") return;
	try {
		sessionStorage.setItem(`${TEACHER_LOGIN_STARTUP_KEY_PREFIX}${user.id || user.email || "anonymous"}`, "1");
	} catch {}
}

function markAccessLogSkip(user) {
	if (!user?.role) return;
	try {
		sessionStorage.setItem(`${ACCESS_LOG_SKIP_KEY_PREFIX}${user.role}:${user.id || user.email || user.loginId || "anonymous"}`, String(Date.now()));
	} catch {}
}

function markAppLockSkip(user) {
	if (!user?.role) return;
	try {
		sessionStorage.setItem(`${APP_LOCK_SKIP_KEY_PREFIX}${user.role}:${user.id || user.email || user.loginId || "anonymous"}`, String(Date.now()));
	} catch {}
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
	markTeacherLoginStartup(result.user);
	markAccessLogSkip(result.user);
	markAppLockSkip(result.user);
	window.location.replace(result.user?.role === "student" ? "./student.html" : "./index.html");
}

async function submitSignup(event) {
	event.preventDefault();
	const email = String(form.querySelector("input[name='email']")?.value || "").trim().toLowerCase();
	const password = form.querySelector("input[name='password']")?.value || "";
	const passwordConfirm = form.querySelector("input[name='passwordConfirm']")?.value || "";
	const name = String(form.querySelector("input[name='name']")?.value || "").trim();
	const termsConsent = Boolean(form.querySelector("input[name='termsConsent']")?.checked);
	const privacyConsent = Boolean(form.querySelector("input[name='privacyConsent']")?.checked);
	const marketingConsent = Boolean(form.querySelector("input[name='marketingConsent']")?.checked);

	if (!signupState.phoneVerificationToken) {
		setMessage("휴대폰 인증을 먼저 완료하세요.", true);
		setSignupStep("phone");
		return;
	}
	if (!signupState.emailVerificationToken) {
		setMessage("이메일 인증을 먼저 완료하세요.", true);
		setSignupStep("profile");
		return;
	}

	if (password !== passwordConfirm) {
		setMessage("비밀번호가 일치하지 않습니다.", true);
		return;
	}

	if (!termsConsent || !privacyConsent) {
		setMessage("필수 약관에 동의하세요.", true);
		setSignupStep("terms");
		return;
	}

	showOverlay();
	const result = await requestAuth("/api/auth/signup", {
		email,
		password,
		name,
		phone: signupState.phone,
		phoneVerificationToken: signupState.phoneVerificationToken,
		emailVerificationToken: signupState.emailVerificationToken,
		marketingConsent,
	});

	saveSession(result);
	window.location.replace("./index.html");
}

async function sendSignupPhoneCode() {
	const nameInput = form.querySelector("input[name='name']");
	const phoneInput = form.querySelector("input[name='phone']");
	const sendButton = form.querySelector("[data-phone-code-send]");
	const phone = normalizePhone(phoneInput?.value);

	if (!nameInput?.value.trim()) {
		setMessage("이름을 입력하세요.", true);
		nameInput?.focus();
		return;
	}
	if (!/^01\d{8,9}$/.test(phone)) {
		setMessage("휴대폰 번호를 정확히 입력하세요.", true);
		phoneInput?.focus();
		return;
	}

	showOverlay();
	const result = await requestAuth("/api/auth/signup/phone-code", { phone });
	hideOverlay();
	signupState.phone = phone;
	signupState.phoneVerificationToken = "";
	form.querySelector("[data-phone-code-fields]")?.removeAttribute("hidden");
	startVerificationCooldown(sendButton, result.expiresInSeconds);
	lockVerificationTarget(phoneInput, sendButton, result.expiresInSeconds);
	setMessage(result.verificationCode ? `인증번호를 발급했습니다. 개발 인증번호: ${result.verificationCode}` : "인증번호를 발송했습니다.");
	form.querySelector("input[name='phoneCode']")?.focus();
}

async function verifySignupPhoneCode() {
	const phoneInput = form.querySelector("input[name='phone']");
	const codeInput = form.querySelector("input[name='phoneCode']");
	const phone = normalizePhone(phoneInput?.value);
	const code = String(codeInput?.value || "").trim();

	if (!/^01\d{8,9}$/.test(phone)) {
		setMessage("휴대폰 번호를 정확히 입력하세요.", true);
		phoneInput?.focus();
		return;
	}
	if (!/^\d{6}$/.test(code)) {
		setMessage("6자리 인증번호를 입력하세요.", true);
		codeInput?.focus();
		return;
	}

	showOverlay();
	const result = await requestAuth("/api/auth/signup/verify-phone", { phone, code });
	hideOverlay();
	signupState.phone = phone;
	signupState.phoneVerificationToken = result.phoneVerificationToken;
	setMessage("휴대폰 인증이 완료되었습니다. 계정 정보를 입력하세요.");
	setSignupStep("profile");
	form.querySelector("input[name='email']")?.focus();
}

async function sendSignupEmailCode() {
	const emailInput = form.querySelector("input[name='email']");
	const sendButton = form.querySelector("[data-email-code-send]");
	const email = String(emailInput?.value || "").trim().toLowerCase();

	if (!emailInput?.checkValidity()) {
		setMessage("이메일을 정확히 입력하세요.", true);
		emailInput?.focus();
		return;
	}

	showOverlay();
	const result = await requestAuth("/api/auth/signup/email-code", { email });
	hideOverlay();
	signupState.email = email;
	signupState.emailVerificationToken = "";
	form.querySelector("[data-email-code-fields]")?.removeAttribute("hidden");
	form.querySelector("[data-signup-account-fields]")?.setAttribute("hidden", "");
	startVerificationCooldown(sendButton, result.expiresInSeconds);
	lockVerificationTarget(emailInput, sendButton, result.expiresInSeconds);
	setMessage(result.verificationCode ? `이메일 인증번호를 발급했습니다. 개발 인증번호: ${result.verificationCode}` : "이메일 인증번호를 발송했습니다.");
	form.querySelector("input[name='emailCode']")?.focus();
}

async function verifySignupEmailCode() {
	const emailInput = form.querySelector("input[name='email']");
	const codeInput = form.querySelector("input[name='emailCode']");
	const email = String(emailInput?.value || "").trim().toLowerCase();
	const code = String(codeInput?.value || "").trim();

	if (!emailInput?.checkValidity()) {
		setMessage("이메일을 정확히 입력하세요.", true);
		emailInput?.focus();
		return;
	}
	if (!/^\d{6}$/.test(code)) {
		setMessage("6자리 이메일 인증번호를 입력하세요.", true);
		codeInput?.focus();
		return;
	}

	showOverlay();
	const result = await requestAuth("/api/auth/signup/verify-email", { email, code });
	hideOverlay();
	signupState.email = email;
	signupState.emailVerificationToken = result.emailVerificationToken;
	form.querySelector("[data-email-code-send]")?.setAttribute("hidden", "");
	form.querySelector("[data-email-code-fields]")?.setAttribute("hidden", "");
	form.querySelector("[data-signup-account-fields]")?.removeAttribute("hidden");
	setMessage("이메일 인증이 완료되었습니다. 계정 정보를 입력하세요.");
	form.querySelector("input[name='password']")?.focus();
}

function proceedSignupTerms() {
	const emailInput = form.querySelector("input[name='email']");
	const passwordInput = form.querySelector("input[name='password']");
	const passwordConfirmInput = form.querySelector("input[name='passwordConfirm']");

	if (!emailInput?.checkValidity()) {
		setMessage("이메일을 정확히 입력하세요.", true);
		emailInput?.focus();
		return;
	}
	if (!signupState.emailVerificationToken || signupState.email !== String(emailInput.value || "").trim().toLowerCase()) {
		setMessage("이메일 인증을 완료하세요.", true);
		emailInput?.focus();
		return;
	}
	if (!passwordInput?.value) {
		setMessage("비밀번호를 입력하세요.", true);
		passwordInput?.focus();
		return;
	}
	if (passwordInput.value !== passwordConfirmInput?.value) {
		setMessage("비밀번호가 일치하지 않습니다.", true);
		passwordConfirmInput?.focus();
		return;
	}

	setMessage("");
	setSignupStep("terms");
	form.querySelector("input[name='termsConsent']")?.focus();
}

function syncAllConsentState() {
	if (!form || form.dataset.authForm !== "signup") return;
	const allConsent = form.querySelector("[data-all-consent]");
	const consentInputs = [...form.querySelectorAll("input[name='termsConsent'], input[name='privacyConsent'], input[name='marketingConsent']")];
	if (!allConsent || consentInputs.length === 0) return;
	allConsent.checked = consentInputs.every((input) => input.checked);
	allConsent.indeterminate = !allConsent.checked && consentInputs.some((input) => input.checked);
}

function setAllConsent(checked) {
	form.querySelectorAll("input[name='termsConsent'], input[name='privacyConsent'], input[name='marketingConsent']").forEach((input) => {
		input.checked = checked;
	});
	syncAllConsentState();
}

function openTermsDialog(type) {
	if (!termsDialog || !termsDialogFrame || !termsDialogTitle) return;
	const title = type === "policy" ? "개인정보 처리방침" : "서비스 이용약관";
	const url = termsUrls[type];
	if (!url) return;
	termsDialogTitle.textContent = title;
	termsDialogFrame.src = url;
	termsDialog.showModal();
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
	setSignupStep("phone");
	form.querySelectorAll("input[name='loginMode']").forEach((input) => {
		input.addEventListener("change", syncLoginMode);
	});

	form.querySelector("[data-phone-code-send]")?.addEventListener("click", async () => {
		try {
			await sendSignupPhoneCode();
		} catch (error) {
			hideOverlay();
			setMessage(error.message || "인증번호를 발급하지 못했습니다.", true);
		}
	});

	form.querySelector("[data-phone-code-verify]")?.addEventListener("click", async () => {
		try {
			await verifySignupPhoneCode();
		} catch (error) {
			hideOverlay();
			setMessage(error.message || "휴대폰 인증에 실패했습니다.", true);
		}
	});

	form.querySelector("[data-email-code-send]")?.addEventListener("click", async () => {
		try {
			await sendSignupEmailCode();
		} catch (error) {
			hideOverlay();
			setMessage(error.message || "이메일 인증번호를 발급하지 못했습니다.", true);
		}
	});

	form.querySelector("[data-email-code-verify]")?.addEventListener("click", async () => {
		try {
			await verifySignupEmailCode();
		} catch (error) {
			hideOverlay();
			setMessage(error.message || "이메일 인증에 실패했습니다.", true);
		}
	});

	form.querySelector("[data-signup-next]")?.addEventListener("click", proceedSignupTerms);

	form.querySelector("[data-all-consent]")?.addEventListener("change", (event) => {
		setAllConsent(event.target.checked);
	});

	form.querySelectorAll("input[name='termsConsent'], input[name='privacyConsent'], input[name='marketingConsent']").forEach((input) => {
		input.addEventListener("change", syncAllConsentState);
	});

	form.querySelectorAll("[data-terms-open]").forEach((button) => {
		button.addEventListener("click", () => openTermsDialog(button.dataset.termsOpen));
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

if (closeTermsDialog && termsDialog) {
	closeTermsDialog.addEventListener("click", () => termsDialog.close());
	termsDialog.addEventListener("close", () => {
		if (termsDialogFrame) termsDialogFrame.src = "about:blank";
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
