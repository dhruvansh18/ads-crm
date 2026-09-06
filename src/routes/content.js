const express = require("express");
const path = require("path");
const fs = require("fs");
const db = require("../db");
const { requireAuth, requireRole } = require("../auth");
const { logActivity } = require("../activityLog");
const { upload, UPLOAD_DIR } = require("../upload");

const router = express.Router();
router.use(requireAuth);

const SELECT = `
  SELECT content_posts.*, users.name AS owner_name, clients.name AS client_name
  FROM content_posts
  LEFT JOIN users ON users.id = content_posts.owner_id
  LEFT JOIN clients ON clients.id = content_posts.client_id
`;

function assignedClientIds(userId) {
  return db.prepare("SELECT client_id FROM user_clients WHERE user_id = ?").all(userId).map((r) => r.client_id);
}

function canTouchClient(req, clientId) {
  if (req.session.role === "admin") return true;
  if (clientId === null || clientId === undefined || clientId === "") return true; // internal / agency post
  return assignedClientIds(req.session.userId).includes(Number(clientId));
}

function scopedRows(req, rows) {
  if (req.session.role === "admin") return rows;
  const allowed = new Set(assignedClientIds(req.session.userId));
  return rows.filter((r) => r.client_id == null || allowed.has(r.client_id));
}

router.get("/", (req, res) => {
  const rows = db.prepare(SELECT + " ORDER BY content_posts.scheduled_date ASC").all();
  res.json(scopedRows(req, rows));
});

/* ====================== notifications (pending review / needs attention) ====================== */
// A post's *latest* creative is the one that matters for notifications — once a
// newer version is uploaded, an old "changes requested" review on a superseded
// file should no longer nag anyone, and an old file that was never reviewed
// stops mattering once it's been replaced.
function latestCreativePerPost() {
  return db
    .prepare(
      `SELECT cc.* FROM content_creatives cc
       INNER JOIN (SELECT post_id, MAX(id) AS max_id FROM content_creatives GROUP BY post_id) latest
         ON latest.max_id = cc.id`
    )
    .all();
}
router.get("/notifications", (req, res) => {
  const posts = db
    .prepare(
      `SELECT content_posts.id, content_posts.title, content_posts.client_id, clients.name AS client_name
       FROM content_posts LEFT JOIN clients ON clients.id = content_posts.client_id`
    )
    .all();
  const postById = {};
  posts.forEach((p) => { postById[p.id] = p; });

  const latestReviewStmt = db.prepare(
    `SELECT creative_reviews.* FROM creative_reviews WHERE creative_id = ? ORDER BY created_at DESC, id DESC LIMIT 1`
  );

  const awaitingReview = [];
  const needsAttention = [];
  latestCreativePerPost().forEach((c) => {
    const post = postById[c.post_id];
    if (!post || !canTouchClient(req, post.client_id)) return;
    const entry = { creative_id: c.id, post_id: c.post_id, filename: c.filename, post_title: post.title, client_name: post.client_name || "Internal / Agency" };
    const latestReview = latestReviewStmt.get(c.id);
    if (!latestReview) awaitingReview.push(entry);
    else if (latestReview.status === "changes_requested") needsAttention.push(entry);
  });

  res.json({ awaitingReview, needsAttention });
});

router.post("/", requireRole("admin", "social"), (req, res) => {
  const b = req.body || {};
  const title = String(b.title || "").trim();
  if (!title) return res.status(400).json({ error: "title_required" });

  const clientId = b.client_id ? Number(b.client_id) : null;
  if (!canTouchClient(req, clientId)) return res.status(403).json({ error: "forbidden" });

  const info = db
    .prepare(
      `INSERT INTO content_posts (title, platform, post_type, status, scheduled_date, client_id, campaign, owner_id, notes, reference_notes, updated_at)
       VALUES (@title,@platform,@post_type,@status,@scheduled_date,@client_id,@campaign,@owner_id,@notes,@reference_notes, datetime('now'))`
    )
    .run({
      title,
      platform: b.platform || "linkedin",
      post_type: b.post_type || "static",
      status: b.status || "shoot_pending",
      scheduled_date: b.scheduled_date || "",
      client_id: clientId,
      campaign: b.campaign || "",
      owner_id: b.owner_id || req.session.userId,
      notes: b.notes || "",
      reference_notes: b.reference_notes || "",
    });
  const row = db.prepare(SELECT + " WHERE content_posts.id = ?").get(info.lastInsertRowid);
  logActivity(req, { action: "create", entityType: "content_post", entityId: row.id, summary: `${req.session.name} scheduled post "${row.title}"` });
  res.status(201).json(row);
});

