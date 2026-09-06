const path = require("path");
const fs = require("fs");
const db = require("./db");

// Company logos live in their own subfolder of the uploads dir — kept separate
// from creative/reference uploads since they're a single admin-managed asset,
// not per-post content.
const BRANDING_DIR = process.env.BRANDING_DIR || path.join(__dirname, "..", "data", "uploads", "branding");
fs.mkdirSync(BRANDING_DIR, { recursive: true });

const DEFAULTS = {
  id: 1,
  company_name: "Relay CRM",
  logo_light_filename: null,
  logo_light_stored_name: null,
  logo_light_mime: null,
  logo_dark_filename: null,
  logo_dark_stored_name: null,
  logo_dark_mime: null,
  updated_at: null,
};

function getBranding() {
  const row = db.prepare("SELECT * FROM app_settings WHERE id = 1").get();
  return row || DEFAULTS;
}

function logoDiskPath(storedName) {
  return storedName ? path.join(BRANDING_DIR, storedName) : null;
}

// Resolves the on-disk path to use for a given variant, falling back to the
// other variant if only one has been uploaded so callers always get *a* logo
// when any logo exists at all. Returns null if neither is set.
function resolveLogoPath(branding, variant) {
  const primary = variant === "dark" ? branding.logo_dark_stored_name : branding.logo_light_stored_name;
  const fallback = variant === "dark" ? branding.logo_light_stored_name : branding.logo_dark_stored_name;
  const storedName = primary || fallback;
  if (!storedName) return null;
  const p = logoDiskPath(storedName);
  return fs.existsSync(p) ? p : null;
}

module.exports = { BRANDING_DIR, getBranding, logoDiskPath, resolveLogoPath };
