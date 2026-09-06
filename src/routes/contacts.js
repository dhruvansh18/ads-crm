const express = require("express");
const db = require("../db");
const { requireAuth } = require("../auth");
const { logActivity } = require("../activityLog");

const router = express.Router();
router.use(requireAuth);

function serialize(row) {
  return { ...row, tags: row.tags ? JSON.parse(row.tags) : [] };
}

const SELECT = `
  SELECT contacts.*, users.name AS owner_name
  FROM contacts LEFT JOIN users ON users.id = contacts.owner_id
`;

router.get("/", (req, res) => {
  const rows = db.prepare(SELECT + " ORDER BY contacts.created_at DESC").all();
  res.json(rows.map(serialize));
});

router.post("/", (req, res) => {
  const b = req.body || {};
  const name = String(b.name || "").trim();
  if (!name) return res.status(400).json({ error: "name_required" });

  const info = db
    .prepare(
      `INSERT INTO contacts (name, company, email, phone, source, tags, owner_id, notes)
       VALUES (@name,@company,@email,@phone,@source,@tags,@owner_id,@notes)`
    )
    .run({
      name,
      company: b.company || "",
      email: b.email || "",
      phone: b.phone || "",
      source: b.source || "",
      tags: JSON.stringify(Array.isArray(b.tags) ? b.tags : []),
      owner_id: b.owner_id || req.session.userId,
      notes: b.notes || "",
    });
  const row = db.prepare(SELECT + " WHERE contacts.id = ?").get(info.lastInsertRowid);
  logActivity(req, { action: "create", entityType: "contact", entityId: row.id, summary: `${req.session.name} added contact "${row.name}"` });
  res.status(201).json(serialize(row));
});

router.patch("/:id", (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare("SELECT * FROM contacts WHERE id = ?").get(id);
  if (!existing) return res.status(404).json({ error: "not_found" });
  const b = req.body || {};
  const merged = {
    name: b.name !== undefined ? String(b.name).trim() : existing.name,
    company: b.company !== undefined ? b.company : existing.company,
    email: b.email !== undefined ? b.email : existing.email,
    phone: b.phone !== undefined ? b.phone : existing.phone,
    source: b.source !== undefined ? b.source : existing.source,
    tags: b.tags !== undefined ? JSON.stringify(Array.isArray(b.tags) ? b.tags : []) : existing.tags,
    owner_id: b.owner_id !== undefined ? b.owner_id : existing.owner_id,
    notes: b.notes !== undefined ? b.notes : existing.notes,
  };
  if (!merged.name) return res.status(400).json({ error: "name_required" });
  db.prepare(
    `UPDATE contacts SET name=@name, company=@company, email=@email, phone=@phone,
     source=@source, tags=@tags, owner_id=@owner_id, notes=@notes WHERE id=@id`
  ).run({ ...merged, id });
  const row = db.prepare(SELECT + " WHERE contacts.id = ?").get(id);
  logActivity(req, { action: "update", entityType: "contact", entityId: row.id, summary: `${req.session.name} updated contact "${row.name}"` });
  res.json(serialize(row));
});

router.delete("/:id", (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare("SELECT * FROM contacts WHERE id = ?").get(id);
  if (!existing) return res.status(404).json({ error: "not_found" });
  db.prepare("DELETE FROM contacts WHERE id = ?").run(id);
  logActivity(req, { action: "delete", entityType: "contact", entityId: id, summary: `${req.session.name} deleted contact "${existing.name}"` });
  res.json({ ok: true });
});

module.exports = router;
