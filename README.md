# Relay CRM

A fully functional CRM for a small sales + social media team, built as a real
Node.js/Express backend with a SQLite database — not a static mockup. Sales
and social media each get their own dashboard and permissions, tied together
by a shared contact book.

## What's included

- **Node.js + Express** REST API, session-based login (bcrypt-hashed passwords)
- **SQLite** database (via `better-sqlite3`) — a single file, no separate DB server to run
- **Role-based access**: `admin`, `sales`, `social`, `designer`
  - `sales` → Sales dashboard, Pipeline (kanban), Contacts
  - `social` → Social dashboard, Content calendar (full read/write), Contacts,
    and reviewing creatives as a brand manager
  - `designer` → Content calendar (view + upload creatives only, no post
    editing), and their own Profile
  - `admin` → everything, plus Clients, Team, and the Activity log
- **Clients**: admin creates clients and assigns each social/designer teammate
  to one or more of them (many-to-many). A `social` or `designer` teammate
  only sees and can only act on their assigned clients' content, plus a
  shared "Internal / Agency" bucket for content that isn't client-specific.
  Admins see and can touch every client's content.
- **Content calendar, three ways**: a month-view **Calendar** for browsing, a
  read-only **List** for a fast filtered scan, and an editable **Grid** —
  a spreadsheet-style table where date, platform, type, status, and title are
  all edited right in the cell (click, type or pick, click away — it saves
  immediately, no Save button) and a **+ Add row** button creates a new post
  in one click, scoped to whichever client filter is active. All three share
  the same platform/client/status filters and switch instantly from the same
  toolbar. Anything not editable in the grid (owner, campaign, notes,
  creatives, references) is one click away via the "Full details" icon on
  each row, which opens the same modal as clicking a calendar chip.
- **Reference samples**: every post has its own "Reference samples" section —
  a free-text box for pasting inspiration links/notes, plus a small upload
  area for reference images or screenshots — attached when the post is
  planned (by `social`/admin), separate from the designer's final creative
  deliverable. A designer can see the references while working but doesn't
  manage them; admin can always add or remove.
- **Post types**: every content post is Static, Carousel, or Reel.
- **Content statuses are admin-editable**: ships with Shoot Pending → Shoot
  Done → Under Edit → Edited → Under Update, but an admin can add, rename, or
  delete stages any time from the "Statuses" button on the Content calendar —
  no code changes needed. Deleting a status in use reassigns those posts to
  the next stage rather than losing data.
- **Creative upload + brand review workflow, with version history**: a
  `designer` (or admin) uploads the creative file for a post directly on that
  post's card (images, video, or PDF, up to 25MB). Nothing is overwritten —
  every upload to a post is kept, numbered v1, v2, v3…, with the newest
  marked "Current" and older ones shown dimmed alongside their own review
  history, so you can always see what changed between rounds. Images and
  videos preview inline (no need to download just to see what was sent);
  PDFs show a "Download to view" placeholder. The assigned `social` teammate
  (acting as brand manager) or admin can leave a review on any version —
  Approved / Changes requested / Comment plus a note — visible to the
  designer and admin. Downloads are streamed through an authenticated
  endpoint, so creatives respect the same client-scoping as everything else —
  no public file URLs.
- **Pending-review notifications**: a red count badge on the "Content
  calendar" nav item, plus a "Needs attention" panel at the top of the
  Content calendar itself, surfaces what's waiting on you — creatives with no
  review yet (for `social`/admin) and creatives where changes were requested
  and still need a re-upload (for `designer`/admin). Clicking an item opens
  that post directly. The badge clears itself the moment the relevant action
  happens (a review gets posted, or a fixed version gets uploaded) — nothing
  needs to be manually dismissed.
- **Export to Excel or PDF**: the Content calendar's current filters (client,
  platform, status) can be downloaded as a formatted `.xlsx` or `.pdf` from
  the Export buttons on the toolbar — handy for sharing a client's content
  plan for review outside the CRM.
- **Activity log, with filters**: every create/update/delete across the CRM
  (deals, contacts, content posts, clients, statuses, teammates, creatives,
  reviews, logins, password changes) is recorded with who/what/when in an
  append-only log, visible only to admins from the "Activity log" page —
  filterable by teammate, action (create/update/delete), entity type, and
  date range.
- **Profile page**: every signed-in user can change their own password from a
  "Profile" page in the sidebar — no admin involvement needed for routine
  password resets.
- **Settings page (admin only) — custom branding**: an admin can replace the
  default "Relay CRM" mark with their own company name and logo, from
  Settings in the sidebar. Two logo variants are supported — one for light
  theme, one for dark — so the mark always has contrast against the sidebar;
  if only one is uploaded, that one is used for both themes. The logo appears
  in the sidebar, the login screen (shown before signing in), and on the
  light-theme logo specifically, on exported PDF and Excel content calendars.
  PNG or JPG, up to 5MB each. Removing a logo reverts that spot to the plain
  text mark.
