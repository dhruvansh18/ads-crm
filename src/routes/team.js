const express = require("express");
const db = require("../db");
const { requireAuth } = require("../auth");

const router = express.Router();

// Lightweight roster (id/name/role only) any authenticated user can read —
// used to populate "owner" pickers on deals/contacts/content.
router.get("/", requireAuth, (req, res) => {
  const rows = db.prepare("SELECT id, name, role FROM users ORDER BY name").all();
  res.json(rows);
});

module.exports = router;
