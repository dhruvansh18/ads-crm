const fs = require("fs");
const express = require("express");
const ExcelJS = require("exceljs");
const PDFDocument = require("pdfkit");
const db = require("../db");
const { requireAuth } = require("../auth");
const { getBranding, resolveLogoPath } = require("../branding");

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

// Same visibility rule as /api/content: admin sees everything, everyone else
// sees only their assigned clients' posts plus the internal/agency bucket.
function scopedRows(req, rows) {
  if (req.session.role === "admin") return rows;
  const allowed = new Set(assignedClientIds(req.session.userId));
  return rows.filter((r) => r.client_id == null || allowed.has(r.client_id));
}

function fetchRows(req) {
  const q = req.query || {};
  let rows = db.prepare(SELECT + " ORDER BY content_posts.scheduled_date ASC").all();
  rows = scopedRows(req, rows);
  if (q.client_id === "__internal__") rows = rows.filter((r) => r.client_id == null);
  else if (q.client_id) rows = rows.filter((r) => String(r.client_id) === String(q.client_id));
  if (q.platform) rows = rows.filter((r) => r.platform === q.platform);
  if (q.status) rows = rows.filter((r) => r.status === q.status);
  if (q.from) rows = rows.filter((r) => (r.scheduled_date || "") >= q.from);
  if (q.to) rows = rows.filter((r) => (r.scheduled_date || "") <= q.to);
  return rows;
}

function statusLabel(key) {
  const row = db.prepare("SELECT label FROM content_statuses WHERE key = ?").get(key);
  return row ? row.label : key;
}
function postTypeLabel(key) {
  return { static: "Static", carousel: "Carousel", reel: "Reel" }[key] || key;
}
function platformLabel(key) {
  return { linkedin: "LinkedIn", instagram: "Instagram", twitter: "Twitter / X", facebook: "Facebook", tiktok: "TikTok", youtube: "YouTube" }[key] || key;
}

function fileLabel(req) {
  const q = req.query || {};
  if (q.client_id === "__internal__") return "internal-agency";
  if (q.client_id) {
    const c = db.prepare("SELECT name FROM clients WHERE id = ?").get(q.client_id);
    if (c) return c.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  }
  return "all-clients";
}

router.get("/content.xlsx", async (req, res) => {
  const rows = fetchRows(req);
  const branding = getBranding();
  const logoPath = resolveLogoPath(branding, "light"); // documents assume a light/print background
  const companyName = branding.company_name || "Relay CRM";

  const wb = new ExcelJS.Workbook();
  wb.creator = companyName;
  wb.created = new Date();
  const sheet = wb.addWorksheet("Content calendar");

  const columns = [
    { key: "date", label: "Date", width: 12 },
    { key: "client", label: "Client", width: 26 },
    { key: "platform", label: "Platform", width: 14 },
    { key: "post_type", label: "Post type", width: 12 },
    { key: "status", label: "Status", width: 16 },
    { key: "title", label: "Title", width: 40 },
    { key: "owner", label: "Owner", width: 18 },
    { key: "notes", label: "Notes", width: 40 },
  ];
  columns.forEach((c, i) => { sheet.getColumn(i + 1).width = c.width; });

  let headerRowIndex = 1;
  if (logoPath) {
    try {
      const buffer = fs.readFileSync(logoPath);
      const extension = logoPath.toLowerCase().endsWith(".png") ? "png" : "jpeg";
      const imageId = wb.addImage({ buffer, extension });
      sheet.getRow(1).height = 20;
      sheet.getRow(2).height = 20;
      sheet.getRow(3).height = 20;
      sheet.addImage(imageId, { tl: { col: 0, row: 0 }, ext: { width: 150, height: 50 } });
      sheet.mergeCells("D1:H3");
      const nameCell = sheet.getCell("D1");
      nameCell.value = companyName;
      nameCell.font = { bold: true, size: 14 };
      nameCell.alignment = { vertical: "middle" };
      headerRowIndex = 5;
    } catch (e) {
      headerRowIndex = 1; // unreadable logo file — fall back to a plain header
    }
  }

  const headerRow = sheet.getRow(headerRowIndex);
  columns.forEach((c, i) => { headerRow.getCell(i + 1).value = c.label; });
  headerRow.font = { bold: true };
  headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEFEFEA" } };

  rows.forEach((r) => {
    sheet.addRow([
      r.scheduled_date || "",
      r.client_name || "Internal / Agency",
      platformLabel(r.platform),
      postTypeLabel(r.post_type),
      statusLabel(r.status),
      r.title,
      r.owner_name || "",
      r.notes || "",
    ]);
  });
  sheet.autoFilter = { from: "A" + headerRowIndex, to: "H" + headerRowIndex };

  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="content-calendar-${fileLabel(req)}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
});

