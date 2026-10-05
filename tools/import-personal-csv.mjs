import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { readPrivateContacts, writePrivateContacts } from "../server/private-contacts.mjs";

const root = resolve(process.env.APP_ROOT || process.cwd());
const dataDir = resolve(process.env.APP_DATA_DIR || resolve(root, "var"));
const csvPath = process.argv[2];
if (!csvPath) throw new Error("csv_path_required");

function parseCsv(text) {
  const rows = [];
  let row = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i += 1; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ""; }
    else if (ch === "\n") { row.push(cell.replace(/\r$/, "")); rows.push(row); row = []; cell = ""; }
    else cell += ch;
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

function clean(value) { return String(value ?? "").trim(); }
function slug(value) {
  return clean(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 70) || "sin-dato";
}

const rows = parseCsv(readFileSync(resolve(csvPath), "utf8").replace(/^\uFEFF/, ""));
const headers = rows.shift().map(clean);
const index = Object.fromEntries(headers.map((key, i) => [key, i]));
const existing = readPrivateContacts(dataDir, process.env.APP_SESSION_SECRET);
const next = [...existing];
const used = new Set(next.map((item) => item.staffId));
let imported = 0;
for (const row of rows) {
  const name = clean(row[index.Name]);
  const address = clean(row[index.Address]);
  const phone = clean(row[index.Phone_WhatsApp]);
  const service = clean(row[index.Services]);
  if (!name || (!address && !phone) || !service) continue;
  let staffId = `import-${slug(name)}-${slug(service)}`;
  let suffix = 2;
  while (used.has(staffId)) staffId = `import-${slug(name)}-${slug(service)}-${suffix++}`;
  used.add(staffId);
  next.push({ staffId, name, service, address, phone, email: clean(row[index.Email]), role: clean(row[index.Role]), sourceConfidence: clean(row[index.Confidence]), updatedAt: new Date().toISOString(), updatedBy: "import:PARA_GOOGLE_MY_MAPS_2.csv" });
  imported += 1;
}
writePrivateContacts(dataDir, process.env.APP_SESSION_SECRET, next);
console.log(JSON.stringify({ imported, existing: existing.length, total: next.length, source: csvPath }));