- **Light and dark theme**, switchable any time from the sidebar (not just
  tied to the OS setting) — the choice is remembered per browser.
- **All pricing is shown in Indian Rupees (₹)**, with Indian digit grouping
  and Lakh/Crore abbreviations for tile summaries (e.g. ₹4.6L, ₹1.2Cr).
- **Mobile-friendly**: a collapsible hamburger nav drawer for phones/tablets,
  in addition to the fixed sidebar on desktop.
- Seeded with realistic starter data (contacts, deals, clients, content posts) so it's usable immediately
- A single-page frontend (vanilla JS, no build step) served straight from Express

## Quick start (local)

Requires Node.js 18+.

```bash
npm install
cp .env.example .env      # then open .env and set a real SESSION_SECRET
npm start
```

Visit **http://localhost:3000**. On first run the database is created and
seeded automatically at `data/relay.db`, and the server prints the demo
login credentials to the console:

| Email | Password | Role | Clients assigned |
|---|---|---|---|
| admin@relay.test | admin123 | admin | — (sees everything) |
| sam@relay.test | sales123 | sales | — |
| jordan@relay.test | sales123 | sales | — |
| riya@relay.test | social123 | social | Bloom & Co Skincare, Northwind Bakery Co. |
| maya@relay.test | social123 | social | Fenwick Outdoor Gear, Kessler Home Renovations, Iqbal Fitness Studio |
| dana@relay.test | design123 | designer | Bloom & Co Skincare, Northwind Bakery Co. |

`dana` pairs with `riya` on the same two clients — sign in as Dana to upload
a creative onto one of their posts, then sign in as Riya to review it, to see
the full designer → brand manager review loop.

**Change these before giving anyone real access** — from the Team page as
admin, or directly in the database.

## Project structure

```
relay-crm-app/
  server.js              Express app entry point
  src/
    db.js                 SQLite schema + first-run seed data
    auth.js                requireAuth / requireRole middleware
    activityLog.js          logActivity() — writes to the activity_log table
    upload.js                multer disk-storage config for creative uploads
    branding.js               reads the app_settings row + resolves logo file paths
                                for both the frontend and the exports
    routes/
      auth.js              login / logout / me / self-service password change
      users.js              admin: manage teammates + their client assignments
      team.js                lightweight roster (id/name/role) for owner pickers
      contacts.js            contact CRUD
      deals.js                deal / pipeline CRUD (sales + admin write)
      clients.js               admin: manage clients (name, notes, assigned teammates)
      content-statuses.js       admin: manage the content status pipeline
      content.js                content calendar CRUD + creative upload/download + reviews
                                  + versioned creative history + notification counts
                                  + reference-sample upload/download (separate from creatives)
      dashboard.js               /sales and /social aggregate endpoints
      activityLog.js              admin-only: paginated + filterable activity log reads
      exportRoutes.js              content calendar export as .xlsx / .pdf, with the
                                     company logo embedded when one is configured
      settings.js                  admin: company name + light/dark logo upload;
                                     GET routes are public since the login screen
                                     (pre-auth) also needs the branding
  public/
    index.html            frontend shell + styles
    app.js                 frontend logic (fetch-based, no framework)
  data/
    relay.db              SQLite database file (created on first run)
    uploads/               creative files (randomized on-disk names; served
                            only through the authenticated download route)
      branding/             company logo files (also randomized names; served
                             through a public — not sensitive — route since the
                             pre-login screen needs them too)
```

## Environment variables

See `.env.example`. The important ones:

- `SESSION_SECRET` — generate with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
- `NODE_ENV=production` when deploying behind HTTPS (makes session cookies secure-only)
- `DB_PATH` — where the SQLite file lives; point this at a persistent disk/volume in production

## Deploying it yourself

This app has no external dependencies beyond Node — no separate database
server, no Redis, no build step. That makes it easy to run almost anywhere:

**Render / Railway / Fly.io (recommended, easiest)**
1. Push this folder to a Git repo.
2. Create a new Web Service pointing at it. Build command: `npm install`. Start command: `npm start`.
3. Set `SESSION_SECRET` and `NODE_ENV=production` as environment variables.
4. Attach a small persistent disk/volume and set `DB_PATH` to a file inside it
   (e.g. `/data/relay.db`) — otherwise the database resets on every deploy.

**A plain VPS**
1. Install Node.js 18+, copy this folder over, `npm install --omit=dev`.
2. Set environment variables in a `.env` file (see above) or systemd unit.
3. Run it with a process manager, e.g. `pm2 start server.js --name relay-crm` or a systemd service.
4. Put nginx or Caddy in front of it for HTTPS and a real domain.

**Note on sessions**: this app uses the default in-memory session store,
which is fine for a small team on a single server process, but sessions
reset on restart and won't work if you later run multiple instances behind
a load balancer. If you outgrow that, swap in a persistent session store
(e.g. `connect-sqlite3` or Redis) — the only change needed is in `server.js`.

