const AUTH_TOKEN_KEY = "local-study-manager-token";
const AUTH_USER_KEY = "local-study-manager-user";
const AUTH_TOKEN_KEY_PREFIX = `${AUTH_TOKEN_KEY}:`;
const AUTH_USER_KEY_PREFIX = `${AUTH_USER_KEY}:`;
const PAGE_STORAGE_KEY = "studyflow-student-active-page";
const authSession = getSessionForRole("student");
const authToken = authSession.token;
const authUser = authSession.user;
const ACCESS_LOG_SKIP_KEY = `studyflow-access-log-skip:student:${authUser.id || authUser.loginId || "anonymous"}`;
const ACCESS_LOG_SKIP_TTL_MS = 3000;
const ACCESS_LOG_THROTTLE_MS = 5000;

if (!authToken) {
	window.location.replace("./login.html");
	throw new Error("Authentication required.");
}

const dayNames = ["일", "월", "화", "수", "목", "금", "토"];
let state = {
	student: authUser,
	subjects: [],
	entries: {},
};
let weekStart = startOfWeek(new Date());
let planFilter = "all";
let activePage = "today";
let activeStudy = null;
let studyTimer = null;
let pushState = { supported: false, subscribed: false, permission: "default" };
let lastAccessLogAt = 0;
let pendingAttachmentStudy = null;
let toastTimer = null;
let attachmentPreviewUrls = new Map();
let attachmentGalleryState = { items: [], index: 0, rotations: {}, zooms: {}, pointers: new Map(), dragStart: null, pinchStart: null, keyHandler: null };

const els = {
	pageViews: document.querySelectorAll(".page-view"),
	navItems: document.querySelectorAll(".nav-item"),
	studentName: document.querySelector("#studentName"),
	teacherName: document.querySelector("#teacherName"),
	accountSummary: document.querySelector("#studentAccountSummary"),
	pushStatus: document.querySelector("#studentPushStatus"),
	pushToggle: document.querySelector("#studentPushToggle"),
	pushMessage: document.querySelector("#studentPushMessage"),
	topbarThemeSlot: document.querySelector("#studentTopbarThemeSlot"),
	logout: document.querySelector("#studentLogout"),
	rewardPageTotal: document.querySelector("#studentRewardPageTotal"),
	rewardHistoryCount: document.querySelector("#studentRewardHistoryCount"),
	prevWeek: document.querySelector("#studentPrevWeek"),
	nextWeek: document.querySelector("#studentNextWeek"),
	thisWeek: document.querySelector("#studentThisWeek"),
	planFilter: document.querySelector("#studentPlanFilter"),
	weekRange: document.querySelector("#studentWeekRange"),
	teacherMessage: document.querySelector("#studentTeacherMessage"),
	todayPlanList: document.querySelector("#todayPlanList"),
	weekPlanList: document.querySelector("#weekPlanList"),
	rewardHistory: document.querySelector("#studentRewardHistory"),
	studySessionScreen: document.querySelector("#studySessionScreen"),
	studySessionProgress: document.querySelector("#studySessionProgress"),
	studySessionTimerLabel: document.querySelector("#studySessionTimerLabel"),
	studySessionTimerValue: document.querySelector("#studySessionTimerValue"),
	studySessionTitle: document.querySelector("#studySessionTitle"),
	studySessionMeta: document.querySelector("#studySessionMeta"),
	studySessionAmount: document.querySelector("#studySessionAmount"),
	studySessionTeacherNoteRow: document.querySelector("#studySessionTeacherNoteRow"),
	studySessionTeacherNote: document.querySelector("#studySessionTeacherNote"),
	studySessionStartTime: document.querySelector("#studySessionStartTime"),
	studySessionElapsedLabel: document.querySelector("#studySessionElapsedLabel"),
	studySessionElapsed: document.querySelector("#studySessionElapsed"),
	studySessionRemainingCard: document.querySelector("#studySessionRemainingCard"),
	studySessionRemaining: document.querySelector("#studySessionRemaining"),
	studySessionFeedback: document.querySelector("#studySessionFeedback"),
	studySessionComplete: document.querySelector("#studySessionComplete"),
	studySessionCancel: document.querySelector("#studySessionCancel"),
	studentAttachmentPicker: document.querySelector("#studentAttachmentPicker"),
	studentToast: document.querySelector("#studentToast"),
};

const pageTitles = {
	today: "오늘 학습",
	week: "주간 학습",
	rewards: "보상 이력",
	mypage: "마이페이지",
};

