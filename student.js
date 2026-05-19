const AUTH_TOKEN_KEY = "local-study-manager-token";
const AUTH_USER_KEY = "local-study-manager-user";
const AUTH_TOKEN_KEY_PREFIX = `${AUTH_TOKEN_KEY}:`;
const AUTH_USER_KEY_PREFIX = `${AUTH_USER_KEY}:`;
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

const els = {
	pageViews: document.querySelectorAll(".page-view"),
	navItems: document.querySelectorAll(".nav-item"),
	avatar: document.querySelector("#studentAvatar"),
	studentName: document.querySelector("#studentName"),
	teacherName: document.querySelector("#teacherName"),
	accountSummary: document.querySelector("#studentAccountSummary"),
	logout: document.querySelector("#studentLogout"),
	todayCompleteCount: document.querySelector("#todayCompleteCount"),
	weekPlanCount: document.querySelector("#weekPlanCount"),
	rewardTotal: document.querySelector("#studentRewardTotal"),
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
	studySessionStartTime: document.querySelector("#studySessionStartTime"),
	studySessionElapsed: document.querySelector("#studySessionElapsed"),
	studySessionFeedback: document.querySelector("#studySessionFeedback"),
	studySessionComplete: document.querySelector("#studySessionComplete"),
	studySessionCancel: document.querySelector("#studySessionCancel"),
};

