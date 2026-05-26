(function setupStudyFlowAppLock() {
	const CONFIG_KEY_PREFIX = "studyflow-app-lock:";
	const LOGIN_SKIP_KEY_PREFIX = "studyflow-app-lock-skip:";
	const LOGIN_SKIP_TTL_MS = 3000;
	const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
	const methods = { biometric: "지문인식", pin: "PIN", pattern: "패턴" };
	const timeouts = [
		[60 * 1000, "1분"],
		[5 * 60 * 1000, "5분"],
		[10 * 60 * 1000, "10분"],
		[30 * 60 * 1000, "30분"],
	];
	let context = null;
	let overlay = null;
	let locked = false;
	let backgroundAt = 0;

	window.StudyFlowAppLock = {
		init,
		renderSettings,
		handleSettingsClick,
		handleSettingsChange,
		isLocked: () => locked,
	};

	function init(options) {
		context = {
			role: options.role,
			accountId: options.accountId || "anonymous",
			accountName: options.accountName || "StudyFlow",
			isNativeApp: options.isNativeApp || (() => false),
			onLogout: options.onLogout || (() => {}),
		};
		ensureOverlay();
		bindLifecycleEvents();
		setTimeout(() => {
			const config = getConfig();
			if (config.enabled && !consumeLoginSkip()) lock();
		}, 200);
		return window.StudyFlowAppLock;
	}

	function bindLifecycleEvents() {
		document.addEventListener("visibilitychange", () => {
			if (document.hidden) {
				backgroundAt = Date.now();
				return;
			}
			lockIfNeededAfterBackground();
		});
		const appPlugin = window.Capacitor?.Plugins?.App;
		if (!context.isNativeApp() || !appPlugin?.addListener) return;
		appPlugin.addListener("pause", () => {
			backgroundAt = Date.now();
		});
		appPlugin.addListener("appStateChange", (state) => {
			if (state?.isActive) lockIfNeededAfterBackground();
			else backgroundAt = Date.now();
		});
		appPlugin.addListener("resume", lockIfNeededAfterBackground);
	}

	function lockIfNeededAfterBackground() {
		const config = getConfig();
		if (!config.enabled || !backgroundAt) return;
		const elapsed = Date.now() - backgroundAt;
		backgroundAt = 0;
		if (elapsed >= normalizeTimeout(config.timeoutMs)) lock();
	}

	function consumeLoginSkip() {
		try {
			const key = `${LOGIN_SKIP_KEY_PREFIX}${context.role}:${context.accountId}`;
			const value = sessionStorage.getItem(key);
			if (!value) return false;
			sessionStorage.removeItem(key);
			const createdAt = Number(value) || 0;
			return createdAt > 0 && Date.now() - createdAt <= LOGIN_SKIP_TTL_MS;
		} catch {
			return false;
		}
	}

	function getConfig() {
		try {
			return normalizeConfig(JSON.parse(localStorage.getItem(getConfigKey()) || "{}"));
		} catch {
			return normalizeConfig({});
		}
	}

	function saveConfig(config) {
		localStorage.setItem(getConfigKey(), JSON.stringify(normalizeConfig(config)));
	}

	function getConfigKey() {
		return `${CONFIG_KEY_PREFIX}${context.role}:${context.accountId}`;
	}

	function normalizeConfig(config) {
		return {
			enabled: Boolean(config.enabled),
			method: methods[config.method] ? config.method : "pin",
			secretHash: String(config.secretHash || ""),
			timeoutMs: normalizeTimeout(config.timeoutMs),
		};
	}

	function normalizeTimeout(value) {
		const timeout = Number.parseInt(value, 10) || DEFAULT_TIMEOUT_MS;
		return timeouts.some(([ms]) => ms === timeout) ? timeout : DEFAULT_TIMEOUT_MS;
	}

	function renderSettings(container) {
		if (!container || !context) return;
		const config = getConfig();
		container.innerHTML = `
			<div>
				<p class="eyebrow">App Lock</p>
				<h3>화면 잠금</h3>
				<p>${config.enabled ? `${methods[config.method]} 사용 중` : "사용 안 함"}</p>
			</div>
			<div class="app-lock-settings">
				<div class="settings-option-list" role="radiogroup" aria-label="잠금 방식">
					${Object.entries(methods)
						.map(
							([value, label]) => `
								<label class="settings-option">
									<input type="radio" name="appLockMethod-${context.role}" value="${value}" data-app-lock-method ${config.method === value ? "checked" : ""}>
									<span>${label}</span>
								</label>
							`,
						)
						.join("")}
				</div>
				<select class="app-lock-timeout" data-app-lock-timeout aria-label="잠금 시간">
					${timeouts.map(([value, label]) => `<option value="${value}" ${config.timeoutMs === value ? "selected" : ""}>${label}</option>`).join("")}
				</select>
				<div class="profile-panel-actions">
					<button class="ghost logout-button" type="button" data-app-lock-action="setup">${config.enabled ? "변경" : "설정"}</button>
					${config.enabled ? `<button class="ghost logout-button" type="button" data-app-lock-action="disable">해제</button>` : ""}
				</div>
			</div>
		`;
	}

	function handleSettingsChange(event) {
		const methodInput = event.target.closest("[data-app-lock-method]");
		if (methodInput?.checked) {
			const config = getConfig();
			saveConfig({
				...config,
				method: methodInput.value,
				enabled: config.method === methodInput.value ? config.enabled : false,
				secretHash: config.method === methodInput.value ? config.secretHash : "",
			});
			return true;
		}
		const timeoutInput = event.target.closest("[data-app-lock-timeout]");
		if (timeoutInput) {
			saveConfig({ ...getConfig(), timeoutMs: timeoutInput.value });
			return true;
		}
		return false;
	}

	function handleSettingsClick(event, rerender) {
		const button = event.target.closest("[data-app-lock-action]");
		if (!button) return false;
		if (button.dataset.appLockAction === "disable") {
			localStorage.removeItem(getConfigKey());
			rerender?.();
			return true;
		}
		if (button.dataset.appLockAction === "setup") {
			setupLock()
				.catch((error) => alert(error.message || "화면 잠금을 설정하지 못했습니다."))
				.finally(() => rerender?.());
			return true;
		}
		return false;
	}

	async function setupLock() {
		const config = getConfig();
		if (config.method === "biometric") {
			await authenticateBiometric();
			saveConfig({ ...config, enabled: true, method: "biometric", secretHash: "" });
			return;
		}
		const secret = await openSecretSetup(config.method, `${methods[config.method]} 설정`);
		if (!isValidSecret(config.method, secret)) return;
		saveConfig({ ...config, enabled: true, secretHash: await hashSecret(config.method, secret) });
	}

	function lock() {
		const config = getConfig();
		if (!config.enabled || locked) return;
		locked = true;
		showUnlock(config);
	}

	function ensureOverlay() {
		if (overlay) return overlay;
		overlay = document.createElement("section");
		overlay.className = "app-lock-screen";
		overlay.hidden = true;
		overlay.innerHTML = `<div class="app-lock-panel"></div>`;
		document.body.appendChild(overlay);
		overlay.addEventListener("click", (event) => {
			const action = event.target.closest("[data-lock-overlay-action]")?.dataset.lockOverlayAction;
			if (action === "logout") context.onLogout();
			if (action === "clear") renderSecretInput(getConfig(), "");
			if (action === "biometric") unlockWithBiometric();
		});
		return overlay;
	}

	function showUnlock(config) {
		overlay.hidden = false;
		document.body.classList.add("is-app-locked");
		if (config.method === "biometric") {
			renderBiometricUnlock();
			unlockWithBiometric();
			return;
		}
		renderSecretInput(config, "");
	}

	async function unlockWithBiometric() {
		try {
			await authenticateBiometric();
			unlock();
		} catch (error) {
			setMessage(error.message || "생체인증에 실패했습니다.", true);
		}
	}

	async function authenticateBiometric() {
		const plugin = window.Capacitor?.Plugins?.BiometricAuthNative;
		if (!context.isNativeApp() || !plugin?.checkBiometry || !plugin?.authenticate) {
			throw new Error("모바일앱에서만 지문인식을 사용할 수 있습니다.");
		}
		const biometry = await plugin.checkBiometry();
		if (!biometry?.isAvailable) throw new Error("이 기기에서 지문인식을 사용할 수 없습니다.");
		await plugin.authenticate({
			reason: "StudyFlow 화면 잠금 해제",
			androidTitle: "StudyFlow",
			androidSubtitle: "지문인식으로 잠금 해제",
			cancelTitle: "취소",
			androidConfirmationRequired: false,
			androidBiometryStrength: "weak",
		});
	}

	function renderBiometricUnlock() {
		getPanel().innerHTML = `
			<p class="eyebrow">App Lock</p>
			<h2>화면 잠금</h2>
			<p class="app-lock-message">지문인식으로 잠금을 해제하세요.</p>
			<div class="app-lock-actions">
				<button type="button" data-lock-overlay-action="biometric">지문인식</button>
				<button class="ghost" type="button" data-lock-overlay-action="logout">로그아웃</button>
			</div>
		`;
	}

	function renderSecretInput(config, value) {
		const isPin = config.method === "pin";
		getPanel().innerHTML = `
			<p class="eyebrow">App Lock</p>
			<h2>화면 잠금</h2>
			<p class="app-lock-message">${methods[config.method]}을 입력하세요.</p>
			${isPin ? renderPinInput(value) : renderPatternInput(value)}
			<div class="app-lock-actions">
				<button type="button" data-lock-submit>확인</button>
				<button class="ghost" type="button" data-lock-overlay-action="clear">지우기</button>
				<button class="ghost" type="button" data-lock-overlay-action="logout">로그아웃</button>
			</div>
		`;
		bindSecretInput(config, value);
	}

	function renderPinInput(value) {
		return `<input class="app-lock-pin" type="password" inputmode="numeric" maxlength="6" value="${escapeHtml(value)}" autocomplete="off" autofocus>`;
	}

	function renderPatternInput(value) {
		return `
			<div class="app-lock-pattern" data-pattern-value="${escapeHtml(value)}">
				${Array.from({ length: 9 }, (_, index) => {
					const digit = String(index + 1);
					return `<button class="${value.includes(digit) ? "active" : ""}" type="button" data-pattern-dot="${digit}" aria-label="패턴 ${digit}">${digit}</button>`;
				}).join("")}
			</div>
		`;
	}

	function bindSecretInput(config, value) {
		const panel = getPanel();
		const pin = panel.querySelector(".app-lock-pin");
		if (pin) {
			pin.focus();
			pin.addEventListener("keydown", (event) => {
				if (event.key === "Enter") submitUnlock(config, pin.value);
			});
		}
		panel.querySelectorAll("[data-pattern-dot]").forEach((dot) => {
			dot.addEventListener("click", () => {
				if (value.includes(dot.dataset.patternDot)) return;
				renderSecretInput(config, `${value}${dot.dataset.patternDot}`);
			});
		});
		panel.querySelector("[data-lock-submit]")?.addEventListener("click", () => {
			const secret = pin ? pin.value : panel.querySelector(".app-lock-pattern")?.dataset.patternValue || "";
			submitUnlock(config, secret);
		});
	}

	async function submitUnlock(config, secret) {
		if (await hashSecret(config.method, secret) === config.secretHash) {
			unlock();
			return;
		}
		setMessage("입력값이 일치하지 않습니다.", true);
	}

	function unlock() {
		locked = false;
		overlay.hidden = true;
		document.body.classList.remove("is-app-locked");
	}

	function openSecretSetup(method, title) {
		return new Promise((resolve) => {
			const previousLocked = locked;
			locked = true;
			overlay.hidden = false;
			document.body.classList.add("is-app-locked");
			renderSetupInput(method, title, "", resolve, previousLocked);
		});
	}

	function renderSetupInput(method, title, value, resolve, previousLocked) {
		getPanel().innerHTML = `
				<p class="eyebrow">App Lock</p>
				<h2>${escapeHtml(title)}</h2>
				<p class="app-lock-message">${methods[method]}을 입력하세요.</p>
				${method === "pin" ? renderPinInput(value) : renderPatternInput(value)}
				<div class="app-lock-actions">
					<button type="button" data-lock-setup-submit>저장</button>
					<button class="ghost" type="button" data-lock-setup-cancel>취소</button>
				</div>
			`;
		bindSetupInput(method, title, resolve, previousLocked, value);
	}

	function bindSetupInput(method, title, resolve, previousLocked, value) {
		const panel = getPanel();
		const pin = panel.querySelector(".app-lock-pin");
		if (pin) pin.focus();
		panel.querySelectorAll("[data-pattern-dot]").forEach((dot) => {
			dot.addEventListener("click", () => {
				if (value.includes(dot.dataset.patternDot)) return;
				const nextValue = `${value}${dot.dataset.patternDot}`;
				renderSetupInput(method, title, nextValue, resolve, previousLocked);
			});
		});
		panel.querySelector("[data-lock-setup-submit]")?.addEventListener("click", () => {
			closeSetup(previousLocked);
			resolve(pin ? pin.value : panel.querySelector(".app-lock-pattern")?.dataset.patternValue || "");
		});
		panel.querySelector("[data-lock-setup-cancel]")?.addEventListener("click", () => {
			closeSetup(previousLocked);
			resolve("");
		});
	}

	function closeSetup(previousLocked) {
		locked = previousLocked;
		overlay.hidden = !previousLocked;
		document.body.classList.toggle("is-app-locked", previousLocked);
	}

	function isValidSecret(method, secret) {
		if (method === "pin" && /^\d{4,6}$/.test(secret)) return true;
		if (method === "pattern" && String(secret || "").length >= 4) return true;
		alert(method === "pin" ? "PIN은 숫자 4~6자리로 입력하세요." : "패턴은 4개 이상 선택하세요.");
		return false;
	}

	async function hashSecret(method, secret) {
		const input = `${context.role}:${context.accountId}:${method}:${secret}`;
		const data = new TextEncoder().encode(input);
		const digest = await crypto.subtle.digest("SHA-256", data);
		return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
	}

	function getPanel() {
		return ensureOverlay().querySelector(".app-lock-panel");
	}

	function setMessage(text, isError = false) {
		const message = getPanel().querySelector(".app-lock-message");
		if (!message) return;
		message.textContent = text;
		message.classList.toggle("is-error", isError);
	}

	function escapeHtml(value) {
		return String(value ?? "")
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;")
			.replace(/"/g, "&quot;")
			.replace(/'/g, "&#039;");
	}
})();
