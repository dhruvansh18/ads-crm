require("dotenv").config();
const path = require("path");
const express = require("express");
const session = require("express-session");

const app = express();
const PORT = process.env.PORT || 3000;
const isProd = process.env.NODE_ENV === "production";

app.set("trust proxy", 1);
app.use(express.json());
app.use(
  session({
    name: "relay.sid",
    secret: process.env.SESSION_SECRET || "dev-secret-change-me",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: isProd,
      maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
    },
  })
);

app.use("/api/auth", require("./src/routes/auth"));
app.use("/api/team", require("./src/routes/team"));
app.use("/api/users", require("./src/routes/users"));
app.use("/api/contacts", require("./src/routes/contacts"));
app.use("/api/deals", require("./src/routes/deals"));
app.use("/api/content", require("./src/routes/content"));
app.use("/api/clients", require("./src/routes/clients"));
app.use("/api/content-statuses", require("./src/routes/contentStatuses"));
app.use("/api/dashboard", require("./src/routes/dashboard"));
app.use("/api/activity-log", require("./src/routes/activityLog"));
app.use("/api/export", require("./src/routes/exportRoutes"));
app.use("/api/settings", require("./src/routes/settings"));

app.use(express.static(path.join(__dirname, "public")));

// SPA fallback for any non-API GET request
app.get(/^\/(?!api\/).*/, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// JSON error handler (keeps API responses machine-readable even on crashes)
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "server_error" });
});

app.listen(PORT, () => {
  console.log(`Relay CRM running at http://localhost:${PORT}`);
});
