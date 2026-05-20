const LEGACY_STORAGE_KEY = "local-study-manager-v1";
const AUTH_TOKEN_KEY = "local-study-manager-token";
const AUTH_USER_KEY = "local-study-manager-user";
const AUTH_TOKEN_KEY_PREFIX = `${AUTH_TOKEN_KEY}:`;
const AUTH_USER_KEY_PREFIX = `${AUTH_USER_KEY}:`;

const authSession = getSessionForRole("teacher");
const token = authSession.token;

if (!token) {
  window.location.replace("./login.html");
  throw new Error("Authentication required.");
}

const authUser = authSession.user;
const STORAGE_KEY = `${LEGACY_STORAGE_KEY}:${authUser.id || authUser.email || "anonymous"}`;

const els = {
  form: document.querySelector("#profilePageForm"),
  name: document.querySelector("#profilePageName"),
  email: document.querySelector("#profilePageEmail"),
  phone: document.querySelector("#profilePagePhone"),
  phoneVerification: document.querySelector("#profilePhoneVerification"),
  phoneCodeSend: document.querySelector("#profilePhoneCodeSend"),
  phoneCodeFields: document.querySelector("#profilePhoneCodeFields"),
  phoneCode: document.querySelector("#profilePhoneCode"),
  phoneCodeVerify: document.querySelector("#profilePhoneCodeVerify"),
  phoneHelp: document.querySelector("#profilePhoneHelp"),
  password: document.querySelector("#profilePagePassword"),
  marketingConsent: document.querySelector("#profileMarketingConsent"),
  toast: document.querySelector("#profileToast")
};

let toastTimer = null;
let originalPhone = "";
const phoneVerificationState = {
  phone: "",
  token: ""
};
let phoneCooldownTimer = null;

function setMessage(text, isError = false) {
  if (!text) {
    els.toast.textContent = "";
    els.toast.classList.remove("is-visible", "is-error");
    return;
  }

  clearTimeout(toastTimer);
  els.toast.textContent = text;
  els.toast.classList.toggle("is-error", isError);
  els.toast.classList.add("is-visible");
  toastTimer = setTimeout(() => {
    els.toast.classList.remove("is-visible");
  }, isError ? 4000 : 2400);
}

function logout() {
  localStorage.removeItem(`${AUTH_TOKEN_KEY_PREFIX}teacher`);
  localStorage.removeItem(`${AUTH_USER_KEY_PREFIX}teacher`);
  localStorage.removeItem(AUTH_TOKEN_KEY);
  localStorage.removeItem(AUTH_USER_KEY);
  window.location.href = "./login.html";
}

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

function normalizePhone(phone) {
  return String(phone || "").replace(/\D/g, "");
}

function setPhoneHelp(text, isSuccess = false) {
  if (!els.phoneHelp) return;
  els.phoneHelp.textContent = text;
  els.phoneHelp.classList.toggle("is-success", isSuccess);
}

function syncPhoneVerificationUi() {
  if (!els.phoneVerification) return;
  const normalizedPhone = normalizePhone(els.phone.value);
  const changed = normalizedPhone !== originalPhone;
  const verified = Boolean(phoneVerificationState.token && phoneVerificationState.phone === normalizedPhone);

  els.phoneVerification.hidden = !changed;
  if (!changed) {
    phoneVerificationState.phone = "";
    phoneVerificationState.token = "";
    els.phoneCodeFields.hidden = true;
    els.phoneCodeSend.hidden = false;
    els.phoneCodeSend.disabled = false;
    els.phoneCode.value = "";
    setPhoneHelp("휴대폰 번호를 변경하려면 새 번호 인증이 필요합니다.");
    return;
  }

  if (verified) {
    els.phoneCodeFields.hidden = true;
    els.phoneCodeSend.hidden = true;
    setPhoneHelp("휴대폰 인증이 완료되었습니다.", true);
    return;
  }

  els.phoneCodeSend.hidden = false;
  setPhoneHelp("휴대폰 번호를 변경하려면 새 번호 인증이 필요합니다.");
}

function startPhoneCooldown(seconds = 60) {
  const button = els.phoneCodeSend;
  if (!button) return;
  const originalText = button.dataset.originalText || button.textContent;
  button.dataset.originalText = originalText;
  clearInterval(phoneCooldownTimer);

  let remaining = Math.min(Math.max(Number(seconds) || 60, 1), 300);
  button.disabled = true;
  button.textContent = `${remaining}초 후 재요청`;
  els.phone.readOnly = true;
  els.phone.classList.add("is-locked");

  phoneCooldownTimer = setInterval(() => {
    remaining -= 1;
    if (remaining <= 0) {
      clearInterval(phoneCooldownTimer);
      phoneCooldownTimer = null;
      button.disabled = false;
      button.textContent = originalText;
      els.phone.readOnly = false;
      els.phone.classList.remove("is-locked");
      return;
    }
    button.textContent = `${remaining}초 후 재요청`;
  }, 1000);
}

