const express = require("express");
const { getPool, sql } = require("../db");
const { requireAuth, requireStudent } = require("../middleware/auth");

const router = express.Router();

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

function toIsoText(value) {
  if (!value) return "";
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function getProfileImageUrl(profileImagePath) {
  const value = String(profileImagePath || "").trim().replaceAll("\\", "/");
  if (!value) return "";
  return `/uploads/profile-images/${value.split("/").map(encodeURIComponent).join("/")}`;
}

function entryKey(subjectId, date) {
  return `${subjectId}__${date}`;
}

function buildStudentState(recordsets) {
  const [studentRows = [], bookRows = [], dayRows = [], entryRows = []] = recordsets;
  const student = studentRows[0];

  if (!student) return null;

  const scheduleDaysByBook = new Map();
  dayRows.forEach((row) => {
    const key = String(row.bookId);
    const days = scheduleDaysByBook.get(key) || [];
    days.push(Number(row.dayOfWeek));
    scheduleDaysByBook.set(key, days);
  });

  const subjects = bookRows.map((book) => ({
    id: String(book.id),
    subjectSettingId: String(book.subjectSettingId),
    name: book.subjectName,
    color: book.subjectColor,
    book: book.book,
    scheduleDays: scheduleDaysByBook.get(String(book.id)) || [],
    scheduleTime: toTimeText(book.scheduleTime),
    minimumStudyMinutes: normalizeMinimumStudyMinutes(book.minimumStudyMinutes),
    startDate: toDateText(book.startDate),
    endDate: toDateText(book.endDate),
    rewardEnabled: Boolean(book.rewardEnabled),
    rewardAmount: Number(book.rewardAmount || 0),
    rewardLabel: book.rewardLabel || "포인트"
  }));

  const subjectsById = new Map(subjects.map((subject) => [subject.id, subject]));
  const entries = {};
  entryRows.forEach((entry) => {
    const date = toDateText(entry.studyDate);
    const subjectId = String(entry.bookId);
    const subject = subjectsById.get(subjectId);
    const key = entryKey(subjectId, date);
    entries[key] = {
      key,
      subjectId,
      date,
      amount: entry.amount || "",
      minimumStudyMinutes: normalizeMinimumStudyMinutes(entry.minimumStudyMinutes) || normalizeMinimumStudyMinutes(subject?.minimumStudyMinutes),
      memo: entry.memo || "",
      completed: Boolean(entry.completed),
      rewardAwarded: Boolean(entry.rewardAwarded),
      rewardAmount: Number(entry.rewardAmount || 0),
      rewardLabel: entry.rewardLabel || "포인트",
      rewardRedeemed: Boolean(entry.rewardRedeemed),
      rewardRedeemedAt: toIsoText(entry.rewardRedeemedAt),
      studyStartedAt: toIsoText(entry.studyStartedAt),
      studyDurationSeconds: Number(entry.studyDurationSeconds || 0),
      studentFeedback: entry.studentFeedback || "",
      updatedAt: toIsoText(entry.updatedAt)
    };
  });

  return {
    student: {
      id: String(student.id),
      name: student.name,
      loginId: student.loginId || "",
      birthMonth: toDateText(student.birthMonth),
      teacherName: student.teacherName,
      teacherProfileImageUrl: getProfileImageUrl(student.teacherProfileImagePath),
      teacherComment: student.teacherComment || ""
    },
    subjects,
    entries
  };
}

router.get("/state", requireAuth, requireStudent, async (request, response, next) => {
  try {
    const pool = await getPool();
    const result = await pool.request()
      .input("teacher_user_id", sql.UniqueIdentifier, request.user.teacherUserId)
      .input("child_id", sql.UniqueIdentifier, request.user.childId)
      .execute("dbo.app_get_student_study_state");
    const state = buildStudentState(result.recordsets);

    if (!state) {
      return response.status(404).json({
        error: "student_not_found",
        message: "Student was not found."
      });
    }

    response.json({ state, persistence: "database" });
  } catch (error) {
    next(error);
  }
});

router.put("/entries", requireAuth, requireStudent, async (request, response, next) => {
  try {
    const {
      subjectId,
      date,
      amount = "",
      memo = "",
      completed = false,
      studyStartedAt = "",
      studyDurationSeconds = 0,
      studentFeedback = ""
    } = request.body || {};

    if (!subjectId || !date) {
      return response.status(400).json({
        error: "invalid_entry_request",
        message: "Subject and date are required."
      });
    }

    const pool = await getPool();
    const result = await pool.request()
      .input("teacher_user_id", sql.UniqueIdentifier, request.user.teacherUserId)
      .input("child_id", sql.UniqueIdentifier, request.user.childId)
      .input("book_id", sql.UniqueIdentifier, subjectId)
      .input("study_date", sql.Date, date)
      .input("amount", sql.NVarChar(200), String(amount || "").trim())
      .input("memo", sql.NVarChar(1000), String(memo || "").trim())
      .input("completed", sql.Bit, Boolean(completed))
      .input("study_started_at", sql.DateTime2, studyStartedAt ? new Date(studyStartedAt) : null)
      .input("study_duration_seconds", sql.Int, Math.max(0, Number.parseInt(studyDurationSeconds, 10) || 0))
      .input("student_feedback", sql.NVarChar(1000), String(studentFeedback || "").trim())
      .execute("dbo.app_update_student_entry");
    const entry = result.recordset[0];
    const studyDate = toDateText(entry.studyDate);

    response.json({
      entry: {
        key: entryKey(String(entry.bookId), studyDate),
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
        rewardRedeemedAt: toIsoText(entry.rewardRedeemedAt),
        studyStartedAt: toIsoText(entry.studyStartedAt),
        studyDurationSeconds: Number(entry.studyDurationSeconds || 0),
        studentFeedback: entry.studentFeedback || "",
        updatedAt: toIsoText(entry.updatedAt)
      }
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
