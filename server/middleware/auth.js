const jwt = require("jsonwebtoken");

function requireAuth(request, response, next) {
  const header = request.get("authorization") || "";
  const [scheme, token] = header.split(" ");

  if (scheme !== "Bearer" || !token) {
    return response.status(401).json({
      error: "missing_token",
      message: "Authentication token is required."
    });
  }

  try {
    const secret = process.env.JWT_SECRET || "development-secret";
    request.user = jwt.verify(token, secret);
    next();
  } catch {
    response.status(401).json({
      error: "invalid_token",
      message: "Authentication token is invalid or expired."
    });
  }
}

function requireRole(role) {
  return (request, response, next) => {
    if (role === "teacher" && !request.user?.role) {
      return next();
    }

    if (request.user?.role !== role) {
      return response.status(403).json({
        error: "forbidden",
        message: "You do not have access to this resource."
      });
    }

    next();
  };
}

module.exports = {
  requireAuth,
  requireTeacher: requireRole("teacher"),
  requireStudent: requireRole("student")
};