async function requestJson(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  if (!(response.headers.get("content-type") || "").includes("application/json")) {
    throw new Error("StudyFlow API 응답이 아닙니다. 서버의 /api 연결을 확인하세요.");
  }
  const data = await response.json().catch(() => ({}));

  if (response.status === 401) {
    logout();
    throw new Error("로그인이 필요합니다.");
  }

  if (!response.ok) {
    throw new Error(data.message || "요청을 처리하지 못했습니다.");
  }

  return data;
}

function updateLocalProfile(user) {
  localStorage.setItem(`${AUTH_USER_KEY_PREFIX}teacher`, JSON.stringify(user));

  try {
    const state = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    state.profile = {
      ...(state.profile || {}),
      name: user.name,
      email: user.email,
      phone: user.phone || "",
      marketingConsent: Boolean(user.marketingConsent),
      password: ""
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Local cache update failure should not block the saved server profile.
  }
}

function renderProfile(user) {
  els.name.value = user.name || "";
  els.email.value = user.email || "";
  els.phone.value = user.phone || "";
  els.phone.readOnly = false;
  els.phone.classList.remove("is-locked");
  originalPhone = normalizePhone(user.phone);
  phoneVerificationState.phone = "";
  phoneVerificationState.token = "";
  els.password.value = "";
  els.marketingConsent.checked = Boolean(user.marketingConsent);
  syncPhoneVerificationUi();
}

async function loadProfile() {
  try {
    const data = await requestJson("/api/auth/me");
    renderProfile(data.user);
    setMessage("");
  } catch (error) {
    setMessage(error.message, true);
  }
}

async function saveProfile(event) {
  event.preventDefault();
  const name = els.name.value.trim();
  const normalizedPhone = normalizePhone(els.phone.value);

  if (!name) {
    setMessage("이름을 입력하세요.", true);
    return;
  }

  if (normalizedPhone && !/^01\d{8,9}$/.test(normalizedPhone)) {
    setMessage("휴대폰 번호를 정확히 입력하세요.", true);
    els.phone.focus();
    return;
  }

  if (normalizedPhone !== originalPhone && (!phoneVerificationState.token || phoneVerificationState.phone !== normalizedPhone)) {
    setMessage("변경할 휴대폰 번호를 인증하세요.", true);
    els.phone.focus();
    return;
  }

  try {
    const data = await requestJson("/api/auth/profile", {
      method: "PUT",
      body: JSON.stringify({
        name,
        phone: normalizedPhone,
        phoneVerificationToken: phoneVerificationState.token,
        password: els.password.value.trim(),
        marketingConsent: els.marketingConsent.checked
      })
    });

    updateLocalProfile(data.user);
    renderProfile(data.user);
    setMessage("저장되었습니다.");
  } catch (error) {
    setMessage(error.message, true);
  }
}

async function sendProfilePhoneCode() {
  const phone = normalizePhone(els.phone.value);

  if (!/^01\d{8,9}$/.test(phone)) {
    setMessage("휴대폰 번호를 정확히 입력하세요.", true);
    els.phone.focus();
    return;
  }

  if (phone === originalPhone) {
    setMessage("현재 등록된 번호와 같습니다.", true);
    return;
  }

  const result = await requestJson("/api/auth/profile/phone-code", {
    method: "POST",
    body: JSON.stringify({ phone })
  });

  phoneVerificationState.phone = phone;
  phoneVerificationState.token = "";
  els.phoneCodeFields.hidden = false;
  els.phoneCode.value = "";
  startPhoneCooldown(result.expiresInSeconds);
  setPhoneHelp(result.verificationCode ? `인증번호를 발급했습니다. 개발 인증번호: ${result.verificationCode}` : "인증번호를 발송했습니다.");
  els.phoneCode.focus();
}

async function verifyProfilePhoneCode() {
  const phone = normalizePhone(els.phone.value);
  const code = String(els.phoneCode.value || "").trim();

  if (!/^\d{6}$/.test(code)) {
    setMessage("6자리 인증번호를 입력하세요.", true);
    els.phoneCode.focus();
    return;
  }

  const result = await requestJson("/api/auth/profile/verify-phone", {
    method: "POST",
    body: JSON.stringify({ phone, code })
  });

  phoneVerificationState.phone = phone;
  phoneVerificationState.token = result.phoneVerificationToken;
  if (phoneCooldownTimer) {
    clearInterval(phoneCooldownTimer);
    phoneCooldownTimer = null;
  }
  els.phoneCodeFields.hidden = true;
  els.phoneCodeSend.hidden = true;
  els.phone.readOnly = true;
  els.phone.classList.add("is-locked");
  setPhoneHelp("휴대폰 인증이 완료되었습니다.", true);
  setMessage("휴대폰 인증이 완료되었습니다.");
}

els.form.addEventListener("submit", saveProfile);
els.phone.addEventListener("input", () => {
  phoneVerificationState.phone = "";
  phoneVerificationState.token = "";
  syncPhoneVerificationUi();
});
els.phoneCodeSend.addEventListener("click", async () => {
  try {
    await sendProfilePhoneCode();
  } catch (error) {
    setMessage(error.message, true);
  }
});
els.phoneCodeVerify.addEventListener("click", async () => {
  try {
    await verifyProfilePhoneCode();
  } catch (error) {
    setMessage(error.message, true);
  }
});
loadProfile();
