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
const PENDING_SYNC_KEY = `${STORAGE_KEY}:pending-sync`;
const PENDING_MINIMUM_STUDY_KEY = `${STORAGE_KEY}:pending-minimum-study`;
const LEGACY_PAGE_STORAGE_KEY = "studyflow-teacher-active-page";
const PAGE_STORAGE_KEY = `studyflow-teacher-active-page:${authUser.id || authUser.email || "anonymous"}`;
const TEACHER_LOGIN_STARTUP_KEY = `studyflow-teacher-login-startup:${authUser.id || authUser.email || "anonymous"}`;
const ACCESS_LOG_SKIP_KEY = `studyflow-access-log-skip:teacher:${authUser.id || authUser.email || "anonymous"}`;
const ACCESS_LOG_SKIP_TTL_MS = 3000;
const ACCESS_LOG_THROTTLE_MS = 5000;
const accountStateBeforeRemoteLoad = localStorage.getItem(STORAGE_KEY);
const legacyStateBeforeRemoteLoad = localStorage.getItem(LEGACY_STORAGE_KEY);
const DEFAULT_USER_SETTINGS = {
	weekStartMode: "monday",
	startupScreenMode: "weekly",
};
const WEEK_START_MODES = new Set(["monday", "today"]);
const STARTUP_SCREEN_MODES = new Set(["weekly", "last"]);

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
let weekStart = getDefaultWeekStart();
let activeEntry = null;
let activeCopy = null;
let activeBookEdit = null;
let activeChildEdit = null;
let activeSubjectSettingEdit = null;
let activeSubjectDragId = "";
let activeRewardResetChild = "";
let activePage = "weekly";
let weekChildFilter = "active";
let weekSubjectFilter = "all";
let weekSearchQuery = "";
let syncStateTimer = null;
let isHydratingRemoteState = false;
let isForcingChildRegistration = false;
let pushState = { supported: false, subscribed: false, permission: "default" };
let accessLogs = [];
let accessLogsLoading = false;
let lastAccessLogAt = 0;
let entryAttachmentObjectUrls = [];
let attachmentGalleryState = { items: [], index: 0, rotations: {}, zooms: {}, pointers: new Map(), dragStart: null, pinchStart: null, keyHandler: null };
let availablePlans = [];
let teacherToastTimer = null;

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
	minimumStudyMinutes: document.querySelector("#minimumStudyMinutes"),
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
	teacherToast: document.querySelector("#teacherToast"),
	subjectsContent: document.querySelector("#subjectsContent"),
	subjectsSection: document.querySelector("#subjectsPage .mypage-section"),
	settingsSection: document.querySelector("#settingsPage .mypage-section"),
	accessLogsSection: document.querySelector("#accessLogsPage .mypage-section"),
	accessLogsContent: document.querySelector("#accessLogsContent"),
	weekStartModeInputs: document.querySelectorAll("[data-week-start-mode]"),
	startupScreenModeInputs: document.querySelectorAll("[data-startup-screen-mode]"),
	entryDialog: document.querySelector("#entryDialog"),
	entryForm: document.querySelector("#entryForm"),
	entryMeta: document.querySelector("#entryMeta"),
	entryTitle: document.querySelector("#entryTitle"),
	entryAmount: document.querySelector("#entryAmount"),
	entryMinimumStudyMinutes: document.querySelector("#entryMinimumStudyMinutes"),
	entryMemo: document.querySelector("#entryMemo"),
	entryCompleted: document.querySelector("#entryCompleted"),
	entryCompletedInfo: document.querySelector("#entryCompletedInfo"),
	entryStudyStartedAt: document.querySelector("#entryStudyStartedAt"),
	entryStudyDuration: document.querySelector("#entryStudyDuration"),
	entryStudentFeedback: document.querySelector("#entryStudentFeedback"),
	entryAttachmentsBlock: document.querySelector("#entryAttachmentsBlock"),
	entryAttachmentList: document.querySelector("#entryAttachmentList"),
	entryAiPanel: document.querySelector("#entryAiPanel"),
	entryAnalyzeButton: document.querySelector("#entryAnalyzeButton"),
	entryAiStatus: document.querySelector("#entryAiStatus"),
	entryAiResult: document.querySelector("#entryAiResult"),
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
	editMinimumStudyMinutes: document.querySelector("#editMinimumStudyMinutes"),
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
	childPhone: document.querySelector("#childPhone"),
	childParentPhone: document.querySelector("#childParentPhone"),
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
	planDialog: document.querySelector("#planDialog"),
	planForm: document.querySelector("#planForm"),
	planOptions: document.querySelector("#planOptions"),
	planChangeMessage: document.querySelector("#planChangeMessage"),
	closePlanDialog: document.querySelector("#closePlanDialog"),
	cancelPlanDialog: document.querySelector("#cancelPlanDialog"),
	savePlanChange: document.querySelector("#savePlanChange"),
	paymentTermDialog: document.querySelector("#paymentTermDialog"),
	paymentTermForm: document.querySelector("#paymentTermForm"),
	paymentTermOptions: document.querySelector("#paymentTermOptions"),
	paymentTermMessage: document.querySelector("#paymentTermMessage"),
	closePaymentTermDialog: document.querySelector("#closePaymentTermDialog"),
	cancelPaymentTermDialog: document.querySelector("#cancelPaymentTermDialog"),
	confirmPaymentTerm: document.querySelector("#confirmPaymentTerm"),
	innopayMethodDialog: document.querySelector("#innopayMethodDialog"),
	closeInnopayMethodDialog: document.querySelector("#closeInnopayMethodDialog"),
	profilePhotoDialog: document.querySelector("#profilePhotoDialog"),
	closeProfilePhotoDialog: document.querySelector("#closeProfilePhotoDialog"),
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
		userSettings: { ...DEFAULT_USER_SETTINGS },
		entries: {},
	};
}

function normalizeState(value) {
	const profile = normalizeProfile(value.profile);
	const userSettings = normalizeUserSettings(value.userSettings);
	const childAccounts = normalizeChildAccounts(value);
	const subjectsByChild = Object.fromEntries(childAccounts.map((account) => [getChildKey(account), []]));
	const childNameCounts = getChildNameCounts(childAccounts);

	if (value.subjectsByChild && typeof value.subjectsByChild === "object") {
		childAccounts.forEach((account) => {
			const childKey = getChildKey(account);
			const legacySubjects = childNameCounts.get(account.name) === 1 ? value.subjectsByChild[account.name] : null;
			const subjects = value.subjectsByChild[childKey] || legacySubjects || [];
			subjectsByChild[childKey] = Array.isArray(subjects) ? subjects.map((subject) => ({ ...normalizeSubject(subject), childId: childKey })) : [];
		});
	} else if (Array.isArray(value.subjects)) {
		childAccounts.forEach((account) => {
			const childKey = getChildKey(account);
			subjectsByChild[childKey] = value.subjects.map((subject) => ({ ...normalizeSubject(subject), childId: childKey }));
		});
	}

	const subjectSettings = normalizeSubjectSettings(value.subjectSettings, subjectsByChild);
	assignSubjectSettingsToBooks(subjectsByChild, subjectSettings);
	const entries = normalizeEntries(value.entries, childAccounts, subjectsByChild);

	return { profile, childAccounts, subjectsByChild, subjectSettings, userSettings, entries };
}

function normalizeUserSettings(settings = {}) {
	const weekStartMode = WEEK_START_MODES.has(settings?.weekStartMode) ? settings.weekStartMode : DEFAULT_USER_SETTINGS.weekStartMode;
	const startupScreenMode = STARTUP_SCREEN_MODES.has(settings?.startupScreenMode) ? settings.startupScreenMode : DEFAULT_USER_SETTINGS.startupScreenMode;
	return {
		...DEFAULT_USER_SETTINGS,
		...settings,
		weekStartMode,
		startupScreenMode,
	};
}

function normalizeProfile(profile) {
	const monthlyPrice = Number(profile?.plan?.monthlyPrice ?? profile?.monthlyPrice ?? 0);
	const gradientFrom = normalizePlanColor(profile?.plan?.gradientFrom || profile?.gradientFrom, monthlyPrice > 0 ? "#426f96" : "#64748b");
	const gradientTo = normalizePlanColor(profile?.plan?.gradientTo || profile?.gradientTo, monthlyPrice > 0 ? "#2ba889" : "#94a3b8");
	return {
		name: profile?.name || "학습 관리자",
		email: profile?.email || "manager@example.com",
		password: profile?.password || "",
		phone: profile?.phone || "",
		marketingConsent: Boolean(profile?.marketingConsent),
		plan: {
			code: profile?.plan?.code || profile?.planCode || "basic",
			name: profile?.plan?.name || profile?.planName || "",
			monthlyPrice,
			studentLimit: Number(profile?.plan?.studentLimit ?? profile?.studentLimit ?? 0),
			gradientFrom,
			gradientTo,
		},
		servicePeriod: {
			startedAt: monthlyPrice > 0 ? profile?.servicePeriod?.startedAt || profile?.serviceStartedAt || "" : "",
			endsAt: monthlyPrice > 0 ? profile?.servicePeriod?.endsAt || profile?.serviceEndsAt || "" : "",
		},
		profileImageUrl: profile?.profileImageUrl || "",
		teacherComment: String(profile?.teacherComment || "").slice(0, 200),
	};
}

function normalizeChildAccounts(value) {
	const savedAccounts = Array.isArray(value.childAccounts) ? value.childAccounts : [];
	const accounts = savedAccounts
		.map((account) => ({
			id: account?.id || crypto.randomUUID(),
			name: String(account?.name || "").trim(),
				birthMonth: account?.birthMonth || "",
				phone: normalizeMobilePhone(account?.phone),
				parentPhone: normalizeMobilePhone(account?.parentPhone),
				status: normalizeChildStatus(account?.status),
				loginId: account?.loginId || "",
			password: account?.password || "",
		}))
		.filter((account) => account.name);

	if (!accounts.length && value.subjectsByChild && typeof value.subjectsByChild === "object") {
		Object.keys(value.subjectsByChild).forEach((name) => {
			const childName = String(name || "").trim();
			if (childName) accounts.push({ id: crypto.randomUUID(), name: childName, birthMonth: "", phone: "", parentPhone: "", loginId: "", password: "" });
		});
	}

	return sortChildAccountsByBirth(accounts);
}

function getChildNamesFromState() {
	return state.childAccounts.map((account) => getChildKey(account));
}

function normalizeChildStatus(value) {
	return String(value || "") === "hidden" ? "hidden" : "active";
}

function isChildHidden(child) {
	const account = typeof child === "object" ? child : getChildAccount(child);
	return normalizeChildStatus(account?.status) === "hidden";
}

function getVisibleChildKeysByStatus(status = weekChildFilter) {
	if (status === "all") return children;
	if (status === "hidden") return state.childAccounts.filter((account) => isChildHidden(account)).map(getChildKey);
	return state.childAccounts.filter((account) => !isChildHidden(account)).map(getChildKey);
}

function getActiveChildAccounts() {
	return state.childAccounts.filter((account) => !isChildHidden(account));
}

function getChildKey(child) {
	if (!child) return "";
	if (typeof child === "object") return String(child.id || child.name || "").trim();
	return String(child || "").trim();
}

function getChildNameCounts(accounts = state.childAccounts) {
	const counts = new Map();
	accounts.forEach((account) => counts.set(account.name, (counts.get(account.name) || 0) + 1));
	return counts;
}

function getChildAccount(childKeyOrName) {
	const key = getChildKey(childKeyOrName);
	return state.childAccounts.find((account) => getChildKey(account) === key) || state.childAccounts.find((account) => account.name === key) || null;
}

function getChildName(childKeyOrName) {
	return getChildAccount(childKeyOrName)?.name || String(childKeyOrName || "");
}

function getChildOptionLabel(account) {
	const duplicates = getChildNameCounts().get(account.name) > 1;
	const suffix = [
		duplicates ? account.birthMonth || String(account.id).slice(0, 4) : "",
		isChildHidden(account) ? "숨김" : "",
	].filter(Boolean).join(" · ");
	return suffix ? `${account.name} (${suffix})` : account.name;
}

function normalizeEntries(entriesValue, childAccounts, subjectsByChild) {
	const entries = {};
	Object.values(entriesValue && typeof entriesValue === "object" ? entriesValue : {}).forEach((entry) => {
		const account = childAccounts.find((child) => getChildKey(child) === String(entry.childId || "")) || childAccounts.find((child) => child.name === entry.child);
		const childId = account ? getChildKey(account) : String(entry.childId || entry.child || "").trim();
		if (!childId || !entry.subjectId || !entry.date) return;
		const subject = subjectsByChild[childId]?.find((item) => item.id === entry.subjectId);
		if (!subject && account && getChildNameCounts(childAccounts).get(account.name) > 1 && !entry.childId) return;
		const key = entryKey(childId, entry.subjectId, entry.date);
		entries[key] = {
			...entry,
			key,
			childId,
			child: account?.name || entry.child || "",
		};
	});
	return entries;
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
		minimumStudyMinutes: readOptionalMinimumStudyMinutes(subject),
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
	if (options.sync !== false) {
		markPendingRemoteSync();
		scheduleRemoteStateSync();
	}
}

function normalizeMobilePhone(value) {
	const raw = String(value || "").trim();
	if (!raw) return "";
	const digits = raw.replace(/\D/g, "");
	if (/^01\d{8}$/.test(digits)) return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
	if (/^01\d{9}$/.test(digits)) return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
	return raw;
}

function normalizePlanColor(value, fallback) {
	const text = String(value || "").trim();
	return /^#[0-9a-fA-F]{6}$/.test(text) ? text : fallback;
}

function normalizePaymentPhone(value) {
	return String(value || "").replace(/\D/g, "");
}

function normalizeInnopayUserId(value) {
	return String(value || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 20);
}

function isValidKoreanMobilePhone(value) {
	return !value || /^01\d-\d{3,4}-\d{4}$/.test(normalizeMobilePhone(value));
}

