const LEGACY_STORAGE_KEY = "local-study-manager-v1";
const AUTH_TOKEN_KEY = "local-study-manager-token";
const AUTH_USER_KEY = "local-study-manager-user";
const AUTH_TOKEN_KEY_PREFIX = `${AUTH_TOKEN_KEY}:`;
const AUTH_USER_KEY_PREFIX = `${AUTH_USER_KEY}:`;
const MIGRATION_KEY_PREFIX = "local-study-manager-migration:";
const authSession = getSessionForRole("teacher");
const authToken = authSession.token;

if (!authToken) {
	window.location.replace("./login.html");
	throw new Error("Authentication required.");
}

const authUser = authSession.user;
const STORAGE_KEY = getAccountStorageKey();
const accountStateBeforeRemoteLoad = localStorage.getItem(STORAGE_KEY);
const legacyStateBeforeRemoteLoad = localStorage.getItem(LEGACY_STORAGE_KEY);

const DEFAULT_CHILDREN = ["재민", "지원", "정빈"];
const DEFAULT_SUBJECT_SETTINGS = [
	{ id: "subject-korean", name: "국어", color: "#ef6461" },
	{ id: "subject-math", name: "수학", color: "#2f78d4" },
	{ id: "subject-english", name: "영어", color: "#20a779" },
	{ id: "subject-science", name: "과학", color: "#8b5cf6" },
	{ id: "subject-social", name: "사회", color: "#f09a3e" },
];
const SUBJECT_COLOR_PALETTE = ["#ef6461", "#f09a3e", "#f6c445", "#20a779", "#14b8a6", "#2f78d4", "#5865f2", "#8b5cf6", "#d946ef", "#ec4899", "#64748b", "#795548"];
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

let state = loadState();
let children = getChildNamesFromState();
let weekStart = startOfWeek(new Date());
let activeEntry = null;
let activeCopy = null;
let activeBookEdit = null;
let activeChildEdit = null;
let activeSubjectSettingEdit = null;
let activeSubjectDragId = "";
let activeRewardResetChild = "";
let weekChildFilter = "all";
let weekSubjectFilter = "all";
let weekSearchQuery = "";
let syncStateTimer = null;
let isHydratingRemoteState = false;
let isForcingChildRegistration = false;

