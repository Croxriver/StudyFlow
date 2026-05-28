const express = require("express");
const bcrypt = require("bcrypt");
const crypto = require("crypto");
const fs = require("fs");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const nodemailer = require("nodemailer");
const path = require("path");
const { getPool, sql } = require("../db");
const { requireAuth, requireTeacher } = require("../middleware/auth");

const router = express.Router();
const rootDir = path.join(__dirname, "..", "..");
const profileImageRoot = path.join(rootDir, "uploads", "profile-images");
const PHONE_CODE_TTL_MS = 5 * 60 * 1000;
const PHONE_TOKEN_TTL_MS = 10 * 60 * 1000;
const EMAIL_CODE_TTL_MS = 5 * 60 * 1000;
const EMAIL_TOKEN_TTL_MS = 10 * 60 * 1000;
const phoneVerificationCodes = new Map();
const phoneVerificationTokens = new Map();
const emailVerificationCodes = new Map();
const emailVerificationTokens = new Map();
let emailTransporter;

fs.mkdirSync(profileImageRoot, { recursive: true });

const profilePhotoUpload = multer({
  storage: multer.diskStorage({
    destination: (request, _file, callback) => {
      const userDir = path.join(profileImageRoot, safeProfilePathSegment(request.user?.sub || "unknown"));
      fs.mkdirSync(userDir, { recursive: true });
      callback(null, userDir);
    },
    filename: (_request, file, callback) => {
      const extension = getProfilePhotoExtension(file.mimetype);
      callback(null, `${Date.now()}-${crypto.randomUUID()}${extension}`);
    }
  }),
  limits: {
    fileSize: 5 * 1024 * 1024,
    files: 1
  },
  fileFilter: (_request, file, callback) => {
    if (!getProfilePhotoExtension(file.mimetype)) {
      callback(new Error("Only jpg, png, and webp image files can be uploaded."));
      return;
    }
    callback(null, true);
  }
});

function normalizePhone(phone) {
  return String(phone || "").replace(/\D/g, "");
}

function safeProfilePathSegment(value) {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .slice(0, 80) || "unknown";
}

function getProfilePhotoExtension(mimeType) {
  if (mimeType === "image/jpeg") return ".jpg";
  if (mimeType === "image/png") return ".png";
  if (mimeType === "image/webp") return ".webp";
  return "";
}

function getProfileImageUrl(profileImagePath) {
  const value = String(profileImagePath || "").trim().replaceAll("\\", "/");
  if (!value) return "";
  return `/api/uploads/profile-images/${value.split("/").map(encodeURIComponent).join("/")}`;
}

function getProfileImageRelativePath(file) {
  return path.relative(profileImageRoot, file.path).replaceAll(path.sep, "/");
}

function deleteProfileImage(profileImagePath) {
  const value = String(profileImagePath || "").trim();
  if (!value) return;
  const filePath = path.resolve(profileImageRoot, value);
  if (!filePath.startsWith(`${profileImageRoot}${path.sep}`)) return;
  fs.promises.unlink(filePath).catch(() => {});
}

function cleanupPhoneVerifications() {
	const now = Date.now();
	phoneVerificationCodes.forEach((value, key) => {
		if (value.expiresAt <= now) phoneVerificationCodes.delete(key);
	});
	phoneVerificationTokens.forEach((value, key) => {
		if (value.expiresAt <= now) phoneVerificationTokens.delete(key);
	});
	emailVerificationCodes.forEach((value, key) => {
		if (value.expiresAt <= now) emailVerificationCodes.delete(key);
	});
	emailVerificationTokens.forEach((value, key) => {
		if (value.expiresAt <= now) emailVerificationTokens.delete(key);
	});
}

function createVerificationCode() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, "0");
}

function shouldReturnDevVerificationCode() {
	return process.env.DEV_VERIFICATION_CODE_RESPONSE === "true";
}

function isVerificationBypassCode(code) {
	const bypassCode = String(process.env.VERIFICATION_BYPASS_CODE || "").trim();
	return Boolean(bypassCode) && String(code || "").trim() === bypassCode;
}

function getRequiredEnv(name) {
	const value = String(process.env[name] || "").trim();
	if (value) return value;
	const error = new Error(`Missing ${name}`);
	error.status = 500;
	error.publicMessage = "?대찓??諛쒖넚 ?ㅼ젙???꾩슂?⑸땲??";
	throw error;
}

function getEmailTransporter() {
	if (emailTransporter) return emailTransporter;

	emailTransporter = nodemailer.createTransport({
		host: getRequiredEnv("SMTP_HOST"),
		port: Number(process.env.SMTP_PORT || 587),
		secure: process.env.SMTP_SECURE === "true",
		auth: {
			user: getRequiredEnv("SMTP_USER"),
			pass: getRequiredEnv("SMTP_PASSWORD")
		}
	});

	return emailTransporter;
}

async function sendSignupEmailVerification({ email, code }) {
	const from = getRequiredEnv("SMTP_FROM");
	await getEmailTransporter().sendMail({
		from,
		to: email,
		subject: "StudyFlow ?뚯썝媛???대찓???몄쬆踰덊샇",
		text: `StudyFlow ?뚯썝媛???대찓???몄쬆踰덊샇??${code}?낅땲?? 5遺??대궡???낅젰??二쇱꽭??`,
		html: [
			"<div style=\"font-family:Arial,sans-serif;line-height:1.6;color:#111827\">",
			"<h2 style=\"margin:0 0 12px\">StudyFlow ?대찓???몄쬆</h2>",
			"<p>?뚯썝媛?낆쓣 怨꾩냽?섎젮硫??꾨옒 ?몄쬆踰덊샇瑜??낅젰??二쇱꽭??</p>",
			`<p style=\"font-size:28px;font-weight:700;letter-spacing:4px;margin:20px 0\">${code}</p>`,
			"<p style=\"color:#6b7280\">?몄쬆踰덊샇??5遺꾧컙 ?좏슚?⑸땲??</p>",
			"</div>"
		].join("")
	});
}

async function sendSmsAdmin(pool, { phoneNumber, messageText, msgMemo = "", userName = "" }) {
	const result = await pool.request()
		.input("phoneNumber", sql.VarChar(20), phoneNumber)
		.input("messageText", sql.VarChar(2000), messageText)
		.input("msgMemo", sql.VarChar(20), msgMemo)
		.input("userName", sql.VarChar(20), userName)
		.execute("dbo.app_send_sms_admin");

	const sendResult = Number(result.recordset?.[0]?.Result || 0);
	if (sendResult !== 1) {
		const error = new Error("SMS was not accepted by app_send_sms_admin.");
		error.status = sendResult === -1 ? 400 : 500;
		error.publicMessage = sendResult === -1
			? "臾몄옄瑜?諛쒖넚?????녿뒗 ?대???踰덊샇?낅땲??"
			: "?몄쬆踰덊샇 臾몄옄瑜?諛쒖넚?섏? 紐삵뻽?듬땲??";
		throw error;
	}
}

async function sendSignupPhoneVerificationSms(pool, { phone, code, name = "" }) {
	await sendSmsAdmin(pool, {
		phoneNumber: normalizePhone(phone),
		messageText: `<#> StudyFlow 회원가입 인증번호는 ${code}입니다.`,
		msgMemo: "회원가입인증",
		userName: String(name || "").trim().slice(0, 20)
	});
}

function isValidEmail(email) {
	return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || ""));
}

async function sendResetPhoneVerificationSms(pool, { phone, code, name = "" }) {
	await sendSmsAdmin(pool, {
		phoneNumber: normalizePhone(phone),
		messageText: `<#> StudyFlow 비밀번호 초기화 인증번호는 ${code}입니다.`,
		msgMemo: "비밀번호초기화",
		userName: String(name || "").trim().slice(0, 20)
	});
}

async function sendProfilePhoneVerificationSms(pool, { phone, code, name = "" }) {
	await sendSmsAdmin(pool, {
		phoneNumber: normalizePhone(phone),
		messageText: `<#> StudyFlow 휴대폰 번호 변경 인증번호는 ${code}입니다.`,
		msgMemo: "휴대폰변경",
		userName: String(name || "").trim().slice(0, 20)
	});
}

async function sendResetEmailVerification({ email, code }) {
	const from = getRequiredEnv("SMTP_FROM");
	await getEmailTransporter().sendMail({
		from,
		to: email,
		subject: "StudyFlow 鍮꾨?踰덊샇 珥덇린???몄쬆踰덊샇",
		text: `StudyFlow 鍮꾨?踰덊샇 珥덇린???몄쬆踰덊샇??${code}?낅땲?? 5遺??대궡???낅젰??二쇱꽭??`,
		html: [
			"<div style=\"font-family:Arial,sans-serif;line-height:1.6;color:#111827\">",
			"<h2 style=\"margin:0 0 12px\">StudyFlow 鍮꾨?踰덊샇 珥덇린??/h2>",
			"<p>鍮꾨?踰덊샇瑜?珥덇린?뷀븯?ㅻ㈃ ?꾨옒 ?몄쬆踰덊샇瑜??낅젰??二쇱꽭??</p>",
			`<p style=\"font-size:28px;font-weight:700;letter-spacing:4px;margin:20px 0\">${code}</p>`,
			"<p style=\"color:#6b7280\">?몄쬆踰덊샇??5遺꾧컙 ?좏슚?⑸땲??</p>",
			"</div>"
		].join("")
	});
}

function isSamePhone(left, right) {
	return normalizePhone(left) === normalizePhone(right);
}

async function getResetUser(pool, { email, name }) {
	const result = await pool.request()
		.input("email", sql.NVarChar(255), email)
		.execute("dbo.app_get_user_by_email");
	const user = result.recordset[0];
	if (!user || String(user.name || "").trim() !== String(name || "").trim()) return null;
	return user;
}

function createToken(user) {
  const secret = process.env.JWT_SECRET || "development-secret";

  return jwt.sign(
    {
      sub: user.id,
      email: user.email,
      name: user.name,
      role: "teacher"
    },
    secret,
    { expiresIn: "7d" }
  );
}

