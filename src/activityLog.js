const db = require("./db");

const insert = db.prepare(
  `INSERT INTO activity_log (actor_id, actor_name, action, entity_type, entity_id, summary)
   VALUES (@actor_id, @actor_name, @action, @entity_type, @entity_id, @summary)`
);

// req can be a real Express request (with req.session) or, for system/background
// events, a plain object shaped like { session: { userId, name } }.
function logActivity(req, { action, entityType, entityId, summary }) {
  try {
    const session = (req && req.session) || {};
    insert.run({
      actor_id: session.userId || null,
      actor_name: session.name || "System",
      action,
      entity_type: entityType,
      entity_id: entityId == null ? null : Number(entityId),
      summary,
    });
  } catch (err) {
    // Logging must never break the request it's attached to.
    console.error("activity log write failed:", err.message);
  }
}

module.exports = { logActivity };
