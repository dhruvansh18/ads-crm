const express = require("express");
const bcrypt = require("bcryptjs");
const db = require("../db");
const { requireAuth } = require("../auth");
const { logActivity } = require("../activityLog");

const router = express.Router();

function publicUser(u) {
  if (!u) return null;
  return { id: u.id, name: u.name, email: u.email, role: u.role };
}

router.post("/login", (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  if (!email || !password) {
    return res.status(400).json({ error: "missing_credentials" });
  }
  const user = db.prepare("SELECT * FROM users WHERE lower(email) = ?").get(email);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: "invalid_credentials" });
  }
  req.session.userId = user.id;
  req.session.role = user.role;
  req.session.name = user.name;
  logActivity(req, { action: "login", entityType: "user", entityId: user.id, summary: `${user.name} signed in` });
  res.json(publicUser(user));
});

router.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("connect.sid");
    res.json({ ok: true });
  });
});

router.get("/me", requireAuth, (req, res) => {
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.session.userId);
  if (!user) return res.status(401).json({ error: "not_authenticated" });
  res.json(publicUser(user));
});

router.patch("/password", requireAuth, (req, res) => {
  const current = String(req.body.current_password || "");
  const next = String(req.body.new_password || "");
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.session.userId);
  if (!user) return res.status(401).json({ error: "not_authenticated" });
  if (!bcrypt.compareSync(current, user.password_hash)) {
    return res.status(400).json({ error: "wrong_current_password" });
  }
  if (next.length < 6) {
    return res.status(400).json({ error: "password_too_short" });
  }
  const hash = bcrypt.hashSync(next, 10);
  db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hash, user.id);
  logActivity(req, {
    action: "update",
    entityType: "user",
    entityId: user.id,
    summary: `${user.name} changed their own password`,
  });
  res.json({ ok: true });
});

module.exports = router;
