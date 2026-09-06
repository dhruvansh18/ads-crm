const express = require("express");
const db = require("../db");
const { requireRole } = require("../auth");

const router = express.Router();

const OPEN_STAGES = ["new", "contacted", "qualified", "proposal", "negotiation"];
const STAGE_LABELS = {
  new: "New Lead",
  contacted: "Contacted",
  qualified: "Qualified",
  proposal: "Proposal Sent",
  negotiation: "Negotiation",
  won: "Won",
  lost: "Lost",
};

function isThisMonth(iso) {
  if (!iso) return false;
  const d = new Date(iso + "T00:00:00");
  if (isNaN(d)) return false;
  const now = new Date();
  return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
}
function daysUntil(iso) {
  if (!iso) return null;
  const d = new Date(iso + "T00:00:00");
  if (isNaN(d)) return null;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.round((d - now) / 86400000);
}

router.get("/sales", requireRole("admin", "sales"), (req, res) => {
  const deals = db
    .prepare(
      `SELECT deals.*, contacts.name AS contact_name, contacts.company AS company, users.name AS owner_name
       FROM deals
       LEFT JOIN contacts ON contacts.id = deals.contact_id
       LEFT JOIN users ON users.id = deals.owner_id`
    )
    .all();
  const contacts = db
    .prepare(
      `SELECT contacts.*, users.name AS owner_name FROM contacts
       LEFT JOIN users ON users.id = contacts.owner_id ORDER BY contacts.created_at DESC`
    )
    .all();

  const openDeals = deals.filter((d) => OPEN_STAGES.includes(d.stage));
  const openValue = openDeals.reduce((s, d) => s + (Number(d.value) || 0), 0);
  const wonThisMonth = deals.filter((d) => d.stage === "won" && isThisMonth(d.close_date));
  const wonValue = wonThisMonth.reduce((s, d) => s + (Number(d.value) || 0), 0);
  const closed = deals.filter((d) => d.stage === "won" || d.stage === "lost");
  const won = deals.filter((d) => d.stage === "won");
  const winRate = closed.length ? Math.round((won.length / closed.length) * 100) : 0;

  const funnel = OPEN_STAGES.map((key) => {
    const ds = deals.filter((d) => d.stage === key);
    return {
      key,
      label: STAGE_LABELS[key],
      count: ds.length,
      value: ds.reduce((s, d) => s + (Number(d.value) || 0), 0),
    };
  });

  const recentDeals = deals
    .slice()
    .sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || ""))
    .slice(0, 8);
  const recentContacts = contacts.slice(0, 8);

  res.json({
    kpis: {
      openValue,
      openDealCount: openDeals.length,
      wonValue,
      wonCount: wonThisMonth.length,
      winRate,
      closedCount: closed.length,
      totalContacts: contacts.length,
      sourceCount: new Set(contacts.map((c) => c.source).filter(Boolean)).size,
    },
    funnel,
    recentDeals,
    recentContacts,
  });
});

router.get("/social", requireRole("admin", "social"), (req, res) => {
  const statuses = db.prepare("SELECT * FROM content_statuses ORDER BY sort_order").all();
  const lastStatusKey = statuses.length ? statuses[statuses.length - 1].key : null;

  const allPosts = db
    .prepare(
      `SELECT content_posts.*, users.name AS owner_name, clients.name AS client_name
       FROM content_posts
       LEFT JOIN users ON users.id = content_posts.owner_id
       LEFT JOIN clients ON clients.id = content_posts.client_id`
    )
    .all();

  let posts = allPosts;
  let myClients;
  if (req.session.role === "admin") {
    myClients = db.prepare("SELECT COUNT(*) AS n FROM clients").get().n;
  } else {
    const allowed = db.prepare("SELECT client_id FROM user_clients WHERE user_id = ?").all(req.session.userId).map((r) => r.client_id);
    const allowedSet = new Set(allowed);
    posts = allPosts.filter((p) => p.client_id == null || allowedSet.has(p.client_id));
    myClients = allowed.length;
  }

  const scheduledThisWeek = posts.filter((p) => {
    const d = daysUntil(p.scheduled_date);
    return d !== null && d >= 0 && d <= 7;
  });
  const needsAttention = posts.filter((p) => {
    const d = daysUntil(p.scheduled_date);
    return d !== null && d <= 0 && p.status !== lastStatusKey;
  });

  const byPlatform = {};
  const byStatus = {};
  statuses.forEach((s) => { byStatus[s.key] = 0; });
  posts.forEach((p) => {
    byPlatform[p.platform] = (byPlatform[p.platform] || 0) + 1;
    if (byStatus[p.status] !== undefined) byStatus[p.status] += 1;
  });

  const upcoming = posts
    .filter((p) => {
      const d = daysUntil(p.scheduled_date);
      return d !== null && d >= 0 && d <= 7;
    })
    .sort((a, b) => (a.scheduled_date || "").localeCompare(b.scheduled_date || ""))
    .slice(0, 8);

  const recentPosts = posts
    .slice()
    .sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || ""))
    .slice(0, 8);

  res.json({
    statuses,
    kpis: {
      totalPosts: posts.length,
      scheduledThisWeek: scheduledThisWeek.length,
      needsAttention: needsAttention.length,
      myClients,
      platformCount: Object.keys(byPlatform).length,
    },
    byPlatform,
    byStatus,
    upcoming,
    recentPosts,
  });
});

module.exports = router;
