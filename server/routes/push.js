const express = require("express");
const { getPool, sql } = require("../db");
const { requireAuth, requireStudent, requireTeacher } = require("../middleware/auth");

const router = express.Router();
let webpush;
let firebaseAdmin;
let firebaseInitialized = false;

function getVapidConfig() {
  const publicKey = process.env.VAPID_PUBLIC_KEY || "";
  const privateKey = process.env.VAPID_PRIVATE_KEY || "";
  const subject = process.env.VAPID_SUBJECT || "mailto:admin@example.com";
  return { publicKey, privateKey, subject };
}

function configureWebPush() {
  const { publicKey, privateKey, subject } = getVapidConfig();
  if (!publicKey || !privateKey) return false;
  try {
    webpush ||= require("web-push");
    webpush.setVapidDetails(subject, publicKey, privateKey);
    return true;
  } catch (error) {
    console.warn("Web Push initialization failed.", error);
    return false;
  }
}

function configureFirebaseAdmin() {
  if (firebaseInitialized) return true;

  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON || "";
  const projectId = process.env.FIREBASE_PROJECT_ID || "";

  try {
    firebaseAdmin ||= require("firebase-admin");

    if (serviceAccountJson) {
      firebaseAdmin.initializeApp({
        credential: firebaseAdmin.credential.cert(JSON.parse(serviceAccountJson))
      });
    } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS || projectId) {
      firebaseAdmin.initializeApp({
        credential: firebaseAdmin.credential.applicationDefault(),
        projectId: projectId || undefined
      });
    } else {
      return false;
    }

    firebaseInitialized = true;
    return true;
  } catch (error) {
    console.warn("Firebase Admin initialization failed.", error);
    return false;
  }
}

function getPushOwner(user) {
  if (user.role === "student") {
    return {
      userId: user.teacherUserId,
      role: "student",
      childId: user.childId
    };
  }

  return {
    userId: user.sub,
    role: "teacher",
    childId: null
  };
}

function normalizeSubscription(subscription) {
  const endpoint = String(subscription?.endpoint || "").trim();
  const p256dh = String(subscription?.keys?.p256dh || "").trim();
  const auth = String(subscription?.keys?.auth || "").trim();

  if (!endpoint || !p256dh || !auth) return null;
  return { endpoint, p256dh, auth };
}

function normalizeAppToken(body) {
  const token = String(body?.token || "").trim();
  const platform = String(body?.platform || "android").trim().toLowerCase();
  const deviceId = String(body?.deviceId || "").trim();

  if (!token || !["android", "ios"].includes(platform)) return null;
  return { token, platform, deviceId };
}

function getWebAppUrl() {
  return (process.env.STUDYFLOW_WEB_URL || "https://studyflow.csid.kr").trim().replace(/\/+$/, "");
}

function buildWebAppUrl(pathname) {
  return new URL(pathname, `${getWebAppUrl()}/`).href;
}

function normalizeEventPayload(body, user) {
  const eventType = body?.eventType === "complete" ? "complete" : "start";
  const studentName = String(user.childName || "학생").trim();
  const subjectName = String(body?.subjectName || "").trim();
  const bookName = String(body?.bookName || "").trim();
  const date = String(body?.date || "").trim();
  const amount = String(body?.amount || "").trim();
  const feedback = String(body?.feedback || "").trim();
  const title = eventType === "complete"
    ? `${studentName} 학습 완료`
    : `${studentName} 학습 시작`;
  const detail = [subjectName, bookName].filter(Boolean).join(" · ");
  const bodyParts = [
    detail,
    date,
    eventType === "complete" && amount ? `학습량: ${amount}` : "",
    eventType === "complete" && feedback ? `피드백: ${feedback}` : ""
  ].filter(Boolean);

  return {
    title,
    body: bodyParts.join("\n") || "StudyFlow 학습 알림",
    url: buildWebAppUrl("index.html")
  };
}

function normalizeTeacherSchedulePayload(body) {
  const childName = String(body?.childName || "Student").trim();
  const subjectName = String(body?.subjectName || "").trim();
  const bookName = String(body?.bookName || "").trim();
  const date = String(body?.date || "").trim();
  const amount = String(body?.amount || "").trim();
  const memo = String(body?.memo || "").trim();
  const detail = [subjectName, bookName].filter(Boolean).join(" · ");
  const bodyParts = [
    detail,
    date,
    amount ? `학습량: ${amount}` : "",
    memo ? `메모: ${memo}` : ""
  ].filter(Boolean);

  return {
    title: `${childName} 학습 일정 등록`,
    body: bodyParts.join("\n") || "새 학습 일정이 등록되었습니다.",
    url: buildWebAppUrl("student.html")
  };
}

