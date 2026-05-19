const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { getPool, sql } = require("../db");
const { requireAuth, requireTeacher } = require("../middleware/auth");

const router = express.Router();

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
    const { email, password, name, phone = "", marketingConsent = false } = request.body || {};
    const normalizedEmail = String(email || "").trim().toLowerCase();

    if (!normalizedEmail || !password || !name) {
      return response.status(400).json({
        error: "invalid_signup_request",
        message: "Email, password, and name are required."
      });
    }

    const pool = await getPool();
    const existing = await pool.request()
      .input("email", sql.NVarChar(255), normalizedEmail)
      .execute("dbo.app_get_user_by_email");

    if (existing.recordset.length) {
      return response.status(409).json({
        error: "email_already_exists",
        message: "This email is already registered."
      });
    }

    const passwordHash = await bcrypt.hash(String(password), 12);
    const created = await pool.request()
      .input("email", sql.NVarChar(255), normalizedEmail)
      .input("password_hash", sql.NVarChar(255), passwordHash)
      .input("name", sql.NVarChar(100), String(name).trim())
      .input("phone", sql.NVarChar(30), String(phone || "").trim() || null)
      .input("marketing_consent", sql.Bit, Boolean(marketingConsent))
      .execute("dbo.app_create_user");

    const user = created.recordset[0];

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

router.put("/profile", requireAuth, requireTeacher, async (request, response, next) => {
  try {
    const { name, phone = "", marketingConsent = false, password = "" } = request.body || {};

    if (!String(name || "").trim()) {
      return response.status(400).json({
        error: "invalid_profile_request",
        message: "Name is required."
      });
    }

    const passwordHash = String(password || "").trim()
      ? await bcrypt.hash(String(password), 12)
      : null;
    const pool = await getPool();
    const result = await pool.request()
      .input("id", sql.UniqueIdentifier, request.user.sub)
      .input("name", sql.NVarChar(100), String(name).trim())
      .input("phone", sql.NVarChar(30), String(phone || "").trim() || null)
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
  } catch (error) {
    next(error);
  }
});

module.exports = router;