router.patch("/:id", requireRole("admin", "social"), (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare("SELECT * FROM content_posts WHERE id = ?").get(id);
  if (!existing) return res.status(404).json({ error: "not_found" });
  if (!canTouchClient(req, existing.client_id)) return res.status(403).json({ error: "forbidden" });

  const b = req.body || {};
  const newClientId = b.client_id !== undefined ? (b.client_id ? Number(b.client_id) : null) : existing.client_id;
  if (!canTouchClient(req, newClientId)) return res.status(403).json({ error: "forbidden" });

  const merged = {
    title: b.title !== undefined ? String(b.title).trim() : existing.title,
    platform: b.platform !== undefined ? b.platform : existing.platform,
    post_type: b.post_type !== undefined ? b.post_type : existing.post_type,
    status: b.status !== undefined ? b.status : existing.status,
    scheduled_date: b.scheduled_date !== undefined ? b.scheduled_date : existing.scheduled_date,
    client_id: newClientId,
    campaign: b.campaign !== undefined ? b.campaign : existing.campaign,
    owner_id: b.owner_id !== undefined ? b.owner_id : existing.owner_id,
    notes: b.notes !== undefined ? b.notes : existing.notes,
    reference_notes: b.reference_notes !== undefined ? String(b.reference_notes) : existing.reference_notes,
  };
  if (!merged.title) return res.status(400).json({ error: "title_required" });
  db.prepare(
    `UPDATE content_posts SET title=@title, platform=@platform, post_type=@post_type, status=@status,
     scheduled_date=@scheduled_date, client_id=@client_id, campaign=@campaign, owner_id=@owner_id, notes=@notes,
     reference_notes=@reference_notes, updated_at=datetime('now') WHERE id=@id`
  ).run({ ...merged, id });
  const row = db.prepare(SELECT + " WHERE content_posts.id = ?").get(id);
  const summary = merged.status !== existing.status
    ? `${req.session.name} moved post "${row.title}" to ${merged.status}`
    : `${req.session.name} updated post "${row.title}"`;
  logActivity(req, { action: "update", entityType: "content_post", entityId: row.id, summary });
  res.json(row);
});

router.delete("/:id", requireRole("admin", "social"), (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare("SELECT * FROM content_posts WHERE id = ?").get(id);
  if (!existing) return res.status(404).json({ error: "not_found" });
  if (!canTouchClient(req, existing.client_id)) return res.status(403).json({ error: "forbidden" });
  db.prepare("DELETE FROM content_posts WHERE id = ?").run(id);
  logActivity(req, { action: "delete", entityType: "content_post", entityId: id, summary: `${req.session.name} deleted post "${existing.title}"` });
  res.json({ ok: true });
});

/* ====================== creatives (designer uploads) ====================== */

function creativeRowsFor(postId) {
  const creatives = db
    .prepare(
      `SELECT content_creatives.*, users.name AS uploaded_by_name
       FROM content_creatives LEFT JOIN users ON users.id = content_creatives.uploaded_by
       WHERE post_id = ? ORDER BY content_creatives.created_at ASC, content_creatives.id ASC`
    )
    .all(postId);
  const reviewsStmt = db.prepare(
    `SELECT creative_reviews.*, users.name AS author_name
     FROM creative_reviews LEFT JOIN users ON users.id = creative_reviews.author_id
     WHERE creative_id = ? ORDER BY creative_reviews.created_at ASC`
  );
  // Every upload to a post is kept (nothing is overwritten), so the list IS the
  // version history — number them in upload order and flag the newest as current,
  // then hand them back newest-first so that's what a reviewer sees at a glance.
  return creatives
    .map((c, idx) => ({ ...c, version: idx + 1, isLatest: idx === creatives.length - 1, reviews: reviewsStmt.all(c.id) }))
    .reverse();
}

