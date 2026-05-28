const express = require("express");
const bcrypt = require("bcrypt");
const { getPool, sql } = require("../db");
const { requireAuth, requireTeacher } = require("../middleware/auth");

const router = express.Router();

const dayLabels = ["일", "월", "화", "수", "목", "금", "토"];
const dayNumbers = new Map(dayLabels.map((label, index) => [label, index]));
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const settingKeyPattern = /^[A-Za-z][A-Za-z0-9_.-]{0,99}$/;
const defaultUserSettings = {
  weekStartMode: "monday",
  startupScreenMode: "weekly"
};

function ensureUuid(value) {
  const text = String(value || "");
  return uuidPattern.test(text) ? text : crypto.randomUUID();
}

function toDateText(value) {
  if (!value) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function toTimeText(value) {
  if (!value) return "";
  if (value instanceof Date) {
    return `${String(value.getUTCHours()).padStart(2, "0")}:${String(value.getUTCMinutes()).padStart(2, "0")}`;
  }

  const match = String(value).match(/(\d{1,2}):(\d{2})/);
  if (!match) return "";

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return "";
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function normalizeMinimumStudyMinutes(value) {
  const minutes = Number.parseInt(value, 10) || 0;
  if (minutes < 10 || minutes > 120) return 0;
  return Math.floor(minutes / 10) * 10;
}

function readOptionalMinimumStudyMinutes(value) {
  if (!value || typeof value !== "object") return null;
  if (value.minimumStudyMinutes !== undefined && value.minimumStudyMinutes !== null) return normalizeMinimumStudyMinutes(value.minimumStudyMinutes);
  if (value.minimum_study_minutes !== undefined && value.minimum_study_minutes !== null) return normalizeMinimumStudyMinutes(value.minimum_study_minutes);
  return null;
}

function toDayNumber(value) {
  if (typeof value === "number") return value;
  if (/^\d+$/.test(String(value))) return Number(value);
  return dayNumbers.get(String(value)) ?? null;
}

function entryKey(child, subjectId, date) {
  return `${child}__${subjectId}__${date}`;
}

function getChildKey(child) {
  return String(child?.id || child?.name || "").trim();
}

function normalizeChildStatus(value) {
  return String(value || "") === "hidden" ? "hidden" : "active";
}

function buildStateFromRecordsets(recordsets) {
  const [profiles = [], childrenRows = [], settingRows = [], bookRows = [], dayRows = [], entryRows = [], userSettingRows = []] = recordsets;
  const profile = profiles[0];

  if (!profile) return null;

  const scheduleDaysByBook = new Map();
  dayRows.forEach((row) => {
    const key = String(row.bookId);
    const days = scheduleDaysByBook.get(key) || [];
    days.push(dayLabels[row.dayOfWeek]);
    scheduleDaysByBook.set(key, days);
  });

  const childAccounts = childrenRows.map((child) => ({
    id: String(child.id),
    name: child.name,
    birthMonth: toDateText(child.birthMonth),
    phone: child.phone || "",
    parentPhone: child.parentPhone || "",
    status: normalizeChildStatus(child.status),
    loginId: child.loginId || "",
    password: ""
  }));

  const childNamesById = new Map(childAccounts.map((child) => [child.id, child.name]));
  const subjectsByChild = Object.fromEntries(childAccounts.map((child) => [getChildKey(child), []]));
  bookRows.forEach((book) => {
    const childKey = String(book.childId || "");
    subjectsByChild[childKey] ||= [];
    subjectsByChild[childKey].push({
      id: String(book.id),
      childId: childKey,
      subjectSettingId: String(book.subjectSettingId),
      name: book.subjectName,
      book: book.book,
      scheduleDays: scheduleDaysByBook.get(String(book.id)) || [],
      scheduleTime: toTimeText(book.scheduleTime),
      minimumStudyMinutes: normalizeMinimumStudyMinutes(book.minimumStudyMinutes),
      startDate: toDateText(book.startDate),
      endDate: toDateText(book.endDate),
      rewardEnabled: Boolean(book.rewardEnabled),
      rewardAmount: Number(book.rewardAmount || 0),
      rewardLabel: book.rewardLabel || "포인트"
    });
  });

  const entries = {};
  entryRows.forEach((entry) => {
    const date = toDateText(entry.studyDate);
    const childId = String(entry.childId || "");
    const key = entryKey(childId, String(entry.bookId), date);
    entries[key] = {
      key,
      childId,
      child: childNamesById.get(childId) || entry.childName,
      subjectId: String(entry.bookId),
      date,
      amount: entry.amount || "",
      minimumStudyMinutes: normalizeMinimumStudyMinutes(entry.minimumStudyMinutes),
      memo: entry.memo || "",
      completed: Boolean(entry.completed),
      rewardAwarded: Boolean(entry.rewardAwarded),
      rewardAmount: Number(entry.rewardAmount || 0),
      rewardLabel: entry.rewardLabel || "포인트",
      rewardRedeemed: Boolean(entry.rewardRedeemed),
      rewardRedeemedAt: entry.rewardRedeemedAt ? new Date(entry.rewardRedeemedAt).toISOString() : "",
      studyStartedAt: entry.studyStartedAt ? new Date(entry.studyStartedAt).toISOString() : "",
      studyDurationSeconds: Number(entry.studyDurationSeconds || 0),
      studentFeedback: entry.studentFeedback || "",
      updatedAt: entry.updatedAt ? new Date(entry.updatedAt).toISOString() : ""
    };
  });

  const userSettings = {
    ...defaultUserSettings,
    ...Object.fromEntries(userSettingRows.map((setting) => [setting.settingKey, setting.settingValue || ""]))
  };
  if (!["monday", "today"].includes(userSettings.weekStartMode)) userSettings.weekStartMode = defaultUserSettings.weekStartMode;
  if (!["weekly", "last"].includes(userSettings.startupScreenMode)) userSettings.startupScreenMode = defaultUserSettings.startupScreenMode;

  return {
    profile: {
      name: profile.name,
      email: profile.email,
      password: "",
      phone: profile.phone || "",
      marketingConsent: Boolean(profile.marketingConsent),
      plan: {
        code: profile.planCode || "basic",
        name: profile.planName || "",
        monthlyPrice: Number(profile.monthlyPrice || 0),
        studentLimit: Number(profile.studentLimit || 0),
        gradientFrom: profile.gradientFrom || "",
        gradientTo: profile.gradientTo || ""
      },
      servicePeriod: {
        startedAt: profile.serviceStartedAt ? new Date(profile.serviceStartedAt).toISOString() : "",
        endsAt: profile.serviceEndsAt ? new Date(profile.serviceEndsAt).toISOString() : ""
      },
      profileImageUrl: profile.profileImagePath ? `/api/uploads/profile-images/${String(profile.profileImagePath).replaceAll("\\", "/").split("/").map(encodeURIComponent).join("/")}` : "",
      teacherComment: profile.teacherComment || ""
    },
    childAccounts,
    subjectsByChild,
    subjectSettings: settingRows.map((subject) => ({
      id: String(subject.id),
      name: subject.name,
      color: subject.color
    })),
    userSettings,
    entries
  };
}

function normalizeUserSettings(settings = {}) {
  const normalized = {};
  Object.entries(settings || {}).forEach(([key, value]) => {
    const settingKey = String(key || "").trim();
    if (!settingKeyPattern.test(settingKey)) return;
    normalized[settingKey] = String(value ?? "").slice(0, 1000);
  });

  if (!["monday", "today"].includes(normalized.weekStartMode)) {
    normalized.weekStartMode = defaultUserSettings.weekStartMode;
  }
  if (!["weekly", "last"].includes(normalized.startupScreenMode)) {
    normalized.startupScreenMode = defaultUserSettings.startupScreenMode;
  }

  return normalized;
}

async function normalizeStateForProcedure(state) {
  const children = await Promise.all((Array.isArray(state.childAccounts) ? state.childAccounts : []).map(async (child, index) => {
    const password = String(child.password || "").trim();

    return {
      ...child,
      id: ensureUuid(child.id),
      phone: String(child.phone || "").trim(),
      parentPhone: String(child.parentPhone || "").trim(),
      status: normalizeChildStatus(child.status),
      loginId: String(child.loginId || "").trim(),
      password: "",
      passwordHash: password ? await bcrypt.hash(password, 12) : null,
      sortOrder: index
    };
  }));
  const childrenById = new Map(children.map((child) => [String(child.id), child]));
  const childNameCounts = new Map();
  children.forEach((child) => childNameCounts.set(child.name, (childNameCounts.get(child.name) || 0) + 1));
  const childrenByUniqueName = new Map(children.filter((child) => childNameCounts.get(child.name) === 1).map((child) => [child.name, child]));

  const subjectIdMap = new Map();
  const subjectNameMap = new Map();
  const subjectSettings = (Array.isArray(state.subjectSettings) ? state.subjectSettings : []).map((subject, index) => {
    const id = ensureUuid(subject.id);
    const normalized = {
      ...subject,
      id,
      sortOrder: index
    };

    subjectIdMap.set(subject.id, id);
    subjectNameMap.set(subject.name, id);
    return normalized;
  });

  const bookIdMap = new Map();
  const books = [];
  Object.entries(state.subjectsByChild || {}).forEach(([childKey, subjects]) => {
    const child = childrenById.get(String(childKey)) || childrenByUniqueName.get(childKey);
    if (!child || !Array.isArray(subjects)) return;

    subjects.forEach((book) => {
      const id = ensureUuid(book.id);
      const subjectSettingId = subjectIdMap.get(book.subjectSettingId) || subjectNameMap.get(book.name);
      if (!subjectSettingId) return;

      bookIdMap.set(`${child.id}__${book.id}`, id);
      bookIdMap.set(`${child.name}__${book.id}`, id);
      books.push({
        id,
        childId: child.id,
        subjectSettingId,
        book: book.book,
        scheduleDays: (book.scheduleDays || [])
          .map(toDayNumber)
          .filter((day) => day !== null && day >= 0 && day <= 6),
        scheduleTime: toTimeText(book.scheduleTime ?? book.schedule_time),
        minimumStudyMinutes: readOptionalMinimumStudyMinutes(book),
        minimumStudyMinutesSource: book.minimumStudyMinutesSource === "book-dialog" || book.minimum_study_minutes_source === "book-dialog" ? "book-dialog" : "",
        startDate: book.startDate || "",
        endDate: book.endDate || "",
        rewardEnabled: Boolean(book.rewardEnabled),
        rewardAmount: Number.parseInt(book.rewardAmount, 10) > 0 ? Number.parseInt(book.rewardAmount, 10) : 0,
        rewardLabel: String(book.rewardLabel || "").trim() || "포인트"
      });
    });
  });

  const entriesList = Object.values(state.entries || {})
    .map((entry) => ({
      bookId: bookIdMap.get(`${entry.childId || entry.child}__${entry.subjectId}`),
      date: entry.date,
      amount: entry.amount || "",
      memo: entry.memo || "",
      completed: Boolean(entry.completed),
      rewardAwarded: Boolean(entry.rewardAwarded),
      rewardAmount: Number.parseInt(entry.rewardAmount, 10) > 0 ? Number.parseInt(entry.rewardAmount, 10) : 0,
      rewardLabel: String(entry.rewardLabel || "").trim() || "포인트",
      rewardRedeemed: Boolean(entry.rewardRedeemed),
      rewardRedeemedAt: entry.rewardRedeemedAt || "",
      studyStartedAt: entry.studyStartedAt || "",
      studyDurationSeconds: Number.parseInt(entry.studyDurationSeconds, 10) > 0 ? Number.parseInt(entry.studyDurationSeconds, 10) : 0,
      studentFeedback: String(entry.studentFeedback || "").trim(),
      minimumStudyMinutes: readOptionalMinimumStudyMinutes(entry),
      updatedAt: entry.updatedAt || ""
    }))
    .filter((entry) => entry.bookId && entry.date);

  return {
    profile: state.profile || {},
    childAccounts: children,
    subjectSettings,
    userSettings: normalizeUserSettings(state.userSettings),
    books,
    entriesList
  };
}

async function getStudentLimit(pool, userId) {
  const result = await pool.request()
    .input("user_id", sql.UniqueIdentifier, userId)
    .query(`
      SELECT ISNULL(plan_info.student_limit, 0) AS studentLimit
      FROM dbo.users u
      LEFT JOIN dbo.subscription_plans plan_info ON plan_info.plan_code = u.plan_code
      WHERE u.id = @user_id
    `);
  return Number(result.recordset[0]?.studentLimit || 0);
}

async function isServiceExpired(pool, userId) {
  const result = await pool.request()
    .input("user_id", sql.UniqueIdentifier, userId)
    .query(`
      SELECT
        u.service_ends_at AS serviceEndsAt,
        ISNULL(plan_info.monthly_price, 0) AS monthlyPrice
      FROM dbo.users u
      LEFT JOIN dbo.subscription_plans plan_info ON plan_info.plan_code = u.plan_code
      WHERE u.id = @user_id
    `);
  const monthlyPrice = Number(result.recordset[0]?.monthlyPrice || 0);
  if (monthlyPrice <= 0) return false;
  const endsAt = result.recordset[0]?.serviceEndsAt;
  if (!endsAt) return false;
  const expiresAt = new Date(endsAt);
  if (Number.isNaN(expiresAt.getTime())) return false;
  const restrictionStartsAt = new Date(expiresAt);
  restrictionStartsAt.setDate(restrictionStartsAt.getDate() + 1);
  restrictionStartsAt.setHours(0, 0, 0, 0);
  return restrictionStartsAt.getTime() <= Date.now();
}

function countRegisteredChildren(state) {
  return Array.isArray(state?.childAccounts) ? state.childAccounts.filter((child) => String(child?.name || "").trim()).length : 0;
}

function countRegisteredBooks(state) {
  return Object.values(state?.subjectsByChild || {}).reduce((count, subjects) => count + (Array.isArray(subjects) ? subjects.length : 0), 0);
}

async function getCurrentChildCount(pool, userId) {
  const result = await pool.request()
    .input("user_id", sql.UniqueIdentifier, userId)
    .query("SELECT COUNT(1) AS childCount FROM dbo.children WHERE user_id = @user_id");
  return Number(result.recordset[0]?.childCount || 0);
}

async function getCurrentBookCount(pool, userId) {
  const result = await pool.request()
    .input("user_id", sql.UniqueIdentifier, userId)
    .query("SELECT COUNT(1) AS bookCount FROM dbo.books WHERE user_id = @user_id");
  return Number(result.recordset[0]?.bookCount || 0);
}

router.get("/", requireAuth, requireTeacher, async (request, response, next) => {
  try {
    const pool = await getPool();
    const result = await pool.request()
      .input("user_id", sql.UniqueIdentifier, request.user.sub)
      .execute("dbo.app_get_study_state");
    const state = buildStateFromRecordsets(result.recordsets);

    if (!state) {
      return response.status(404).json({
        error: "user_not_found",
        message: "User was not found."
      });
    }

    response.json({
      state,
      persistence: "database"
    });
  } catch (error) {
    next(error);
  }
});

router.put("/", requireAuth, requireTeacher, async (request, response, next) => {
  const state = request.body?.state;

  if (!state || typeof state !== "object") {
    return response.status(400).json({
      error: "invalid_state",
      message: "State payload is required."
    });
  }

  try {
    const pool = await getPool();
    const studentLimit = await getStudentLimit(pool, request.user.sub);
    const serviceExpired = await isServiceExpired(pool, request.user.sub);
    const childCount = countRegisteredChildren(state);
    const bookCount = countRegisteredBooks(state);
    const currentChildCount = await getCurrentChildCount(pool, request.user.sub);
    const currentBookCount = await getCurrentBookCount(pool, request.user.sub);

    if (serviceExpired && childCount > currentChildCount) {
      return response.status(403).json({
        error: "service_expired",
        message: "이용기간이 만료되어 학생을 추가할 수 없습니다."
      });
    }

    if (serviceExpired && bookCount > currentBookCount) {
      return response.status(403).json({
        error: "service_expired",
        message: "이용기간이 만료되어 교재를 등록할 수 없습니다."
      });
    }

    if (studentLimit > 0 && childCount > studentLimit && childCount > currentChildCount) {
      return response.status(403).json({
        error: "student_limit_exceeded",
        message: `현재 요금제는 학생 ${studentLimit}명까지 등록할 수 있습니다.`
      });
    }

    const normalizedState = await normalizeStateForProcedure(state);
    const result = await pool.request()
      .input("user_id", sql.UniqueIdentifier, request.user.sub)
      .input("state_json", sql.NVarChar(sql.MAX), JSON.stringify(normalizedState))
      .execute("dbo.app_save_study_state");
    const saved = result.recordset[0] || {};

    response.json({
      ok: Boolean(saved.ok),
      persistence: saved.persistence || "database"
    });
  } catch (error) {
    next(error);
  }
});

router.put("/settings", requireAuth, requireTeacher, async (request, response, next) => {
  const settingKey = String(request.body?.key || "").trim();
  const settingValue = String(request.body?.value ?? "").trim();

  if (!settingKeyPattern.test(settingKey)) {
    return response.status(400).json({
      error: "invalid_setting_key",
      message: "A valid setting key is required."
    });
  }

  if (settingKey === "weekStartMode" && !["monday", "today"].includes(settingValue)) {
    return response.status(400).json({
      error: "invalid_setting_value",
      message: "Week start mode must be monday or today."
    });
  }

  if (settingKey === "startupScreenMode" && !["weekly", "last"].includes(settingValue)) {
    return response.status(400).json({
      error: "invalid_setting_value",
      message: "Startup screen mode must be weekly or last."
    });
  }

  try {
    const pool = await getPool();
    const result = await pool.request()
      .input("user_id", sql.UniqueIdentifier, request.user.sub)
      .input("setting_key", sql.NVarChar(100), settingKey)
      .input("setting_value", sql.NVarChar(1000), settingValue.slice(0, 1000))
      .execute("dbo.app_save_user_setting");
    const setting = result.recordset[0];

    response.json({
      setting: {
        key: setting.settingKey,
        value: setting.settingValue || "",
        updatedAt: setting.updatedAt ? new Date(setting.updatedAt).toISOString() : ""
      },
      persistence: "database"
    });
  } catch (error) {
    next(error);
  }
});

router.put("/entries", requireAuth, requireTeacher, async (request, response, next) => {
  try {
    const {
      child,
      childId = "",
      subjectId,
      date,
      amount = "",
      memo = "",
      completed = false,
      rewardAwarded = false,
      rewardAmount = 0,
      rewardLabel = "",
      rewardRedeemed = false,
      rewardRedeemedAt = "",
      studyStartedAt = "",
      studyDurationSeconds = 0,
      studentFeedback = "",
      updatedAt = ""
    } = request.body || {};
    const hasMinimumStudyMinutes = Object.prototype.hasOwnProperty.call(request.body || {}, "minimumStudyMinutes");
    const minimumStudyMinutes = normalizeMinimumStudyMinutes(request.body?.minimumStudyMinutes);

    if ((!child && !childId) || !subjectId || !date) {
      return response.status(400).json({
        error: "invalid_entry_request",
        message: "Child, subject, and date are required."
      });
    }

    const pool = await getPool();
    const result = await pool.request()
      .input("user_id", sql.UniqueIdentifier, request.user.sub)
      .input("child_name", sql.NVarChar(100), String(child).trim())
      .input("child_id", sql.UniqueIdentifier, childId || null)
      .input("book_id", sql.UniqueIdentifier, subjectId)
      .input("study_date", sql.Date, date)
      .input("amount", sql.NVarChar(200), String(amount || "").trim())
      .input("minimum_study_minutes", sql.Int, minimumStudyMinutes)
      .input("memo", sql.NVarChar(1000), String(memo || "").trim())
      .input("completed", sql.Bit, Boolean(completed))
      .input("reward_awarded", sql.Bit, Boolean(rewardAwarded))
      .input("reward_amount", sql.Int, Number.parseInt(rewardAmount, 10) || 0)
      .input("reward_label", sql.NVarChar(50), String(rewardLabel || "").trim() || null)
      .input("reward_redeemed", sql.Bit, Boolean(rewardRedeemed))
      .input("reward_redeemed_at", sql.DateTime2, rewardRedeemedAt ? new Date(rewardRedeemedAt) : null)
      .input("study_started_at", sql.DateTime2, studyStartedAt ? new Date(studyStartedAt) : null)
      .input("study_duration_seconds", sql.Int, Math.max(0, Number.parseInt(studyDurationSeconds, 10) || 0))
      .input("student_feedback", sql.NVarChar(1000), String(studentFeedback || "").trim())
      .input("updated_at", sql.DateTime2, updatedAt ? new Date(updatedAt) : null)
      .execute("dbo.app_update_teacher_entry");

    if (hasMinimumStudyMinutes) {
      await pool.request()
        .input("user_id", sql.UniqueIdentifier, request.user.sub)
        .input("book_id", sql.UniqueIdentifier, subjectId)
        .input("study_date", sql.Date, date)
        .input("minimum_study_minutes", sql.Int, minimumStudyMinutes)
        .query(`
          UPDATE dbo.study_entries
          SET minimum_study_minutes = @minimum_study_minutes
          WHERE user_id = @user_id
            AND book_id = @book_id
            AND study_date = @study_date;
        `);
    }

    const entryResult = await pool.request()
      .input("user_id", sql.UniqueIdentifier, request.user.sub)
      .input("book_id", sql.UniqueIdentifier, subjectId)
      .input("study_date", sql.Date, date)
      .query(`
        SELECT
          se.child_id AS childId,
          c.name AS childName,
          se.book_id AS bookId,
          se.study_date AS studyDate,
          se.amount,
          se.minimum_study_minutes AS minimumStudyMinutes,
          se.memo,
          se.completed,
          se.reward_awarded AS rewardAwarded,
          se.reward_amount AS rewardAmount,
          se.reward_label AS rewardLabel,
          se.reward_redeemed AS rewardRedeemed,
          se.reward_redeemed_at AS rewardRedeemedAt,
          se.study_started_at AS studyStartedAt,
          se.study_duration_seconds AS studyDurationSeconds,
          se.student_feedback AS studentFeedback,
          se.updated_at AS updatedAt
        FROM dbo.study_entries se
        INNER JOIN dbo.children c ON c.id = se.child_id
        WHERE se.user_id = @user_id
          AND se.book_id = @book_id
          AND se.study_date = @study_date;
      `);
    const entry = entryResult.recordset[0] || result.recordset[0];
    const studyDate = toDateText(entry.studyDate);

    response.json({
      entry: {
        key: entryKey(String(entry.childId || childId || entry.childName), String(entry.bookId), studyDate),
        childId: String(entry.childId || childId || ""),
        child: entry.childName,
        subjectId: String(entry.bookId),
        date: studyDate,
        amount: entry.amount || "",
        minimumStudyMinutes: normalizeMinimumStudyMinutes(entry.minimumStudyMinutes),
        memo: entry.memo || "",
        completed: Boolean(entry.completed),
        rewardAwarded: Boolean(entry.rewardAwarded),
        rewardAmount: Number(entry.rewardAmount || 0),
        rewardLabel: entry.rewardLabel || "포인트",
        rewardRedeemed: Boolean(entry.rewardRedeemed),
        rewardRedeemedAt: entry.rewardRedeemedAt ? new Date(entry.rewardRedeemedAt).toISOString() : "",
        studyStartedAt: entry.studyStartedAt ? new Date(entry.studyStartedAt).toISOString() : "",
        studyDurationSeconds: Number(entry.studyDurationSeconds || 0),
        studentFeedback: entry.studentFeedback || "",
        updatedAt: entry.updatedAt ? new Date(entry.updatedAt).toISOString() : ""
      }
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
