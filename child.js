const LEGACY_STORAGE_KEY = "local-study-manager-v1";
const AUTH_TOKEN_KEY = "local-study-manager-token";
const AUTH_USER_KEY = "local-study-manager-user";
const AUTH_TOKEN_KEY_PREFIX = `${AUTH_TOKEN_KEY}:`;
const AUTH_USER_KEY_PREFIX = `${AUTH_USER_KEY}:`;

const authSession = getSessionForRole("teacher");
const authToken = authSession.token;

if (!authToken) {
	window.location.replace("./login.html");
	throw new Error("Authentication required.");
}

const authUser = authSession.user;
const STORAGE_KEY = `${LEGACY_STORAGE_KEY}:${authUser.id || authUser.email || "anonymous"}`;

const els = {
	title: document.querySelector("#childPageTitle"),
	back: document.querySelector("#childPageBack"),
	form: document.querySelector("#childPageForm"),
	name: document.querySelector("#childPageName"),
	birthMonth: document.querySelector("#childPageBirthMonth"),
	phone: document.querySelector("#childPagePhone"),
	parentPhone: document.querySelector("#childPageParentPhone"),
	loginId: document.querySelector("#childPageLoginId"),
	verifyLoginId: document.querySelector("#childPageVerifyLoginId"),
	loginIdHelp: document.querySelector("#childPageLoginIdHelp"),
	password: document.querySelector("#childPagePassword"),
	passwordConfirm: document.querySelector("#childPagePasswordConfirm"),
	submit: document.querySelector("#childPageSubmit"),
	toast: document.querySelector("#childPageToast"),
};

let toastTimer = null;
let state = null;
let activeChildId = "";
let requiredRegistration = false;

function parseStoredUser(value) {
	try {
		return JSON.parse(value || "{}");
	} catch {
		return {};
	}
}

function getSessionForRole(role) {
	const tokenKey = `${AUTH_TOKEN_KEY_PREFIX}${role}`;
	const userKey = `${AUTH_USER_KEY_PREFIX}${role}`;
	const token = localStorage.getItem(tokenKey);
	const user = parseStoredUser(localStorage.getItem(userKey));
	if (token && user.role === role) return { token, user };

	const legacyToken = localStorage.getItem(AUTH_TOKEN_KEY);
	const legacyUser = parseStoredUser(localStorage.getItem(AUTH_USER_KEY));
	if (legacyToken && legacyUser.role === role) {
		localStorage.setItem(tokenKey, legacyToken);
		localStorage.setItem(userKey, JSON.stringify(legacyUser));
		return { token: legacyToken, user: legacyUser };
	}

	return { token: "", user: {} };
}

function setMessage(text, isError = false) {
	clearTimeout(toastTimer);
	els.toast.textContent = text || "";
	els.toast.classList.toggle("is-error", isError);
	els.toast.classList.toggle("is-visible", Boolean(text));
	if (text) {
		toastTimer = setTimeout(() => els.toast.classList.remove("is-visible"), isError ? 4000 : 2200);
	}
}

function logout() {
	localStorage.removeItem(`${AUTH_TOKEN_KEY_PREFIX}teacher`);
	localStorage.removeItem(`${AUTH_USER_KEY_PREFIX}teacher`);
	localStorage.removeItem(AUTH_TOKEN_KEY);
	localStorage.removeItem(AUTH_USER_KEY);
	window.location.replace("./login.html");
}

async function requestJson(path, options = {}) {
	const response = await fetch(path, {
		...options,
		headers: {
			Authorization: `Bearer ${authToken}`,
			"Content-Type": "application/json",
			...(options.headers || {}),
		},
	});
	if (!(response.headers.get("content-type") || "").includes("application/json")) {
		throw new Error("StudyFlow API 응답이 아닙니다.");
	}
	const data = await response.json().catch(() => ({}));
	if (response.status === 401) {
		logout();
		throw new Error("로그인이 필요합니다.");
	}
	if (!response.ok) throw new Error(data.message || "요청을 처리하지 못했습니다.");
	return data;
}

function normalizeMobilePhone(value) {
	const raw = String(value || "").trim();
	if (!raw) return "";
	const digits = raw.replace(/\D/g, "");
	if (/^01\d{8}$/.test(digits)) return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
	if (/^01\d{9}$/.test(digits)) return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
	return raw;
}

function isValidKoreanMobilePhone(value) {
	return !value || /^01\d-\d{3,4}-\d{4}$/.test(normalizeMobilePhone(value));
}

