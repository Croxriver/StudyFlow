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

const els = {
  list: document.querySelector("#paymentOrderList"),
  refresh: document.querySelector("#refreshPaymentOrders"),
  refundLatest: document.querySelector("#refundLatestPayment"),
  refundDialog: document.querySelector("#refundPreviewDialog"),
  refundItems: document.querySelector("#refundPreviewItems"),
  refundAmount: document.querySelector("#refundPreviewAmount"),
  refundCurrentEnd: document.querySelector("#refundPreviewCurrentEnd"),
  refundAfterEnd: document.querySelector("#refundPreviewAfterEnd"),
  confirmRefund: document.querySelector("#confirmRefundPayment"),
  toast: document.querySelector("#paymentToast")
};

let toastTimer = null;
let paymentOrders = [];
let refundPreview = null;
const toastHome = els.toast?.parentElement || document.body;

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
  const scopedToken = localStorage.getItem(tokenKey);
  const scopedUser = parseStoredUser(localStorage.getItem(userKey));
  if (scopedToken && scopedUser.role === role) return { token: scopedToken, user: scopedUser };

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
  window.location.href = "./login.html";
}

function setMessage(text, isError = false) {
  if (!els.toast) return;
  if (!text) {
    els.toast.textContent = "";
    els.toast.classList.remove("is-visible", "is-error");
    if (els.toast.parentElement !== toastHome) toastHome.appendChild(els.toast);
    return;
  }

  clearTimeout(toastTimer);
  const toastLayer = els.refundDialog?.open ? els.refundDialog : toastHome;
  if (els.toast.parentElement !== toastLayer) toastLayer.appendChild(els.toast);
  els.toast.textContent = text;
  els.toast.classList.toggle("is-error", isError);
  els.toast.classList.add("is-visible");
  toastTimer = setTimeout(() => {
    els.toast.classList.remove("is-visible");
    setTimeout(() => {
      if (!els.toast.classList.contains("is-visible") && els.toast.parentElement !== toastHome) {
        toastHome.appendChild(els.toast);
      }
    }, 200);
  }, isError ? 4000 : 2400);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function isJsonResponse(response) {
  return String(response.headers.get("content-type") || "").includes("application/json");
}

async function readJsonResponse(response) {
  if (!isJsonResponse(response)) throw new Error("StudyFlow API 응답이 아닙니다.");
  if (response.status === 401) {
    logout();
    throw new Error("로그인이 필요합니다.");
  }
  const data = await response.json();
  if (data?.error) throw new Error(data.message || "요청을 처리하지 못했습니다.");
  if (!response.ok) throw new Error(data.message || "요청을 처리하지 못했습니다.");
  return data;
}

async function requestTeacherJson(path) {
  const response = await fetch(path, {
    headers: { Authorization: `Bearer ${token}` }
  });
  return readJsonResponse(response);
}

function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10) || String(value);
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium"
  }).format(date);
}

function formatAmount(value) {
  return `${Number(value || 0).toLocaleString("ko-KR")}원`;
}

function getPaymentMethodText(method) {
  const value = String(method || "").trim().toUpperCase();
  if (value === "EPAY") return "간편결제";
  if (value === "CARD" || value === "카드" || value === "신용카드") return "카드 결제";
  if (value === "BANK" || value === "계좌이체") return "계좌이체";
  if (value === "VBANK" || value === "가상계좌") return "가상계좌";
  if (value === "MOBILE" || value === "휴대폰") return "휴대폰 결제";
  return method || "결제수단";
}

function getPaymentStatusText(status) {
  const value = String(status || "").toUpperCase();
  if (value === "DONE") return "결제 완료";
  if (value === "REFUNDED") return "환불 완료";
  if (value === "READY") return "결제 대기";
  if (value === "CANCELED" || value === "CANCELLED") return "결제 취소";
  if (value === "FAILED") return "결제 실패";
  return status || "-";
}

function hasRefundableOrders() {
  return paymentOrders.some((order) =>
    String(order.transactionType || "payment") === "payment"
    && String(order.status || "").toUpperCase() === "DONE"
    && Number(order.amount || 0) > Number(order.refundedAmount || 0)
  );
}

function syncRefundButton() {
  if (!els.refundLatest) return;
  els.refundLatest.disabled = false;
}

