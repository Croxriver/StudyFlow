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
const PENDING_MINIMUM_STUDY_KEY = `${STORAGE_KEY}:pending-minimum-study`;
const dayNames = ["월", "화", "수", "목", "금", "토", "일"];
const scheduleDayIndexes = new Map([
	["일", 0],
	["월", 1],
	["화", 2],
	["수", 3],
	["목", 4],
	["금", 5],
	["토", 6],
]);

const els = {
	title: document.querySelector("#bookPageTitle"),
	form: document.querySelector("#bookPageForm"),
	child: document.querySelector("#bookPageChild"),
	subject: document.querySelector("#bookPageSubject"),
	book: document.querySelector("#bookPageName"),
	scheduleHour: document.querySelector("#bookPageScheduleHour"),
	scheduleMinute: document.querySelector("#bookPageScheduleMinute"),
	minimumStudyMinutes: document.querySelector("#bookPageMinimumStudyMinutes"),
	startDate: document.querySelector("#bookPageStartDate"),
	endDate: document.querySelector("#bookPageEndDate"),
	autoPlan: document.querySelector("#bookPageAutoPlan"),
	autoPlanText: document.querySelector("#bookPageAutoPlanText"),
	rewardEnabled: document.querySelector("#bookPageRewardEnabled"),
	rewardFields: document.querySelector("#bookPageRewardFields"),
	rewardAmount: document.querySelector("#bookPageRewardAmount"),
	rewardLabel: document.querySelector("#bookPageRewardLabel"),
	submit: document.querySelector("#bookPageSubmit"),
	toast: document.querySelector("#bookPageToast"),
};

let toastTimer = null;
let state = null;
let mode = "add";
let activeChild = "";
let activeSubjectId = "";

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

function normalizeScheduleTime(value) {
	if (!value) return "";
	const match = String(value).match(/(\d{1,2}):(\d{2})/);
	if (!match) return "";
	const hour = Number(match[1]);
	const minute = Number(match[2]);
	if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return "";
	return `${String(hour).padStart(2, "0")}:${String(Math.floor(minute / 10) * 10).padStart(2, "0")}`;
}

function normalizeMinimumStudyMinutes(value) {
	const minutes = Number.parseInt(value, 10) || 0;
	if (minutes === 0) return 0;
	if (minutes < 10 || minutes > 120) return 0;
	return Math.floor(minutes / 10) * 10;
}

function formatMinimumStudyMinutes(value) {
	const minutes = normalizeMinimumStudyMinutes(value);
	if (!minutes) return "미설정";
	const hours = Math.floor(minutes / 60);
	const rest = minutes % 60;
	if (hours && rest) return `${hours}시간 ${rest}분`;
	if (hours) return `${hours}시간`;
	return `${rest}분`;
}

function normalizeRewardAmount(value) {
	const amount = Number.parseInt(value, 10) || 0;
	return amount > 0 ? amount : 0;
}

function normalizeRewardLabel(value) {
	return String(value || "").trim().slice(0, 20) || "포인트";
}

function renderSelectOptions() {
	const hourOptions = `<option value="">시</option>${Array.from({ length: 17 }, (_, index) => index + 6)
		.map((hour) => `<option value="${String(hour).padStart(2, "0")}">${hour < 12 ? `오전 ${hour}시` : hour === 12 ? "오후 12시" : `오후 ${hour - 12}시`}</option>`)
		.join("")}`;
	const minuteOptions = `<option value="">분</option>${Array.from({ length: 6 }, (_, index) => index * 10)
		.map((minute) => `<option value="${String(minute).padStart(2, "0")}">${String(minute).padStart(2, "0")}분</option>`)
		.join("")}`;
	const minimumOptions = `<option value="0">미설정</option>${Array.from({ length: 12 }, (_, index) => (index + 1) * 10)
		.map((minute) => `<option value="${minute}">${formatMinimumStudyMinutes(minute)}</option>`)
		.join("")}`;

	els.scheduleHour.innerHTML = hourOptions;
	els.scheduleMinute.innerHTML = minuteOptions;
	els.minimumStudyMinutes.innerHTML = minimumOptions;
}