function normalizeBirthValue(value) {
	return String(value || "").slice(0, 10);
}

function sortChildAccountsByBirth(accounts) {
	return [...accounts].sort((a, b) => {
		const byBirth = normalizeBirthValue(a.birthMonth).localeCompare(normalizeBirthValue(b.birthMonth));
		const emptyBirth = Number(!a.birthMonth) - Number(!b.birthMonth);
		return emptyBirth || byBirth || a.name.localeCompare(b.name, "ko-KR");
	});
}

function normalizeChildAccounts(value = {}) {
	const savedAccounts = Array.isArray(value.childAccounts) ? value.childAccounts : [];
	const names = [...savedAccounts.map((account) => account?.name), ...Object.keys(value.subjectsByChild || {})]
		.map((name) => String(name || "").trim())
		.filter(Boolean);
	const uniqueNames = [...new Set(names)];

	return sortChildAccountsByBirth(
		uniqueNames.map((name) => {
			const saved = savedAccounts.find((account) => account?.name === name) || {};
			return {
				id: saved.id || crypto.randomUUID(),
				name,
				birthMonth: saved.birthMonth || "",
				phone: normalizeMobilePhone(saved.phone),
				parentPhone: normalizeMobilePhone(saved.parentPhone),
				loginId: saved.loginId || "",
				password: saved.password || "",
			};
		}),
	);
}

function normalizeState(value = {}) {
	const childAccounts = normalizeChildAccounts(value);
	const subjectsByChild = Object.fromEntries(childAccounts.map((child) => [child.name, []]));
	Object.entries(value.subjectsByChild || {}).forEach(([child, subjects]) => {
		if (subjectsByChild[child]) subjectsByChild[child] = Array.isArray(subjects) ? subjects : [];
	});
	return {
		...value,
		childAccounts,
		subjectSettings: Array.isArray(value.subjectSettings) ? value.subjectSettings : [],
		subjectsByChild,
		entries: value.entries && typeof value.entries === "object" ? value.entries : {},
	};
}

function getQuery() {
	return new URLSearchParams(window.location.search);
}

function getAccount() {
	return state.childAccounts.find((account) => account.id === activeChildId);
}

function focusField(field) {
	field?.focus();
}

function renameChildData(oldName, newName) {
	if (oldName === newName) return;
	state.subjectsByChild[newName] = state.subjectsByChild[oldName] || [];
	delete state.subjectsByChild[oldName];
	Object.values(state.entries).forEach((entry) => {
		if (entry.child === oldName) entry.child = newName;
	});
	rebuildEntryKeys();
}

function rebuildEntryKeys() {
	state.entries = Object.fromEntries(
		Object.values(state.entries || {}).map((entry) => {
			const key = `${entry.child}__${entry.subjectId}__${entry.date}`;
			return [key, { ...entry, key }];
		}),
	);
}

function renderForm() {
	const query = getQuery();
	activeChildId = query.get("id") || "";
	requiredRegistration = query.get("required") === "1" && state.childAccounts.length === 0;
	const account = getAccount();
	const isEdit = Boolean(account);

	els.title.textContent = requiredRegistration ? "첫 학생 등록" : isEdit ? "학생 수정" : "학생 등록";
	els.back.hidden = requiredRegistration;
	els.name.value = account?.name || "";
	els.birthMonth.value = account?.birthMonth || "";
	els.phone.value = account?.phone || "";
	els.parentPhone.value = account?.parentPhone || "";
	els.loginId.value = account?.loginId || "";
	els.loginId.readOnly = Boolean(account?.loginId);
	els.loginId.classList.toggle("is-readonly", Boolean(account?.loginId));
	els.verifyLoginId.hidden = Boolean(account?.loginId);
	els.loginIdHelp.textContent = account?.loginId
		? "학생 아이디는 한 번 설정하면 변경할 수 없습니다. 비밀번호만 재설정할 수 있습니다."
		: "학생 아이디는 선택 사항입니다. 비어 있으면 나중에 한 번 설정할 수 있습니다.";
	els.password.value = "";
	els.passwordConfirm.value = "";
	els.submit.textContent = isEdit ? "저장" : "등록";
}

async function loadState() {
	const data = await requestJson("/api/state");
	state = normalizeState(data.state);
	localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
	renderForm();
}