function loadPostOr404(req, res, id) {
  const post = db.prepare("SELECT * FROM content_posts WHERE id = ?").get(id);
  if (!post) {
    res.status(404).json({ error: "not_found" });
    return null;
  }
  if (!canTouchClient(req, post.client_id)) {
    res.status(403).json({ error: "forbidden" });
    return null;
  }
  return post;
}

router.get("/:id/creatives", (req, res) => {
  const post = loadPostOr404(req, res, Number(req.params.id));
  if (!post) return;
  res.json(creativeRowsFor(post.id));
});

router.post("/:id/creatives", requireRole("admin", "designer"), (req, res) => {
  const post = loadPostOr404(req, res, Number(req.params.id));
  if (!post) return;
  upload.single("file")(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message === "unsupported_file_type" ? "unsupported_file_type" : "upload_failed" });
    if (!req.file) return res.status(400).json({ error: "file_required" });
    const info = db
      .prepare(
        `INSERT INTO content_creatives (post_id, filename, stored_name, mime_type, size, uploaded_by)
         VALUES (?,?,?,?,?,?)`
      )
      .run(post.id, req.file.originalname, req.file.filename, req.file.mimetype, req.file.size, req.session.userId);
    logActivity(req, {
      action: "create",
      entityType: "creative",
      entityId: info.lastInsertRowid,
      summary: `${req.session.name} uploaded creative "${req.file.originalname}" to "${post.title}"`,
    });
    const row = db.prepare("SELECT * FROM content_creatives WHERE id = ?").get(info.lastInsertRowid);
    res.status(201).json({ ...row, reviews: [] });
  });
});

router.get("/:id/creatives/:creativeId/file", (req, res) => {
  const post = loadPostOr404(req, res, Number(req.params.id));
  if (!post) return;
  const creative = db.prepare("SELECT * FROM content_creatives WHERE id = ? AND post_id = ?").get(Number(req.params.creativeId), post.id);
  if (!creative) return res.status(404).json({ error: "not_found" });
  const filePath = path.join(UPLOAD_DIR, creative.stored_name);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: "file_missing" });
  res.download(filePath, creative.filename);
});

router.delete("/:id/creatives/:creativeId", requireRole("admin", "designer"), (req, res) => {
  const post = loadPostOr404(req, res, Number(req.params.id));
  if (!post) return;
  const creative = db.prepare("SELECT * FROM content_creatives WHERE id = ? AND post_id = ?").get(Number(req.params.creativeId), post.id);
  if (!creative) return res.status(404).json({ error: "not_found" });
  db.prepare("DELETE FROM content_creatives WHERE id = ?").run(creative.id);
  const filePath = path.join(UPLOAD_DIR, creative.stored_name);
  fs.unlink(filePath, () => {}); // best-effort; missing file is not an error
  logActivity(req, { action: "delete", entityType: "creative", entityId: creative.id, summary: `${req.session.name} removed creative "${creative.filename}" from "${post.title}"` });
  res.json({ ok: true });
});

/* ====================== creative reviews (brand manager feedback) ====================== */

