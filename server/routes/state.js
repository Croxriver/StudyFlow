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

function toDayNumber(value) {
  if (typeof value === "number") return value;
  if (/^\d+$/.test(String(value))) return Number(value);
  return dayNumbers.get(String(value)) ?? null;
}

function entryKey(child, subjectId, date) {
  return `${child}__${subjectId}__${date}`;
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
    loginId: child.loginId || "",
    password: ""
  }));

  const subjectsByChild = Object.fromEntries(childAccounts.map((child) => [child.name, []]));
  bookRows.forEach((book) => {
    subjectsByChild[book.childName] ||= [];
    subjectsByChild[book.childName].push({
      id: String(book.id),
      subjectSettingId: String(book.subjectSettingId),
      name: book.subjectName,
      book: book.book,
      scheduleDays: scheduleDaysByBook.get(String(book.id)) || [],
      scheduleTime: toTimeText(book.scheduleTime),
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
    const key = entryKey(entry.childName, String(entry.bookId), date);
    entries[key] = {
      key,
      child: entry.childName,
      subjectId: String(entry.bookId),
      date,
      amount: entry.amount || "",
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
      marketingConsent: Boolean(profile.marketingConsent)
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
      loginId: String(child.loginId || "").trim(),
      password: "",
      passwordHash: password ? await bcrypt.hash(password, 12) : null,
      sortOrder: index
    };
  }));
  const childrenByName = new Map(children.map((child) => [child.name, child]));

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
  Object.entries(state.subjectsByChild || {}).forEach(([childName, subjects]) => {
    const child = childrenByName.get(childName);
    if (!child || !Array.isArray(subjects)) return;

    subjects.forEach((book) => {
      const id = ensureUuid(book.id);
      const subjectSettingId = subjectIdMap.get(book.subjectSettingId) || subjectNameMap.get(book.name);
      if (!subjectSettingId) return;

      bookIdMap.set(`${childName}__${book.id}`, id);
      books.push({
        id,
        childId: child.id,
        subjectSettingId,
        book: book.book,
        scheduleDays: (book.scheduleDays || [])
          .map(toDayNumber)
          .filter((day) => day !== null && day >= 0 && day <= 6),
        scheduleTime: toTimeText(book.scheduleTime ?? book.schedule_time),
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
      bookId: bookIdMap.get(`${entry.child}__${entry.subjectId}`),
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

    if (!child || !subjectId || !date) {
      return response.status(400).json({
        error: "invalid_entry_request",
        message: "Child, subject, and date are required."
      });
    }

    const pool = await getPool();
    const result = await pool.request()
      .input("user_id", sql.UniqueIdentifier, request.user.sub)
      .input("child_name", sql.NVarChar(100), String(child).trim())
      .input("book_id", sql.UniqueIdentifier, subjectId)
      .input("study_date", sql.Date, date)
      .input("amount", sql.NVarChar(200), String(amount || "").trim())
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
    const entry = result.recordset[0];
    const studyDate = toDateText(entry.studyDate);

    response.json({
      entry: {
        key: entryKey(entry.childName, String(entry.bookId), studyDate),
        child: entry.childName,
        subjectId: String(entry.bookId),
        date: studyDate,
        amount: entry.amount || "",
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