function normalizeState(value = {}) {
	const childAccounts = Array.isArray(value.childAccounts) ? value.childAccounts : [];
	const subjectsByChild = Object.fromEntries(childAccounts.map((child) => [child.name, []]));
	Object.entries(value.subjectsByChild || {}).forEach(([child, subjects]) => {
		subjectsByChild[child] = Array.isArray(subjects)
			? subjects.map((subject) => ({
					...subject,
					scheduleDays: Array.isArray(subject.scheduleDays) ? subject.scheduleDays : subject.schedule_days || [],
					scheduleTime: normalizeScheduleTime(subject.scheduleTime ?? subject.schedule_time),
					minimumStudyMinutes: normalizeMinimumStudyMinutes(subject.minimumStudyMinutes ?? subject.minimum_study_minutes),
					rewardAmount: normalizeRewardAmount(subject.rewardAmount ?? subject.reward_amount),
					rewardLabel: normalizeRewardLabel(subject.rewardLabel ?? subject.reward_label),
				}))
			: [];
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

function getSelectedScheduleDays() {
	return [...document.querySelectorAll('input[name="bookPageScheduleDay"]:checked')].map((input) => input.value);
}

function setSelectedScheduleDays(days = []) {
	const selected = new Set(days);
	document.querySelectorAll('input[name="bookPageScheduleDay"]').forEach((input) => {
		input.checked = selected.has(input.value);
	});
}

function getTimeValue() {
	if (!els.scheduleHour.value || !els.scheduleMinute.value) return "";
	return `${els.scheduleHour.value}:${els.scheduleMinute.value}`;
}

function setTimeValue(value) {
	const time = normalizeScheduleTime(value);
	const [hour = "", minute = ""] = time ? time.split(":") : [];
	els.scheduleHour.value = hour;
	els.scheduleMinute.value = minute;
}

function syncRewardFields() {
	const enabled = Boolean(els.rewardEnabled.checked);
	els.rewardFields.hidden = !enabled;
	if (enabled && !els.rewardLabel.value.trim()) {
		els.rewardLabel.value = normalizeRewardLabel("");
	}
}

function isInvalidPeriod(startDate, endDate) {
	return Boolean(startDate && endDate && endDate < startDate);
}

function canCreateAutoPlan(scheduleDays, startDate, endDate) {
	return scheduleDays.length > 0 && Boolean(startDate) && Boolean(endDate);
}

function parseDate(value) {
	const date = new Date(`${value}T00:00:00`);
	return Number.isNaN(date.getTime()) ? new Date() : date;
}

function formatDate(date) {
	return date.toISOString().slice(0, 10);
}

function addDays(date, days) {
	const next = new Date(date);
	next.setDate(next.getDate() + days);
	return next;
}

function entryKey(child, subjectId, date) {
	return `${child}__${subjectId}__${date}`;
}

function createAutoPlanEntries(child, subject) {
	const plannedDays = new Set((subject.scheduleDays || []).map((day) => scheduleDayIndexes.get(day)).filter((day) => day !== undefined));
	if (!plannedDays.size || !subject.startDate || !subject.endDate) return;

	let current = parseDate(subject.startDate);
	const end = parseDate(subject.endDate);
	while (current <= end) {
		const date = formatDate(current);
		if (plannedDays.has(current.getDay())) {
			const key = entryKey(child, subject.id, date);
			if (!state.entries[key]) {
				state.entries[key] = {
					child,
					subjectId: subject.id,
					date,
					key,
					amount: "",
					minimumStudyMinutes: normalizeMinimumStudyMinutes(subject.minimumStudyMinutes),
					memo: "",
					completed: false,
					planned: true,
					rewardAwarded: false,
					rewardAmount: 0,
					rewardLabel: normalizeRewardLabel(subject.rewardLabel),
					rewardRedeemed: false,
					updatedAt: new Date().toISOString(),
				};
			}
		}
		current = addDays(current, 1);
	}
}

function deleteBlankPlanEntries(child, subjectId) {
	Object.entries(state.entries).forEach(([key, entry]) => {
		if (entry.child === child && entry.subjectId === subjectId && entry.planned && !entry.amount && !entry.memo && !entry.completed) {
			delete state.entries[key];
		}
	});
}

function markPendingMinimumStudyUpdate(subjectId) {
	if (!subjectId) return;
	let value = [];
	try {
		value = JSON.parse(localStorage.getItem(PENDING_MINIMUM_STUDY_KEY) || "[]");
	} catch {
		value = [];
	}
	const pending = new Set(Array.isArray(value) ? value.map(String) : []);
	pending.add(String(subjectId));
	localStorage.setItem(PENDING_MINIMUM_STUDY_KEY, JSON.stringify([...pending]));
}

function renderForm() {
	const query = getQuery();
	activeChild = query.get("child") || state.childAccounts[0]?.name || "";
	activeSubjectId = query.get("subjectId") || "";
	mode = activeSubjectId ? "edit" : "add";
	const subject = state.subjectsByChild[activeChild]?.find((item) => item.id === activeSubjectId);

	els.title.textContent = mode === "edit" ? "교재 수정" : "교재 등록";
	els.submit.textContent = mode === "edit" ? "저장" : "등록";
	els.autoPlanText.textContent = mode === "edit" ? "저장 후 빈 가계획 다시 생성" : "기간과 요일에 맞춰 가계획 자동 생성";

	els.child.innerHTML = state.childAccounts.map((child) => `<option value="${child.name}">${child.name}</option>`).join("");
	els.subject.innerHTML = state.subjectSettings.map((item) => `<option value="${item.id}">${item.name}</option>`).join("");
	els.child.value = activeChild;
	els.child.disabled = mode === "edit";

	if (mode === "edit" && subject) {
		els.subject.value = subject.subjectSettingId || "";
		els.book.value = subject.book || "";
		setSelectedScheduleDays(subject.scheduleDays);
		setTimeValue(subject.scheduleTime);
		els.minimumStudyMinutes.value = String(normalizeMinimumStudyMinutes(subject.minimumStudyMinutes));
		els.startDate.value = subject.startDate || "";
		els.endDate.value = subject.endDate || "";
		els.autoPlan.checked = false;
		els.rewardEnabled.checked = Boolean(subject.rewardEnabled);
		els.rewardAmount.value = String(normalizeRewardAmount(subject.rewardAmount));
		els.rewardLabel.value = normalizeRewardLabel(subject.rewardLabel);
		syncRewardFields();
		return;
	}

	els.subject.value = state.subjectSettings[0]?.id || "";
	els.book.value = "";
	setSelectedScheduleDays([]);
	setTimeValue("");
	els.minimumStudyMinutes.value = "0";
	els.startDate.value = "";
	els.endDate.value = "";
	els.autoPlan.checked = false;
	els.rewardEnabled.checked = false;
	els.rewardAmount.value = "";
	els.rewardLabel.value = "포인트";
	syncRewardFields();
}

function getStateForSync() {
	let pending = [];
	try {
		pending = JSON.parse(localStorage.getItem(PENDING_MINIMUM_STUDY_KEY) || "[]");
	} catch {
		pending = [];
	}
	const pendingMinimumStudyUpdates = new Set(Array.isArray(pending) ? pending.map(String) : []);

	return {
		...state,
		subjectsByChild: Object.fromEntries(
			Object.entries(state.subjectsByChild || {}).map(([child, subjects]) => [
				child,
				Array.isArray(subjects)
					? subjects.map((subject) => ({
							...subject,
							minimumStudyMinutes: normalizeMinimumStudyMinutes(subject.minimumStudyMinutes),
							minimumStudyMinutesSource: pendingMinimumStudyUpdates.has(String(subject.id)) ? "book-dialog" : "",
						}))
					: [],
			]),
		),
	};
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
		body: JSON.stringify({ state: getStateForSync() }),
	});
	localStorage.removeItem(PENDING_MINIMUM_STUDY_KEY);
}

async function saveBook(event) {
	event.preventDefault();
	const child = els.child.value;
	const subjectSetting = state.subjectSettings.find((item) => item.id === els.subject.value);
	const book = els.book.value.trim();
	const scheduleDays = getSelectedScheduleDays();
	const scheduleTime = getTimeValue();
	const minimumStudyMinutes = normalizeMinimumStudyMinutes(els.minimumStudyMinutes.value);
	const startDate = els.startDate.value;
	const endDate = els.endDate.value;
	const rewardEnabled = Boolean(els.rewardEnabled.checked);
	const rewardAmount = rewardEnabled ? normalizeRewardAmount(els.rewardAmount.value) : 0;
	const rewardLabel = normalizeRewardLabel(els.rewardLabel.value);

	if (!child || !subjectSetting || !book) return setMessage("학생, 과목, 교재명을 입력하세요.", true);
	if (isInvalidPeriod(startDate, endDate)) return setMessage("교재 종료일은 시작일보다 빠를 수 없습니다.", true);
	if (els.autoPlan.checked && !canCreateAutoPlan(scheduleDays, startDate, endDate)) return setMessage("가계획을 생성하려면 요일과 기간을 입력하세요.", true);
	if (rewardEnabled && rewardAmount <= 0) return setMessage("보상 누적을 사용하려면 1 이상의 보상 값을 입력하세요.", true);

	try {
		els.submit.disabled = true;
		if (mode === "edit") {
			const subjects = state.subjectsByChild[activeChild] || [];
			const subject = subjects.find((item) => item.id === activeSubjectId);
			if (!subject) throw new Error("수정할 교재를 찾지 못했습니다.");
			subject.subjectSettingId = subjectSetting.id;
			subject.name = subjectSetting.name;
			subject.book = book;
			subject.scheduleDays = scheduleDays;
			subject.scheduleTime = scheduleTime;
			subject.minimumStudyMinutes = minimumStudyMinutes;
			subject.startDate = startDate;
			subject.endDate = endDate;
			subject.rewardEnabled = rewardEnabled;
			subject.rewardAmount = rewardAmount;
			subject.rewardLabel = rewardLabel;
			markPendingMinimumStudyUpdate(subject.id);
			if (els.autoPlan.checked) {
				deleteBlankPlanEntries(activeChild, subject.id);
				createAutoPlanEntries(activeChild, subject);
			}
		} else {
			const subject = {
				id: crypto.randomUUID(),
				subjectSettingId: subjectSetting.id,
				name: subjectSetting.name,
				book,
				scheduleDays,
				scheduleTime,
				minimumStudyMinutes,
				startDate,
				endDate,
				rewardEnabled,
				rewardAmount,
				rewardLabel,
			};
			state.subjectsByChild[child] ||= [];
			state.subjectsByChild[child].push(subject);
			markPendingMinimumStudyUpdate(subject.id);
			if (els.autoPlan.checked) createAutoPlanEntries(child, subject);
		}

		await saveRemoteState();
		setMessage(mode === "edit" ? "교재를 저장했습니다." : "교재를 등록했습니다.");
		setTimeout(() => {
			window.location.href = "./index.html";
		}, 350);
	} catch (error) {
		setMessage(error.message || "저장하지 못했습니다.", true);
	} finally {
		els.submit.disabled = false;
	}
}

renderSelectOptions();
els.form.addEventListener("submit", saveBook);
els.rewardEnabled.addEventListener("change", syncRewardFields);
loadState().catch((error) => setMessage(error.message || "교재 정보를 불러오지 못했습니다.", true));