function getAuthUser() {
	try {
		return JSON.parse(localStorage.getItem(`${AUTH_USER_KEY_PREFIX}teacher`) || "{}");
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

function parseStoredUser(value) {
	try {
		return JSON.parse(value || "{}");
	} catch {
		return {};
	}
}

function getAccountStorageKey() {
	return `${LEGACY_STORAGE_KEY}:${authUser.id || authUser.email || "anonymous"}`;
}

const els = {
	profileName: document.querySelector("#profileName"),
	profileEmail: document.querySelector("#profileEmail"),
	logoutButton: document.querySelector("#logoutButton"),
	topbarThemeSlot: document.querySelector("#topbarThemeSlot"),
	weekRange: document.querySelector("#weekRange"),
	prevWeek: document.querySelector("#prevWeek"),
	nextWeek: document.querySelector("#nextWeek"),
	todayBtn: document.querySelector("#todayBtn"),
	weekChildFilter: document.querySelector("#weekChildFilter"),
	weekSubjectFilter: document.querySelector("#weekSubjectFilter"),
	weekSearch: document.querySelector("#weekSearch"),
	weekChildAdd: document.querySelector("#weekChildAdd"),
	subjectDialog: document.querySelector("#subjectDialog"),
	subjectForm: document.querySelector("#subjectForm"),
	subjectChild: document.querySelector("#subjectChild"),
	subjectName: document.querySelector("#subjectName"),
	bookName: document.querySelector("#bookName"),
	scheduleHour: document.querySelector("#scheduleHour"),
	scheduleMinute: document.querySelector("#scheduleMinute"),
	bookStartDate: document.querySelector("#bookStartDate"),
	bookEndDate: document.querySelector("#bookEndDate"),
	autoCreatePlan: document.querySelector("#autoCreatePlan"),
	rewardEnabled: document.querySelector("#rewardEnabled"),
	rewardAmount: document.querySelector("#rewardAmount"),
	rewardLabel: document.querySelector("#rewardLabel"),
	weeklyTable: document.querySelector("#weeklyTable"),
	summaryGrid: document.querySelector("#summaryGrid"),
	pageViews: document.querySelectorAll(".page-view"),
	navItems: document.querySelectorAll(".nav-item"),
	historySearch: document.querySelector("#historySearch"),
	historyChild: document.querySelector("#historyChild"),
	historySubjectSetting: document.querySelector("#historySubjectSetting"),
	historySubject: document.querySelector("#historySubject"),
	historyList: document.querySelector("#historyList"),
	pendingChild: document.querySelector("#pendingChild"),
	pendingSubjectSetting: document.querySelector("#pendingSubjectSetting"),
	pendingRange: document.querySelector("#pendingRange"),
	pendingList: document.querySelector("#pendingList"),
	statsContent: document.querySelector("#statsContent"),
	rewardHistoryContent: document.querySelector("#rewardHistoryContent"),
	mypageContent: document.querySelector("#mypageContent"),
	subjectsContent: document.querySelector("#subjectsContent"),
	subjectsSection: document.querySelector("#subjectsPage .mypage-section"),
	entryDialog: document.querySelector("#entryDialog"),
	entryForm: document.querySelector("#entryForm"),
	entryMeta: document.querySelector("#entryMeta"),
	entryTitle: document.querySelector("#entryTitle"),
	entryAmount: document.querySelector("#entryAmount"),
	entryMemo: document.querySelector("#entryMemo"),
	entryCompleted: document.querySelector("#entryCompleted"),
	closeEntryDialog: document.querySelector("#closeEntryDialog"),
	cancelEntryDialog: document.querySelector("#cancelEntryDialog"),
	deleteEntry: document.querySelector("#deleteEntry"),
	pushPlan: document.querySelector("#pushPlan"),
	pullPlan: document.querySelector("#pullPlan"),
	copyDialog: document.querySelector("#copyDialog"),
	copyForm: document.querySelector("#copyForm"),
	copyMeta: document.querySelector("#copyMeta"),
	copyTitle: document.querySelector("#copyTitle"),
	copyTargetChild: document.querySelector("#copyTargetChild"),
	copyStartDate: document.querySelector("#copyStartDate"),
	copyHelp: document.querySelector("#copyHelp"),
	bookDialog: document.querySelector("#bookDialog"),
	bookForm: document.querySelector("#bookForm"),
	bookMeta: document.querySelector("#bookMeta"),
	editSubjectName: document.querySelector("#editSubjectName"),
	editBookName: document.querySelector("#editBookName"),
	editScheduleHour: document.querySelector("#editScheduleHour"),
	editScheduleMinute: document.querySelector("#editScheduleMinute"),
	editBookStartDate: document.querySelector("#editBookStartDate"),
	editBookEndDate: document.querySelector("#editBookEndDate"),
	editRegeneratePlan: document.querySelector("#editRegeneratePlan"),
	editRewardEnabled: document.querySelector("#editRewardEnabled"),
	editRewardAmount: document.querySelector("#editRewardAmount"),
	editRewardLabel: document.querySelector("#editRewardLabel"),
	childAccountDialog: document.querySelector("#childAccountDialog"),
	childAccountForm: document.querySelector("#childAccountForm"),
	childAccountCancelButtons: document.querySelectorAll("#childAccountDialog .dialog-head .icon-btn, #childAccountDialog .dialog-actions button[value='cancel']"),
	childAccountMeta: document.querySelector("#childAccountMeta"),
	childAccountTitle: document.querySelector("#childAccountTitle"),
	childAccountName: document.querySelector("#childAccountName"),
	childBirthMonth: document.querySelector("#childBirthMonth"),
	childLoginId: document.querySelector("#childLoginId"),
	childLoginIdHelp: document.querySelector("#childLoginIdHelp"),
	childPassword: document.querySelector("#childPassword"),
	childPasswordConfirm: document.querySelector("#childPasswordConfirm"),
	verifyChildLoginId: document.querySelector("#verifyChildLoginId"),
	saveChildAccount: document.querySelector("#saveChildAccount"),
	subjectSettingDialog: document.querySelector("#subjectSettingDialog"),
	subjectSettingForm: document.querySelector("#subjectSettingForm"),
	subjectSettingMeta: document.querySelector("#subjectSettingMeta"),
	subjectSettingTitle: document.querySelector("#subjectSettingTitle"),
	subjectSettingName: document.querySelector("#subjectSettingName"),
	subjectSettingColorField: document.querySelector("#subjectSettingColorField"),
	saveSubjectSetting: document.querySelector("#saveSubjectSetting"),
	timetableDialog: document.querySelector("#timetableDialog"),
	timetableMeta: document.querySelector("#timetableMeta"),
	timetableTitle: document.querySelector("#timetableTitle"),
	timetableContent: document.querySelector("#timetableContent"),
	closeTimetable: document.querySelector("#closeTimetable"),
	printTimetable: document.querySelector("#printTimetable"),
	rewardResetDialog: document.querySelector("#rewardResetDialog"),
	rewardResetForm: document.querySelector("#rewardResetForm"),
	rewardResetMeta: document.querySelector("#rewardResetMeta"),
	rewardResetSummary: document.querySelector("#rewardResetSummary"),
	rewardResetList: document.querySelector("#rewardResetList"),
};

function loadState() {
	const raw = localStorage.getItem(STORAGE_KEY);
	if (!raw) return createDefaultState();
	try {
		const parsed = JSON.parse(raw);
		return normalizeState(parsed);
	} catch {
		return createDefaultState();
	}
}

function createDefaultState() {
	return {
		profile: {
			name: authUser.name || "학습 관리자",
			email: authUser.email || "manager@example.com",
			password: "",
			phone: authUser.phone || "",
			marketingConsent: Boolean(authUser.marketingConsent),
		},
		childAccounts: [],
		subjectsByChild: {},
		subjectSettings: [],
		entries: {},
	};
}

function normalizeState(value) {
	const profile = normalizeProfile(value.profile);
	const entries = value.entries && typeof value.entries === "object" ? value.entries : {};
	const childAccounts = normalizeChildAccounts(value);
	const childNames = childAccounts.map((account) => account.name);
	const subjectsByChild = Object.fromEntries(childNames.map((child) => [child, []]));

	if (value.subjectsByChild && typeof value.subjectsByChild === "object") {
		childNames.forEach((child) => {
			subjectsByChild[child] = Array.isArray(value.subjectsByChild[child]) ? value.subjectsByChild[child].map(normalizeSubject) : [];
		});
	} else if (Array.isArray(value.subjects)) {
		childNames.forEach((child) => {
			subjectsByChild[child] = value.subjects.map(normalizeSubject);
		});
	}

	const subjectSettings = normalizeSubjectSettings(value.subjectSettings, subjectsByChild);
	assignSubjectSettingsToBooks(subjectsByChild, subjectSettings);

	return { profile, childAccounts, subjectsByChild, subjectSettings, entries };
}

function normalizeProfile(profile) {
	return {
		name: profile?.name || "학습 관리자",
		email: profile?.email || "manager@example.com",
		password: profile?.password || "",
		phone: profile?.phone || "",
		marketingConsent: Boolean(profile?.marketingConsent),
	};
}

function normalizeChildAccounts(value) {
	const savedAccounts = Array.isArray(value.childAccounts) ? value.childAccounts : [];
	const names = [...savedAccounts.map((account) => account?.name), ...Object.keys(value.subjectsByChild || {})].map((name) => String(name || "").trim()).filter(Boolean);
	const uniqueNames = [...new Set(names)];

	return sortChildAccountsByBirth(
		uniqueNames.map((name) => {
			const saved = savedAccounts.find((account) => account?.name === name) || {};
			return {
				id: saved.id || crypto.randomUUID(),
				name,
				birthMonth: saved.birthMonth || "",
				loginId: saved.loginId || "",
				password: saved.password || "",
			};
		}),
	);
}

function getChildNamesFromState() {
	return state.childAccounts.map((account) => account.name);
}

function sortChildAccountsByBirth(accounts) {
	return [...accounts].sort((a, b) => {
		const byBirth = normalizeBirthValue(a.birthMonth).localeCompare(normalizeBirthValue(b.birthMonth));
		const emptyBirth = Number(!a.birthMonth) - Number(!b.birthMonth);
		return emptyBirth || byBirth || a.name.localeCompare(b.name, "ko-KR");
	});
}

function normalizeSubject(subject) {
	return {
		id: subject.id || crypto.randomUUID(),
		subjectSettingId: subject.subjectSettingId ?? subject.subject_setting_id ?? "",
		name: subject.name || "",
		book: subject.book || "",
		scheduleDays: Array.isArray(subject.scheduleDays) ? subject.scheduleDays : subject.schedule_days || [],
		scheduleTime: normalizeScheduleTime(subject.scheduleTime ?? subject.schedule_time),
		startDate: subject.startDate ?? subject.start_date ?? "",
		endDate: subject.endDate ?? subject.end_date ?? "",
		rewardEnabled: Boolean(subject.rewardEnabled ?? subject.reward_enabled),
		rewardAmount: normalizeRewardAmount(subject.rewardAmount ?? subject.reward_amount),
		rewardLabel: normalizeRewardLabel(subject.rewardLabel ?? subject.reward_label),
	};
}

function normalizeSubjectSettings(settings, subjectsByChild = {}) {
	const savedSettings = Array.isArray(settings) ? settings : [];
	const bookNames = Object.values(subjectsByChild)
		.flat()
		.map((subject) => subject?.name);
	const mergedNames = [...savedSettings.map((subject) => subject?.name), ...bookNames].map((name) => String(name || "").trim()).filter(Boolean);
	const uniqueNames = [...new Set(mergedNames)];

	return uniqueNames.map((name, index) => {
		const saved = savedSettings.find((subject) => subject?.name === name);
		const preset = DEFAULT_SUBJECT_SETTINGS.find((subject) => subject.name === name);
		return {
			id: saved?.id || preset?.id || crypto.randomUUID(),
			name,
			color: normalizeColor(saved?.color || preset?.color || pickSubjectColor(index)),
		};
	});
}

function assignSubjectSettingsToBooks(subjectsByChild, subjectSettings) {
	const settingsById = new Map(subjectSettings.map((subject) => [subject.id, subject]));
	const settingsByName = new Map(subjectSettings.map((subject) => [subject.name, subject]));

	Object.values(subjectsByChild).forEach((subjects) => {
		subjects.forEach((subject) => {
			const setting = settingsById.get(subject.subjectSettingId) || settingsByName.get(subject.name);
			if (!setting) return;
			subject.subjectSettingId = setting.id;
			subject.name = setting.name;
		});
	});
}

function saveState(options = {}) {
	localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
	if (options.sync !== false) scheduleRemoteStateSync();
}

function closeBookMenus() {
	document.querySelectorAll(".book-menu:not([hidden])").forEach((menu) => {
		menu.setAttribute("hidden", "");
		menu.style.left = "";
		menu.style.right = "";
		menu.style.top = "";
		menu.style.position = "";
	});
}

function openBookMenu(menuButton) {
	const menu = menuButton.nextElementSibling;
	if (!menu) return;
	closeBookMenus();
	menu.removeAttribute("hidden");
	menu.style.position = "fixed";
	menu.style.right = "auto";

	const buttonRect = menuButton.getBoundingClientRect();
	const menuRect = menu.getBoundingClientRect();
	const gap = 4;
	const left = Math.min(Math.max(8, buttonRect.right - menuRect.width), window.innerWidth - menuRect.width - 8);
	const opensUp = buttonRect.bottom + gap + menuRect.height > window.innerHeight && buttonRect.top - gap - menuRect.height > 8;
	const top = opensUp ? buttonRect.top - gap - menuRect.height : Math.min(buttonRect.bottom + gap, window.innerHeight - menuRect.height - 8);

	menu.style.left = `${left}px`;
	menu.style.top = `${Math.max(8, top)}px`;
}

function getStateForSync() {
	return {
		...state,
		subjectsByChild: Object.fromEntries(
			Object.entries(state.subjectsByChild || {}).map(([child, subjects]) => [
				child,
				Array.isArray(subjects)
					? subjects.map((subject) => {
							const scheduleTime = normalizeScheduleTime(subject.scheduleTime ?? subject.schedule_time);
							const scheduleDays = Array.isArray(subject.scheduleDays) ? subject.scheduleDays : subject.schedule_days || [];
							return {
								...subject,
								subjectSettingId: subject.subjectSettingId ?? subject.subject_setting_id ?? "",
								scheduleDays,
								scheduleTime,
								startDate: subject.startDate ?? subject.start_date ?? "",
								endDate: subject.endDate ?? subject.end_date ?? "",
								rewardEnabled: Boolean(subject.rewardEnabled ?? subject.reward_enabled),
								rewardAmount: normalizeRewardAmount(subject.rewardAmount ?? subject.reward_amount),
								rewardLabel: normalizeRewardLabel(subject.rewardLabel ?? subject.reward_label),
								subject_setting_id: subject.subjectSettingId ?? subject.subject_setting_id ?? "",
								schedule_days: scheduleDays,
								schedule_time: scheduleTime,
								start_date: subject.startDate ?? subject.start_date ?? "",
								end_date: subject.endDate ?? subject.end_date ?? "",
								reward_enabled: Boolean(subject.rewardEnabled ?? subject.reward_enabled),
								reward_amount: normalizeRewardAmount(subject.rewardAmount ?? subject.reward_amount),
								reward_label: normalizeRewardLabel(subject.rewardLabel ?? subject.reward_label),
							};
						})
					: [],
			]),
		),
	};
}

function scheduleRemoteStateSync() {
	if (isHydratingRemoteState) return;
	setSyncStatus("저장 대기 중");
	clearTimeout(syncStateTimer);
	syncStateTimer = setTimeout(syncRemoteState, 350);
}

async function syncRemoteState() {
	try {
		setSyncStatus("서버에 저장 중");
		const response = await fetch("/api/state", {
			method: "PUT",
			headers: {
				Authorization: `Bearer ${authToken}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ state: getStateForSync() }),
		});
		if (!isJsonResponse(response)) throw new Error("StudyFlow API 응답이 아닙니다.");

		if (response.status === 401) {
			logout();
			return;
		}

		if (!response.ok) {
			setSyncStatus("저장 실패", true);
			console.warn("Failed to sync study state.");
			return false;
		}
		clearSensitiveFields();
		setSyncStatus("서버에 저장됨");
		return true;
	} catch (error) {
		setSyncStatus("저장 실패", true);
		console.warn("Failed to sync study state.", error);
		return false;
	}
}

async function syncTeacherEntry(entry) {
	try {
		setSyncStatus("학습 기록 저장 중");
		const response = await fetch("/api/state/entries", {
			method: "PUT",
			headers: {
				Authorization: `Bearer ${authToken}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify(entry),
		});
		if (!isJsonResponse(response)) throw new Error("StudyFlow API 응답이 아닙니다.");
		const data = await response.json().catch(() => ({}));

		if (!response.ok) throw new Error(data.message || "학습 기록 저장 실패");

		if (data.entry) {
			delete state.entries[entry.key];
			state.entries[data.entry.key] = data.entry;
			localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
		}
		setSyncStatus("학습 기록 저장 완료");
	} catch (error) {
		setSyncStatus("학습 기록 저장 실패", true);
		console.warn("Failed to save entry.", error);
	}
}

function isEmptyRemoteState(remoteState) {
	return !remoteState || (!remoteState.childAccounts?.length && !remoteState.subjectSettings?.length && Object.keys(remoteState.entries || {}).length === 0);
}

function isJsonResponse(response) {
	return (response.headers.get("content-type") || "").includes("application/json");
}

async function loadRemoteState() {
	try {
		setSyncStatus("서버 데이터 불러오는 중");
		const response = await fetch("/api/state", {
			headers: {
				Authorization: `Bearer ${authToken}`,
			},
		});
		if (!isJsonResponse(response)) throw new Error("StudyFlow API 응답이 아닙니다.");

		if (response.status === 401) {
			logout();
			return;
		}

		if (!response.ok) {
			setSyncStatus("서버 데이터 불러오기 실패", true);
			return;
		}

		const data = await response.json();

		if (isEmptyRemoteState(data.state)) {
			await handleInitialMigration();
			return;
		}

		isHydratingRemoteState = true;
		state = normalizeState(data.state);
		children = getChildNamesFromState();
		localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
		render();
		promptForRequiredChildRegistration();
		setSyncStatus("서버 데이터 불러옴");
	} catch (error) {
		setSyncStatus("서버 데이터 불러오기 실패", true);
		console.warn("Failed to load remote study state.", error);
	} finally {
		isHydratingRemoteState = false;
	}
}

async function handleInitialMigration() {
	const migrationKey = getMigrationKey();
	const alreadyHandled = localStorage.getItem(migrationKey);
	const hasAccountData = hasMeaningfulStoredState(accountStateBeforeRemoteLoad);
	const hasLegacyData = hasMeaningfulStoredState(legacyStateBeforeRemoteLoad);

	if (!alreadyHandled && hasAccountData) {
		const shouldUpload = confirm("이 계정의 브라우저 캐시 데이터를 서버 DB로 옮길까요?");
		localStorage.setItem(migrationKey, shouldUpload ? "uploaded-account-cache" : "skipped-account-cache");

		if (shouldUpload) {
			await syncRemoteState();
			return;
		}
	}

	if (!localStorage.getItem(migrationKey) && hasLegacyData) {
		const shouldUpload = confirm("이 브라우저에 저장된 기존 공용 학습 데이터를 이 계정의 서버 DB로 옮길까요?");
		localStorage.setItem(migrationKey, shouldUpload ? "uploaded" : "skipped");

		if (shouldUpload) {
			state = normalizeState(JSON.parse(legacyStateBeforeRemoteLoad));
			children = getChildNamesFromState();
			localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
			render();
			await syncRemoteState();
			return;
		}
	}

	state = createDefaultState();
	children = getChildNamesFromState();
	localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
	render();
	promptForRequiredChildRegistration();
	setSyncStatus("서버에 저장된 학습 데이터가 없습니다");
}

function promptForRequiredChildRegistration() {
	if (state.childAccounts.length > 0 || els.childAccountDialog.open) return;
	openChildAccountDialog("", { required: true });
}

function getMigrationKey() {
	return `${MIGRATION_KEY_PREFIX}${authUser.id || authUser.email || "unknown"}`;
}

function hasMeaningfulStoredState(raw) {
	if (!raw) return false;
	try {
		const value = JSON.parse(raw);
		return Boolean(value?.childAccounts?.length || value?.subjectSettings?.length || Object.keys(value?.subjectsByChild || {}).length || Object.keys(value?.entries || {}).length);
	} catch {
		return false;
	}
}

function clearSensitiveFields() {
	let changed = false;
	state.childAccounts.forEach((account) => {
		if (account.password) {
			account.password = "";
			changed = true;
		}
	});
	if (state.profile.password) {
		state.profile.password = "";
		changed = true;
	}
	if (changed) {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
	}
}

function setSyncStatus(text, isError = false) {
	if (isError) console.warn(`[StudyFlow Sync] ${text}`);
}

function logout() {
	localStorage.removeItem(`${AUTH_TOKEN_KEY_PREFIX}teacher`);
	localStorage.removeItem(`${AUTH_USER_KEY_PREFIX}teacher`);
	localStorage.removeItem(AUTH_TOKEN_KEY);
	localStorage.removeItem(AUTH_USER_KEY);
	window.location.href = "./login.html";
}

function startOfWeek(date) {
	const copy = new Date(date);
	copy.setHours(0, 0, 0, 0);
	const day = copy.getDay() || 7;
	copy.setDate(copy.getDate() - day + 1);
	return copy;
}

function addDays(date, days) {
	const copy = new Date(date);
	copy.setDate(copy.getDate() + days);
	return copy;
}

function formatDate(date) {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
}

function displayDate(date) {
	return new Intl.DateTimeFormat("ko-KR", {
		month: "short",
		day: "numeric",
	}).format(date);
}

function entryKey(child, subjectId, date) {
	return `${child}__${subjectId}__${date}`;
}

function getWeekDates() {
	return Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
}

function getEntriesForCurrentWeek() {
	const weekStartText = formatDate(weekStart);
	const weekEndText = formatDate(addDays(weekStart, 6));
	return Object.values(state.entries).filter((entry) => entry.date >= weekStartText && entry.date <= weekEndText);
}

function getVisibleChildren() {
	const filteredChildren = weekChildFilter === "all" ? children : children.filter((child) => child === weekChildFilter);
	if (!weekSearchQuery) return filteredChildren;
	return filteredChildren.filter((child) => childMatchesWeekSearch(child));
}

function getVisibleSubjectsForChild(child) {
	const activeSubjects = getActiveSubjectsForChild(child);
	const subjectFiltered = weekSubjectFilter === "all" ? activeSubjects : activeSubjects.filter((subject) => getSubjectSetting(subject)?.id === weekSubjectFilter);
	if (!weekSearchQuery) return subjectFiltered;
	if (child.toLowerCase().includes(weekSearchQuery)) return subjectFiltered;
	return subjectFiltered.filter((subject) => subjectMatchesWeekSearch(subject));
}

function getVisibleEntriesForChildInWeek(child, dates) {
	return Object.values(state.entries).filter((entry) => {
		if (entry.child !== child || !dates.includes(entry.date)) return false;
		const subject = getSubjectForEntry(entry);
		if (weekSubjectFilter !== "all" && getSubjectSetting(subject)?.id !== weekSubjectFilter) return false;
		if (!weekSearchQuery || child.toLowerCase().includes(weekSearchQuery)) return true;
		return subject ? subjectMatchesWeekSearch(subject) : false;
	});
}

function childMatchesWeekSearch(child) {
	const query = weekSearchQuery;
	if (child.toLowerCase().includes(query)) return true;
	return getVisibleSubjectsForChild(child).length > 0;
}

function subjectMatchesWeekSearch(subject) {
	const query = weekSearchQuery;
	return [subject.name, subject.book, formatSchedule(subject), formatBookPeriod(subject)].some((value) =>
		String(value || "")
			.toLowerCase()
			.includes(query),
	);
}

function render() {
	renderProfile();
	renderWeekRange();
	renderWeekChildFilter();
	renderWeekSubjectFilter();
	renderSubjectChildSelect();
	renderSubjectDropdowns();
	renderTimeSelects();
	renderSubjectFilters();
	renderPendingFilters();
	renderSummary();
	renderTable();
	renderHistory();
	renderPendingPlans();
	renderStats();
	renderRewardHistory();
	renderMyPage();
	renderSubjectsPage();
}

function renderProfile() {
	if (!els.profileName || !els.profileEmail) return;
	els.profileName.textContent = state.profile.name;
	els.profileEmail.textContent = state.profile.email;
}

function showPage(page) {
	els.pageViews.forEach((view) => {
		view.classList.toggle("active", view.dataset.page === page);
	});
	if (els.topbarThemeSlot) {
		els.topbarThemeSlot.hidden = page !== "mypage";
	}
	const navPage = page === "subjects" ? "mypage" : page;
	els.navItems.forEach((item) => {
		item.classList.toggle("active", item.dataset.targetPage === navPage);
	});
}

function renderWeekRange() {
	const weekEnd = addDays(weekStart, 6);
	els.weekRange.textContent = `${formatDate(weekStart)} ~ ${formatDate(weekEnd)}`;
}

function renderWeekChildFilter() {
	const current = weekChildFilter;
	els.weekChildFilter.innerHTML = `<option value="all">전체 학생</option>${children.map((child) => `<option value="${child}">${child}</option>`).join("")}`;
	els.weekChildFilter.value = children.includes(current) ? current : "all";
}

function renderWeekSubjectFilter() {
	const current = weekSubjectFilter;
	els.weekSubjectFilter.innerHTML = `<option value="all">전체 과목</option>${state.subjectSettings.map((subject) => `<option value="${escapeHtml(subject.id)}">${escapeHtml(subject.name)}</option>`).join("")}`;
	els.weekSubjectFilter.value = state.subjectSettings.some((subject) => subject.id === current) ? current : "all";
}

function renderSubjectFilters() {
	const childValue = els.historyChild.value || "all";
	const subjectSettingValue = els.historySubjectSetting.value || "all";
	const subjectValue = els.historySubject.value || "all";
	const subjects = getAllSubjects();

	els.historyChild.innerHTML = `<option value="all">전체 학생</option>${children.map((child) => `<option value="${child}">${child}</option>`).join("")}`;
	els.historySubjectSetting.innerHTML = `<option value="all">전체 과목</option>${state.subjectSettings.map((subject) => `<option value="${escapeHtml(subject.id)}">${escapeHtml(subject.name)}</option>`).join("")}`;
	els.historySubject.innerHTML = `<option value="all">전체 교재</option>${subjects
		.map(({ child, subject }) => `<option value="${child}__${subject.id}">${escapeHtml(child)} · ${escapeHtml(subject.name)} / ${escapeHtml(subject.book)}</option>`)
		.join("")}`;

	els.historyChild.value = children.includes(childValue) ? childValue : "all";
	els.historySubjectSetting.value = state.subjectSettings.some((subject) => subject.id === subjectSettingValue) ? subjectSettingValue : "all";
	els.historySubject.value = subjects.some(({ child, subject }) => `${child}__${subject.id}` === subjectValue) ? subjectValue : "all";
}

function renderPendingFilters() {
	if (!els.pendingChild) return;
	const childValue = els.pendingChild.value || "all";
	const subjectSettingValue = els.pendingSubjectSetting.value || "all";

	els.pendingChild.innerHTML = `<option value="all">전체 학생</option>${children.map((child) => `<option value="${escapeHtml(child)}">${escapeHtml(child)}</option>`).join("")}`;
	els.pendingSubjectSetting.innerHTML = `<option value="all">전체 과목</option>${state.subjectSettings.map((subject) => `<option value="${escapeHtml(subject.id)}">${escapeHtml(subject.name)}</option>`).join("")}`;

	els.pendingChild.value = children.includes(childValue) ? childValue : "all";
	els.pendingSubjectSetting.value = state.subjectSettings.some((subject) => subject.id === subjectSettingValue) ? subjectSettingValue : "all";
}

function renderSubjectChildSelect() {
	const current = els.subjectChild.value || children[0];
	els.subjectChild.innerHTML = children.map((child) => `<option value="${child}">${child}</option>`).join("");
	els.subjectChild.value = children.includes(current) ? current : children[0];
}

function renderSubjectDropdowns() {
	const options = state.subjectSettings.map((subject) => `<option value="${escapeHtml(subject.id)}">${escapeHtml(subject.name)}</option>`).join("");
	[els.subjectName, els.editSubjectName].forEach((select) => {
		if (!select) return;
		const current = select.value;
		select.innerHTML = options || `<option value="">과목을 먼저 등록하세요</option>`;
		select.disabled = state.subjectSettings.length === 0;
		if (state.subjectSettings.some((subject) => subject.id === current)) {
			select.value = current;
		}
	});
}

function renderTimeSelects() {
	const hourOptions = `<option value="">시</option>${Array.from({ length: 17 }, (_, index) => index + 6)
		.map((hour) => `<option value="${String(hour).padStart(2, "0")}">${formatHourLabel(hour)}</option>`)
		.join("")}`;
	const minuteOptions = `<option value="">분</option>${Array.from({ length: 6 }, (_, index) => index * 10)
		.map((minute) => `<option value="${String(minute).padStart(2, "0")}">${String(minute).padStart(2, "0")}분</option>`)
		.join("")}`;

	[
		[els.scheduleHour, hourOptions],
		[els.editScheduleHour, hourOptions],
	].forEach(([select, options]) => {
		if (!select || select.options.length) return;
		select.innerHTML = options;
	});
	[
		[els.scheduleMinute, minuteOptions],
		[els.editScheduleMinute, minuteOptions],
	].forEach(([select, options]) => {
		if (!select || select.options.length) return;
		select.innerHTML = options;
	});
}

function renderSummary() {
	if (!els.summaryGrid) return;
	els.summaryGrid.innerHTML = "";
	const summaryBand = els.summaryGrid.closest(".summary-band");
	if (summaryBand) summaryBand.hidden = true;
}

function renderWeeklyChildHead(child, childSubjects, subjectGroups, dates) {
	const weekEntries = getVisibleEntriesForChildInWeek(child, dates.map(formatDate));
	const count = weekEntries.length;
	const subjectCount = subjectGroups.length;
	const bookCount = childSubjects.length;
	const rewardTotal = getRewardTotalForChild(child);
	const hasRewardTotal = rewardTotal.length > 0;
	const childAccount = state.childAccounts.find((account) => account.name === child);
	return `
    <div class="weekly-child-head">
      <div class="weekly-child-title">
        <div class="weekly-child-title-row">
          <strong>${escapeHtml(child)}</strong>
          <p>이번 주 기록 ${count}개 · 교재 ${bookCount}개 · 과목 ${subjectCount}개</p>
        </div>
        <p class="reward-summary">누적 보상 ${escapeHtml(formatRewardTotal(rewardTotal))}</p>
      </div>
      <div class="weekly-child-actions">
        <button type="button" data-weekly-open-book-dialog="${escapeHtml(child)}">교재 등록</button>
        <button class="ghost" type="button" data-weekly-child-edit="${escapeHtml(childAccount?.id || "")}" ${childAccount ? "" : "disabled"}>수정</button>
        <button class="ghost timetable-button" type="button" data-child="${escapeHtml(child)}">시간표 출력</button>
        <button class="ghost reward-reset-button" type="button" data-child="${escapeHtml(child)}" ${hasRewardTotal ? "" : "disabled"}>보상 지급 완료</button>
        <button class="danger" type="button" data-weekly-child-delete="${escapeHtml(childAccount?.id || "")}" ${childAccount ? "" : "disabled"}>삭제</button>
      </div>
    </div>
  `;
}

function renderTable() {
	if (getAllSubjects().length === 0) {
		els.weeklyTable.innerHTML = `<div class="empty-state">학생을 선택한 뒤 과목과 교재를 먼저 추가하세요.</div>`;
		return;
	}

	const dates = getWeekDates();
	const head = `
    <thead>
      <tr>
        <th>과목</th>
        <th>교재</th>
        ${dates.map((date, index) => `<th>${displayDate(date)} ${dayNames[index]}</th>`).join("")}
      </tr>
    </thead>
  `;

	const sections = getVisibleChildren()
		.map((child) => {
			const childSubjects = sortSubjectsForTable(getVisibleSubjectsForChild(child));
			const subjectGroups = groupSubjectsByName(childSubjects);

			if (childSubjects.length === 0) {
				return `
          <section class="weekly-child-section" aria-label="${escapeHtml(child)} 주간 학습">
            ${renderWeeklyChildHead(child, childSubjects, subjectGroups, dates)}
            <div class="weekly-child-table-wrap">
              <div class="empty-state compact">교재 기간을 확인하거나 새 교재를 등록하세요.</div>
            </div>
          </section>
        `;
			}

			const rows = subjectGroups
				.map((group) =>
					group.subjects
						.map((subject, groupIndex) => {
							const cells = dates
								.map((date) => {
									const dateKey = formatDate(date);
									const key = entryKey(child, subject.id, dateKey);
									const entry = state.entries[key];
									const amount = entry?.amount?.trim();
									const memo = entry?.memo?.trim();
									const completed = Boolean(entry?.completed);
									const planned = Boolean(entry && !completed && !amount && !memo);
									return `
                <td>
                  <button class="entry-cell ${entry ? "has-entry" : ""} ${completed ? "is-complete" : ""} ${planned ? "is-planned" : ""}" type="button"
                    data-child="${escapeHtml(child)}" data-subject-id="${escapeHtml(subject.id)}" data-date="${dateKey}">
                    ${
						entry
							? `<span class="entry-status-row">
                            ${completed ? `<span class="entry-status">완료</span>` : `<span class="entry-status pending">진행중</span>`}
                            ${entry.rewardAwarded ? `<span class="reward-badge">+${escapeHtml(formatReward(entry.rewardAmount, entry.rewardLabel))}</span>` : ""}
                          </span>
                          ${
								!planned
									? `<span class="entry-amount">${amount ? escapeHtml(amount) : "학습량 없음"}</span>
                          ${memo ? `<span class="entry-memo-mark" title="${escapeHtml(memo)}">✎ 메모</span>` : ""}`
									: ""
							}`
							: ""
					}
                  </button>
                </td>
              `;
								})
								.join("");

							return `
            <tr>
              ${
					groupIndex === 0
						? `<td class="subject-cell" rowspan="${group.subjects.length}" style="${escapeHtml(subjectAccentStyle(group.subjects[0]))}">
                      <div class="subject-name"><span class="subject-color-dot" aria-hidden="true"></span>${escapeHtml(group.name)}</div>
                    </td>`
						: ""
				}
              <td class="book-cell">
                <div class="book-title-row">
                  <span class="book-title">${escapeHtml(subject.book)}</span>
                  <div class="book-actions">
                    <button class="book-menu-btn" type="button" aria-label="${escapeHtml(child)} ${escapeHtml(subject.book)} 메뉴"
                      data-child="${escapeHtml(child)}" data-subject-id="${escapeHtml(subject.id)}">···</button>
                    <div class="book-menu" hidden>
                      <button class="edit-book" type="button" data-child="${escapeHtml(child)}" data-subject-id="${escapeHtml(subject.id)}">수정</button>
                      <button class="copy-book" type="button" data-child="${escapeHtml(child)}" data-subject-id="${escapeHtml(subject.id)}">복사</button>
                      <button class="delete-book" type="button" data-child="${escapeHtml(child)}" data-subject-id="${escapeHtml(subject.id)}">삭제</button>
                    </div>
                  </div>
                </div>
                <span class="book-schedule">${escapeHtml(formatSchedule(subject))}</span>
                <span class="book-period">${escapeHtml(formatBookPeriod(subject))}</span>
              </td>
              ${cells}
            </tr>
          `;
						})
						.join(""),
				)
				.join("");

			return `
        <section class="weekly-child-section" aria-label="${escapeHtml(child)} 주간 학습">
          ${renderWeeklyChildHead(child, childSubjects, subjectGroups, dates)}
          <div class="weekly-child-table-wrap">
            <table class="weekly-child-table">${head}<tbody>${rows}</tbody></table>
          </div>
        </section>
      `;
		})
		.join("");

	els.weeklyTable.innerHTML = sections ? `<div class="weekly-child-sections">${sections}</div>` : `<div class="empty-state">검색 조건에 맞는 학생이나 교재가 없습니다.</div>`;
}
function renderHistory() {
	const search = els.historySearch.value.trim().toLowerCase();
	const childFilter = els.historyChild.value;
	const subjectSettingFilter = els.historySubjectSetting.value;
	const subjectFilter = els.historySubject.value;

	const entries = Object.values(state.entries)
		.filter((entry) => {
			const subject = getSubjectForEntry(entry);
			if (!subject) return false;
			if (childFilter !== "all" && entry.child !== childFilter) return false;
			if (subjectSettingFilter !== "all" && getSubjectSetting(subject)?.id !== subjectSettingFilter) return false;
			if (subjectFilter !== "all" && `${entry.child}__${entry.subjectId}` !== subjectFilter) return false;
			if (!search) return true;
			return [entry.child, subject.name, subject.book, formatSchedule(subject), entry.amount, entry.memo, entry.date].join(" ").toLowerCase().includes(search);
		})
		.sort((a, b) => b.date.localeCompare(a.date))
		.slice(0, 80);

	if (entries.length === 0) {
		els.historyList.innerHTML = `<div class="empty-state">검색된 기록이 없습니다.</div>`;
		return;
	}

	els.historyList.innerHTML = entries
		.map((entry) => {
			const subject = getSubjectForEntry(entry);
			return `
        <article class="history-item">
          <strong><span class="subject-color-dot" style="${escapeHtml(subjectDotStyle(subject))}" aria-hidden="true"></span>${entry.date} · ${entry.child} · ${escapeHtml(subject.name)}</strong>
          <p>${escapeHtml(subject.book)} · ${escapeHtml(entry.amount || "학습량 미입력")}</p>
          ${entry.memo ? `<p>${escapeHtml(entry.memo)}</p>` : ""}
        </article>
      `;
		})
		.join("");
}

function renderPendingPlans() {
	if (!els.pendingList) return;
	const plans = getPendingPlans();

	if (!plans.length) {
		els.pendingList.innerHTML = `<div class="empty-state">조건에 맞는 미완료 계획이 없습니다.</div>`;
		return;
	}

	els.pendingList.innerHTML = plans
		.map(
			({ child, subject, date, entry, isOverdue }) => `
      <article class="pending-plan-item ${isOverdue ? "is-overdue" : ""}">
        <div>
          <strong><span class="subject-color-dot" style="${escapeHtml(subjectDotStyle(subject))}" aria-hidden="true"></span>${escapeHtml(child)} · ${escapeHtml(subject.name)} · ${escapeHtml(subject.book)}</strong>
          <p>${escapeHtml(date)} · ${escapeHtml(formatSchedule(subject))}</p>
          ${entry?.memo ? `<p>${escapeHtml(entry.memo)}</p>` : ""}
        </div>
        <div class="pending-plan-actions">
          ${isOverdue ? `<span class="overdue-badge">지남</span>` : `<span class="today-badge">예정</span>`}
          <button class="ghost pending-open-entry" type="button" data-child="${escapeHtml(child)}" data-subject-id="${escapeHtml(subject.id)}" data-date="${escapeHtml(date)}">기록</button>
        </div>
      </article>
    `,
		)
		.join("");
}

function getPendingPlans() {
	const childFilter = els.pendingChild?.value || "all";
	const subjectSettingFilter = els.pendingSubjectSetting?.value || "all";
	const range = els.pendingRange?.value || "due";
	const todayText = formatDate(new Date());
	const weekStartText = formatDate(weekStart);
	const weekEndText = formatDate(addDays(weekStart, 6));
	const plans = [];

	children.forEach((child) => {
		if (childFilter !== "all" && child !== childFilter) return;
		getSubjectsForChild(child).forEach((subject) => {
			if (subjectSettingFilter !== "all" && getSubjectSetting(subject)?.id !== subjectSettingFilter) return;
			getPlannedDatesForSubject(subject).forEach((date) => {
				if (range === "due" && date > todayText) return;
				if (range === "week" && (date < weekStartText || date > weekEndText)) return;
				const key = entryKey(child, subject.id, date);
				const entry = state.entries[key] || null;
				if (entry?.completed) return;
				plans.push({
					child,
					subject,
					date,
					entry,
					isOverdue: date < todayText,
				});
			});
		});
	});

	return plans.sort((a, b) => a.date.localeCompare(b.date) || a.child.localeCompare(b.child, "ko-KR") || getSubjectSettingOrder(a.subject) - getSubjectSettingOrder(b.subject));
}

function getPlannedDatesForSubject(subject) {
	const start = subject.startDate || formatDate(weekStart);
	const end = subject.endDate || formatDate(addDays(weekStart, 6));
	const plannedDays = new Set((subject.scheduleDays || []).map((day) => scheduleDayIndexes.get(day)).filter((dayIndex) => dayIndex !== undefined));
	const dates = new Set(
		Object.values(state.entries || {})
			.filter((entry) => entry.subjectId === subject.id)
			.map((entry) => entry.date),
	);

	if (plannedDays.size && start && end && start <= end) {
		const cursor = parseDate(start);
		const endDate = parseDate(end);
		while (cursor <= endDate) {
			if (plannedDays.has(cursor.getDay())) dates.add(formatDate(cursor));
			cursor.setDate(cursor.getDate() + 1);
		}
	}

	return [...dates].filter((date) => isSubjectActiveOnDate(subject, date)).sort();
}

function renderStats() {
	const entries = Object.values(state.entries);
	const weekEntries = getEntriesForCurrentWeek();
	const completedWeekEntries = weekEntries.filter((entry) => entry.completed);
	const totalActiveBooks = children.reduce((count, child) => count + getActiveSubjectsForChild(child).length, 0);
	const weeklyCompletionRate = weekEntries.length ? Math.round((completedWeekEntries.length / weekEntries.length) * 100) : 0;
	const activeChildCount = new Set(weekEntries.map((entry) => entry.child)).size;

	els.statsContent.innerHTML = `
    <div class="page-tools">
      <div class="week-nav-box">
        <button class="week-nav-btn" type="button" data-stats-week="-1" aria-label="이전 주">‹</button>
        <strong>${getCurrentWeekRangeText()}</strong>
        <button class="week-nav-btn" type="button" data-stats-week="1" aria-label="다음 주">›</button>
      </div>
      <button class="ghost" type="button" data-stats-today>이번 주</button>
    </div>

    <div class="stats-grid">
      <article class="stat-card">
        <span>이번 주 완료율</span>
        <strong>${weeklyCompletionRate}%</strong>
      </article>
      <article class="stat-card">
        <span>이번 주 기록</span>
        <strong>${weekEntries.length}</strong>
      </article>
      <article class="stat-card">
        <span>이번 주 참여 학생</span>
        <strong>${activeChildCount}</strong>
      </article>
      <article class="stat-card">
        <span>표시 중인 교재</span>
        <strong>${totalActiveBooks}</strong>
      </article>
    </div>

    <section class="stats-panel" aria-label="학생별 이번 주 기록">
      <div class="stats-panel-head">
        <h3>학생별 이번 주 기록</h3>
        <span>${escapeHtml(getCurrentWeekRangeText())}</span>
      </div>
      <div class="bar-list">
        ${children.map((child) => renderChildStatsBar(child, weekEntries)).join("")}
      </div>
    </section>

    <section class="stats-panel" aria-label="과목별 누적 기록">
      <div class="stats-panel-head">
        <h3>과목별 누적 기록</h3>
        <span>상위 6개</span>
      </div>
      <div class="subject-stat-list">
        ${renderSubjectStats(entries)}
      </div>
    </section>

    <section class="stats-panel" aria-label="최근 4주 학습 흐름">
      <div class="stats-panel-head">
        <h3>최근 4주 학습 흐름</h3>
        <span>기록 수 기준</span>
      </div>
      <div class="trend-grid">
        ${renderWeeklyTrend(entries)}
      </div>
    </section>
  `;
}

function renderRewardHistory() {
	const batches = getRewardRedemptionBatches();

	if (!batches.length) {
		els.rewardHistoryContent.innerHTML = `
      <div class="empty-state">아직 지급 완료 처리한 보상 이력이 없습니다.</div>
    `;
		return;
	}

	els.rewardHistoryContent.innerHTML = batches
		.map(
			(batch) => `
      <article class="reward-history-item">
        <div class="reward-history-head">
          <div>
            <strong>${escapeHtml(batch.child)}</strong>
            <p>${escapeHtml(formatDateTime(batch.redeemedAt))} 지급 완료 및 누적 보상 초기화</p>
          </div>
          <span class="reward-history-total">${escapeHtml(formatRewardTotal(batch.totals))}</span>
        </div>
        <div class="reward-history-detail">
          ${batch.entries
				.map((entry) => {
					const subject = getSubjectForEntry(entry);
					return `
                <div class="reward-history-row">
                  <span>${escapeHtml(entry.date)} · ${escapeHtml(subject?.name || "과목 없음")} · ${escapeHtml(subject?.book || "교재 없음")}</span>
                  <b>${escapeHtml(formatReward(entry.rewardAmount, entry.rewardLabel))}</b>
                </div>
              `;
				})
				.join("")}
        </div>
      </article>
    `,
		)
		.join("");
}

function renderChildStatsBar(child, weekEntries) {
	const childEntries = weekEntries.filter((entry) => entry.child === child);
	const completed = childEntries.filter((entry) => entry.completed).length;
	const rate = childEntries.length ? Math.round((completed / childEntries.length) * 100) : 0;

	return `
    <article class="bar-item">
      <div class="bar-meta">
        <strong>${escapeHtml(child)}</strong>
        <span>${childEntries.length}개 기록 · 완료 ${completed}개</span>
      </div>
      <div class="progress-track" aria-label="${escapeHtml(child)} 완료율 ${rate}%">
        <span style="width: ${rate}%"></span>
      </div>
      <b>${rate}%</b>
    </article>
  `;
}

function renderSubjectStats(entries) {
	const counts = entries.reduce((map, entry) => {
		const subject = getSubjectForEntry(entry);
		if (!subject) return map;
		const key = subject.name;
		const current = map.get(key) || {
			name: subject.name,
			color: getSubjectSetting(subject)?.color || "#2f78d4",
			count: 0,
			completed: 0,
		};
		current.count += 1;
		if (entry.completed) current.completed += 1;
		map.set(key, current);
		return map;
	}, new Map());
	const stats = [...counts.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "ko-KR")).slice(0, 6);

	if (stats.length === 0) {
		return `<div class="empty-state">과목별 통계를 만들 학습 기록이 없습니다.</div>`;
	}

	const maxCount = Math.max(...stats.map((item) => item.count));
	return stats
		.map((item) => {
			const width = Math.max(8, Math.round((item.count / maxCount) * 100));
			return `
        <article class="subject-stat-item">
          <div>
            <strong><span class="subject-color-dot" style="${escapeHtml(subjectDotStyle(item))}" aria-hidden="true"></span>${escapeHtml(item.name)}</strong>
            <span>${item.count}개 기록 · 완료 ${item.completed}개</span>
          </div>
          <div class="mini-track"><span style="width: ${width}%; background: ${escapeHtml(item.color)}"></span></div>
        </article>
      `;
		})
		.join("");
}

function renderWeeklyTrend(entries) {
	const weeks = Array.from({ length: 4 }, (_, index) => {
		const start = addDays(weekStart, (index - 3) * 7);
		const end = addDays(start, 6);
		const count = entries.filter((entry) => entry.date >= formatDate(start) && entry.date <= formatDate(end)).length;
		return { start, end, count };
	});
	const maxCount = Math.max(1, ...weeks.map((week) => week.count));

	return weeks
		.map((week) => {
			const height = Math.max(8, Math.round((week.count / maxCount) * 100));
			return `
        <article class="trend-item">
          <div class="trend-bar" aria-label="${escapeHtml(formatDate(week.start))} 주 기록 ${week.count}개">
            <span style="height: ${height}%"></span>
          </div>
          <strong>${week.count}개</strong>
          <p>${escapeHtml(displayDate(week.start))}~${escapeHtml(displayDate(week.end))}</p>
        </article>
      `;
		})
		.join("");
}

function renderMyPage() {
	const entries = Object.values(state.entries);
	const totalBooks = getAllSubjects().length;
	const totalEntries = entries.length;
	const completedEntries = entries.filter((entry) => entry.completed).length;
	const completionRate = totalEntries ? Math.round((completedEntries / totalEntries) * 100) : 0;
	const activeBooks = children.reduce((count, child) => count + getActiveSubjectsForChild(child).length, 0);

	els.mypageContent.innerHTML = `
    <div class="profile-panel">
      <div>
        <p class="eyebrow">Study Profile</p>
        <h3>${escapeHtml(state.profile.name)}</h3>
        <p>${escapeHtml(state.profile.email)}</p>
      </div>
      <div class="profile-panel-actions">
        <a class="profile-edit-button" href="./profile.html">내 정보 수정</a>
        <button class="ghost logout-button" type="button" data-logout-button>로그아웃</button>
      </div>
    </div>

    <div class="profile-panel">
      <div>
        <p class="eyebrow">Study Summary</p>
        <h3>전체 학생 학습 현황</h3>
        <p>현재 주간 범위 ${escapeHtml(getCurrentWeekRangeText())} 기준으로 표시 중인 교재와 전체 기록을 모았습니다.</p>
      </div>
      <div class="profile-summary-stats">
        <article>
          <span>등록 교재</span>
          <strong>${totalBooks}</strong>
        </article>
        <article>
          <span>이번 주 표시 교재</span>
          <strong>${activeBooks}</strong>
        </article>
        <article>
          <span>전체 학습 기록</span>
          <strong>${totalEntries}</strong>
        </article>
        <article>
          <span>완료율</span>
          <strong>${completionRate}%</strong>
        </article>
      </div>
    </div>

    <div class="mypage-entry-list">
      <button class="mypage-entry-card" type="button" data-target-page="subjects">
        <div class="mypage-entry-info">
          <strong>과목 설정</strong>
          <p>과목 ${state.subjectSettings.length}개 설정됨</p>
        </div>
        <span class="mypage-entry-arrow">›</span>
      </button>
    </div>
  `;

	if (typeof applyTheme === "function" && typeof getSavedTheme === "function") {
		applyTheme(getSavedTheme());
	}
}

function renderSubjectsPage() {
	els.subjectsContent.innerHTML = `
    <div class="subject-settings-list">
      ${state.subjectSettings.map(renderSubjectSettingItem).join("")}
    </div>
  `;
}

function renderSubjectSettingItem(subject, index) {
	const bookCount = getAllSubjects().filter(({ subject: book }) => book.subjectSettingId === subject.id || book.name === subject.name).length;
	const isFirst = index === 0;
	const isLast = index === state.subjectSettings.length - 1;
	return `
    <article class="subject-setting-item" draggable="true" data-subject-id="${escapeHtml(subject.id)}" style="${escapeHtml(subjectAccentStyle(subject))}">
      <div class="subject-setting-main">
        <span class="drag-handle" aria-hidden="true">⋮⋮</span>
        <span class="subject-color-dot" aria-hidden="true"></span>
        <strong>${escapeHtml(subject.name)}</strong>
        <span class="subject-book-count">${bookCount}개 교재</span>
      </div>
      <div class="subject-setting-actions">
        <button class="ghost order-button" type="button" data-subject-action="move-up" data-subject-id="${escapeHtml(subject.id)}" ${isFirst ? "disabled" : ""} aria-label="${escapeHtml(subject.name)} 순서 위로">↑</button>
        <button class="ghost order-button" type="button" data-subject-action="move-down" data-subject-id="${escapeHtml(subject.id)}" ${isLast ? "disabled" : ""} aria-label="${escapeHtml(subject.name)} 순서 아래로">↓</button>
        <button class="ghost" type="button" data-subject-action="edit" data-subject-id="${escapeHtml(subject.id)}">수정</button>
        <button class="danger" type="button" data-subject-action="delete" data-subject-id="${escapeHtml(subject.id)}">삭제</button>
      </div>
    </article>
  `;
}

function renderSubjectColorSwatches(label, selectedColor) {
	const selected = SUBJECT_COLOR_PALETTE.includes(normalizeColor(selectedColor)) ? normalizeColor(selectedColor) : pickSubjectColor(0);
	return `
    <fieldset class="color-field">
      ${label ? `<legend>${escapeHtml(label)}</legend>` : ""}
      <div class="color-swatch-grid">
        ${SUBJECT_COLOR_PALETTE.map((color) => {
			return `
            <label class="color-swatch" style="--swatch-color: ${escapeHtml(color)}" title="${escapeHtml(color)}">
              <input name="subjectColor" type="radio" value="${escapeHtml(color)}" ${color === selected ? "checked" : ""}>
              <span aria-hidden="true"></span>
              <span class="sr-only">${escapeHtml(color)}</span>
            </label>
          `;
		}).join("")}
      </div>
    </fieldset>
  `;
}

function openSubjectDialogForChild(child) {
	renderSubjectChildSelect();
	renderSubjectDropdowns();
	renderTimeSelects();
	if (els.rewardLabel && !els.rewardLabel.value.trim()) els.rewardLabel.value = "포인트";
	els.subjectChild.value = child;
	els.subjectDialog.showModal();
	focusDialogField(els.subjectChild);
}

function openChildAccountDialog(accountId = "", options = {}) {
	const account = state.childAccounts.find((item) => item.id === accountId);
	isForcingChildRegistration = Boolean(options.required && !account && state.childAccounts.length === 0);
	activeChildEdit = account ? { id: account.id, originalName: account.name } : null;
	els.childAccountMeta.textContent = account ? "Student Account Edit" : "Student Account";
	els.childAccountTitle.textContent = isForcingChildRegistration ? "첫 학생 등록" : account ? "학생 수정" : "학생 등록";
	els.childAccountDialog.classList.toggle("is-required-registration", isForcingChildRegistration);
	els.childAccountName.value = account?.name || "";
	els.childBirthMonth.value = toBirthInputValue(account?.birthMonth || "");
	els.childLoginId.value = account?.loginId || "";
	els.childLoginId.readOnly = Boolean(account?.loginId);
	els.childLoginId.classList.toggle("is-readonly", Boolean(account?.loginId));
	els.verifyChildLoginId.hidden = Boolean(account?.loginId);
	els.childLoginIdHelp.textContent = account?.loginId ? "학생 아이디는 한 번 설정하면 변경할 수 없습니다. 비밀번호만 재설정할 수 있습니다." : "학생 아이디는 선택 사항입니다. 비어 있으면 나중에 한 번 설정할 수 있습니다.";
	els.childPassword.value = "";
	els.childPasswordConfirm.value = "";
	els.saveChildAccount.textContent = account ? "저장" : "등록";
	els.childAccountCancelButtons.forEach((button) => {
		button.hidden = isForcingChildRegistration;
	});
	els.childAccountDialog.showModal();
	focusDialogField(els.childAccountName);
}

function saveChildAccount(event) {
	if (event.submitter?.value === "cancel") {
		if (isForcingChildRegistration) {
			event.preventDefault();
			focusDialogField(els.childAccountName);
			return;
		}
		activeChildEdit = null;
		return;
	}
	event.preventDefault();
	const name = els.childAccountName.value.trim();
	const birthMonth = els.childBirthMonth.value;
	const existingAccount = activeChildEdit ? state.childAccounts.find((item) => item.id === activeChildEdit.id) : null;
	const existingLoginId = existingAccount?.loginId || "";
	const loginId = existingLoginId || els.childLoginId.value.trim();
	const password = els.childPassword.value.trim();
	const passwordConfirm = els.childPasswordConfirm.value.trim();
	const editingId = activeChildEdit?.id || "";

	if (!name) return;
	if (state.childAccounts.some((account) => account.id !== editingId && account.name === name)) {
		alert("이미 등록된 학생 이름입니다.");
		return;
	}
	if (loginId && state.childAccounts.some((account) => account.id !== editingId && account.loginId === loginId)) {
		alert("이미 사용 중인 학생 아이디입니다.");
		return;
	}
	if (!existingLoginId && loginId && !password) {
		alert("학생 아이디를 새로 설정하려면 비밀번호도 함께 입력하세요.");
		focusDialogField(els.childPassword);
		return;
	}
	if (password || passwordConfirm) {
		if (!loginId) {
			alert("비밀번호를 설정하려면 학생 아이디를 먼저 입력하세요.");
			focusDialogField(els.childLoginId);
			return;
		}
		if (!password || !passwordConfirm) {
			alert("비밀번호와 비밀번호 확인을 모두 입력하세요.");
			return;
		}
		if (password !== passwordConfirm) {
			alert("비밀번호가 서로 일치하지 않습니다.");
			return;
		}
	}

	if (activeChildEdit) {
		const account = existingAccount;
		if (!account) return;
		renameChildData(activeChildEdit.originalName, name);
		account.name = name;
		account.birthMonth = birthMonth;
		account.loginId = existingLoginId || loginId;
		if (password) account.password = password;
	} else {
		state.childAccounts.push({
			id: crypto.randomUUID(),
			name,
			birthMonth,
			loginId,
			password,
		});
		state.subjectsByChild[name] = [];
	}

	state.childAccounts = sortChildAccountsByBirth(state.childAccounts);
	children = getChildNamesFromState();
	weekChildFilter = children.includes(weekChildFilter) ? weekChildFilter : "all";
	activeChildEdit = null;
	isForcingChildRegistration = false;
	els.childAccountDialog.classList.remove("is-required-registration");
	els.childAccountCancelButtons.forEach((button) => {
		button.hidden = false;
	});
	els.childAccountDialog.close();
	saveState();
	render();
}

function verifyChildLoginId() {
	if (activeChildEdit) {
		const account = state.childAccounts.find((item) => item.id === activeChildEdit.id);
		if (account?.loginId) {
			alert("이미 설정된 학생 아이디는 변경할 수 없습니다.");
			return;
		}
	}
	const loginId = els.childLoginId.value.trim();
	const editingId = activeChildEdit?.id || "";
	if (!loginId) {
		alert("확인할 학생 아이디를 입력하세요.");
		focusDialogField(els.childLoginId);
		return;
	}
	const isDuplicate = state.childAccounts.some((account) => account.id !== editingId && account.loginId === loginId);
	alert(isDuplicate ? "이미 사용 중인 학생 아이디입니다." : "사용할 수 있는 학생 아이디입니다.");
}

function renameChildData(oldName, newName) {
	if (oldName === newName) return;
	state.subjectsByChild[newName] = state.subjectsByChild[oldName] || [];
	delete state.subjectsByChild[oldName];
	Object.values(state.entries).forEach((entry) => {
		if (entry.child === oldName) {
			entry.child = newName;
			entry.key = entryKey(newName, entry.subjectId, entry.date);
		}
	});
	rebuildEntryKeys();
}

function deleteChildAccount(accountId) {
	const account = state.childAccounts.find((item) => item.id === accountId);
	if (!account) return;
	if (state.childAccounts.length <= 1) {
		alert("최소 한 명의 학생은 남겨두어야 합니다.");
		return;
	}
	const confirmed = confirm(`${account.name} 학생 계정을 삭제할까요?\n이 학생의 교재와 학습 기록도 함께 삭제됩니다.`);
	if (!confirmed) return;

	state.childAccounts = state.childAccounts.filter((item) => item.id !== accountId);
	delete state.subjectsByChild[account.name];
	Object.keys(state.entries).forEach((key) => {
		if (state.entries[key].child === account.name) {
			delete state.entries[key];
		}
	});
	children = getChildNamesFromState();
	weekChildFilter = children.includes(weekChildFilter) ? weekChildFilter : "all";
	saveState();
	render();
}

function openSubjectSettingDialog(subjectId = "") {
	const subject = getSubjectSettingById(subjectId);
	const color = subject?.color || pickSubjectColor(state.subjectSettings.length);
	activeSubjectSettingEdit = subject ? { id: subject.id, previousName: subject.name } : null;
	els.subjectSettingMeta.textContent = subject ? "Subject Edit" : "Subject Setup";
	els.subjectSettingTitle.textContent = subject ? "과목 수정" : "과목 추가";
	els.subjectSettingName.value = subject?.name || "";
	els.subjectSettingColorField.innerHTML = renderSubjectColorSwatches("색상", color);
	els.saveSubjectSetting.textContent = subject ? "저장" : "추가";
	els.subjectSettingDialog.showModal();
	focusDialogField(els.subjectSettingName);
}

function saveSubjectSetting(event) {
	if (event.submitter?.value === "cancel") {
		activeSubjectSettingEdit = null;
		return;
	}
	event.preventDefault();

	const subjectId = activeSubjectSettingEdit?.id || "";
	const subject = subjectId ? getSubjectSettingById(subjectId) : null;
	const previousName = activeSubjectSettingEdit?.previousName || "";
	const name = els.subjectSettingName.value.trim();
	const selectedColor = els.subjectSettingForm.elements.subjectColor?.value;
	const color = normalizeColor(selectedColor);
	if (!name) return;
	if (state.subjectSettings.some((item) => item.id !== subjectId && item.name === name)) {
		alert("이미 등록된 과목입니다.");
		return;
	}

	if (subject) {
		subject.name = name;
		subject.color = color;
		getAllSubjects().forEach(({ subject: book }) => {
			if (book.subjectSettingId === subjectId || book.name === previousName) {
				book.subjectSettingId = subjectId;
				book.name = name;
			}
		});
	} else {
		state.subjectSettings.push({
			id: crypto.randomUUID(),
			name,
			color,
		});
	}

	activeSubjectSettingEdit = null;
	els.subjectSettingDialog.close();
	saveState();
	render();
}

function deleteSubjectSetting(subjectId) {
	const subject = getSubjectSettingById(subjectId);
	if (!subject) return;
	const isUsed = getAllSubjects().some(({ subject: book }) => book.subjectSettingId === subjectId || book.name === subject.name);
	if (isUsed) {
		alert("이 과목을 사용하는 교재가 있어 삭제할 수 없습니다. 교재의 과목을 먼저 변경하세요.");
		return;
	}
	if (!confirm(`'${subject.name}' 과목을 삭제할까요?`)) return;

	state.subjectSettings = state.subjectSettings.filter((item) => item.id !== subjectId);
	saveState();
	render();
}

function moveSubjectSetting(subjectId, direction) {
	const index = state.subjectSettings.findIndex((subject) => subject.id === subjectId);
	if (index === -1) return;
	const targetIndex = index + direction;
	if (targetIndex < 0 || targetIndex >= state.subjectSettings.length) return;

	const [subject] = state.subjectSettings.splice(index, 1);
	state.subjectSettings.splice(targetIndex, 0, subject);
	saveState();
	render();
}

function moveSubjectSettingBefore(sourceId, targetId) {
	if (!sourceId || !targetId || sourceId === targetId) return;
	const sourceIndex = state.subjectSettings.findIndex((subject) => subject.id === sourceId);
	const targetIndex = state.subjectSettings.findIndex((subject) => subject.id === targetId);
	if (sourceIndex === -1 || targetIndex === -1) return;

	const [subject] = state.subjectSettings.splice(sourceIndex, 1);
	const adjustedTargetIndex = sourceIndex < targetIndex ? targetIndex - 1 : targetIndex;
	state.subjectSettings.splice(adjustedTargetIndex, 0, subject);
	saveState();
	render();
}

function clearSubjectDragState() {
	activeSubjectDragId = "";
	els.mypageContent.querySelectorAll(".subject-setting-item").forEach((item) => {
		item.classList.remove("is-dragging", "is-drop-target");
	});
}

function rebuildEntryKeys() {
	state.entries = Object.values(state.entries).reduce((entries, entry) => {
		const key = entryKey(entry.child, entry.subjectId, entry.date);
		entries[key] = { ...entry, key };
		return entries;
	}, {});
}

function openEntryDialog(button) {
	const child = button.dataset.child;
	const subjectId = button.dataset.subjectId;
	const date = button.dataset.date;
	const subject = getSubjectsForChild(child).find((item) => item.id === subjectId);
	if (!subject) return;
	const key = entryKey(child, subjectId, date);
	const entry = state.entries[key];

	activeEntry = { child, subjectId, date, key };
	els.entryMeta.textContent = `${date} · ${child}`;
	els.entryTitle.textContent = `${subject.name} / ${subject.book}`;
	els.entryAmount.value = entry?.amount || "";
	els.entryMemo.value = entry?.memo || "";
	els.entryCompleted.checked = Boolean(entry?.completed);
	els.deleteEntry.hidden = !entry;
	const futureEntries = getEntriesFromDate(child, subjectId, date);
	els.pushPlan.hidden = futureEntries.length === 0;
	els.pullPlan.hidden = futureEntries.length === 0;
	els.entryDialog.showModal();
	focusDialogField(els.entryAmount);
}

function saveEntry() {
	if (!activeEntry) return;
	const amount = els.entryAmount.value.trim();
	const memo = els.entryMemo.value.trim();
	const completed = els.entryCompleted.checked;
	let savedEntry = null;
	let shouldSyncEntry = false;

	if (!amount && !memo && !completed) {
		delete state.entries[activeEntry.key];
	} else {
		const subject = getSubjectsForChild(activeEntry.child).find((item) => item.id === activeEntry.subjectId);
		const validationMessage = getEntryDateValidationMessage(subject, activeEntry.date);
		if (validationMessage) {
			alert(validationMessage);
			return;
		}

		const previousEntry = state.entries[activeEntry.key] || {};
		const reward = getRewardForCompletedEntry(subject, completed, previousEntry);

		savedEntry = {
			...activeEntry,
			amount,
			memo,
			completed,
			rewardAwarded: reward.awarded,
			rewardAmount: reward.amount,
			rewardLabel: reward.label,
			rewardRedeemed: reward.redeemed,
			updatedAt: new Date().toISOString(),
		};
		state.entries[activeEntry.key] = savedEntry;
		shouldSyncEntry = true;
	}

	saveState({ sync: !shouldSyncEntry });
	activeEntry = null;
	els.entryDialog.close();
	render();
	if (shouldSyncEntry) syncTeacherEntry(savedEntry);
}

function deleteEntry() {
	if (!activeEntry) return;
	delete state.entries[activeEntry.key];
	saveState();
	activeEntry = null;
	els.entryDialog.close();
	render();
}

function closeEntryDialog() {
	activeEntry = null;
	els.entryDialog.close();
}

function pushPlanFromActiveEntry() {
	movePlanFromActiveEntry(1);
}

function pullPlanFromActiveEntry() {
	movePlanFromActiveEntry(-1);
}

function movePlanFromActiveEntry(dayOffset) {
	if (!activeEntry) return;

	const subject = getSubjectsForChild(activeEntry.child).find((item) => item.id === activeEntry.subjectId);
	if (!subject) return;

	const entriesToMove = getEntriesFromDate(activeEntry.child, activeEntry.subjectId, activeEntry.date);
	if (entriesToMove.length === 0) return;

	const direction = dayOffset > 0 ? "뒤로 밀까요" : "앞으로 당길까요";
	if (dayOffset < 0) {
		const conflict = findMoveConflict(entriesToMove, dayOffset);
		if (conflict) {
			alert(`${conflict.date}에 이미 '${subject.name} / ${subject.book}' 계획이 있어서 당길 수 없습니다.\n겹치는 날짜의 계획을 먼저 정리한 뒤 다시 시도하세요.`);
			return;
		}
	}

	const confirmed = confirm(`${activeEntry.child}의 '${subject.name} / ${subject.book}' 계획 ${entriesToMove.length}개를 ${activeEntry.date}부터 하루씩 ${direction}?`);
	if (!confirmed) return;

	const sortedEntries = dayOffset > 0 ? entriesToMove.sort((a, b) => b.date.localeCompare(a.date)) : entriesToMove.sort((a, b) => a.date.localeCompare(b.date));

	sortedEntries.forEach((entry) => {
		delete state.entries[entry.key];
		const movedDate = formatDate(addDays(parseDate(entry.date), dayOffset));
		const movedKey = entryKey(entry.child, entry.subjectId, movedDate);
		state.entries[movedKey] = {
			...entry,
			date: movedDate,
			key: movedKey,
			updatedAt: new Date().toISOString(),
		};
	});

	activeEntry = null;
	els.entryDialog.close();
	saveState();
	render();
}

function deleteBook(child, subjectId) {
	const subject = getSubjectsForChild(child).find((item) => item.id === subjectId);
	if (!subject) return;

	const confirmed = confirm(`${child}의 '${subject.name} / ${subject.book}' 교재를 삭제할까요?\n이 교재의 학습 기록도 함께 삭제됩니다.`);
	if (!confirmed) return;

	state.subjectsByChild[child] = getSubjectsForChild(child).filter((item) => item.id !== subjectId);
	Object.keys(state.entries).forEach((key) => {
		const entry = state.entries[key];
		if (entry.child === child && entry.subjectId === subjectId) {
			delete state.entries[key];
		}
	});

	saveState();
	render();
}

function openBookDialog(child, subjectId) {
	const subject = getSubjectsForChild(child).find((item) => item.id === subjectId);
	if (!subject) return;

	activeBookEdit = { child, subjectId };
	els.bookMeta.textContent = child;
	renderSubjectDropdowns();
	renderTimeSelects();
	els.editSubjectName.value = getSubjectSetting(subject)?.id || "";
	els.editBookName.value = subject.book;
	setTimeSelectValue(els.editScheduleHour, els.editScheduleMinute, subject.scheduleTime || "");
	els.editBookStartDate.value = subject.startDate || "";
	els.editBookEndDate.value = subject.endDate || "";
	els.editRegeneratePlan.checked = false;
	els.editRewardEnabled.checked = Boolean(subject.rewardEnabled);
	els.editRewardAmount.value = subject.rewardAmount || "";
	els.editRewardLabel.value = normalizeRewardLabel(subject.rewardLabel);
	setSelectedScheduleDays("editScheduleDay", subject.scheduleDays || []);
	els.bookDialog.showModal();
	focusDialogField(els.editSubjectName);
}

function saveBookEdit(event) {
	if (event.submitter?.value === "cancel" || !activeBookEdit) return;
	event.preventDefault();

	const subject = getSubjectsForChild(activeBookEdit.child).find((item) => item.id === activeBookEdit.subjectId);
	if (!subject) return;

	const subjectSetting = getSubjectSettingById(els.editSubjectName.value);
	const book = els.editBookName.value.trim();
	const shouldRegeneratePlan = Boolean(els.editRegeneratePlan?.checked);
	const rewardEnabled = Boolean(els.editRewardEnabled?.checked);
	const rewardAmount = rewardEnabled ? normalizeRewardAmount(els.editRewardAmount?.value) : 0;
	const rewardLabel = normalizeRewardLabel(els.editRewardLabel?.value);
	if (!subjectSetting || !book) return;
	if (isInvalidPeriod(els.editBookStartDate.value, els.editBookEndDate.value)) {
		alert("교재 종료일은 시작일보다 빠를 수 없습니다.");
		return;
	}
	if (rewardEnabled && rewardAmount <= 0) {
		alert("보상 누적을 사용하려면 1 이상의 보상 값을 입력하세요.");
		return;
	}
	if (shouldRegeneratePlan && !canCreateAutoPlan(getSelectedScheduleDays("editScheduleDay"), els.editBookStartDate.value, els.editBookEndDate.value)) {
		alert("가계획을 다시 생성하려면 수업 요일, 교재 시작일, 교재 종료일을 모두 입력하세요.");
		return;
	}

	subject.subjectSettingId = subjectSetting.id;
	subject.name = subjectSetting.name;
	subject.book = book;
	subject.scheduleDays = getSelectedScheduleDays("editScheduleDay");
	subject.scheduleTime = getTimeSelectValue(els.editScheduleHour, els.editScheduleMinute);
	subject.startDate = els.editBookStartDate.value;
	subject.endDate = els.editBookEndDate.value;
	subject.rewardEnabled = rewardEnabled;
	subject.rewardAmount = rewardAmount;
	subject.rewardLabel = rewardLabel;

	if (shouldRegeneratePlan) {
		deleteBlankPlanEntries(activeBookEdit.child, subject.id);
		createAutoPlanEntries(activeBookEdit.child, subject);
	}

	activeBookEdit = null;
	els.bookDialog.close();
	saveState();
	render();
}

function openTimetable(child) {
	const subjects = getActiveSubjectsForChild(child);
	const weekDates = getWeekDates();
	const scheduled = subjects
		.filter((subject) => subject.scheduleDays?.length && subject.scheduleTime)
		.flatMap((subject) =>
			subject.scheduleDays.map((day) => ({
				day,
				time: subject.scheduleTime,
				subject,
				entry: getEntryForTimetable(child, subject.id, day, weekDates),
			})),
		);
	const unscheduled = subjects.filter((subject) => !subject.scheduleDays?.length || !subject.scheduleTime);

	els.timetableMeta.textContent = child;
	els.timetableTitle.textContent = `${child} 주간 시간표`;
	els.timetableContent.innerHTML = `
    <div class="timetable-print-head">
      <h2>${escapeHtml(child)} 주간 시간표</h2>
      <p>${escapeHtml(getCurrentWeekRangeText())} · 출력일 ${formatDate(new Date())}</p>
    </div>
    <p class="timetable-range">${escapeHtml(getCurrentWeekRangeText())}</p>
    ${renderTimetableGrid(scheduled)}
    ${renderUnscheduledBooks(unscheduled)}
  `;
	els.timetableDialog.showModal();
}

function renderTimetableGrid(items) {
	const slots = buildTimetableSlots(items);

	return `
    <table class="timetable-table">
      <thead>
        <tr>
          <th>시간</th>
          ${dayNames.map((day) => `<th>${day}</th>`).join("")}
        </tr>
      </thead>
      <tbody>
        ${getTimetableHours()
			.map((hour) => {
				const hourLabel = formatHourLabel(hour);
				return `
              <tr>
                <th class="time-head">${hourLabel}</th>
                ${dayNames
					.map((day) => {
						const lessons = slots.get(`${day}__${hour}`) || [];
						return `
                      <td>
                        ${lessons.length ? lessons.map(renderLessonBlock).join("") : ""}
                      </td>
                    `;
					})
					.join("")}
              </tr>
            `;
			})
			.join("")}
      </tbody>
    </table>
  `;
}

function buildTimetableSlots(items) {
	return items.reduce((slots, item) => {
		const hour = Number(item.time.split(":")[0]);
		if (hour < 7 || hour > 21) return slots;
		const key = `${item.day}__${hour}`;
		const lessons = slots.get(key) || [];
		lessons.push(item);
		lessons.sort((a, b) => a.time.localeCompare(b.time, "ko-KR"));
		slots.set(key, lessons);
		return slots;
	}, new Map());
}

function renderLessonBlock(item) {
	return `
    <div class="lesson-block" style="${escapeHtml(subjectAccentStyle(item.subject))}">
      <strong>${escapeHtml(item.time)} · ${escapeHtml(item.subject.name)} · ${escapeHtml(item.subject.book)}</strong>
    </div>
  `;
}

function renderUnscheduledBooks(subjects) {
	if (subjects.length === 0) return "";

	return `
    <section class="unscheduled-books">
      <h4>일정 미설정 교재</h4>
      <ul>
        ${subjects.map((subject) => `<li>${escapeHtml(subject.name)} · ${escapeHtml(subject.book)}</li>`).join("")}
      </ul>
    </section>
  `;
}

function openCopyDialog(child, subjectId) {
	const subject = getSubjectsForChild(child).find((item) => item.id === subjectId);
	if (!subject) return;

	const entries = getEntriesForBook(child, subjectId);
	activeCopy = { child, subjectId };
	els.copyMeta.textContent = `${child} · ${subject.name}`;
	els.copyTitle.textContent = subject.book;
	els.copyTargetChild.innerHTML = children
		.filter((item) => item !== child)
		.map((item) => `<option value="${item}">${item}</option>`)
		.join("");
	els.copyStartDate.value = formatDate(new Date());
	els.copyHelp.textContent = entries.length > 0 ? `기록 ${entries.length}개를 날짜순으로 복사합니다. 첫 기록은 시작일에, 다음 기록은 다음 날에 배치됩니다.` : "등록된 학습 기록이 없어서 교재만 복사됩니다.";
	els.copyDialog.showModal();
	focusDialogField(els.copyTargetChild);
}

function copyBook(event) {
	if (event.submitter?.value === "cancel" || !activeCopy) return;
	event.preventDefault();

	const targetChild = els.copyTargetChild.value;
	const startDate = els.copyStartDate.value;
	if (!children.includes(targetChild) || targetChild === activeCopy.child || !startDate) return;

	const sourceSubject = getSubjectsForChild(activeCopy.child).find((subject) => subject.id === activeCopy.subjectId);
	if (!sourceSubject) return;

	const copiedSubject = {
		id: crypto.randomUUID(),
		subjectSettingId: sourceSubject.subjectSettingId || getSubjectSetting(sourceSubject)?.id || "",
		name: sourceSubject.name,
		book: sourceSubject.book,
		scheduleDays: [...(sourceSubject.scheduleDays || [])],
		scheduleTime: normalizeScheduleTime(sourceSubject.scheduleTime),
		startDate: startDate,
		endDate: calculateCopiedEndDate(startDate, getEntriesForBook(activeCopy.child, activeCopy.subjectId).length),
		rewardEnabled: Boolean(sourceSubject.rewardEnabled),
		rewardAmount: normalizeRewardAmount(sourceSubject.rewardAmount),
		rewardLabel: normalizeRewardLabel(sourceSubject.rewardLabel),
	};
	state.subjectsByChild[targetChild].push(copiedSubject);

	getEntriesForBook(activeCopy.child, activeCopy.subjectId).forEach((entry, index) => {
		const copiedDate = formatDate(addDays(parseDate(startDate), index));
		const key = entryKey(targetChild, copiedSubject.id, copiedDate);
		state.entries[key] = {
			child: targetChild,
			subjectId: copiedSubject.id,
			date: copiedDate,
			key,
			amount: entry.amount || "",
			memo: entry.memo || "",
			completed: false,
			rewardAwarded: false,
			rewardAmount: 0,
			rewardLabel: normalizeRewardLabel(copiedSubject.rewardLabel),
			rewardRedeemed: false,
			copiedFrom: {
				child: activeCopy.child,
				subjectId: activeCopy.subjectId,
				date: entry.date,
			},
			updatedAt: new Date().toISOString(),
		};
	});

	activeCopy = null;
	els.copyDialog.close();
	saveState();
	render();
}

function addSubject(event) {
	if (event.submitter?.value === "cancel") return;
	event.preventDefault();
	const child = els.subjectChild.value;
	const subjectSetting = getSubjectSettingById(els.subjectName.value);
	const book = els.bookName.value.trim();
	const scheduleDays = getSelectedScheduleDays("scheduleDay");
	const scheduleTime = getTimeSelectValue(els.scheduleHour, els.scheduleMinute);
	const startDate = els.bookStartDate.value;
	const endDate = els.bookEndDate.value;
	const shouldAutoCreatePlan = Boolean(els.autoCreatePlan?.checked);
	const rewardEnabled = Boolean(els.rewardEnabled?.checked);
	const rewardAmount = rewardEnabled ? normalizeRewardAmount(els.rewardAmount?.value) : 0;
	const rewardLabel = normalizeRewardLabel(els.rewardLabel?.value);
	if (!children.includes(child) || !subjectSetting || !book) return;
	if (isInvalidPeriod(startDate, endDate)) {
		alert("교재 종료일은 시작일보다 빠를 수 없습니다.");
		return;
	}
	if (shouldAutoCreatePlan && !canCreateAutoPlan(scheduleDays, startDate, endDate)) {
		alert("가계획 자동 생성을 사용하려면 수업 요일, 교재 시작일, 교재 종료일을 모두 입력하세요.");
		return;
	}
	if (rewardEnabled && rewardAmount <= 0) {
		alert("보상 누적을 사용하려면 1 이상의 보상 값을 입력하세요.");
		return;
	}

	const subject = {
		id: crypto.randomUUID(),
		subjectSettingId: subjectSetting.id,
		name: subjectSetting.name,
		book,
		scheduleDays,
		scheduleTime,
		startDate,
		endDate,
		rewardEnabled,
		rewardAmount,
		rewardLabel,
	};

	state.subjectsByChild[child].push(subject);
	if (shouldAutoCreatePlan) {
		createAutoPlanEntries(child, subject);
	}
	els.subjectForm.reset();
	els.subjectChild.value = child;
	els.subjectName.value = subjectSetting.id;
	setSelectedScheduleDays("scheduleDay", scheduleDays);
	setTimeSelectValue(els.scheduleHour, els.scheduleMinute, scheduleTime);
	els.rewardLabel.value = rewardLabel;
	els.subjectDialog.close();
	saveState();
	render();
}

function canCreateAutoPlan(scheduleDays, startDate, endDate) {
	return scheduleDays.length > 0 && Boolean(startDate) && Boolean(endDate);
}

function createAutoPlanEntries(child, subject) {
	const plannedDays = new Set((subject.scheduleDays || []).map((day) => scheduleDayIndexes.get(day)).filter((dayIndex) => dayIndex !== undefined));
	if (!plannedDays.size || !subject.startDate || !subject.endDate) return 0;

	let createdCount = 0;
	const cursor = parseDate(subject.startDate);
	const end = parseDate(subject.endDate);

	while (cursor <= end) {
		if (plannedDays.has(cursor.getDay())) {
			const date = formatDate(cursor);
			const key = entryKey(child, subject.id, date);
			if (!state.entries[key]) {
				state.entries[key] = {
					child,
					subjectId: subject.id,
					date,
					key,
					amount: "",
					memo: "",
					completed: false,
					rewardAwarded: false,
					rewardAmount: 0,
					rewardLabel: normalizeRewardLabel(subject.rewardLabel),
					rewardRedeemed: false,
					planned: true,
					createdAt: new Date().toISOString(),
				};
				createdCount += 1;
			}
		}
		cursor.setDate(cursor.getDate() + 1);
	}

	return createdCount;
}

function deleteBlankPlanEntries(child, subjectId) {
	Object.keys(state.entries).forEach((key) => {
		const entry = state.entries[key];
		if (entry.child === child && entry.subjectId === subjectId && !entry.completed && !entry.amount && !entry.memo && !entry.rewardAwarded) {
			delete state.entries[key];
		}
	});
}

function escapeHtml(value) {
	return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function getSubjectsForChild(child) {
	return state.subjectsByChild?.[child] || [];
}

function getSubjectSettingById(subjectId) {
	return state.subjectSettings.find((subject) => subject.id === subjectId);
}

function getSubjectSetting(subject) {
	return getSubjectSettingById(subject.subjectSettingId) || state.subjectSettings.find((setting) => setting.name === subject.name);
}

function getSubjectSettingOrder(subject) {
	const setting = getSubjectSetting(subject);
	const index = state.subjectSettings.findIndex((item) => item.id === setting?.id);
	return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

function getActiveSubjectsForChild(child) {
	const weekEnd = addDays(weekStart, 6);
	return getSubjectsForChild(child).filter((subject) => isSubjectActiveInRange(subject, weekStart, weekEnd));
}

function getAllSubjects() {
	return children.flatMap((child) => getSubjectsForChild(child).map((subject) => ({ child, subject })));
}

function getSubjectForEntry(entry) {
	return getSubjectsForChild(entry.child).find((subject) => subject.id === entry.subjectId);
}

function isSubjectActiveInRange(subject, rangeStart, rangeEnd) {
	const start = subject.startDate ? parseDate(subject.startDate) : null;
	const end = subject.endDate ? parseDate(subject.endDate) : null;
	if (start && start > rangeEnd) return false;
	if (end && end < rangeStart) return false;
	return true;
}

function isSubjectActiveOnDate(subject, dateText) {
	if (subject.startDate && dateText < subject.startDate) return false;
	if (subject.endDate && dateText > subject.endDate) return false;
	return true;
}

function getEntryDateValidationMessage(subject, date) {
	if (!subject) return "교재 정보를 찾을 수 없습니다.";
	if (subject.startDate && date < subject.startDate) {
		return `이 교재는 ${subject.startDate}부터 시작합니다.\n시작일보다 빠른 날짜에는 학습 계획을 등록할 수 없습니다.`;
	}
	if (subject.endDate && date > subject.endDate) {
		return `이 교재는 ${subject.endDate}에 종료됩니다.\n종료일 이후 날짜에는 학습 계획을 등록할 수 없습니다.`;
	}
	return "";
}

function getEntriesForBook(child, subjectId) {
	return Object.values(state.entries)
		.filter((entry) => entry.child === child && entry.subjectId === subjectId)
		.sort((a, b) => a.date.localeCompare(b.date));
}

function getEntriesFromDate(child, subjectId, date) {
	return getEntriesForBook(child, subjectId).filter((entry) => entry.date >= date);
}

function findMoveConflict(entriesToMove, dayOffset) {
	const movingKeys = new Set(entriesToMove.map((entry) => entry.key));
	return entriesToMove.find((entry) => {
		const targetDate = formatDate(addDays(parseDate(entry.date), dayOffset));
		const targetKey = entryKey(entry.child, entry.subjectId, targetDate);
		return state.entries[targetKey] && !movingKeys.has(targetKey);
	});
}

function parseDate(dateText) {
	const [year, month, day] = dateText.split("-").map(Number);
	return new Date(year, month - 1, day);
}

function sortSubjectsForTable(subjects) {
	return [...subjects].sort((a, b) => {
		const bySubjectOrder = getSubjectSettingOrder(a) - getSubjectSettingOrder(b);
		const bySubjectName = a.name.localeCompare(b.name, "ko-KR");
		return bySubjectOrder || bySubjectName || a.book.localeCompare(b.book, "ko-KR");
	});
}

function groupSubjectsByName(subjects) {
	return sortSubjectsForTable(subjects).reduce((groups, subject) => {
		const last = groups.at(-1);
		if (last?.name === subject.name) {
			last.subjects.push(subject);
		} else {
			groups.push({ name: subject.name, subjects: [subject] });
		}
		return groups;
	}, []);
}

function countUniqueSubjectNames(child) {
	return new Set(getVisibleSubjectsForChild(child).map((subject) => subject.name)).size;
}

function getDayOrder(day) {
	const index = dayNames.indexOf(day);
	return index === -1 ? 99 : index;
}

function getTimetableHours() {
	return Array.from({ length: 15 }, (_, index) => index + 7);
}

function formatHourLabel(hour) {
	if (hour < 12) return `오전 ${hour}시`;
	if (hour === 12) return "오후 12시";
	return `오후 ${hour - 12}시`;
}

function getEntryForTimetable(child, subjectId, day, weekDates) {
	const dayIndex = dayNames.indexOf(day);
	if (dayIndex === -1) return null;
	const date = formatDate(weekDates[dayIndex]);
	return state.entries[entryKey(child, subjectId, date)] || null;
}

function getCurrentWeekRangeText() {
	return `${formatDate(weekStart)} ~ ${formatDate(addDays(weekStart, 6))}`;
}

function getSelectedScheduleDays(name) {
	return Array.from(document.querySelectorAll(`input[name="${name}"]:checked`)).map((input) => input.value);
}

function setSelectedScheduleDays(name, values) {
	const selected = new Set(values);
	document.querySelectorAll(`input[name="${name}"]`).forEach((input) => {
		input.checked = selected.has(input.value);
	});
}

function getTimeSelectValue(hourSelect, minuteSelect) {
	const hour = hourSelect.value;
	const minute = minuteSelect.value || "00";
	return hour ? normalizeScheduleTime(`${hour}:${minute}`) : "";
}

function setTimeSelectValue(hourSelect, minuteSelect, value) {
	const [hour = "", minute = ""] = normalizeScheduleTime(value).split(":");
	hourSelect.value = hour;
	minuteSelect.value = minute || "";
}

function normalizeScheduleTime(value) {
	const text = String(value || "").trim();
	const match = text.match(/(\d{1,2}):(\d{2})/);
	if (!match) return "";
	const hour = Number(match[1]);
	const minute = Number(match[2]);
	if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return "";
	return `${String(hour).padStart(2, "0")}:${String(Math.floor(minute / 10) * 10).padStart(2, "0")}`;
}

function formatScheduleDays(days) {
	if (!days?.length) return "";
	const selected = dayNames.filter((day) => days.includes(day));
	const joined = selected.join(", ");
	if (joined === dayNames.join(", ")) return "매일";
	if (joined === dayNames.slice(0, 5).join(", ")) return "주중";
	if (joined === dayNames.slice(5).join(", ")) return "주말";
	return joined;
}

function formatSchedule(subject) {
	const days = formatScheduleDays(subject.scheduleDays);
	const time = normalizeScheduleTime(subject.scheduleTime);
	if (!days && !time) return "수업 일정 미설정";
	if (days && time) return `${days} · ${time}`;
	return days || time;
}

function formatShortDate(value) {
	const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
	if (!match) return value;
	return `${Number(match[2])}.${Number(match[3])}`;
}

function formatBookPeriod(subject) {
	if (!subject.startDate && !subject.endDate) return "기간 미설정";
	if (subject.startDate && subject.endDate) return `${formatShortDate(subject.startDate)} ~ ${formatShortDate(subject.endDate)}`;
	if (subject.startDate) return `${formatShortDate(subject.startDate)}부터`;
	return `${formatShortDate(subject.endDate)}까지`;
}

function formatBirthMonth(value) {
	if (!value) return "";
	const [year, month, day] = value.split("-");
	if (day) return `${year}년 ${Number(month)}월 ${Number(day)}일생`;
	return `${year}년 ${Number(month)}월생`;
}

function normalizeBirthValue(value) {
	if (!value) return "9999-12-31";
	return value.length === 7 ? `${value}-01` : value;
}

function toBirthInputValue(value) {
	if (!value) return "";
	return value.length === 7 ? `${value}-01` : value;
}

function subjectAccentStyle(subject) {
	const color = normalizeColor(subject.color || getSubjectSetting(subject)?.color);
	return `--subject-color: ${color}; --subject-soft: ${hexToRgba(color, 0.12)}`;
}

function subjectDotStyle(subject) {
	const color = normalizeColor(subject.color || getSubjectSetting(subject)?.color);
	return `background: ${color}`;
}

function normalizeColor(value) {
	return /^#[0-9a-f]{6}$/i.test(String(value || "")) ? value : "#2f78d4";
}

function normalizeRewardAmount(value) {
	const amount = Number.parseInt(value, 10);
	return Number.isFinite(amount) && amount > 0 ? amount : 0;
}

function normalizeRewardLabel(value) {
	return (
		String(value || "")
			.trim()
			.slice(0, 20) || "포인트"
	);
}

function getRewardForCompletedEntry(subject, completed, previousEntry = {}) {
	const previousAwarded = Boolean(previousEntry.rewardAwarded);
	if (previousAwarded) {
		return {
			awarded: true,
			amount: normalizeRewardAmount(previousEntry.rewardAmount),
			label: normalizeRewardLabel(previousEntry.rewardLabel),
			redeemed: Boolean(previousEntry.rewardRedeemed),
		};
	}

	const amount = normalizeRewardAmount(subject?.rewardAmount);
	if (!completed || !subject?.rewardEnabled || amount <= 0) {
		return { awarded: false, amount: 0, label: normalizeRewardLabel(subject?.rewardLabel), redeemed: false };
	}

	return {
		awarded: true,
		amount,
		label: normalizeRewardLabel(subject.rewardLabel),
		redeemed: false,
	};
}

function getRewardTotalsForChild(child) {
	const totals = new Map();
	Object.values(state.entries || {}).forEach((entry) => {
		if (entry.child !== child || !entry.rewardAwarded || entry.rewardRedeemed) return;
		const amount = normalizeRewardAmount(entry.rewardAmount);
		if (amount <= 0) return;
		const label = normalizeRewardLabel(entry.rewardLabel);
		totals.set(label, (totals.get(label) || 0) + amount);
	});

	return [...totals.entries()].map(([label, amount]) => ({ label, amount }));
}

function getRewardTotalsForEntries(entries) {
	const totals = new Map();
	entries.forEach((entry) => {
		const amount = normalizeRewardAmount(entry.rewardAmount);
		if (amount <= 0) return;
		const label = normalizeRewardLabel(entry.rewardLabel);
		totals.set(label, (totals.get(label) || 0) + amount);
	});

	return [...totals.entries()].map(([label, amount]) => ({ label, amount }));
}

function getRewardRedemptionBatches() {
	const batches = new Map();
	Object.values(state.entries || {}).forEach((entry) => {
		if (!entry.rewardAwarded || !entry.rewardRedeemed) return;
		const redeemedAt = entry.rewardRedeemedAt || "unknown";
		const key = `${entry.child}__${redeemedAt}`;
		const batch = batches.get(key) || {
			child: entry.child,
			redeemedAt,
			entries: [],
		};
		batch.entries.push(entry);
		batches.set(key, batch);
	});

	return [...batches.values()]
		.map((batch) => ({
			...batch,
			entries: batch.entries.sort((a, b) => a.date.localeCompare(b.date)),
			totals: getRewardTotalsForEntries(batch.entries),
		}))
		.sort((a, b) => String(b.redeemedAt).localeCompare(String(a.redeemedAt)));
}

function getRewardTotalForChild(child) {
	return getRewardTotalsForChild(child);
}

function formatReward(amount, label) {
	const normalizedAmount = normalizeRewardAmount(amount);
	return `${normalizedAmount}${normalizeRewardLabel(label)}`;
}

function formatRewardTotal(totals) {
	if (!totals.length) return "0포인트";
	return totals.map((item) => formatReward(item.amount, item.label)).join(" · ");
}

function formatDateTime(value) {
	if (!value || value === "unknown") return "지급 시각 미상";
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return String(value);
	return new Intl.DateTimeFormat("ko-KR", {
		dateStyle: "medium",
		timeStyle: "short",
	}).format(date);
}

function getRedeemableRewardEntriesForChild(child) {
	return Object.values(state.entries || {})
		.filter((entry) => entry.child === child && entry.rewardAwarded && !entry.rewardRedeemed)
		.sort((a, b) => a.date.localeCompare(b.date));
}

function resetRewardForChild(child) {
	const entries = getRedeemableRewardEntriesForChild(child);
	const totals = getRewardTotalsForEntries(entries);
	if (!totals.length) return;

	activeRewardResetChild = child;
	els.rewardResetMeta.textContent = child;
	els.rewardResetSummary.textContent = `${formatRewardTotal(totals)} 지급 대상 ${entries.length}건을 확인한 뒤 초기화합니다.`;
	els.rewardResetList.innerHTML = entries
		.map((entry) => {
			const subject = getSubjectForEntry(entry);
			return `
        <article class="reward-reset-item">
          <div>
            <strong>${escapeHtml(entry.date)} · ${escapeHtml(subject?.name || "과목")}</strong>
            <p>${escapeHtml(subject?.book || "")}${entry.amount ? ` · ${escapeHtml(entry.amount)}` : ""}</p>
          </div>
          <b>${escapeHtml(formatReward(entry.rewardAmount, entry.rewardLabel))}</b>
        </article>
      `;
		})
		.join("");
	els.rewardResetDialog.showModal();
}

function confirmRewardReset(event) {
	event.preventDefault();
	if (event.submitter?.value !== "confirm-reset") {
		activeRewardResetChild = "";
		els.rewardResetDialog.close();
		return;
	}

	const child = activeRewardResetChild;
	if (!child) return;
	const now = new Date().toISOString();

	Object.values(state.entries || {}).forEach((entry) => {
		if (entry.child === child && entry.rewardAwarded && !entry.rewardRedeemed) {
			entry.rewardRedeemed = true;
			entry.rewardRedeemedAt = now;
			entry.updatedAt = now;
		}
	});

	activeRewardResetChild = "";
	saveState();
	els.rewardResetDialog.close();
	render();
}

function pickSubjectColor(index) {
	return SUBJECT_COLOR_PALETTE[index % SUBJECT_COLOR_PALETTE.length];
}

function hexToRgba(hex, alpha) {
	const normalized = normalizeColor(hex).replace("#", "");
	const red = parseInt(normalized.slice(0, 2), 16);
	const green = parseInt(normalized.slice(2, 4), 16);
	const blue = parseInt(normalized.slice(4, 6), 16);
	return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function isInvalidPeriod(startDate, endDate) {
	return Boolean(startDate && endDate && startDate > endDate);
}

function calculateCopiedEndDate(startDate, entryCount) {
	if (!startDate || entryCount <= 0) return "";
	return formatDate(addDays(parseDate(startDate), entryCount - 1));
}

function focusDialogField(element) {
	requestAnimationFrame(() => {
		element?.focus();
	});
}

els.prevWeek.addEventListener("click", () => {
	weekStart = addDays(weekStart, -7);
	render();
});

els.nextWeek.addEventListener("click", () => {
	weekStart = addDays(weekStart, 7);
	render();
});

els.todayBtn.addEventListener("click", () => {
	weekStart = startOfWeek(new Date());
	render();
});

els.statsContent.addEventListener("click", (event) => {
	const weekBtn = event.target.closest("[data-stats-week]");
	if (weekBtn) {
		weekStart = addDays(weekStart, Number(weekBtn.dataset.statsWeek) * 7);
		render();
		return;
	}
	if (event.target.closest("[data-stats-today]")) {
		weekStart = startOfWeek(new Date());
		render();
	}
});

els.weekChildFilter.addEventListener("change", () => {
	weekChildFilter = els.weekChildFilter.value;
	renderSummary();
	renderTable();
});

els.weekSubjectFilter.addEventListener("change", () => {
	weekSubjectFilter = els.weekSubjectFilter.value;
	renderSummary();
	renderTable();
});

if (els.weekSearch) {
	els.weekSearch.addEventListener("input", () => {
		weekSearchQuery = els.weekSearch.value.trim().toLowerCase();
		renderSummary();
		renderTable();
	});
}

if (els.weekChildAdd) {
	els.weekChildAdd.addEventListener("click", () => openChildAccountDialog());
}

els.navItems.forEach((item) => {
	item.addEventListener("click", () => showPage(item.dataset.targetPage));
});
els.mypageContent.addEventListener("click", (event) => {
	const logoutButton = event.target.closest("[data-logout-button]");
	if (logoutButton) {
		logout();
		return;
	}

	const entryCard = event.target.closest("[data-target-page]");
	if (entryCard) {
		showPage(entryCard.dataset.targetPage);
		return;
	}
});

function handleSubjectClick(event) {
	const backButton = event.target.closest("[data-target-page]");
	if (backButton) {
		showPage(backButton.dataset.targetPage);
		return;
	}

	const subjectButton = event.target.closest("[data-subject-action]");
	if (!subjectButton) return;
	const action = subjectButton.dataset.subjectAction;
	if (action === "add") openSubjectSettingDialog();
	else if (action === "edit") openSubjectSettingDialog(subjectButton.dataset.subjectId);
	else if (action === "move-up") moveSubjectSetting(subjectButton.dataset.subjectId, -1);
	else if (action === "move-down") moveSubjectSetting(subjectButton.dataset.subjectId, 1);
	else if (action === "delete") deleteSubjectSetting(subjectButton.dataset.subjectId);
}

els.subjectsSection.addEventListener("click", handleSubjectClick);

els.subjectsContent.addEventListener("dragstart", (event) => {
	const item = event.target.closest(".subject-setting-item");
	if (!item) return;
	activeSubjectDragId = item.dataset.subjectId;
	item.classList.add("is-dragging");
	event.dataTransfer.effectAllowed = "move";
	event.dataTransfer.setData("text/plain", activeSubjectDragId);
});

els.subjectsContent.addEventListener("dragover", (event) => {
	const item = event.target.closest(".subject-setting-item");
	if (!item || !activeSubjectDragId || item.dataset.subjectId === activeSubjectDragId) return;
	event.preventDefault();
	event.dataTransfer.dropEffect = "move";
	els.subjectsContent.querySelectorAll(".subject-setting-item.is-drop-target").forEach((target) => {
		if (target !== item) target.classList.remove("is-drop-target");
	});
	item.classList.add("is-drop-target");
});

els.subjectsContent.addEventListener("drop", (event) => {
	const item = event.target.closest(".subject-setting-item");
	if (!item || !activeSubjectDragId) return;
	event.preventDefault();
	const sourceId = event.dataTransfer.getData("text/plain") || activeSubjectDragId;
	moveSubjectSettingBefore(sourceId, item.dataset.subjectId);
	clearSubjectDragState();
});

els.subjectsContent.addEventListener("dragend", clearSubjectDragState);

els.summaryGrid.addEventListener("click", (event) => {
	const rewardButton = event.target.closest(".reward-reset-button");
	if (rewardButton) {
		resetRewardForChild(rewardButton.dataset.child);
		return;
	}

	const button = event.target.closest(".timetable-button");
	if (button) openTimetable(button.dataset.child);
});
els.subjectForm.addEventListener("submit", addSubject);
document.addEventListener("click", (e) => {
	if (!e.target.closest(".book-actions")) {
		closeBookMenus();
	}
});

els.weeklyTable.addEventListener("click", (event) => {
	const rewardButton = event.target.closest(".reward-reset-button");
	if (rewardButton) {
		resetRewardForChild(rewardButton.dataset.child);
		return;
	}

	const timetableButton = event.target.closest(".timetable-button");
	if (timetableButton) {
		openTimetable(timetableButton.dataset.child);
		return;
	}

	const childEditButton = event.target.closest("[data-weekly-child-edit]");
	if (childEditButton) {
		openChildAccountDialog(childEditButton.dataset.weeklyChildEdit);
		return;
	}

	const childDeleteButton = event.target.closest("[data-weekly-child-delete]");
	if (childDeleteButton) {
		deleteChildAccount(childDeleteButton.dataset.weeklyChildDelete);
		return;
	}

	const bookDialogButton = event.target.closest("[data-weekly-open-book-dialog]");
	if (bookDialogButton) {
		openSubjectDialogForChild(bookDialogButton.dataset.weeklyOpenBookDialog);
		return;
	}

	const menuBtn = event.target.closest(".book-menu-btn");
	if (menuBtn) {
		const menu = menuBtn.nextElementSibling;
		const isOpen = !menu.hasAttribute("hidden");
		if (isOpen) closeBookMenus();
		else openBookMenu(menuBtn);
		return;
	}

	const editButton = event.target.closest(".edit-book");
	if (editButton) {
		closeBookMenus();
		openBookDialog(editButton.dataset.child, editButton.dataset.subjectId);
		return;
	}

	const copyButton = event.target.closest(".copy-book");
	if (copyButton) {
		closeBookMenus();
		openCopyDialog(copyButton.dataset.child, copyButton.dataset.subjectId);
		return;
	}

	const deleteButton = event.target.closest(".delete-book");
	if (deleteButton) {
		closeBookMenus();
		deleteBook(deleteButton.dataset.child, deleteButton.dataset.subjectId);
		return;
	}

	const button = event.target.closest(".entry-cell");
	if (button) openEntryDialog(button);
});
window.addEventListener("resize", closeBookMenus);
window.addEventListener("scroll", closeBookMenus, true);
els.historySearch.addEventListener("input", renderHistory);
els.historyChild.addEventListener("change", renderHistory);
els.historySubjectSetting.addEventListener("change", renderHistory);
els.historySubject.addEventListener("change", renderHistory);
els.pendingChild.addEventListener("change", renderPendingPlans);
els.pendingSubjectSetting.addEventListener("change", renderPendingPlans);
els.pendingRange.addEventListener("change", renderPendingPlans);
els.pendingList.addEventListener("click", (event) => {
	const button = event.target.closest(".pending-open-entry");
	if (button) openEntryDialog(button);
});
els.rewardResetForm.addEventListener("submit", confirmRewardReset);
els.deleteEntry.addEventListener("click", deleteEntry);
els.closeEntryDialog.addEventListener("click", closeEntryDialog);
els.cancelEntryDialog.addEventListener("click", closeEntryDialog);
els.pushPlan.addEventListener("click", pushPlanFromActiveEntry);
els.pullPlan.addEventListener("click", pullPlanFromActiveEntry);
els.entryForm.addEventListener("submit", (event) => {
	event.preventDefault();
	saveEntry();
});
els.copyForm.addEventListener("submit", copyBook);
els.bookForm.addEventListener("submit", saveBookEdit);
els.verifyChildLoginId.addEventListener("click", verifyChildLoginId);
els.childAccountForm.addEventListener("submit", saveChildAccount);
els.childAccountDialog.addEventListener("cancel", (event) => {
	if (!isForcingChildRegistration) return;
	event.preventDefault();
	focusDialogField(els.childAccountName);
});
els.childAccountDialog.addEventListener("close", () => {
	if (!isForcingChildRegistration || state.childAccounts.length > 0) return;
	setTimeout(() => {
		if (!els.childAccountDialog.open) {
			els.childAccountDialog.showModal();
			focusDialogField(els.childAccountName);
		}
	}, 0);
});
document.addEventListener(
	"keydown",
	(event) => {
		if (!isForcingChildRegistration || event.key !== "Escape") return;
		event.preventDefault();
		event.stopPropagation();
		focusDialogField(els.childAccountName);
	},
	true,
);
els.subjectSettingForm.addEventListener("submit", saveSubjectSetting);
els.closeTimetable.addEventListener("click", () => els.timetableDialog.close());
els.printTimetable.addEventListener("click", () => window.print());
if (els.logoutButton) els.logoutButton.addEventListener("click", logout);

render();
loadRemoteState();

// Mouse drag-to-scroll for .summary-grid
document.querySelectorAll(".summary-grid").forEach((el) => {
	let startX,
		scrollLeft,
		dragging = false;
	el.addEventListener("mousedown", (e) => {
		dragging = true;
		startX = e.pageX - el.offsetLeft;
		scrollLeft = el.scrollLeft;
		el.style.cursor = "grabbing";
		el.style.userSelect = "none";
	});
	el.addEventListener("mousemove", (e) => {
		if (!dragging) return;
		const dx = e.pageX - el.offsetLeft - startX;
		el.scrollLeft = scrollLeft - dx;
	});
	const stop = () => {
		dragging = false;
		el.style.cursor = "";
		el.style.userSelect = "";
	};
	el.addEventListener("mouseup", stop);
	el.addEventListener("mouseleave", stop);
});
