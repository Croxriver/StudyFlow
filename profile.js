const LEGACY_STORAGE_KEY = "local-study-manager-v1";
const AUTH_TOKEN_KEY = "local-study-manager-token";
const AUTH_USER_KEY = "local-study-manager-user";

const token = localStorage.getItem(AUTH_TOKEN_KEY);

if (!token) {
  window.location.replace("./login.html");
  throw new Error("Authentication required.");
}

const authUser = getAuthUser();
if (authUser.role === "student") {
  window.location.replace("./student.html");
  throw new Error("Student mode uses the student page.");
}
const STORAGE_KEY = `${LEGACY_STORAGE_KEY}:${authUser.id || authUser.email || "anonymous"}`;

const els = {
  form: document.querySelector("#profilePageForm"),
  name: document.querySelector("#profilePageName"),
  email: document.querySelector("#profilePageEmail"),
  phone: document.querySelector("#profilePagePhone"),
  password: document.querySelector("#profilePagePassword"),
  marketingConsent: document.querySelector("#profileMarketingConsent"),
  saveMessage: document.querySelector("#profileSaveMessage")
};

function setMessage(text, isError = false) {
  els.saveMessage.textContent = text;
  els.saveMessage.classList.toggle("is-error", isError);
}

function logout() {
  localStorage.removeItem(AUTH_TOKEN_KEY);
  localStorage.removeItem(AUTH_USER_KEY);
  window.location.href = "./login.html";
}

function getAuthUser() {
  try {
    return JSON.parse(localStorage.getItem(AUTH_USER_KEY) || "{}");
  } catch {
    return {};
  }
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
  localStorage.setItem(AUTH_USER_KEY, JSON.stringify(user));

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
  els.password.value = "";
  els.marketingConsent.checked = Boolean(user.marketingConsent);
}

async function loadProfile() {
  try {
    setMessage("계정 정보를 불러오는 중입니다...");
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

  if (!name) {
    setMessage("이름을 입력하세요.", true);
    return;
  }

  try {
    setMessage("저장 중입니다...");
    const data = await requestJson("/api/auth/profile", {
      method: "PUT",
      body: JSON.stringify({
        name,
        phone: els.phone.value.trim(),
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

els.form.addEventListener("submit", saveProfile);
loadProfile();