async function sendPushNotifications(pool, targets, payload) {
  const webTargets = targets.filter((row) => row.channel === "web");
  const appTargets = targets.filter((row) => row.channel === "app");
  const sendResults = await Promise.allSettled(webTargets.map((row) =>
    webpush.sendNotification({
      endpoint: row.endpoint,
      keys: {
        p256dh: row.p256dh,
        auth: row.auth
      }
    }, JSON.stringify(payload))
  ));
  const expiredEndpoints = sendResults
    .map((item, index) => ({ item, endpoint: webTargets[index]?.endpoint }))
    .filter(({ item }) => item.status === "rejected" && [404, 410].includes(item.reason?.statusCode))
    .map(({ endpoint }) => endpoint)
    .filter(Boolean);

  await disableExpiredEndpoints(pool, expiredEndpoints);

  let appSent = 0;
  let appFailed = 0;
  let appPending = appTargets.length;

  if (appTargets.length && configureFirebaseAdmin()) {
    const appResults = await Promise.allSettled(appTargets.map((row) =>
      firebaseAdmin.messaging().send({
        token: row.token,
        notification: {
          title: payload.title,
          body: payload.body
        },
        data: {
          url: payload.url || "./"
        }
      })
    ));
    appSent = appResults.filter((item) => item.status === "fulfilled").length;
    appFailed = appResults.filter((item) => item.status === "rejected").length;
    appPending = 0;
  }

  return {
    sent: sendResults.filter((item) => item.status === "fulfilled").length + appSent,
    failed: sendResults.filter((item) => item.status === "rejected").length + appFailed,
    appPending
  };
}

async function disableExpiredEndpoints(pool, endpoints) {
  await Promise.all([...new Set(endpoints)].map((endpoint) =>
    pool.request()
      .input("endpoint", sql.NVarChar(1000), endpoint)
      .execute("dbo.app_disable_push_endpoint")
  ));
}

router.get("/public-key", (_request, response) => {
  const { publicKey } = getVapidConfig();
  response.json({
    configured: Boolean(publicKey),
    publicKey
  });
});

