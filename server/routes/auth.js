const express = require("express");
const bcrypt = require("bcrypt");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { getPool, sql } = require("../db");
const { requireAuth, requireTeacher } = require("../middleware/auth");

const router = express.Router();
const PHONE_CODE_TTL_MS = 5 * 60 * 1000;
const PHONE_TOKEN_TTL_MS = 10 * 60 * 1000;
const EMAIL_CODE_TTL_MS = 5 * 60 * 1000;
const EMAIL_TOKEN_TTL_MS = 10 * 60 * 1000;
const phoneVerificationCodes = new Map();
const phoneVerificationTokens = new Map();
const emailVerificationCodes = new Map();
const emailVerificationTokens = new Map();

function normalizePhone(phone) {
  return String(phone || "").replace(/\D/g, "");
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
	return process.env.NODE_ENV !== "production" || process.env.SMS_PROVIDER !== "enabled";
}

function isValidEmail(email) {
	return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || ""));
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

router.post("/signup", async (request, response, next) => {
  try {
		const { email, password, name, phone = "", phoneVerificationToken = "", emailVerificationToken = "", marketingConsent = false } = request.body || {};
		const normalizedEmail = String(email || "").trim().toLowerCase();
		const normalizedPhone = normalizePhone(phone);

    if (!normalizedEmail || !password || !name || !normalizedPhone) {
      return response.status(400).json({
        error: "invalid_signup_request",
        message: "이메일, 비밀번호, 이름, 휴대폰 인증 정보가 필요합니다."
      });
    }

    cleanupPhoneVerifications();
    const verifiedPhone = phoneVerificationTokens.get(String(phoneVerificationToken || ""));
		if (!verifiedPhone || verifiedPhone.phone !== normalizedPhone) {
			return response.status(400).json({
				error: "phone_verification_required",
				message: "휴대폰 인증을 먼저 완료하세요."
			});
		}
		const verifiedEmail = emailVerificationTokens.get(String(emailVerificationToken || ""));
		if (!verifiedEmail || verifiedEmail.email !== normalizedEmail) {
			return response.status(400).json({
				error: "email_verification_required",
				message: "이메일 인증을 먼저 완료하세요."
			});
		}

    const pool = await getPool();
    const existing = await pool.request()
      .input("email", sql.NVarChar(255), normalizedEmail)
      .execute("dbo.app_get_user_by_email");

    if (existing.recordset.length) {
      return response.status(409).json({
        error: "email_already_exists",
        message: "이미 가입된 이메일입니다."
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
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        phone: user.phone,
        marketingConsent: Boolean(user.marketingConsent),
        role: "teacher"
      }
    });
  } catch (error) {
    next(error);
  }
});

router.post("/signup/phone-code", async (request, response) => {
  const phone = normalizePhone(request.body?.phone);

  if (!/^01\d{8,9}$/.test(phone)) {
    return response.status(400).json({
      error: "invalid_phone",
      message: "휴대폰 번호를 정확히 입력하세요."
    });
  }

  cleanupPhoneVerifications();
  const code = createVerificationCode();
  phoneVerificationCodes.set(phone, {
    code,
    expiresAt: Date.now() + PHONE_CODE_TTL_MS
  });

  response.json({
    ok: true,
    expiresInSeconds: Math.floor(PHONE_CODE_TTL_MS / 1000),
    ...(shouldReturnDevVerificationCode() ? { verificationCode: code } : {})
  });
});

