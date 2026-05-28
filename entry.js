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
	form: document.querySelector("#entryPageForm"),
	title: document.querySelector("#entryPageTitle"),
	meta: document.querySelector("#entryPageMeta"),
	subject: document.querySelector("#entryPageSubject"),
	amount: document.querySelector("#entryPageAmount"),
	minimumStudyMinutes: document.querySelector("#entryPageMinimumStudyMinutes"),
	completed: document.querySelector("#entryPageCompleted"),
	memo: document.querySelector("#entryPageMemo"),
	completedInfo: document.querySelector("#entryPageCompletedInfo"),
	studyStartedAt: document.querySelector("#entryPageStudyStartedAt"),
	studyDuration: document.querySelector("#entryPageStudyDuration"),
	studentFeedback: document.querySelector("#entryPageStudentFeedback"),
	attachmentsBlock: document.querySelector("#entryPageAttachmentsBlock"),
	attachmentList: document.querySelector("#entryPageAttachmentList"),
	aiPanel: document.querySelector("#entryPageAiPanel"),
	analyzeButton: document.querySelector("#entryPageAnalyzeButton"),
	aiProgress: document.querySelector("#entryPageAiProgress"),
	aiStatus: document.querySelector("#entryPageAiStatus"),
	aiAnalyzedAt: document.querySelector("#entryPageAiAnalyzedAt"),
	aiResult: document.querySelector("#entryPageAiResult"),
	submit: document.querySelector("#entryPageSubmit"),
	toast: document.querySelector("#entryPageToast"),
};

let state = null;
let activeEntry = null;
let activeSubject = null;
let toastTimer = null;
let isAiAnalyzing = false;
let attachmentObjectUrls = [];
const attachmentGalleryState = {
	items: [],
	index: 0,
	rotations: {},
	zooms: {},
	pointers: new Map(),
	dragStart: null,
	pinchStart: null,
	keyHandler: null,
};

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