function createStudentToken(student) {
  const secret = process.env.JWT_SECRET || "development-secret";

  return jwt.sign(
    {
      sub: student.id,
      role: "student",
      childId: student.id,
      childName: student.name,
      teacherUserId: student.teacherUserId,
      loginId: student.loginId
    },
    secret,
    { expiresIn: "7d" }
  );
}

function serializeTeacherUser(user) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    phone: user.phone,
    marketingConsent: Boolean(user.marketingConsent),
    plan: {
      code: user.planCode || "basic",
      name: user.planName || "",
      monthlyPrice: Number(user.monthlyPrice || 0),
      studentLimit: Number(user.studentLimit || 0),
      gradientFrom: user.gradientFrom || "",
      gradientTo: user.gradientTo || ""
    },
    servicePeriod: {
      startedAt: user.serviceStartedAt ? new Date(user.serviceStartedAt).toISOString() : "",
      endsAt: user.serviceEndsAt ? new Date(user.serviceEndsAt).toISOString() : ""
    },
    profileImageUrl: getProfileImageUrl(user.profileImagePath),
    teacherComment: user.teacherComment || "",
    role: "teacher"
  };
}

function serializePlan(plan) {
  return {
    code: plan.planCode,
    name: plan.planName,
    monthlyPrice: Number(plan.monthlyPrice || 0),
    studentLimit: Number(plan.studentLimit || 0),
    gradientFrom: plan.gradientFrom || "",
    gradientTo: plan.gradientTo || "",
    sortOrder: Number(plan.sortOrder || 0),
    terms: Array.isArray(plan.terms) ? plan.terms : []
  };
}

function serializePlanTerm(term) {
  return {
    planCode: term.planCode || "",
    months: Number(term.termMonths || term.months || 0),
    discountRate: Number(term.discountRate || 0),
    sortOrder: Number(term.sortOrder || 0)
  };
}

function serializePaymentOrder(order) {
  return {
    transactionType: order.transactionType || "payment",
    orderId: order.orderId,
    provider: order.paymentProvider || "",
    planCode: order.planCode || "",
    planName: order.planName || "",
    orderName: order.orderName || "",
    amount: Number(order.amount || 0),
    termMonths: Number(order.termMonths || 1),
    baseAmount: Number(order.baseAmount || 0),
    discountRate: Number(order.discountRate || 0),
    discountAmount: Number(order.discountAmount || 0),
    status: order.status || "",
    paymentMethod: order.paymentMethod || "",
    receiptUrl: order.receiptUrl || "",
    refundedAmount: Number(order.refundedAmount || 0),
    refundedAt: order.refundedAt ? new Date(order.refundedAt).toISOString() : "",
    requestedAt: order.requestedAt ? new Date(order.requestedAt).toISOString() : "",
    approvedAt: order.approvedAt ? new Date(order.approvedAt).toISOString() : "",
    completedAt: order.completedAt ? new Date(order.completedAt).toISOString() : ""
  };
}

function getTossClientKey() {
  return String(process.env.TOSS_PAYMENTS_CLIENT_KEY || "").trim();
}

function getTossSecretKey() {
  return String(process.env.TOSS_PAYMENTS_SECRET_KEY || "").trim();
}

function getPaymentProvider() {
  const provider = String(process.env.PAYMENT_PROVIDER || "toss").trim().toLowerCase();
  return provider === "innopay" ? "innopay" : "toss";
}

function getInnopayMid() {
  return String(process.env.INNOPAY_MID || "").trim();
}

function getInnopayMerchantKey() {
  return String(process.env.INNOPAY_MERCHANT_KEY || "").trim();
}

function getInnopayPayMethod() {
  return String(process.env.INNOPAY_PAY_METHOD || "CARD").trim() || "CARD";
}

function getInnopayCancelUrl() {
  const configuredUrl = String(process.env.INNOPAY_CANCEL_URL || "").trim();
  if (configuredUrl && !configuredUrl.endsWith("/v1/transactions/cancel")) return configuredUrl;
  return "https://api.innopay.co.kr/api/cancelApi";
}

function getInnopayCancelPassword() {
  return String(process.env.INNOPAY_CANCEL_PASSWORD || "").trim();
}

function getInnopayCancelServiceCode(paymentMethod) {
  const method = String(paymentMethod || "").trim().toUpperCase();
  if (method === "EPAY") return "16";
  if (method === "EBANK") return "12";
  if (method === "BANK") return "02";
  if (method === "VBANK") return "03";
  if (method === "MOBILE") return "07";
  return "01";
}

function requireTossSecretKey() {
  const secretKey = getTossSecretKey();
  if (secretKey) return secretKey;
  const error = new Error("Missing Toss Payments secret key");
  error.status = 500;
  error.publicMessage = "?좎뒪?섏씠癒쇱툩 Secret Key ?ㅼ젙???꾩슂?⑸땲??";
  throw error;
}

function createTossOrderId() {
  return `sf_${Date.now()}_${crypto.randomBytes(8).toString("hex")}`;
}

function toTossApprovedDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

async function confirmTossPayment({ paymentKey, orderId, amount }) {
  const secretKey = requireTossSecretKey();
  const response = await fetch("https://api.tosspayments.com/v1/payments/confirm", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${secretKey}:`).toString("base64")}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ paymentKey, orderId, amount })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.message || "Toss Payments confirm failed.");
    error.status = response.status;
    error.publicMessage = data.message || "寃곗젣 ?뱀씤???ㅽ뙣?덉뒿?덈떎.";
    throw error;
  }
  return data;
}

async function cancelTossPayment({ paymentKey, cancelAmount, cancelReason }) {
  const secretKey = requireTossSecretKey();
  const response = await fetch(`https://api.tosspayments.com/v1/payments/${encodeURIComponent(paymentKey)}/cancel`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${secretKey}:`).toString("base64")}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ cancelReason, cancelAmount })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.message || "Toss Payments cancel failed.");
    error.status = response.status;
    error.publicMessage = data.message || "결제를 환불하지 못했습니다.";
    throw error;
  }
  return data;
}