async function saveRemoteState() {
	localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
	await requestJson("/api/state", {
		method: "PUT",
		body: JSON.stringify({ state }),
	});
}

function verifyLoginId() {
	const account = getAccount();
	if (account?.loginId) {
		setMessage("이미 설정된 학생 아이디는 변경할 수 없습니다.", true);
		return;
	}
	const loginId = els.loginId.value.trim();
	if (!loginId) {
		setMessage("확인할 학생 아이디를 입력하세요.", true);
		focusField(els.loginId);
		return;
	}
	const isDuplicate = state.childAccounts.some((child) => child.id !== activeChildId && child.loginId === loginId);
	setMessage(isDuplicate ? "이미 사용 중인 학생 아이디입니다." : "사용할 수 있는 학생 아이디입니다.", isDuplicate);
}

async function saveChild(event) {
	event.preventDefault();
	const account = getAccount();
	const originalName = account?.name || "";
	const editingId = account?.id || "";
	const existingLoginId = account?.loginId || "";
	const name = els.name.value.trim();
	const birthMonth = els.birthMonth.value;
	const phone = normalizeMobilePhone(els.phone.value);
	const parentPhone = normalizeMobilePhone(els.parentPhone.value);
	const loginId = existingLoginId || els.loginId.value.trim();
	const password = els.password.value.trim();
	const passwordConfirm = els.passwordConfirm.value.trim();

	if (!name) {
		setMessage("학생 이름을 입력하세요.", true);
		focusField(els.name);
		return;
	}
	if (!isValidKoreanMobilePhone(phone)) {
		setMessage("학생 휴대폰은 01n-nnnn-nnnn 형식으로 입력하세요.", true);
		focusField(els.phone);
		return;
	}
	if (!isValidKoreanMobilePhone(parentPhone)) {
		setMessage("학부모 휴대폰은 01n-nnnn-nnnn 형식으로 입력하세요.", true);
		focusField(els.parentPhone);
		return;
	}
	if (state.childAccounts.some((child) => child.id !== editingId && child.name === name)) {
		setMessage("이미 등록된 학생 이름입니다.", true);
		focusField(els.name);
		return;
	}
	if (loginId && state.childAccounts.some((child) => child.id !== editingId && child.loginId === loginId)) {
		setMessage("이미 사용 중인 학생 아이디입니다.", true);
		focusField(els.loginId);
		return;
	}
	if (!existingLoginId && loginId && !password) {
		setMessage("학생 아이디를 새로 설정하려면 비밀번호도 함께 입력하세요.", true);
		focusField(els.password);
		return;
	}
	if (password || passwordConfirm) {
		if (!loginId) {
			setMessage("비밀번호를 설정하려면 학생 아이디를 먼저 입력하세요.", true);
			focusField(els.loginId);
			return;
		}
		if (!password || !passwordConfirm) {
			setMessage("비밀번호와 비밀번호 확인을 모두 입력하세요.", true);
			return;
		}
		if (password !== passwordConfirm) {
			setMessage("비밀번호가 서로 일치하지 않습니다.", true);
			return;
		}
	}

	try {
		els.submit.disabled = true;
		if (account) {
			renameChildData(originalName, name);
			account.name = name;
			account.birthMonth = birthMonth;
			account.phone = phone;
			account.parentPhone = parentPhone;
			account.loginId = existingLoginId || loginId;
			if (password) account.password = password;
		} else {
			state.childAccounts.push({
				id: crypto.randomUUID(),
				name,
				birthMonth,
				phone,
				parentPhone,
				loginId,
				password,
			});
			state.subjectsByChild[name] = [];
		}
		state.childAccounts = sortChildAccountsByBirth(state.childAccounts);
		await saveRemoteState();
		setMessage(account ? "학생 정보를 저장했습니다." : "학생을 등록했습니다.");
		setTimeout(() => {
			window.location.href = "./index.html";
		}, 350);
	} catch (error) {
		setMessage(error.message || "저장하지 못했습니다.", true);
	} finally {
		els.submit.disabled = false;
	}
}

els.verifyLoginId.addEventListener("click", verifyLoginId);
els.form.addEventListener("submit", saveChild);
document.addEventListener(
	"keydown",
	(event) => {
		if (!requiredRegistration || event.key !== "Escape") return;
		event.preventDefault();
		event.stopPropagation();
		focusField(els.name);
	},
	true,
);

loadState().catch((error) => setMessage(error.message || "학생 정보를 불러오지 못했습니다.", true));