## Notes on the permission model

- Anyone signed in can read contacts and deals — it's a small team and hiding
  that data from teammates rarely helps.
- **Content is scoped by client.** A `social` teammate only sees and can only
  create/edit/delete posts for clients they're assigned to (set from the Team
  page → edit a teammate → "Clients handled" checklist), plus posts with no
  client ("Internal / Agency"). `admin` sees and can touch every client's
  content. This is enforced server-side in `src/routes/content.js`
  (`canTouchClient`/`scopedRows`), not just hidden in the UI.
- **Writing** is otherwise restricted by role: only `sales`/`admin` can
  create, edit, or move deals; only `social`/`admin` can create, edit, or
  delete content posts; contacts can be added/edited by anyone (both teams
  add leads).
- Only `admin` can add, edit, or remove teammates, clients, and content
  statuses.
- **Creative uploads**: only `designer`/`admin` can upload or delete a
  creative file on a post, and only for clients they're assigned to (or the
  Internal/Agency bucket) — enforced the same way as post writes. Any
  authenticated user who can see the post can view its creatives and reviews.
- **Creative reviews**: only `social`/`admin` can post a review (the
  "brand manager" role in this app is just the existing `social` role,
  reviewing designers' work for the clients they're assigned to).
- **Activity log**: readable only by `admin`, via `GET /api/activity-log`.
  Every mutating route writes an entry; a failure to write the log never
  blocks the underlying request (it's logged to the server console instead).
- **Self-service password change**: any signed-in user can change their own
  password from the Profile page (`PATCH /api/auth/password`), after
  confirming their current password.
- **Settings / branding**: only `admin` can change the company name or
  upload/remove logos (`POST /api/settings`). Reading the branding
  (`GET /api/settings` and `GET /api/settings/logo/:variant`) is deliberately
  public with no login required — the pre-auth login screen needs to show
  the logo too, and a company logo isn't sensitive information.

If your team wants a different split (e.g. everyone can edit content, or
sales reps shouldn't see each other's deals), the guard clauses live in
`src/auth.js` (`requireRole`) and are applied per-route in `src/routes/*.js`
— straightforward to adjust.

## How the pieces fit together (for the interpretive calls made building this)

- **Client assignment lives on the Team page**, not the Clients page — edit a
  teammate, and if their role is "Social media" or "Designer" a checklist of
  clients appears. A client can have several teammates; a teammate can handle
  several clients.
- **Post types are a fixed set** (Static / Carousel / Reel) rather than
  admin-editable, since the request named exactly those three.
- **Statuses are admin-editable** via the gear icon ("Statuses") on the
  Content calendar toolbar — add as many as your workflow needs (e.g. "Client
  Approved", "Posted"). The five default stages are just a starting point.
- **"Brand manager" reuses the existing `social` role** rather than adding a
  separate one — a social teammate reviewing a designer's creative is just
  reviewing work for a client they're already assigned to, so no new
  role/permission model was needed for that half of the workflow.
- **The calendar keeps its month view** and gets a List view alongside it
  (same toolbar filters apply to both) rather than being replaced — the
  month view is still the fastest way to see gaps in the schedule, and the
  list view is the fastest way to scan/export everything at once.
- **Creative version numbers are derived, not stored** — every upload is just
  a new row in `content_creatives` for the same post; `v1`/`v2`/… and which
  one is "Current" are computed from upload order each time they're read
  (`src/routes/content.js`). That keeps re-uploading dead simple (no
  "replace" step) while still giving a full history.
- **Notification counts only look at each post's latest creative** — an old
  "changes requested" review on a file that's since been replaced shouldn't
  keep nagging anyone, so both the awaiting-review and needs-attention counts
  (`GET /api/content/notifications`) are computed from the newest upload per
  post, not every file ever uploaded.
- **The Grid only makes the day-to-day fields inline-editable** (date,
  platform, post type, status, title) — owner, campaign, notes, references
  and creatives stay in the full post modal (one click away via the "Full
  details" icon per row). Those are edited far less often, and cramming
  every field into a spreadsheet row would make the grid harder to scan, not
  easier.
- **References are a separate table from creatives**, not a flag on the same
  one — a reference sample has no approve/reject workflow and no version
  history; it's just supporting material someone attaches once while
  planning a post. Keeping it separate avoided overloading the creative
  review UI with items that were never meant to be reviewed.
- **Branding is one settings row, not a generic key-value settings table** —
  there's only one thing to configure today (company name + two logos), and a
  dedicated `app_settings` table with real columns is simpler to read and
  validate than a generic settings blob. If more workspace-wide settings show
  up later, they can be added as columns on the same row.
- **Exports only ever use the light-theme logo**, even if the dark-theme
  variant is the only one an admin bothered to upload for on-screen use — a
  printed/downloaded PDF or spreadsheet is assumed to have a white page
  background, so the logo made for light backgrounds is the correct one
  regardless of which theme the person exporting happens to be using.
