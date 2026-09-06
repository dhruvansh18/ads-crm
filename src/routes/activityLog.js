const express = require("express");
const db = require("../db");
const { requireRole } = require("../auth");

const router = express.Router();
router.use(requireRole("admin"));

// Distinct actors/actions/entity types seen in the log so far, for the filter
// dropdowns on the frontend — cheap to compute, no need to hardcode a list
// that could drift from what's actually been logged.
router.get("/filters", (req, res) => {
  const actors = db
    .prepare("SELECT DISTINCT actor_id, actor_name FROM activity_log WHERE actor_id IS NOT NULL ORDER BY actor_name")
    .all();
  const actions = db.prepare("SELECT DISTINCT action FROM activity_log ORDER BY action").all().map((r) => r.action);
  const entityTypes = db.prepare("SELECT DISTINCT entity_type FROM activity_log ORDER BY entity_type").all().map((r) => r.entity_type);
  res.json({ actors, actions, entityTypes });
});

router.get("/", (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  const q = req.query || {};

  const where = [];
  const params = [];
  if (q.actor_id) { where.push("actor_id = ?"); params.push(Number(q.actor_id)); }
  if (q.action) { where.push("action = ?"); params.push(String(q.action)); }
  if (q.entity_type) { where.push("entity_type = ?"); params.push(String(q.entity_type)); }
  if (q.from) { where.push("date(created_at) >= date(?)"); params.push(String(q.from)); }
  if (q.to) { where.push("date(created_at) <= date(?)"); params.push(String(q.to)); }
  const whereSql = where.length ? "WHERE " + where.join(" AND ") : "";

  const rows = db
    .prepare(`SELECT * FROM activity_log ${whereSql} ORDER BY id DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset);
  const total = db.prepare(`SELECT COUNT(*) AS n FROM activity_log ${whereSql}`).get(...params).n;
  res.json({ rows, total, limit, offset });
});

module.exports = router;
