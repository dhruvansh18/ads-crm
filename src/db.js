const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");

const DB_PATH = process.env.DB_PATH || path.join(__dirname, "..", "data", "relay.db");
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('admin','sales','social','designer')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS contacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    company TEXT,
    email TEXT,
    phone TEXT,
    source TEXT,
    tags TEXT,
    owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS deals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    contact_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
    value REAL NOT NULL DEFAULT 0,
    stage TEXT NOT NULL DEFAULT 'new',
    close_date TEXT,
    owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS clients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS user_clients (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, client_id)
  );

  CREATE TABLE IF NOT EXISTS content_statuses (
    key TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    color TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS content_posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    platform TEXT NOT NULL,
    post_type TEXT NOT NULL DEFAULT 'static',
    status TEXT NOT NULL DEFAULT 'shoot_pending',
    scheduled_date TEXT,
    client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
    campaign TEXT,
    owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS content_creatives (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id INTEGER NOT NULL REFERENCES content_posts(id) ON DELETE CASCADE,
    filename TEXT NOT NULL,
    stored_name TEXT NOT NULL,
    mime_type TEXT,
    size INTEGER,
    uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS content_references (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id INTEGER NOT NULL REFERENCES content_posts(id) ON DELETE CASCADE,
    filename TEXT NOT NULL,
    stored_name TEXT NOT NULL,
    mime_type TEXT,
    size INTEGER,
    uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS creative_reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    creative_id INTEGER NOT NULL REFERENCES content_creatives(id) ON DELETE CASCADE,
    author_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'comment',
    body TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS app_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    company_name TEXT NOT NULL DEFAULT 'Relay CRM',
    logo_light_filename TEXT,
    logo_light_stored_name TEXT,
    logo_light_mime TEXT,
    logo_dark_filename TEXT,
    logo_dark_stored_name TEXT,
    logo_dark_mime TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS activity_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    actor_name TEXT,
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id INTEGER,
    summary TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);
db.exec("CREATE INDEX IF NOT EXISTS idx_activity_log_created_at ON activity_log(created_at DESC)");
db.exec("CREATE INDEX IF NOT EXISTS idx_content_creatives_post_id ON content_creatives(post_id)");
db.exec("CREATE INDEX IF NOT EXISTS idx_creative_reviews_creative_id ON creative_reviews(creative_id)");
db.exec("CREATE INDEX IF NOT EXISTS idx_content_references_post_id ON content_references(post_id)");

// --- lightweight migration for databases created before clients/statuses existed ---
function ensureColumn(table, column, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  }
}
ensureColumn("content_posts", "client_id", "client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL");
ensureColumn("content_posts", "post_type", "post_type TEXT NOT NULL DEFAULT 'static'");
ensureColumn("content_posts", "reference_notes", "reference_notes TEXT DEFAULT ''");

const STATUS_PALETTE = [
  "#eda100", // amber
  "#2a78d6", // blue
  "#eb6834", // orange
  "#1baf7a", // aqua
  "#e87ba4", // magenta
  "#4a3aa7", // violet
  "#008300", // green
  "#e34948", // red
];

function seedContentStatusesIfEmpty() {
  const count = db.prepare("SELECT COUNT(*) AS n FROM content_statuses").get().n;
  if (count > 0) return;
  const defaults = [
    { key: "shoot_pending", label: "Shoot Pending" },
    { key: "shoot_done", label: "Shoot Done" },
    { key: "under_edit", label: "Under Edit" },
    { key: "edited", label: "Edited" },
    { key: "under_update", label: "Under Update" },
  ];
  const insert = db.prepare("INSERT INTO content_statuses (key, label, color, sort_order) VALUES (?,?,?,?)");
  defaults.forEach((s, i) => insert.run(s.key, s.label, STATUS_PALETTE[i % STATUS_PALETTE.length], i + 1));
}
seedContentStatusesIfEmpty();

function seedAppSettingsIfEmpty() {
  const count = db.prepare("SELECT COUNT(*) AS n FROM app_settings").get().n;
  if (count > 0) return;
  db.prepare("INSERT INTO app_settings (id, company_name) VALUES (1, 'Relay CRM')").run();
}
seedAppSettingsIfEmpty();

function daysFromNow(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

function seed() {
  const userCount = db.prepare("SELECT COUNT(*) AS n FROM users").get().n;
  if (userCount > 0) return;

  const insertUser = db.prepare(
    "INSERT INTO users (name, email, password_hash, role) VALUES (?,?,?,?)"
  );
  const seedUsers = [
    { name: "Alex Morgan", email: "admin@relay.test", password: "admin123", role: "admin" },
    { name: "Sam Ortiz", email: "sam@relay.test", password: "sales123", role: "sales" },
    { name: "Jordan Blake", email: "jordan@relay.test", password: "sales123", role: "sales" },
    { name: "Riya Chandra", email: "riya@relay.test", password: "social123", role: "social" },
    { name: "Maya Chen", email: "maya@relay.test", password: "social123", role: "social" },
    { name: "Dana Park", email: "dana@relay.test", password: "design123", role: "designer" },
  ];
  const ids = {};
  for (const u of seedUsers) {
    const hash = bcrypt.hashSync(u.password, 10);
    const info = insertUser.run(u.name, u.email, hash, u.role);
    ids[u.name.split(" ")[0]] = info.lastInsertRowid;
  }

  const insertContact = db.prepare(`
    INSERT INTO contacts (name, company, email, phone, source, tags, owner_id, notes, created_at)
    VALUES (@name,@company,@email,@phone,@source,@tags,@owner_id,@notes,@created_at)
  `);
  const contacts = [
    { name: "Priya Nair", company: "Northwind Bakery Co.", email: "priya@northwindbakery.co", phone: "(555) 010-2938", source: "Instagram DM", tags: JSON.stringify(["Local Business"]), owner_id: ids.Riya, notes: "Wants weekly Reels + Stories.", created_at: daysFromNow(-18) },
    { name: "Marcus Webb", company: "Fenwick Outdoor Gear", email: "marcus@fenwickgear.com", phone: "(555) 044-1120", source: "Referral", tags: JSON.stringify(["E-commerce"]), owner_id: ids.Sam, notes: "Referred by Bloom & Co. Needs full-funnel ads.", created_at: daysFromNow(-11) },
    { name: "Aisha Rahman", company: "Bloom & Co Skincare", email: "aisha@bloomandco.com", phone: "(555) 093-7741", source: "LinkedIn", tags: JSON.stringify(["E-commerce", "Existing Client"]), owner_id: ids.Sam, notes: "Renewing retainer, wants UGC push.", created_at: daysFromNow(-40) },
    { name: "Tom Delacroix", company: "Delacroix Law Group", email: "tom@delacroixlaw.com", phone: "(555) 067-2200", source: "Cold Outreach", tags: JSON.stringify(["Professional Services"]), owner_id: ids.Jordan, notes: "Early stage, needs brand refresh first.", created_at: daysFromNow(-4) },
    { name: "Sana Iqbal", company: "Iqbal Fitness Studio", email: "sana@iqbalfitness.com", phone: "(555) 081-6654", source: "Website Form", tags: JSON.stringify(["Local Business"]), owner_id: ids.Riya, notes: "Wants a reels-only content package.", created_at: daysFromNow(-7) },
    { name: "Owen Kessler", company: "Kessler Home Renovations", email: "owen@kesslerhome.com", phone: "(555) 029-4471", source: "Event", tags: JSON.stringify(["Local Business", "Won"]), owner_id: ids.Jordan, notes: "Signed at the trade show booth.", created_at: daysFromNow(-52) },
  ];
  const contactIds = {};
  for (const c of contacts) {
    const info = insertContact.run(c);
    contactIds[c.company] = info.lastInsertRowid;
  }

  const insertDeal = db.prepare(`
    INSERT INTO deals (title, contact_id, value, stage, close_date, owner_id, notes, created_at, updated_at)
    VALUES (@title,@contact_id,@value,@stage,@close_date,@owner_id,@notes,@created_at,@updated_at)
  `);
  const deals = [
    { title: "Bloom & Co — Paid Social Retainer", contact_id: contactIds["Bloom & Co Skincare"], value: 270000, stage: "negotiation", close_date: daysFromNow(6), owner_id: ids.Sam, notes: "Finalizing scope for UGC add-on.", created_at: daysFromNow(-40), updated_at: daysFromNow(-1) },
    { title: "Fenwick — Full-Funnel Ads Package", contact_id: contactIds["Fenwick Outdoor Gear"], value: 460000, stage: "proposal", close_date: daysFromNow(9), owner_id: ids.Sam, notes: "Proposal sent, awaiting budget sign-off.", created_at: daysFromNow(-11), updated_at: daysFromNow(-2) },
    { title: "Northwind Bakery — Instagram Growth", contact_id: contactIds["Northwind Bakery Co."], value: 100000, stage: "contacted", close_date: daysFromNow(15), owner_id: ids.Riya, notes: "Second call booked for Thursday.", created_at: daysFromNow(-18), updated_at: daysFromNow(-3) },
    { title: "Delacroix Law — Brand Refresh + Ads", contact_id: contactIds["Delacroix Law Group"], value: 680000, stage: "new", close_date: daysFromNow(30), owner_id: ids.Jordan, notes: "Inbound from cold email sequence.", created_at: daysFromNow(-4), updated_at: daysFromNow(-4) },
    { title: "Iqbal Fitness — Reels Content Package", contact_id: contactIds["Iqbal Fitness Studio"], value: 170000, stage: "qualified", close_date: daysFromNow(12), owner_id: ids.Riya, notes: "Budget confirmed, drafting proposal.", created_at: daysFromNow(-7), updated_at: daysFromNow(-1) },
    { title: "Kessler Renovations — Local SEO + Social", contact_id: contactIds["Kessler Home Renovations"], value: 235000, stage: "won", close_date: daysFromNow(-9), owner_id: ids.Jordan, notes: "Signed 6-month contract.", created_at: daysFromNow(-52), updated_at: daysFromNow(-9) },
    { title: "Downtown Roasters — Social Starter", contact_id: null, value: 75000, stage: "lost", close_date: daysFromNow(-20), owner_id: ids.Sam, notes: "Went with an in-house hire.", created_at: daysFromNow(-30), updated_at: daysFromNow(-20) },
  ];
  for (const d of deals) insertDeal.run(d);

  // --- clients, each handled by one social teammate (a teammate can handle several) ---
  const insertClient = db.prepare("INSERT INTO clients (name, notes) VALUES (?,?)");
  const clientDefs = [
    { name: "Bloom & Co Skincare", notes: "E-commerce. Weekly UGC + Reels.", handlers: ["Riya", "Dana"] },
    { name: "Northwind Bakery Co.", notes: "Local business. Instagram-first.", handlers: ["Riya", "Dana"] },
    { name: "Fenwick Outdoor Gear", notes: "E-commerce. LinkedIn + Instagram.", handlers: ["Maya"] },
    { name: "Kessler Home Renovations", notes: "Local business. Case-study driven.", handlers: ["Maya"] },
    { name: "Iqbal Fitness Studio", notes: "Local business. Reels-only package.", handlers: ["Maya"] },
  ];
  const clientIds = {};
  const insertUserClient = db.prepare("INSERT OR IGNORE INTO user_clients (user_id, client_id) VALUES (?,?)");
  for (const c of clientDefs) {
    const info = insertClient.run(c.name, c.notes);
    clientIds[c.name] = info.lastInsertRowid;
    c.handlers.forEach((h) => insertUserClient.run(ids[h], info.lastInsertRowid));
  }

  const insertPost = db.prepare(`
    INSERT INTO content_posts (title, platform, post_type, status, scheduled_date, client_id, campaign, owner_id, notes, created_at, updated_at)
    VALUES (@title,@platform,@post_type,@status,@scheduled_date,@client_id,@campaign,@owner_id,@notes,@created_at,@updated_at)
  `);
  const posts = [
    { title: "5 Signs Your Ads Need a Refresh", platform: "linkedin", post_type: "static", status: "edited", scheduled_date: daysFromNow(-2), client_id: null, campaign: "Agency", owner_id: ids.Riya, notes: "142 reactions, 18 comments.", created_at: daysFromNow(-9), updated_at: daysFromNow(-2) },
    { title: "Bloom & Co: Before/After UGC Reel", platform: "instagram", post_type: "reel", status: "shoot_done", scheduled_date: daysFromNow(2), client_id: clientIds["Bloom & Co Skincare"], campaign: "", owner_id: ids.Riya, notes: "Waiting on final cut from editor.", created_at: daysFromNow(-3), updated_at: daysFromNow(-1) },
    { title: "Northwind Bakery — New Menu Reel", platform: "instagram", post_type: "reel", status: "under_update", scheduled_date: daysFromNow(7), client_id: clientIds["Northwind Bakery Co."], campaign: "", owner_id: ids.Riya, notes: "Client requested a different song.", created_at: daysFromNow(-2), updated_at: daysFromNow(0) },
    { title: "Client Spotlight: Fenwick Outdoor", platform: "linkedin", post_type: "carousel", status: "under_edit", scheduled_date: daysFromNow(5), client_id: clientIds["Fenwick Outdoor Gear"], campaign: "", owner_id: ids.Maya, notes: "Copy drafted, needs photos.", created_at: daysFromNow(-2), updated_at: daysFromNow(-1) },
    { title: "Iqbal Fitness — Client Testimonial Carousel", platform: "instagram", post_type: "carousel", status: "shoot_done", scheduled_date: daysFromNow(9), client_id: clientIds["Iqbal Fitness Studio"], campaign: "", owner_id: ids.Maya, notes: "3 testimonials filmed, picking the best.", created_at: daysFromNow(-4), updated_at: daysFromNow(-1) },
    { title: "Q3 Ad Trends Carousel", platform: "instagram", post_type: "carousel", status: "shoot_pending", scheduled_date: daysFromNow(11), client_id: null, campaign: "Agency", owner_id: ids.Riya, notes: "Pull stats from last client report.", created_at: daysFromNow(-1), updated_at: daysFromNow(-1) },
    { title: "Behind the Scenes: Shoot Day", platform: "tiktok", post_type: "reel", status: "shoot_pending", scheduled_date: daysFromNow(4), client_id: null, campaign: "Agency", owner_id: ids.Maya, notes: "Film during Thursday shoot.", created_at: daysFromNow(-1), updated_at: daysFromNow(-1) },
    { title: "Case Study Launch: Kessler Renovations", platform: "linkedin", post_type: "static", status: "shoot_pending", scheduled_date: daysFromNow(17), client_id: clientIds["Kessler Home Renovations"], campaign: "", owner_id: ids.Maya, notes: "Needs client quote.", created_at: daysFromNow(0), updated_at: daysFromNow(0) },
    { title: "Quick Tip: Hook in the First 3 Seconds", platform: "tiktok", post_type: "reel", status: "edited", scheduled_date: daysFromNow(-6), client_id: null, campaign: "Agency", owner_id: ids.Riya, notes: "8.9K views, best performer this month.", created_at: daysFromNow(-12), updated_at: daysFromNow(-6) },
  ];
  for (const p of posts) insertPost.run(p);

  console.log("Seeded database with starter accounts and sample data.");
  console.log("  admin@relay.test / admin123   (admin)");
  console.log("  sam@relay.test   / sales123   (sales)");
  console.log("  jordan@relay.test/ sales123   (sales)");
  console.log("  riya@relay.test  / social123  (social — Bloom & Co, Northwind Bakery)");
  console.log("  maya@relay.test  / social123  (social — Fenwick, Kessler, Iqbal Fitness)");
  console.log("  dana@relay.test  / design123  (designer — Bloom & Co, Northwind Bakery)");
}

seed();

module.exports = db;