router.get("/content.pdf", (req, res) => {
  const rows = fetchRows(req);
  const branding = getBranding();
  const logoPath = resolveLogoPath(branding, "light"); // documents assume a light/print background
  const doc = new PDFDocument({ margin: 36, size: "A4", layout: "landscape" });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="content-calendar-${fileLabel(req)}.pdf"`);
  doc.pipe(res);

  const cols = [
    { key: "date", label: "Date", width: 60 },
    { key: "client", label: "Client", width: 130 },
    { key: "platform", label: "Platform", width: 70 },
    { key: "post_type", label: "Type", width: 60 },
    { key: "status", label: "Status", width: 90 },
    { key: "title", label: "Title", width: 190 },
    { key: "notes", label: "Notes", width: 170 },
  ];
  const left = doc.page.margins.left;
  const pageBottom = doc.page.height - doc.page.margins.bottom;

  function drawHeader() {
    var titleX = left;
    var topY = doc.y;
    if (logoPath) {
      try {
        var img = doc.openImage(logoPath);
        var h = 34;
        var w = (img.width / img.height) * h;
        doc.image(logoPath, left, topY, { height: h });
        titleX = left + w + 12;
      } catch (e) {
        titleX = left; // unreadable logo file — fall back to a text-only header
      }
    }
    doc.font("Helvetica-Bold").fontSize(16).text("Content calendar", titleX, topY);
    doc.font("Helvetica").fontSize(9).fillColor("#666").text(
      `Generated ${new Date().toLocaleDateString("en-IN", { year: "numeric", month: "long", day: "numeric" })} · ${rows.length} post(s)`,
      titleX
    );
    doc.fillColor("#000");
    doc.y = Math.max(doc.y, topY + 34) + 8; // clear the logo's full height before the column header
    return drawColumnHeader();
  }
  function drawColumnHeader() {
    let x = left;
    const y = doc.y;
    doc.font("Helvetica-Bold").fontSize(8.5);
    cols.forEach((c) => { doc.text(c.label, x, y, { width: c.width }); x += c.width; });
    doc.moveDown(0.6);
    doc.font("Helvetica").fontSize(8.5);
    doc.moveTo(left, doc.y).lineTo(x, doc.y).strokeColor("#cccccc").stroke();
    doc.moveDown(0.3);
    return doc.y;
  }

  drawHeader();
  rows.forEach((r) => {
    const record = {
      date: r.scheduled_date || "",
      client: r.client_name || "Internal / Agency",
      platform: platformLabel(r.platform),
      post_type: postTypeLabel(r.post_type),
      status: statusLabel(r.status),
      title: r.title,
      notes: r.notes || "",
    };
    // estimate row height from the tallest wrapped cell
    const heights = cols.map((c) => doc.heightOfString(String(record[c.key] || ""), { width: c.width }));
    const rowHeight = Math.max.apply(null, heights.concat([12]));
    if (doc.y + rowHeight > pageBottom) {
      doc.addPage();
      drawColumnHeader();
    }
    let x = left;
    const y = doc.y;
    cols.forEach((c) => { doc.text(String(record[c.key] || ""), x, y, { width: c.width }); x += c.width; });
    doc.y = y + rowHeight + 4;
  });

  doc.end();
});

module.exports = router;