router.post("/signup/verify-phone", async (request, response) => {
  const phone = normalizePhone(request.body?.phone);
  const code = String(request.body?.code || "").trim();

  cleanupPhoneVerifications();
  const verification = phoneVerificationCodes.get(phone);
  if (!verification || verification.code !== code) {
    return response.status(400).json({
      error: "invalid_phone_code",
      message: "인증번호가 올바르지 않거나 만료되었습니다."
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
				message: "이메일 주소를 정확히 입력하세요."
			});
		}

		const pool = await getPool();
		const existing = await pool.request()
			.input("email", sql.NVarChar(255), email)
			.execute("dbo.app_get_user_by_email");

		if (existing.recordset.length) {
			return response.status(409).json({
				error: "email_already_exists",
				message: "이미 가입된 이메일입니다."
			});
		}

		cleanupPhoneVerifications();
		const code = createVerificationCode();
		emailVerificationCodes.set(email, {
			code,
			expiresAt: Date.now() + EMAIL_CODE_TTL_MS
		});

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
	if (!verification || verification.code !== code) {
		return response.status(400).json({
			error: "invalid_email_code",
			message: "이메일 인증번호가 올바르지 않거나 만료되었습니다."
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

    response.json({
      token: createToken(user),
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        phone: user.phone,
        marketingConsent: Boolean(user.marketingConsent),
        role: "teacher"
      }
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

router.post("/reset-password", async (request, response, next) => {
  try {
    const { email, name, phone = "", password } = request.body || {};
    const normalizedEmail = String(email || "").trim().toLowerCase();
    const normalizedName = String(name || "").trim();
    const normalizedPassword = String(password || "");

    if (!normalizedEmail || !normalizedName || normalizedPassword.length < 4) {
      return response.status(400).json({
        error: "invalid_reset_request",
        message: "Email, name, and a new password are required."
      });
    }

    const passwordHash = await bcrypt.hash(normalizedPassword, 12);
    const pool = await getPool();
    const result = await pool.request()
      .input("email", sql.NVarChar(255), normalizedEmail)
      .input("name", sql.NVarChar(100), normalizedName)
      .input("phone", sql.NVarChar(30), String(phone || "").trim() || null)
      .input("password_hash", sql.NVarChar(255), passwordHash)
      .execute("dbo.app_reset_user_password");
    const reset = result.recordset[0];

    if (!reset?.ok) {
      return response.status(404).json({
        error: "reset_verification_failed",
        message: "Account information did not match."
      });
    }

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
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        phone: user.phone,
        marketingConsent: Boolean(user.marketingConsent),
        role: "teacher"
      }
    });
  } catch (error) {
    next(error);
  }
});

router.post("/profile/phone-code", requireAuth, requireTeacher, async (request, response) => {
  const phone = normalizePhone(request.body?.phone);

  if (!/^01\d{8,9}$/.test(phone)) {
    return response.status(400).json({
      error: "invalid_phone",
      message: "휴대폰 번호를 정확히 입력하세요."
    });
  }

  cleanupPhoneVerifications();
  const code = createVerificationCode();
  phoneVerificationCodes.set(phone, {
    code,
    expiresAt: Date.now() + PHONE_CODE_TTL_MS
  });

  response.json({
    ok: true,
    expiresInSeconds: Math.floor(PHONE_CODE_TTL_MS / 1000),
    ...(shouldReturnDevVerificationCode() ? { verificationCode: code } : {})
  });
});

router.post("/profile/verify-phone", requireAuth, requireTeacher, async (request, response) => {
  const phone = normalizePhone(request.body?.phone);
  const code = String(request.body?.code || "").trim();

  cleanupPhoneVerifications();
  const verification = phoneVerificationCodes.get(phone);
  if (!verification || verification.code !== code) {
    return response.status(400).json({
      error: "invalid_phone_code",
      message: "인증번호가 올바르지 않거나 만료되었습니다."
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

router.put("/profile", requireAuth, requireTeacher, async (request, response, next) => {
  try {
    const { name, phone = "", phoneVerificationToken = "", marketingConsent = false, password = "" } = request.body || {};
    const normalizedPhone = normalizePhone(phone);

    if (!String(name || "").trim()) {
      return response.status(400).json({
        error: "invalid_profile_request",
        message: "이름을 입력하세요."
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
          message: "변경할 휴대폰 번호를 인증하세요."
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
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        phone: user.phone,
        marketingConsent: Boolean(user.marketingConsent),
        role: "teacher"
      }
    });
    if (normalizedPhone && normalizedPhone !== currentPhone) {
      phoneVerificationTokens.delete(String(phoneVerificationToken || ""));
    }
  } catch (error) {
    next(error);
  }
});

module.exports = router;
