(function () {
  "use strict";

  /* ====================== config ====================== */
  var STAGES = [
    { key: "new", label: "New Lead", color: "var(--funnel-1)" },
    { key: "contacted", label: "Contacted", color: "var(--funnel-2)" },
    { key: "qualified", label: "Qualified", color: "var(--funnel-3)" },
    { key: "proposal", label: "Proposal Sent", color: "var(--funnel-4)" },
    { key: "negotiation", label: "Negotiation", color: "var(--funnel-5)" },
    { key: "won", label: "Won", color: "var(--good)" },
    { key: "lost", label: "Lost", color: "var(--critical)" },
  ];
  var OPEN_STAGE_KEYS = ["new", "contacted", "qualified", "proposal", "negotiation"];
  function stageOf(key) { return STAGES.find(function (s) { return s.key === key; }) || STAGES[0]; }

  var PLATFORMS = [
    { key: "linkedin", label: "LinkedIn", cat: "var(--cat-1)" },
    { key: "instagram", label: "Instagram", cat: "var(--cat-2)" },
    { key: "twitter", label: "Twitter / X", cat: "var(--cat-3)" },
    { key: "facebook", label: "Facebook", cat: "var(--cat-4)" },
    { key: "tiktok", label: "TikTok", cat: "var(--cat-5)" },
    { key: "youtube", label: "YouTube", cat: "var(--cat-6)" },
  ];
  function platformOf(key) { return PLATFORMS.find(function (p) { return p.key === key; }) || PLATFORMS[0]; }

  var POST_TYPES = [
    { key: "static", label: "Static" },
    { key: "carousel", label: "Carousel" },
    { key: "reel", label: "Reel" },
  ];
  function postTypeOf(key) { return POST_TYPES.find(function (p) { return p.key === key; }) || POST_TYPES[0]; }

  var SOURCES = ["Instagram DM", "LinkedIn", "Referral", "Website Form", "Cold Outreach", "Event"];
  var CLIENT_SCOPED_ROLES = ["social", "designer"];
  function roleLabel(role) {
    if (role === "social") return "Social media";
    if (role === "designer") return "Designer";
    if (role === "admin") return "Admin";
    if (role === "sales") return "Sales";
    return role || "";
  }

  // Content statuses are admin-managed and loaded from the server (state.statuses) —
  // this is only a fallback used before that first load resolves.
  function contentStatusOf(key) {
    var found = (state.statuses || []).find(function (s) { return s.key === key; });
    return found || { key: key, label: key || "Unknown", color: "#898781" };
  }
  function statusWash(hex) { return /^#[0-9a-f]{6}$/i.test(hex || "") ? hex + "22" : "var(--surface-2)"; }

  /* ====================== state ====================== */
  var state = {
    user: null,
    team: [],
    contacts: [],
    deals: [],
    content: [],
    clients: [],
    statuses: [],
    salesDashboard: null,
    socialDashboard: null,
    contactSearch: "",
    contactSourceFilter: null,
    contentPlatformFilter: null,
    contentStatusFilter: null,
    contentClientFilter: null, // null = all, "__internal__" = no client, else client id (string)
    contentViewMode: "calendar", // "calendar" | "list"
    calendarMonth: (function () { var n = new Date(); return new Date(n.getFullYear(), n.getMonth(), 1); })(),
    activityLog: [],
    activityLogTotal: 0,
    activityLogFilters: { actor_id: "", action: "", entity_type: "", from: "", to: "" },
    notifications: { awaitingReview: [], needsAttention: [] },
    branding: { company_name: "Relay CRM", has_logo_light: false, has_logo_dark: false, updated_at: null },
  };

  /* ====================== utils ====================== */
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]; }); }
  function initials(name) {
    if (!name) return "?";
    var parts = name.trim().split(/\s+/);
    return ((parts[0] || "")[0] + (parts[1] ? parts[1][0] : "")).toUpperCase();
  }
  function money(n) {
    n = Number(n) || 0;
    var abs = Math.abs(n);
    if (abs >= 10000000) return "₹" + (n / 10000000).toFixed(1).replace(/\.0$/, "") + "Cr";
    if (abs >= 100000) return "₹" + (n / 100000).toFixed(1).replace(/\.0$/, "") + "L";
    return "₹" + Math.round(n).toLocaleString("en-IN");
  }
  function moneyFull(n) { return "₹" + (Number(n) || 0).toLocaleString("en-IN"); }
  function fmtDate(iso) {
    if (!iso) return "—";
    var d = new Date(iso + "T00:00:00");
    if (isNaN(d)) return String(iso).slice(0, 10);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }
  function fmtISO(d) {
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  /* ====================== theme (light / dark) ====================== */
  function currentTheme() {
    var explicit = document.documentElement.getAttribute("data-theme");
    if (explicit === "light" || explicit === "dark") return explicit;
    return (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) ? "dark" : "light";
  }
  function applyThemeIcon() {
    var theme = currentTheme();
    var isDark = theme === "dark";
    $("theme-icon-sun").hidden = isDark;
    $("theme-icon-moon").hidden = !isDark;
    $("theme-toggle-label").textContent = isDark ? "Dark mode" : "Light mode";
  }
  function setTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    try { localStorage.setItem("relay-theme", theme); } catch (e) {}
    applyThemeIcon();
    applyBranding();
  }
  function toggleTheme() { setTheme(currentTheme() === "dark" ? "light" : "dark"); }
  applyThemeIcon();
  $("theme-toggle").addEventListener("click", toggleTheme);

  /* ====================== branding (company name + light/dark logo) ====================== */
  function loadBranding() {
    return fetch("/api/settings").then(function (r) { return r.json(); }).then(function (info) {
      state.branding = info;
      applyBranding();
      return info;
    }).catch(function () {});
  }
  // Prefers the logo made for the active theme; falls back to whichever
  // variant exists if only one was ever uploaded.
  function brandingVariantForTheme() {
    var b = state.branding || {};
    var theme = currentTheme();
    if (theme === "dark") return b.has_logo_dark ? "dark" : (b.has_logo_light ? "light" : null);
    return b.has_logo_light ? "light" : (b.has_logo_dark ? "dark" : null);
  }
  function applyBranding() {
    var b = state.branding || {};
    var name = b.company_name || "Relay CRM";
    document.title = name;
    var variant = brandingVariantForTheme();
    var bust = b.updated_at ? "?v=" + encodeURIComponent(b.updated_at) : "";
    [
      { img: "brand-logo-img", mark: "brand-mark", name: "brand-name", sub: "brand-sub" },
      { img: "login-logo-img", mark: "login-mark", name: "login-brand-name", sub: null },
    ].forEach(function (ids) {
      var imgEl = $(ids.img);
      if (!imgEl) return;
      if (variant) {
        imgEl.src = "/api/settings/logo/" + variant + bust;
        imgEl.hidden = false;
        $(ids.mark).hidden = true;
        $(ids.name).hidden = true;
        if (ids.sub) $(ids.sub).hidden = true;
      } else {
        imgEl.hidden = true;
        $(ids.mark).hidden = false;
        $(ids.name).hidden = false;
        $(ids.name).textContent = name;
        if (ids.sub) $(ids.sub).hidden = (name !== "Relay CRM");
      }
    });
  }

  function toast(msg, isError) {
    var t = $("toast");
    t.textContent = msg;
    t.classList.toggle("error", !!isError);
    t.classList.add("show");
    clearTimeout(toast._h);
    toast._h = setTimeout(function () { t.classList.remove("show"); }, 2600);
  }
  function statusPillHtml(statusKey) {
    var st = contentStatusOf(statusKey);
    return '<span class="pill" style="background:' + statusWash(st.color) + '; color:' + st.color + '; border-color:transparent;">' +
      '<span class="dot" style="background:' + st.color + ';"></span>' + esc(st.label) + '</span>';
  }

  /* ====================== API ====================== */
  function api(path, opts) {
    opts = opts || {};
    var fetchOpts = {
      method: opts.method || "GET",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
    };
    if (opts.body) fetchOpts.body = JSON.stringify(opts.body);
    return fetch("/api" + path, fetchOpts).then(function (res) {
      if (res.status === 401) {
        showLogin();
        throw new Error("not_authenticated");
      }
      return res.json().then(function (data) {
        if (!res.ok) {
          var err = new Error(data.error || "request_failed");
          err.status = res.status;
          err.data = data;
          throw err;
        }
        return data;
      });
    });
  }

  // Same request/response contract as api(), but for multipart uploads —
  // no JSON content-type so the browser can set its own form-data boundary.
  function apiUpload(path, formData) {
    return fetch("/api" + path, { method: "POST", body: formData, credentials: "same-origin" }).then(function (res) {
      if (res.status === 401) {
        showLogin();
        throw new Error("not_authenticated");
      }
      return res.json().then(function (data) {
        if (!res.ok) {
          var err = new Error(data.error || "request_failed");
          err.status = res.status;
          err.data = data;
          throw err;
        }
        return data;
      });
    });
  }

  function friendlyError(err) {
    var map = {
      forbidden: "You don't have permission to do that.",
      title_required: "Give it a title first.",
      name_required: "Give it a name first.",
      label_required: "Give it a label first.",
      invalid_credentials: "That email or password isn't right.",
      email_in_use: "That email is already registered.",
      password_too_short: "Password needs at least 6 characters.",
      last_admin: "There has to be at least one admin.",
      cannot_delete_self: "You can't remove your own account.",
      last_status: "You need at least one status.",
      wrong_current_password: "That current password isn't right.",
      unsupported_file_type: "That file type isn't supported.",
      file_required: "Choose a file to upload.",
      file_missing: "That file is no longer available.",
      body_required: "Write something before sending a review.",
      upload_failed: "That upload didn't go through — try again.",
    };
    return (err && err.data && map[err.data.error]) || "Something went wrong — try again.";
  }

  /* ====================== auth / boot ====================== */
  function showLogin() {
    $("shell").classList.remove("ready");
    $("login-screen").style.display = "flex";
  }
  function showShell() {
    $("login-screen").style.display = "none";
    $("shell").classList.add("ready");
  }

  $("login-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var email = $("login-email").value.trim();
    var password = $("login-password").value;
    var errBox = $("login-error");
    errBox.classList.remove("show");
    $("login-submit").disabled = true;
    api("/auth/login", { method: "POST", body: { email: email, password: password } })
      .then(function (user) {
        state.user = user;
        boot();
      })
      .catch(function (err) {
        errBox.textContent = friendlyError(err) || "Couldn't sign in.";
        errBox.classList.add("show");
      })
      .finally(function () { $("login-submit").disabled = false; });
  });

  document.querySelectorAll("[data-demo]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var parts = btn.dataset.demo.split("|");
      $("login-email").value = parts[0];
      $("login-password").value = parts[1];
    });
  });

  $("logout-btn").addEventListener("click", function () {
    api("/auth/logout", { method: "POST" }).finally(function () {
      state.user = null;
      $("login-email").value = "";
      $("login-password").value = "";
      showLogin();
    });
  });

  /* ====================== MOBILE NAV (hamburger drawer) ====================== */
  function openMobileNav() { $("shell").classList.add("nav-open"); }
  function closeMobileNav() { $("shell").classList.remove("nav-open"); }
  $("nav-toggle").addEventListener("click", openMobileNav);
  $("sidebar-close").addEventListener("click", closeMobileNav);
  $("sidebar-backdrop").addEventListener("click", closeMobileNav);
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") closeMobileNav();
  });

  function boot() {
    showShell();
    $("whoami-initials").textContent = initials(state.user.name);
    $("whoami-name").textContent = state.user.name;
    $("whoami-role").textContent = roleLabel(state.user.role).toLowerCase();
    buildNav();
    api("/team").then(function (team) { state.team = team; }).catch(function () {});
    loadClients().catch(function () {});
    loadStatuses().catch(function () {});
    if (["admin", "social", "designer"].indexOf(state.user.role) !== -1) loadNotifications().catch(function () {});
    switchView(defaultViewForRole(state.user.role));
  }

  function defaultViewForRole(role) {
    if (role === "sales") return "dashboard-sales";
    if (role === "social") return "dashboard-social";
    if (role === "designer") return "content";
    return "dashboard-sales";
  }

  /* ====================== nav ====================== */
  var NAV_ITEMS = {
    "dashboard-sales": { label: "Sales dashboard", roles: ["admin", "sales"], icon: 'M3 3h7v9H3zM14 3h7v5h-7zM14 12h7v9h-7zM3 16h7v5H3z' },
    "dashboard-social": { label: "Social dashboard", roles: ["admin", "social"], icon: 'M3 3h7v9H3zM14 3h7v5h-7zM14 12h7v9h-7zM3 16h7v5H3z' },
    "pipeline": { label: "Pipeline", roles: ["admin", "sales"], icon: 'M3 5h18M6 12h12M10 19h4' },
    "contacts": { label: "Contacts", roles: ["admin", "sales", "social"], icon: 'circle:9,8,3.4|M2.5 20c0-3.6 2.9-6.2 6.5-6.2s6.5 2.6 6.5 6.2|M16.5 8.2a3.3 3.3 0 1 1 3.5 3.3|M15 14.2c2.9.4 4.9 2.6 5 5.8' },
    "content": { label: "Content calendar", roles: ["admin", "social", "designer"], icon: 'M3 4.5h18v16H3zM3 9.5h18M8 3v3M16 3v3' },
    "clients": { label: "Clients", roles: ["admin"], icon: 'M3 21h18|M5 21V7l7-4 7 4v14|M9 9h1M9 13h1M14 9h1M14 13h1|M10 21v-5h4v5' },
    "team": { label: "Team", roles: ["admin"], icon: 'circle:9,7,3.2|M3 20c0-3.4 2.7-5.8 6-5.8s6 2.4 6 5.8|circle:18,8,2.4|M15 14.4c2.3.5 4 2.6 4 5.6' },
    "activity-log": { label: "Activity log", roles: ["admin"], icon: 'circle:12,12,9|M12 7v5l3.3 2' },
    "settings": { label: "Settings", roles: ["admin"], icon: 'circle:12,12,3|M12 3v2.4M12 18.6V21M4.2 7.8l2.1 1.2M17.7 15l2.1 1.2M4.2 16.2l2.1-1.2M17.7 9l2.1-1.2M3 12h2.4M18.6 12H21' },
    "profile": { label: "Profile", roles: ["admin", "sales", "social", "designer"], icon: 'circle:12,8,4|M4.5 20c0-3.9 3.4-7 7.5-7s7.5 3.1 7.5 7' },
  };
  var VIEW_META = {
    "dashboard-sales": { title: "Sales dashboard", subtitle: "Pipeline health at a glance", action: { label: "Add deal", handler: function () { openDealModal(null); } } },
    "dashboard-social": { title: "Social dashboard", subtitle: "Content calendar at a glance", action: { label: "Add post", handler: function () { openContentModal(null); } } },
    "pipeline": { title: "Pipeline", subtitle: "Drag a deal to move it between stages", action: { label: "Add deal", handler: function () { openDealModal(null); } } },
    "contacts": { title: "Contacts", subtitle: "Every lead and client in one place", action: { label: "Add contact", handler: function () { openContactModal(null); } } },
    "content": { title: "Content calendar", subtitle: "What's planned, for which client, and where it stands", action: { label: "Add post", handler: function () { openContentModal(null); } } },
    "clients": { title: "Clients", subtitle: "Everyone your social team creates content for", action: { label: "Add client", handler: function () { openClientModal(null); } } },
    "team": { title: "Team", subtitle: "Everyone with access to Relay", action: { label: "Add teammate", handler: function () { openUserModal(null); } } },
    "activity-log": { title: "Activity log", subtitle: "Every change made across Relay, most recent first", action: null },
    "settings": { title: "Settings", subtitle: "Branding shown across the app and on exports", action: null },
    "profile": { title: "Profile", subtitle: "Your account settings", action: null },
  };

  function iconSvg(spec) {
    var parts = spec.split("|").map(function (p) {
      if (p.indexOf("circle:") === 0) {
        var c = p.slice(7).split(",");
        return '<circle cx="' + c[0] + '" cy="' + c[1] + '" r="' + c[2] + '"/>';
      }
      return '<path d="' + p + '"/>';
    }).join("");
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">' + parts + '</svg>';
  }

  function buildNav() {
    var role = state.user.role;
    var groups = [
      { label: "Overview", keys: ["dashboard-sales", "dashboard-social"] },
      { label: "Sales", keys: ["pipeline", "contacts"] },
      { label: "Social", keys: ["content"] },
      { label: "Admin", keys: ["clients", "team", "activity-log", "settings"] },
      { label: "Account", keys: ["profile"] },
    ];
    var html = "";
    groups.forEach(function (g) {
      var visible = g.keys.filter(function (k) { return NAV_ITEMS[k].roles.indexOf(role) !== -1; });
      if (!visible.length) return;
      html += '<div class="nav-group-label">' + esc(g.label) + '</div>';
      visible.forEach(function (k) {
        var item = NAV_ITEMS[k];
        html += '<button class="nav-item" data-view="' + k + '">' + iconSvg(item.icon) + esc(item.label) + '<span class="count" id="nav-count-' + k + '"></span></button>';
      });
    });
    $("nav").innerHTML = html;
    $("nav").querySelectorAll(".nav-item").forEach(function (b) {
      b.addEventListener("click", function () { switchView(b.dataset.view); });
    });
  }

  var currentView = null;
  function switchView(view) {
    if (!NAV_ITEMS[view] || NAV_ITEMS[view].roles.indexOf(state.user.role) === -1) {
      view = defaultViewForRole(state.user.role);
    }
    currentView = view;
    closeMobileNav();
    document.querySelectorAll(".nav-item").forEach(function (b) { b.classList.toggle("active", b.dataset.view === view); });
    document.querySelectorAll(".view").forEach(function (v) { v.classList.remove("active"); });
    $("view-" + view).classList.add("active");
    var meta = VIEW_META[view];
    $("view-title").textContent = meta.title;
    $("view-subtitle").textContent = meta.subtitle;
    var actionBtn = $("primary-action");
    if (meta.action) {
      actionBtn.style.display = "";
      $("primary-action-label").textContent = meta.action.label;
      actionBtn.onclick = meta.action.handler;
    } else {
      actionBtn.style.display = "none";
    }
    loadView(view);
  }

  function loadView(view) {
    if (view === "dashboard-sales") return loadSalesDashboard();
    if (view === "dashboard-social") return loadSocialDashboard();
    if (view === "pipeline") return loadDeals().then(renderPipeline);
    if (view === "contacts") return loadContacts().then(renderContacts);
    if (view === "content") return Promise.all([loadContent(), loadClients(), loadStatuses()]).then(function () { renderCalendar(); loadNotifications().catch(function () {}); });
    if (view === "clients") return loadClients().then(renderClients);
    if (view === "team") return Promise.all([loadTeamFull(), loadClients()]).then(renderTeam);
    if (view === "activity-log") return Promise.all([loadActivityLogFilterOptions(), loadActivityLog()]).then(renderActivityLog);
    if (view === "settings") return loadBranding().then(renderSettingsView);
    if (view === "profile") return Promise.resolve();
  }

  /* ====================== loaders ====================== */
  function loadContacts() { return api("/contacts").then(function (rows) { state.contacts = rows; return rows; }); }
  function loadDeals() { return api("/deals").then(function (rows) { state.deals = rows; return rows; }); }
  function loadContent() { return api("/content").then(function (rows) { state.content = rows; return rows; }); }
  function loadTeamFull() { return api("/users").then(function (rows) { state.teamFull = rows; return rows; }); }
  function loadClients() { return api("/clients").then(function (rows) { state.clients = rows; return rows; }); }
  function loadStatuses() { return api("/content-statuses").then(function (rows) { state.statuses = rows; return rows; }); }
  function activityLogQueryString(offset) {
    var f = state.activityLogFilters || {};
    var params = ["limit=50", "offset=" + (offset || 0)];
    if (f.actor_id) params.push("actor_id=" + encodeURIComponent(f.actor_id));
    if (f.action) params.push("action=" + encodeURIComponent(f.action));
    if (f.entity_type) params.push("entity_type=" + encodeURIComponent(f.entity_type));
    if (f.from) params.push("from=" + encodeURIComponent(f.from));
    if (f.to) params.push("to=" + encodeURIComponent(f.to));
    return "?" + params.join("&");
  }
  function loadActivityLog(offset) {
    offset = offset || 0;
    return api("/activity-log" + activityLogQueryString(offset)).then(function (data) {
      state.activityLog = offset === 0 ? data.rows : (state.activityLog || []).concat(data.rows);
      state.activityLogTotal = data.total;
      return data;
    });
  }
  function loadActivityLogFilterOptions() {
    return api("/activity-log/filters").then(function (data) {
      $("log-filter-actor").innerHTML = '<option value="">Everyone</option>' + (data.actors || []).map(function (a) {
        return '<option value="' + a.actor_id + '">' + esc(a.actor_name || ("User #" + a.actor_id)) + '</option>';
      }).join("");
      $("log-filter-entity").innerHTML = '<option value="">Any type</option>' + (data.entityTypes || []).map(function (t) {
        return '<option value="' + esc(t) + '">' + esc(t.replace(/_/g, " ")) + '</option>';
      }).join("");
      syncActivityLogFilterInputs();
    }).catch(function () {});
  }
  function syncActivityLogFilterInputs() {
    var f = state.activityLogFilters || {};
    $("log-filter-actor").value = f.actor_id || "";
    $("log-filter-action").value = f.action || "";
    $("log-filter-entity").value = f.entity_type || "";
    $("log-filter-from").value = f.from || "";
    $("log-filter-to").value = f.to || "";
  }
  function reloadActivityLogWithFilters() {
    loadActivityLog(0).then(renderActivityLog).catch(function (err) { toast(friendlyError(err), true); });
  }
  ["log-filter-actor", "log-filter-action", "log-filter-entity", "log-filter-from", "log-filter-to"].forEach(function (id) {
    $(id).addEventListener("change", function () {
      state.activityLogFilters.actor_id = $("log-filter-actor").value;
      state.activityLogFilters.action = $("log-filter-action").value;
      state.activityLogFilters.entity_type = $("log-filter-entity").value;
      state.activityLogFilters.from = $("log-filter-from").value;
      state.activityLogFilters.to = $("log-filter-to").value;
      reloadActivityLogWithFilters();
    });
  });
  $("log-filter-clear").addEventListener("click", function () {
    state.activityLogFilters = { actor_id: "", action: "", entity_type: "", from: "", to: "" };
    syncActivityLogFilterInputs();
    reloadActivityLogWithFilters();
  });
  function loadNotifications() {
    return api("/content/notifications").then(function (data) {
      state.notifications = data;
      updateNavBadge();
      renderContentNotify();
      return data;
    });
  }

  /* ====================== SALES DASHBOARD ====================== */
  function loadSalesDashboard() {
    return api("/dashboard/sales").then(function (data) {
      state.salesDashboard = data;
      renderSalesDashboard(data);
    });
  }
  function renderSalesDashboard(data) {
    var k = data.kpis;
    var tiles = [
      { label: "Open pipeline value", value: money(k.openValue), foot: k.openDealCount + " open deal" + (k.openDealCount === 1 ? "" : "s") },
      { label: "Won this month", value: money(k.wonValue), foot: k.wonCount + " deal" + (k.wonCount === 1 ? "" : "s") + " closed" },
      { label: "Win rate", value: k.winRate + "%", foot: k.closedCount + " closed deal" + (k.closedCount === 1 ? "" : "s") + " total" },
      { label: "Total contacts", value: String(k.totalContacts), foot: "across " + k.sourceCount + " sources" },
    ];
    $("sales-tiles").innerHTML = tiles.map(function (t) {
      return '<div class="tile"><div class="label">' + esc(t.label) + '</div><div class="value tabular">' + esc(t.value) + '</div><div class="foot">' + esc(t.foot) + '</div></div>';
    }).join("");

    var maxCount = Math.max.apply(null, data.funnel.map(function (a) { return a.count; }).concat([1]));
    $("sales-funnel").innerHTML = data.funnel.map(function (a) {
      var stg = stageOf(a.key);
      var pct = Math.round((a.count / maxCount) * 100);
      return '<div class="funnel-row"><div class="funnel-label">' + esc(stg.label) + '</div>' +
        '<div class="funnel-track"><div class="funnel-fill" style="width:' + Math.max(pct, a.count ? 6 : 0) + '%; background:' + stg.color + ';"></div></div>' +
        '<div class="funnel-value tabular">' + a.count + ' · ' + money(a.value) + '</div></div>';
    }).join("");

    $("sales-recent-deals").innerHTML = data.recentDeals.length ? data.recentDeals.map(function (d) {
      var stg = stageOf(d.stage);
      return '<div class="li"><span class="who">' + esc(initials(d.owner_name)) + '</span>' +
        '<div class="main-txt"><div class="t1">' + esc(d.title) + '</div><div class="t2">' + esc(d.company || d.contact_name || "") + ' · ' + moneyFull(d.value) + '</div></div>' +
        '<span class="pill"><span class="dot" style="background:' + stg.color + ';"></span>' + esc(stg.label) + '</span></div>';
    }).join("") : '<div class="empty-note">No deals yet — add your first one from Pipeline.</div>';

    $("sales-contacts").innerHTML = data.recentContacts.length ? data.recentContacts.map(function (c) {
      return '<div class="li"><span class="who">' + esc(initials(c.name)) + '</span>' +
        '<div class="main-txt"><div class="t1">' + esc(c.name) + '</div><div class="t2">' + esc(c.company || "") + '</div></div>' +
        '<div class="meta">' + esc(c.source || "") + '</div></div>';
    }).join("") : '<div class="empty-note">No contacts yet.</div>';
  }

  /* ====================== SOCIAL DASHBOARD ====================== */
  function loadSocialDashboard() {
    return api("/dashboard/social").then(function (data) {
      state.socialDashboard = data;
      if (data.statuses) state.statuses = data.statuses;
      renderSocialDashboard(data);
    });
  }
  function renderSocialDashboard(data) {
    var k = data.kpis;
    var isAdmin = state.user.role === "admin";
    var tiles = [
      { label: "Scheduled this week", value: String(k.scheduledThisWeek), foot: "posts dated in the next 7 days" },
      { label: "Needs attention", value: String(k.needsAttention), foot: "due or overdue, not yet finished" },
      { label: isAdmin ? "Active clients" : "Clients you handle", value: String(k.myClients), foot: isAdmin ? "across the agency" : "assigned to you" },
      { label: "Total posts tracked", value: String(k.totalPosts), foot: "across " + k.platformCount + " platform" + (k.platformCount === 1 ? "" : "s") },
    ];
    $("social-tiles").innerHTML = tiles.map(function (t) {
      return '<div class="tile"><div class="label">' + esc(t.label) + '</div><div class="value tabular">' + esc(t.value) + '</div><div class="foot">' + esc(t.foot) + '</div></div>';
    }).join("");

    var statuses = data.statuses || state.statuses;
    var maxN = Math.max.apply(null, statuses.map(function (s) { return data.byStatus[s.key] || 0; }).concat([1]));
    $("social-status-chart").innerHTML = statuses.map(function (s) {
      var n = data.byStatus[s.key] || 0;
      var pct = Math.round((n / maxN) * 100);
      return '<div class="funnel-row"><div class="funnel-label">' + esc(s.label) + '</div>' +
        '<div class="funnel-track"><div class="funnel-fill" style="width:' + Math.max(pct, n ? 6 : 0) + '%; background:' + s.color + ';"></div></div>' +
        '<div class="funnel-value tabular">' + n + '</div></div>';
    }).join("");

    $("social-upcoming").innerHTML = data.upcoming.length ? data.upcoming.map(function (p) {
      var plat = platformOf(p.platform);
      return '<div class="li"><span class="pill"><span class="dot" style="background:' + plat.cat + ';"></span>' + esc(plat.label) + '</span>' +
        '<div class="main-txt"><div class="t1">' + esc(p.title) + '</div><div class="t2">' + esc(p.client_name || "Internal / Agency") + '</div></div>' +
        '<div class="meta tabular">' + fmtDate(p.scheduled_date) + '</div></div>';
    }).join("") : '<div class="empty-note">Nothing scheduled in the next 7 days.</div>';

    $("social-recent").innerHTML = data.recentPosts.length ? data.recentPosts.map(function (p) {
      return '<div class="li"><span class="who">' + esc(initials(p.owner_name)) + '</span>' +
        '<div class="main-txt"><div class="t1">' + esc(p.title) + '</div><div class="t2">' + esc(p.client_name || "Internal / Agency") + '</div></div>' +
        statusPillHtml(p.status) + '</div>';
    }).join("") : '<div class="empty-note">No posts yet.</div>';
  }

  /* ====================== PIPELINE ====================== */
  var dragDealId = null;
  function renderPipeline() {
    var deals = state.deals;
    var canWrite = state.user.role === "admin" || state.user.role === "sales";
    var totalOpen = deals.filter(function (d) { return OPEN_STAGE_KEYS.indexOf(d.stage) !== -1; }).length;
    var totalValue = deals.filter(function (d) { return OPEN_STAGE_KEYS.indexOf(d.stage) !== -1; }).reduce(function (s, d) { return s + (Number(d.value) || 0); }, 0);
    $("pipeline-summary").textContent = totalOpen + " open deals · " + moneyFull(totalValue) + " in play";
    $("primary-action").style.display = canWrite ? "" : "none";

    var board = $("board");
    board.classList.toggle("readonly", !canWrite);
    board.innerHTML = STAGES.map(function (stg) {
      var ds = deals.filter(function (d) { return d.stage === stg.key; }).sort(function (a, b) { return (b.updated_at || "").localeCompare(a.updated_at || ""); });
      var sum = ds.reduce(function (s, d) { return s + (Number(d.value) || 0); }, 0);
      return '<div class="column" data-stage="' + stg.key + '">' +
        '<div class="column-head"><span class="stage-dot" style="background:' + stg.color + ';"></span><h4>' + esc(stg.label) + '</h4><span class="n">' + ds.length + '</span></div>' +
        '<div class="column-sum tabular">' + moneyFull(sum) + '</div>' +
        ds.map(function (d) {
          return '<div class="card" draggable="' + canWrite + '" data-deal="' + d.id + '">' +
            '<div class="card-title">' + esc(d.title) + '</div>' +
            '<div class="card-contact">' + esc(d.company || d.contact_name || "No contact linked") + '</div>' +
            '<div class="card-foot"><span class="card-value tabular">' + money(d.value) + '</span>' +
            '<span style="display:flex; align-items:center; gap:6px;"><span class="card-date tabular">' + fmtDate(d.close_date) + '</span><span class="who">' + esc(initials(d.owner_name)) + '</span></span></div></div>';
        }).join("") +
        (canWrite ? '<button class="add-card-btn" data-add-stage="' + stg.key + '">+ Add deal</button>' : "") +
        '</div>';
    }).join("");

    board.querySelectorAll(".card").forEach(function (card) {
      card.addEventListener("click", function () {
        var deal = state.deals.find(function (d) { return d.id === Number(card.dataset.deal); });
        if (deal) openDealModal(deal);
      });
      if (canWrite) {
        card.addEventListener("dragstart", function (e) { dragDealId = card.dataset.deal; e.dataTransfer.effectAllowed = "move"; });
      }
    });
    if (canWrite) {
      board.querySelectorAll(".column").forEach(function (col) {
        col.addEventListener("dragover", function (e) { e.preventDefault(); col.classList.add("dragover"); });
        col.addEventListener("dragleave", function () { col.classList.remove("dragover"); });
        col.addEventListener("drop", function (e) {
          e.preventDefault();
          col.classList.remove("dragover");
          if (!dragDealId) return;
          var deal = state.deals.find(function (d) { return d.id === Number(dragDealId); });
          dragDealId = null;
          if (!deal) return;
          var newStage = col.dataset.stage;
          if (newStage === deal.stage) return;
          api("/deals/" + deal.id, { method: "PATCH", body: { stage: newStage } })
            .then(function () { toast(deal.title + " → " + stageOf(newStage).label); return loadDeals(); })
            .then(renderPipeline)
            .catch(function (err) { toast(friendlyError(err), true); });
        });
      });
      board.querySelectorAll("[data-add-stage]").forEach(function (btn) {
        btn.addEventListener("click", function () { openDealModal(null, btn.dataset.addStage); });
      });
    }
  }

  /* ====================== CONTACTS ====================== */
  function renderContactFilters() {
    var used = Array.from(new Set(state.contacts.map(function (c) { return c.source; }).filter(Boolean)));
    $("source-filters").innerHTML = used.map(function (s) {
      return '<button class="chip-filter' + (state.contactSourceFilter === s ? " active" : "") + '" data-source="' + esc(s) + '">' + esc(s) + '</button>';
    }).join("");
    $("source-filters").querySelectorAll("[data-source]").forEach(function (b) {
      b.addEventListener("click", function () {
        state.contactSourceFilter = state.contactSourceFilter === b.dataset.source ? null : b.dataset.source;
        renderContacts();
      });
    });
  }
  function renderContacts() {
    renderContactFilters();
    var list = state.contacts.slice();
    if (state.contactSearch) {
      var q = state.contactSearch.toLowerCase();
      list = list.filter(function (c) { return (c.name || "").toLowerCase().indexOf(q) !== -1 || (c.company || "").toLowerCase().indexOf(q) !== -1; });
    }
    if (state.contactSourceFilter) list = list.filter(function (c) { return c.source === state.contactSourceFilter; });
    list.sort(function (a, b) { return (b.created_at || "").localeCompare(a.created_at || ""); });

    $("contacts-tbody").innerHTML = list.length ? list.map(function (c) {
      var tags = (c.tags || []).map(function (t) { return '<span class="pill">' + esc(t) + '</span>'; }).join("");
      return '<tr data-id="' + c.id + '">' +
        '<td><div class="contact-name">' + esc(c.name) + '</div><div class="contact-company">' + esc(c.company || "") + '</div></td>' +
        '<td>' + esc(c.source || "—") + '</td>' +
        '<td><div class="tagset">' + (tags || '<span class="field-hint">—</span>') + '</div></td>' +
        '<td><span class="who" style="display:inline-flex;">' + esc(initials(c.owner_name)) + '</span></td>' +
        '<td class="tabular">' + fmtDate(c.created_at) + '</td>' +
        '<td><div class="row-actions"><button class="icon-btn" data-edit="' + c.id + '" title="Edit"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg></button></div></td></tr>';
    }).join("") : '<tr><td colspan="6"><div class="empty-note">No contacts match — try clearing filters.</div></td></tr>';

    $("contacts-tbody").querySelectorAll("[data-edit]").forEach(function (b) {
      b.addEventListener("click", function (e) {
        e.stopPropagation();
        var c = state.contacts.find(function (x) { return x.id === Number(b.dataset.edit); });
        if (c) openContactModal(c);
      });
    });
    $("contacts-tbody").querySelectorAll("tr[data-id]").forEach(function (tr) {
      tr.addEventListener("click", function () {
        var c = state.contacts.find(function (x) { return x.id === Number(tr.dataset.id); });
        if (c) openContactModal(c);
      });
    });
  }
  $("contact-search").addEventListener("input", function (e) { state.contactSearch = e.target.value; renderContacts(); });

  /* ====================== CONTENT CALENDAR ====================== */
  function monthMatrix(monthDate) {
    var year = monthDate.getFullYear(), month = monthDate.getMonth();
    var firstOfMonth = new Date(year, month, 1);
    var startOffset = firstOfMonth.getDay();
    var daysInMonth = new Date(year, month + 1, 0).getDate();
    var prevMonthDays = new Date(year, month, 0).getDate();
    var cells = [];
    for (var i = startOffset - 1; i >= 0; i--) cells.push({ date: fmtISO(new Date(year, month - 1, prevMonthDays - i)), inMonth: false });
    for (var d = 1; d <= daysInMonth; d++) cells.push({ date: fmtISO(new Date(year, month, d)), inMonth: true });
    var next = 1;
    while (cells.length % 7 !== 0) { cells.push({ date: fmtISO(new Date(year, month + 1, next)), inMonth: false }); next++; }
    return cells;
  }

  function filteredContent() {
    var list = state.content.slice();
    if (state.contentPlatformFilter) list = list.filter(function (p) { return p.platform === state.contentPlatformFilter; });
    if (state.contentStatusFilter) list = list.filter(function (p) { return p.status === state.contentStatusFilter; });
    if (state.contentClientFilter === "__internal__") list = list.filter(function (p) { return !p.client_id; });
    else if (state.contentClientFilter) list = list.filter(function (p) { return p.client_id === Number(state.contentClientFilter); });
    return list;
  }

  function renderContentFilters() {
    $("platform-filters").innerHTML = PLATFORMS.map(function (p) {
      return '<button class="chip-filter' + (state.contentPlatformFilter === p.key ? " active" : "") + '" data-plat="' + p.key + '"><span class="dot" style="display:inline-block;width:6px;height:6px;border-radius:50%;background:' + p.cat + ';margin-right:5px;"></span>' + esc(p.label) + '</button>';
    }).join("");
    $("platform-filters").querySelectorAll("[data-plat]").forEach(function (b) {
      b.addEventListener("click", function () { state.contentPlatformFilter = state.contentPlatformFilter === b.dataset.plat ? null : b.dataset.plat; renderCalendar(); });
    });

    var clientChips = '<button class="chip-filter' + (!state.contentClientFilter ? " active" : "") + '" data-client="">All clients</button>' +
      '<button class="chip-filter' + (state.contentClientFilter === "__internal__" ? " active" : "") + '" data-client="__internal__">Internal / Agency</button>' +
      state.clients.map(function (c) {
        return '<button class="chip-filter' + (state.contentClientFilter === String(c.id) ? " active" : "") + '" data-client="' + c.id + '">' + esc(c.name) + '</button>';
      }).join("");
    $("client-filters").innerHTML = clientChips;
    $("client-filters").querySelectorAll("[data-client]").forEach(function (b) {
      b.addEventListener("click", function () {
        var v = b.dataset.client;
        state.contentClientFilter = v === "" ? null : (state.contentClientFilter === v ? null : v);
        renderCalendar();
      });
    });

    $("status-filters").innerHTML = state.statuses.map(function (s) {
      return '<button class="chip-filter' + (state.contentStatusFilter === s.key ? " active" : "") + '" data-stat="' + s.key + '"><span class="dot" style="display:inline-block;width:6px;height:6px;border-radius:50%;background:' + s.color + ';margin-right:5px;"></span>' + esc(s.label) + '</button>';
    }).join("");
    $("status-filters").querySelectorAll("[data-stat]").forEach(function (b) {
      b.addEventListener("click", function () { state.contentStatusFilter = state.contentStatusFilter === b.dataset.stat ? null : b.dataset.stat; renderCalendar(); });
    });

    $("manage-statuses-btn").style.display = state.user.role === "admin" ? "" : "none";
  }

  function exportQueryString() {
    var params = [];
    if (state.contentPlatformFilter) params.push("platform=" + encodeURIComponent(state.contentPlatformFilter));
    if (state.contentStatusFilter) params.push("status=" + encodeURIComponent(state.contentStatusFilter));
    if (state.contentClientFilter) params.push("client_id=" + encodeURIComponent(state.contentClientFilter));
    return params.length ? "?" + params.join("&") : "";
  }
  function updateExportLinks() {
    var qs = exportQueryString();
    $("export-xlsx-btn").href = "/api/export/content.xlsx" + qs;
    $("export-pdf-btn").href = "/api/export/content.pdf" + qs;
  }
  function updateContentViewToggle() {
    $("content-view-tabs").querySelectorAll("[data-content-view]").forEach(function (b) {
      b.classList.toggle("active", b.dataset.contentView === state.contentViewMode);
    });
    $("calendar").style.display = state.contentViewMode === "calendar" ? "" : "none";
    $("content-list-panel").style.display = state.contentViewMode === "list" ? "" : "none";
    $("content-grid-panel").style.display = state.contentViewMode === "grid" ? "" : "none";
  }
  $("content-view-tabs").addEventListener("click", function (e) {
    var btn = e.target.closest("[data-content-view]");
    if (!btn) return;
    state.contentViewMode = btn.dataset.contentView;
    updateContentViewToggle();
  });

  function updateNavBadge() {
    var el = $("nav-count-content");
    if (!el) return;
    var n = state.notifications || { awaitingReview: [], needsAttention: [] };
    var role = state.user.role;
    var count = 0;
    if (role === "admin") count = n.awaitingReview.length + n.needsAttention.length;
    else if (role === "social") count = n.awaitingReview.length;
    else if (role === "designer") count = n.needsAttention.length;
    el.textContent = count > 0 ? String(count) : "";
  }
  function renderContentNotify() {
    var panel = $("content-notify-panel");
    if (!panel) return;
    var n = state.notifications || { awaitingReview: [], needsAttention: [] };
    var role = state.user.role;
    var groups = [];
    if ((role === "social" || role === "admin") && n.awaitingReview.length) {
      groups.push({ label: "Awaiting your review (" + n.awaitingReview.length + ")", items: n.awaitingReview });
    }
    if ((role === "designer" || role === "admin") && n.needsAttention.length) {
      groups.push({ label: "Changes requested — needs a re-upload (" + n.needsAttention.length + ")", items: n.needsAttention });
    }
    if (!groups.length) { panel.hidden = true; return; }
    panel.hidden = false;
    $("content-notify-list").innerHTML = groups.map(function (g) {
      return '<div class="notify-group-label">' + esc(g.label) + '</div>' + g.items.map(function (it) {
        return '<div class="li" data-post="' + it.post_id + '" style="cursor:pointer;">' +
          '<div class="main-txt"><div class="t1">' + esc(it.post_title) + '</div><div class="t2">' + esc(it.client_name) + ' · ' + esc(it.filename) + '</div></div></div>';
      }).join("");
    }).join("");
    $("content-notify-list").querySelectorAll("[data-post]").forEach(function (el) {
      el.addEventListener("click", function () {
        var p = state.content.find(function (x) { return x.id === Number(el.dataset.post); });
        if (p) openContentModal(p);
      });
    });
  }

  function renderContentList() {
    var list = filteredContent().slice().sort(function (a, b) { return (a.scheduled_date || "").localeCompare(b.scheduled_date || ""); });
    $("content-list-tbody").innerHTML = list.length ? list.map(function (p) {
      var pt = postTypeOf(p.post_type);
      var plat = platformOf(p.platform);
      return '<tr data-id="' + p.id + '">' +
        '<td class="tabular">' + fmtDate(p.scheduled_date) + '</td>' +
        '<td>' + esc(p.client_name || "Internal / Agency") + '</td>' +
        '<td><span class="pill"><span class="dot" style="background:' + plat.cat + ';"></span>' + esc(plat.label) + '</span></td>' +
        '<td>' + esc(pt.label) + '</td>' +
        '<td>' + statusPillHtml(p.status) + '</td>' +
        '<td>' + esc(p.title) + '</td></tr>';
    }).join("") : '<tr><td colspan="6"><div class="empty-note">No posts match — try clearing filters.</div></td></tr>';
    $("content-list-tbody").querySelectorAll("tr[data-id]").forEach(function (tr) {
      tr.addEventListener("click", function () {
        var p = state.content.find(function (x) { return x.id === Number(tr.dataset.id); });
        if (p) openContentModal(p);
      });
    });
  }

  /* ====================== CONTENT GRID (spreadsheet-style inline editing) ====================== */
  function gridSelectOptions(items, labelKey, keyKey, selected) {
    return items.map(function (it) {
      var key = it[keyKey], label = it[labelKey];
      return '<option value="' + esc(key) + '"' + (selected === key ? " selected" : "") + '>' + esc(label) + '</option>';
    }).join("");
  }
  function gridRowHtml(p, canWrite) {
    var dis = canWrite ? "" : " disabled";
    return '<tr data-id="' + p.id + '">' +
      '<td><input type="date" class="grid-cell" data-field="scheduled_date" value="' + esc(p.scheduled_date || "") + '"' + dis + '></td>' +
      '<td class="grid-client-cell">' + esc(p.client_name || "Internal / Agency") + '</td>' +
      '<td><select class="grid-cell" data-field="platform"' + dis + '>' + gridSelectOptions(PLATFORMS, "label", "key", p.platform) + '</select></td>' +
      '<td><select class="grid-cell" data-field="post_type"' + dis + '>' + gridSelectOptions(POST_TYPES, "label", "key", p.post_type) + '</select></td>' +
      '<td><select class="grid-cell" data-field="status"' + dis + '>' + gridSelectOptions(state.statuses, "label", "key", p.status) + '</select></td>' +
      '<td><input type="text" class="grid-cell" data-field="title" value="' + esc(p.title) + '"' + dis + '></td>' +
      '<td class="grid-row-actions">' +
        '<button class="icon-btn" type="button" data-open-full="' + p.id + '" title="Full details"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg></button>' +
        (canWrite ? '<button class="icon-btn" type="button" data-grid-delete="' + p.id + '" title="Delete"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13"/></svg></button>' : "") +
      '</td></tr>';
  }
  function saveGridCell(postId, field, value, cellEl) {
    if (field === "title" && !value.trim()) { toast("Title can't be empty"); return; }
    var body = {};
    body[field] = value;
    cellEl.classList.remove("cell-saved");
    cellEl.classList.add("cell-saving");
    api("/content/" + postId, { method: "PATCH", body: body }).then(function (row) {
      cellEl.classList.remove("cell-saving");
      cellEl.classList.add("cell-saved");
      setTimeout(function () { cellEl.classList.remove("cell-saved"); }, 700);
      var idx = state.content.findIndex(function (x) { return x.id === postId; });
      if (idx !== -1) state.content[idx] = row;
      refreshOtherContentViews();
    }).catch(function (err) {
      cellEl.classList.remove("cell-saving");
      toast(friendlyError(err), true);
    });
  }
  function wireGridRowEvents() {
    $("content-grid-tbody").querySelectorAll("tr[data-id]").forEach(function (tr) {
      var postId = Number(tr.dataset.id);
      tr.querySelectorAll(".grid-cell").forEach(function (cell) {
        var isTextInput = cell.tagName === "INPUT" && cell.type === "text";
        cell.addEventListener(isTextInput ? "blur" : "change", function () {
          saveGridCell(postId, cell.dataset.field, cell.value, cell);
        });
        if (isTextInput) {
          cell.addEventListener("keydown", function (e) { if (e.key === "Enter") cell.blur(); });
        }
      });
    });
    $("content-grid-tbody").querySelectorAll("[data-open-full]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var p = state.content.find(function (x) { return x.id === Number(btn.dataset.openFull); });
        if (p) openContentModal(p);
      });
    });
    $("content-grid-tbody").querySelectorAll("[data-grid-delete]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var p = state.content.find(function (x) { return x.id === Number(btn.dataset.gridDelete); });
        if (!p) return;
        if (!window.confirm('Delete "' + p.title + '"? This can\'t be undone.')) return;
        api("/content/" + p.id, { method: "DELETE" }).then(function () {
          toast("Post deleted");
          return loadContent();
        }).then(function () { renderCalendar(); }).catch(function (err) { toast(friendlyError(err), true); });
      });
    });
  }
  function renderContentGrid() {
    var panel = $("content-grid-panel");
    if (!panel) return;
    var canWrite = state.user.role === "admin" || state.user.role === "social";
    $("grid-add-row-btn").style.display = canWrite ? "" : "none";
    var list = filteredContent().slice().sort(function (a, b) { return (a.scheduled_date || "").localeCompare(b.scheduled_date || ""); });
    $("content-grid-tbody").innerHTML = list.length ? list.map(function (p) { return gridRowHtml(p, canWrite); }).join("")
      : '<tr><td colspan="7"><div class="empty-note">No posts match — try clearing filters, or add one below.</div></td></tr>';
    wireGridRowEvents();
  }
  $("grid-add-row-btn").addEventListener("click", function () {
    var clientId = state.contentClientFilter === "__internal__" ? null : (state.contentClientFilter || null);
    var body = {
      title: "New post",
      platform: PLATFORMS[0].key,
      post_type: "static",
      status: (state.statuses[0] || {}).key,
      scheduled_date: fmtISO(new Date()),
      client_id: clientId,
      owner_id: state.user.id,
    };
    api("/content", { method: "POST", body: body }).then(function (row) {
      state.content.push(row);
      renderContentGrid();
      refreshOtherContentViews();
      toast("Post added — edit the cells below");
      setTimeout(function () {
        var tr = $("content-grid-tbody").querySelector('tr[data-id="' + row.id + '"]');
        var titleInput = tr && tr.querySelector('[data-field="title"]');
        if (titleInput) { titleInput.focus(); titleInput.select(); }
      }, 30);
    }).catch(function (err) { toast(friendlyError(err), true); });
  });

  function renderCalendar() {
    renderContentFilters();
    var canWrite = state.user.role === "admin" || state.user.role === "social";
    $("primary-action").style.display = canWrite ? "" : "none";
    renderContentList();
    renderContentGrid();
    renderCalendarMonthGrid(canWrite);
    updateContentViewToggle();
    updateExportLinks();
  }
  // Refreshes the month view and the List table from the current in-memory
  // state.content — used after an inline Grid edit so switching tabs never
  // shows stale data, without touching the Grid's own DOM (which would blow
  // away focus/the save-flash animation on the cell just edited).
  function refreshOtherContentViews() {
    renderContentList();
    renderCalendarMonthGrid(state.user.role === "admin" || state.user.role === "social");
  }
  function renderCalendarMonthGrid(canWrite) {
    var monthDate = state.calendarMonth;
    $("cal-month-label").textContent = monthDate.toLocaleDateString("en-US", { month: "long", year: "numeric" });

    var list = filteredContent();
    var byDate = {};
    list.forEach(function (p) {
      var key = p.scheduled_date || "";
      if (!key) return;
      (byDate[key] = byDate[key] || []).push(p);
    });

    var cells = monthMatrix(monthDate);
    var todayISO = fmtISO(new Date());
    var weekdayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    var html = weekdayNames.map(function (w) { return '<div class="calendar-weekday">' + w + '</div>'; }).join("");
    html += cells.map(function (cell) {
      var posts = (byDate[cell.date] || []).slice().sort(function (a, b) { return (a.title || "").localeCompare(b.title || ""); });
      var dayNum = Number(cell.date.slice(8, 10));
      var classes = "calendar-day" + (cell.inMonth ? "" : " outside") + (cell.date === todayISO ? " today" : "");
      var addBtn = canWrite ? '<button class="day-add" data-add-date="' + cell.date + '" title="Add post"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M12 5v14M5 12h14"/></svg></button>' : "";
      var chips = posts.map(function (p) {
        var st = contentStatusOf(p.status);
        var pt = postTypeOf(p.post_type);
        return '<div class="post-chip" data-id="' + p.id + '" style="border-left-color:' + st.color + ';" title="' + esc(p.title) + ' — ' + esc(st.label) + '">' +
          '<div class="pc-title">' + esc(p.title) + '</div>' +
          '<div class="pc-meta">' + esc(pt.label) + ' · ' + esc(p.client_name || "Internal") + '</div></div>';
      }).join("");
      return '<div class="' + classes + '"><div class="day-head"><span class="day-num">' + dayNum + '</span>' + addBtn + '</div><div class="day-posts">' + chips + '</div></div>';
    }).join("");
    $("calendar-grid").innerHTML = html;

    $("calendar-grid").querySelectorAll(".post-chip").forEach(function (chip) {
      chip.addEventListener("click", function () {
        var p = state.content.find(function (x) { return x.id === Number(chip.dataset.id); });
        if (p) openContentModal(p);
      });
    });
    if (canWrite) {
      $("calendar-grid").querySelectorAll("[data-add-date]").forEach(function (btn) {
        btn.addEventListener("click", function (e) { e.stopPropagation(); openContentModal(null, null, btn.dataset.addDate); });
      });
    }
  }
  $("cal-prev").addEventListener("click", function () {
    state.calendarMonth = new Date(state.calendarMonth.getFullYear(), state.calendarMonth.getMonth() - 1, 1);
    renderCalendar();
  });
  $("cal-next").addEventListener("click", function () {
    state.calendarMonth = new Date(state.calendarMonth.getFullYear(), state.calendarMonth.getMonth() + 1, 1);
    renderCalendar();
  });
  $("cal-today").addEventListener("click", function () {
    var n = new Date();
    state.calendarMonth = new Date(n.getFullYear(), n.getMonth(), 1);
    renderCalendar();
  });
  $("manage-statuses-btn").addEventListener("click", openStatusModal);

  /* ====================== TEAM ====================== */
  function renderTeam() {
    var rows = state.teamFull || [];
    $("team-tbody").innerHTML = rows.length ? rows.map(function (u) {
      var clientPills = (u.clients || []).map(function (c) { return '<span class="pill">' + esc(c.name) + '</span>'; }).join(" ");
      return '<tr data-id="' + u.id + '">' +
        '<td><span class="who" style="display:inline-flex; margin-right:8px;">' + esc(initials(u.name)) + '</span>' + esc(u.name) + (u.id === state.user.id ? ' <span class="field-hint">(you)</span>' : '') + '</td>' +
        '<td>' + esc(u.email) + '</td>' +
        '<td><span class="pill role-' + u.role + '">' + esc(roleLabel(u.role)) + '</span></td>' +
        '<td><div class="tagset">' + (clientPills || '<span class="field-hint">—</span>') + '</div></td>' +
        '<td class="tabular">' + fmtDate((u.created_at || "").slice(0, 10)) + '</td>' +
        '<td><div class="row-actions"><button class="icon-btn" data-edit="' + u.id + '" title="Edit"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg></button></div></td></tr>';
    }).join("") : '<tr><td colspan="6"><div class="empty-note">No teammates yet.</div></td></tr>';

    $("team-tbody").querySelectorAll("[data-edit]").forEach(function (b) {
      b.addEventListener("click", function () {
        var u = (state.teamFull || []).find(function (x) { return x.id === Number(b.dataset.edit); });
        if (u) openUserModal(u);
      });
    });
  }

  /* ====================== CLIENTS ====================== */
  function renderClients() {
    var list = state.clients.slice().sort(function (a, b) { return a.name.localeCompare(b.name); });
    $("clients-board").innerHTML = list.length ? list.map(function (c) {
      var handlers = (c.handlers || []).map(function (h) { return '<span class="pill">' + esc(h.name) + '</span>'; }).join("");
      return '<div class="content-card" data-id="' + c.id + '" style="cursor:pointer;">' +
        '<div class="top-row"><div class="title">' + esc(c.name) + '</div></div>' +
        (c.notes ? '<div class="meta-row">' + esc(c.notes) + '</div>' : "") +
        '<div class="handlers">' + (handlers || '<span class="field-hint">Unassigned — assign from Team</span>') + '</div></div>';
    }).join("") : '<div class="empty-note">No clients yet — add your first one.</div>';

    $("clients-board").querySelectorAll("[data-id]").forEach(function (card) {
      card.addEventListener("click", function () {
        var c = state.clients.find(function (x) { return x.id === Number(card.dataset.id); });
        if (c) openClientModal(c);
      });
    });
  }

  /* ====================== owner dropdown helper ====================== */
  function ownerOptionsHtml(selectedId) {
    return (state.team || []).map(function (u) {
      return '<option value="' + u.id + '"' + (Number(selectedId) === u.id ? " selected" : "") + '>' + esc(u.name) + '</option>';
    }).join("");
  }

  /* ====================== DEAL MODAL ====================== */
  var editingDeal = null;
  function openDealModal(deal, presetStage) {
    editingDeal = deal;
    $("deal-modal-title").textContent = deal ? "Edit deal" : "Add deal";
    $("deal-title").value = deal ? deal.title : "";
    var contactOpts = '<option value="">No contact linked</option>' + state.contacts.map(function (c) {
      return '<option value="' + c.id + '"' + (deal && deal.contact_id === c.id ? " selected" : "") + '>' + esc(c.name) + ' — ' + esc(c.company || "") + '</option>';
    }).join("");
    $("deal-contact").innerHTML = contactOpts;
    $("deal-value").value = deal ? deal.value : "";
    $("deal-stage").innerHTML = STAGES.map(function (s) { return '<option value="' + s.key + '"' + ((deal ? deal.stage : presetStage) === s.key ? " selected" : "") + '>' + esc(s.label) + '</option>'; }).join("");
    $("deal-close").value = deal ? (deal.close_date || "") : "";
    $("deal-owner").innerHTML = ownerOptionsHtml(deal ? deal.owner_id : state.user.id);
    $("deal-notes").value = deal ? (deal.notes || "") : "";
    $("deal-delete").style.display = deal ? "" : "none";
    $("deal-overlay").classList.add("open");
    setTimeout(function () { $("deal-title").focus(); }, 30);
  }
  $("deal-save").addEventListener("click", function () {
    var title = $("deal-title").value.trim();
    if (!title) { toast("Give the deal a title first"); $("deal-title").focus(); return; }
    var body = {
      title: title,
      contact_id: $("deal-contact").value || null,
      value: Number($("deal-value").value) || 0,
      stage: $("deal-stage").value,
      close_date: $("deal-close").value || "",
      owner_id: Number($("deal-owner").value),
      notes: $("deal-notes").value.trim(),
    };
    var req = editingDeal ? api("/deals/" + editingDeal.id, { method: "PATCH", body: body }) : api("/deals", { method: "POST", body: body });
    req.then(function () {
      toast(editingDeal ? "Deal updated" : "Deal added");
      closeModals();
      return loadDeals();
    }).then(function () {
      if (currentView === "pipeline") renderPipeline();
      if (currentView === "dashboard-sales") loadSalesDashboard();
    }).catch(function (err) { toast(friendlyError(err), true); });
  });
  $("deal-delete").addEventListener("click", function () {
    if (!editingDeal) return;
    if (!window.confirm('Delete "' + editingDeal.title + '"? This can\'t be undone.')) return;
    api("/deals/" + editingDeal.id, { method: "DELETE" }).then(function () {
      toast("Deal deleted"); closeModals(); return loadDeals();
    }).then(function () { if (currentView === "pipeline") renderPipeline(); }).catch(function (err) { toast(friendlyError(err), true); });
  });

  /* ====================== CONTACT MODAL ====================== */
  var editingContact = null;
  function openContactModal(contact) {
    editingContact = contact;
    $("contact-modal-title").textContent = contact ? "Edit contact" : "Add contact";
    $("contact-name").value = contact ? contact.name : "";
    $("contact-company").value = contact ? contact.company : "";
    $("contact-email").value = contact ? contact.email : "";
    $("contact-phone").value = contact ? contact.phone : "";
    $("contact-source").innerHTML = SOURCES.map(function (s) { return '<option value="' + esc(s) + '"' + ((contact ? contact.source : SOURCES[0]) === s ? " selected" : "") + '>' + esc(s) + '</option>'; }).join("");
    $("contact-owner").innerHTML = ownerOptionsHtml(contact ? contact.owner_id : state.user.id);
    $("contact-tags").value = contact ? (contact.tags || []).join(", ") : "";
    $("contact-notes").value = contact ? (contact.notes || "") : "";
    $("contact-delete").style.display = contact ? "" : "none";
    $("contact-overlay").classList.add("open");
    setTimeout(function () { $("contact-name").focus(); }, 30);
  }
  $("contact-save").addEventListener("click", function () {
    var name = $("contact-name").value.trim();
    if (!name) { toast("Give the contact a name first"); $("contact-name").focus(); return; }
    var body = {
      name: name,
      company: $("contact-company").value.trim(),
      email: $("contact-email").value.trim(),
      phone: $("contact-phone").value.trim(),
      source: $("contact-source").value,
      owner_id: Number($("contact-owner").value),
      tags: $("contact-tags").value.split(",").map(function (t) { return t.trim(); }).filter(Boolean),
      notes: $("contact-notes").value.trim(),
    };
    var req = editingContact ? api("/contacts/" + editingContact.id, { method: "PATCH", body: body }) : api("/contacts", { method: "POST", body: body });
    req.then(function () {
      toast(editingContact ? "Contact updated" : "Contact added");
      closeModals();
      return loadContacts();
    }).then(function () {
      if (currentView === "contacts") renderContacts();
      if (currentView === "dashboard-sales") loadSalesDashboard();
    }).catch(function (err) { toast(friendlyError(err), true); });
  });
  $("contact-delete").addEventListener("click", function () {
    if (!editingContact) return;
    if (!window.confirm("Delete " + editingContact.name + "? This can't be undone.")) return;
    api("/contacts/" + editingContact.id, { method: "DELETE" }).then(function () {
      toast("Contact deleted"); closeModals(); return loadContacts();
    }).then(function () { if (currentView === "contacts") renderContacts(); }).catch(function (err) { toast(friendlyError(err), true); });
  });

  /* ====================== CONTENT MODAL ====================== */
  var editingContent = null;
  function clientOptionsHtml(selectedId) {
    var opts = '<option value="">No client / Internal</option>';
    opts += state.clients.map(function (c) {
      return '<option value="' + c.id + '"' + (Number(selectedId) === c.id ? " selected" : "") + '>' + esc(c.name) + '</option>';
    }).join("");
    return opts;
  }
  function openContentModal(item, presetStage, presetDate) {
    editingContent = item;
    var canEditPost = state.user.role === "admin" || state.user.role === "social";
    $("content-modal-title").textContent = item ? (canEditPost ? "Edit post" : "Post details") : "Add post";
    $("content-title").value = item ? item.title : "";
    $("content-client").innerHTML = clientOptionsHtml(item ? item.client_id : null);
    $("content-platform").innerHTML = PLATFORMS.map(function (p) { return '<option value="' + p.key + '"' + ((item ? item.platform : PLATFORMS[0].key) === p.key ? " selected" : "") + '>' + esc(p.label) + '</option>'; }).join("");
    $("content-type").innerHTML = POST_TYPES.map(function (t) { return '<option value="' + t.key + '"' + ((item ? item.post_type : "static") === t.key ? " selected" : "") + '>' + esc(t.label) + '</option>'; }).join("");
    $("content-status").innerHTML = state.statuses.map(function (s) { return '<option value="' + s.key + '"' + ((item ? item.status : (state.statuses[0] || {}).key) === s.key ? " selected" : "") + '>' + esc(s.label) + '</option>'; }).join("");
    $("content-date").value = item ? (item.scheduled_date || "") : (presetDate || "");
    $("content-owner").innerHTML = ownerOptionsHtml(item ? item.owner_id : state.user.id);
    $("content-campaign").value = item ? (item.campaign || "") : "";
    $("content-notes").value = item ? (item.notes || "") : "";
    $("content-reference-notes").value = item ? (item.reference_notes || "") : "";

    ["content-title", "content-client", "content-platform", "content-type", "content-status", "content-date", "content-owner", "content-campaign", "content-notes", "content-reference-notes"].forEach(function (id) {
      $(id).disabled = !canEditPost;
    });
    $("content-save").style.display = canEditPost ? "" : "none";
    $("content-delete").style.display = (canEditPost && item) ? "" : "none";

    if (item) {
      $("creatives-section").hidden = false;
      $("creatives-list").innerHTML = '<div class="creatives-empty">Loading…</div>';
      loadCreativesInto(item.id);
      $("references-section").hidden = false;
      $("references-list").innerHTML = '<div class="creatives-empty">Loading…</div>';
      loadReferencesInto(item.id);
    } else {
      $("creatives-section").hidden = true;
      $("creatives-list").innerHTML = "";
      $("references-section").hidden = true;
      $("references-list").innerHTML = "";
    }

    $("content-overlay").classList.add("open");
    setTimeout(function () { $("content-title").focus(); }, 30);
  }
  $("content-save").addEventListener("click", function () {
    var title = $("content-title").value.trim();
    if (!title) { toast("Give the post a title first"); $("content-title").focus(); return; }
    var body = {
      title: title,
      client_id: $("content-client").value || null,
      platform: $("content-platform").value,
      post_type: $("content-type").value,
      status: $("content-status").value,
      scheduled_date: $("content-date").value || "",
      owner_id: Number($("content-owner").value),
      campaign: $("content-campaign").value.trim(),
      notes: $("content-notes").value.trim(),
      reference_notes: $("content-reference-notes").value.trim(),
    };
    var req = editingContent ? api("/content/" + editingContent.id, { method: "PATCH", body: body }) : api("/content", { method: "POST", body: body });
    req.then(function () {
      toast(editingContent ? "Post updated" : "Post added");
      closeModals();
      return loadContent();
    }).then(function () {
      if (currentView === "content") renderCalendar();
      if (currentView === "dashboard-social") loadSocialDashboard();
    }).catch(function (err) { toast(friendlyError(err), true); });
  });
  $("content-delete").addEventListener("click", function () {
    if (!editingContent) return;
    if (!window.confirm('Delete "' + editingContent.title + '"? This can\'t be undone.')) return;
    api("/content/" + editingContent.id, { method: "DELETE" }).then(function () {
      toast("Post deleted"); closeModals(); return loadContent();
    }).then(function () { if (currentView === "content") renderCalendar(); }).catch(function (err) { toast(friendlyError(err), true); });
  });

  /* ====================== CREATIVES & REVIEWS (content modal) ====================== */
  function reviewStatusLabel(status) {
    return { approved: "Approved", changes_requested: "Changes requested", comment: "Comment" }[status] || status;
  }
  function creativeSizeLabel(bytes) {
    bytes = Number(bytes) || 0;
    if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + " MB";
    if (bytes >= 1024) return Math.round(bytes / 1024) + " KB";
    return bytes + " B";
  }
  function filePreviewHtml(fileUrl, mime, filename) {
    mime = mime || "";
    if (mime.indexOf("image/") === 0) {
      return '<div class="creative-preview"><img src="' + fileUrl + '" alt="' + esc(filename) + '" loading="lazy"></div>';
    }
    if (mime.indexOf("video/") === 0) {
      return '<div class="creative-preview"><video src="' + fileUrl + '" controls preload="metadata"></video></div>';
    }
    if (mime === "application/pdf") {
      return '<div class="creative-preview"><div class="file-generic"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M6 3h9l5 5v13H6z"/><path d="M15 3v5h5"/></svg>PDF — use Download to view</div></div>';
    }
    return "";
  }
  function creativePreviewHtml(postId, c) {
    return filePreviewHtml("/api/content/" + postId + "/creatives/" + c.id + "/file", c.mime_type, c.filename);
  }
  function renderCreatives(postId, creatives) {
    var role = state.user.role;
    var canUpload = role === "admin" || role === "designer";
    var canReview = role === "admin" || role === "social";
    $("creative-upload-row").hidden = !canUpload;

    $("creatives-list").innerHTML = creatives.length ? creatives.map(function (c) {
      var reviewsHtml = (c.reviews || []).map(function (r) {
        return '<div class="review-item"><div class="row1"><span class="who">' + esc(r.author_name || "Someone") + '</span>' +
          '<span class="pill review-' + esc(r.status) + '">' + esc(reviewStatusLabel(r.status)) + '</span>' +
          '<span class="when">' + esc(String(r.created_at || "").slice(0, 16).replace("T", " ")) + '</span></div>' +
          '<div class="body">' + esc(r.body) + '</div></div>';
      }).join("") || '<div class="empty-note" style="padding:4px 0;">No reviews yet.</div>';

      var composeHtml = canReview ?
        '<div class="review-compose">' +
          '<select class="review-status-select" data-creative="' + c.id + '">' +
            '<option value="comment">Comment</option>' +
            '<option value="approved">Approve</option>' +
            '<option value="changes_requested">Request changes</option>' +
          '</select>' +
          '<input type="text" class="review-body-input" data-creative="' + c.id + '" placeholder="Leave feedback…">' +
          '<button class="btn small primary" data-review-for="' + c.id + '" type="button">Send</button>' +
        '</div>' : "";

      var versionBadge = '<span class="version-badge' + (c.isLatest ? " current" : "") + '">' + (c.isLatest ? "Current · v" + c.version : "v" + c.version) + '</span>';

      return '<div class="creative-card' + (c.isLatest ? "" : " superseded") + '" data-creative-id="' + c.id + '">' +
        '<div class="creative-card-head">' +
          versionBadge +
          '<span class="name" title="' + esc(c.filename) + '">' + esc(c.filename) + '</span>' +
          '<span class="meta">' + esc(c.uploaded_by_name || "") + ' · ' + creativeSizeLabel(c.size) + '</span>' +
          '<a class="dl" href="/api/content/' + postId + '/creatives/' + c.id + '/file" target="_blank" rel="noopener">Download</a>' +
          (canUpload ? '<button class="del" type="button" data-delete-creative="' + c.id + '" title="Remove creative"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13"/></svg></button>' : "") +
        '</div>' +
        creativePreviewHtml(postId, c) +
        '<div class="review-list">' + reviewsHtml + '</div>' +
        composeHtml +
        '</div>';
    }).join("") : '<div class="creatives-empty">No creatives uploaded yet.</div>';

    $("creatives-list").querySelectorAll("[data-delete-creative]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        if (!window.confirm("Remove this creative? This can't be undone.")) return;
        api("/content/" + postId + "/creatives/" + btn.dataset.deleteCreative, { method: "DELETE" }).then(function () {
          toast("Creative removed");
          return loadCreativesInto(postId);
        }).catch(function (err) { toast(friendlyError(err), true); });
      });
    });
    $("creatives-list").querySelectorAll("[data-review-for]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var creativeId = btn.dataset.reviewFor;
        var select = $("creatives-list").querySelector('.review-status-select[data-creative="' + creativeId + '"]');
        var input = $("creatives-list").querySelector('.review-body-input[data-creative="' + creativeId + '"]');
        var body = input.value.trim();
        if (!body) { toast("Write a note first"); input.focus(); return; }
        api("/content/" + postId + "/creatives/" + creativeId + "/reviews", { method: "POST", body: { status: select.value, body: body } }).then(function () {
          toast("Review posted");
          return loadCreativesInto(postId);
        }).catch(function (err) { toast(friendlyError(err), true); });
      });
    });
  }
  function loadCreativesInto(postId) {
    return api("/content/" + postId + "/creatives").then(function (rows) {
      renderCreatives(postId, rows);
      loadNotifications().catch(function () {});
    }).catch(function () {
      $("creatives-list").innerHTML = '<div class="creatives-empty">Couldn\'t load creatives.</div>';
    });
  }
  $("creative-upload-btn").addEventListener("click", function () {
    if (!editingContent) return;
    var input = $("creative-file-input");
    var file = input.files && input.files[0];
    if (!file) { toast("Choose a file first"); return; }
    var fd = new FormData();
    fd.append("file", file);
    apiUpload("/content/" + editingContent.id + "/creatives", fd).then(function () {
      input.value = "";
      toast("Creative uploaded");
      return loadCreativesInto(editingContent.id);
    }).catch(function (err) { toast(friendlyError(err), true); });
  });

  /* ====================== REFERENCE SAMPLES (planning inspiration, no review) ====================== */
  function renderReferences(postId, refs) {
    var canManage = state.user.role === "admin" || state.user.role === "social";
    $("reference-upload-row").hidden = !canManage;

    $("references-list").innerHTML = refs.length ? refs.map(function (r) {
      var fileUrl = "/api/content/" + postId + "/references/" + r.id + "/file";
      var preview = filePreviewHtml(fileUrl, r.mime_type, r.filename);
      return '<div class="creative-card">' +
        '<div class="creative-card-head">' +
          '<span class="name" title="' + esc(r.filename) + '">' + esc(r.filename) + '</span>' +
          '<span class="meta">' + esc(r.uploaded_by_name || "") + ' · ' + creativeSizeLabel(r.size) + '</span>' +
          '<a class="dl" href="' + fileUrl + '" target="_blank" rel="noopener">Download</a>' +
          (canManage ? '<button class="del" type="button" data-delete-reference="' + r.id + '" title="Remove"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13"/></svg></button>' : "") +
        '</div>' +
        preview +
        '</div>';
    }).join("") : '<div class="creatives-empty">No reference files yet.</div>';

    $("references-list").querySelectorAll("[data-delete-reference]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        if (!window.confirm("Remove this reference file?")) return;
        api("/content/" + postId + "/references/" + btn.dataset.deleteReference, { method: "DELETE" }).then(function () {
          toast("Reference removed");
          return loadReferencesInto(postId);
        }).catch(function (err) { toast(friendlyError(err), true); });
      });
    });
  }
  function loadReferencesInto(postId) {
    return api("/content/" + postId + "/references").then(function (rows) {
      renderReferences(postId, rows);
    }).catch(function () {
      $("references-list").innerHTML = '<div class="creatives-empty">Couldn\'t load references.</div>';
    });
  }
  $("reference-upload-btn").addEventListener("click", function () {
    if (!editingContent) return;
    var input = $("reference-file-input");
    var file = input.files && input.files[0];
    if (!file) { toast("Choose a file first"); return; }
    var fd = new FormData();
    fd.append("file", file);
    apiUpload("/content/" + editingContent.id + "/references", fd).then(function () {
      input.value = "";
      toast("Reference uploaded");
      return loadReferencesInto(editingContent.id);
    }).catch(function (err) { toast(friendlyError(err), true); });
  });

  /* ====================== CLIENT MODAL ====================== */
  var editingClient = null;
  function openClientModal(client) {
    editingClient = client;
    $("client-modal-title").textContent = client ? "Edit client" : "Add client";
    $("client-name").value = client ? client.name : "";
    $("client-notes").value = client ? (client.notes || "") : "";
    $("client-delete").style.display = client ? "" : "none";
    var handlers = client && client.handlers && client.handlers.length ? client.handlers.map(function (h) { return h.name; }).join(", ") : null;
    $("client-handlers-hint").textContent = client
      ? (handlers ? "Handled by " + handlers + " — change this from the Team page." : "Not yet assigned to anyone — assign a teammate from the Team page.")
      : "Once saved, assign a teammate to this client from the Team page.";
    $("client-overlay").classList.add("open");
    setTimeout(function () { $("client-name").focus(); }, 30);
  }
  $("client-save").addEventListener("click", function () {
    var name = $("client-name").value.trim();
    if (!name) { toast("Give the client a name first"); $("client-name").focus(); return; }
    var body = { name: name, notes: $("client-notes").value.trim() };
    var req = editingClient ? api("/clients/" + editingClient.id, { method: "PATCH", body: body }) : api("/clients", { method: "POST", body: body });
    req.then(function () {
      toast(editingClient ? "Client updated" : "Client added");
      closeModals();
      return loadClients();
    }).then(function () { if (currentView === "clients") renderClients(); }).catch(function (err) { toast(friendlyError(err), true); });
  });
  $("client-delete").addEventListener("click", function () {
    if (!editingClient) return;
    if (!window.confirm('Delete "' + editingClient.name + '"? Posts for this client become Internal / unassigned.')) return;
    api("/clients/" + editingClient.id, { method: "DELETE" }).then(function () {
      toast("Client deleted"); closeModals(); return loadClients();
    }).then(function () { if (currentView === "clients") renderClients(); }).catch(function (err) { toast(friendlyError(err), true); });
  });

  /* ====================== STATUS MANAGER MODAL ====================== */
  function renderStatusList() {
    var list = state.statuses.slice().sort(function (a, b) { return a.sort_order - b.sort_order; });
    $("status-list").innerHTML = list.map(function (s) {
      return '<div class="status-row" data-key="' + esc(s.key) + '">' +
        '<span class="status-swatch" style="background:' + s.color + ';"></span>' +
        '<span class="status-label">' + esc(s.label) + '</span>' +
        (list.length > 1 ? '<button class="icon-btn" data-delete-status="' + esc(s.key) + '" title="Delete"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13"/></svg></button>' : '') +
        '</div>';
    }).join("");
    $("status-list").querySelectorAll("[data-delete-status]").forEach(function (b) {
      b.addEventListener("click", function () {
        var key = b.dataset.deleteStatus;
        var st = contentStatusOf(key);
        if (!window.confirm('Delete the "' + st.label + '" status? Any posts using it move to the first remaining status.')) return;
        api("/content-statuses/" + key, { method: "DELETE" }).then(function () {
          toast("Status removed");
          return Promise.all([loadStatuses(), loadContent()]);
        }).then(function () {
          renderStatusList();
          if (currentView === "content") renderCalendar();
          if (currentView === "dashboard-social") loadSocialDashboard();
        }).catch(function (err) { toast(friendlyError(err), true); });
      });
    });
  }
  function openStatusModal() {
    renderStatusList();
    $("new-status-label").value = "";
    $("status-overlay").classList.add("open");
  }
  $("add-status-btn").addEventListener("click", function () {
    var label = $("new-status-label").value.trim();
    if (!label) { toast("Name the status first"); $("new-status-label").focus(); return; }
    api("/content-statuses", { method: "POST", body: { label: label } }).then(function () {
      $("new-status-label").value = "";
      toast("Status added");
      return loadStatuses();
    }).then(function () {
      renderStatusList();
      if (currentView === "content") renderCalendar();
    }).catch(function (err) { toast(friendlyError(err), true); });
  });

  /* ====================== USER (TEAM) MODAL ====================== */
  var editingUser = null;
  function populateClientChecklist(selectedIds) {
    var selected = new Set((selectedIds || []).map(Number));
    $("user-clients-checklist").innerHTML = state.clients.length ? state.clients.map(function (c) {
      return '<label class="client-check"><input type="checkbox" value="' + c.id + '"' + (selected.has(c.id) ? " checked" : "") + '> ' + esc(c.name) + '</label>';
    }).join("") : '<div class="field-hint">No clients yet — add one from the Clients page first.</div>';
  }
  function syncUserClientsVisibility() {
    var isScoped = CLIENT_SCOPED_ROLES.indexOf($("user-role").value) !== -1;
    $("user-clients-field").hidden = !isScoped;
  }
  $("user-role").addEventListener("change", syncUserClientsVisibility);

  function openUserModal(user) {
    editingUser = user;
    $("user-modal-title").textContent = user ? "Edit teammate" : "Add teammate";
    $("user-name").value = user ? user.name : "";
    $("user-email").value = user ? user.email : "";
    $("user-email").disabled = !!user;
    $("user-role").value = user ? user.role : "sales";
    $("user-password").value = "";
    $("user-password").placeholder = user ? "Leave blank to keep current password" : "Set a starting password";
    $("user-password-hint").textContent = user ? "(optional — leave blank to keep it)" : "(min 6 characters)";
    $("user-delete").style.display = user && user.id !== state.user.id ? "" : "none";
    populateClientChecklist(user ? (user.clients || []).map(function (c) { return c.id; }) : []);
    syncUserClientsVisibility();
    $("user-overlay").classList.add("open");
    setTimeout(function () { $("user-name").focus(); }, 30);
  }
  $("user-save").addEventListener("click", function () {
    var name = $("user-name").value.trim();
    if (!name) { toast("Give them a name first"); $("user-name").focus(); return; }
    var role = $("user-role").value;
    var body = { name: name, role: role };
    if (CLIENT_SCOPED_ROLES.indexOf(role) !== -1) {
      body.client_ids = Array.from($("user-clients-checklist").querySelectorAll("input:checked")).map(function (i) { return Number(i.value); });
    }
    if (!editingUser) {
      body.email = $("user-email").value.trim();
      body.password = $("user-password").value;
      if (!body.email) { toast("Add an email address"); return; }
      if (!body.password || body.password.length < 6) { toast("Password needs at least 6 characters"); return; }
    } else if ($("user-password").value) {
      body.password = $("user-password").value;
    }
    var req = editingUser ? api("/users/" + editingUser.id, { method: "PATCH", body: body }) : api("/users", { method: "POST", body: body });
    req.then(function () {
      toast(editingUser ? "Teammate updated" : "Teammate added");
      closeModals();
      return Promise.all([loadTeamFull(), api("/team").then(function (t) { state.team = t; })]);
    }).then(function () { if (currentView === "team") renderTeam(); }).catch(function (err) { toast(friendlyError(err), true); });
  });
  $("user-delete").addEventListener("click", function () {
    if (!editingUser) return;
    if (!window.confirm("Remove " + editingUser.name + "'s access? This can't be undone.")) return;
    api("/users/" + editingUser.id, { method: "DELETE" }).then(function () {
      toast("Teammate removed"); closeModals();
      return Promise.all([loadTeamFull(), api("/team").then(function (t) { state.team = t; })]);
    }).then(function () { if (currentView === "team") renderTeam(); }).catch(function (err) { toast(friendlyError(err), true); });
  });

  /* ====================== PROFILE ====================== */
  $("profile-password-save").addEventListener("click", function () {
    var current = $("profile-current-password").value;
    var next = $("profile-new-password").value;
    var confirmVal = $("profile-confirm-password").value;
    var errBox = $("profile-password-error");
    var okBox = $("profile-password-success");
    errBox.style.display = "none";
    okBox.style.display = "none";
    if (!current) { errBox.textContent = "Enter your current password."; errBox.style.display = ""; return; }
    if (!next || next.length < 6) { errBox.textContent = "New password needs at least 6 characters."; errBox.style.display = ""; return; }
    if (next !== confirmVal) { errBox.textContent = "New passwords don't match."; errBox.style.display = ""; return; }
    api("/auth/password", { method: "PATCH", body: { current_password: current, new_password: next } }).then(function () {
      $("profile-current-password").value = "";
      $("profile-new-password").value = "";
      $("profile-confirm-password").value = "";
      okBox.style.display = "";
      toast("Password updated");
    }).catch(function (err) {
      errBox.textContent = friendlyError(err);
      errBox.style.display = "";
    });
  });

  /* ====================== ACTIVITY LOG (admin only) ====================== */
  function renderActivityLog() {
    var rows = state.activityLog || [];
    $("activity-log-tbody").innerHTML = rows.length ? rows.map(function (r) {
      return '<tr>' +
        '<td class="tabular">' + esc(String(r.created_at || "").replace("T", " ").slice(0, 16)) + '</td>' +
        '<td>' + esc(r.actor_name || "System") + '</td>' +
        '<td><span class="pill">' + esc(r.action) + ' · ' + esc(r.entity_type) + '</span></td>' +
        '<td>' + esc(r.summary) + '</td></tr>';
    }).join("") : '<tr><td colspan="4"><div class="empty-note">No activity recorded yet.</div></td></tr>';
    $("activity-log-more").style.display = rows.length < (state.activityLogTotal || 0) ? "" : "none";
  }
  $("activity-log-more").addEventListener("click", function () {
    loadActivityLog((state.activityLog || []).length).then(renderActivityLog);
  });

  /* ====================== modal plumbing ====================== */
  function closeModals() {
    document.querySelectorAll(".overlay").forEach(function (o) { o.classList.remove("open"); });
    editingDeal = null; editingContact = null; editingContent = null; editingUser = null; editingClient = null;
  }
  document.querySelectorAll("[data-close]").forEach(function (b) { b.addEventListener("click", closeModals); });
  document.querySelectorAll(".overlay").forEach(function (o) { o.addEventListener("click", function (e) { if (e.target === o) closeModals(); }); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeModals(); });

  /* ====================== SETTINGS (admin: branding) ====================== */
  var pendingLogoFiles = { light: null, dark: null };
  var pendingLogoRemove = { light: false, dark: false };

  function renderSettingsView() {
    pendingLogoFiles = { light: null, dark: null };
    pendingLogoRemove = { light: false, dark: false };
    $("settings-company-name").value = state.branding.company_name || "";
    $("settings-save-status").textContent = "";
    var bust = "?v=" + encodeURIComponent(state.branding.updated_at || Date.now());
    ["light", "dark"].forEach(function (variant) {
      var has = variant === "light" ? state.branding.has_logo_light : state.branding.has_logo_dark;
      var img = $("settings-logo-" + variant + "-preview");
      var empty = $("settings-logo-" + variant + "-empty");
      if (has) {
        img.src = "/api/settings/logo/" + variant + bust;
        img.hidden = false;
        empty.hidden = true;
      } else {
        img.hidden = true;
        img.removeAttribute("src");
        empty.hidden = false;
      }
    });
  }

  function wireLogoInput(variant) {
    $("settings-logo-" + variant + "-input").addEventListener("change", function (e) {
      var file = e.target.files && e.target.files[0];
      if (!file) return;
      pendingLogoFiles[variant] = file;
      pendingLogoRemove[variant] = false;
      var reader = new FileReader();
      reader.onload = function () {
        var img = $("settings-logo-" + variant + "-preview");
        img.src = reader.result;
        img.hidden = false;
        $("settings-logo-" + variant + "-empty").hidden = true;
      };
      reader.readAsDataURL(file);
    });
    $("settings-logo-" + variant + "-remove").addEventListener("click", function () {
      pendingLogoFiles[variant] = null;
      pendingLogoRemove[variant] = true;
      $("settings-logo-" + variant + "-input").value = "";
      $("settings-logo-" + variant + "-preview").hidden = true;
      $("settings-logo-" + variant + "-empty").hidden = false;
    });
  }
  wireLogoInput("light");
  wireLogoInput("dark");

  $("settings-save-btn").addEventListener("click", function () {
    var fd = new FormData();
    fd.append("company_name", $("settings-company-name").value.trim());
    if (pendingLogoFiles.light) fd.append("logo_light", pendingLogoFiles.light);
    if (pendingLogoFiles.dark) fd.append("logo_dark", pendingLogoFiles.dark);
    if (pendingLogoRemove.light) fd.append("remove_logo_light", "1");
    if (pendingLogoRemove.dark) fd.append("remove_logo_dark", "1");
    $("settings-save-btn").disabled = true;
    $("settings-save-status").textContent = "Saving…";
    apiUpload("/settings", fd).then(function (info) {
      state.branding = info;
      applyBranding();
      renderSettingsView();
      $("settings-save-status").textContent = "Saved.";
      toast("Branding updated");
    }).catch(function (err) {
      $("settings-save-status").textContent = "";
      toast(friendlyError(err), true);
    }).finally(function () { $("settings-save-btn").disabled = false; });
  });

  /* ====================== boot ====================== */
  loadBranding();
  api("/auth/me").then(function (user) {
    state.user = user;
    boot();
  }).catch(function () {
    showLogin();
  });
})();
