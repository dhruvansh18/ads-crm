const express = require("express");
const bcrypt = require("bcryptjs");
const db = require("../db");
const { requireRole } = require("../auth");
const { logActivity } = require("../activityLog");

const ROLES = ["admin", "sales", "social", "designer"];
const CLIENT_SCOPED_ROLES = ["social", "designer"]; // roles that get assigned to specific clients

const router = express.Router();
router.use(requireRole("admin"));

function clientsFor(userId) {
  return db
    .prepare(
      `SELECT clients.id, clients.name FROM user_clients
       JOIN clients ON clients.id = user_clients.client_id
       WHERE user_clients.user_id = ? ORDER BY clients.name`
    )
    .all(userId);
}

function publicUser(u) {
  return { id: u.id, name: u.name, email: u.email, role: u.role, created_at: u.created_at, clients: clientsFor(u.id) };
}

function setClientAssignments(userId, clientIds) {
  if (!Array.isArray(clientIds)) return;
  const tx = db.transaction((ids) => {
    db.prepare("DELETE FROM user_clients WHERE user_id = ?").run(userId);
    const insert = db.prepare("INSERT OR IGNORE INTO user_clients (user_id, client_id) VALUES (?,?)");
    ids.forEach((cid) => {
      const n = Number(cid);
      if (n) insert.run(userId, n);
    });
  });
  tx(clientIds);
}

router.get("/", (req, res) => {
  const rows = db.prepare("SELECT * FROM users ORDER BY created_at").all();
  res.json(rows.map(publicUser));
});

router.post("/", (req, res) => {
  const name = String(req.body.name || "").trim();
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  const role = String(req.body.role || "");
  if (!name || !email || !password || !ROLES.includes(role)) {
    return res.status(400).json({ error: "invalid_input" });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: "password_too_short" });
  }
  const existing = db.prepare("SELECT id FROM users WHERE lower(email) = ?").get(email);
  if (existing) return res.status(409).json({ error: "email_in_use" });

  const hash = bcrypt.hashSync(password, 10);
  const info = db
    .prepare("INSERT INTO users (name, email, password_hash, role) VALUES (?,?,?,?)")
    .run(name, email, hash, role);
  if (CLIENT_SCOPED_ROLES.includes(role)) setClientAssignments(info.lastInsertRowid, req.body.client_ids || []);
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(info.lastInsertRowid);
  logActivity(req, { action: "create", entityType: "user", entityId: user.id, summary: `${req.session.name} added teammate "${user.name}" (${role})` });
  res.status(201).json(publicUser(user));
});

router.patch("/:id", (req, res) => {
  const id = Number(req.params.id);
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(id);
  if (!user) return res.status(404).json({ error: "not_found" });

  const name = req.body.name !== undefined ? String(req.body.name).trim() : user.name;
  const role = req.body.role !== undefined ? String(req.body.role) : user.role;
  if (!ROLES.includes(role)) {
    return res.status(400).json({ error: "invalid_role" });
  }
  if (user.role === "admin" && role !== "admin") {
    const adminCount = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").get().n;
    if (adminCount <= 1) return res.status(400).json({ error: "last_admin" });
  }

  if (req.body.password) {
    if (String(req.body.password).length < 6) {
      return res.status(400).json({ error: "password_too_short" });
    }
    const password_hash = bcrypt.hashSync(String(req.body.password), 10);
    db.prepare("UPDATE users SET name=@name, role=@role, password_hash=@password_hash WHERE id=@id").run({ name, role, password_hash, id });
  } else {
    db.prepare("UPDATE users SET name=@name, role=@role WHERE id=@id").run({ name, role, id });
  }

  if (CLIENT_SCOPED_ROLES.includes(role)) {
    if (req.body.client_ids !== undefined) setClientAssignments(id, req.body.client_ids || []);
  } else {
    // clients only make sense for social/designer roles — clear any stale assignment
    setClientAssignments(id, []);
  }

  const updated = db.prepare("SELECT * FROM users WHERE id = ?").get(id);
  logActivity(req, { action: "update", entityType: "user", entityId: updated.id, summary: `${req.session.name} updated teammate "${updated.name}"` });
  res.json(publicUser(updated));
});

router.delete("/:id", (req, res) => {
  const id = Number(req.params.id);
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(id);
  if (!user) return res.status(404).json({ error: "not_found" });
  if (id === req.session.userId) return res.status(400).json({ error: "cannot_delete_self" });
  if (user.role === "admin") {
    const adminCount = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").get().n;
    if (adminCount <= 1) return res.status(400).json({ error: "last_admin" });
  }
  db.prepare("DELETE FROM users WHERE id = ?").run(id);
  logActivity(req, { action: "delete", entityType: "user", entityId: id, summary: `${req.session.name} removed teammate "${user.name}"` });
  res.json({ ok: true });
});

module.exports = router;