const pageTitles = {
	today: "오늘 학습",
	week: "이번 주 학습",
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

function getStudentName() {
	return state.student.name || authUser.name || "학생";
}

function getStudentInitial() {
	return getStudentName().trim().charAt(0).toUpperCase() || "S";
}

function showPage(page) {
	activePage = pageTitles[page] ? page : "today";
	els.pageViews.forEach((view) => {
		view.classList.toggle("active", view.dataset.page === activePage);
	});
	els.navItems.forEach((item) => {
		item.classList.toggle("active", item.dataset.targetPage === activePage);
	});
}

function formatDate(date) {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
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
	const todayCompleted = todayPlans.filter((plan) => plan.entry?.completed).length;
	const rewardTotals = getRewardTotals();
	const rewardHistoryCount = getRewardHistoryBatches().length;

	els.avatar.textContent = getStudentInitial();
	els.studentName.textContent = getStudentName();
	els.teacherName.textContent = state.student.teacherName ? `${state.student.teacherName} 선생님` : "선생님";
	els.accountSummary.textContent = state.student.loginId ? `학생 ID ${state.student.loginId}` : "로그인 정보를 안전하게 관리하세요.";
	els.todayCompleteCount.textContent = `${todayCompleted} / ${todayPlans.length}`;
	els.weekPlanCount.textContent = String(weekPlans.length);
	els.rewardTotal.textContent = formatRewardTotal(rewardTotals);
	els.rewardPageTotal.textContent = formatRewardTotal(rewardTotals);
	els.rewardHistoryCount.textContent = String(rewardHistoryCount);
	els.weekRange.textContent = `${formatDate(weekStart)} ~ ${formatDate(addDays(weekStart, 6))}`;
	els.todayPlanList.innerHTML = renderPlanList(todayPlans, "오늘 학습 계획이 없습니다.");
	els.weekPlanList.innerHTML = renderPlanList(visibleWeekPlans, "선택한 조건의 학습 계획이 없습니다.");
	els.rewardHistory.innerHTML = renderRewardHistory();
}

function renderPlanList(plans, emptyText) {
	if (!plans.length) return `<div class="empty-state">${escapeHtml(emptyText)}</div>`;

	return plans
		.map((plan) => {
			const entry = plan.entry || {};
			const amountText = entry.amount || "학습량 미입력";
			const recordItems = [
				entry.studyStartedAt ? `시작 ${formatDateTime(entry.studyStartedAt)}` : "",
				entry.studyDurationSeconds ? `누적 ${formatDurationSeconds(entry.studyDurationSeconds)}` : "",
				entry.studentFeedback ? `피드백 ${entry.studentFeedback}` : "",
				!entry.studyStartedAt && !entry.studyDurationSeconds && entry.memo ? entry.memo : "",
			].filter(Boolean);
			const completedDetail = entry.completed
				? `<div class="student-plan-record">
            <span>완료 기록</span>
            ${recordItems.map((item) => `<p>${escapeHtml(item)}</p>`).join("")}
          </div>`
				: "";
			return `
      <article class="student-plan-card ${entry.completed ? "is-complete" : ""} ${plan.date === formatDate(new Date()) ? "is-today" : ""}" data-subject-id="${escapeHtml(plan.subject.id)}" data-date="${escapeHtml(plan.date)}" data-amount="${escapeHtml(amountText)}">
        <div class="student-plan-head">
          <div>
            <strong><span class="subject-color-dot" style="background:${escapeHtml(plan.subject.color || "#2f78d4")}" aria-hidden="true"></span>${escapeHtml(plan.subject.name)} · ${escapeHtml(plan.subject.book)}</strong>
            <p>${escapeHtml(plan.date)} ${escapeHtml(dayNames[parseDate(plan.date).getDay()])} · ${escapeHtml(normalizeScheduleTime(plan.subject.scheduleTime) || "시간 미설정")}</p>
          </div>
          <div class="student-plan-badges">
            ${plan.date === formatDate(new Date()) ? `<span class="today-badge">오늘</span>` : ""}
            ${entry.completed ? `<span class="entry-status">완료</span>` : `<span class="entry-status pending">미완료</span>`}
            ${entry.rewardAwarded && !entry.rewardRedeemed ? `<span class="reward-badge">+${escapeHtml(formatReward(entry.rewardAmount, entry.rewardLabel))}</span>` : ""}
          </div>
        </div>
        <div class="student-plan-amount">
          <span>학습량</span>
          <strong>${escapeHtml(amountText)}</strong>
        </div>
        ${completedDetail}
        <div class="student-plan-actions">
          <button type="button" data-start-study ${entry.completed ? "disabled" : ""}>${entry.completed ? "완료됨" : "학습 시작"}</button>
        </div>
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

function startStudy(card) {
	const subject = state.subjects.find((item) => item.id === card.dataset.subjectId);
	if (!subject) return;

	activeStudy = {
		subjectId: card.dataset.subjectId,
		date: card.dataset.date,
		subject,
		amount: card.dataset.amount || "학습량 미입력",
		startedAt: new Date(),
	};
	els.studySessionTitle.textContent = `${subject.name} · ${subject.book}`;
	els.studySessionMeta.textContent = `${activeStudy.date} ${dayNames[parseDate(activeStudy.date).getDay()]} · ${normalizeScheduleTime(subject.scheduleTime) || "시간 미설정"}`;
	els.studySessionAmount.textContent = `학습량 ${activeStudy.amount}`;
	els.studySessionStartTime.textContent = formatClockTime(activeStudy.startedAt);
	els.studySessionFeedback.value = "";
	els.studySessionScreen.hidden = false;
	document.body.classList.add("is-study-session-active");
	updateStudyTimer();
	studyTimer = window.setInterval(updateStudyTimer, 1000);
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
		await saveStudyEntry({
			subjectId: activeStudy.subjectId,
			date: activeStudy.date,
			amount: activeStudy.amount === "학습량 미입력" ? "" : activeStudy.amount,
			memo: "",
			completed: true,
			studyStartedAt: activeStudy.startedAt.toISOString(),
			studyDurationSeconds: Math.max(1, Math.round(elapsed / 1000)),
			studentFeedback: els.studySessionFeedback.value.trim(),
		});
		closeStudySession();
	} finally {
		els.studySessionComplete.disabled = false;
	}
}

els.logout.addEventListener("click", () => {
	localStorage.removeItem(`${AUTH_TOKEN_KEY_PREFIX}student`);
	localStorage.removeItem(`${AUTH_USER_KEY_PREFIX}student`);
	localStorage.removeItem(AUTH_TOKEN_KEY);
	localStorage.removeItem(AUTH_USER_KEY);
	window.location.href = "./login.html";
});

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
	const card = button.closest(".student-plan-card");
	if (card) startStudy(card);
});

els.studySessionComplete.addEventListener("click", () => {
	completeStudy().catch(() => {});
});

els.studySessionCancel.addEventListener("click", () => {
	closeStudySession();
});

loadStudentState();
