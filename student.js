const AUTH_TOKEN_KEY = "local-study-manager-token";
const AUTH_USER_KEY = "local-study-manager-user";
const AUTH_TOKEN_KEY_PREFIX = `${AUTH_TOKEN_KEY}:`;
const AUTH_USER_KEY_PREFIX = `${AUTH_USER_KEY}:`;
const PAGE_STORAGE_KEY = "studyflow-student-active-page";
const authSession = getSessionForRole("student");
const authToken = authSession.token;
const authUser = authSession.user;

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
	todayPlanList: document.querySelector("#todayPlanList"),
	weekPlanList: document.querySelector("#weekPlanList"),
	rewardHistory: document.querySelector("#studentRewardHistory"),
	studySessionScreen: document.querySelector("#studySessionScreen"),
	studySessionProgress: document.querySelector("#studySessionProgress"),
	studySessionTitle: document.querySelector("#studySessionTitle"),
	studySessionMeta: document.querySelector("#studySessionMeta"),
	studySessionAmount: document.querySelector("#studySessionAmount"),
	studySessionTeacherNoteRow: document.querySelector("#studySessionTeacherNoteRow"),
	studySessionTeacherNote: document.querySelector("#studySessionTeacherNote"),
	studySessionStartTime: document.querySelector("#studySessionStartTime"),
	studySessionElapsed: document.querySelector("#studySessionElapsed"),
	studySessionFeedback: document.querySelector("#studySessionFeedback"),
	studySessionComplete: document.querySelector("#studySessionComplete"),
	studySessionCancel: document.querySelector("#studySessionCancel"),
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
	}).format(date);
}

function formatElapsed(ms) {
	const totalSeconds = Math.max(0, Math.floor(ms / 1000));
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const seconds = totalSeconds % 60;
	return [hours, minutes, seconds].map((value) => String(value).padStart(2, "0")).join(":");
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
	return {
		...value,
		subjects: Array.isArray(value?.subjects)
			? value.subjects.map((subject) => ({
					...subject,
					subjectSettingId: subject.subjectSettingId ?? subject.subject_setting_id ?? "",
					scheduleDays: Array.isArray(subject.scheduleDays) ? subject.scheduleDays : subject.schedule_days || [],
					scheduleTime: normalizeScheduleTime(subject.scheduleTime ?? subject.schedule_time),
					startDate: subject.startDate ?? subject.start_date ?? "",
					endDate: subject.endDate ?? subject.end_date ?? "",
				}))
			: [],
		entries: value?.entries && typeof value.entries === "object" ? value.entries : {},
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
	els.weekPlanList.innerHTML = renderWeekTable(visibleWeekPlans);
	els.rewardHistory.innerHTML = renderRewardHistory();
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
					return `
            <td>
              <button class="entry-cell student-week-plan-cell ${entry ? "has-entry" : ""} ${completed ? "is-complete" : ""} ${planned ? "is-planned" : ""}" type="button"
                data-start-study data-subject-id="${escapeHtml(subject.id)}" data-date="${escapeHtml(plan.date)}" data-amount="${escapeHtml(amountText)}" data-completed="${completed ? "true" : "false"}">
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
			const titleText = [plan.subject.name, plan.subject.book, scheduleTime].filter(Boolean).join(" · ");
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
          </div>`
				: "";
			const actionArea = entry.completed
				? ""
				: `<button type="button" data-start-study>학습 시작</button>`;
			return `
      <article class="student-plan-card ${entry.completed ? "is-complete" : ""}" data-subject-id="${escapeHtml(plan.subject.id)}" data-date="${escapeHtml(plan.date)}" data-amount="${escapeHtml(amountText)}">
        <div class="student-plan-head">
          <div>
            <strong><span class="subject-color-dot" style="background:${escapeHtml(plan.subject.color || "#2f78d4")}" aria-hidden="true"></span>${escapeHtml(titleText)}</strong>
            ${rewardInfo}
          </div>
          <div class="student-plan-badges">
            ${actionArea}
            ${entry.rewardAwarded && !entry.rewardRedeemed ? `<span class="reward-badge">+${escapeHtml(formatReward(entry.rewardAmount, entry.rewardLabel))}</span>` : ""}
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
	els.studySessionTitle.textContent = `${subject.name} · ${subject.book}`;
	els.studySessionMeta.textContent = `${activeStudy.date} ${dayNames[parseDate(activeStudy.date).getDay()]} · ${normalizeScheduleTime(subject.scheduleTime) || "시간 미설정"}`;
	els.studySessionAmount.textContent = activeStudy.amount;
	els.studySessionTeacherNote.textContent = teacherMemo;
	els.studySessionTeacherNoteRow.hidden = !teacherMemo;
	els.studySessionStartTime.textContent = formatClockTime(activeStudy.startedAt);
	els.studySessionFeedback.value = "";
	els.studySessionScreen.hidden = false;
	document.body.classList.add("is-study-session-active");
	updateStudyTimer();
	studyTimer = window.setInterval(updateStudyTimer, 1000);
	notifyTeacherStudyEvent("start", activeStudy);
}

function updateStudyTimer() {
	if (!activeStudy) return;
	const elapsed = Date.now() - activeStudy.startedAt.getTime();
	els.studySessionElapsed.textContent = formatElapsed(elapsed);
	els.studySessionProgress.style.setProperty("--progress", `${Math.min(360, (Math.floor(elapsed / 1000) % 60) * 6)}deg`);
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
	document.body.classList.remove("is-study-session-active");
}

async function completeStudy() {
	if (!activeStudy) return;
	const endedAt = new Date();
	const elapsed = endedAt.getTime() - activeStudy.startedAt.getTime();
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

els.studySessionComplete.addEventListener("click", () => {
	completeStudy().catch(() => {});
});

els.studySessionCancel.addEventListener("click", () => {
	closeStudySession();
});

showPage(getSavedPage());
setupNativeBackButton();
loadStudentState();
refreshPushState();
registerNativePushIfAvailable();