router.put("/subscription", requireAuth, async (request, response, next) => {
  try {
    const subscription = normalizeSubscription(request.body?.subscription);
    if (!subscription) {
      return response.status(400).json({
        error: "invalid_push_subscription",
        message: "Push subscription is required."
      });
    }

    const owner = getPushOwner(request.user);
    const pool = await getPool();
    await pool.request()
      .input("user_id", sql.UniqueIdentifier, owner.userId)
      .input("child_id", sql.UniqueIdentifier, owner.childId)
      .input("role", sql.NVarChar(20), owner.role)
      .input("endpoint", sql.NVarChar(1000), subscription.endpoint)
      .input("p256dh", sql.NVarChar(255), subscription.p256dh)
      .input("auth", sql.NVarChar(255), subscription.auth)
      .input("user_agent", sql.NVarChar(500), request.get("user-agent") || "")
      .execute("dbo.app_save_push_subscription");

    response.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

router.post("/subscription/status", requireAuth, async (request, response, next) => {
  try {
    const endpoint = String(request.body?.endpoint || "").trim();
    if (!endpoint) {
      return response.status(400).json({
        error: "invalid_push_endpoint",
        message: "Push endpoint is required."
      });
    }

    const owner = getPushOwner(request.user);
    const pool = await getPool();
    const result = await pool.request()
      .input("user_id", sql.UniqueIdentifier, owner.userId)
      .input("child_id", sql.UniqueIdentifier, owner.childId)
      .input("role", sql.NVarChar(20), owner.role)
      .input("endpoint", sql.NVarChar(1000), endpoint)
      .execute("dbo.app_get_push_subscription_status");
    const status = result.recordset[0] || {};

    response.json({
      registered: Boolean(status.registered)
    });
  } catch (error) {
    next(error);
  }
});

router.delete("/subscription", requireAuth, async (request, response, next) => {
  try {
    const endpoint = String(request.body?.endpoint || "").trim();
    if (!endpoint) {
      return response.status(400).json({
        error: "invalid_push_endpoint",
        message: "Push endpoint is required."
      });
    }

    const owner = getPushOwner(request.user);
    const pool = await getPool();
    const result = await pool.request()
      .input("user_id", sql.UniqueIdentifier, owner.userId)
      .input("child_id", sql.UniqueIdentifier, owner.childId)
      .input("role", sql.NVarChar(20), owner.role)
      .input("endpoint", sql.NVarChar(1000), endpoint)
      .execute("dbo.app_disable_push_subscription");
    const disabled = result.recordset[0] || {};

    response.json({
      ok: true,
      activeSubscriptionCount: Number(disabled.activeSubscriptionCount || 0)
    });
  } catch (error) {
    next(error);
  }
});

router.put("/app-token", requireAuth, async (request, response, next) => {
  try {
    const appToken = normalizeAppToken(request.body);
    if (!appToken) {
      return response.status(400).json({
        error: "invalid_app_push_token",
        message: "App push token and platform are required."
      });
    }

    const owner = getPushOwner(request.user);
    const pool = await getPool();
    await pool.request()
      .input("user_id", sql.UniqueIdentifier, owner.userId)
      .input("child_id", sql.UniqueIdentifier, owner.childId)
      .input("role", sql.NVarChar(20), owner.role)
      .input("platform", sql.NVarChar(20), appToken.platform)
      .input("device_id", sql.NVarChar(255), appToken.deviceId || null)
      .input("token", sql.NVarChar(1000), appToken.token)
      .input("user_agent", sql.NVarChar(500), request.get("user-agent") || "")
      .execute("dbo.app_save_push_app_token");

    response.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

router.delete("/app-token", requireAuth, async (request, response, next) => {
  try {
    const token = String(request.body?.token || "").trim();
    if (!token) {
      return response.status(400).json({
        error: "invalid_app_push_token",
        message: "App push token is required."
      });
    }

    const owner = getPushOwner(request.user);
    const pool = await getPool();
    await pool.request()
      .input("user_id", sql.UniqueIdentifier, owner.userId)
      .input("child_id", sql.UniqueIdentifier, owner.childId)
      .input("role", sql.NVarChar(20), owner.role)
      .input("token", sql.NVarChar(1000), token)
      .execute("dbo.app_disable_push_app_token");

    response.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

router.post("/student-event", requireAuth, requireStudent, async (request, response, next) => {
  try {
    if (!configureWebPush()) {
      return response.status(503).json({
        error: "push_not_configured",
        message: "Push VAPID keys are not configured."
      });
    }

    const pool = await getPool();
    const result = await pool.request()
      .input("user_id", sql.UniqueIdentifier, request.user.teacherUserId)
      .input("target", sql.NVarChar(30), "teachers")
      .input("child_id", sql.UniqueIdentifier, null)
      .execute("dbo.app_get_push_targets");
    const targets = result.recordset || [];
    const payload = normalizeEventPayload(request.body || {}, request.user);
    const sendResult = await sendPushNotifications(pool, targets, payload);

    response.json({
      ok: true,
      sent: sendResult.sent,
      failed: sendResult.failed,
      appPending: sendResult.appPending
    });
  } catch (error) {
    next(error);
  }
});

router.post("/teacher-schedule", requireAuth, requireTeacher, async (request, response, next) => {
  try {
    if (!configureWebPush()) {
      return response.status(503).json({
        error: "push_not_configured",
        message: "Push VAPID keys are not configured."
      });
    }

    const childId = String(request.body?.childId || "").trim();
    if (!childId) {
      return response.status(400).json({
        error: "invalid_push_target",
        message: "Child id is required."
      });
    }

    const pool = await getPool();
    const result = await pool.request()
      .input("user_id", sql.UniqueIdentifier, request.user.sub)
      .input("target", sql.NVarChar(30), "child")
      .input("child_id", sql.UniqueIdentifier, childId)
      .execute("dbo.app_get_push_targets");
    const targets = result.recordset || [];
    const payload = normalizeTeacherSchedulePayload(request.body || {});
    const sendResult = await sendPushNotifications(pool, targets, payload);

    response.json({
      ok: true,
      sent: sendResult.sent,
      failed: sendResult.failed,
      appPending: sendResult.appPending
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
