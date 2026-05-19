const path = require("path");
const express = require("express");
const cors = require("cors");
require("dotenv").config();

const authRoutes = require("./routes/auth");
const stateRoutes = require("./routes/state");
const studentRoutes = require("./routes/student");

const app = express();
const port = Number(process.env.PORT || 5188);
const rootDir = path.join(__dirname, "..");

app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_request, response) => {
  response.json({
    ok: true,
    service: "studyflow-api",
    environment: process.env.NODE_ENV || "development"
  });
});

app.use("/api/auth", authRoutes);
app.use("/api/state", stateRoutes);
app.use("/api/student", studentRoutes);

app.use(express.static(rootDir, {
  extensions: ["html"]
}));

app.get(/^\/(?!api).*/, (_request, response) => {
  response.sendFile(path.join(rootDir, "index.html"));
});

app.use((error, _request, response, _next) => {
  console.error(error);
  response.status(500).json({
    error: "internal_server_error",
    message: "Unexpected server error."
  });
});

app.listen(port, "127.0.0.1", () => {
  console.log(`Study manager API running at http://127.0.0.1:${port}`);
});