async function confirmInnopayPayment({ paymentToken, tid, mid, amount, taxFreeAmt, moid }) {
  const merchantKey = getInnopayMerchantKey();
  if (!merchantKey) {
    const error = new Error("Missing InnoPay merchant key");
    error.status = 500;
    error.publicMessage = "?대끂?섏씠 Merchant Key ?ㅼ젙???꾩슂?⑸땲??";
    throw error;
  }

  const response = await fetch("https://api.innopay.co.kr/v1/transactions/pay", {
    method: "POST",
    headers: {
      "Payment-Token": paymentToken,
      "Merchant-Key": merchantKey,
      "Content-Type": "application/json; charset=utf-8"
    },
    body: JSON.stringify({
      tid,
      mid,
      amt: amount,
      taxFreeAmt: taxFreeAmt || 0,
      moid
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.success) {
    const error = new Error(data.msg || data.message || "InnoPay confirm failed.");
    error.status = response.status || 500;
    error.publicMessage = data.msg || data.message || "?대끂?섏씠 寃곗젣 ?뱀씤???ㅽ뙣?덉뒿?덈떎.";
    throw error;
  }
  return data;
}

function parseInnopayCancelResponse(text) {
  try {
    return JSON.parse(text);
  } catch {
    const params = new URLSearchParams(text);
    return Object.fromEntries(params.entries());
  }
}

async function requestInnopayCancel(payload) {
  const response = await fetch(getInnopayCancelUrl(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8"
    },
    body: JSON.stringify(payload)
  });
  const text = await response.text();
  const data = parseInnopayCancelResponse(text);
  const resultCode = String(data.resultCode || data.code || "").trim();
  const resultMessage = String(data.resultMsg || data.message || data.msg || "").trim();
  const isSuccess = response.ok
    && (resultCode === "2001" || resultCode === "2211" || data.success === true);

  return {
    data,
    httpStatus: response.status,
    isSuccess,
    resultCode,
    resultMessage
  };
}

async function cancelInnopayPayment({ tid, amount, reason, paymentMethod, isPartialCancel }) {
  const cancelPassword = getInnopayCancelPassword();
  if (!cancelPassword) {
    const error = new Error("Missing InnoPay cancel password");
    error.status = 500;
    error.publicMessage = "이노페이 취소 비밀번호 설정을 확인하세요.";
    throw error;
  }

  const basePayload = {
    mid: getInnopayMid(),
    tid,
    partialCancelCode: isPartialCancel ? "1" : "0",
    cancelAmt: String(amount),
    cancelMsg: reason,
    cancelPwd: cancelPassword
  };

  const primarySvcCd = getInnopayCancelServiceCode(paymentMethod);
  const svcCodes = String(paymentMethod || "").trim().toUpperCase() === "EPAY"
    ? ["01", primarySvcCd].filter((value, index, array) => array.indexOf(value) === index)
    : [primarySvcCd];

  let lastResult = null;
  const attempts = [];
  for (const svcCd of svcCodes) {
    lastResult = await requestInnopayCancel({ ...basePayload, svcCd });
    attempts.push({
      svcCd,
      resultCode: lastResult.resultCode,
      resultMessage: lastResult.resultMessage
    });
    if (lastResult.isSuccess) return lastResult.data;
  }

  {
    const error = new Error(lastResult?.resultMessage || "InnoPay cancel failed.");
    error.status = lastResult?.httpStatus && lastResult.httpStatus >= 400 ? lastResult.httpStatus : 502;
    error.publicMessage = lastResult?.resultMessage || "결제를 환불하지 못했습니다.";
    error.innopayCancelAttempts = attempts;
    throw error;
  }
}

function calculateRefundAmount(refundable) {
  const amount = Math.floor(Number(refundable.amount || 0));
  const refundedAmount = Math.floor(Number(refundable.refundedAmount || 0));
  const remainingPaidAmount = Math.max(0, amount - refundedAmount);
  const sqlRefundAmount = Math.floor(Number(refundable.refundAmount || 0));
  const serviceStartedAt = new Date(refundable.serviceStartedAt || refundable.approvedAt || refundable.completedAt || "");
  const serviceEndsAt = new Date(refundable.serviceEndsAt || "");
  const now = new Date();

  if (remainingPaidAmount <= 0) return 0;
  if (
    Number.isNaN(serviceStartedAt.getTime())
    || Number.isNaN(serviceEndsAt.getTime())
    || now >= serviceEndsAt
    || serviceStartedAt >= serviceEndsAt
  ) {
    return Math.min(remainingPaidAmount, Math.max(0, sqlRefundAmount));
  }

  const toKoreaDate = (date) => {
    const koreaTime = date.getTime() + (9 * 60 * 60 * 1000);
    return Math.floor(koreaTime / (24 * 60 * 60 * 1000));
  };
  const totalDays = toKoreaDate(serviceEndsAt) - toKoreaDate(serviceStartedAt);
  const remainingDays = toKoreaDate(serviceEndsAt) - toKoreaDate(now);
  if (totalDays <= 0 || remainingDays <= 0) return Math.min(remainingPaidAmount, Math.max(0, sqlRefundAmount));
  const clampedRemainingDays = Math.min(totalDays, remainingDays);
  const jsRefundAmount = Math.floor((remainingPaidAmount * clampedRemainingDays) / totalDays);
  return Math.min(remainingPaidAmount, Math.max(0, sqlRefundAmount, jsRefundAmount));
}

function serializeRefundPreview(refundable, refundAmount) {
  return {
    order: {
      orderId: refundable.orderId || "",
      provider: refundable.paymentProvider || "",
      amount: Number(refundable.amount || 0),
      refundedAmount: Number(refundable.refundedAmount || 0)
    },
    refund: {
      amount: refundAmount,
      serviceStartedAt: refundable.serviceStartedAt ? new Date(refundable.serviceStartedAt).toISOString() : "",
      currentServiceEndsAt: refundable.serviceEndsAt ? new Date(refundable.serviceEndsAt).toISOString() : "",
      afterRefundServiceEndsAt: new Date().toISOString()
    }
  };
}

function toKoreaDay(date) {
  return Math.floor((date.getTime() + (9 * 60 * 60 * 1000)) / (24 * 60 * 60 * 1000));
}

function calculateWindowRefundAmount(order, refundStartedAt, refundEndsAt, options = {}) {
  const amount = Math.floor(Number(order.amount || 0));
  const refundedAmount = Math.floor(Number(order.refundedAmount || 0));
  const remainingPaidAmount = Math.max(0, amount - refundedAmount);
  const orderStartedAt = new Date(order.serviceStartedAt || order.approvedAt || order.completedAt || "");
  const orderEndsAt = new Date(order.serviceEndsAt || "");
  const now = new Date();
  const anchorToNow = options.anchorToNow !== false;

  if (remainingPaidAmount <= 0) return 0;
  if (
    Number.isNaN(orderStartedAt.getTime())
    || Number.isNaN(orderEndsAt.getTime())
    || Number.isNaN(refundStartedAt.getTime())
    || Number.isNaN(refundEndsAt.getTime())
    || refundStartedAt >= refundEndsAt
    || now >= refundEndsAt
  ) {
    return 0;
  }

  const totalDays = toKoreaDay(orderEndsAt) - toKoreaDay(orderStartedAt);
  const refundBaseAt = anchorToNow && now > refundStartedAt ? now : refundStartedAt;
  const refundableDays = toKoreaDay(refundEndsAt) - toKoreaDay(refundBaseAt);
  if (totalDays <= 0 || refundableDays <= 0) return 0;
  if (refundableDays >= totalDays) return remainingPaidAmount;
  return Math.min(remainingPaidAmount, Math.floor((remainingPaidAmount * refundableDays) / totalDays));
}

async function getSequentialRefundPreview(pool, userId) {
  const result = await pool.request()
    .input("user_id", sql.UniqueIdentifier, userId)
    .query(`
      SELECT
        po.id AS paymentOrderId,
        po.payment_provider AS paymentProvider,
        po.order_id AS orderId,
        po.payment_key AS paymentKey,
        po.payment_method AS paymentMethod,
        po.plan_code AS planCode,
        sp.plan_name AS planName,
        po.order_name AS orderName,
        po.amount,
        COALESCE(refunds.refundedAmount, 0) AS refundedAmount,
        COALESCE(po.service_started_at, po.approved_at, po.completed_at) AS serviceStartedAt,
        COALESCE(po.service_ends_at, DATEADD(MONTH, ISNULL(NULLIF(po.term_months, 0), 1), COALESCE(po.approved_at, po.completed_at))) AS serviceEndsAt,
        po.service_revoked_at AS serviceRevokedAt,
        u.service_ends_at AS currentServiceEndsAt
      FROM dbo.payment_orders po
      INNER JOIN dbo.users u ON u.id = po.user_id
      LEFT JOIN dbo.subscription_plans sp ON sp.plan_code = po.plan_code
      OUTER APPLY (
        SELECT SUM(pr.refund_amount) AS refundedAmount
        FROM dbo.payment_refunds pr
        WHERE pr.payment_order_id = po.id AND pr.status = N'DONE'
      ) refunds
      WHERE po.user_id = @user_id
        AND po.status = N'DONE'
        AND po.payment_key IS NOT NULL
        AND po.payment_key <> N''
        AND COALESCE(po.service_started_at, po.approved_at, po.completed_at) IS NOT NULL
        AND COALESCE(po.service_ends_at, DATEADD(MONTH, ISNULL(NULLIF(po.term_months, 0), 1), COALESCE(po.approved_at, po.completed_at))) IS NOT NULL
        AND po.amount - COALESCE(refunds.refundedAmount, 0) > 0
        AND (
          (
            po.service_revoked_at IS NULL
            AND u.service_ends_at IS NOT NULL
            AND u.service_ends_at > SYSUTCDATETIME()
            AND COALESCE(po.service_ends_at, DATEADD(MONTH, ISNULL(NULLIF(po.term_months, 0), 1), COALESCE(po.approved_at, po.completed_at))) <= DATEADD(SECOND, 60, u.service_ends_at)
          )
          OR (
            po.service_revoked_at IS NOT NULL
            AND po.service_revoked_at < COALESCE(po.service_ends_at, DATEADD(MONTH, ISNULL(NULLIF(po.term_months, 0), 1), COALESCE(po.approved_at, po.completed_at)))
          )
        )
      ORDER BY
        CASE WHEN po.service_revoked_at IS NULL THEN 0 ELSE 1 END,
        COALESCE(po.service_ends_at, DATEADD(MONTH, ISNULL(NULLIF(po.term_months, 0), 1), COALESCE(po.approved_at, po.completed_at))) DESC,
        po.completed_at DESC,
        po.id DESC
    `);

  const orders = result.recordset || [];
  if (!orders.length) {
    return { items: [], amount: 0, currentServiceEndsAt: "", afterRefundServiceEndsAt: "" };
  }

  const currentServiceEndsAt = orders.find((order) => order.currentServiceEndsAt)?.currentServiceEndsAt
    ? new Date(orders.find((order) => order.currentServiceEndsAt).currentServiceEndsAt)
    : null;
  const items = [];
  const activeOrders = orders.filter((order) => !order.serviceRevokedAt);
  const revokedOrders = orders.filter((order) => order.serviceRevokedAt);
  let refundedCurrentPeriod = false;

  if (currentServiceEndsAt && !Number.isNaN(currentServiceEndsAt.getTime())) {
    let cursorEnd = currentServiceEndsAt;
    for (const order of activeOrders) {
      const orderStartedAt = new Date(order.serviceStartedAt || "");
      const orderEndsAt = new Date(order.serviceEndsAt || "");
      if (Number.isNaN(orderStartedAt.getTime()) || Number.isNaN(orderEndsAt.getTime())) continue;
      if (cursorEnd <= orderStartedAt) continue;

      const refundEndsAt = cursorEnd < orderEndsAt ? cursorEnd : orderEndsAt;
      const refundStartedAt = orderStartedAt;
      const refundAmount = calculateWindowRefundAmount(order, refundStartedAt, refundEndsAt);
      cursorEnd = orderStartedAt;

      if (refundAmount <= 0) continue;
      refundedCurrentPeriod = true;
      items.push({
        paymentOrderId: order.paymentOrderId,
        orderId: order.orderId,
        provider: order.paymentProvider || "",
        paymentKey: order.paymentKey || "",
        paymentMethod: order.paymentMethod || "",
        planCode: order.planCode || "",
        planName: order.planName || "",
        orderName: order.orderName || "",
        amount: Number(order.amount || 0),
        refundedAmount: Number(order.refundedAmount || 0),
        refundAmount,
        refundServiceStartedAt: refundStartedAt.toISOString(),
        refundServiceEndsAt: refundEndsAt.toISOString()
      });
    }
  }

  for (const order of revokedOrders) {
    const orderStartedAt = new Date(order.serviceStartedAt || "");
    const orderEndsAt = new Date(order.serviceEndsAt || "");
    const serviceRevokedAt = new Date(order.serviceRevokedAt || "");
    if (
      Number.isNaN(orderStartedAt.getTime())
      || Number.isNaN(orderEndsAt.getTime())
      || Number.isNaN(serviceRevokedAt.getTime())
      || serviceRevokedAt >= orderEndsAt
    ) {
      continue;
    }

    const refundStartedAt = serviceRevokedAt > orderStartedAt ? serviceRevokedAt : orderStartedAt;
    const refundEndsAt = orderEndsAt;
    const refundAmount = calculateWindowRefundAmount(order, refundStartedAt, refundEndsAt, { anchorToNow: false });

    if (refundAmount <= 0) continue;
    items.push({
      paymentOrderId: order.paymentOrderId,
      orderId: order.orderId,
      provider: order.paymentProvider || "",
      paymentKey: order.paymentKey || "",
      paymentMethod: order.paymentMethod || "",
      planCode: order.planCode || "",
      planName: order.planName || "",
      orderName: order.orderName || "",
      amount: Number(order.amount || 0),
      refundedAmount: Number(order.refundedAmount || 0),
      refundAmount,
      refundServiceStartedAt: refundStartedAt.toISOString(),
      refundServiceEndsAt: refundEndsAt.toISOString()
    });
  }

  return {
    items,
    amount: items.reduce((sum, item) => sum + item.refundAmount, 0),
    currentServiceEndsAt: currentServiceEndsAt && !Number.isNaN(currentServiceEndsAt.getTime()) ? currentServiceEndsAt.toISOString() : "",
    afterRefundServiceEndsAt: refundedCurrentPeriod ? new Date().toISOString() : currentServiceEndsAt && !Number.isNaN(currentServiceEndsAt.getTime()) ? currentServiceEndsAt.toISOString() : ""
  };
}

function getClientIp(request) {
  const forwardedFor = String(request.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return forwardedFor || request.ip || request.socket?.remoteAddress || "";
}

function getAccessLogUserAgent(request) {
  const client = String(request.headers["x-studyflow-client"] || "").trim();
  if (client === "mobile-app") {
    const platform = String(request.headers["x-studyflow-platform"] || "").trim();
    return platform ? `StudyFlow Mobile App (${platform})` : "StudyFlow Mobile App";
  }
  return String(request.headers["user-agent"] || "");
}

async function recordAccessLog(pool, request, { userId = null, childId = null, role, loginId = "" }) {
  try {
    await pool.request()
      .input("user_id", sql.UniqueIdentifier, userId)
      .input("child_id", sql.UniqueIdentifier, childId)
      .input("role", sql.NVarChar(20), role)
      .input("login_id", sql.NVarChar(255), String(loginId || "").trim())
      .input("ip_address", sql.NVarChar(64), getClientIp(request).slice(0, 64))
      .input("user_agent", sql.NVarChar(500), getAccessLogUserAgent(request).slice(0, 500))
      .execute("dbo.app_create_access_log");
  } catch (error) {
    console.error("Failed to record access log", error);
  }
}

router.post("/signup", async (request, response, next) => {
  try {
		const { email, password, name, phone = "", phoneVerificationToken = "", emailVerificationToken = "", marketingConsent = false } = request.body || {};
		const normalizedEmail = String(email || "").trim().toLowerCase();
		const normalizedPhone = normalizePhone(phone);

    if (!normalizedEmail || !password || !name || !normalizedPhone) {
      return response.status(400).json({
        error: "invalid_signup_request",
        message: "?대찓?? 鍮꾨?踰덊샇, ?대쫫, ?대????몄쬆 ?뺣낫媛 ?꾩슂?⑸땲??"
      });
    }

    cleanupPhoneVerifications();
    const verifiedPhone = phoneVerificationTokens.get(String(phoneVerificationToken || ""));
		if (!verifiedPhone || verifiedPhone.phone !== normalizedPhone) {
			return response.status(400).json({
				error: "phone_verification_required",
				message: "?대????몄쬆??癒쇱? ?꾨즺?섏꽭??"
			});
		}
		const verifiedEmail = emailVerificationTokens.get(String(emailVerificationToken || ""));
		if (!verifiedEmail || verifiedEmail.email !== normalizedEmail) {
			return response.status(400).json({
				error: "email_verification_required",
				message: "?대찓???몄쬆??癒쇱? ?꾨즺?섏꽭??"
			});
		}

    const pool = await getPool();
    const existing = await pool.request()
      .input("email", sql.NVarChar(255), normalizedEmail)
      .execute("dbo.app_get_user_by_email");

    if (existing.recordset.length) {
      return response.status(409).json({
        error: "email_already_exists",
        message: "?대? 媛?낅맂 ?대찓?쇱엯?덈떎."
      });
    }

    const passwordHash = await bcrypt.hash(String(password), 12);
    const created = await pool.request()
      .input("email", sql.NVarChar(255), normalizedEmail)
      .input("password_hash", sql.NVarChar(255), passwordHash)
      .input("name", sql.NVarChar(100), String(name).trim())
      .input("phone", sql.NVarChar(30), normalizedPhone)
      .input("marketing_consent", sql.Bit, Boolean(marketingConsent))
      .execute("dbo.app_create_user");

		const user = created.recordset[0];
		phoneVerificationTokens.delete(String(phoneVerificationToken || ""));
		emailVerificationTokens.delete(String(emailVerificationToken || ""));

    response.status(201).json({
      token: createToken(user),
      user: serializeTeacherUser(user)
    });
  } catch (error) {
    next(error);
  }
});

router.post("/signup/phone-code", async (request, response, next) => {
  const phone = normalizePhone(request.body?.phone);
	const name = String(request.body?.name || "").trim();

  if (!/^01\d{8,9}$/.test(phone)) {
    return response.status(400).json({
      error: "invalid_phone",
      message: "?대???踰덊샇瑜??뺥솗???낅젰?섏꽭??"
    });
  }

  cleanupPhoneVerifications();
  const code = createVerificationCode();
  phoneVerificationCodes.set(phone, {
    code,
    expiresAt: Date.now() + PHONE_CODE_TTL_MS
  });

	try {
		const pool = await getPool();
		await sendSignupPhoneVerificationSms(pool, { phone, code, name });

		response.json({
			ok: true,
			expiresInSeconds: Math.floor(PHONE_CODE_TTL_MS / 1000),
			...(shouldReturnDevVerificationCode() ? { verificationCode: code } : {})
		});
	} catch (error) {
		phoneVerificationCodes.delete(phone);
		console.error("Failed to send signup verification SMS", {
			phone,
			name,
			message: error?.message,
			number: error?.number,
			procedure: error?.procedure,
			lineNumber: error?.lineNumber
		});
		if (!error.publicMessage) {
			error.publicMessage = `?몄쬆踰덊샇 臾몄옄瑜?諛쒖넚?섏? 紐삵뻽?듬땲?? ${error?.message || ""}`.trim();
			error.status = 500;
		}
		next(error);
	}
});

router.post("/signup/verify-phone", async (request, response) => {
  const phone = normalizePhone(request.body?.phone);
  const code = String(request.body?.code || "").trim();

  cleanupPhoneVerifications();
  const verification = phoneVerificationCodes.get(phone);
  if (!isVerificationBypassCode(code) && (!verification || verification.code !== code)) {
    return response.status(400).json({
      error: "invalid_phone_code",
      message: "?몄쬆踰덊샇媛 ?щ컮瑜댁? ?딄굅??留뚮즺?섏뿀?듬땲??"
    });
  }

  phoneVerificationCodes.delete(phone);
  const token = crypto.randomBytes(32).toString("hex");
  phoneVerificationTokens.set(token, {
    phone,
    expiresAt: Date.now() + PHONE_TOKEN_TTL_MS
  });

  response.json({
    ok: true,
    phoneVerificationToken: token,
    expiresInSeconds: Math.floor(PHONE_TOKEN_TTL_MS / 1000)
  });
});

router.post("/signup/email-code", async (request, response, next) => {
	try {
		const email = String(request.body?.email || "").trim().toLowerCase();

		if (!isValidEmail(email)) {
			return response.status(400).json({
				error: "invalid_email",
				message: "?대찓??二쇱냼瑜??뺥솗???낅젰?섏꽭??"
			});
		}

		const pool = await getPool();
		const existing = await pool.request()
			.input("email", sql.NVarChar(255), email)
			.execute("dbo.app_get_user_by_email");

		if (existing.recordset.length) {
			return response.status(409).json({
				error: "email_already_exists",
				message: "?대? 媛?낅맂 ?대찓?쇱엯?덈떎."
			});
		}

		cleanupPhoneVerifications();
		const code = createVerificationCode();
		emailVerificationCodes.set(email, {
			code,
			expiresAt: Date.now() + EMAIL_CODE_TTL_MS
		});

		try {
			await sendSignupEmailVerification({ email, code });
		} catch (error) {
			emailVerificationCodes.delete(email);
			console.error("Failed to send signup verification email", {
				email,
				message: error?.message,
				code: error?.code,
				command: error?.command,
				responseCode: error?.responseCode
			});
			if (!error.publicMessage) {
				error.publicMessage = "?대찓???몄쬆踰덊샇瑜?諛쒖넚?섏? 紐삵뻽?듬땲??";
				error.status = 500;
			}
			throw error;
		}

		response.json({
			ok: true,
			expiresInSeconds: Math.floor(EMAIL_CODE_TTL_MS / 1000),
			...(shouldReturnDevVerificationCode() ? { verificationCode: code } : {})
		});
	} catch (error) {
		next(error);
	}
});

router.post("/signup/verify-email", async (request, response) => {
	const email = String(request.body?.email || "").trim().toLowerCase();
	const code = String(request.body?.code || "").trim();

	cleanupPhoneVerifications();
	const verification = emailVerificationCodes.get(email);
	if (!isVerificationBypassCode(code) && (!verification || verification.code !== code)) {
		return response.status(400).json({
			error: "invalid_email_code",
			message: "?대찓???몄쬆踰덊샇媛 ?щ컮瑜댁? ?딄굅??留뚮즺?섏뿀?듬땲??"
		});
	}

	emailVerificationCodes.delete(email);
	const token = crypto.randomBytes(32).toString("hex");
	emailVerificationTokens.set(token, {
		email,
		expiresAt: Date.now() + EMAIL_TOKEN_TTL_MS
	});

	response.json({
		ok: true,
		emailVerificationToken: token,
		expiresInSeconds: Math.floor(EMAIL_TOKEN_TTL_MS / 1000)
	});
});

router.post("/login", async (request, response, next) => {
  try {
    const { email, password } = request.body || {};
    const normalizedEmail = String(email || "").trim().toLowerCase();
    const pool = await getPool();
    const result = await pool.request()
      .input("email", sql.NVarChar(255), normalizedEmail)
      .execute("dbo.app_get_user_by_email");
    const user = result.recordset[0];

    if (!user || !(await bcrypt.compare(String(password || ""), user.passwordHash))) {
      return response.status(401).json({
        error: "invalid_credentials",
        message: "Email or password is incorrect."
      });
    }

    await recordAccessLog(pool, request, {
      userId: user.id,
      role: "teacher",
      loginId: user.email
    });

    response.json({
      token: createToken(user),
      user: serializeTeacherUser(user)
    });
  } catch (error) {
    next(error);
  }
});

router.post("/student-login", async (request, response, next) => {
  try {
    const { loginId, password } = request.body || {};
    const normalizedLoginId = String(loginId || "").trim();
    const pool = await getPool();
    const result = await pool.request()
      .input("login_id", sql.NVarChar(100), normalizedLoginId)
      .execute("dbo.app_get_child_by_login_id");
    const student = result.recordset[0];

    if (!student || !(await bcrypt.compare(String(password || ""), student.passwordHash || ""))) {
      return response.status(401).json({
        error: "invalid_credentials",
        message: "Student ID or password is incorrect."
      });
    }

    await recordAccessLog(pool, request, {
      userId: student.teacherUserId,
      childId: student.id,
      role: "student",
      loginId: student.loginId
    });

    response.json({
      token: createStudentToken(student),
      user: {
        id: student.id,
        role: "student",
        name: student.name,
        loginId: student.loginId,
        teacherUserId: student.teacherUserId,
        teacherName: student.teacherName
      }
    });
  } catch (error) {
    next(error);
  }
});

router.post("/access-log", requireAuth, async (request, response, next) => {
  try {
    const pool = await getPool();
    const user = request.user || {};

    if (user.role === "student") {
      await recordAccessLog(pool, request, {
        userId: user.teacherUserId,
        childId: user.childId || user.sub,
        role: "student",
        loginId: user.loginId
      });
    } else {
      await recordAccessLog(pool, request, {
        userId: user.sub,
        role: "teacher",
        loginId: user.email
      });
    }

    response.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

router.post("/reset-password/phone-code", async (request, response, next) => {
	try {
		const email = String(request.body?.email || "").trim().toLowerCase();
		const name = String(request.body?.name || "").trim();
		const phone = normalizePhone(request.body?.phone);

		if (!isValidEmail(email) || !name || !/^01\d{8,9}$/.test(phone)) {
			return response.status(400).json({
				error: "invalid_reset_request",
				message: "媛???대찓?? ?대쫫, ?대???踰덊샇瑜??뺥솗???낅젰?섏꽭??"
			});
		}

		const pool = await getPool();
		const user = await getResetUser(pool, { email, name });
		if (!user || !isSamePhone(user.phone, phone)) {
			return response.status(404).json({
				error: "reset_verification_failed",
				message: "媛???뺣낫媛 ?쇱튂?섏? ?딆뒿?덈떎."
			});
		}

		cleanupPhoneVerifications();
		const code = createVerificationCode();
		phoneVerificationCodes.set(phone, {
			code,
			expiresAt: Date.now() + PHONE_CODE_TTL_MS
		});

		try {
			await sendResetPhoneVerificationSms(pool, { phone, code, name });
		} catch (error) {
			phoneVerificationCodes.delete(phone);
			throw error;
		}

		response.json({
			ok: true,
			expiresInSeconds: Math.floor(PHONE_CODE_TTL_MS / 1000),
			...(shouldReturnDevVerificationCode() ? { verificationCode: code } : {})
		});
	} catch (error) {
		next(error);
	}
});

router.post("/reset-password/email-code", async (request, response, next) => {
	try {
		const email = String(request.body?.email || "").trim().toLowerCase();
		const name = String(request.body?.name || "").trim();

		if (!isValidEmail(email) || !name) {
			return response.status(400).json({
				error: "invalid_reset_request",
				message: "媛???대찓?쇨낵 ?대쫫???뺥솗???낅젰?섏꽭??"
			});
		}

		const pool = await getPool();
		const user = await getResetUser(pool, { email, name });
		if (!user) {
			return response.status(404).json({
				error: "reset_verification_failed",
				message: "媛???뺣낫媛 ?쇱튂?섏? ?딆뒿?덈떎."
			});
		}

		cleanupPhoneVerifications();
		const code = createVerificationCode();
		emailVerificationCodes.set(email, {
			code,
			expiresAt: Date.now() + EMAIL_CODE_TTL_MS
		});

		try {
			await sendResetEmailVerification({ email, code });
		} catch (error) {
			emailVerificationCodes.delete(email);
			throw error;
		}

		response.json({
			ok: true,
			expiresInSeconds: Math.floor(EMAIL_CODE_TTL_MS / 1000),
			...(shouldReturnDevVerificationCode() ? { verificationCode: code } : {})
		});
	} catch (error) {
		next(error);
	}
});

router.post("/reset-password/verify-phone", async (request, response) => {
	const phone = normalizePhone(request.body?.phone);
	const code = String(request.body?.code || "").trim();

	cleanupPhoneVerifications();
	const verification = phoneVerificationCodes.get(phone);
	if (!isVerificationBypassCode(code) && (!verification || verification.code !== code)) {
		return response.status(400).json({
			error: "invalid_phone_code",
			message: "?몄쬆踰덊샇媛 ?щ컮瑜댁? ?딄굅??留뚮즺?섏뿀?듬땲??"
		});
	}

	phoneVerificationCodes.delete(phone);
	const token = crypto.randomBytes(32).toString("hex");
	phoneVerificationTokens.set(token, {
		phone,
		expiresAt: Date.now() + PHONE_TOKEN_TTL_MS
	});

	response.json({
		ok: true,
		phoneVerificationToken: token,
		expiresInSeconds: Math.floor(PHONE_TOKEN_TTL_MS / 1000)
	});
});

router.post("/reset-password/verify-email", async (request, response) => {
	const email = String(request.body?.email || "").trim().toLowerCase();
	const code = String(request.body?.code || "").trim();

	cleanupPhoneVerifications();
	const verification = emailVerificationCodes.get(email);
	if (!isVerificationBypassCode(code) && (!verification || verification.code !== code)) {
		return response.status(400).json({
			error: "invalid_email_code",
			message: "?대찓???몄쬆踰덊샇媛 ?щ컮瑜댁? ?딄굅??留뚮즺?섏뿀?듬땲??"
		});
	}

	emailVerificationCodes.delete(email);
	const token = crypto.randomBytes(32).toString("hex");
	emailVerificationTokens.set(token, {
		email,
		expiresAt: Date.now() + EMAIL_TOKEN_TTL_MS
	});

	response.json({
		ok: true,
		emailVerificationToken: token,
		expiresInSeconds: Math.floor(EMAIL_TOKEN_TTL_MS / 1000)
	});
});

router.post("/reset-password", async (request, response, next) => {
  try {
    const { email, name, phone = "", password, phoneVerificationToken = "", emailVerificationToken = "" } = request.body || {};
    const normalizedEmail = String(email || "").trim().toLowerCase();
    const normalizedName = String(name || "").trim();
    const normalizedPhone = normalizePhone(phone);
    const normalizedPassword = String(password || "");

    if (!normalizedEmail || !normalizedName || normalizedPassword.length < 4) {
      return response.status(400).json({
        error: "invalid_reset_request",
        message: "?대찓?? ?대쫫, ??鍮꾨?踰덊샇媛 ?꾩슂?⑸땲??"
      });
    }

    const pool = await getPool();
    const user = await getResetUser(pool, { email: normalizedEmail, name: normalizedName });
    if (!user) {
      return response.status(404).json({
        error: "reset_verification_failed",
        message: "媛???뺣낫媛 ?쇱튂?섏? ?딆뒿?덈떎."
      });
    }

    cleanupPhoneVerifications();
    const verifiedPhone = phoneVerificationTokens.get(String(phoneVerificationToken || ""));
    const verifiedEmail = emailVerificationTokens.get(String(emailVerificationToken || ""));
    const phoneVerified = Boolean(
      verifiedPhone &&
      normalizedPhone &&
      verifiedPhone.phone === normalizedPhone &&
      isSamePhone(user.phone, normalizedPhone)
    );
    const emailVerified = Boolean(verifiedEmail && verifiedEmail.email === normalizedEmail);

    if (!phoneVerified && !emailVerified) {
      return response.status(400).json({
        error: "reset_verification_required",
        message: "?대????먮뒗 ?대찓???몄쬆???꾨즺?섏꽭??"
      });
    }

    const passwordHash = await bcrypt.hash(normalizedPassword, 12);
    const result = await pool.request()
      .input("email", sql.NVarChar(255), normalizedEmail)
      .input("name", sql.NVarChar(100), normalizedName)
      .input("phone", sql.NVarChar(30), user.phone || normalizedPhone || null)
      .input("password_hash", sql.NVarChar(255), passwordHash)
      .execute("dbo.app_reset_user_password");
    const reset = result.recordset[0];

    if (!reset?.ok) {
      return response.status(404).json({
        error: "reset_verification_failed",
        message: "Account information did not match."
      });
    }

    if (phoneVerified) phoneVerificationTokens.delete(String(phoneVerificationToken || ""));
    if (emailVerified) emailVerificationTokens.delete(String(emailVerificationToken || ""));
    response.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

router.get("/me", requireAuth, requireTeacher, async (request, response, next) => {
  try {
    const pool = await getPool();
    const result = await pool.request()
      .input("id", sql.UniqueIdentifier, request.user.sub)
      .execute("dbo.app_get_user_by_id");
    const user = result.recordset[0];

    if (!user) {
      return response.status(404).json({
        error: "user_not_found",
        message: "User was not found."
      });
    }

    response.json({
      user: serializeTeacherUser(user)
    });
  } catch (error) {
    next(error);
  }
});

router.get("/access-logs", requireAuth, requireTeacher, async (request, response, next) => {
  try {
    const limit = Number.parseInt(request.query.limit, 10) || 30;
    const pool = await getPool();
    const result = await pool.request()
      .input("user_id", sql.UniqueIdentifier, request.user.sub)
      .input("limit", sql.Int, limit)
      .execute("dbo.app_get_access_logs");

    response.json({
      logs: result.recordset.map((log) => ({
        id: log.id,
        role: log.role,
        loginId: log.loginId || "",
        ipAddress: log.ipAddress || "",
        userAgent: log.userAgent || "",
        createdAt: log.createdAt
      }))
    });
  } catch (error) {
    next(error);
  }
});

router.get("/plans", requireAuth, requireTeacher, async (request, response, next) => {
  try {
    const pool = await getPool();
    const result = await pool.request().execute("dbo.app_get_subscription_plans");
    const planRows = result.recordsets?.[0] || result.recordset || [];
    const termRows = result.recordsets?.[1] || [];
    const termsByPlan = new Map();
    termRows.map(serializePlanTerm).forEach((term) => {
      if (!term.planCode || term.months <= 0) return;
      if (!termsByPlan.has(term.planCode)) termsByPlan.set(term.planCode, []);
      termsByPlan.get(term.planCode).push(term);
    });
    response.json({
      plans: planRows.map((plan) => serializePlan({
        ...plan,
        terms: termsByPlan.get(plan.planCode) || []
      }))
    });
  } catch (error) {
    next(error);
  }
});

router.get("/payments/orders", requireAuth, requireTeacher, async (request, response, next) => {
  try {
    const limit = Math.min(Math.max(Number.parseInt(request.query.limit, 10) || 30, 1), 100);
    const pool = await getPool();
    const result = await pool.request()
      .input("user_id", sql.UniqueIdentifier, request.user.sub)
      .input("limit", sql.Int, limit)
      .query(`
        SELECT TOP (@limit)
          ledger.transactionType,
          ledger.paymentProvider,
          ledger.orderId,
          ledger.planCode,
          ledger.planName,
          ledger.orderName,
          ledger.amount,
          ledger.termMonths,
          ledger.baseAmount,
          ledger.discountRate,
          ledger.discountAmount,
          ledger.status,
          ledger.paymentMethod,
          ledger.refundedAmount,
          ledger.refundedAt,
          ledger.receiptUrl,
          ledger.requestedAt,
          ledger.approvedAt,
          ledger.completedAt
        FROM (
          SELECT
            N'payment' AS transactionType,
            po.payment_provider AS paymentProvider,
            po.order_id AS orderId,
            po.plan_code AS planCode,
            sp.plan_name AS planName,
            po.order_name AS orderName,
            po.amount,
            po.term_months AS termMonths,
            po.base_amount AS baseAmount,
            po.discount_rate AS discountRate,
            po.discount_amount AS discountAmount,
            po.status,
            po.payment_method AS paymentMethod,
            COALESCE(refunds.refundedAmount, 0) AS refundedAmount,
            refunds.refundedAt,
            COALESCE(
              JSON_VALUE(po.raw_response, '$.receipt.url'),
              JSON_VALUE(po.raw_response, '$.data.receiptUrl')
            ) AS receiptUrl,
            po.requested_at AS requestedAt,
            po.approved_at AS approvedAt,
            po.completed_at AS completedAt,
            po.requested_at AS sortAt,
            po.id AS sortId
          FROM dbo.payment_orders po
          LEFT JOIN dbo.subscription_plans sp ON sp.plan_code = po.plan_code
          OUTER APPLY (
            SELECT
              SUM(pr.refund_amount) AS refundedAmount,
              MAX(COALESCE(pr.processed_at, pr.requested_at)) AS refundedAt
            FROM dbo.payment_refunds pr
            WHERE pr.payment_order_id = po.id AND pr.status = N'DONE'
          ) refunds
          WHERE po.user_id = @user_id
            AND po.status = N'DONE'

          UNION ALL

          SELECT
            N'refund' AS transactionType,
            pr.payment_provider AS paymentProvider,
            pr.order_id AS orderId,
            po.plan_code AS planCode,
            sp.plan_name AS planName,
            N'환불' AS orderName,
            pr.refund_amount AS amount,
            po.term_months AS termMonths,
            po.base_amount AS baseAmount,
            po.discount_rate AS discountRate,
            po.discount_amount AS discountAmount,
            N'REFUNDED' AS status,
            po.payment_method AS paymentMethod,
            pr.refund_amount AS refundedAmount,
            COALESCE(pr.processed_at, pr.requested_at) AS refundedAt,
            CAST(N'' AS NVARCHAR(500)) AS receiptUrl,
            pr.requested_at AS requestedAt,
            COALESCE(pr.processed_at, pr.requested_at) AS approvedAt,
            COALESCE(pr.processed_at, pr.requested_at) AS completedAt,
            COALESCE(pr.processed_at, pr.requested_at) AS sortAt,
            pr.id AS sortId
          FROM dbo.payment_refunds pr
          INNER JOIN dbo.payment_orders po ON po.id = pr.payment_order_id
          LEFT JOIN dbo.subscription_plans sp ON sp.plan_code = po.plan_code
          WHERE pr.user_id = @user_id
            AND pr.status = N'DONE'
        ) ledger
        ORDER BY ledger.sortAt DESC, ledger.sortId DESC
      `);

    response.json({
      orders: result.recordset.map(serializePaymentOrder)
    });
  } catch (error) {
    next(error);
  }
});

router.post("/payments/orders", requireAuth, requireTeacher, async (request, response, next) => {
  try {
    const provider = getPaymentProvider();
    const tossClientKey = getTossClientKey();
    const innopayMid = getInnopayMid();
    if (provider === "toss" && !tossClientKey) {
      return response.status(500).json({
        error: "toss_client_key_missing",
        message: "?좎뒪?섏씠癒쇱툩 Client Key ?ㅼ젙???꾩슂?⑸땲??"
      });
    }
    if (provider === "innopay" && !innopayMid) {
      return response.status(500).json({
        error: "innopay_mid_missing",
        message: "?대끂?섏씠 MID ?ㅼ젙???꾩슂?⑸땲??"
      });
    }

    const planCode = String(request.body?.planCode || "").trim();
    const termMonths = Number.parseInt(request.body?.termMonths, 10) || 1;
    if (!planCode) {
      return response.status(400).json({
        error: "invalid_plan",
        message: "寃곗젣???붽툑?쒕? ?좏깮?섏꽭??"
      });
    }

    const orderId = createTossOrderId();
    const orderName = "";
    const pool = await getPool();
    const result = await pool.request()
      .input("user_id", sql.UniqueIdentifier, request.user.sub)
      .input("payment_provider", sql.NVarChar(20), provider)
      .input("plan_code", sql.NVarChar(30), planCode)
      .input("order_id", sql.NVarChar(64), orderId)
      .input("order_name", sql.NVarChar(100), orderName)
      .input("term_months", sql.Int, termMonths)
      .execute("dbo.app_create_payment_order");
    const order = result.recordset[0];

    if (!order?.ok) {
      if (order?.errorCode === "student_limit_exceeded") {
        return response.status(409).json({
          error: "student_limit_exceeded",
          message: `?꾩옱 ?깅줉 ?숈깮 ${Number(order.childCount || 0)}紐낆씠 ?좏깮???붽툑???쒗븳 ${Number(order.studentLimit || 0)}紐낆쓣 珥덇낵?⑸땲??`
        });
      }

      return response.status(400).json({
        error: order?.errorCode || "payment_order_failed",
        message: order?.errorCode === "free_plan" ? "臾대즺 ?붽툑?쒕뒗 寃곗젣媛 ?꾩슂?섏? ?딆뒿?덈떎." : "寃곗젣 二쇰Ц??留뚮뱾吏 紐삵뻽?듬땲??"
      });
    }

    const userResult = await pool.request()
      .input("user_id", sql.UniqueIdentifier, request.user.sub)
      .query("SELECT phone FROM dbo.users WHERE id = @user_id");
    const buyerTel = normalizePhone(userResult.recordset[0]?.phone || "");

    response.json({
      provider,
      clientKey: provider === "toss" ? tossClientKey : "",
      customerKey: String(request.user.sub),
      innopay: provider === "innopay" ? {
        mid: innopayMid,
        payMethod: getInnopayPayMethod(),
        buyerName: request.user.name || "StudyFlow",
        buyerTel,
        buyerEmail: request.user.email || "",
        returnUrl: String(request.body?.returnUrl || "").trim()
      } : null,
      order: {
        orderId: order.orderId,
        orderName: order.orderName,
        amount: Number(order.amount || 0),
        planCode: order.planCode,
        termMonths: Number(order.termMonths || 1),
        baseAmount: Number(order.baseAmount || 0),
        discountRate: Number(order.discountRate || 0),
        discountAmount: Number(order.discountAmount || 0)
      }
    });
  } catch (error) {
    next(error);
  }
});

router.get("/payments/refund-preview", requireAuth, requireTeacher, async (request, response, next) => {
  try {
    const pool = await getPool();
    const preview = await getSequentialRefundPreview(pool, request.user.sub);
    if (!preview.items.length || preview.amount <= 0) {
      return response.status(400).json({
        error: "no_refund_amount",
        message: "환불할 남은 이용금액이 없습니다."
      });
    }

    response.json({
      refund: {
        amount: preview.amount,
        currentServiceEndsAt: preview.currentServiceEndsAt,
        afterRefundServiceEndsAt: preview.afterRefundServiceEndsAt,
        items: preview.items
      }
    });
  } catch (error) {
    next(error);
  }
});

router.post("/payments/refund", requireAuth, requireTeacher, async (request, response, next) => {
  try {
    const reason = String(request.body?.reason || "이용기간 환불").trim().slice(0, 200);
    const pool = await getPool();
    const preview = await getSequentialRefundPreview(pool, request.user.sub);

    if (!preview.items.length || preview.amount <= 0) {
      return response.status(400).json({
        error: "no_refund_amount",
        message: "환불할 남은 이용금액이 없습니다."
      });
    }

    const completedItems = [];
    for (const item of preview.items) {
      const provider = String(item.provider || "").toLowerCase();
      const remainingPaidAmount = Math.max(0, Math.floor(Number(item.amount || 0)) - Math.floor(Number(item.refundedAmount || 0)));
      const refundResponse = provider === "innopay"
        ? await cancelInnopayPayment({
            tid: item.paymentKey,
            amount: item.refundAmount,
            reason,
            paymentMethod: item.paymentMethod,
            isPartialCancel: item.refundAmount < remainingPaidAmount
          })
        : await cancelTossPayment({
            paymentKey: item.paymentKey,
            cancelAmount: item.refundAmount,
            cancelReason: reason
          });

      const completeResult = await pool.request()
        .input("user_id", sql.UniqueIdentifier, request.user.sub)
        .input("order_id", sql.NVarChar(64), item.orderId)
        .input("refund_amount", sql.Int, item.refundAmount)
        .input("reason", sql.NVarChar(200), reason)
        .input("raw_response", sql.NVarChar(sql.MAX), JSON.stringify(refundResponse))
        .execute("dbo.app_complete_payment_refund");
      const status = completeResult.recordsets[0]?.[0];

      if (!status?.ok) {
        return response.status(400).json({
          error: status?.errorCode || "refund_complete_failed",
          message: "환불 결과를 저장하지 못했습니다.",
          completedItems
        });
      }

      completedItems.push({
        orderId: item.orderId,
        amount: item.refundAmount,
        status: "DONE"
      });
    }

    const userResult = await pool.request()
      .input("id", sql.UniqueIdentifier, request.user.sub)
      .execute("dbo.app_get_user_by_id");
    const user = userResult.recordset[0];

    response.json({
      refund: {
        amount: completedItems.reduce((sum, item) => sum + Number(item.amount || 0), 0),
        status: "DONE",
        items: completedItems
      },
      user: serializeTeacherUser(user)
    });
  } catch (error) {
    next(error);
  }
});

router.get("/payments/orders/:orderId/refund-preview", requireAuth, requireTeacher, async (request, response, next) => {
  try {
    const orderId = String(request.params.orderId || "").trim();
    if (!orderId) {
      return response.status(400).json({
        error: "invalid_payment_order",
        message: "환불할 결제 주문을 확인하지 못했습니다."
      });
    }

    const pool = await getPool();
    const refundableResult = await pool.request()
      .input("user_id", sql.UniqueIdentifier, request.user.sub)
      .input("order_id", sql.NVarChar(64), orderId)
      .execute("dbo.app_get_refundable_payment_order");
    const refundable = refundableResult.recordset[0];

    if (!refundable || refundable.errorCode) {
      const errorCode = refundable?.errorCode || "order_not_found";
      const messages = {
        order_not_found: "환불할 결제 주문을 찾지 못했습니다.",
        not_paid: "결제 완료 건만 환불할 수 있습니다.",
        already_refunded: "이미 환불된 결제입니다.",
        missing_payment_key: "PG 거래 키가 없어 환불할 수 없습니다.",
        missing_service_period: "이용기간 정보가 없어 환불할 수 없습니다.",
        expired: "이미 이용기간이 종료되어 환불할 금액이 없습니다.",
        not_current_period: "현재 적용 중인 최신 이용기간만 환불할 수 있습니다."
      };
      return response.status(errorCode === "order_not_found" ? 404 : 400).json({
        error: errorCode,
        message: messages[errorCode] || "환불할 수 없는 결제입니다."
      });
    }

    const refundAmount = calculateRefundAmount(refundable);
    if (refundAmount <= 0) {
      return response.status(400).json({
        error: "no_refund_amount",
        message: "환불할 남은 이용금액이 없습니다."
      });
    }

    response.json(serializeRefundPreview(refundable, refundAmount));
  } catch (error) {
    next(error);
  }
});

router.post("/payments/orders/:orderId/refund", requireAuth, requireTeacher, async (request, response, next) => {
  try {
    const orderId = String(request.params.orderId || "").trim();
    const reason = String(request.body?.reason || "이용기간 부분 환불").trim().slice(0, 200);
    if (!orderId) {
      return response.status(400).json({
        error: "invalid_payment_order",
        message: "환불할 결제 주문을 확인하지 못했습니다."
      });
    }

    const pool = await getPool();
    const refundableResult = await pool.request()
      .input("user_id", sql.UniqueIdentifier, request.user.sub)
      .input("order_id", sql.NVarChar(64), orderId)
      .execute("dbo.app_get_refundable_payment_order");
    const refundable = refundableResult.recordset[0];

    if (!refundable || refundable.errorCode) {
      const errorCode = refundable?.errorCode || "order_not_found";
      const messages = {
        order_not_found: "환불할 결제 주문을 찾지 못했습니다.",
        not_paid: "결제 완료 건만 환불할 수 있습니다.",
        already_refunded: "이미 환불된 결제입니다.",
        missing_payment_key: "PG 거래 키가 없어 환불할 수 없습니다.",
        missing_service_period: "이용기간 정보가 없어 환불할 수 없습니다.",
        expired: "이미 이용기간이 종료되어 환불할 금액이 없습니다.",
        not_current_period: "현재 적용 중인 최신 이용기간만 환불할 수 있습니다."
      };
      return response.status(errorCode === "order_not_found" ? 404 : 400).json({
        error: errorCode,
        message: messages[errorCode] || "환불할 수 없는 결제입니다."
      });
    }

    const refundAmount = calculateRefundAmount(refundable);
    if (refundAmount <= 0) {
      return response.status(400).json({
        error: "no_refund_amount",
        message: "환불할 남은 이용금액이 없습니다."
      });
    }

    const provider = String(refundable.paymentProvider || "").toLowerCase();
    const paymentKey = String(refundable.paymentKey || "").trim();
    const remainingPaidAmount = Math.max(0, Math.floor(Number(refundable.amount || 0)) - Math.floor(Number(refundable.refundedAmount || 0)));
    const refundResponse = provider === "innopay"
      ? await cancelInnopayPayment({
          tid: paymentKey,
          amount: refundAmount,
          reason,
          paymentMethod: refundable.paymentMethod,
          isPartialCancel: refundAmount < remainingPaidAmount
        })
      : await cancelTossPayment({ paymentKey, cancelAmount: refundAmount, cancelReason: reason });

    const completeResult = await pool.request()
      .input("user_id", sql.UniqueIdentifier, request.user.sub)
      .input("order_id", sql.NVarChar(64), orderId)
      .input("refund_amount", sql.Int, refundAmount)
      .input("reason", sql.NVarChar(200), reason)
      .input("raw_response", sql.NVarChar(sql.MAX), JSON.stringify(refundResponse))
      .execute("dbo.app_complete_payment_refund");
    const status = completeResult.recordsets[0]?.[0];

    if (!status?.ok) {
      return response.status(400).json({
        error: status?.errorCode || "refund_complete_failed",
        message: "환불 결과를 저장하지 못했습니다."
      });
    }

    const user = completeResult.recordsets[1]?.[0];
    response.json({
      refund: {
        orderId,
        amount: refundAmount,
        status: "DONE"
      },
      user: serializeTeacherUser(user)
    });
  } catch (error) {
    next(error);
  }
});

router.post("/payments/confirm", requireAuth, requireTeacher, async (request, response, next) => {
  try {
    const provider = String(request.body?.provider || "toss").trim().toLowerCase() === "innopay" ? "innopay" : "toss";
    const paymentKey = String(request.body?.paymentKey || request.body?.tid || "").trim();
    const orderId = String(request.body?.orderId || request.body?.moid || "").trim();
    const amount = Number.parseInt(request.body?.amount, 10) || 0;

    if ((provider === "toss" && !paymentKey) || !orderId || amount <= 0) {
      return response.status(400).json({
        error: "invalid_payment_confirm",
        message: "寃곗젣 ?뱀씤 ?뺣낫媛 ?щ컮瑜댁? ?딆뒿?덈떎."
      });
    }

    const pool = await getPool();
    const orderResult = await pool.request()
      .input("user_id", sql.UniqueIdentifier, request.user.sub)
      .input("order_id", sql.NVarChar(64), orderId)
      .execute("dbo.app_get_payment_order");
    const order = orderResult.recordset[0];

    if (!order || order.status === "DONE") {
      return response.status(404).json({
        error: "payment_order_not_found",
        message: "?뺤씤??寃곗젣 二쇰Ц??李얠? 紐삵뻽?듬땲??"
      });
    }

    if (Number(order.amount || 0) !== amount) {
      return response.status(400).json({
        error: "payment_amount_mismatch",
        message: "寃곗젣 湲덉븸??二쇰Ц 湲덉븸怨??ㅻ쫭?덈떎."
      });
    }

    let payment;
    let finalPaymentKey = paymentKey;
    let paymentMethod = "";
    let approvedAt = null;
    let paymentStatus = "";
    if (provider === "innopay") {
      const innopayResult = await confirmInnopayPayment({
        paymentToken: String(request.body?.paymentToken || "").trim(),
        tid: String(request.body?.tid || "").trim(),
        mid: String(request.body?.mid || "").trim() || getInnopayMid(),
        amount,
        taxFreeAmt: Number.parseInt(request.body?.taxFreeAmt, 10) || 0,
        moid: orderId
      });
      const data = innopayResult.data || {};
      payment = innopayResult;
      finalPaymentKey = String(data.tid || request.body?.tid || "");
      paymentMethod = String(data.payMethod || "");
      approvedAt = toTossApprovedDate(data.approvedAt);
      paymentStatus = data.status === 0 ? "DONE" : String(data.status ?? "");
      if (!finalPaymentKey || data.status !== 0) {
        return response.status(400).json({
          error: "payment_not_done",
          message: "寃곗젣媛 ?꾨즺 ?곹깭媛 ?꾨떃?덈떎."
        });
      }
    } else {
      payment = await confirmTossPayment({ paymentKey, orderId, amount });
      if (String(payment.status || "") !== "DONE") {
        return response.status(400).json({
          error: "payment_not_done",
          message: "寃곗젣媛 ?꾨즺 ?곹깭媛 ?꾨떃?덈떎."
        });
      }
      finalPaymentKey = payment.paymentKey;
      paymentMethod = String(payment.method || "");
      approvedAt = toTossApprovedDate(payment.approvedAt);
      paymentStatus = payment.status;
    }

    const completeResult = await pool.request()
      .input("user_id", sql.UniqueIdentifier, request.user.sub)
      .input("order_id", sql.NVarChar(64), orderId)
      .input("payment_key", sql.NVarChar(200), finalPaymentKey)
      .input("payment_method", sql.NVarChar(50), paymentMethod)
      .input("approved_at", sql.DateTime2, approvedAt)
      .input("raw_response", sql.NVarChar(sql.MAX), JSON.stringify(payment))
      .execute("dbo.app_complete_payment_order");
    const status = completeResult.recordsets[0]?.[0];

    if (!status?.ok) {
      return response.status(400).json({
        error: status?.errorCode || "payment_complete_failed",
        message: "寃곗젣 ?꾨즺 泥섎━???ㅽ뙣?덉뒿?덈떎."
      });
    }

    const user = completeResult.recordsets[1]?.[0];
    response.json({
      payment: {
        paymentKey: finalPaymentKey,
        orderId,
        method: paymentMethod,
        status: paymentStatus
      },
      user: serializeTeacherUser(user)
    });
  } catch (error) {
    next(error);
  }
});

router.put("/plan", requireAuth, requireTeacher, async (request, response, next) => {
  try {
    const planCode = String(request.body?.planCode || "").trim();
    if (!planCode) {
      return response.status(400).json({
        error: "invalid_plan",
        message: "蹂寃쏀븷 ?붽툑?쒕? ?좏깮?섏꽭??"
      });
    }

    const pool = await getPool();
    const result = await pool.request()
      .input("user_id", sql.UniqueIdentifier, request.user.sub)
      .input("plan_code", sql.NVarChar(30), planCode)
      .input("service_ends_at", sql.DateTime2, null)
      .execute("dbo.app_change_user_plan");
    const status = result.recordsets[0]?.[0];

    if (!status?.ok) {
      if (status?.errorCode === "student_limit_exceeded") {
        return response.status(409).json({
          error: "student_limit_exceeded",
          message: `?꾩옱 ?깅줉 ?숈깮 ${Number(status.childCount || 0)}紐낆씠 ?좏깮???붽툑???쒗븳 ${Number(status.studentLimit || 0)}紐낆쓣 珥덇낵?⑸땲??`
        });
      }

      return response.status(status?.errorCode === "user_not_found" ? 404 : 400).json({
        error: status?.errorCode || "plan_change_failed",
        message: status?.errorCode === "plan_not_found" ? "?ъ슜?????녿뒗 ?붽툑?쒖엯?덈떎." : "?붽툑?쒕? 蹂寃쏀븯吏 紐삵뻽?듬땲??"
      });
    }

    const user = result.recordsets[1]?.[0];
    response.json({
      user: serializeTeacherUser(user)
    });
  } catch (error) {
    next(error);
  }
});



router.post("/profile/phone-code", requireAuth, requireTeacher, async (request, response, next) => {
  const phone = normalizePhone(request.body?.phone);

  if (!/^01\d{8,9}$/.test(phone)) {
    return response.status(400).json({
      error: "invalid_phone",
      message: "?대???踰덊샇瑜??뺥솗???낅젰?섏꽭??"
    });
  }

  try {
    const pool = await getPool();
    const currentResult = await pool.request()
      .input("id", sql.UniqueIdentifier, request.user.sub)
      .execute("dbo.app_get_user_by_id");
    const currentUser = currentResult.recordset[0];

    if (!currentUser) {
      return response.status(404).json({
        error: "user_not_found",
        message: "User was not found."
      });
    }

    if (normalizePhone(currentUser.phone) === phone) {
      return response.status(400).json({
        error: "same_phone",
        message: "?꾩옱 ?깅줉??踰덊샇? 媛숈뒿?덈떎."
      });
    }

    cleanupPhoneVerifications();
    const code = createVerificationCode();
    phoneVerificationCodes.set(phone, {
      code,
      expiresAt: Date.now() + PHONE_CODE_TTL_MS
    });

    try {
      await sendProfilePhoneVerificationSms(pool, { phone, code, name: currentUser.name });
    } catch (error) {
      phoneVerificationCodes.delete(phone);
      throw error;
    }

    response.json({
      ok: true,
      expiresInSeconds: Math.floor(PHONE_CODE_TTL_MS / 1000),
      ...(shouldReturnDevVerificationCode() ? { verificationCode: code } : {})
    });
  } catch (error) {
    next(error);
  }
});

router.post("/profile/verify-phone", requireAuth, requireTeacher, async (request, response) => {
  const phone = normalizePhone(request.body?.phone);
  const code = String(request.body?.code || "").trim();

  cleanupPhoneVerifications();
  const verification = phoneVerificationCodes.get(phone);
  if (!isVerificationBypassCode(code) && (!verification || verification.code !== code)) {
    return response.status(400).json({
      error: "invalid_phone_code",
      message: "?몄쬆踰덊샇媛 ?щ컮瑜댁? ?딄굅??留뚮즺?섏뿀?듬땲??"
    });
  }

  phoneVerificationCodes.delete(phone);
  const token = crypto.randomBytes(32).toString("hex");
  phoneVerificationTokens.set(token, {
    phone,
    expiresAt: Date.now() + PHONE_TOKEN_TTL_MS
  });

  response.json({
    ok: true,
    phoneVerificationToken: token,
    expiresInSeconds: Math.floor(PHONE_TOKEN_TTL_MS / 1000)
  });
});

router.post("/profile/photo", requireAuth, requireTeacher, profilePhotoUpload.single("photo"), async (request, response, next) => {
  try {
    if (!request.file) {
      return response.status(400).json({
        error: "invalid_profile_photo",
        message: "등록할 프로필 사진을 선택하세요."
      });
    }

    const profileImagePath = getProfileImageRelativePath(request.file);
    const pool = await getPool();
    const currentResult = await pool.request()
      .input("id", sql.UniqueIdentifier, request.user.sub)
      .execute("dbo.app_get_user_by_id");
    const currentUser = currentResult.recordset[0];

    if (!currentUser) {
      deleteProfileImage(profileImagePath);
      return response.status(404).json({
        error: "user_not_found",
        message: "User was not found."
      });
    }

    await pool.request()
      .input("id", sql.UniqueIdentifier, request.user.sub)
      .input("profile_image_path", sql.NVarChar(1000), profileImagePath)
      .query(`
        UPDATE dbo.users
        SET profile_image_path = @profile_image_path,
            updated_at = SYSUTCDATETIME()
        WHERE id = @id
      `);

    deleteProfileImage(currentUser.profileImagePath);

    const updatedResult = await pool.request()
      .input("id", sql.UniqueIdentifier, request.user.sub)
      .execute("dbo.app_get_user_by_id");

    response.json({
      user: serializeTeacherUser(updatedResult.recordset[0])
    });
  } catch (error) {
    if (request.file) deleteProfileImage(getProfileImageRelativePath(request.file));
    next(error);
  }
});

router.delete("/profile/photo", requireAuth, requireTeacher, async (request, response, next) => {
  try {
    const pool = await getPool();
    const currentResult = await pool.request()
      .input("id", sql.UniqueIdentifier, request.user.sub)
      .execute("dbo.app_get_user_by_id");
    const currentUser = currentResult.recordset[0];

    if (!currentUser) {
      return response.status(404).json({
        error: "user_not_found",
        message: "User was not found."
      });
    }

    await pool.request()
      .input("id", sql.UniqueIdentifier, request.user.sub)
      .query(`
        UPDATE dbo.users
        SET profile_image_path = NULL,
            updated_at = SYSUTCDATETIME()
        WHERE id = @id
      `);

    deleteProfileImage(currentUser.profileImagePath);

    const updatedResult = await pool.request()
      .input("id", sql.UniqueIdentifier, request.user.sub)
      .execute("dbo.app_get_user_by_id");

    response.json({
      user: serializeTeacherUser(updatedResult.recordset[0])
    });
  } catch (error) {
    next(error);
  }
});

router.put("/profile", requireAuth, requireTeacher, async (request, response, next) => {
  try {
    const { name, phone = "", phoneVerificationToken = "", marketingConsent = false, password = "", teacherComment = "" } = request.body || {};
    const normalizedPhone = normalizePhone(phone);
    const normalizedTeacherComment = String(teacherComment || "").trim().slice(0, 200);

    if (!String(name || "").trim()) {
      return response.status(400).json({
        error: "invalid_profile_request",
        message: "?대쫫???낅젰?섏꽭??"
      });
    }

    const pool = await getPool();
    const currentResult = await pool.request()
      .input("id", sql.UniqueIdentifier, request.user.sub)
      .execute("dbo.app_get_user_by_id");
    const currentUser = currentResult.recordset[0];

    if (!currentUser) {
      return response.status(404).json({
        error: "user_not_found",
        message: "User was not found."
      });
    }

    const currentPhone = normalizePhone(currentUser.phone);
    if (normalizedPhone && normalizedPhone !== currentPhone) {
      cleanupPhoneVerifications();
      const verifiedPhone = phoneVerificationTokens.get(String(phoneVerificationToken || ""));
      if (!verifiedPhone || verifiedPhone.phone !== normalizedPhone) {
        return response.status(400).json({
          error: "phone_verification_required",
          message: "蹂寃쏀븷 ?대???踰덊샇瑜??몄쬆?섏꽭??"
        });
      }
    }

    const passwordHash = String(password || "").trim()
      ? await bcrypt.hash(String(password), 12)
      : null;
    const result = await pool.request()
      .input("id", sql.UniqueIdentifier, request.user.sub)
      .input("name", sql.NVarChar(100), String(name).trim())
      .input("phone", sql.NVarChar(30), normalizedPhone || null)
      .input("marketing_consent", sql.Bit, Boolean(marketingConsent))
      .input("teacher_comment", sql.NVarChar(200), normalizedTeacherComment || null)
      .input("password_hash", sql.NVarChar(255), passwordHash)
      .execute("dbo.app_update_user_profile");
    const user = result.recordset[0];

    if (!user) {
      return response.status(404).json({
        error: "user_not_found",
        message: "User was not found."
      });
    }

    response.json({
      user: serializeTeacherUser(user)
    });
    if (normalizedPhone && normalizedPhone !== currentPhone) {
      phoneVerificationTokens.delete(String(phoneVerificationToken || ""));
    }
  } catch (error) {
    next(error);
  }
});

router.put("/profile/comment", requireAuth, requireTeacher, async (request, response, next) => {
  try {
    const teacherComment = String(request.body?.teacherComment || "").trim().slice(0, 200);
    const pool = await getPool();
    await pool.request()
      .input("id", sql.UniqueIdentifier, request.user.sub)
      .input("teacher_comment", sql.NVarChar(200), teacherComment || null)
      .query(`
        UPDATE dbo.users
        SET teacher_comment = @teacher_comment,
            updated_at = SYSUTCDATETIME()
        WHERE id = @id
      `);

    const updatedResult = await pool.request()
      .input("id", sql.UniqueIdentifier, request.user.sub)
      .execute("dbo.app_get_user_by_id");

    response.json({
      user: serializeTeacherUser(updatedResult.recordset[0])
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
