const express = require("express");
const db = require("../db");
const { requireAuth, requireRole } = require("../auth");
const { logActivity } = require("../activityLog");

const router = express.Router();
router.use(requireAuth);

const SELECT = `
  SELECT deals.*, contacts.name AS contact_name, contacts.company AS company
  FROM deals LEFT JOIN contacts ON contacts.id = deals.contact_id
`;

router.get("/", (req, res) => {
  const rows = db.prepare(SELECT + " ORDER BY deals.updated_at DESC").all();
  res.json(rows);
});

router.post("/", requireRole("admin", "sales"), (req, res) => {
  const b = req.body || {};
  const title = String(b.title || "").trim();
  if (!title) return res.status(400).json({ error: "title_required" });

  const info = db
    .prepare(
      `INSERT INTO deals (title, contact_id, value, stage, close_date, owner_id, notes, updated_at)
       VALUES (@title,@contact_id,@value,@stage,@close_date,@owner_id,@notes, datetime('now'))`
    )
    .run({
      title,
      contact_id: b.contact_id || null,
      value: Number(b.value) || 0,
      stage: b.stage || "new",
      close_date: b.close_date || "",
      owner_id: b.owner_id || req.session.userId,
      notes: b.notes || "",
    });
  const row = db.prepare(SELECT + " WHERE deals.id = ?").get(info.lastInsertRowid);
  logActivity(req, { action: "create", entityType: "deal", entityId: row.id, summary: `${req.session.name} created deal "${row.title}"` });
  res.status(201).json(row);
});

router.patch("/:id", requireRole("admin", "sales"), (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare("SELECT * FROM deals WHERE id = ?").get(id);
  if (!existing) return res.status(404).json({ error: "not_found" });
  const b = req.body || {};
  const merged = {
    title: b.title !== undefined ? String(b.title).trim() : existing.title,
    contact_id: b.contact_id !== undefined ? b.contact_id : existing.contact_id,
    value: b.value !== undefined ? Number(b.value) || 0 : existing.value,
    stage: b.stage !== undefined ? b.stage : existing.stage,
    close_date: b.close_date !== undefined ? b.close_date : existing.close_date,
    owner_id: b.owner_id !== undefined ? b.owner_id : existing.owner_id,
    notes: b.notes !== undefined ? b.notes : existing.notes,
  };
  if (!merged.title) return res.status(400).json({ error: "title_required" });
  db.prepare(
    `UPDATE deals SET title=@title, contact_id=@contact_id, value=@value, stage=@stage,
     close_date=@close_date, owner_id=@owner_id, notes=@notes, updated_at=datetime('now') WHERE id=@id`
  ).run({ ...merged, id });
  const row = db.prepare(SELECT + " WHERE deals.id = ?").get(id);
  const summary = merged.stage !== existing.stage
    ? `${req.session.name} moved deal "${row.title}" to ${merged.stage}`
    : `${req.session.name} updated deal "${row.title}"`;
  logActivity(req, { action: "update", entityType: "deal", entityId: row.id, summary });
  res.json(row);
});

router.delete("/:id", requireRole("admin", "sales"), (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare("SELECT * FROM deals WHERE id = ?").get(id);
  if (!existing) return res.status(404).json({ error: "not_found" });
  db.prepare("DELETE FROM deals WHERE id = ?").run(id);
  logActivity(req, { action: "delete", entityType: "deal", entityId: id, summary: `${req.session.name} deleted deal "${existing.title}"` });
  res.json({ ok: true });
});

module.exports = router;
