const express = require("express");
const fs = require("fs");
const crypto = require("crypto");
const multer = require("multer");
const db = require("../db");
const { requireAuth, requireRole } = require("../auth");
const { logActivity } = require("../activityLog");
const { BRANDING_DIR, getBranding, logoDiskPath } = require("../branding");

const router = express.Router();

const ALLOWED_LOGO_MIME = { "image/png": ".png", "image/jpeg": ".jpg" };

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, BRANDING_DIR),
  filename: (req, file, cb) => cb(null, crypto.randomUUID() + (ALLOWED_LOGO_MIME[file.mimetype] || "")),
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB per logo
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_LOGO_MIME[file.mimetype]) return cb(new Error("unsupported_file_type"));
    cb(null, true);
  },
});

function publicShape(s) {
  return {
    company_name: s.company_name,
    has_logo_light: !!s.logo_light_stored_name,
    has_logo_dark: !!s.logo_dark_stored_name,
    updated_at: s.updated_at,
  };
}

// Public on purpose: the login screen (pre-auth) and the sidebar both need
// branding basics, and none of this is sensitive.
router.get("/", (req, res) => {
  res.json(publicShape(getBranding()));
});

router.get("/logo/:variant", (req, res) => {
  const variant = req.params.variant === "dark" ? "dark" : "light";
  const s = getBranding();
  const storedName = variant === "dark" ? s.logo_dark_stored_name : s.logo_light_stored_name;
  const mime = variant === "dark" ? s.logo_dark_mime : s.logo_light_mime;
  if (!storedName) return res.status(404).end();
  const filePath = logoDiskPath(storedName);
  if (!fs.existsSync(filePath)) return res.status(404).end();
  res.setHeader("Content-Type", mime || "image/png");
  res.setHeader("Cache-Control", "no-cache");
  fs.createReadStream(filePath).pipe(res);
});

router.post("/", requireAuth, requireRole("admin"), (req, res) => {
  upload.fields([{ name: "logo_light", maxCount: 1 }, { name: "logo_dark", maxCount: 1 }])(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message === "unsupported_file_type" ? "unsupported_file_type" : "upload_failed" });

    const current = getBranding();
    const body = req.body || {};
    const files = req.files || {};

    const next = {
      company_name: (body.company_name || "").trim() || current.company_name || "Relay CRM",
      logo_light_filename: current.logo_light_filename,
      logo_light_stored_name: current.logo_light_stored_name,
      logo_light_mime: current.logo_light_mime,
      logo_dark_filename: current.logo_dark_filename,
      logo_dark_stored_name: current.logo_dark_stored_name,
      logo_dark_mime: current.logo_dark_mime,
    };

    const changedParts = [];
    ["light", "dark"].forEach((variant) => {
      const field = "logo_" + variant;
      const uploaded = files[field] && files[field][0];
      const removeFlag = body["remove_" + field] === "1" || body["remove_" + field] === "true";
      if (uploaded) {
        const oldStored = current[field + "_stored_name"];
        if (oldStored) { try { fs.unlinkSync(logoDiskPath(oldStored)); } catch (e) {} }
        next[field + "_filename"] = uploaded.originalname;
        next[field + "_stored_name"] = uploaded.filename;
        next[field + "_mime"] = uploaded.mimetype;
        changedParts.push(variant + "-theme logo");
      } else if (removeFlag && current[field + "_stored_name"]) {
        const oldStored = current[field + "_stored_name"];
        try { fs.unlinkSync(logoDiskPath(oldStored)); } catch (e) {}
        next[field + "_filename"] = null;
        next[field + "_stored_name"] = null;
        next[field + "_mime"] = null;
        changedParts.push(variant + "-theme logo removed");
      }
    });
    if (next.company_name !== current.company_name) changedParts.push("company name");

    db.prepare(
      `UPDATE app_settings SET
         company_name = @company_name,
         logo_light_filename = @logo_light_filename,
         logo_light_stored_name = @logo_light_stored_name,
         logo_light_mime = @logo_light_mime,
         logo_dark_filename = @logo_dark_filename,
         logo_dark_stored_name = @logo_dark_stored_name,
         logo_dark_mime = @logo_dark_mime,
         updated_at = datetime('now'),
         updated_by = @updated_by
       WHERE id = 1`
    ).run(Object.assign({}, next, { updated_by: req.session.userId }));

    if (changedParts.length) {
      logActivity(req, { action: "update", entityType: "settings", entityId: 1, summary: `${req.session.name} updated ${changedParts.join(", ")}` });
    }
    res.json(publicShape(getBranding()));
  });
});

module.exports = router;