function getAuthUser() {
	try {
		return JSON.parse(localStorage.getItem(`${AUTH_USER_KEY_PREFIX}student`) || "{}");
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

function setStatus(text, isError = false) {
	if (isError) console.warn(`[StudyFlow Student] ${text}`);
}

function showStudentToast(text, isError = false) {
	if (!els.studentToast) return;
	window.clearTimeout(toastTimer);
	els.studentToast.textContent = text;
	els.studentToast.classList.toggle("is-error", isError);
	els.studentToast.classList.add("is-visible");
	toastTimer = window.setTimeout(() => {
		els.studentToast.classList.remove("is-visible");
	}, 2600);
}

function clearAttachmentPreviewUrls() {
	attachmentPreviewUrls.forEach((url) => URL.revokeObjectURL(url));
	attachmentPreviewUrls = new Map();
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
	document.body.appendChild(gallery);
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
			localStorage.removeItem(`${AUTH_TOKEN_KEY_PREFIX}student`);
			localStorage.removeItem(`${AUTH_USER_KEY_PREFIX}student`);
			window.location.replace("./login.html");
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

function getPushStatusText() {
	if (!pushState.supported) return "이 브라우저는 푸시 알림을 지원하지 않습니다.";
	if (pushState.subscribed) return "이 기기는 선생님 알림을 받을 수 있습니다.";
	if (pushState.permission === "denied") return "브라우저에서 알림 권한이 차단되어 있습니다.";
	return "이 기기에서 선생님 알림 수신을 등록할 수 있습니다.";
}

function setPushMessage(text, isError = false) {
	if (!els.pushMessage) return;
	els.pushMessage.textContent = text;
	els.pushMessage.classList.toggle("is-error", isError);
}

function shouldShowWebPushPanel() {
	return !window.StudyFlowPush?.isNativeApp?.();
}

function updateWebPushPanelVisibility() {
	const panel = els.pushStatus?.closest(".student-setting-panel");
	const hidden = !shouldShowWebPushPanel();
	if (panel) panel.hidden = hidden;
	if (els.pushMessage) els.pushMessage.hidden = hidden;
}

function updatePushPanel() {
	updateWebPushPanelVisibility();
	if (!shouldShowWebPushPanel()) return;
	if (els.pushStatus) els.pushStatus.textContent = getPushStatusText();
	if (els.pushToggle) {
		els.pushToggle.textContent = pushState.subscribed ? "수신 해제" : "수신 등록";
		els.pushToggle.disabled = !pushState.supported;
	}
}

async function refreshPushState() {
	if (!shouldShowWebPushPanel()) {
		updateWebPushPanelVisibility();
		return;
	}
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

function registerNativePushIfAvailable() {
	window.StudyFlowPush?.registerNativeAppToken(authToken).catch((error) => {
		console.warn("Failed to register native push token.", error);
	});
}

function getStudentName() {
	return state.student.name || authUser.name || "학생";
}

function getStudentInitial() {
	return getStudentName().trim().charAt(0).toUpperCase() || "S";
}

function getSavedPage(defaultPage = "today") {
	try {
		const savedPage = sessionStorage.getItem(PAGE_STORAGE_KEY);
		return pageTitles[savedPage] ? savedPage : defaultPage;
	} catch {
		return defaultPage;
	}
}

function showPage(page) {
	activePage = pageTitles[page] ? page : "today";
	els.pageViews.forEach((view) => {
		view.classList.toggle("active", view.dataset.page === activePage);
	});
	if (els.topbarThemeSlot) {
		els.topbarThemeSlot.hidden = activePage !== "mypage";
	}
	els.navItems.forEach((item) => {
		item.classList.toggle("active", item.dataset.targetPage === activePage);
	});
	try {
		sessionStorage.setItem(PAGE_STORAGE_KEY, activePage);
	} catch {}
}

function isNativeApp() {
	if (window.StudyFlowPush?.isNativeApp?.()) return true;
	if (typeof window.Capacitor?.isNativePlatform === "function") return window.Capacitor.isNativePlatform();
	return ["android", "ios"].includes(window.Capacitor?.getPlatform?.());
}

function setupNativeBackButton() {
	const appPlugin = window.Capacitor?.Plugins?.App;
	if (!isNativeApp() || !appPlugin?.addListener) return;

	appPlugin.addListener("backButton", () => {
		if (!els.studySessionScreen.hidden) {
			closeStudySession();
			return;
		}
		if (activePage !== "today") {
			showPage("today");
			return;
		}
		appPlugin.exitApp();
	});
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

function parseDate(dateText) {
	const [year, month, day] = String(dateText).split("-").map(Number);
	return new Date(year, month - 1, day);
}

function addDays(date, days) {
	const next = new Date(date);
	next.setDate(next.getDate() + days);
	return next;
}

function startOfWeek(date) {
	const start = new Date(date);
	const day = start.getDay();
	const diff = day === 0 ? -6 : 1 - day;
	start.setDate(start.getDate() + diff);
	start.setHours(0, 0, 0, 0);
	return start;
}

function getWeekDates() {
	return Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
}

function entryKey(subjectId, date) {
	return `${subjectId}__${date}`;
}

function isSubjectActiveOnDate(subject, dateText) {
	if (subject.startDate && dateText < subject.startDate) return false;
	if (subject.endDate && dateText > subject.endDate) return false;
	return true;
}

function getPlansForDates(dates) {
	const dateTexts = dates.map(formatDate);
	return state.subjects
		.flatMap((subject) => {
			const scheduled = dateTexts
				.filter((dateText) => {
					const dayIndex = parseDate(dateText).getDay();
					return subject.scheduleDays.includes(dayIndex) && isSubjectActiveOnDate(subject, dateText);
				})
				.map((dateText) => ({
					subject,
					date: dateText,
					entry: state.entries[entryKey(subject.id, dateText)] || null,
				}));

			const unscheduledEntries = Object.values(state.entries)
				.filter((entry) => entry.subjectId === subject.id && dateTexts.includes(entry.date))
				.filter((entry) => !scheduled.some((plan) => plan.date === entry.date))
				.map((entry) => ({ subject, date: entry.date, entry }));

			return [...scheduled, ...unscheduledEntries];
		})
		.sort((a, b) => a.date.localeCompare(b.date) || normalizeScheduleTime(a.subject.scheduleTime).localeCompare(normalizeScheduleTime(b.subject.scheduleTime)));
}

function filterPlans(plans) {
	if (planFilter === "completed") return plans.filter((plan) => plan.entry?.completed);
	if (planFilter === "pending") return plans.filter((plan) => !plan.entry?.completed);
	return plans;
}

function shouldShowPlan(plan) {
	if (!plan) return false;
	if (planFilter === "completed") return Boolean(plan.entry?.completed);
	if (planFilter === "pending") return !plan.entry?.completed;
	return true;
}

function comparePlanCards(a, b) {
	const aCompleted = a.entry?.completed ? 1 : 0;
	const bCompleted = b.entry?.completed ? 1 : 0;
	const aTime = normalizeScheduleTime(a.subject.scheduleTime) || "99:99";
	const bTime = normalizeScheduleTime(b.subject.scheduleTime) || "99:99";
	return (
		aCompleted - bCompleted ||
		a.date.localeCompare(b.date) ||
		aTime.localeCompare(bTime) ||
		a.subject.name.localeCompare(b.subject.name, "ko-KR") ||
		a.subject.book.localeCompare(b.subject.book, "ko-KR")
	);
}

function groupSubjectsByName(subjects) {
	return subjects.reduce((groups, item) => {
		const last = groups.at(-1);
		if (last?.name === item.subject.name) {
			last.subjects.push(item);
		} else {
			groups.push({ name: item.subject.name, subjects: [item] });
		}
		return groups;
	}, []);
}

function getRewardTotals(entries = Object.values(state.entries)) {
	const totals = new Map();
	entries.forEach((entry) => {
		if (!entry.rewardAwarded || entry.rewardRedeemed) return;
		const amount = Number.parseInt(entry.rewardAmount, 10);
		if (!Number.isFinite(amount) || amount <= 0) return;
		const label = entry.rewardLabel || "포인트";
		totals.set(label, (totals.get(label) || 0) + amount);
	});
	return [...totals.entries()].map(([label, amount]) => ({ label, amount }));
}

function formatReward(amount, label) {
	return `${Number.parseInt(amount, 10) || 0}${label || "포인트"}`;
}

function formatRewardTotal(totals) {
	if (!totals.length) return "0포인트";
	return totals.map((item) => formatReward(item.amount, item.label)).join(" · ");
}

function escapeHtml(value) {
	return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function formatDateTime(value) {
	if (!value) return "지급 시각 미상";
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return String(value);
	return new Intl.DateTimeFormat("ko-KR", {
		dateStyle: "medium",
		timeStyle: "short",
	}).format(date);
}

function formatClockTime(date) {
	return new Intl.DateTimeFormat("ko-KR", {
		hour: "2-digit",
		minute: "2-digit",
		hour12: false,
	}).format(date);
}

function formatElapsed(ms) {
	const totalSeconds = Math.max(0, Math.floor(ms / 1000));
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const seconds = totalSeconds % 60;
	return [hours, minutes, seconds].map((value) => String(value).padStart(2, "0")).join(":");
}

function formatTimerShort(ms) {
	const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function formatDurationText(ms) {
	const totalMinutes = Math.max(1, Math.round(ms / 60000));
	const hours = Math.floor(totalMinutes / 60);
	const minutes = totalMinutes % 60;
	if (!hours) return `${minutes}분 학습`;
	if (!minutes) return `${hours}시간 학습`;
	return `${hours}시간 ${minutes}분 학습`;
}

function formatDurationSeconds(seconds) {
	return formatDurationText((Number.parseInt(seconds, 10) || 0) * 1000);
}

function normalizeScheduleTime(value) {
	const match = String(value || "")
		.trim()
		.match(/(\d{1,2}):(\d{2})/);
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
	if (!minutes) return "";
	const hours = Math.floor(minutes / 60);
	const rest = minutes % 60;
	if (hours && rest) return `${hours}시간 ${rest}분`;
	if (hours) return `${hours}시간`;
	return `${rest}분`;
}

function getEffectiveMinimumStudyMinutes(entry, subject) {
	const entryMinutes = normalizeMinimumStudyMinutes(entry?.minimumStudyMinutes ?? entry?.minimum_study_minutes);
	if (entryMinutes) return entryMinutes;
	return normalizeMinimumStudyMinutes(subject?.minimumStudyMinutes ?? subject?.minimum_study_minutes);
}

function normalizeColor(value) {
	return /^#[0-9a-f]{6}$/i.test(String(value || "")) ? value : "#2f78d4";
}

function hexToRgba(hex, alpha) {
	const normalized = normalizeColor(hex).replace("#", "");
	const red = Number.parseInt(normalized.slice(0, 2), 16);
	const green = Number.parseInt(normalized.slice(2, 4), 16);
	const blue = Number.parseInt(normalized.slice(4, 6), 16);
	return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function subjectAccentStyle(subject) {
	const color = normalizeColor(subject.color);
	return `--subject-color: ${color}; --subject-soft: ${hexToRgba(color, 0.12)}`;
}

function normalizeStudentState(value) {
	const subjects = Array.isArray(value?.subjects)
		? value.subjects.map((subject) => ({
				...subject,
				subjectSettingId: subject.subjectSettingId ?? subject.subject_setting_id ?? "",
				scheduleDays: Array.isArray(subject.scheduleDays) ? subject.scheduleDays : subject.schedule_days || [],
				scheduleTime: normalizeScheduleTime(subject.scheduleTime ?? subject.schedule_time),
				minimumStudyMinutes: normalizeMinimumStudyMinutes(subject.minimumStudyMinutes ?? subject.minimum_study_minutes),
				startDate: subject.startDate ?? subject.start_date ?? "",
				endDate: subject.endDate ?? subject.end_date ?? "",
			}))
		: [];
	const subjectsById = new Map(subjects.map((subject) => [subject.id, subject]));

	return {
		...value,
		student: {
			...(value?.student || {}),
			teacherName: value?.student?.teacherName || "",
			teacherProfileImageUrl: value?.student?.teacherProfileImageUrl || "",
			teacherComment: value?.student?.teacherComment || "",
		},
		subjects,
		entries:
			value?.entries && typeof value.entries === "object"
				? Object.fromEntries(
						Object.entries(value.entries).map(([key, entry]) => [
							key,
							{
								...entry,
								minimumStudyMinutes:
									normalizeMinimumStudyMinutes(entry.minimumStudyMinutes ?? entry.minimum_study_minutes) ||
									normalizeMinimumStudyMinutes(subjectsById.get(String(entry.subjectId))?.minimumStudyMinutes),
							},
						]),
					)
				: {},
	};
}

function getRewardHistoryBatches() {
	const batches = new Map();
	Object.values(state.entries).forEach((entry) => {
		if (!entry.rewardAwarded || !entry.rewardRedeemed) return;
		const key = entry.rewardRedeemedAt || "unknown";
		const batch = batches.get(key) || { redeemedAt: key, entries: [] };
		batch.entries.push(entry);
		batches.set(key, batch);
	});

	return [...batches.values()]
		.map((batch) => ({
			...batch,
			entries: batch.entries.sort((a, b) => a.date.localeCompare(b.date)),
			totals: getRewardTotals(batch.entries.map((entry) => ({ ...entry, rewardRedeemed: false }))),
		}))
		.sort((a, b) => String(b.redeemedAt).localeCompare(String(a.redeemedAt)));
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
		throw new Error("StudyFlow API 응답이 아닙니다. 서버의 /api 연결을 확인하세요.");
	}
	const data = await response.json().catch(() => ({}));

	if (response.status === 401 || response.status === 403) {
		localStorage.removeItem(`${AUTH_TOKEN_KEY_PREFIX}student`);
		localStorage.removeItem(`${AUTH_USER_KEY_PREFIX}student`);
		window.location.replace("./login.html");
		throw new Error("Authentication expired.");
	}

	if (!response.ok) {
		throw new Error(data.message || "Request failed.");
	}

	return data;
}

async function loadStudentState() {
	try {
		setStatus("학습 계획을 불러오는 중");
		const data = await requestJson("/api/student/state");
		state = normalizeStudentState(data.state);
		render();
		setStatus("저장된 학습 계획");
	} catch (error) {
		setStatus(error.message || "학습 계획을 불러오지 못했습니다.", true);
	}
}

function render() {
	clearAttachmentPreviewUrls();
	const today = new Date();
	const todayText = formatDate(today);
	const todayPlans = getPlansForDates([today]);
	const weekPlans = getPlansForDates(getWeekDates());
	const visibleWeekPlans = filterPlans(weekPlans);
	const rewardTotals = getRewardTotals();
	const rewardHistoryCount = getRewardHistoryBatches().length;

	els.studentName.textContent = getStudentName();
	els.teacherName.textContent = state.student.teacherName ? `${state.student.teacherName} 선생님` : "선생님";
	els.accountSummary.textContent = state.student.loginId || "로그인 정보 없음";
	els.rewardPageTotal.textContent = formatRewardTotal(rewardTotals);
	els.rewardHistoryCount.textContent = String(rewardHistoryCount);
	els.weekRange.textContent = `${formatDate(weekStart)} ~ ${formatDate(addDays(weekStart, 6))}`;
	els.todayPlanList.innerHTML = renderPlanList(todayPlans, "오늘 학습 계획이 없습니다.", true);
	renderTeacherMessage();
	els.weekPlanList.innerHTML = renderWeekTable(visibleWeekPlans);
	els.rewardHistory.innerHTML = renderRewardHistory();
	refreshVisibleAttachmentCounts();
}

function renderTeacherMessage() {
	if (!els.teacherMessage) return;
	const comment = String(state.student.teacherComment || "").trim();
	if (!comment) {
		els.teacherMessage.hidden = true;
		els.teacherMessage.innerHTML = "";
		return;
	}
	const teacherName = state.student.teacherName ? `${state.student.teacherName} 선생님` : "선생님";
	const imageUrl = String(state.student.teacherProfileImageUrl || "").trim();
	const avatar = imageUrl
		? `<img src="${escapeHtml(imageUrl)}" alt="">`
		: `<span>${escapeHtml((state.student.teacherName || "선").slice(0, 1))}</span>`;
	els.teacherMessage.hidden = false;
	els.teacherMessage.innerHTML = `
    <div class="student-teacher-avatar">${avatar}</div>
    <div>
      <strong>${escapeHtml(teacherName)}</strong>
      <p class="student-teacher-bubble">${escapeHtml(comment)}</p>
    </div>
  `;
}

function renderWeekTable(visiblePlans) {
	if (!visiblePlans.length) return `<div class="empty-state">선택한 조건의 학습 계획이 없습니다.</div>`;

	const dates = getWeekDates();
	const todayKey = formatDate(new Date());
	const planMap = new Map(visiblePlans.map((plan) => [`${plan.subject.id}__${plan.date}`, plan]));
	const subjects = state.subjects
		.map((subject) => ({
			subject,
			plans: dates.map((date) => planMap.get(`${subject.id}__${formatDate(date)}`) || null),
		}))
		.filter((row) => row.plans.some(shouldShowPlan));

	if (!subjects.length) return `<div class="empty-state">선택한 조건의 학습 계획이 없습니다.</div>`;

	const head = `
    <thead>
      <tr>
        <th>과목</th>
        <th>교재</th>
        ${dates
			.map((date) => {
				const isToday = formatDate(date) === todayKey;
				return `<th class="${isToday ? "is-today" : ""}">${displayDate(date)} ${dayNames[date.getDay()]}${isToday ? `<span class="today-column-badge">오늘</span>` : ""}</th>`;
			})
			.join("")}
      </tr>
    </thead>
  `;

	const rows = groupSubjectsByName(subjects)
		.map((group) =>
			group.subjects
				.map(({ subject, plans }, groupIndex) => {
					const cells = plans
				.map((plan) => {
					if (!shouldShowPlan(plan)) return `<td></td>`;
					const entry = plan.entry;
					const amount = entry?.amount?.trim();
					const amountText = amount || "학습량 미입력";
					const teacherMemo = String(entry?.memo || "").trim();
					const completed = Boolean(entry?.completed);
					const planned = Boolean(entry && !completed && !amount && !teacherMemo);
					const minimumStudyMinutes = getEffectiveMinimumStudyMinutes(entry, subject);
					return `
            <td>
              <button class="entry-cell student-week-plan-cell ${entry ? "has-entry" : ""} ${completed ? "is-complete" : ""} ${planned ? "is-planned" : ""}" type="button"
                data-start-study data-subject-id="${escapeHtml(subject.id)}" data-date="${escapeHtml(plan.date)}" data-amount="${escapeHtml(amountText)}" data-minimum-study-minutes="${minimumStudyMinutes}" data-completed="${completed ? "true" : "false"}">
                ${
					entry
						? `<span class="entry-status-row">
                  ${completed ? `<span class="entry-status">완료</span>` : `<span class="entry-status pending">진행중</span>`}
                  ${entry.rewardAwarded ? `<span class="reward-badge">+${escapeHtml(formatReward(entry.rewardAmount, entry.rewardLabel))}</span>` : ""}
                </span>
                ${
					!planned
						? `<span class="entry-amount">${amount ? escapeHtml(amount) : "학습량 없음"}</span>
                ${teacherMemo ? `<span class="entry-memo-mark" title="${escapeHtml(teacherMemo)}">✎ 메모</span>` : ""}`
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
					? `<td class="subject-cell" rowspan="${group.subjects.length}" style="${escapeHtml(subjectAccentStyle(subject))}">
            <div class="subject-name"><span class="subject-color-dot" aria-hidden="true"></span>${escapeHtml(group.name)}</div>
          </td>`
					: ""
			}
          <td class="book-cell">
            <span class="book-title">${escapeHtml(subject.book)}</span>
            <span class="book-schedule">${escapeHtml(normalizeScheduleTime(subject.scheduleTime) || "시간 미설정")}</span>
          </td>
          ${cells}
        </tr>
      `;
				})
				.join(""),
		)
		.join("");

	return `<div class="student-week-table-wrap weekly-child-table-wrap"><table class="weekly-child-table student-week-table">${head}<tbody>${rows}</tbody></table></div>`;
}

function renderPlanList(plans, emptyText, showTeacherMemo = false) {
	if (!plans.length) return `<div class="empty-state">${escapeHtml(emptyText)}</div>`;

	return [...plans]
		.sort(comparePlanCards)
		.map((plan) => {
			const entry = plan.entry || {};
			const amountText = entry.amount || "학습량 미입력";
			const teacherMemo = String(entry.memo || "").trim();
			const scheduleTime = normalizeScheduleTime(plan.subject.scheduleTime);
			const minimumStudyMinutes = getEffectiveMinimumStudyMinutes(plan.entry, plan.subject);
			const scheduleText = scheduleTime || "시간 미설정";
			const titleText = [plan.subject.name, plan.subject.book].filter(Boolean).join(" · ");
			const minimumStudyBadge = minimumStudyMinutes
				? `<span class="student-plan-minimum"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="9"></circle><path d="M12 7v5l3 2"></path></svg>최소 ${escapeHtml(formatMinimumStudyMinutes(minimumStudyMinutes))}</span>`
				: "";
			const rewardAmount = Number.parseInt(plan.subject.rewardAmount, 10) || 0;
			const rewardInfo =
				plan.subject.rewardEnabled && rewardAmount > 0
					? `<p class="student-plan-reward">완료 시 보상 ${escapeHtml(formatReward(rewardAmount, plan.subject.rewardLabel || "포인트"))}</p>`
					: "";
			const recordItems = [
				entry.studyStartedAt ? `시작 ${formatDateTime(entry.studyStartedAt)}` : "",
				entry.studyDurationSeconds ? `누적 ${formatDurationSeconds(entry.studyDurationSeconds)}` : "",
				entry.studentFeedback ? `피드백 ${entry.studentFeedback}` : "",
			].filter(Boolean);
			const teacherMemoRow =
				showTeacherMemo && teacherMemo
					? `<div class="student-plan-info-row">
            <span>선생님 메모</span>
            <p>${escapeHtml(teacherMemo)}</p>
          </div>`
					: "";
			const completedDetail = entry.completed
				? `<div class="student-plan-record">
            <span>완료 기록</span>
            ${recordItems.map((item) => `<p>${escapeHtml(item)}</p>`).join("")}
            <div class="student-attachment-block" data-attachment-list data-subject-id="${escapeHtml(plan.subject.id)}" data-date="${escapeHtml(plan.date)}">
              <p class="student-attachment-count">등록 사진 확인 중</p>
            </div>
          </div>`
				: "";
			const actionArea = entry.completed
				? `<button class="ghost student-attachment-upload" type="button" data-upload-study-attachment data-subject-id="${escapeHtml(plan.subject.id)}" data-date="${escapeHtml(plan.date)}">사진 등록</button>`
				: `<button type="button" data-start-study data-subject-id="${escapeHtml(plan.subject.id)}" data-date="${escapeHtml(plan.date)}" data-amount="${escapeHtml(amountText)}" data-minimum-study-minutes="${minimumStudyMinutes}">학습 시작</button>`;
			return `
      <article class="student-plan-card ${entry.completed ? "is-complete" : ""}" data-subject-id="${escapeHtml(plan.subject.id)}" data-date="${escapeHtml(plan.date)}" data-amount="${escapeHtml(amountText)}" data-minimum-study-minutes="${minimumStudyMinutes}">
        <div class="student-plan-head">
          <div>
            <strong><span class="subject-color-dot" style="background:${escapeHtml(plan.subject.color || "#2f78d4")}" aria-hidden="true"></span>${escapeHtml(titleText)}</strong>
            <p class="student-plan-schedule"><span>수업 시간 ${escapeHtml(scheduleText)}</span>${minimumStudyBadge}</p>
            ${rewardInfo}
          </div>
          <div class="student-plan-badges">
            ${actionArea}
          </div>
        </div>
        <div class="student-plan-info">
          <div class="student-plan-info-row">
            <span>학습량</span>
            <p>${escapeHtml(amountText)}</p>
          </div>
          ${teacherMemoRow}
        </div>
        ${completedDetail}
      </article>
    `;
		})
		.join("");
}

function renderRewardHistory() {
	const batches = getRewardHistoryBatches();
	if (!batches.length) return `<div class="empty-state">아직 지급 완료된 보상이 없습니다.</div>`;

	return batches
		.map(
			(batch) => `
    <article class="reward-history-item">
      <div class="reward-history-head">
        <div>
          <strong>${escapeHtml(formatRewardTotal(batch.totals))}</strong>
          <p>${escapeHtml(formatDateTime(batch.redeemedAt))} 지급 완료</p>
        </div>
      </div>
      <div class="reward-history-detail">
        ${batch.entries
			.map((entry) => {
				const subject = state.subjects.find((item) => item.id === entry.subjectId);
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

async function saveStudyEntry(payload) {
	try {
		setStatus("학습 기록 저장 중");
		const data = await requestJson("/api/student/entries", {
			method: "PUT",
			body: JSON.stringify(payload),
		});
		state.entries[data.entry.key] = data.entry;
		render();
		setStatus("학습 기록 저장 완료");
	} catch (error) {
		setStatus(error.message || "저장하지 못했습니다.", true);
		throw error;
	}
}

async function uploadStudyAttachments(study, files) {
	if (!files.length) return [];
	const formData = new FormData();
	formData.append("subjectId", study.subjectId);
	formData.append("date", study.date);
	files.forEach((file) => formData.append("attachments", file));

	const response = await fetch("/api/attachments/student-entry", {
		method: "POST",
		headers: {
			Authorization: `Bearer ${authToken}`,
		},
		body: formData,
	});
	const data = await response.json().catch(() => ({}));
	if (!response.ok) throw new Error(data.message || "첨부 사진을 업로드하지 못했습니다.");
	return data.attachments || [];
}

async function fetchStudyAttachmentInfo(study) {
	const params = new URLSearchParams({
		subjectId: study.subjectId,
		date: study.date,
	});
	const response = await fetch(`/api/attachments/entry?${params}`, {
		headers: {
			Authorization: `Bearer ${authToken}`,
		},
	});
	const data = await response.json().catch(() => ({}));
	if (!response.ok) throw new Error(data.message || "첨부 사진 정보를 불러오지 못했습니다.");
	return {
		attachments: data.attachments || [],
		analysis: data.analysis || {},
	};
}

function getAttachmentListElements(study) {
	return Array.from(document.querySelectorAll("[data-attachment-list]")).filter(
		(element) => element.dataset.subjectId === study.subjectId && element.dataset.date === study.date,
	);
}

function renderAttachmentList(study, attachments) {
	const elements = getAttachmentListElements(study);
	elements.forEach((element) => {
		if (!attachments.length) {
			element.innerHTML = `<p class="student-attachment-count">등록 사진 없음</p>`;
			return;
		}
		element.innerHTML = `
      <p class="student-attachment-count">등록 사진 ${attachments.length}개</p>
      <div class="student-attachment-list">
        ${attachments
			.map((attachment) => `
          <figure class="student-attachment-item" data-student-attachment-id="${escapeHtml(attachment.id)}">
            <button class="student-attachment-thumb" type="button" data-open-study-attachment="${escapeHtml(attachment.id)}">불러오는 중</button>
            <figcaption>${escapeHtml(attachment.originalName || "첨부 사진")}</figcaption>
            ${
				attachment.canDelete
					? `<button class="student-attachment-delete" type="button" data-delete-study-attachment="${escapeHtml(attachment.id)}" data-subject-id="${escapeHtml(study.subjectId)}" data-date="${escapeHtml(study.date)}" aria-label="사진 삭제">×</button>`
					: `<span class="student-attachment-locked">확인됨</span>`
			}
          </figure>
        `)
			.join("")}
      </div>
    `;
	});
}

function isAttachmentUploadLocked(analysis) {
	return ["analyzing", "completed"].includes(String(analysis?.aiStatus || ""));
}

function updateAttachmentUploadButton(study, analysis) {
	const locked = isAttachmentUploadLocked(analysis);
	document.querySelectorAll("[data-upload-study-attachment]").forEach((button) => {
		if (button.dataset.subjectId !== study.subjectId || button.dataset.date !== study.date) return;
		button.disabled = locked;
		button.textContent = locked ? "등록 마감" : "사진 등록";
		button.title = locked ? "사진 확인이 시작되어 더 등록할 수 없습니다." : "";
	});
}

async function hydrateAttachmentThumbnails(attachments) {
	await Promise.all(attachments.map(async (attachment) => {
		try {
			if (attachmentPreviewUrls.has(attachment.id)) URL.revokeObjectURL(attachmentPreviewUrls.get(attachment.id));
			const response = await fetch(attachment.fileUrl, {
				headers: {
					Authorization: `Bearer ${authToken}`,
				},
			});
			if (!response.ok) throw new Error("첨부 사진을 불러오지 못했습니다.");
			const url = URL.createObjectURL(await response.blob());
			attachmentPreviewUrls.set(attachment.id, url);
			document.querySelectorAll(`[data-student-attachment-id="${CSS.escape(attachment.id)}"]`).forEach((item) => {
				const thumb = item.querySelector(".student-attachment-thumb");
				if (thumb) {
					thumb.innerHTML = `<img src="${url}" alt="${escapeHtml(attachment.originalName || "첨부 사진")}">`;
					thumb.dataset.attachmentUrl = url;
					thumb.dataset.attachmentName = attachment.originalName || "첨부 사진";
				}
			});
		} catch {
			document.querySelectorAll(`[data-student-attachment-id="${CSS.escape(attachment.id)}"] .student-attachment-thumb`).forEach((thumb) => {
				thumb.textContent = "불러오기 실패";
			});
		}
	}));
}

async function refreshAttachmentList(study) {
	const { attachments, analysis } = await fetchStudyAttachmentInfo(study);
	renderAttachmentList(study, attachments);
	updateAttachmentUploadButton(study, analysis);
	await hydrateAttachmentThumbnails(attachments);
	return attachments.length;
}

function refreshVisibleAttachmentCounts() {
	const summaries = Array.from(document.querySelectorAll("[data-attachment-list]"));
	const studies = new Map();
	summaries.forEach((element) => {
		const subjectId = element.dataset.subjectId || "";
		const date = element.dataset.date || "";
		if (!subjectId || !date) return;
		studies.set(`${subjectId}__${date}`, { subjectId, date });
	});
	studies.forEach((study) => {
		refreshAttachmentList(study).catch(() => {
			getAttachmentListElements(study).forEach((element) => {
				element.innerHTML = `<p class="student-attachment-count">등록 사진 확인 실패</p>`;
			});
		});
	});
}

async function deleteStudyAttachment(attachmentId, study) {
	const response = await fetch(`/api/attachments/${encodeURIComponent(attachmentId)}`, {
		method: "DELETE",
		headers: {
			Authorization: `Bearer ${authToken}`,
		},
	});
	const data = await response.json().catch(() => ({}));
	if (!response.ok) throw new Error(data.message || "첨부 사진을 삭제하지 못했습니다.");
	if (attachmentPreviewUrls.has(attachmentId)) {
		URL.revokeObjectURL(attachmentPreviewUrls.get(attachmentId));
		attachmentPreviewUrls.delete(attachmentId);
	}
	return refreshAttachmentList(study);
}

async function uploadCompletedStudyAttachments(files) {
	if (!pendingAttachmentStudy) return;
	const targetStudy = pendingAttachmentStudy;
	const images = files.filter((file) => ["image/jpeg", "image/png", "image/webp"].includes(file.type));
	if (images.length !== files.length) {
		setStatus("jpg, png, webp 이미지만 첨부할 수 있습니다.", true);
		showStudentToast("jpg, png, webp 이미지만 첨부할 수 있습니다.", true);
	}
	if (!images.length) {
		pendingAttachmentStudy = null;
		if (els.studentAttachmentPicker) els.studentAttachmentPicker.value = "";
		return;
	}
	const selectedFiles = images.slice(0, 5);
	if (images.length > 5) {
		setStatus("첨부 사진은 최대 5장까지 업로드할 수 있습니다.", true);
		showStudentToast("첨부 사진은 최대 5장까지 업로드할 수 있습니다.", true);
	}

	try {
		setStatus("첨부 사진 업로드 중");
		showStudentToast("첨부 사진 업로드 중");
		const uploaded = await uploadStudyAttachments(targetStudy, selectedFiles);
		const count = await refreshAttachmentList(targetStudy).catch(() => uploaded.length);
		const message = `사진 등록 완료. 현재 등록 사진 ${count}개`;
		setStatus(message);
		showStudentToast(message);
	} catch (error) {
		setStatus(error.message || "첨부 사진을 업로드하지 못했습니다.", true);
		showStudentToast(error.message || "첨부 사진을 업로드하지 못했습니다.", true);
	} finally {
		pendingAttachmentStudy = null;
		if (els.studentAttachmentPicker) els.studentAttachmentPicker.value = "";
	}
}

function notifyTeacherStudyEvent(eventType, study, options = {}) {
	requestJson("/api/push/student-event", {
		method: "POST",
		body: JSON.stringify({
			eventType,
			subjectName: study.subject?.name || "",
			bookName: study.subject?.book || "",
			date: study.date || "",
			amount: study.amount === "학습량 미입력" ? "" : study.amount || "",
			feedback: options.feedback || "",
		}),
	}).catch((error) => {
		console.warn("Failed to send study push event.", error);
	});
}

function startStudy(card) {
	const subject = state.subjects.find((item) => item.id === card.dataset.subjectId);
	if (!subject) return;
	const entry = state.entries[entryKey(card.dataset.subjectId, card.dataset.date)] || {};
	const teacherMemo = String(entry.memo || "").trim();

	activeStudy = {
		subjectId: card.dataset.subjectId,
		date: card.dataset.date,
		subject,
		amount: card.dataset.amount || "학습량 미입력",
		memo: teacherMemo,
		startedAt: new Date(),
	};
	activeStudy.minimumStudyMinutes = normalizeMinimumStudyMinutes(card.dataset.minimumStudyMinutes || getEffectiveMinimumStudyMinutes(entry, subject));
	els.studySessionTitle.textContent = `${subject.name} · ${subject.book}`;
	els.studySessionMeta.textContent = [
		`${activeStudy.date} ${dayNames[parseDate(activeStudy.date).getDay()]}`,
		normalizeScheduleTime(subject.scheduleTime) || "시간 미설정",
		activeStudy.minimumStudyMinutes ? `최소 ${formatMinimumStudyMinutes(activeStudy.minimumStudyMinutes)}` : "",
	]
		.filter(Boolean)
		.join(" · ");
	els.studySessionAmount.textContent = activeStudy.amount;
	els.studySessionTeacherNote.textContent = teacherMemo;
	els.studySessionTeacherNoteRow.hidden = !teacherMemo;
	els.studySessionStartTime.textContent = formatClockTime(activeStudy.startedAt);
	els.studySessionFeedback.value = "";
	els.studySessionComplete.disabled = activeStudy.minimumStudyMinutes > 0;
	els.studySessionScreen.hidden = false;
	document.body.classList.add("is-study-session-active");
	updateStudyTimer();
	studyTimer = window.setInterval(updateStudyTimer, 1000);
	notifyTeacherStudyEvent("start", activeStudy);
}

function updateStudyTimer() {
	if (!activeStudy) return;
	const elapsed = Date.now() - activeStudy.startedAt.getTime();
	const minimumMs = normalizeMinimumStudyMinutes(activeStudy.minimumStudyMinutes) * 60000;
	const remaining = Math.max(0, minimumMs - elapsed);
	const hasMinimum = minimumMs > 0;

	els.studySessionElapsed.textContent = formatElapsed(elapsed);
	els.studySessionElapsedLabel.textContent = hasMinimum ? "학습 시간" : "현재 누적 시간";
	els.studySessionRemainingCard.hidden = !hasMinimum;
	els.studySessionTimerLabel.textContent = hasMinimum ? "남은 시간" : "학습 시간";
	els.studySessionTimerValue.textContent = hasMinimum ? formatTimerShort(remaining) : formatElapsed(elapsed);
	if (els.studySessionRemaining) {
		els.studySessionRemaining.textContent = formatTimerShort(remaining);
	}
	if (hasMinimum) {
		const progress = Math.min(360, Math.max(0, (elapsed / minimumMs) * 360));
		els.studySessionProgress.classList.remove("is-spinner");
		els.studySessionProgress.classList.add("is-countdown");
		els.studySessionProgress.classList.toggle("is-ready", remaining <= 0);
		els.studySessionProgress.style.setProperty("--progress", `${progress}deg`);
		els.studySessionComplete.disabled = remaining > 0;
	} else {
		els.studySessionProgress.classList.remove("is-countdown", "is-ready");
		els.studySessionProgress.classList.add("is-spinner");
		els.studySessionProgress.style.setProperty("--progress", "360deg");
		els.studySessionComplete.disabled = false;
	}
}

function stopStudyTimer() {
	if (studyTimer) {
		window.clearInterval(studyTimer);
		studyTimer = null;
	}
}

function closeStudySession() {
	stopStudyTimer();
	activeStudy = null;
	els.studySessionScreen.hidden = true;
	els.studySessionComplete.disabled = false;
	els.studySessionProgress.classList.remove("is-countdown", "is-ready", "is-spinner");
	document.body.classList.remove("is-study-session-active");
}

async function completeStudy() {
	if (!activeStudy) return;
	const endedAt = new Date();
	const elapsed = endedAt.getTime() - activeStudy.startedAt.getTime();
	const minimumMs = normalizeMinimumStudyMinutes(activeStudy.minimumStudyMinutes) * 60000;
	if (minimumMs > 0 && elapsed < minimumMs) {
		alert(`최소 학습 시간 ${formatMinimumStudyMinutes(activeStudy.minimumStudyMinutes)} 이후 완료할 수 있습니다.`);
		return;
	}
	try {
		els.studySessionComplete.disabled = true;
		const feedback = els.studySessionFeedback.value.trim();
		await saveStudyEntry({
			subjectId: activeStudy.subjectId,
			date: activeStudy.date,
			amount: activeStudy.amount === "학습량 미입력" ? "" : activeStudy.amount,
			memo: activeStudy.memo,
			completed: true,
			studyStartedAt: activeStudy.startedAt.toISOString(),
			studyDurationSeconds: Math.max(1, Math.round(elapsed / 1000)),
			studentFeedback: feedback,
		});
		notifyTeacherStudyEvent("complete", activeStudy, { feedback });
		closeStudySession();
	} finally {
		els.studySessionComplete.disabled = false;
		updateStudyTimer();
	}
}

els.logout.addEventListener("click", () => {
	window.StudyFlowPush?.unregisterNativeAppToken(authToken).catch((error) => {
		console.warn("Failed to unregister native push token.", error);
	});
	localStorage.removeItem(`${AUTH_TOKEN_KEY_PREFIX}student`);
	localStorage.removeItem(`${AUTH_USER_KEY_PREFIX}student`);
	localStorage.removeItem(AUTH_TOKEN_KEY);
	localStorage.removeItem(AUTH_USER_KEY);
	window.location.href = "./login.html";
});

if (els.pushToggle) {
	els.pushToggle.addEventListener("click", togglePushSubscription);
}

els.prevWeek.addEventListener("click", () => {
	weekStart = addDays(weekStart, -7);
	render();
});

els.nextWeek.addEventListener("click", () => {
	weekStart = addDays(weekStart, 7);
	render();
});

els.thisWeek.addEventListener("click", () => {
	weekStart = startOfWeek(new Date());
	render();
});

els.planFilter.addEventListener("change", () => {
	planFilter = els.planFilter.value;
	render();
});

els.navItems.forEach((item) => {
	item.addEventListener("click", () => showPage(item.dataset.targetPage));
});

document.addEventListener("click", (event) => {
	const button = event.target.closest("[data-start-study]");
	if (!button) return;
	if (button.dataset.completed === "true") return;
	const card = button.closest(".student-plan-card, .student-week-plan-cell");
	if (card) startStudy(card);
});

document.addEventListener("click", (event) => {
	const button = event.target.closest("[data-upload-study-attachment]");
	if (!button || !els.studentAttachmentPicker) return;
	if (button.disabled) return;
	const study = {
		subjectId: button.dataset.subjectId,
		date: button.dataset.date,
	};
	button.disabled = true;
	fetchStudyAttachmentInfo(study)
		.then(({ analysis }) => {
			updateAttachmentUploadButton(study, analysis);
			if (isAttachmentUploadLocked(analysis)) {
				showStudentToast("사진 확인이 시작되어 더 등록할 수 없습니다.", true);
				return;
			}
			pendingAttachmentStudy = study;
			els.studentAttachmentPicker.click();
			button.disabled = false;
		})
		.catch(() => {
			pendingAttachmentStudy = study;
			els.studentAttachmentPicker.click();
			button.disabled = false;
		});
});

document.addEventListener("click", (event) => {
	const button = event.target.closest("[data-open-study-attachment]");
	if (!button) return;
	const list = button.closest(".student-attachment-list");
	const items = Array.from(list?.querySelectorAll("[data-open-study-attachment]") || [])
		.map((item) => ({
			id: item.dataset.openStudyAttachment || "",
			name: item.dataset.attachmentName || "첨부 사진",
			url: item.dataset.attachmentUrl || "",
		}))
		.filter((item) => item.url);
	const index = Math.max(0, items.findIndex((item) => item.id === button.dataset.openStudyAttachment));
	openAttachmentGallery(items, index);
});

document.addEventListener("click", (event) => {
	const button = event.target.closest("[data-delete-study-attachment]");
	if (!button) return;
	if (!window.confirm("등록한 사진을 삭제할까요?")) return;
	const study = {
		subjectId: button.dataset.subjectId,
		date: button.dataset.date,
	};
	button.disabled = true;
	deleteStudyAttachment(button.dataset.deleteStudyAttachment, study)
		.then((count) => {
			const message = `사진 삭제 완료. 현재 등록 사진 ${count}개`;
			setStatus(message);
			showStudentToast(message);
		})
		.catch((error) => {
			button.disabled = false;
			setStatus(error.message || "첨부 사진을 삭제하지 못했습니다.", true);
			showStudentToast(error.message || "첨부 사진을 삭제하지 못했습니다.", true);
		});
});

els.studySessionComplete.addEventListener("click", () => {
	completeStudy().catch(() => {});
});

if (els.studentAttachmentPicker) {
	els.studentAttachmentPicker.addEventListener("change", () => {
		uploadCompletedStudyAttachments(Array.from(els.studentAttachmentPicker.files || [])).catch(() => {});
	});
}

els.studySessionCancel.addEventListener("click", () => {
	closeStudySession();
});

showPage(getSavedPage());
setupNativeBackButton();
setupNativeAccessLogEvents();
recordStartupAccessLog();
loadStudentState();
refreshPushState();
registerNativePushIfAvailable();
