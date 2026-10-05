import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { writeJsonAtomic } from "./store.mjs";
import { normalizeArgentinePhone, queueOutboundBatch, readOutbox } from "./whatsapp-send.mjs";

const pathFor = (dir) => join(dir, "whatsapp", "private-schedules.enc.json");
const keyFor = (secret) => createHash("sha256").update(`schestakow-whatsapp-schedules:${secret}`).digest();
const RECURRENCES = new Set(["ONCE", "DAILY", "MONTHLY", "YEARLY"]);

function readState(dir, secret) {
  const path = pathFor(dir);
  if (!existsSync(path)) return [];
  const box = JSON.parse(readFileSync(path, "utf8"));
  const decipher = createDecipheriv("aes-256-gcm", keyFor(secret), Buffer.from(box.iv, "base64"));
  decipher.setAuthTag(Buffer.from(box.tag, "base64"));
  const rows = JSON.parse(Buffer.concat([decipher.update(Buffer.from(box.data, "base64")), decipher.final()]).toString("utf8"));
  if (!Array.isArray(rows)) throw new Error("schedule_store_invalid");
  return rows;
}

function writeState(dir, secret, rows) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFor(secret), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(rows), "utf8"), cipher.final()]);
  writeJsonAtomic(pathFor(dir), { version: 1, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: data.toString("base64") });
}

function nextDate(date, recurrence, anchorDay) {
  const next = new Date(date);
  if (recurrence === "DAILY") next.setUTCDate(next.getUTCDate() + 1);
  if (recurrence === "MONTHLY") {
    const month = next.getUTCMonth() + 1;
    const year = next.getUTCFullYear() + (month > 11 ? 1 : 0);
    const normalizedMonth = month % 12;
    next.setUTCDate(1); next.setUTCFullYear(year, normalizedMonth, 1);
    next.setUTCDate(Math.min(anchorDay, new Date(Date.UTC(year, normalizedMonth + 1, 0)).getUTCDate()));
  }
  if (recurrence === "YEARLY") {
    const year = next.getUTCFullYear() + 1;
    const month = next.getUTCMonth();
    next.setUTCDate(Math.min(anchorDay, new Date(Date.UTC(year, month + 1, 0)).getUTCDate()));
    next.setUTCFullYear(year);
  }
  return next;
}

export function readSchedules(dir, secret) {
  return readState(dir, secret).map(({ recipients, body, ...safe }) => ({ ...safe, recipientCount: recipients.length }));
}

export function createSchedule(dir, secret, input, actor, now = Date.now()) {
  const recurrence = String(input?.recurrence ?? "ONCE");
  const when = Date.parse(String(input?.firstAt ?? ""));
  const recipients = [...new Set((Array.isArray(input?.recipients) ? input.recipients : []).map(normalizeArgentinePhone).filter(Boolean))];
  const body = String(input?.body ?? "").trim();
  const motivo = String(input?.motivo ?? "").trim();
  if (!RECURRENCES.has(recurrence) || !Number.isFinite(when) || when < now + 60_000 || recipients.length < 1 || recipients.length > 25 || !body || body.length > 4000 || !motivo || motivo.length > 240) throw new Error("invalid_schedule");
  const at = new Date(when);
  const row = { id: randomUUID(), recipients, body, motivo, recurrence, firstAt: at.toISOString(), nextAt: at.toISOString(), anchorDay: at.getUTCDate(), active: true, createdAt: new Date(now).toISOString(), createdBy: String(actor).slice(0, 120), lastDraftAt: null };
  const rows = readState(dir, secret);
  if (rows.length >= 500) throw new Error("schedule_limit");
  writeState(dir, secret, [row, ...rows]);
  const { recipients: _recipients, body: _body, ...safe } = row;
  return { ...safe, recipientCount: recipients.length };
}

export function cancelSchedule(dir, secret, id) {
  const rows = readState(dir, secret);
  const row = rows.find((item) => item.id === id);
  if (!row) throw new Error("schedule_not_found");
  row.active = false;
  writeState(dir, secret, rows);
  return true;
}

export function processDueSchedules(dir, secret, now = Date.now()) {
  const rows = readState(dir, secret);
  const due = rows.filter((row) => row.active && Date.parse(row.nextAt) <= now);
  for (const row of due) {
    try {
      const actor = `programación:${row.id}`;
      const hasPendingDraft = readOutbox(dir, secret, 5_000).some((item) => item.creado_por === actor && ["BORRADOR", "APROBADO"].includes(item.estado));
      if (hasPendingDraft) row.lastSkippedAt = new Date(now).toISOString();
      else {
        queueOutboundBatch(dir, secret, row.recipients, { kind: "text", body: row.body, motivo: row.motivo }, actor);
        row.lastDraftAt = new Date(now).toISOString();
        delete row.lastError;
      }
      if (row.recurrence === "ONCE") row.active = false;
      else {
        let next = nextDate(new Date(row.nextAt), row.recurrence, row.anchorDay);
        let missed = 0;
        while (next.getTime() <= now && missed < 500) { next = nextDate(next, row.recurrence, row.anchorDay); missed += 1; }
        if (next.getTime() <= now) { row.active = false; row.lastError = "schedule_missed_too_many_occurrences"; }
        else row.nextAt = next.toISOString();
      }
    } catch (error) {
      row.lastError = error instanceof Error ? error.message.slice(0, 80) : "schedule_failed";
      row.active = false;
    }
  }
  if (due.length) writeState(dir, secret, rows);
  return due.length;
}
