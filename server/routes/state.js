const express = require("express");
const bcrypt = require("bcrypt");
const { getPool, sql } = require("../db");
const { requireAuth, requireTeacher } = require("../middleware/auth");

const router = express.Router();

const dayLabels = ["일", "월", "화", "수", "목", "금", "토"];
const dayNumbers = new Map(dayLabels.map((label, index) => [label, index]));
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
  return String(value).slice(0, 5);
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
  const [profiles = [], childrenRows = [], settingRows = [], bookRows = [], dayRows = [], entryRows = []] = recordsets;
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
      updatedAt: entry.updatedAt ? new Date(entry.updatedAt).toISOString() : ""
    };
  });

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
    entries
  };
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
        scheduleTime: book.scheduleTime || "",
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
      updatedAt: entry.updatedAt || ""
    }))
    .filter((entry) => entry.bookId && entry.date);

  return {
    profile: state.profile || {},
    childAccounts: children,
    subjectSettings,
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
        updatedAt: entry.updatedAt ? new Date(entry.updatedAt).toISOString() : ""
      }
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
