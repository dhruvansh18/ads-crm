const express = require("express");
const db = require("../db");
const { requireAuth, requireRole } = require("../auth");
const { logActivity } = require("../activityLog");

const router = express.Router();
router.use(requireAuth);

function handlersFor(clientId) {
  return db
    .prepare(
      `SELECT users.id, users.name FROM user_clients
       JOIN users ON users.id = user_clients.user_id
       WHERE user_clients.client_id = ? ORDER BY users.name`
    )
    .all(clientId);
}

// Admin sees every client (with who handles each). Everyone else sees only
// the clients assigned to them.
router.get("/", (req, res) => {
  let clients;
  if (req.session.role === "admin") {
    clients = db.prepare("SELECT * FROM clients ORDER BY name").all();
  } else {
    clients = db
      .prepare(
        `SELECT clients.* FROM clients
         JOIN user_clients ON user_clients.client_id = clients.id
         WHERE user_clients.user_id = ? ORDER BY clients.name`
      )
      .all(req.session.userId);
  }
  res.json(clients.map((c) => ({ ...c, handlers: handlersFor(c.id) })));
});

router.post("/", requireRole("admin"), (req, res) => {
  const name = String(req.body.name || "").trim();
  if (!name) return res.status(400).json({ error: "name_required" });
  const info = db.prepare("INSERT INTO clients (name, notes) VALUES (?,?)").run(name, req.body.notes || "");
  const row = db.prepare("SELECT * FROM clients WHERE id = ?").get(info.lastInsertRowid);
  logActivity(req, { action: "create", entityType: "client", entityId: row.id, summary: `${req.session.name} added client "${row.name}"` });
  res.status(201).json({ ...row, handlers: [] });
});

router.patch("/:id", requireRole("admin"), (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare("SELECT * FROM clients WHERE id = ?").get(id);
  if (!existing) return res.status(404).json({ error: "not_found" });
  const name = req.body.name !== undefined ? String(req.body.name).trim() : existing.name;
  if (!name) return res.status(400).json({ error: "name_required" });
  const notes = req.body.notes !== undefined ? req.body.notes : existing.notes;
  db.prepare("UPDATE clients SET name=?, notes=? WHERE id=?").run(name, notes, id);
  const row = db.prepare("SELECT * FROM clients WHERE id = ?").get(id);
  logActivity(req, { action: "update", entityType: "client", entityId: row.id, summary: `${req.session.name} updated client "${row.name}"` });
  res.json({ ...row, handlers: handlersFor(id) });
});

router.delete("/:id", requireRole("admin"), (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare("SELECT * FROM clients WHERE id = ?").get(id);
  if (!existing) return res.status(404).json({ error: "not_found" });
  db.prepare("DELETE FROM clients WHERE id = ?").run(id); // cascades user_clients; content_posts.client_id -> NULL
  logActivity(req, { action: "delete", entityType: "client", entityId: id, summary: `${req.session.name} deleted client "${existing.name}"` });
  res.json({ ok: true });
});

module.exports = router;
