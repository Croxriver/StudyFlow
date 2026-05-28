const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const express = require("express");
const multer = require("multer");
const { getPool, resetPool, sql } = require("../db");
const { requireAuth, requireStudent, requireTeacher } = require("../middleware/auth");
const { analyzeStudyImages, getConfiguredPrompt } = require("../services/aiAnalysis");

const router = express.Router();
const rootDir = path.join(__dirname, "..", "..");
const uploadRoot = path.resolve(process.env.UPLOAD_DIR || path.join(rootDir, "uploads", "study-attachments"));
const allowedMimeTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const maxAnalysisImageBytes = 30 * 1024 * 1024;
const fallbackImageExtensions = new Map([
  ["image/jpeg", ".jpg"],
  ["image/png", ".png"],
  ["image/webp", ".webp"]
]);

fs.mkdirSync(uploadRoot, { recursive: true });

const storage = multer.diskStorage({
  destination: (request, _file, callback) => {
    const uploadDir = getStudentUploadDir(request);
    fs.mkdirSync(uploadDir, { recursive: true });
    callback(null, uploadDir);
  },
  filename: (_request, file, callback) => {
    const originalName = normalizeUploadFileName(file.originalname || "");
    const extension = path.extname(originalName).toLowerCase() || fallbackImageExtensions.get(file.mimetype) || "";
    callback(null, `${Date.now()}-${crypto.randomUUID()}${extension}`);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 8 * 1024 * 1024,
    files: 5
  },
  fileFilter: (_request, file, callback) => {
    if (!allowedMimeTypes.has(file.mimetype)) {
      callback(new Error("Only jpg, png, and webp image files can be uploaded."));
      return;
    }
    callback(null, true);
  }
});