function markPendingRemoteSync() {
	localStorage.setItem(PENDING_SYNC_KEY, String(Date.now()));
}

function clearPendingRemoteSync() {
	localStorage.removeItem(PENDING_SYNC_KEY);
	localStorage.removeItem(PENDING_MINIMUM_STUDY_KEY);
}

function hasPendingRemoteSync() {
	return Boolean(localStorage.getItem(PENDING_SYNC_KEY));
}

function getPendingMinimumStudyUpdates() {
	try {
		const value = JSON.parse(localStorage.getItem(PENDING_MINIMUM_STUDY_KEY) || "[]");
		return Array.isArray(value) ? new Set(value.map(String)) : new Set();
	} catch {
		return new Set();
	}
}

function markPendingMinimumStudyUpdate(subjectId) {
	if (!subjectId) return;
	const pending = getPendingMinimumStudyUpdates();
	pending.add(String(subjectId));
	localStorage.setItem(PENDING_MINIMUM_STUDY_KEY, JSON.stringify([...pending]));
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
	const pendingMinimumStudyUpdates = getPendingMinimumStudyUpdates();
	return {
		...state,
		userSettings: normalizeUserSettings(state.userSettings),
		subjectsByChild: Object.fromEntries(
			Object.entries(state.subjectsByChild || {}).map(([child, subjects]) => [
				child,
				Array.isArray(subjects)
					? subjects.map((subject) => {
							const scheduleTime = normalizeScheduleTime(subject.scheduleTime ?? subject.schedule_time);
							const minimumStudyMinutes = readOptionalMinimumStudyMinutes(subject);
							const scheduleDays = Array.isArray(subject.scheduleDays) ? subject.scheduleDays : subject.schedule_days || [];
							return {
								...subject,
								subjectSettingId: subject.subjectSettingId ?? subject.subject_setting_id ?? "",
								scheduleDays,
								scheduleTime,
								minimumStudyMinutes,
								minimumStudyMinutesSource: pendingMinimumStudyUpdates.has(String(subject.id)) ? "book-dialog" : "",
								startDate: subject.startDate ?? subject.start_date ?? "",
								endDate: subject.endDate ?? subject.end_date ?? "",
								rewardEnabled: Boolean(subject.rewardEnabled ?? subject.reward_enabled),
								rewardAmount: normalizeRewardAmount(subject.rewardAmount ?? subject.reward_amount),
								rewardLabel: normalizeRewardLabel(subject.rewardLabel ?? subject.reward_label),
								subject_setting_id: subject.subjectSettingId ?? subject.subject_setting_id ?? "",
								schedule_days: scheduleDays,
								schedule_time: scheduleTime,
								minimum_study_minutes: minimumStudyMinutes,
								minimum_study_minutes_source: pendingMinimumStudyUpdates.has(String(subject.id)) ? "book-dialog" : "",
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
		clearTimeout(syncStateTimer);
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
		clearPendingRemoteSync();
		setSyncStatus("서버에 저장됨");
		return true;
	} catch (error) {
		setSyncStatus("저장 실패", true);
		console.warn("Failed to sync study state.", error);
		return false;
	}
}

function flushPendingRemoteState() {
	if (!hasPendingRemoteSync() || isHydratingRemoteState) return;
	clearTimeout(syncStateTimer);
	try {
		fetch("/api/state", {
			method: "PUT",
			headers: {
				Authorization: `Bearer ${authToken}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ state: getStateForSync() }),
			keepalive: true,
		}).catch(() => {});
	} catch {
		// The pending marker remains, so the next load retries before pulling remote state.
	}
}

async function requestTeacherJson(path, options = {}) {
	const response = await fetch(path, {
		...options,
		headers: {
			Authorization: `Bearer ${authToken}`,
			"Content-Type": "application/json",
			...(options.headers || {}),
		},
	});
	if (!isJsonResponse(response)) throw new Error("StudyFlow API 응답이 아닙니다.");
	if (response.status === 401) {
		logout();
		throw new Error("로그인이 필요합니다.");
	}
	const data = await response.json().catch(() => ({}));
	if (!response.ok) throw new Error(data.message || "요청을 처리하지 못했습니다.");
	return data;
}

function applyUpdatedProfile(user) {
	state.profile = normalizeProfile(user);
	localStorage.setItem(`${AUTH_USER_KEY_PREFIX}teacher`, JSON.stringify({ ...authUser, ...user, role: "teacher" }));
	localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
	renderProfile();
	renderMyPage();
}

async function uploadProfilePhoto(file) {
	if (!file) return;
	if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
		alert("jpg, png, webp 형식의 이미지만 등록할 수 있습니다.");
		return;
	}
	if (file.size > 5 * 1024 * 1024) {
		alert("프로필 사진은 5MB 이하로 등록하세요.");
		return;
	}

	const formData = new FormData();
	formData.append("photo", file);
	const response = await fetch("/api/auth/profile/photo", {
		method: "POST",
		headers: {
			Authorization: `Bearer ${authToken}`,
		},
		body: formData,
	});
	if (!isJsonResponse(response)) throw new Error("StudyFlow API 응답이 아닙니다.");
	if (response.status === 401) {
		logout();
		throw new Error("로그인이 필요합니다.");
	}
	const data = await response.json().catch(() => ({}));
	if (!response.ok) throw new Error(data.message || "프로필 사진을 저장하지 못했습니다.");
	applyUpdatedProfile(data.user);
	setSyncStatus("프로필 사진 저장 완료");
}

async function resetProfilePhoto() {
	const response = await fetch("/api/auth/profile/photo", {
		method: "DELETE",
		headers: {
			Authorization: `Bearer ${authToken}`,
		},
	});
	if (!isJsonResponse(response)) throw new Error("StudyFlow API 응답이 아닙니다.");
	if (response.status === 401) {
		logout();
		throw new Error("로그인이 필요합니다.");
	}
	const data = await response.json().catch(() => ({}));
	if (!response.ok) throw new Error(data.message || "프로필 사진을 초기화하지 못했습니다.");
	applyUpdatedProfile(data.user);
	setSyncStatus("프로필 사진 초기화 완료");
}

async function saveTeacherComment() {
	const input = els.mypageContent.querySelector("[data-teacher-comment-input]");
	const button = els.mypageContent.querySelector("[data-teacher-comment-save]");
	if (!input) return;
	const teacherComment = String(input.value || "").trim().slice(0, 200);
	if (button) button.disabled = true;
	try {
		const data = await requestTeacherJson("/api/auth/profile/comment", {
			method: "PUT",
			body: JSON.stringify({ teacherComment }),
		});
		applyUpdatedProfile(data.user);
		setSyncStatus("선생님 한마디 저장 완료");
		showTeacherToast("선생님 한마디를 저장했습니다.");
	} catch (error) {
		showTeacherToast(error.message || "선생님 한마디를 저장하지 못했습니다.", true);
	} finally {
		if (button) button.disabled = false;
	}
}

function openProfilePhotoDialog() {
	if (!els.profilePhotoDialog) return;
	const resetButton = els.profilePhotoDialog.querySelector("[data-profile-photo-clear]");
	if (resetButton) {
		const hasPhoto = Boolean(String(state.profile.profileImageUrl || "").trim());
		resetButton.disabled = !hasPhoto;
		resetButton.classList.toggle("is-disabled", !hasPhoto);
	}
	els.profilePhotoDialog.showModal();
}

function closeProfilePhotoDialog() {
	if (els.profilePhotoDialog?.open) els.profilePhotoDialog.close();
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
		return data.entry || entry;
	} catch (error) {
		setSyncStatus("학습 기록 저장 실패", true);
		console.warn("Failed to save entry.", error);
		return null;
	}
}

async function notifyStudentManualSchedule(entry) {
	const childKey = getEntryChildKey(entry);
	const childAccount = getChildAccount(childKey);
	const subject = getSubjectsForChild(childKey).find((item) => item.id === entry.subjectId);
	if (!childAccount?.id || !subject) return;

	try {
		await fetch("/api/push/teacher-schedule", {
			method: "POST",
			headers: {
				Authorization: `Bearer ${authToken}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				childId: childAccount.id,
				childName: childAccount.name,
				subjectName: subject.name,
				bookName: subject.book,
				date: entry.date,
				amount: entry.amount || "",
				memo: entry.memo || "",
			}),
		});
	} catch (error) {
		console.warn("Failed to send manual schedule push.", error);
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
		if (hasPendingRemoteSync()) {
			const synced = await syncRemoteState();
			if (!synced) {
				render();
				showPage(getPageAfterHydration());
				promptForRequiredChildRegistration();
				return;
			}
		}

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
		weekStart = getDefaultWeekStart();
		localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
		render();
		showPage(getPageAfterHydration());
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
	window.location.href = "./child.html?required=1";
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

function showTeacherToast(text, isError = false) {
	if (!els.teacherToast) return;
	window.clearTimeout(teacherToastTimer);
	els.teacherToast.textContent = text;
	els.teacherToast.classList.toggle("is-error", isError);
	els.teacherToast.classList.add("is-visible");
	teacherToastTimer = window.setTimeout(() => {
		els.teacherToast.classList.remove("is-visible");
	}, isError ? 4000 : 2400);
}

function consumeAccessLogSkip() {
	try {
		const value = sessionStorage.getItem(ACCESS_LOG_SKIP_KEY);
		if (!value) return false;
		sessionStorage.removeItem(ACCESS_LOG_SKIP_KEY);
		const createdAt = Number(value) || 0;
		return createdAt > 0 && Date.now() - createdAt <= ACCESS_LOG_SKIP_TTL_MS;
	} catch {
		return false;
	}
}

async function recordStartupAccessLog() {
	const now = Date.now();
	if (consumeAccessLogSkip()) {
		lastAccessLogAt = now;
		return;
	}
	if (now - lastAccessLogAt < ACCESS_LOG_THROTTLE_MS) return;
	lastAccessLogAt = now;
	try {
		const response = await fetch("/api/auth/access-log", {
			method: "POST",
			headers: {
				Authorization: `Bearer ${authToken}`,
				...getClientHeaders(),
			},
		});
		if (response.status === 401) {
			logout();
			return;
		}
		if (!response.ok) console.warn("Failed to record startup access log.");
	} catch (error) {
		console.warn("Failed to record startup access log.", error);
	}
}

function getClientHeaders() {
	if (!window.StudyFlowPush?.isNativeApp?.()) return {};
	return {
		"X-StudyFlow-Client": "mobile-app",
		"X-StudyFlow-Platform": window.Capacitor?.getPlatform?.() || "app",
	};
}

function setupNativeAccessLogEvents() {
	const appPlugin = window.Capacitor?.Plugins?.App;
	if (!appPlugin?.addListener || !window.StudyFlowPush?.isNativeApp?.()) return;
	appPlugin.addListener("resume", () => {
		recordStartupAccessLog();
	});
	appPlugin.addListener("appStateChange", (state) => {
		if (state?.isActive) recordStartupAccessLog();
	});
}

function logout() {
	window.StudyFlowPush?.unregisterNativeAppToken(authToken).catch((error) => {
		console.warn("Failed to unregister native push token.", error);
	});
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

function startOfToday(date = new Date()) {
	const copy = new Date(date);
	copy.setHours(0, 0, 0, 0);
	return copy;
}

function getDefaultWeekStart(date = new Date()) {
	return normalizeUserSettings(state?.userSettings).weekStartMode === "today" ? startOfToday(date) : startOfWeek(date);
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
	const filteredChildren = getVisibleChildKeysByStatus();
	if (!weekSearchQuery) return filteredChildren;
	return filteredChildren.filter((child) => childMatchesWeekSearch(child));
}

function getVisibleSubjectsForChild(child) {
	const activeSubjects = getActiveSubjectsForChild(child);
	const subjectFiltered = weekSubjectFilter === "all" ? activeSubjects : activeSubjects.filter((subject) => getSubjectSetting(subject)?.id === weekSubjectFilter);
	if (!weekSearchQuery) return subjectFiltered;
	if (getChildName(child).toLowerCase().includes(weekSearchQuery)) return subjectFiltered;
	return subjectFiltered.filter((subject) => subjectMatchesWeekSearch(subject));
}

function getVisibleEntriesForChildInWeek(child, dates) {
	return Object.values(state.entries).filter((entry) => {
		if (getEntryChildKey(entry) !== child || !dates.includes(entry.date)) return false;
		const subject = getSubjectForEntry(entry);
		if (weekSubjectFilter !== "all" && getSubjectSetting(subject)?.id !== weekSubjectFilter) return false;
		if (!weekSearchQuery || getChildName(child).toLowerCase().includes(weekSearchQuery)) return true;
		return subject ? subjectMatchesWeekSearch(subject) : false;
	});
}

function childMatchesWeekSearch(child) {
	const query = weekSearchQuery;
	if (getChildName(child).toLowerCase().includes(query)) return true;
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
	renderSettingsPage();
	renderAccessLogsPage();
}

function renderProfile() {
	if (!els.profileName || !els.profileEmail) return;
	els.profileName.textContent = state.profile.name;
	els.profileEmail.textContent = state.profile.email;
}

function getSavedPage(defaultPage = "weekly") {
	try {
		const savedPage = localStorage.getItem(PAGE_STORAGE_KEY) || sessionStorage.getItem(LEGACY_PAGE_STORAGE_KEY);
		return Array.from(els.pageViews).some((view) => view.dataset.page === savedPage) ? savedPage : defaultPage;
	} catch {
		return defaultPage;
	}
}

function getStartupPage() {
	const userSettings = normalizeUserSettings(state.userSettings);
	return userSettings.startupScreenMode === "last" ? getSavedPage("weekly") : "weekly";
}

function getRequestedPage() {
	try {
		const requestedPage = new URLSearchParams(window.location.search).get("page");
		return Array.from(els.pageViews).some((view) => view.dataset.page === requestedPage) ? requestedPage : "";
	} catch {
		return "";
	}
}

function consumeLoginStartupRequest() {
	try {
		const requested = sessionStorage.getItem(TEACHER_LOGIN_STARTUP_KEY) === "1";
		if (requested) sessionStorage.removeItem(TEACHER_LOGIN_STARTUP_KEY);
		return requested;
	} catch {
		return false;
	}
}

function getPageAfterHydration() {
	return getRequestedPage() || (consumeLoginStartupRequest() ? getStartupPage() : getSavedPage("weekly"));
}

function getStorablePage(page) {
	return ["subjects", "settings", "accesslogs"].includes(page) ? "mypage" : page;
}

function showPage(page) {
	const nextPage = Array.from(els.pageViews).some((view) => view.dataset.page === page) ? page : "weekly";
	activePage = nextPage;
	els.pageViews.forEach((view) => {
		view.classList.toggle("active", view.dataset.page === nextPage);
	});
	if (els.topbarThemeSlot) {
		els.topbarThemeSlot.hidden = nextPage !== "mypage";
	}
	const navPage = ["subjects", "settings", "accesslogs"].includes(nextPage) ? "mypage" : nextPage;
	els.navItems.forEach((item) => {
		item.classList.toggle("active", item.dataset.targetPage === navPage);
	});
	try {
		localStorage.setItem(PAGE_STORAGE_KEY, getStorablePage(nextPage));
	} catch {}
}

function isNativeApp() {
	if (window.StudyFlowPush?.isNativeApp?.()) return true;
	if (typeof window.Capacitor?.isNativePlatform === "function") return window.Capacitor.isNativePlatform();
	return ["android", "ios"].includes(window.Capacitor?.getPlatform?.());
}

function closeOpenDialogForBack() {
	const dialog = document.querySelector("dialog[open]");
	if (!dialog || (dialog === els.childAccountDialog && isForcingChildRegistration)) return false;
	dialog.close();
	return true;
}

function setupNativeBackButton() {
	const appPlugin = window.Capacitor?.Plugins?.App;
	if (!isNativeApp() || !appPlugin?.addListener) return;

	appPlugin.addListener("backButton", () => {
		if (closeOpenDialogForBack()) return;
		if (activePage !== "weekly") {
			showPage("weekly");
			return;
		}
		appPlugin.exitApp();
	});
}

function renderWeekRange() {
	const weekEnd = addDays(weekStart, 6);
	els.weekRange.textContent = `${formatDate(weekStart)} ~ ${formatDate(weekEnd)}`;
}

function renderWeekChildFilter() {
	const current = weekChildFilter;
	els.weekChildFilter.innerHTML = `
		<option value="active">표시 학생</option>
		<option value="hidden">숨김 학생</option>
		<option value="all">전체 학생</option>
	`;
	els.weekChildFilter.value = ["active", "hidden", "all"].includes(current) ? current : "active";
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

	els.historyChild.innerHTML = `<option value="all">전체 학생</option>${state.childAccounts.map((child) => `<option value="${escapeHtml(getChildKey(child))}">${escapeHtml(getChildOptionLabel(child))}</option>`).join("")}`;
	els.historySubjectSetting.innerHTML = `<option value="all">전체 과목</option>${state.subjectSettings.map((subject) => `<option value="${escapeHtml(subject.id)}">${escapeHtml(subject.name)}</option>`).join("")}`;
	els.historySubject.innerHTML = `<option value="all">전체 교재</option>${subjects
		.map(({ child, subject }) => `<option value="${child}__${subject.id}">${escapeHtml(getChildName(child))} · ${escapeHtml(subject.name)} / ${escapeHtml(subject.book)}</option>`)
		.join("")}`;

	els.historyChild.value = children.includes(childValue) ? childValue : "all";
	els.historySubjectSetting.value = state.subjectSettings.some((subject) => subject.id === subjectSettingValue) ? subjectSettingValue : "all";
	els.historySubject.value = subjects.some(({ child, subject }) => `${child}__${subject.id}` === subjectValue) ? subjectValue : "all";
}

function renderPendingFilters() {
	if (!els.pendingChild) return;
	const childValue = els.pendingChild.value || "all";
	const subjectSettingValue = els.pendingSubjectSetting.value || "all";

	els.pendingChild.innerHTML = `<option value="all">전체 학생</option>${state.childAccounts.map((child) => `<option value="${escapeHtml(getChildKey(child))}">${escapeHtml(getChildOptionLabel(child))}</option>`).join("")}`;
	els.pendingSubjectSetting.innerHTML = `<option value="all">전체 과목</option>${state.subjectSettings.map((subject) => `<option value="${escapeHtml(subject.id)}">${escapeHtml(subject.name)}</option>`).join("")}`;

	els.pendingChild.value = children.includes(childValue) ? childValue : "all";
	els.pendingSubjectSetting.value = state.subjectSettings.some((subject) => subject.id === subjectSettingValue) ? subjectSettingValue : "all";
}

function renderSubjectChildSelect() {
	const childAccounts = getActiveChildAccounts();
	const childKeys = childAccounts.map(getChildKey);
	const current = els.subjectChild.value || childKeys[0];
	els.subjectChild.innerHTML = childAccounts.map((child) => `<option value="${escapeHtml(getChildKey(child))}">${escapeHtml(getChildOptionLabel(child))}</option>`).join("");
	els.subjectChild.value = childKeys.includes(current) ? current : childKeys[0];
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
	const minimumStudyOptions = `<option value="0">미설정</option>${Array.from({ length: 12 }, (_, index) => (index + 1) * 10)
		.map((minute) => `<option value="${minute}">${formatMinimumStudyMinutes(minute)}</option>`)
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
	[
		[els.entryMinimumStudyMinutes, minimumStudyOptions],
		[els.minimumStudyMinutes, minimumStudyOptions],
		[els.editMinimumStudyMinutes, minimumStudyOptions],
	].forEach(([select, options]) => {
		if (!select || select.options.length) return;
		select.innerHTML = options;
	});
}

function getEntryMinimumStudyMinutes(entry, subject) {
	if (entry && entry.minimumStudyMinutes !== undefined && entry.minimumStudyMinutes !== null) {
		const entryMinutes = normalizeMinimumStudyMinutes(entry.minimumStudyMinutes);
		if (entryMinutes || entry.amount || entry.memo || entry.completed) return entryMinutes;
	}
	return normalizeMinimumStudyMinutes(subject?.minimumStudyMinutes);
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
	const childAccount = getChildAccount(child);
	const childName = getChildName(child);
	const hidden = isChildHidden(childAccount);
	return `
    <div class="weekly-child-head">
      <div class="weekly-child-title">
        <div class="weekly-child-title-row">
          <strong>${escapeHtml(childName)}${hidden ? ` <span class="child-status-badge">숨김</span>` : ""}</strong>
          <p>이번 주 기록 ${count}개 · 교재 ${bookCount}개 · 과목 ${subjectCount}개</p>
        </div>
        <p class="reward-summary">누적 보상 ${escapeHtml(formatRewardTotal(rewardTotal))}</p>
      </div>
      <div class="weekly-child-actions">
        <button type="button" data-weekly-open-book-dialog="${escapeHtml(child)}" ${isServiceExpired() ? `disabled title="${escapeHtml(getServiceExpiredMessage())}"` : ""}>교재 등록</button>
        <button class="ghost" type="button" data-weekly-child-edit="${escapeHtml(childAccount?.id || "")}" ${childAccount ? "" : "disabled"}>수정</button>
        <button class="ghost" type="button" data-weekly-child-status="${escapeHtml(childAccount?.id || "")}" data-next-status="${hidden ? "active" : "hidden"}" ${childAccount ? "" : "disabled"}>${hidden ? "복원" : "숨김"}</button>
        <button class="ghost timetable-button" type="button" data-child="${escapeHtml(child)}">시간표 출력</button>
        <button class="ghost reward-reset-button" type="button" data-child="${escapeHtml(child)}" ${hasRewardTotal ? "" : "disabled"}>보상 지급 완료</button>
        <button class="danger" type="button" data-weekly-child-delete="${escapeHtml(childAccount?.id || "")}" ${childAccount ? "" : "disabled"}>삭제</button>
      </div>
    </div>
  `;
}

function renderTable() {
	if (state.childAccounts.length === 0) {
		els.weeklyTable.innerHTML = `<div class="empty-state">학생을 먼저 등록하세요.</div>`;
		return;
	}

	const dates = getWeekDates();
	const todayKey = formatDate(new Date());
	const head = `
    <thead>
      <tr>
        <th>과목</th>
        <th>교재</th>
        ${dates
			.map((date, index) => {
				const isToday = formatDate(date) === todayKey;
				return `<th class="${isToday ? "is-today" : ""}">${displayDate(date)} ${dayNames[index]}${isToday ? `<span class="today-column-badge">오늘</span>` : ""}</th>`;
			})
			.join("")}
      </tr>
    </thead>
  `;

	const sections = getVisibleChildren()
		.map((child) => {
			const childSubjects = sortSubjectsForTable(getVisibleSubjectsForChild(child));
			const subjectGroups = groupSubjectsByName(childSubjects);

			if (childSubjects.length === 0) {
				return `
          <section class="weekly-child-section" aria-label="${escapeHtml(getChildName(child))} 주간 학습">
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
									const attachmentBadge = completed
										? `<span class="attachment-count-badge" data-weekly-attachment-count data-child="${escapeHtml(child)}" data-subject-id="${escapeHtml(subject.id)}" data-date="${dateKey}" hidden></span>`
										: "";
									return `
                <td>
                  <button class="entry-cell ${entry ? "has-entry" : ""} ${completed ? "is-complete" : ""} ${planned ? "is-planned" : ""}" type="button"
                    data-child="${escapeHtml(child)}" data-subject-id="${escapeHtml(subject.id)}" data-date="${dateKey}">
                    ${
						entry
							? `<span class="entry-status-row">
                            ${completed ? `<span class="entry-status">완료</span>` : `<span class="entry-status pending">진행중</span>`}
                            ${entry.rewardAwarded ? `<span class="reward-badge">+${escapeHtml(formatReward(entry.rewardAmount, entry.rewardLabel))}</span>` : ""}
                            ${attachmentBadge}
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
                    <button class="book-menu-btn" type="button" aria-label="${escapeHtml(getChildName(child))} ${escapeHtml(subject.book)} 메뉴"
                      data-child="${escapeHtml(child)}" data-subject-id="${escapeHtml(subject.id)}">···</button>
                    <div class="book-menu" hidden>
                      <button class="edit-book" type="button" data-child="${escapeHtml(child)}" data-subject-id="${escapeHtml(subject.id)}">수정</button>
                      <button class="copy-book" type="button" data-child="${escapeHtml(child)}" data-subject-id="${escapeHtml(subject.id)}">복사</button>
                      <button class="delete-book" type="button" data-child="${escapeHtml(child)}" data-subject-id="${escapeHtml(subject.id)}">삭제</button>
                    </div>
                  </div>
                </div>
                <span class="book-schedule">${escapeHtml(formatSchedule(subject, { includeMinimumStudy: false }))}</span>
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
        <section class="weekly-child-section" aria-label="${escapeHtml(getChildName(child))} 주간 학습">
          ${renderWeeklyChildHead(child, childSubjects, subjectGroups, dates)}
          <div class="weekly-child-table-wrap">
            <table class="weekly-child-table">${head}<tbody>${rows}</tbody></table>
          </div>
        </section>
      `;
		})
		.join("");

	els.weeklyTable.innerHTML = sections ? `<div class="weekly-child-sections">${sections}</div>` : `<div class="empty-state">검색 조건에 맞는 학생이나 교재가 없습니다.</div>`;
	refreshWeeklyAttachmentBadges();
}

async function fetchEntryAttachmentCount({ child, subjectId, date }) {
	const params = new URLSearchParams({
		childId: child,
		child: getChildName(child),
		subjectId,
		date,
	});
	const response = await fetch(`/api/attachments/entry?${params}`, {
		headers: {
			Authorization: `Bearer ${authToken}`,
		},
	});
	const data = await response.json().catch(() => ({}));
	if (!response.ok) throw new Error(data.message || "첨부 사진 정보를 불러오지 못했습니다.");
	return (data.attachments || []).length;
}

function refreshWeeklyAttachmentBadges() {
	const badges = Array.from(document.querySelectorAll("[data-weekly-attachment-count]"));
	const entryMap = new Map();
	badges.forEach((badge) => {
		const child = badge.dataset.child || "";
		const subjectId = badge.dataset.subjectId || "";
		const date = badge.dataset.date || "";
		if (!child || !subjectId || !date) return;
		entryMap.set(`${child}__${subjectId}__${date}`, { child, subjectId, date });
	});

	entryMap.forEach((entry) => {
		fetchEntryAttachmentCount(entry)
			.then((count) => {
				document.querySelectorAll("[data-weekly-attachment-count]").forEach((badge) => {
					if (badge.dataset.child !== getEntryChildKey(entry) || badge.dataset.subjectId !== entry.subjectId || badge.dataset.date !== entry.date) return;
					badge.hidden = count <= 0;
					badge.textContent = count > 0 ? `사진 ${count}` : "";
				});
			})
			.catch(() => {});
	});
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
			if (childFilter !== "all" && getEntryChildKey(entry) !== childFilter) return false;
			if (subjectSettingFilter !== "all" && getSubjectSetting(subject)?.id !== subjectSettingFilter) return false;
			if (subjectFilter !== "all" && `${getEntryChildKey(entry)}__${entry.subjectId}` !== subjectFilter) return false;
			if (!search) return true;
			return [getChildName(getEntryChildKey(entry)), subject.name, subject.book, formatSchedule(subject), entry.amount, entry.memo, entry.date].join(" ").toLowerCase().includes(search);
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
          <strong><span class="subject-color-dot" style="${escapeHtml(subjectDotStyle(subject))}" aria-hidden="true"></span>${entry.date} · ${escapeHtml(getChildName(getEntryChildKey(entry)))} · ${escapeHtml(subject.name)}</strong>
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
          <strong><span class="subject-color-dot" style="${escapeHtml(subjectDotStyle(subject))}" aria-hidden="true"></span>${escapeHtml(getChildName(child))} · ${escapeHtml(subject.name)} · ${escapeHtml(subject.book)}</strong>
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
	const activeChildCount = new Set(weekEntries.map(getEntryChildKey)).size;

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
	const childEntries = weekEntries.filter((entry) => getEntryChildKey(entry) === child);
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
	const planDetails = getProfilePlanDetails(state.profile);
	const planGradientFrom = normalizePlanColor(state.profile?.plan?.gradientFrom, planDetails.isPaid ? "#426f96" : "#64748b");
	const planGradientTo = normalizePlanColor(state.profile?.plan?.gradientTo, planDetails.isPaid ? "#2ba889" : "#94a3b8");
	const profileImageUrl = String(state.profile.profileImageUrl || "").trim();
	const teacherComment = String(state.profile.teacherComment || "").trim();
	const avatarMarkup = profileImageUrl
		? `<img src="${escapeHtml(profileImageUrl)}" alt="" />`
		: escapeHtml((state.profile.name || "S").slice(0, 1));
	const pushPanelMarkup = shouldShowWebPushPanel()
		? `
    <section class="mypage-menu-section mypage-push-section" aria-label="푸시 알림">
      <button class="mypage-menu-row" type="button" data-push-toggle ${pushState.supported ? "" : "disabled"}>
        <span class="mypage-menu-icon is-push" aria-hidden="true"></span>
        <span class="mypage-menu-main">
          <strong>푸시 알림</strong>
          <small data-push-status>${escapeHtml(getPushStatusText())}</small>
          <small class="form-message" data-push-message></small>
        </span>
        <span class="mypage-menu-value">${pushState.subscribed ? "수신 중" : "설정"}</span>
        <span class="mypage-entry-arrow">›</span>
      </button>
    </section>
`
		: "";

	els.mypageContent.innerHTML = `
    <section class="mypage-hero" aria-label="내 계정">
      <div class="mypage-hero-main">
        <button class="mypage-avatar-large profile-photo-button" type="button" data-profile-photo-open aria-label="프로필 사진 수정">${avatarMarkup}<span class="profile-photo-camera" aria-hidden="true"></span></button>
        <input type="file" accept="image/jpeg,image/png,image/webp" hidden data-profile-photo-input />
        <div class="mypage-hero-copy">
          <p>안녕하세요,</p>
          <h3>${escapeHtml(state.profile.name)}님</h3>
          <span>${escapeHtml(state.profile.email)}</span>
        </div>
      </div>
      <div class="mypage-hero-side">
        <div class="mypage-hero-actions">
          <a class="profile-edit-button" href="./profile.html">내 정보 수정</a>
          <button class="ghost logout-button" type="button" data-logout-button>로그아웃</button>
        </div>
      </div>
      <div class="mypage-teacher-comment">
        <label for="mypageTeacherComment">선생님 한마디</label>
        <div class="mypage-teacher-comment-row">
          <input id="mypageTeacherComment" type="text" maxlength="200" data-teacher-comment-input placeholder="학생에게 보여줄 한마디를 입력하세요." value="${escapeHtml(teacherComment)}">
          <button type="button" data-teacher-comment-save>저장</button>
        </div>
      </div>
    </section>

    <section class="mypage-plan-card ${planDetails.isExpired ? "is-expired" : ""}" aria-label="이용플랜" style="--plan-gradient-from: ${escapeHtml(planGradientFrom)}; --plan-gradient-to: ${escapeHtml(planGradientTo)};">
      <div class="mypage-plan-main">
        <div>
          <p class="eyebrow">Subscription</p>
          <h3>${escapeHtml(planDetails.name)}</h3>
          <p>${escapeHtml(planDetails.periodText)}${planDetails.isExpired ? " · 만료됨" : ""}</p>
        </div>
        <div class="mypage-plan-price">
          <strong>${escapeHtml(planDetails.priceText)}</strong>
          <span>학생 ${escapeHtml(planDetails.limitText)}</span>
        </div>
      </div>
      <div class="mypage-plan-actions">
        ${planDetails.isPaid ? `<button type="button" data-plan-extend>기간 연장</button>` : ""}
        <a href="./payment.html">결제 현황</a>
        <button type="button" data-plan-change>요금제 변경</button>
      </div>
    </section>

    ${pushPanelMarkup}

    <section class="mypage-menu-section" aria-label="마이페이지 메뉴">
      <button class="mypage-menu-row" type="button" data-target-page="subjects">
        <span class="mypage-menu-icon is-subject" aria-hidden="true"></span>
        <span class="mypage-menu-main">
          <strong>과목 설정</strong>
          <small>교재 등록에 사용할 과목 관리</small>
        </span>
        <span class="mypage-menu-value">${state.subjectSettings.length}개</span>
        <span class="mypage-entry-arrow">›</span>
      </button>
      <button class="mypage-menu-row" type="button" data-target-page="settings">
        <span class="mypage-menu-icon is-settings" aria-hidden="true"></span>
        <span class="mypage-menu-main">
          <strong>환경설정</strong>
          <small>화면 테마와 앱 사용 환경</small>
        </span>
        <span class="mypage-entry-arrow">›</span>
      </button>
      <button class="mypage-menu-row" type="button" data-target-page="accesslogs">
        <span class="mypage-menu-icon is-log" aria-hidden="true"></span>
        <span class="mypage-menu-main">
          <strong>접속 로그</strong>
          <small>최근 6개월 계정 접속 기록</small>
        </span>
        <span class="mypage-entry-arrow">›</span>
      </button>
    </section>
  `;

	if (typeof applyTheme === "function" && typeof getSavedTheme === "function") {
		applyTheme(getSavedTheme());
	}
}

function renderAccessLogList() {
	if (accessLogsLoading) return `<div class="empty-state compact">접속 로그를 불러오는 중입니다.</div>`;
	if (!accessLogs.length) return `<div class="empty-state compact">표시할 접속 로그가 없습니다.</div>`;
	return accessLogs
		.map((log) => {
			return `
        <article class="access-log-item">
          <div>
            <strong>${escapeHtml(formatAccessLogDate(log.createdAt))}</strong>
            <p>${escapeHtml(log.ipAddress || "IP 정보 없음")}</p>
          </div>
          <span>${escapeHtml(formatUserAgent(log.userAgent))}</span>
        </article>
      `;
		})
		.join("");
}

function updateAccessLogPanel() {
	if (els.accessLogsContent) els.accessLogsContent.innerHTML = renderAccessLogList();
	const button = els.accessLogsSection?.querySelector("[data-access-log-refresh]");
	if (button) button.disabled = accessLogsLoading;
}

async function loadAccessLogs() {
	if (accessLogsLoading) return;
	accessLogsLoading = true;
	updateAccessLogPanel();
	try {
		const response = await fetch("/api/auth/access-logs?limit=30", {
			headers: { Authorization: `Bearer ${authToken}` },
		});
		if (!isJsonResponse(response)) throw new Error("StudyFlow API 응답이 아닙니다.");
		if (response.status === 401) {
			logout();
			return;
		}
		if (!response.ok) throw new Error("접속 로그를 불러오지 못했습니다.");
		const data = await response.json();
		accessLogs = Array.isArray(data.logs) ? data.logs : [];
	} catch (error) {
		console.warn("Failed to load access logs.", error);
		accessLogs = [];
	} finally {
		accessLogsLoading = false;
		updateAccessLogPanel();
	}
}

function formatAccessLogDate(value) {
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return "-";
	return new Intl.DateTimeFormat("ko-KR", {
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		hour12: false,
	}).format(date);
}

function formatUserAgent(value) {
	const agent = String(value || "");
	if (!agent) return "브라우저 정보 없음";
	if (agent.startsWith("StudyFlow Mobile App")) return "모바일앱";
	if (agent.includes("Edg/")) return "Microsoft Edge";
	if (agent.includes("Chrome/")) return "Chrome";
	if (agent.includes("Safari/")) return "Safari";
	if (agent.includes("Firefox/")) return "Firefox";
	return agent.slice(0, 80);
}

function shouldShowWebPushPanel() {
	return !window.StudyFlowPush?.isNativeApp?.();
}

function getPushStatusText() {
	if (!pushState.supported) return "이 브라우저는 푸시 알림을 지원하지 않습니다.";
	if (pushState.subscribed) return "이 기기는 푸시 알림을 받을 수 있습니다.";
	if (pushState.permission === "denied") return "브라우저에서 알림 권한이 차단되어 있습니다.";
	return "이 기기에서 알림 수신을 등록할 수 있습니다.";
}

function setPushMessage(text, isError = false) {
	const message = els.mypageContent.querySelector("[data-push-message]");
	if (!message) return;
	message.textContent = text;
	message.classList.toggle("is-error", isError);
}

function updatePushPanel() {
	const status = els.mypageContent.querySelector("[data-push-status]");
	const button = els.mypageContent.querySelector("[data-push-toggle]");
	if (status) status.textContent = getPushStatusText();
	if (button) {
		const value = button.querySelector(".mypage-menu-value");
		if (value) value.textContent = pushState.subscribed ? "수신 중" : "설정";
		else button.textContent = pushState.subscribed ? "수신 해제" : "수신 등록";
		button.disabled = !pushState.supported;
	}
}

async function refreshPushState() {
	if (!shouldShowWebPushPanel()) return;
	if (!window.StudyFlowPush) return;
	try {
		pushState = await window.StudyFlowPush.getSubscriptionState(authToken);
		updatePushPanel();
	} catch (error) {
		pushState = { supported: false, subscribed: false, permission: "default" };
		updatePushPanel();
		console.warn("Failed to refresh push state.", error);
	}
}

async function togglePushSubscription() {
	if (!shouldShowWebPushPanel()) return;
	if (!window.StudyFlowPush) {
		setPushMessage("푸시 기능을 사용할 수 없습니다.", true);
		return;
	}

	try {
		setPushMessage(pushState.subscribed ? "수신 해제 중입니다..." : "수신 등록 중입니다...");
		pushState = pushState.subscribed
			? await window.StudyFlowPush.unsubscribe(authToken)
			: await window.StudyFlowPush.subscribe(authToken);
		updatePushPanel();
		setPushMessage(pushState.subscribed ? "수신 등록되었습니다." : "수신 해제되었습니다.");
	} catch (error) {
		setPushMessage(error.message || "푸시 설정을 변경하지 못했습니다.", true);
	}
}

async function saveUserSetting(key, value) {
	state.userSettings = normalizeUserSettings({
		...state.userSettings,
		[key]: value,
	});
	localStorage.setItem(STORAGE_KEY, JSON.stringify(state));

	try {
		setSyncStatus("설정 저장 중");
		const response = await fetch("/api/state/settings", {
			method: "PUT",
			headers: {
				Authorization: `Bearer ${authToken}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ key, value }),
		});
		if (!isJsonResponse(response)) throw new Error("StudyFlow API 응답이 아닙니다.");

		if (response.status === 401) {
			logout();
			return false;
		}

		if (!response.ok) {
			setSyncStatus("설정 저장 실패", true);
			return false;
		}

		setSyncStatus("설정 저장됨");
		return true;
	} catch (error) {
		setSyncStatus("설정 저장 실패", true);
		console.warn("Failed to save user setting.", error);
		return false;
	}
}

function registerNativePushIfAvailable() {
	window.StudyFlowPush?.registerNativeAppToken(authToken).catch((error) => {
		console.warn("Failed to register native push token.", error);
	});
}

function renderSubjectsPage() {
	els.subjectsContent.innerHTML = `
    <div class="subject-settings-list">
      ${state.subjectSettings.map(renderSubjectSettingItem).join("")}
    </div>
  `;
}

function renderSettingsPage() {
	const userSettings = normalizeUserSettings(state.userSettings);
	els.weekStartModeInputs.forEach((input) => {
		input.checked = input.value === userSettings.weekStartMode;
	});
	els.startupScreenModeInputs.forEach((input) => {
		input.checked = input.value === userSettings.startupScreenMode;
	});
}

function updateWeekStartMode(mode) {
	const previousMode = normalizeUserSettings(state.userSettings).weekStartMode;
	saveUserSetting("weekStartMode", mode);
	if (previousMode === mode) return;
	weekStart = getDefaultWeekStart();
	renderWeekRange();
	renderSummary();
	renderTable();
	renderPendingPlans();
	renderStats();
}

function updateStartupScreenMode(mode) {
	saveUserSetting("startupScreenMode", mode);
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
	if (!account && !isForcingChildRegistration && !canAddChildAccount()) {
		alert(getStudentLimitMessage());
		return;
	}
	activeChildEdit = account ? { id: account.id, originalName: account.name } : null;
	els.childAccountMeta.textContent = account ? "Student Account Edit" : "Student Account";
	els.childAccountTitle.textContent = isForcingChildRegistration ? "첫 학생 등록" : account ? "학생 수정" : "학생 등록";
	els.childAccountDialog.classList.toggle("is-required-registration", isForcingChildRegistration);
	els.childAccountName.value = account?.name || "";
	els.childBirthMonth.value = toBirthInputValue(account?.birthMonth || "");
	els.childPhone.value = account?.phone || "";
	els.childParentPhone.value = account?.parentPhone || "";
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
	const phone = normalizeMobilePhone(els.childPhone.value);
	const parentPhone = normalizeMobilePhone(els.childParentPhone.value);
	const existingAccount = activeChildEdit ? state.childAccounts.find((item) => item.id === activeChildEdit.id) : null;
	const existingLoginId = existingAccount?.loginId || "";
	const loginId = existingLoginId || els.childLoginId.value.trim();
	const password = els.childPassword.value.trim();
	const passwordConfirm = els.childPasswordConfirm.value.trim();
	const editingId = activeChildEdit?.id || "";

	if (!name) return;
	if (!activeChildEdit && !canAddChildAccount()) {
		alert(getStudentLimitMessage());
		return;
	}
	if (!isValidKoreanMobilePhone(phone)) {
		alert("학생 휴대폰은 01n-nnnn-nnnn 형식으로 입력하세요.");
		focusDialogField(els.childPhone);
		return;
	}
	if (!isValidKoreanMobilePhone(parentPhone)) {
		alert("학부모 휴대폰은 01n-nnnn-nnnn 형식으로 입력하세요.");
		focusDialogField(els.childParentPhone);
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
		account.name = name;
		account.birthMonth = birthMonth;
		account.phone = phone;
		account.parentPhone = parentPhone;
		account.loginId = existingLoginId || loginId;
		if (password) account.password = password;
	} else {
		const newAccount = {
			id: crypto.randomUUID(),
			name,
			birthMonth,
			phone,
			parentPhone,
			loginId,
			password,
		};
		state.childAccounts.push(newAccount);
		state.subjectsByChild[getChildKey(newAccount)] = [];
	}

	state.childAccounts = sortChildAccountsByBirth(state.childAccounts);
	children = getChildNamesFromState();
	weekChildFilter = ["active", "hidden", "all"].includes(weekChildFilter) ? weekChildFilter : "active";
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
	delete state.subjectsByChild[account.id];
	Object.keys(state.entries).forEach((key) => {
		if (getEntryChildKey(state.entries[key]) === account.id) {
			delete state.entries[key];
		}
	});
	children = getChildNamesFromState();
	weekChildFilter = ["active", "hidden", "all"].includes(weekChildFilter) ? weekChildFilter : "active";
	saveState();
	render();
}

function updateChildStatus(accountId, status) {
	const account = state.childAccounts.find((item) => item.id === accountId);
	if (!account) return;
	account.status = normalizeChildStatus(status);
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
		const key = entryKey(getEntryChildKey(entry), entry.subjectId, entry.date);
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
	els.entryMeta.textContent = `${date} · ${getChildName(child)}`;
	els.entryTitle.textContent = `${subject.name} / ${subject.book}`;
	els.entryAmount.value = entry?.amount || "";
	els.entryMinimumStudyMinutes.value = String(getEntryMinimumStudyMinutes(entry, subject));
	els.entryMemo.value = entry?.memo || "";
	els.entryCompleted.checked = Boolean(entry?.completed);
	if (els.entryCompletedInfo) {
		els.entryCompletedInfo.hidden = !entry?.completed;
		els.entryStudyStartedAt.textContent = entry?.studyStartedAt ? formatDateTime(entry.studyStartedAt) : "-";
		els.entryStudyDuration.textContent = formatStudyDurationSeconds(entry?.studyDurationSeconds) || "-";
		els.entryStudentFeedback.textContent = entry?.studentFeedback?.trim() || "-";
		renderEntryAttachments(entry);
	}
	els.deleteEntry.hidden = !entry;
	const futureEntries = getEntriesFromDate(child, subjectId, date);
	els.pushPlan.hidden = futureEntries.length === 0;
	els.pullPlan.hidden = futureEntries.length === 0;
	els.entryDialog.showModal();
	focusDialogField(els.entryAmount);
}

function openEntryPage(button) {
	if (!button) return;
	window.location.href = `./entry.html?childId=${encodeURIComponent(button.dataset.child || "")}&subjectId=${encodeURIComponent(button.dataset.subjectId || "")}&date=${encodeURIComponent(button.dataset.date || "")}`;
}

function clearEntryAttachmentObjectUrls() {
	entryAttachmentObjectUrls.forEach((url) => URL.revokeObjectURL(url));
	entryAttachmentObjectUrls = [];
}

function getAttachmentGallery() {
	let gallery = document.querySelector("#attachmentGallery");
	if (gallery) return gallery;
	gallery = document.createElement("div");
	gallery.id = "attachmentGallery";
	gallery.className = "attachment-gallery";
	gallery.hidden = true;
	gallery.innerHTML = `
    <div class="attachment-gallery-backdrop" data-gallery-close></div>
    <div class="attachment-gallery-panel" role="dialog" aria-modal="true" aria-label="첨부 사진 보기">
      <button class="attachment-gallery-close" type="button" data-gallery-close aria-label="닫기">×</button>
      <button class="attachment-gallery-nav attachment-gallery-prev" type="button" data-gallery-prev aria-label="이전 사진">‹</button>
      <img class="attachment-gallery-image" alt="">
      <button class="attachment-gallery-nav attachment-gallery-next" type="button" data-gallery-next aria-label="다음 사진">›</button>
      <div class="attachment-gallery-caption">
        <strong data-gallery-title></strong>
        <span data-gallery-count></span>
      </div>
      <div class="attachment-gallery-tools" aria-label="사진 보기 도구">
        <button type="button" data-gallery-rotate-left aria-label="왼쪽으로 회전"><span>↺</span><b>왼쪽 회전</b></button>
        <button type="button" data-gallery-rotate-right aria-label="오른쪽으로 회전"><span>↻</span><b>오른쪽 회전</b></button>
        <button type="button" data-gallery-zoom-out aria-label="축소"><span>−</span><b>축소</b></button>
        <button type="button" data-gallery-zoom-reset aria-label="원본 크기"><span>1:1</span><b>원본</b></button>
        <button type="button" data-gallery-zoom-in aria-label="확대"><span>+</span><b>확대</b></button>
      </div>
    </div>
  `;
	(els.entryDialog || document.body).appendChild(gallery);
	gallery.addEventListener("click", (event) => {
		if (event.target.closest("[data-gallery-close]")) closeAttachmentGallery();
		if (event.target.closest("[data-gallery-prev]")) moveAttachmentGallery(-1);
		if (event.target.closest("[data-gallery-next]")) moveAttachmentGallery(1);
		if (event.target.closest("[data-gallery-rotate-left]")) rotateAttachmentGallery(-90);
		if (event.target.closest("[data-gallery-rotate-right]")) rotateAttachmentGallery(90);
		if (event.target.closest("[data-gallery-zoom-out]")) zoomAttachmentGallery(-0.25);
		if (event.target.closest("[data-gallery-zoom-in]")) zoomAttachmentGallery(0.25);
		if (event.target.closest("[data-gallery-zoom-reset]")) resetAttachmentGalleryZoom();
	});
	gallery.addEventListener("pointerdown", handleAttachmentGalleryPointerDown);
	gallery.addEventListener("pointermove", handleAttachmentGalleryPointerMove);
	gallery.addEventListener("pointerup", handleAttachmentGalleryPointerUp);
	gallery.addEventListener("pointercancel", handleAttachmentGalleryPointerUp);
	return gallery;
}

function updateAttachmentGallery() {
	const gallery = getAttachmentGallery();
	const item = attachmentGalleryState.items[attachmentGalleryState.index];
	const image = gallery.querySelector(".attachment-gallery-image");
	const title = gallery.querySelector("[data-gallery-title]");
	const count = gallery.querySelector("[data-gallery-count]");
	const prev = gallery.querySelector("[data-gallery-prev]");
	const next = gallery.querySelector("[data-gallery-next]");
	if (!item || !image || !title || !count) return;
	image.src = item.url;
	image.alt = item.name || "첨부 사진";
	image.style.transform = `rotate(${attachmentGalleryState.rotations[item.id] || 0}deg) scale(${attachmentGalleryState.zooms[item.id] || 1})`;
	title.textContent = item.name || "첨부 사진";
	count.textContent = `${attachmentGalleryState.index + 1} / ${attachmentGalleryState.items.length}`;
	const single = attachmentGalleryState.items.length <= 1;
	if (prev) prev.disabled = single;
	if (next) next.disabled = single;
}

function moveAttachmentGallery(direction) {
	const total = attachmentGalleryState.items.length;
	if (!total) return;
	attachmentGalleryState.index = (attachmentGalleryState.index + direction + total) % total;
	updateAttachmentGallery();
}

function rotateAttachmentGallery(degrees) {
	const item = attachmentGalleryState.items[attachmentGalleryState.index];
	if (!item) return;
	const current = attachmentGalleryState.rotations[item.id] || 0;
	attachmentGalleryState.rotations[item.id] = (current + degrees + 360) % 360;
	updateAttachmentGallery();
}

function zoomAttachmentGallery(delta) {
	const item = attachmentGalleryState.items[attachmentGalleryState.index];
	if (!item) return;
	const current = attachmentGalleryState.zooms[item.id] || 1;
	setAttachmentGalleryZoom(item, current + delta);
}

function setAttachmentGalleryZoom(item, zoom) {
	attachmentGalleryState.zooms[item.id] = Math.max(0.5, Math.min(3, Math.round(zoom * 100) / 100));
	updateAttachmentGallery();
}

function resetAttachmentGalleryZoom() {
	const item = attachmentGalleryState.items[attachmentGalleryState.index];
	if (!item) return;
	attachmentGalleryState.zooms[item.id] = 1;
	updateAttachmentGallery();
}

function getPointerDistance(first, second) {
	return Math.hypot(first.x - second.x, first.y - second.y);
}

function handleAttachmentGalleryPointerDown(event) {
	if (!event.target.closest(".attachment-gallery-image")) return;
	event.preventDefault();
	event.currentTarget.setPointerCapture?.(event.pointerId);
	attachmentGalleryState.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
	if (attachmentGalleryState.pointers.size === 1) {
		attachmentGalleryState.dragStart = { x: event.clientX, y: event.clientY };
	}
	if (attachmentGalleryState.pointers.size === 2) {
		const [first, second] = [...attachmentGalleryState.pointers.values()];
		const item = attachmentGalleryState.items[attachmentGalleryState.index];
		attachmentGalleryState.pinchStart = {
			distance: getPointerDistance(first, second),
			zoom: item ? attachmentGalleryState.zooms[item.id] || 1 : 1,
		};
	}
}

function handleAttachmentGalleryPointerMove(event) {
	if (!attachmentGalleryState.pointers.has(event.pointerId)) return;
	event.preventDefault();
	attachmentGalleryState.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
	if (attachmentGalleryState.pointers.size !== 2 || !attachmentGalleryState.pinchStart) return;
	const [first, second] = [...attachmentGalleryState.pointers.values()];
	const item = attachmentGalleryState.items[attachmentGalleryState.index];
	if (!item) return;
	const nextZoom = attachmentGalleryState.pinchStart.zoom * (getPointerDistance(first, second) / attachmentGalleryState.pinchStart.distance);
	setAttachmentGalleryZoom(item, nextZoom);
}

function handleAttachmentGalleryPointerUp(event) {
	const wasPinching = attachmentGalleryState.pointers.size > 1;
	attachmentGalleryState.pointers.delete(event.pointerId);
	if (!wasPinching && attachmentGalleryState.dragStart) {
		const dx = event.clientX - attachmentGalleryState.dragStart.x;
		const dy = event.clientY - attachmentGalleryState.dragStart.y;
		const item = attachmentGalleryState.items[attachmentGalleryState.index];
		const zoom = item ? attachmentGalleryState.zooms[item.id] || 1 : 1;
		if (Math.abs(dx) > 56 && Math.abs(dx) > Math.abs(dy) * 1.4 && zoom <= 1.05) {
			moveAttachmentGallery(dx < 0 ? 1 : -1);
		}
	}
	if (attachmentGalleryState.pointers.size < 2) attachmentGalleryState.pinchStart = null;
	if (attachmentGalleryState.pointers.size === 0) attachmentGalleryState.dragStart = null;
}

function closeAttachmentGallery() {
	const gallery = getAttachmentGallery();
	gallery.hidden = true;
	document.body.classList.remove("is-attachment-gallery-open");
	if (attachmentGalleryState.keyHandler) {
		document.removeEventListener("keydown", attachmentGalleryState.keyHandler);
		attachmentGalleryState.keyHandler = null;
	}
}

function openAttachmentGallery(items, index = 0) {
	const availableItems = items.filter((item) => item.url);
	if (!availableItems.length) return;
	attachmentGalleryState.items = availableItems;
	attachmentGalleryState.index = Math.max(0, Math.min(index, availableItems.length - 1));
	attachmentGalleryState.rotations = {};
	attachmentGalleryState.zooms = {};
	attachmentGalleryState.pointers.clear();
	attachmentGalleryState.dragStart = null;
	attachmentGalleryState.pinchStart = null;
	const gallery = getAttachmentGallery();
	gallery.hidden = false;
	document.body.classList.add("is-attachment-gallery-open");
	updateAttachmentGallery();
	if (attachmentGalleryState.keyHandler) document.removeEventListener("keydown", attachmentGalleryState.keyHandler);
	attachmentGalleryState.keyHandler = (event) => {
		if (event.key === "Escape") closeAttachmentGallery();
		if (event.key === "ArrowLeft") moveAttachmentGallery(-1);
		if (event.key === "ArrowRight") moveAttachmentGallery(1);
		if (event.key.toLowerCase() === "q") rotateAttachmentGallery(-90);
		if (event.key.toLowerCase() === "e") rotateAttachmentGallery(90);
		if (event.key === "+" || event.key === "=") zoomAttachmentGallery(0.25);
		if (event.key === "-") zoomAttachmentGallery(-0.25);
		if (event.key === "0") resetAttachmentGalleryZoom();
	};
	document.addEventListener("keydown", attachmentGalleryState.keyHandler);
}

function getAiStatusText(status) {
	if (status === "completed") return "분석 완료";
	if (status === "analyzing") return "분석 중";
	if (status === "failed") return "분석 실패";
	return "분석 전";
}

function renderEntryAiPanel(attachments = []) {
	if (!els.entryAiPanel || !els.entryAnalyzeButton || !els.entryAiStatus || !els.entryAiResult) return;
	const first = attachments[0] || {};
	const status = first.aiStatus || "none";
	const result = String(first.aiResult || "").trim();
	const expired = isServiceExpired();
	els.entryAiPanel.hidden = attachments.length === 0;
	els.entryAnalyzeButton.disabled = attachments.length === 0 || status === "analyzing" || expired;
	els.entryAnalyzeButton.textContent = status === "completed" ? "다시 분석" : status === "analyzing" ? "분석 중" : "AI 분석";
	els.entryAiStatus.textContent = expired ? "이용기간 만료" : getAiStatusText(status);
	els.entryAiStatus.classList.toggle("is-error", status === "failed");
	els.entryAiResult.hidden = !result;
	els.entryAiResult.innerHTML = result ? escapeHtml(result).replaceAll("\n", "<br>") : "";
}

async function analyzeActiveEntryAttachments() {
	if (!activeEntry || !els.entryAnalyzeButton) return;
	if (isServiceExpired()) {
		if (els.entryAiStatus) {
			els.entryAiStatus.textContent = getServiceExpiredMessage();
			els.entryAiStatus.classList.add("is-error");
		}
		showTeacherToast(getServiceExpiredMessage(), true);
		return;
	}
	try {
		els.entryAnalyzeButton.disabled = true;
		els.entryAnalyzeButton.textContent = "분석 중";
		if (els.entryAiStatus) {
			els.entryAiStatus.textContent = "분석 중";
			els.entryAiStatus.classList.remove("is-error");
		}
		if (els.entryAiResult) {
			els.entryAiResult.hidden = true;
			els.entryAiResult.innerHTML = "";
		}
		const response = await fetch("/api/attachments/entry/analyze", {
			method: "POST",
			headers: {
				Authorization: `Bearer ${authToken}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				childId: activeEntry.child,
				child: getChildName(activeEntry.child),
				subjectId: activeEntry.subjectId,
				date: activeEntry.date,
			}),
		});
		const data = await response.json().catch(() => ({}));
		if (!response.ok) throw new Error(data.message || "AI 분석에 실패했습니다.");
		renderEntryAiPanel(data.attachments || [{ aiStatus: data.aiStatus, aiResult: data.aiResult, aiAnalyzedAt: data.aiAnalyzedAt }]);
		renderTable();
	} catch (error) {
		if (els.entryAiStatus) {
			els.entryAiStatus.textContent = error.message || "AI 분석에 실패했습니다.";
			els.entryAiStatus.classList.add("is-error");
		}
		if (els.entryAnalyzeButton) {
			els.entryAnalyzeButton.disabled = false;
			els.entryAnalyzeButton.textContent = "AI 분석";
		}
	}
}

async function renderEntryAttachments(entry) {
	if (!els.entryAttachmentsBlock || !els.entryAttachmentList) return;
	clearEntryAttachmentObjectUrls();
	els.entryAttachmentList.innerHTML = "";
	renderEntryAiPanel([]);
	els.entryAttachmentsBlock.hidden = !entry?.completed;
	if (!entry?.completed || !activeEntry) return;

	els.entryAttachmentList.innerHTML = `<p class="entry-attachment-empty">첨부 사진을 불러오는 중입니다.</p>`;
	try {
		const params = new URLSearchParams({
			childId: activeEntry.child,
			child: getChildName(activeEntry.child),
			subjectId: activeEntry.subjectId,
			date: activeEntry.date,
			markViewed: "true",
		});
		const response = await fetch(`/api/attachments/entry?${params}`, {
			headers: { Authorization: `Bearer ${authToken}` },
		});
		const data = await response.json().catch(() => ({}));
		if (!response.ok) throw new Error(data.message || "첨부 사진을 불러오지 못했습니다.");
		const attachments = data.attachments || [];
		if (!attachments.length) {
			els.entryAttachmentsBlock.hidden = true;
			els.entryAttachmentList.innerHTML = "";
			renderEntryAiPanel([]);
			return;
		}

		els.entryAttachmentsBlock.hidden = false;
		renderEntryAiPanel(attachments);
		els.entryAttachmentList.innerHTML = attachments
			.map((attachment) => `
        <article class="entry-attachment-item" data-attachment-id="${escapeHtml(attachment.id)}">
          <button class="entry-attachment-thumb" type="button" data-open-entry-attachment="${escapeHtml(attachment.id)}">불러오는 중</button>
          <p>${escapeHtml(attachment.originalName || "첨부 사진")}</p>
        </article>
      `)
			.join("");

		await Promise.all(attachments.map(async (attachment) => {
			const fileResponse = await fetch(attachment.fileUrl, {
				headers: { Authorization: `Bearer ${authToken}` },
			});
			if (!fileResponse.ok) return;
			const blob = await fileResponse.blob();
			const url = URL.createObjectURL(blob);
			entryAttachmentObjectUrls.push(url);
			const item = els.entryAttachmentList.querySelector(`[data-attachment-id="${CSS.escape(attachment.id)}"]`);
			const thumb = item?.querySelector(".entry-attachment-thumb");
			if (thumb) {
				thumb.innerHTML = `<img src="${url}" alt="${escapeHtml(attachment.originalName || "첨부 사진")}">`;
				thumb.dataset.attachmentUrl = url;
				thumb.dataset.attachmentName = attachment.originalName || "첨부 사진";
			}
		}));
	} catch (error) {
		els.entryAttachmentList.innerHTML = `<p class="entry-attachment-empty">${escapeHtml(error.message || "첨부 사진을 불러오지 못했습니다.")}</p>`;
	}
}

function saveEntry() {
	if (!activeEntry) return;
	const amount = els.entryAmount.value.trim();
	const minimumStudyMinutes = normalizeMinimumStudyMinutes(els.entryMinimumStudyMinutes.value);
	const memo = els.entryMemo.value.trim();
	const completed = els.entryCompleted.checked;
	let savedEntry = null;
	let shouldSyncEntry = false;
	let shouldNotifyManualSchedule = false;

	if (!amount && !memo && !completed && !minimumStudyMinutes) {
		delete state.entries[activeEntry.key];
	} else {
		const subject = getSubjectsForChild(activeEntry.child).find((item) => item.id === activeEntry.subjectId);
		const validationMessage = getEntryDateValidationMessage(subject, activeEntry.date);
		if (validationMessage) {
			alert(validationMessage);
			return;
		}

		const previousEntry = state.entries[activeEntry.key] || {};
		shouldNotifyManualSchedule = !completed && Boolean(amount || memo || minimumStudyMinutes) && !previousEntry.planned && !previousEntry.amount && !previousEntry.memo && !previousEntry.completed;
		const reward = getRewardForCompletedEntry(subject, completed, previousEntry);

		savedEntry = {
			...previousEntry,
			...activeEntry,
			childId: activeEntry.child,
			child: getChildName(activeEntry.child),
			amount,
			minimumStudyMinutes,
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
	if (shouldSyncEntry) {
		syncTeacherEntry(savedEntry).then((syncedEntry) => {
			if (shouldNotifyManualSchedule && syncedEntry) {
				notifyStudentManualSchedule(syncedEntry);
			}
		});
	}
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
	closeAttachmentGallery();
	clearEntryAttachmentObjectUrls();
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

	const confirmed = confirm(`${getChildName(activeEntry.child)}의 '${subject.name} / ${subject.book}' 계획 ${entriesToMove.length}개를 ${activeEntry.date}부터 하루씩 ${direction}?`);
	if (!confirmed) return;

	const sortedEntries = dayOffset > 0 ? entriesToMove.sort((a, b) => b.date.localeCompare(a.date)) : entriesToMove.sort((a, b) => a.date.localeCompare(b.date));

	sortedEntries.forEach((entry) => {
		delete state.entries[entry.key];
		const movedDate = formatDate(addDays(parseDate(entry.date), dayOffset));
		const movedKey = entryKey(getEntryChildKey(entry), entry.subjectId, movedDate);
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

	const confirmed = confirm(`${getChildName(child)}의 '${subject.name} / ${subject.book}' 교재를 삭제할까요?\n이 교재의 학습 기록도 함께 삭제됩니다.`);
	if (!confirmed) return;

	state.subjectsByChild[child] = getSubjectsForChild(child).filter((item) => item.id !== subjectId);
	Object.keys(state.entries).forEach((key) => {
		const entry = state.entries[key];
		if (getEntryChildKey(entry) === child && entry.subjectId === subjectId) {
			delete state.entries[key];
		}
	});

	saveState();
	render();
}

function openBookDialog(child, subjectId) {
	if (!subjectId && isServiceExpired()) {
		showTeacherToast(getServiceExpiredMessage(), true);
		return;
	}
	const subject = getSubjectsForChild(child).find((item) => item.id === subjectId);
	if (!subject) return;

	activeBookEdit = { child, subjectId };
	els.bookMeta.textContent = getChildName(child);
	renderSubjectDropdowns();
	renderTimeSelects();
	els.editSubjectName.value = getSubjectSetting(subject)?.id || "";
	els.editBookName.value = subject.book;
	setTimeSelectValue(els.editScheduleHour, els.editScheduleMinute, subject.scheduleTime || "");
	els.editMinimumStudyMinutes.value = String(normalizeMinimumStudyMinutes(subject.minimumStudyMinutes));
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
	subject.minimumStudyMinutes = normalizeMinimumStudyMinutes(els.editMinimumStudyMinutes.value);
	delete subject.minimumStudyMinutesExplicit;
	markPendingMinimumStudyUpdate(subject.id);
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
	els.copyMeta.textContent = `${getChildName(child)} · ${subject.name}`;
	els.copyTitle.textContent = subject.book;
	els.copyTargetChild.innerHTML = state.childAccounts
		.filter((item) => getChildKey(item) !== child)
		.map((item) => `<option value="${escapeHtml(getChildKey(item))}">${escapeHtml(getChildOptionLabel(item))}</option>`)
		.join("");
	els.copyStartDate.value = formatDate(new Date());
	els.copyHelp.textContent = entries.length > 0 ? `기록 ${entries.length}개를 날짜순으로 복사합니다. 첫 기록은 시작일에, 다음 기록은 다음 날에 배치됩니다.` : "등록된 학습 기록이 없어서 교재만 복사됩니다.";
	els.copyDialog.showModal();
	focusDialogField(els.copyTargetChild);
}

function copyBook(event) {
	if (event.submitter?.value === "cancel" || !activeCopy) return;
	event.preventDefault();
	if (isServiceExpired()) {
		els.copyDialog.close();
		showTeacherToast(getServiceExpiredMessage(), true);
		return;
	}

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
		minimumStudyMinutes: normalizeMinimumStudyMinutes(sourceSubject.minimumStudyMinutes),
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
			childId: targetChild,
			child: getChildName(targetChild),
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
			minimumStudyMinutes: normalizeMinimumStudyMinutes(entry.minimumStudyMinutes ?? copiedSubject.minimumStudyMinutes),
			copiedFrom: {
				childId: activeCopy.child,
				child: getChildName(activeCopy.child),
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
	if (isServiceExpired()) {
		els.subjectDialog.close();
		showTeacherToast(getServiceExpiredMessage(), true);
		return;
	}
	const child = els.subjectChild.value;
	const subjectSetting = getSubjectSettingById(els.subjectName.value);
	const book = els.bookName.value.trim();
	const scheduleDays = getSelectedScheduleDays("scheduleDay");
	const scheduleTime = getTimeSelectValue(els.scheduleHour, els.scheduleMinute);
	const minimumStudyMinutes = normalizeMinimumStudyMinutes(els.minimumStudyMinutes.value);
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
		minimumStudyMinutes,
		startDate,
		endDate,
		rewardEnabled,
		rewardAmount,
		rewardLabel,
	};
	markPendingMinimumStudyUpdate(subject.id);

	state.subjectsByChild[child].push(subject);
	if (shouldAutoCreatePlan) {
		createAutoPlanEntries(child, subject);
	}
	els.subjectForm.reset();
	els.subjectChild.value = child;
	els.subjectName.value = subjectSetting.id;
	setSelectedScheduleDays("scheduleDay", scheduleDays);
	setTimeSelectValue(els.scheduleHour, els.scheduleMinute, scheduleTime);
	els.minimumStudyMinutes.value = String(minimumStudyMinutes);
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
					childId: child,
					child: getChildName(child),
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
		if (getEntryChildKey(entry) === child && entry.subjectId === subjectId && !entry.completed && !entry.amount && !entry.memo && !entry.rewardAwarded) {
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
	return getSubjectsForChild(getEntryChildKey(entry)).find((subject) => subject.id === entry.subjectId);
}

function getEntryChildKey(entry) {
	return getChildKey(entry?.childId || entry?.child || "");
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
		.filter((entry) => getEntryChildKey(entry) === child && entry.subjectId === subjectId)
		.sort((a, b) => a.date.localeCompare(b.date));
}

function getEntriesFromDate(child, subjectId, date) {
	return getEntriesForBook(child, subjectId).filter((entry) => entry.date >= date);
}

function findMoveConflict(entriesToMove, dayOffset) {
	const movingKeys = new Set(entriesToMove.map((entry) => entry.key));
	return entriesToMove.find((entry) => {
		const targetDate = formatDate(addDays(parseDate(entry.date), dayOffset));
		const targetKey = entryKey(getEntryChildKey(entry), entry.subjectId, targetDate);
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

function normalizeMinimumStudyMinutes(value) {
	const minutes = Number.parseInt(value, 10) || 0;
	if (minutes === 0) return 0;
	if (minutes < 10 || minutes > 120) return 0;
	return Math.floor(minutes / 10) * 10;
}

function readOptionalMinimumStudyMinutes(value) {
	if (!value || typeof value !== "object") return null;
	if (value.minimumStudyMinutes !== undefined && value.minimumStudyMinutes !== null) return normalizeMinimumStudyMinutes(value.minimumStudyMinutes);
	if (value.minimum_study_minutes !== undefined && value.minimum_study_minutes !== null) return normalizeMinimumStudyMinutes(value.minimum_study_minutes);
	return null;
}

function formatMinimumStudyMinutes(value) {
	const minutes = normalizeMinimumStudyMinutes(value);
	if (!minutes) return "최소 시간 미설정";
	const hours = Math.floor(minutes / 60);
	const rest = minutes % 60;
	if (hours && rest) return `${hours}시간 ${rest}분`;
	if (hours) return `${hours}시간`;
	return `${rest}분`;
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

function formatSchedule(subject, options = {}) {
	const days = formatScheduleDays(subject.scheduleDays);
	const time = normalizeScheduleTime(subject.scheduleTime);
	const minimumStudy = normalizeMinimumStudyMinutes(subject.minimumStudyMinutes);
	const scheduleText = days && time ? `${days} · ${time}` : days || time || "수업 일정 미설정";
	if (options.includeMinimumStudy === false) return scheduleText;
	if (!minimumStudy) return scheduleText;
	return `${scheduleText} · 최소 ${formatMinimumStudyMinutes(minimumStudy)}`;
}

function formatShortDate(value) {
	const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
	if (!match) return value;
	return `${Number(match[2])}.${Number(match[3])}`;
}

function formatServiceDate(value) {
	if (!value) return "";
	const text = String(value);
	const dateText = text.includes("T") ? text.slice(0, 10) : text;
	const match = dateText.match(/^(\d{4})-(\d{2})-(\d{2})$/);
	if (!match) return text;
	return `${match[1]}.${match[2]}.${match[3]}`;
}

function isServiceExpired(profile = state.profile) {
	const plan = profile?.plan || {};
	const price = Number(plan.monthlyPrice || 0);
	if (price <= 0) return false;
	const endsAt = profile?.servicePeriod?.endsAt;
	if (!endsAt) return false;
	const expiresAt = new Date(endsAt);
	if (Number.isNaN(expiresAt.getTime())) return false;
	const restrictionStartsAt = new Date(expiresAt);
	restrictionStartsAt.setDate(restrictionStartsAt.getDate() + 1);
	restrictionStartsAt.setHours(0, 0, 0, 0);
	return restrictionStartsAt.getTime() <= Date.now();
}

function getServiceExpiredMessage() {
	return "이용기간이 만료되어 사용할 수 없습니다.";
}

function formatProfilePlanSummary(profile) {
	return getProfilePlanDetails(profile).summary;
}

function getProfilePlanDetails(profile) {
	const plan = profile?.plan || {};
	const period = profile?.servicePeriod || {};
	const planName = plan.name || "베이직";
	const studentLimit = Number(plan.studentLimit || 0);
	const price = Number(plan.monthlyPrice || 0);
	const priceText = price ? `${price.toLocaleString("ko-KR")}원/월` : "무료";
	const limitText = studentLimit ? `${studentLimit}명` : "제한 없음";
	const startText = formatServiceDate(period.startedAt);
	const endText = formatServiceDate(period.endsAt);
	const isPaid = price > 0;
	const periodText = !isPaid ? "기간 제한 없음" : startText && endText ? `${startText} ~ ${endText}` : startText ? `${startText}부터` : "기간 미설정";
	const expired = isServiceExpired(profile);
	return {
		name: planName,
		priceText,
		limitText,
		periodText,
		isExpired: expired,
		isPaid,
		summary: `${planName} · ${priceText} · 학생 ${limitText} · ${periodText}${expired ? " · 만료됨" : ""}`,
	};
}

function getStudentLimit() {
	return Number(state?.profile?.plan?.studentLimit || 0);
}

function canAddChildAccount() {
	const limit = getStudentLimit();
	if (isServiceExpired()) return false;
	return limit <= 0 || state.childAccounts.length < limit;
}

function getStudentLimitMessage() {
	const details = getProfilePlanDetails(state.profile);
	if (details.isExpired) return "이용기간이 만료되어 학생을 추가할 수 없습니다.";
	return `현재 ${details.name} 플랜은 학생 ${getStudentLimit()}명까지 등록할 수 있습니다.`;
}

function setPlanChangeMessage(text = "", isError = false) {
	if (!els.planChangeMessage) return;
	els.planChangeMessage.textContent = text;
	els.planChangeMessage.classList.toggle("is-error", Boolean(isError));
}

function getPlanPriceText(plan) {
	const price = Number(plan?.monthlyPrice || 0);
	return price ? `${price.toLocaleString("ko-KR")}원/월` : "무료";
}

function getPlanTermAmount(plan, term) {
	const months = Number(term?.months || 1);
	const baseAmount = Number(plan?.monthlyPrice || 0) * months;
	const discountRate = Number(term?.discountRate || 0);
	const discountAmount = Math.round((baseAmount * discountRate) / 100);
	return {
		months,
		baseAmount,
		discountRate,
		discountAmount,
		amount: Math.max(0, baseAmount - discountAmount),
	};
}

function getPlanTermText(plan, term) {
	const summary = getPlanTermAmount(plan, term);
	const discountText = summary.discountRate > 0
		? ` · ${summary.discountRate.toLocaleString("ko-KR")}% 할인`
		: "";
	return `${summary.months}개월 · ${summary.amount.toLocaleString("ko-KR")}원${discountText}`;
}

function getPlanLimitText(plan) {
	const limit = Number(plan?.studentLimit || 0);
	return limit ? `학생 ${limit}명` : "학생 제한 없음";
}

async function ensureAvailablePlans() {
	if (availablePlans.length) return availablePlans;
	const data = await requestTeacherJson("/api/auth/plans");
	availablePlans = Array.isArray(data.plans) ? data.plans : [];
	return availablePlans;
}

function renderPlanOptions() {
	if (!els.planOptions) return;
	const currentPlanCode = state.profile?.plan?.code || "basic";
	const childCount = state.childAccounts.length;
	els.planOptions.innerHTML = availablePlans
		.map((plan) => {
			const limit = Number(plan.studentLimit || 0);
			const disabled = limit > 0 && childCount > limit;
			const checked = plan.code === currentPlanCode;
			const statusText = checked ? "현재 이용 중" : disabled ? `현재 학생 ${childCount}명으로 변경 불가` : "변경 가능";
			const gradientFrom = normalizePlanColor(plan.gradientFrom, Number(plan.monthlyPrice || 0) > 0 ? "#426f96" : "#64748b");
			const gradientTo = normalizePlanColor(plan.gradientTo, Number(plan.monthlyPrice || 0) > 0 ? "#2ba889" : "#94a3b8");
			return `
        <label class="plan-option ${checked ? "is-current" : ""} ${disabled ? "is-disabled" : ""}" style="--option-gradient-from: ${escapeHtml(gradientFrom)}; --option-gradient-to: ${escapeHtml(gradientTo)};">
          <input type="radio" name="planCode" value="${escapeHtml(plan.code)}" ${checked ? "checked" : ""} ${disabled ? "disabled" : ""} />
          <span>
            <strong>${escapeHtml(plan.name)}</strong>
            <small>${escapeHtml(getPlanPriceText(plan))} · ${escapeHtml(getPlanLimitText(plan))}</small>
          </span>
          <em>${escapeHtml(statusText)}</em>
        </label>
      `;
		})
		.join("");
}

async function openPlanDialog() {
	try {
		setPlanChangeMessage("요금제 정보를 불러오는 중입니다.");
		els.planDialog.showModal();
		await ensureAvailablePlans();
		renderPlanOptions();
		setPlanChangeMessage("");
	} catch (error) {
		setPlanChangeMessage(error.message, true);
	}
}

function closePlanDialog() {
	els.planDialog.close();
	setPlanChangeMessage("");
}

function updateTeacherProfile(user) {
	state.profile = normalizeProfile(user);
	localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
	localStorage.setItem(`${AUTH_USER_KEY_PREFIX}teacher`, JSON.stringify(user));
	renderProfile();
	renderMyPage();
}

async function savePlanChange(event) {
	event.preventDefault();
	const formData = new FormData(els.planForm);
	const planCode = String(formData.get("planCode") || "").trim();
	const selectedPlan = availablePlans.find((plan) => plan.code === planCode);
	if (!planCode) {
		setPlanChangeMessage("변경할 요금제를 선택하세요.", true);
		return;
	}
	if (!selectedPlan) {
		setPlanChangeMessage("선택한 요금제를 확인하지 못했습니다.", true);
		return;
	}
	if (planCode === (state.profile?.plan?.code || "basic")) {
		closePlanDialog();
		return;
	}

	try {
		els.savePlanChange.disabled = true;
		if (Number(selectedPlan.monthlyPrice || 0) > 0) {
			closePlanDialog();
			await requestPlanPayment(planCode);
			return;
		}

		setPlanChangeMessage("요금제를 변경하는 중입니다.");
		const data = await requestTeacherJson("/api/auth/plan", {
			method: "PUT",
			body: JSON.stringify({ planCode }),
		});
		updateTeacherProfile(data.user);
		closePlanDialog();
	} catch (error) {
		if (els.planDialog.open) setPlanChangeMessage(error.message, true);
		else alert(error.message || "결제창을 준비하지 못했습니다.");
	} finally {
		els.savePlanChange.disabled = false;
	}
}

async function requestPlanPayment(planCode) {
	setPlanChangeMessage("결제창을 준비하는 중입니다.");
	const plans = await ensureAvailablePlans();
	const plan = plans.find((item) => item.code === planCode);
	const term = await selectPaymentTerm(planCode);
	const url = new URL(window.location.href);
	url.search = "";
	url.hash = "";
	const successUrl = new URL(url.href);
	successUrl.searchParams.set("payment", "success");
	const failUrl = new URL(url.href);
	failUrl.searchParams.set("payment", "fail");
	const data = await requestTeacherJson("/api/auth/payments/orders", {
		method: "POST",
		body: JSON.stringify({ planCode, termMonths: term.months, returnUrl: successUrl.href }),
	});
	if (plan && data.order) {
		data.order.planName = plan.name;
	}
	if (data.provider === "innopay") {
		const payMethod = await selectInnopayPayMethod();
		data.innopay = { ...(data.innopay || {}), payMethod };
		await requestInnopayPlanPayment(data, successUrl.href);
		return;
	}
	await requestTossPlanPayment(data, successUrl.href, failUrl.href);
}

function selectPaymentTerm(planCode) {
	const plan = availablePlans.find((item) => item.code === planCode);
	const terms = Array.isArray(plan?.terms) && plan.terms.length
		? plan.terms
		: [{ months: 1, discountRate: 0, sortOrder: 1 }];
	if (!els.paymentTermDialog || terms.length <= 1) {
		return Promise.resolve(terms[0]);
	}

	return new Promise((resolve, reject) => {
		let settled = false;
		let selectedMonths = Number(terms[0].months || 1);
		const dialog = els.paymentTermDialog;

		const render = () => {
			if (!els.paymentTermOptions) return;
			els.paymentTermOptions.innerHTML = terms.map((term) => {
				const summary = getPlanTermAmount(plan, term);
				const selected = summary.months === selectedMonths;
				const discountText = summary.discountRate > 0
					? `<small class="payment-term-discount">${summary.discountRate.toLocaleString("ko-KR")}% 할인</small>`
					: "";
				const baseText = summary.discountAmount > 0
					? `정가 ${summary.baseAmount.toLocaleString("ko-KR")}원 · 할인 ${summary.discountAmount.toLocaleString("ko-KR")}원`
					: `${summary.months}개월 이용권`;
				return `
					<button class="plan-option payment-term-option ${selected ? "is-selected" : ""}" type="button" data-payment-term="${summary.months}">
						<span>
							<strong>${summary.months}개월</strong>
							<small>${escapeHtml(baseText)}</small>
						</span>
						<em>
							${discountText}
							<strong>${summary.amount.toLocaleString("ko-KR")}원</strong>
						</em>
					</button>
				`;
			}).join("");
			if (els.paymentTermMessage) {
				els.paymentTermMessage.textContent = "";
			}
		};

		const cleanup = () => {
			dialog.removeEventListener("click", handleClick);
			els.paymentTermForm?.removeEventListener("submit", handleSubmit);
			els.closePaymentTermDialog?.removeEventListener("click", handleCancel);
			els.cancelPaymentTermDialog?.removeEventListener("click", handleCancel);
			dialog.removeEventListener("cancel", handleCancel);
			dialog.removeEventListener("close", handleClose);
		};
		const finish = () => {
			if (settled) return;
			settled = true;
			cleanup();
			if (dialog.open) dialog.close();
			resolve(terms.find((term) => Number(term.months || 1) === selectedMonths) || terms[0]);
		};
		const cancel = () => {
			if (settled) return;
			settled = true;
			cleanup();
			if (dialog.open) dialog.close();
			reject(new Error("결제가 취소되었습니다."));
		};
		const handleClick = (event) => {
			const button = event.target.closest("[data-payment-term]");
			if (!button) return;
			selectedMonths = Number(button.dataset.paymentTerm || selectedMonths);
			render();
		};
		const handleSubmit = (event) => {
			event.preventDefault();
			finish();
		};
		const handleCancel = (event) => {
			event.preventDefault();
			cancel();
		};
		const handleClose = () => {
			if (!settled) cancel();
		};

		render();
		dialog.addEventListener("click", handleClick);
		els.paymentTermForm?.addEventListener("submit", handleSubmit);
		els.closePaymentTermDialog?.addEventListener("click", handleCancel);
		els.cancelPaymentTermDialog?.addEventListener("click", handleCancel);
		dialog.addEventListener("cancel", handleCancel);
		dialog.addEventListener("close", handleClose);
		dialog.showModal();
	});
}

function selectInnopayPayMethod() {
	if (!els.innopayMethodDialog) return Promise.resolve("CARD");
	return new Promise((resolve, reject) => {
		let settled = false;
		const dialog = els.innopayMethodDialog;

		const cleanup = () => {
			dialog.removeEventListener("click", handleClick);
			els.closeInnopayMethodDialog?.removeEventListener("click", handleCancel);
			dialog.removeEventListener("cancel", handleCancel);
			dialog.removeEventListener("close", handleClose);
		};
		const finish = (method) => {
			if (settled) return;
			settled = true;
			cleanup();
			if (dialog.open) dialog.close();
			resolve(method);
		};
		const cancel = () => {
			if (settled) return;
			settled = true;
			cleanup();
			if (dialog.open) dialog.close();
			reject(new Error("결제가 취소되었습니다."));
		};
		const handleClick = (event) => {
			const button = event.target.closest("[data-innopay-method]");
			if (!button) return;
			const method = String(button.dataset.innopayMethod || "").toUpperCase();
			if (method === "CARD" || method === "EPAY") finish(method);
		};
		const handleCancel = (event) => {
			event.preventDefault();
			cancel();
		};
		const handleClose = () => {
			if (!settled) cancel();
		};

		dialog.addEventListener("click", handleClick);
		els.closeInnopayMethodDialog?.addEventListener("click", handleCancel);
		dialog.addEventListener("cancel", handleCancel);
		dialog.addEventListener("close", handleClose);
		dialog.showModal();
	});
}

async function extendCurrentPlan() {
	const planCode = state.profile?.plan?.code || "";
	if (!planCode || !getProfilePlanDetails(state.profile).isPaid) {
		alert("연장할 유료 요금제가 없습니다.");
		return;
	}

	try {
		await requestPlanPayment(planCode);
	} catch (error) {
		alert(error.message || "결제창을 준비하지 못했습니다.");
	}
}

async function requestTossPlanPayment(data, successUrl, failUrl) {
	if (typeof window.TossPayments !== "function") {
		throw new Error("토스페이먼츠 결제 SDK를 불러오지 못했습니다.");
	}

	const tossPayments = window.TossPayments(data.clientKey);
	const payment = tossPayments.payment({ customerKey: data.customerKey });

	await payment.requestPayment({
		method: "CARD",
		amount: {
			currency: "KRW",
			value: Number(data.order.amount || 0),
		},
		orderId: data.order.orderId,
		orderName: data.order.orderName,
		successUrl,
		failUrl,
	});
}

async function requestInnopayPlanPayment(data, returnUrl) {
	const innopaySdk = await ensureInnopaySdk();
	if (!innopaySdk?.goPay) {
		throw new Error("이노페이 결제 SDK를 불러오지 못했습니다.");
	}
	const buyerTel = normalizePaymentPhone(data.innopay?.buyerTel || state.profile.phone || "");
	if (!buyerTel) {
		throw new Error("이노페이 결제를 위해 내 정보의 휴대폰 번호가 필요합니다.");
	}
	const innopayUserId = normalizeInnopayUserId(data.customerKey || state.profile.email || "");

	innopaySdk.goPay({
		payMethod: data.innopay?.payMethod || "CARD",
		mid: data.innopay?.mid || "",
		moid: data.order.orderId,
		goodsName: data.order.orderName,
		goodsCnt: "1",
		amt: String(data.order.amount),
		taxFreeAmt: "0",
		buyerName: data.innopay?.buyerName || state.profile.name || "StudyFlow",
		buyerTel,
		buyerEmail: data.innopay?.buyerEmail || state.profile.email || "",
		returnUrl,
		currency: "KRW",
		mallReserved: data.order.planCode,
		offeringPeriod: "",
		mallIp: "",
		mallUserId: innopayUserId,
		userIp: "",
		userId: innopayUserId,
		vBankExpDate: "",
		appScheme: "",
		logoUrl: ""
	});
}

function getInnopaySdk() {
	if (typeof innopay !== "undefined") return innopay;
	return window.innopay;
}

function ensureInnopaySdk() {
	const loadedSdk = getInnopaySdk();
	if (loadedSdk?.goPay) return Promise.resolve(loadedSdk);
	const existingScript = document.querySelector("script[data-innopay-sdk], script[src='https://pg.innopay.co.kr/tpay/js/v1/innopay.js']");
	if (existingScript) {
		return new Promise((resolve, reject) => {
			existingScript.addEventListener("load", () => resolve(getInnopaySdk()), { once: true });
			existingScript.addEventListener("error", () => reject(new Error("이노페이 결제 SDK를 불러오지 못했습니다.")), { once: true });
			setTimeout(() => resolve(getInnopaySdk()), 1500);
		});
	}

	return new Promise((resolve, reject) => {
		const script = document.createElement("script");
		script.src = "https://pg.innopay.co.kr/tpay/js/v1/innopay.js";
		script.async = true;
		script.dataset.innopaySdk = "true";
		script.onload = () => resolve(getInnopaySdk());
		script.onerror = () => reject(new Error("이노페이 결제 SDK를 불러오지 못했습니다."));
		document.head.appendChild(script);
	});
}

async function processPaymentRedirect() {
	const params = new URLSearchParams(window.location.search);
	const paymentStatus = params.get("payment") || "";
	if (!paymentStatus) return;
	const provider = params.has("paymentToken") || params.has("tid") || params.has("moid") ? "innopay" : "toss";

	const cleanUrl = new URL(window.location.href);
	cleanUrl.search = "";
	window.history.replaceState({}, "", cleanUrl.href);
	showPage("mypage");

	if (paymentStatus === "fail") {
		alert(params.get("message") || "결제가 완료되지 않았습니다.");
		return;
	}

	const paymentKey = params.get("paymentKey") || "";
	const orderId = params.get("orderId") || params.get("moid") || "";
	const amount = params.get("amount") || params.get("amt") || "";
	if ((provider === "toss" && !paymentKey) || !orderId || !amount) {
		alert("결제 승인 정보가 올바르지 않습니다.");
		return;
	}

	try {
		const data = await requestTeacherJson("/api/auth/payments/confirm", {
			method: "POST",
			body: JSON.stringify({
				provider,
				paymentKey,
				orderId,
				amount,
				paymentToken: params.get("paymentToken") || "",
				tid: params.get("tid") || "",
				mid: params.get("mid") || "",
				taxFreeAmt: params.get("taxFreeAmt") || "0",
				moid: params.get("moid") || "",
			}),
		});
		updateTeacherProfile(data.user);
		alert("결제가 완료되어 요금제가 변경되었습니다.");
	} catch (error) {
		alert(error.message || "결제 승인 처리에 실패했습니다.");
	}
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
		if (getEntryChildKey(entry) !== child || !entry.rewardAwarded || entry.rewardRedeemed) return;
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
		const childKey = getEntryChildKey(entry);
		const key = `${childKey}__${redeemedAt}`;
		const batch = batches.get(key) || {
			child: childKey,
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

function formatStudyDurationSeconds(seconds) {
	const totalSeconds = Number.parseInt(seconds, 10) || 0;
	if (totalSeconds <= 0) return "";
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const remainSeconds = totalSeconds % 60;
	if (hours) return `${hours}시간 ${minutes}분`;
	if (minutes) return `${minutes}분 ${remainSeconds}초`;
	return `${remainSeconds}초`;
}

function getRedeemableRewardEntriesForChild(child) {
	return Object.values(state.entries || {})
		.filter((entry) => getEntryChildKey(entry) === child && entry.rewardAwarded && !entry.rewardRedeemed)
		.sort((a, b) => a.date.localeCompare(b.date));
}

function resetRewardForChild(child) {
	const entries = getRedeemableRewardEntriesForChild(child);
	const totals = getRewardTotalsForEntries(entries);
	if (!totals.length) return;

	activeRewardResetChild = child;
	els.rewardResetMeta.textContent = getChildName(child);
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
		if (getEntryChildKey(entry) === child && entry.rewardAwarded && !entry.rewardRedeemed) {
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
	weekStart = getDefaultWeekStart();
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
		weekStart = getDefaultWeekStart();
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
	els.weekChildAdd.addEventListener("click", () => {
		if (!canAddChildAccount()) {
			alert(getStudentLimitMessage());
			return;
		}
		window.location.href = "./child.html";
	});
}

function renderAccessLogsPage() {
	if (!els.accessLogsContent) return;
	els.accessLogsContent.innerHTML = renderAccessLogList();
}

els.navItems.forEach((item) => {
	item.addEventListener("click", () => showPage(item.dataset.targetPage));
});
els.mypageContent.addEventListener("click", (event) => {
	const photoOpenButton = event.target.closest("[data-profile-photo-open]");
	if (photoOpenButton) {
		openProfilePhotoDialog();
		return;
	}

	const pushToggle = event.target.closest("[data-push-toggle]");
	if (pushToggle) {
		togglePushSubscription();
		return;
	}

	const logoutButton = event.target.closest("[data-logout-button]");
	if (logoutButton) {
		logout();
		return;
	}

	const teacherCommentSave = event.target.closest("[data-teacher-comment-save]");
	if (teacherCommentSave) {
		saveTeacherComment();
		return;
	}

	const planChangeButton = event.target.closest("[data-plan-change]");
	if (planChangeButton) {
		openPlanDialog();
		return;
	}

	const planExtendButton = event.target.closest("[data-plan-extend]");
	if (planExtendButton) {
		extendCurrentPlan();
		return;
	}

	const entryCard = event.target.closest("[data-target-page]");
	if (entryCard) {
		showPage(entryCard.dataset.targetPage);
		return;
	}
});

els.profilePhotoDialog?.addEventListener("click", (event) => {
	const pickButton = event.target.closest("[data-profile-photo-pick]");
	if (pickButton) {
		closeProfilePhotoDialog();
		els.mypageContent.querySelector("[data-profile-photo-input]")?.click();
		return;
	}

	const clearButton = event.target.closest("[data-profile-photo-clear]");
	if (clearButton) {
		if (clearButton.disabled) return;
		closeProfilePhotoDialog();
		resetProfilePhoto().catch((error) => {
			alert(error.message || "프로필 사진을 초기화하지 못했습니다.");
		});
	}
});

els.closeProfilePhotoDialog?.addEventListener("click", closeProfilePhotoDialog);

els.mypageContent.addEventListener("change", (event) => {
	const input = event.target.closest("[data-profile-photo-input]");
	if (!input) return;
	const file = input.files?.[0];
	input.value = "";
	uploadProfilePhoto(file).catch((error) => {
		alert(error.message || "프로필 사진을 저장하지 못했습니다.");
	});
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

els.settingsSection.addEventListener("click", (event) => {
	const backButton = event.target.closest("[data-target-page]");
	if (backButton) showPage(backButton.dataset.targetPage);
});

els.accessLogsSection.addEventListener("click", (event) => {
	const backButton = event.target.closest("[data-target-page]");
	if (backButton) {
		showPage(backButton.dataset.targetPage);
		return;
	}
	const refreshButton = event.target.closest("[data-access-log-refresh]");
	if (refreshButton) loadAccessLogs();
});

els.settingsSection.addEventListener("change", (event) => {
	const weekStartModeInput = event.target.closest("[data-week-start-mode]");
	if (weekStartModeInput?.checked) {
		updateWeekStartMode(weekStartModeInput.value);
		return;
	}

	const startupScreenModeInput = event.target.closest("[data-startup-screen-mode]");
	if (startupScreenModeInput?.checked) updateStartupScreenMode(startupScreenModeInput.value);
});

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
		window.location.href = `./child.html?id=${encodeURIComponent(childEditButton.dataset.weeklyChildEdit || "")}`;
		return;
	}

	const childDeleteButton = event.target.closest("[data-weekly-child-delete]");
	if (childDeleteButton) {
		deleteChildAccount(childDeleteButton.dataset.weeklyChildDelete);
		return;
	}

	const childStatusButton = event.target.closest("[data-weekly-child-status]");
	if (childStatusButton) {
		updateChildStatus(childStatusButton.dataset.weeklyChildStatus, childStatusButton.dataset.nextStatus);
		return;
	}

	const bookDialogButton = event.target.closest("[data-weekly-open-book-dialog]");
	if (bookDialogButton) {
		if (isServiceExpired()) {
			showTeacherToast(getServiceExpiredMessage(), true);
			return;
		}
		window.location.href = `./book.html?childId=${encodeURIComponent(bookDialogButton.dataset.weeklyOpenBookDialog || "")}`;
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
		window.location.href = `./book.html?childId=${encodeURIComponent(editButton.dataset.child || "")}&subjectId=${encodeURIComponent(editButton.dataset.subjectId || "")}`;
		return;
	}

	const copyButton = event.target.closest(".copy-book");
	if (copyButton) {
		closeBookMenus();
		if (isServiceExpired()) {
			showTeacherToast(getServiceExpiredMessage(), true);
			return;
		}
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
	if (button) openEntryPage(button);
});
window.addEventListener("resize", closeBookMenus);
window.addEventListener("scroll", closeBookMenus, true);
window.addEventListener("pagehide", flushPendingRemoteState);
els.historySearch.addEventListener("input", renderHistory);
els.historyChild.addEventListener("change", renderHistory);
els.historySubjectSetting.addEventListener("change", renderHistory);
els.historySubject.addEventListener("change", renderHistory);
els.pendingChild.addEventListener("change", renderPendingPlans);
els.pendingSubjectSetting.addEventListener("change", renderPendingPlans);
els.pendingRange.addEventListener("change", renderPendingPlans);
els.pendingList.addEventListener("click", (event) => {
	const button = event.target.closest(".pending-open-entry");
	if (button) openEntryPage(button);
});
els.rewardResetForm.addEventListener("submit", confirmRewardReset);
els.planForm.addEventListener("submit", savePlanChange);
els.closePlanDialog.addEventListener("click", closePlanDialog);
els.cancelPlanDialog.addEventListener("click", closePlanDialog);
els.deleteEntry.addEventListener("click", deleteEntry);
els.closeEntryDialog.addEventListener("click", closeEntryDialog);
els.cancelEntryDialog.addEventListener("click", closeEntryDialog);
els.entryAnalyzeButton.addEventListener("click", analyzeActiveEntryAttachments);
els.entryAttachmentList.addEventListener("click", (event) => {
	const button = event.target.closest("[data-open-entry-attachment]");
	if (!button) return;
	const items = Array.from(els.entryAttachmentList.querySelectorAll("[data-open-entry-attachment]"))
		.map((item) => ({
			id: item.dataset.openEntryAttachment || "",
			name: item.dataset.attachmentName || "첨부 사진",
			url: item.dataset.attachmentUrl || "",
		}))
		.filter((item) => item.url);
	const index = Math.max(0, items.findIndex((item) => item.id === button.dataset.openEntryAttachment));
	openAttachmentGallery(items, index);
});
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
showPage(getRequestedPage() || getSavedPage("weekly"));
setupNativeBackButton();
setupNativeAccessLogEvents();
recordStartupAccessLog().finally(() => loadAccessLogs());
loadRemoteState().then(processPaymentRedirect);
refreshPushState();
registerNativePushIfAvailable();

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