function renderPaymentOrders(orders) {
  if (!orders.length) {
    els.list.innerHTML = `<p class="empty-text">결제 내역이 없습니다.</p>`;
    syncRefundButton();
    return;
  }

  els.list.innerHTML = orders
    .map((order) => {
      const status = String(order.status || "").toUpperCase();
      const completedAt = order.completedAt || order.approvedAt || "";
      const receiptUrl = String(order.receiptUrl || "").trim();
      const refundedAmount = Number(order.refundedAmount || 0);
      const paymentLine =
        status === "REFUNDED"
          ? `환불 ${formatAmount(refundedAmount)}`
          : completedAt
            ? `완료 ${escapeHtml(formatDateTime(completedAt))}`
            : escapeHtml(order.orderId);

      return `
        <article class="payment-order-item ${status === "DONE" ? "is-done" : ""}">
          <div>
            <strong>${escapeHtml(order.orderName || order.planName || "결제 주문")}</strong>
            <p><span class="payment-method-chip">${escapeHtml(getPaymentMethodText(order.paymentMethod))}</span> · ${escapeHtml(formatDateTime(order.requestedAt))}</p>
          </div>
          <div class="payment-order-meta">
            <span class="payment-status ${status === "DONE" ? "is-done" : ""} ${status === "REFUNDED" ? "is-refunded" : ""}">${escapeHtml(getPaymentStatusText(order.status))}</span>
            <strong>${formatAmount(order.amount)}</strong>
            <small class="payment-completed-line">
              ${paymentLine}
              ${receiptUrl ? `<a class="payment-receipt-link" href="${escapeHtml(receiptUrl)}" target="_blank" rel="noopener">영수증 보기</a>` : ""}
            </small>
          </div>
        </article>
      `;
    })
    .join("");
  syncRefundButton();
}

async function loadPaymentOrders() {
  els.refresh.disabled = true;
  if (els.refundLatest) els.refundLatest.disabled = true;
  els.list.innerHTML = `<p class="empty-text">결제 현황을 불러오는 중입니다.</p>`;
  try {
    const data = await requestTeacherJson("/api/auth/payments/orders?limit=50");
    paymentOrders = Array.isArray(data.orders) ? data.orders : [];
    renderPaymentOrders(paymentOrders);
  } catch (error) {
    paymentOrders = [];
    els.list.innerHTML = `<p class="empty-text is-error">${escapeHtml(error.message || "결제 현황을 불러오지 못했습니다.")}</p>`;
    setMessage(error.message || "결제 현황을 불러오지 못했습니다.", true);
    syncRefundButton();
  } finally {
    els.refresh.disabled = false;
  }
}

function fillRefundPreviewDialog(preview) {
  const items = Array.isArray(preview.refund?.items) ? preview.refund.items : [];
  if (els.refundItems) {
    els.refundItems.innerHTML = items.length
      ? items.map((item) => `
          <article class="refund-preview-item">
            <span>${escapeHtml(item.orderName || item.planName || "이용권")}</span>
            <strong>${formatAmount(item.refundAmount)}</strong>
            <small>${escapeHtml(formatDate(item.refundServiceStartedAt))} ~ ${escapeHtml(formatDate(item.refundServiceEndsAt))}</small>
          </article>
        `).join("")
      : "";
  }
  els.refundAmount.textContent = formatAmount(preview.refund?.amount);
  els.refundCurrentEnd.textContent = formatDateTime(preview.refund?.currentServiceEndsAt);
  els.refundAfterEnd.textContent = formatDateTime(preview.refund?.afterRefundServiceEndsAt);
}

async function openRefundPreviewDialog() {
  if (!hasRefundableOrders()) {
    setMessage("환불할 거래가 없습니다.", true);
    return;
  }

  els.refundLatest.disabled = true;
  try {
    refundPreview = await requestTeacherJson("/api/auth/payments/refund-preview");
    fillRefundPreviewDialog(refundPreview);
    els.refundDialog.showModal();
  } catch (error) {
    refundPreview = null;
    setMessage(error.message || "환불 정보를 불러오지 못했습니다.", true);
  } finally {
    syncRefundButton();
  }
}

async function refundLatestPaymentOrder() {
  if (!refundPreview) return;

  els.confirmRefund.disabled = true;
  try {
    const response = await fetch("/api/auth/payments/refund", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ reason: "이용기간 환불" })
    });
    const data = await readJsonResponse(response);
    const refundedAmount = Number(data.refund?.amount || refundPreview?.refund?.amount || 0);
    els.refundDialog.close();
    refundPreview = null;
    setMessage(`${formatAmount(refundedAmount)}이 환불되었습니다.`);
    await loadPaymentOrders();
  } catch (error) {
    setMessage(error.message || "환불을 처리하지 못했습니다.", true);
  } finally {
    els.confirmRefund.disabled = false;
    syncRefundButton();
  }
}

els.refresh.addEventListener("click", loadPaymentOrders);
els.refundLatest?.addEventListener("click", openRefundPreviewDialog);
els.refundDialog?.addEventListener("close", () => {
  if (els.refundDialog.returnValue !== "confirm") refundPreview = null;
});
els.refundDialog?.addEventListener("submit", (event) => {
  if (event.submitter?.value !== "confirm") return;
  event.preventDefault();
  refundLatestPaymentOrder();
});

loadPaymentOrders();