function toDateText(value) {
  if (!value) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function toIsoText(value) {
  if (!value) return "";
  if (value instanceof Date) return value.toISOString();
  return String(value);
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

function normalizeUploadFileName(value) {
  const name = String(value || "").trim();
  if (!name) return "";
  const decoded = Buffer.from(name, "latin1").toString("utf8");
  const looksMojibake = /[\u0080-\u009f]|[ÃÂÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖØÙÚÛÜÝÞßàáâãäåæçèéêëìíîïðñòóôõöøùúûüýþÿ]/.test(name);
  if (looksMojibake && decoded && !decoded.includes("\uFFFD")) return decoded;
  return name;
}

function getStudentUploadDir(request) {
  const now = new Date();
  const year = String(now.getFullYear());
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const teacherId = safePathSegment(request.user?.teacherUserId || "unknown-teacher");
  const childId = safePathSegment(request.user?.childId || "unknown-child");
  return path.join(uploadRoot, teacherId, childId, year, month);
}

function safePathSegment(value) {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .slice(0, 80) || "unknown";
}

function getStoredRelativePath(file) {
  return path.relative(uploadRoot, file.path).replaceAll(path.sep, "/");
}

function serializeAttachment(row) {
  const id = String(row.id);
  const entryAiStatus = row.entryAiStatus || "none";
  return {
    id,
    originalName: row.originalName || "",
    mimeType: row.mimeType || "",
    fileSize: Number(row.fileSize || 0),
    aiStatus: row.aiStatus || "none",
    aiResult: row.aiResult || "",
    aiAnalyzedAt: toIsoText(row.aiAnalyzedAt),
    teacherViewedAt: toIsoText(row.teacherViewedAt),
    canDelete: !row.teacherViewedAt && (row.aiStatus || "none") === "none" && entryAiStatus === "none",
    createdAt: toIsoText(row.createdAt),
    fileUrl: `/api/attachments/${id}/file`
  };
}

function serializeAnalysis(row = {}) {
  return {
    aiStatus: row.aiStatus || "none",
    aiResult: row.aiResult || "",
    aiAnalyzedAt: toIsoText(row.aiAnalyzedAt),
    updatedAt: toIsoText(row.updatedAt)
  };
}

function removeUploadedFiles(files = []) {
  files.forEach((file) => {
    if (!file?.path) return;
    fs.promises.unlink(file.path).catch(() => {});
  });
}

async function getTeacherChildId(pool, userId, childName) {
  const result = await pool.request()
    .input("user_id", sql.UniqueIdentifier, userId)
    .input("child_name", sql.NVarChar(100), String(childName || "").trim())
    .query("SELECT TOP 1 id FROM dbo.children WHERE user_id = @user_id AND name = @child_name");
  return result.recordset[0]?.id || null;
}

async function getAttachmentList(pool, { userId, childId, bookId, studyDate }) {
  const result = await pool.request()
    .input("user_id", sql.UniqueIdentifier, userId)
    .input("child_id", sql.UniqueIdentifier, childId)
    .input("book_id", sql.UniqueIdentifier, bookId)
    .input("study_date", sql.Date, studyDate)
    .execute("dbo.app_get_study_entry_attachments");
  return result.recordset.map(serializeAttachment);
}

async function getAttachmentRows(pool, { userId, childId, bookId, studyDate }) {
  const result = await pool.request()
    .input("user_id", sql.UniqueIdentifier, userId)
    .input("child_id", sql.UniqueIdentifier, childId)
    .input("book_id", sql.UniqueIdentifier, bookId)
    .input("study_date", sql.Date, studyDate)
    .execute("dbo.app_get_study_entry_attachments");
  return result.recordset;
}

async function getEntryAiAnalysis(pool, { userId, childId, bookId, studyDate }) {
  const result = await pool.request()
    .input("user_id", sql.UniqueIdentifier, userId)
    .input("child_id", sql.UniqueIdentifier, childId)
    .input("book_id", sql.UniqueIdentifier, bookId)
    .input("study_date", sql.Date, studyDate)
    .execute("dbo.app_get_study_entry_ai_analysis");
  return serializeAnalysis(result.recordset[0]);
}

async function updateEntryAiAnalysis(pool, { userId, childId, bookId, studyDate, status, resultText }) {
  await pool.request()
    .input("user_id", sql.UniqueIdentifier, userId)
    .input("child_id", sql.UniqueIdentifier, childId)
    .input("book_id", sql.UniqueIdentifier, bookId)
    .input("study_date", sql.Date, studyDate)
    .input("ai_status", sql.NVarChar(20), status)
    .input("ai_result", sql.NVarChar(sql.MAX), resultText || "")
    .execute("dbo.app_update_study_entry_ai_analysis");
  return getEntryAiAnalysis(pool, { userId, childId, bookId, studyDate });
}

function isTransientSqlError(error) {
  return ["ECONNRESET", "ESOCKET", "ECONNCLOSED", "ETIMEOUT"].includes(error?.code || error?.number);
}

async function updateEntryAiAnalysisWithRetry(target, status, resultText) {
  try {
    const pool = await getPool();
    return await updateEntryAiAnalysis(pool, { ...target, status, resultText });
  } catch (error) {
    if (!isTransientSqlError(error)) throw error;
    await resetPool();
    const pool = await getPool();
    return updateEntryAiAnalysis(pool, { ...target, status, resultText });
  }
}

async function getAttachmentListWithRetry(target) {
  try {
    const pool = await getPool();
    return await getAttachmentList(pool, target);
  } catch (error) {
    if (!isTransientSqlError(error)) throw error;
    await resetPool();
    const pool = await getPool();
    return getAttachmentList(pool, target);
  }
}

async function updateEntryAttachmentAiResult(pool, { userId, childId, bookId, studyDate, attachmentId = null, status, resultText }) {
  const result = await pool.request()
    .input("user_id", sql.UniqueIdentifier, userId)
    .input("child_id", sql.UniqueIdentifier, childId)
    .input("book_id", sql.UniqueIdentifier, bookId)
    .input("study_date", sql.Date, studyDate)
    .input("attachment_id", sql.UniqueIdentifier, attachmentId)
    .input("ai_status", sql.NVarChar(20), status)
    .input("ai_result", sql.NVarChar(sql.MAX), resultText || "")
    .execute("dbo.app_update_study_entry_attachment_ai_result");
  return result.recordset.map(serializeAttachment);
}

async function markEntryAttachmentsViewed(pool, { userId, childId, bookId, studyDate }) {
  const result = await pool.request()
    .input("user_id", sql.UniqueIdentifier, userId)
    .input("child_id", sql.UniqueIdentifier, childId)
    .input("book_id", sql.UniqueIdentifier, bookId)
    .input("study_date", sql.Date, studyDate)
    .execute("dbo.app_mark_study_entry_attachments_viewed");
  return result.recordset.map(serializeAttachment);
}

function buildAnalysisPrompt({ childName, studyDate, attachmentCount, attachmentName = "", attachmentIndex = 0 }) {
  const defaultPrompt = [
    "너는 초등/중등 학생의 학습 결과물을 검토하는 선생님 보조 AI야.",
    "첨부된 이미지는 학생이 학습 완료 후 등록한 시험지, 문제지, 풀이 노트일 수 있다.",
    "",
    "다음 형식으로 한국어로 분석해줘.",
    "",
    "1. 전체 요약",
    "2. 확인 가능한 학습 내용",
    "3. 잘한 점",
    "4. 보완이 필요한 점",
    "5. 오답 또는 실수로 보이는 부분",
    "6. 다음 학습 제안",
    "7. 선생님이 학생에게 전달하기 좋은 짧은 피드백",
    "",
    "주의:",
    "- 이미지에서 명확히 보이는 내용만 근거로 말해.",
    "- 보이지 않거나 확실하지 않은 내용은 추측하지 말고 \"이미지상 확인이 어렵다\"고 말해.",
    "- 학생을 비난하지 말고 선생님이 참고하기 좋은 표현으로 작성해."
  ].join("\n");
  const customPrompt = getConfiguredPrompt();
  const basePrompt = customPrompt || defaultPrompt;
  return [
    basePrompt,
    "",
    "분석 대상 정보:",
    `- 학생: ${childName || "학생"}`,
    `- 학습일: ${studyDate}`,
    `- 첨부 사진 수: ${attachmentCount}장`
  ].join("\n");
}

async function analyzeImagesWithOpenAI({ attachments, childName, studyDate, attachmentIndex = 0 }) {
  const imageContents = [];
  let totalBytes = 0;
  for (const attachment of attachments) {
    const filePath = path.resolve(uploadRoot, attachment.filePath || "");
    if (!filePath.startsWith(`${uploadRoot}${path.sep}`) || !fs.existsSync(filePath)) continue;
    const bytes = await fs.promises.readFile(filePath);
    totalBytes += bytes.length;
    if (totalBytes > maxAnalysisImageBytes) {
      const error = new Error("Attached images are too large for analysis.");
      error.status = 400;
      error.publicMessage = "AI 분석할 사진 용량이 너무 큽니다. 사진 수나 용량을 줄여주세요.";
      throw error;
    }
    imageContents.push({
      base64: bytes.toString("base64"),
      dataUrl: `data:${attachment.mimeType || "image/jpeg"};base64,${bytes.toString("base64")}`,
      mimeType: attachment.mimeType || "image/jpeg",
      name: attachment.originalName || "첨부 사진"
    });
  }

  if (!imageContents.length) {
    const error = new Error("No readable attachment files.");
    error.status = 404;
    error.publicMessage = "AI 분석할 사진 파일을 찾지 못했습니다.";
    throw error;
  }

  return analyzeStudyImages({
    prompt: buildAnalysisPrompt({
      childName,
      studyDate,
      attachmentCount: imageContents.length,
      attachmentName: attachments[0]?.originalName || "",
      attachmentIndex
    }),
    images: imageContents
  });
}

router.get("/entry", requireAuth, async (request, response, next) => {
  try {
    const subjectId = String(request.query.subjectId || "").trim();
    const date = String(request.query.date || "").trim();
    if (!subjectId || !date) {
      return response.status(400).json({
        error: "invalid_attachment_request",
        message: "Subject and date are required."
      });
    }

    const pool = await getPool();
    let userId = request.user.sub;
    let childId = request.query.childId || "";

    if (request.user.role === "student") {
      userId = request.user.teacherUserId;
      childId = request.user.childId;
    } else if (!childId) {
      childId = await getTeacherChildId(pool, userId, request.query.child);
    }

    if (!childId) {
      return response.status(404).json({
        error: "child_not_found",
        message: "Student was not found."
      });
    }

    const shouldMarkViewed = request.user.role !== "student" && String(request.query.markViewed || "") === "true";
    const target = {
      userId,
      childId,
      bookId: subjectId,
      studyDate: date
    };
    const attachments = shouldMarkViewed
      ? await markEntryAttachmentsViewed(pool, target)
      : await getAttachmentList(pool, target);
    const analysis = await getEntryAiAnalysis(pool, target);

    response.json({ attachments, analysis });
  } catch (error) {
    next(error);
  }
});

router.post("/student-entry", requireAuth, requireStudent, upload.array("attachments", 5), async (request, response, next) => {
  const files = request.files || [];
  try {
    const subjectId = String(request.body?.subjectId || "").trim();
    const date = String(request.body?.date || "").trim();

    if (!subjectId || !date || files.length === 0) {
      removeUploadedFiles(files);
      return response.status(400).json({
        error: "invalid_attachment_request",
        message: "Subject, date, and at least one file are required."
      });
    }

    const pool = await getPool();
    const analysis = await getEntryAiAnalysis(pool, {
      userId: request.user.teacherUserId,
      childId: request.user.childId,
      bookId: subjectId,
      studyDate: date
    });
    if (["analyzing", "completed"].includes(analysis?.aiStatus)) {
      removeUploadedFiles(files);
      return response.status(409).json({
        error: "attachment_upload_locked",
        message: "사진 확인이 시작되어 더 등록할 수 없습니다."
      });
    }

    const attachments = [];
    for (const file of files) {
      const originalName = normalizeUploadFileName(file.originalname || file.filename);
      const result = await pool.request()
        .input("user_id", sql.UniqueIdentifier, request.user.teacherUserId)
        .input("child_id", sql.UniqueIdentifier, request.user.childId)
        .input("book_id", sql.UniqueIdentifier, subjectId)
        .input("study_date", sql.Date, date)
        .input("original_name", sql.NVarChar(255), originalName || file.filename)
        .input("stored_name", sql.NVarChar(255), file.filename)
        .input("file_path", sql.NVarChar(1000), getStoredRelativePath(file))
        .input("mime_type", sql.NVarChar(100), file.mimetype)
        .input("file_size", sql.BigInt, file.size)
        .execute("dbo.app_add_study_entry_attachment");
      attachments.push(serializeAttachment(result.recordset[0]));
    }

    response.status(201).json({ attachments });
  } catch (error) {
    removeUploadedFiles(files);
    next(error);
  }
});

router.post("/entry/analyze", requireAuth, requireTeacher, async (request, response, next) => {
  const subjectId = String(request.body?.subjectId || "").trim();
  const date = String(request.body?.date || "").trim();
  const childName = String(request.body?.child || "").trim();
  const requestedChildId = String(request.body?.childId || "").trim();
  let pool;
  let analysisTarget = null;

  try {
    if (!subjectId || !date || (!childName && !requestedChildId)) {
      return response.status(400).json({
        error: "invalid_analysis_request",
        message: "Student, subject, and date are required."
      });
    }

    pool = await getPool();
    if (await isServiceExpired(pool, request.user.sub)) {
      return response.status(403).json({
        error: "service_expired",
        message: "이용기간이 만료되어 AI 분석을 사용할 수 없습니다."
      });
    }
    const childId = requestedChildId || await getTeacherChildId(pool, request.user.sub, childName);
    if (!childId) {
      return response.status(404).json({
        error: "child_not_found",
        message: "Student was not found."
      });
    }

    analysisTarget = {
      userId: request.user.sub,
      childId,
      bookId: subjectId,
      studyDate: date
    };
    const attachments = await getAttachmentRows(pool, analysisTarget);
    if (!attachments.length) {
      return response.status(404).json({
        error: "attachments_not_found",
        message: "No attachments were found for this study entry."
      });
    }

    await updateEntryAiAnalysisWithRetry(analysisTarget, "analyzing", "");

    const resultText = await analyzeImagesWithOpenAI({
      attachments,
      childName,
      studyDate: date
    });
    const analysis = await updateEntryAiAnalysisWithRetry(analysisTarget, "completed", resultText);
    const updatedAttachments = await getAttachmentListWithRetry(analysisTarget);

    return response.json({
      ok: true,
      aiStatus: analysis.aiStatus,
      aiResult: analysis.aiResult,
      aiAnalyzedAt: analysis.aiAnalyzedAt,
      analysis,
      attachments: updatedAttachments
    });

    /*
    await Promise.all(attachments.map((attachment) => updateEntryAttachmentAiResult(pool, {
      ...analysisTarget,
      attachmentId: attachment.id,
      status: "analyzing",
      resultText: ""
    })));

    const analyzedAttachments = [];
    for (const [index, attachment] of attachments.entries()) {
      try {
        const resultText = await analyzeImagesWithOpenAI({
          attachments: [attachment],
          childName,
          studyDate: date,
          attachmentIndex: index + 1
        });
        const updatedRows = await updateEntryAttachmentAiResult(pool, {
          ...analysisTarget,
          attachmentId: attachment.id,
          status: "completed",
          resultText
        });
        const updatedAttachment = updatedRows.find((item) => item.id === String(attachment.id));
        if (updatedAttachment) analyzedAttachments.push(updatedAttachment);
      } catch (error) {
        const updatedRows = await updateEntryAttachmentAiResult(pool, {
          ...analysisTarget,
          attachmentId: attachment.id,
          status: "failed",
          resultText: error.publicMessage || error.message || "AI 遺꾩꽍???ㅽ뙣?덉뒿?덈떎."
        });
        const updatedAttachment = updatedRows.find((item) => item.id === String(attachment.id));
        if (updatedAttachment) analyzedAttachments.push(updatedAttachment);
      }
    }
    const legacyUpdatedAttachments = await getAttachmentList(pool, analysisTarget);
    const hasCompleted = legacyUpdatedAttachments.some((attachment) => attachment.aiStatus === "completed");

    response.json({
      ok: true,
      aiStatus: hasCompleted ? "completed" : "failed",
      attachments: legacyUpdatedAttachments,
      analyzedAttachments
    });
    */
  } catch (error) {
    if (pool && analysisTarget) {
      await updateEntryAiAnalysisWithRetry({
        ...analysisTarget,
        status: "failed",
        resultText: error.publicMessage || error.message || "AI 분석에 실패했습니다."
      }, "failed", error.publicMessage || error.message || "AI 분석에 실패했습니다.").catch(() => {});
    }
    next(error);
  }
});

router.delete("/:id", requireAuth, requireStudent, async (request, response, next) => {
  try {
    const pool = await getPool();
    const result = await pool.request()
      .input("id", sql.UniqueIdentifier, request.params.id)
      .input("user_id", sql.UniqueIdentifier, request.user.teacherUserId)
      .input("child_id", sql.UniqueIdentifier, request.user.childId)
      .execute("dbo.app_delete_study_entry_attachment");
    const file = result.recordset[0];

    if (!file) {
      const existing = await pool.request()
        .input("id", sql.UniqueIdentifier, request.params.id)
        .input("user_id", sql.UniqueIdentifier, request.user.teacherUserId)
        .input("child_id", sql.UniqueIdentifier, request.user.childId)
        .execute("dbo.app_get_study_entry_attachment_file");
      if (existing.recordset[0]) {
        return response.status(409).json({
          error: "attachment_locked",
          message: "Teacher has already reviewed this attachment."
        });
      }
      return response.status(404).json({
        error: "attachment_not_found",
        message: "Attachment was not found."
      });
    }

    const filePath = path.resolve(uploadRoot, file.filePath);
    if (filePath.startsWith(`${uploadRoot}${path.sep}`)) {
      fs.promises.unlink(filePath).catch(() => {});
    }

    response.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

router.get("/:id/file", requireAuth, async (request, response, next) => {
  try {
    const pool = await getPool();
    const userId = request.user.role === "student" ? request.user.teacherUserId : request.user.sub;
    const childId = request.user.role === "student" ? request.user.childId : null;
    const result = await pool.request()
      .input("id", sql.UniqueIdentifier, request.params.id)
      .input("user_id", sql.UniqueIdentifier, userId)
      .input("child_id", sql.UniqueIdentifier, childId)
      .execute("dbo.app_get_study_entry_attachment_file");
    const file = result.recordset[0];

    if (!file) {
      return response.status(404).json({
        error: "attachment_not_found",
        message: "Attachment was not found."
      });
    }

    const filePath = path.resolve(uploadRoot, file.filePath);
    if (!filePath.startsWith(`${uploadRoot}${path.sep}`) || !fs.existsSync(filePath)) {
      return response.status(404).json({
        error: "attachment_file_not_found",
        message: "Attachment file was not found."
      });
    }

    response.type(file.mimeType || "application/octet-stream");
    response.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(file.originalName || "attachment")}`);
    response.sendFile(filePath);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