router.post("/:id/creatives/:creativeId/reviews", requireRole("admin", "social"), (req, res) => {
  const post = loadPostOr404(req, res, Number(req.params.id));
  if (!post) return;
  const creative = db.prepare("SELECT * FROM content_creatives WHERE id = ? AND post_id = ?").get(Number(req.params.creativeId), post.id);
  if (!creative) return res.status(404).json({ error: "not_found" });

  const body = String(req.body.body || "").trim();
  const status = ["approved", "changes_requested", "comment"].includes(req.body.status) ? req.body.status : "comment";
  if (!body) return res.status(400).json({ error: "body_required" });

  const info = db
    .prepare("INSERT INTO creative_reviews (creative_id, author_id, status, body) VALUES (?,?,?,?)")
    .run(creative.id, req.session.userId, status, body);
  logActivity(req, {
    action: "create",
    entityType: "review",
    entityId: info.lastInsertRowid,
    summary: `${req.session.name} reviewed creative "${creative.filename}" on "${post.title}" (${status})`,
  });
  const row = db.prepare("SELECT * FROM creative_reviews WHERE id = ?").get(info.lastInsertRowid);
  res.status(201).json({ ...row, author_name: req.session.name });
});

/* ====================== reference samples (planning inspiration, no review) ====================== */
// Separate from "creatives": references are supporting material attached
// while briefing/planning a post (mood-board images, competitor examples),
// added by whoever plans the post (admin/social) — no approve/reject
// workflow, just upload/view/delete.
function referenceRowsFor(postId) {
  return db
    .prepare(
      `SELECT content_references.*, users.name AS uploaded_by_name
       FROM content_references LEFT JOIN users ON users.id = content_references.uploaded_by
       WHERE post_id = ? ORDER BY content_references.created_at ASC`
    )
    .all(postId);
}

router.get("/:id/references", (req, res) => {
  const post = loadPostOr404(req, res, Number(req.params.id));
  if (!post) return;
  res.json(referenceRowsFor(post.id));
});

router.post("/:id/references", requireRole("admin", "social"), (req, res) => {
  const post = loadPostOr404(req, res, Number(req.params.id));
  if (!post) return;
  upload.single("file")(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message === "unsupported_file_type" ? "unsupported_file_type" : "upload_failed" });
    if (!req.file) return res.status(400).json({ error: "file_required" });
    const info = db
      .prepare(
        `INSERT INTO content_references (post_id, filename, stored_name, mime_type, size, uploaded_by)
         VALUES (?,?,?,?,?,?)`
      )
      .run(post.id, req.file.originalname, req.file.filename, req.file.mimetype, req.file.size, req.session.userId);
    logActivity(req, {
      action: "create",
      entityType: "reference",
      entityId: info.lastInsertRowid,
      summary: `${req.session.name} added reference sample "${req.file.originalname}" to "${post.title}"`,
    });
    const row = db.prepare("SELECT * FROM content_references WHERE id = ?").get(info.lastInsertRowid);
    res.status(201).json(row);
  });
});

router.get("/:id/references/:refId/file", (req, res) => {
  const post = loadPostOr404(req, res, Number(req.params.id));
  if (!post) return;
  const ref = db.prepare("SELECT * FROM content_references WHERE id = ? AND post_id = ?").get(Number(req.params.refId), post.id);
  if (!ref) return res.status(404).json({ error: "not_found" });
  const filePath = path.join(UPLOAD_DIR, ref.stored_name);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: "file_missing" });
  res.download(filePath, ref.filename);
});

router.delete("/:id/references/:refId", requireRole("admin", "social"), (req, res) => {
  const post = loadPostOr404(req, res, Number(req.params.id));
  if (!post) return;
  const ref = db.prepare("SELECT * FROM content_references WHERE id = ? AND post_id = ?").get(Number(req.params.refId), post.id);
  if (!ref) return res.status(404).json({ error: "not_found" });
  db.prepare("DELETE FROM content_references WHERE id = ?").run(ref.id);
  const filePath = path.join(UPLOAD_DIR, ref.stored_name);
  fs.unlink(filePath, () => {}); // best-effort; missing file is not an error
  logActivity(req, { action: "delete", entityType: "reference", entityId: ref.id, summary: `${req.session.name} removed reference sample "${ref.filename}" from "${post.title}"` });
  res.json({ ok: true });
});

module.exports = router;