function logout() {
	localStorage.removeItem(`${AUTH_TOKEN_KEY_PREFIX}teacher`);
	localStorage.removeItem(`${AUTH_USER_KEY_PREFIX}teacher`);
	localStorage.removeItem(AUTH_TOKEN_KEY);
	localStorage.removeItem(AUTH_USER_KEY);
	window.location.replace("./login.html");
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

async function requestJson(path, options = {}) {
	const headers = {
		Authorization: `Bearer ${authToken}`,
		...(options.body ? { "Content-Type": "application/json" } : {}),
		...(options.headers || {}),
	};
	const response = await fetch(path, {
		...options,
		headers,
	});
	const data = (response.headers.get("content-type") || "").includes("application/json")
		? await response.json().catch(() => ({}))
		: {};
	if (response.status === 401) {
		logout();
		throw new Error("로그인이 필요합니다.");
	}
	if (!response.ok) throw new Error(data.message || "요청을 처리하지 못했습니다.");
	return data;
}

function getQuery() {
	return new URLSearchParams(window.location.search);
}

function escapeHtml(value) {
	return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function entryKey(child, subjectId, date) {
	return `${child}__${subjectId}__${date}`;
}

function getChildKey(child) {
	if (!child) return "";
	if (typeof child === "object") return String(child.id || child.name || "").trim();
	return String(child || "").trim();
}

function getChildAccount(childKeyOrName) {
	const key = getChildKey(childKeyOrName);
	return state.childAccounts.find((child) => getChildKey(child) === key) || state.childAccounts.find((child) => child.name === key) || null;
}

function getChildName(childKeyOrName) {
	return getChildAccount(childKeyOrName)?.name || String(childKeyOrName || "");
}

function normalizeMobilePhone(value) {
	const raw = String(value || "").trim();
	if (!raw) return "";
	const digits = raw.replace(/\D/g, "");
	if (/^01\d{8}$/.test(digits)) return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
	if (/^01\d{9}$/.test(digits)) return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
	return raw;
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

function readOptionalMinimumStudyMinutes(value) {
	if (!value || typeof value !== "object") return null;
	if (value.minimumStudyMinutes !== undefined && value.minimumStudyMinutes !== null) return normalizeMinimumStudyMinutes(value.minimumStudyMinutes);
	if (value.minimum_study_minutes !== undefined && value.minimum_study_minutes !== null) return normalizeMinimumStudyMinutes(value.minimum_study_minutes);
	return null;
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
	const amount = Number.parseInt(value, 10);
	return Number.isFinite(amount) && amount > 0 ? amount : 0;
}

function normalizeRewardLabel(value) {
	return String(value || "").trim().slice(0, 20) || "포인트";
}

function normalizeSubject(subject = {}) {
	return {
		...subject,
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

function normalizeState(value = {}) {
	const childAccounts = Array.isArray(value.childAccounts)
		? value.childAccounts.map((child) => ({
				...child,
				name: String(child.name || "").trim(),
				phone: normalizeMobilePhone(child.phone),
				parentPhone: normalizeMobilePhone(child.parentPhone),
			})).filter((child) => child.name)
		: [];
	const subjectsByChild = Object.fromEntries(childAccounts.map((child) => [getChildKey(child), []]));
	const nameCounts = new Map();
	childAccounts.forEach((child) => nameCounts.set(child.name, (nameCounts.get(child.name) || 0) + 1));
	childAccounts.forEach((child) => {
		const childKey = getChildKey(child);
		const legacySubjects = nameCounts.get(child.name) === 1 ? value.subjectsByChild?.[child.name] : null;
		const subjects = value.subjectsByChild?.[childKey] || legacySubjects || [];
		subjectsByChild[childKey] = Array.isArray(subjects) ? subjects.map((subject) => ({ ...normalizeSubject(subject), childId: childKey })) : [];
	});
	return {
		...value,
		childAccounts,
		subjectSettings: Array.isArray(value.subjectSettings) ? value.subjectSettings : [],
		subjectsByChild,
		entries: value.entries && typeof value.entries === "object" ? value.entries : {},
	};
}

function isServiceExpired(profile = state?.profile) {
	const plan = profile?.plan || {};
	if (Number(plan.monthlyPrice || 0) <= 0) return false;
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
	return "이용기간이 만료되어 AI 분석을 사용할 수 없습니다.";
}

function renderMinimumStudyOptions() {
	els.minimumStudyMinutes.innerHTML = `<option value="0">미설정</option>${Array.from({ length: 12 }, (_, index) => (index + 1) * 10)
		.map((minute) => `<option value="${minute}">${formatMinimumStudyMinutes(minute)}</option>`)
		.join("")}`;
}

function getEntryMinimumStudyMinutes(entry, subject) {
	if (entry && entry.minimumStudyMinutes !== undefined && entry.minimumStudyMinutes !== null) {
		const entryMinutes = normalizeMinimumStudyMinutes(entry.minimumStudyMinutes);
		if (entryMinutes || entry.amount || entry.memo || entry.completed) return entryMinutes;
	}
	return normalizeMinimumStudyMinutes(subject?.minimumStudyMinutes);
}

function getRewardForCompletedEntry(subject, completed, previousEntry = {}) {
	if (previousEntry.rewardAwarded) {
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
	return { awarded: true, amount, label: normalizeRewardLabel(subject.rewardLabel), redeemed: false };
}

function getEntryDateValidationMessage(subject, date) {
	if (!subject) return "교재 정보를 찾을 수 없습니다.";
	if (subject.startDate && date < subject.startDate) return `이 교재는 ${subject.startDate}부터 시작합니다.`;
	if (subject.endDate && date > subject.endDate) return `이 교재는 ${subject.endDate}에 종료됩니다.`;
	return "";
}

function formatDateTime(value) {
	if (!value || value === "unknown") return "-";
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

function getAiStatusText(status) {
	if (status === "completed") return "분석 완료";
	if (status === "analyzing") return "분석 중";
	if (status === "failed") return "분석 실패";
	return "분석 전";
}

function clearAttachmentObjectUrls() {
	attachmentObjectUrls.forEach((url) => URL.revokeObjectURL(url));
	attachmentObjectUrls = [];
}

function renderAiPanel(attachments = [], analysis = {}) {
	const status = isAiAnalyzing ? "analyzing" : analysis.aiStatus || "none";
	const result = String(analysis.aiResult || "").trim();
	const expired = isServiceExpired();
	els.aiPanel.hidden = attachments.length === 0;
	els.analyzeButton.disabled = attachments.length === 0 || status === "analyzing" || expired;
	els.analyzeButton.textContent = status === "completed" ? "다시 분석" : status === "analyzing" ? "분석 중" : "AI 분석";
	els.aiProgress.hidden = status !== "analyzing";
	els.aiStatus.textContent = expired ? "이용기간 만료" : getAiStatusText(status);
	els.aiStatus.classList.toggle("is-error", status === "failed");
	els.aiAnalyzedAt.textContent = analysis.aiAnalyzedAt ? formatDateTime(analysis.aiAnalyzedAt) : "-";
	els.aiResult.hidden = !result;
	els.aiResult.innerHTML = result ? escapeHtml(result).replaceAll("\n", "<br>") : "";
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
	const gallery = document.querySelector("#attachmentGallery");
	if (!gallery) return;
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
	getAttachmentGallery().hidden = false;
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

async function renderAttachments() {
	clearAttachmentObjectUrls();
	els.attachmentList.innerHTML = "";
	renderAiPanel([]);
	els.attachmentsBlock.hidden = !activeEntry?.completed;
	if (!activeEntry?.completed) return;

	els.attachmentList.innerHTML = `<p class="entry-attachment-empty">첨부 사진을 불러오는 중입니다.</p>`;
	try {
		const params = new URLSearchParams({
			childId: activeEntry.childId || activeEntry.child,
			child: getChildName(activeEntry.childId || activeEntry.child),
			subjectId: activeEntry.subjectId,
			date: activeEntry.date,
			markViewed: "true",
		});
		const data = await requestJson(`/api/attachments/entry?${params}`, {
		});
		const attachments = data.attachments || [];
		if (!attachments.length) {
			els.attachmentsBlock.hidden = true;
			els.attachmentList.innerHTML = "";
			renderAiPanel([]);
			return;
		}

		els.attachmentsBlock.hidden = false;
		renderAiPanel(attachments, data.analysis || {});
		els.attachmentList.innerHTML = attachments
			.map((attachment) => `
        <article class="entry-attachment-item" data-attachment-id="${escapeHtml(attachment.id)}">
          <button class="entry-attachment-thumb" type="button" data-open-entry-attachment="${escapeHtml(attachment.id)}">불러오는 중</button>
          <p>${escapeHtml(attachment.originalName || "첨부 사진")}</p>
        </article>
      `)
			.join("");

		await Promise.all(attachments.map(async (attachment) => {
			const response = await fetch(attachment.fileUrl, {
				headers: { Authorization: `Bearer ${authToken}` },
			});
			if (!response.ok) return;
			const blob = await response.blob();
			const url = URL.createObjectURL(blob);
			attachmentObjectUrls.push(url);
			const item = els.attachmentList.querySelector(`[data-attachment-id="${CSS.escape(attachment.id)}"]`);
			const thumb = item?.querySelector(".entry-attachment-thumb");
			if (!thumb) return;
			thumb.innerHTML = `<img src="${url}" alt="${escapeHtml(attachment.originalName || "첨부 사진")}">`;
			thumb.dataset.attachmentUrl = url;
			thumb.dataset.attachmentName = attachment.originalName || "첨부 사진";
		}));
	} catch (error) {
		els.attachmentList.innerHTML = `<p class="entry-attachment-empty">${escapeHtml(error.message || "첨부 사진을 불러오지 못했습니다.")}</p>`;
	}
}

async function analyzeAttachments() {
	if (!activeEntry) return;
	if (isServiceExpired()) {
		els.aiStatus.textContent = getServiceExpiredMessage();
		els.aiStatus.classList.add("is-error");
		setMessage(getServiceExpiredMessage(), true);
		return;
	}
	try {
		isAiAnalyzing = true;
		renderAiPanel([{ id: "pending" }], { aiStatus: "analyzing" });
		const data = await requestJson("/api/attachments/entry/analyze", {
			method: "POST",
			body: JSON.stringify({
				childId: activeEntry.childId || activeEntry.child,
				child: getChildName(activeEntry.childId || activeEntry.child),
				subjectId: activeEntry.subjectId,
				date: activeEntry.date,
			}),
		});
		isAiAnalyzing = false;
		renderAiPanel(data.attachments || [], data.analysis || { aiStatus: data.aiStatus, aiResult: data.aiResult, aiAnalyzedAt: data.aiAnalyzedAt });
		await renderAttachments();
		setMessage("AI 분석이 완료되었습니다.");
	} catch (error) {
		isAiAnalyzing = false;
		els.aiProgress.hidden = true;
		els.aiStatus.textContent = error.message || "AI 분석에 실패했습니다.";
		els.aiStatus.classList.add("is-error");
		els.analyzeButton.disabled = false;
		els.analyzeButton.textContent = "AI 분석";
	}
}

function renderEntry() {
	const query = getQuery();
	const child = query.get("childId") || query.get("child") || "";
	const subjectId = query.get("subjectId") || "";
	const date = query.get("date") || "";
	const subject = state.subjectsByChild?.[child]?.find((item) => item.id === subjectId);
	if (!child || !subjectId || !date || !subject) {
		els.subject.textContent = "학습 기록을 찾을 수 없습니다.";
		els.meta.textContent = "주간 학습에서 다시 선택해 주세요.";
		els.form.querySelectorAll("input, select, textarea, button").forEach((control) => {
			control.disabled = true;
		});
		return;
	}

	const key = entryKey(child, subjectId, date);
	const existingEntry = state.entries[key] || null;
	activeSubject = subject;
	activeEntry = {
		...(existingEntry || {}),
		childId: child,
		child: getChildName(child),
		subjectId,
		date,
		key,
	};

	els.title.textContent = "학습량 입력";
	els.subject.textContent = `${subject.name} / ${subject.book}`;
	els.meta.textContent = `${date} · ${getChildName(child)}`;
	els.amount.value = activeEntry.amount || "";
	els.minimumStudyMinutes.value = String(getEntryMinimumStudyMinutes(existingEntry, subject));
	els.memo.value = activeEntry.memo || "";
	els.completed.checked = Boolean(activeEntry.completed);
	els.completedInfo.hidden = !activeEntry.completed;
	els.studyStartedAt.textContent = activeEntry.studyStartedAt ? formatDateTime(activeEntry.studyStartedAt) : "-";
	els.studyDuration.textContent = formatStudyDurationSeconds(activeEntry.studyDurationSeconds) || "-";
	els.studentFeedback.textContent = activeEntry.studentFeedback?.trim() || "-";
	renderAttachments();
}

async function notifyStudentManualSchedule(entry) {
	const childAccount = getChildAccount(entry.childId || entry.child);
	if (!childAccount?.id || !activeSubject) return;
	try {
		await requestJson("/api/push/teacher-schedule", {
			method: "POST",
			body: JSON.stringify({
				childId: childAccount.id,
				childName: childAccount.name,
				subjectName: activeSubject.name,
				bookName: activeSubject.book,
				date: entry.date,
				amount: entry.amount || "",
				memo: entry.memo || "",
			}),
		});
	} catch (error) {
		console.warn("Failed to send manual schedule push.", error);
	}
}

async function saveEntry(event) {
	event.preventDefault();
	if (!activeEntry || !activeSubject) return;
	const validationMessage = getEntryDateValidationMessage(activeSubject, activeEntry.date);
	if (validationMessage) {
		setMessage(validationMessage, true);
		return;
	}

	const amount = els.amount.value.trim();
	const minimumStudyMinutes = normalizeMinimumStudyMinutes(els.minimumStudyMinutes.value);
	const memo = els.memo.value.trim();
	const completed = els.completed.checked;
	const previousEntry = state.entries[activeEntry.key] || {};
	const shouldNotifyManualSchedule = !completed && Boolean(amount || memo || minimumStudyMinutes) && !previousEntry.planned && !previousEntry.amount && !previousEntry.memo && !previousEntry.completed;
	const reward = getRewardForCompletedEntry(activeSubject, completed, previousEntry);
	const entry = {
		...previousEntry,
		childId: activeEntry.childId || activeEntry.child,
		child: getChildName(activeEntry.childId || activeEntry.child),
		subjectId: activeEntry.subjectId,
		date: activeEntry.date,
		key: activeEntry.key,
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

	try {
		els.submit.disabled = true;
		const data = await requestJson("/api/state/entries", {
			method: "PUT",
			body: JSON.stringify(entry),
		});
		const savedEntry = data.entry || entry;
		delete state.entries[activeEntry.key];
		state.entries[savedEntry.key] = savedEntry;
		localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
		activeEntry = savedEntry;
		setMessage("저장되었습니다.");
		if (shouldNotifyManualSchedule) await notifyStudentManualSchedule(savedEntry);
		renderEntry();
	} catch (error) {
		setMessage(error.message || "저장하지 못했습니다.", true);
	} finally {
		els.submit.disabled = false;
	}
}

async function init() {
	renderMinimumStudyOptions();
	try {
		const data = await requestJson("/api/state", {
		});
		state = normalizeState(data.state || {});
		localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
		renderEntry();
	} catch (error) {
		els.subject.textContent = "데이터를 불러오지 못했습니다.";
		els.meta.textContent = error.message || "서버 상태를 확인해 주세요.";
		setMessage(error.message || "데이터를 불러오지 못했습니다.", true);
	}
}

els.form.addEventListener("submit", saveEntry);
els.completed.addEventListener("change", () => {
	if (activeEntry) activeEntry.completed = els.completed.checked;
	els.completedInfo.hidden = !els.completed.checked;
	if (els.completed.checked) renderAttachments();
});
els.analyzeButton.addEventListener("click", analyzeAttachments);
els.attachmentList.addEventListener("click", (event) => {
	const button = event.target.closest("[data-open-entry-attachment]");
	if (!button) return;
	const items = Array.from(els.attachmentList.querySelectorAll("[data-open-entry-attachment]"))
		.map((item) => ({
			id: item.dataset.openEntryAttachment || "",
			name: item.dataset.attachmentName || "첨부 사진",
			url: item.dataset.attachmentUrl || "",
		}))
		.filter((item) => item.url);
	const index = Math.max(0, items.findIndex((item) => item.id === button.dataset.openEntryAttachment));
	openAttachmentGallery(items, index);
});
window.addEventListener("pagehide", () => {
	clearAttachmentObjectUrls();
	closeAttachmentGallery();
});
window.addEventListener("beforeunload", (event) => {
	if (!isAiAnalyzing) return;
	event.preventDefault();
	event.returnValue = "";
});

init();
