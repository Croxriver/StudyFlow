const path = require("path");
const express = require("express");
const cors = require("cors");
require("dotenv").config();
require("dotenv").config({ path: path.join(__dirname, "..", ".enc"), override: true });

const authRoutes = require("./routes/auth");
const attachmentRoutes = require("./routes/attachments");
const pushRoutes = require("./routes/push");
const stateRoutes = require("./routes/state");
const studentRoutes = require("./routes/student");

const app = express();
const port = Number(process.env.PORT || 5188);
const rootDir = path.join(__dirname, "..");
const uploadsDir = path.join(rootDir, "uploads");

app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_request, response) => {
  response.json({
    ok: true,
    service: "studyflow-api",
    environment: process.env.NODE_ENV || "development"
  });
});

app.use("/api/uploads", express.static(uploadsDir));

app.use("/api/auth", authRoutes);
app.use("/api/attachments", attachmentRoutes);
app.use("/api/push", pushRoutes);
app.use("/api/state", stateRoutes);
app.use("/api/student", studentRoutes);

app.use(express.static(rootDir, {
  extensions: ["html"]
}));

app.get(/^\/(?!api).*/, (_request, response) => {
  response.sendFile(path.join(rootDir, "index.html"));
});

function getPublicError(error) {
  if (error?.name === "MulterError" || /Only jpg, png, and webp/.test(error?.message || "")) {
    return {
      status: 400,
      error: "invalid_upload",
      message: error.message || "Invalid upload request."
    };
  }

  if (error?.publicMessage) {
    return {
      status: error.status || 500,
      error: "request_failed",
      message: error.publicMessage
    };
  }

  if (error?.name === "ConnectionError" || /로그인하지 못했습니다|Login failed/i.test(error?.message || "")) {
    return {
      status: 503,
      error: "database_connection_failed",
      message: "데이터베이스에 연결하지 못했습니다. 서버의 SQL 계정 정보를 확인하세요."
    };
  }

  return {
    status: 500,
    error: "internal_server_error",
    message: "Unexpected server error."
  };
}

app.use((error, _request, response, _next) => {
  console.error(error);
  if (error?.innopayCancelAttempts) {
    console.error("InnoPay cancel attempts", error.innopayCancelAttempts);
  }
  const publicError = getPublicError(error);
  response.status(publicError.status).json({
    error: publicError.error,
    message: publicError.message
  });
});

app.listen(port, "127.0.0.1", () => {
  console.log(`Study manager API running at http://127.0.0.1:${port}`);
});
