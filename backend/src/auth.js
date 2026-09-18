const jwt = require("jsonwebtoken");

function signUser(payload) {
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: "12h" });
}

function requireAuth(roles = []) {
  return (req, res, next) => {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: "Sign in required" });
    try {
      const user = jwt.verify(token, process.env.JWT_SECRET);
      if (roles.length && !roles.includes(user.role)) {
        return res.status(403).json({ error: "Not allowed" });
      }
      req.user = user;
      next();
    } catch {
      return res.status(401).json({ error: "Session expired" });
    }
  };
}

module.exports = { signUser, requireAuth };
