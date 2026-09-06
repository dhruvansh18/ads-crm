const express = require("express");
const db = require("../db");
const { requireAuth, requireRole } = require("../auth");
const { logActivity } = require("../activityLog");

const router = express.Router();
router.use(requireAuth);

const PALETTE = ["#eda100", "#2a78d6", "#eb6834", "#1baf7a", "#e87ba4", "#4a3aa7", "#008300", "#e34948"];

function slugify(label, existingKeys) {
  var base = String(label).toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "status";
  var key = base;
  var n = 2;
  while (existingKeys.has(key)) { key = base + "_" + n; n++; }
  return key;
}

router.get("/", (req, res) => {
  res.json(db.prepare("SELECT * FROM content_statuses ORDER BY sort_order").all());
});

router.post("/", requireRole("admin"), (req, res) => {
  const label = String(req.body.label || "").trim();
  if (!label) return res.status(400).json({ error: "label_required" });
  const existing = db.prepare("SELECT key FROM content_statuses").all();
  const existingKeys = new Set(existing.map((r) => r.key));
  const key = slugify(label, existingKeys);
  const maxOrder = db.prepare("SELECT COALESCE(MAX(sort_order),0) AS n FROM content_statuses").get().n;
  const color = PALETTE[maxOrder % PALETTE.length];
  db.prepare("INSERT INTO content_statuses (key, label, color, sort_order) VALUES (?,?,?,?)").run(key, label, color, maxOrder + 1);
  logActivity(req, { action: "create", entityType: "content_status", entityId: null, summary: `${req.session.name} added status "${label}"` });
  res.status(201).json(db.prepare("SELECT * FROM content_statuses WHERE key = ?").get(key));
});

router.patch("/:key", requireRole("admin"), (req, res) => {
  const key = req.params.key;
  const existing = db.prepare("SELECT * FROM content_statuses WHERE key = ?").get(key);
  if (!existing) return res.status(404).json({ error: "not_found" });
  const label = req.body.label !== undefined ? String(req.body.label).trim() : existing.label;
  if (!label) return res.status(400).json({ error: "label_required" });
  const color = req.body.color !== undefined ? req.body.color : existing.color;
  db.prepare("UPDATE content_statuses SET label=?, color=? WHERE key=?").run(label, color, key);
  logActivity(req, { action: "update", entityType: "content_status", entityId: null, summary: `${req.session.name} updated status "${label}"` });
  res.json(db.prepare("SELECT * FROM content_statuses WHERE key = ?").get(key));
});

router.delete("/:key", requireRole("admin"), (req, res) => {
  const key = req.params.key;
  const existing = db.prepare("SELECT * FROM content_statuses WHERE key = ?").get(key);
  if (!existing) return res.status(404).json({ error: "not_found" });
  const total = db.prepare("SELECT COUNT(*) AS n FROM content_statuses").get().n;
  if (total <= 1) return res.status(400).json({ error: "last_status" });

  const fallback = db.prepare("SELECT key FROM content_statuses WHERE key != ? ORDER BY sort_order LIMIT 1").get(key);
  const affected = db.prepare("SELECT COUNT(*) AS n FROM content_posts WHERE status = ?").get(key).n;
  if (affected > 0) {
    db.prepare("UPDATE content_posts SET status = ? WHERE status = ?").run(fallback.key, key);
  }
  db.prepare("DELETE FROM content_statuses WHERE key = ?").run(key);
  logActivity(req, { action: "delete", entityType: "content_status", entityId: null, summary: `${req.session.name} deleted status "${existing.label}"${affected ? ` (${affected} post(s) moved to ${fallback.key})` : ""}` });
  res.json({ ok: true, reassigned: affected, reassignedTo: fallback.key });
});

module.exports = router;
