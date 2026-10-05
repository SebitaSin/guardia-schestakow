import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const FIELDS = ["service", "room", "bed", "patient", "diagnosis", "arm", "post_surgical", "observations"];

function pathFor(dataDir) { return join(dataDir, "learning", "board-corrections.enc.json"); }
function keyFrom(secret) {
  if (String(secret ?? "").length < 32) throw new Error("correction_secret_invalid");
  return createHash("sha256").update(`schestakow-board-corrections:${secret}`).digest();
}
function readAll(dataDir, secret) {
  const path = pathFor(dataDir);
  if (!existsSync(path)) return [];
  const box = JSON.parse(readFileSync(path, "utf8"));
  const decipher = createDecipheriv("aes-256-gcm", keyFrom(secret), Buffer.from(box.iv, "base64"));
  decipher.setAuthTag(Buffer.from(box.tag, "base64"));
  const parsed = JSON.parse(Buffer.concat([decipher.update(Buffer.from(box.data, "base64")), decipher.final()]).toString("utf8"));
  if (!Array.isArray(parsed)) throw new Error("correction_store_invalid");
  return parsed;
}
function writeAll(dataDir, secret, rows) {
  const path = pathFor(dataDir);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFrom(secret), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(rows), "utf8"), cipher.final()]);
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify({ version: 1, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: data.toString("base64") }), { mode: 0o600 });
  renameSync(temporary, path);
}
function fold(value) { return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().trim(); }

export function recordBoardCorrections({ dataDir, secret, sourceHash, originalRows, correctedRows, actor }) {
  const changes = [];
  const length = Math.max(originalRows?.length ?? 0, correctedRows?.length ?? 0);
  for (let index = 0; index < length; index += 1) {
    const before = originalRows?.[index] ?? {};
    const after = correctedRows?.[index] ?? {};
    for (const field of FIELDS) {
      if (JSON.stringify(before[field] ?? null) !== JSON.stringify(after[field] ?? null)) changes.push({ index, field, before: before[field] ?? null, after: after[field] ?? null });
    }
  }
  if (!changes.length) return { recorded: 0, total: readAll(dataDir, secret).length };
  const records = readAll(dataDir, secret).filter((item) => item.sourceHash !== sourceHash);
  records.unshift({ sourceHash, changes, actor, at: new Date().toISOString() });
  writeAll(dataDir, secret, records.slice(0, 1_000));
  return { recorded: changes.length, total: records.length };
}

export function applyLearnedCorrections({ dataDir, secret, rows }) {
  const records = readAll(dataDir, secret);
  const aliases = new Map();
  for (const record of records) {
    for (const change of record.changes ?? []) {
      if (change.field !== "service" || !change.before || !change.after) continue;
      const key = fold(change.before);
      const value = String(change.after);
      const item = aliases.get(key) ?? { counts: new Map(), total: 0 };
      item.counts.set(value, (item.counts.get(value) ?? 0) + 1); item.total += 1; aliases.set(key, item);
    }
  }
  return rows.map((row) => {
    const learned = aliases.get(fold(row.service));
    if (!learned || learned.total < 2) return row;
    const [best, count] = [...learned.counts.entries()].sort((a, b) => b[1] - a[1])[0] ?? [];
    if (!best || count < 2 || count / learned.total < 0.8) return row;
    return { ...row, service: best, learnedCorrections: [...(row.learnedCorrections ?? []), { field: "service", from: row.service, to: best, examples: count }] };
  });
}

export function correctionStatus(dataDir, secret) {
  const records = readAll(dataDir, secret);
  return { reviewedImages: records.length, corrections: records.reduce((sum, item) => sum + (item.changes?.length ?? 0), 0) };
}
