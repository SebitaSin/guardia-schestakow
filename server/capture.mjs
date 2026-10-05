import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, join, resolve, sep } from "node:path";
import { readJson, writeJsonAtomic } from "./store.mjs";

const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const ALLOWED_TYPES = new Map([
  ["image/jpeg", ".jpg"],
  ["image/png", ".png"],
  ["image/webp", ".webp"],
]);

function captureRoot(dataDir) { return join(dataDir, "captures"); }
function inboxPath(dataDir) { return join(captureRoot(dataDir), "inbox.json"); }

function hasImageSignature(bytes, contentType) {
  if (contentType === "image/jpeg") return bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9;
  if (contentType === "image/png") return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (contentType === "image/webp") return bytes.length >= 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP";
  return false;
}

export function saveManualCapture({ dataDir, bytes, contentType, originalName, actor }) {
  const normalizedType = String(contentType).split(";")[0].toLowerCase();
  const extension = ALLOWED_TYPES.get(normalizedType);
  if (!extension) throw new Error("unsupported_image_type");
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw new Error("image_size_invalid");
  if (!hasImageSignature(bytes, normalizedType)) throw new Error("invalid_image_content");
  const hash = createHash("sha256").update(bytes).digest("hex");
  const originalDir = join(captureRoot(dataDir), "originals");
  mkdirSync(originalDir, { recursive: true });
  const path = join(originalDir, `${hash}${extension}`);
  if (!existsSync(path)) writeFileSync(path, bytes, { flag: "wx", mode: 0o600 });
  const inbox = readJson(inboxPath(dataDir), []);
  const duplicate = inbox.find((item) => item.hash === hash);
  if (duplicate) return { item: duplicate, duplicate: true };
  const item = {
    captura_id: randomUUID(),
    fuente: "CARGA_MANUAL",
    nombre_original: basename(String(originalName || "foto")).slice(0, 180),
    recibido_en: new Date().toISOString(),
    cargado_por: actor,
    hash,
    path,
    tipo: "image",
    estado: "A_CONFIRMAR",
  };
  inbox.unshift(item);
  writeJsonAtomic(inboxPath(dataDir), inbox.slice(0, 500));
  return { item, duplicate: false };
}

function publicItem(item) {
  const { path: _path, ...safe } = item;
  return safe;
}

export function captureInbox(dataDir) {
  const manual = readJson(inboxPath(dataDir), []).map(publicItem);
  const whatsapp = readJson(join(dataDir, "whatsapp", "inbox.json"), []).filter((item) => item.tipo === "image").map((item) => publicItem({
    ...item,
    captura_id: item.mensaje_id,
    fuente: "WHATSAPP_API",
  }));
  return [...manual, ...whatsapp].sort((a, b) => String(b.recibido_en).localeCompare(String(a.recibido_en))).slice(0, 500);
}

export function findCapture(dataDir, captureId, { pendingOnly = true } = {}) {
  const sources = [
    ...readJson(inboxPath(dataDir), []).map((item) => ({ ...item, fuente: "CARGA_MANUAL" })),
    ...readJson(join(dataDir, "whatsapp", "inbox.json"), []).filter((item) => item.tipo === "image").map((item) => ({ ...item, captura_id: item.mensaje_id, fuente: "WHATSAPP_API" })),
  ];
  const item = sources.find((candidate) => candidate.captura_id === captureId);
  if (!item?.path || !item?.hash || pendingOnly && item.estado !== "A_CONFIRMAR") return null;
  const resolved = resolve(item.path);
  const roots = [resolve(captureRoot(dataDir), "originals"), resolve(dataDir, "whatsapp", "originals")];
  if (!roots.some((root) => resolved.startsWith(root + sep))) return null;
  return { ...item, path: resolved };
}

function cleanString(value, max = 300) {
  if (value === null || value === undefined || value === "") return null;
  return String(value).trim().slice(0, max) || null;
}

export function validateConfirmedRows(rows) {
  if (!Array.isArray(rows) || rows.length > 100) throw new Error("invalid_rows");
  return rows.map((row) => {
    if (!row || typeof row !== "object") throw new Error("invalid_row");
    const confidence = Number(row.confidence);
    if (!Number.isInteger(confidence) || confidence < 0 || confidence > 100) throw new Error("invalid_confidence");
    const nullableBoolean = (value) => value === null || value === undefined ? null : typeof value === "boolean" ? value : (() => { throw new Error("invalid_boolean"); })();
    return {
      service: cleanString(row.service, 120), room: cleanString(row.room, 80), bed: cleanString(row.bed, 80),
      patient: cleanString(row.patient, 180), diagnosis: cleanString(row.diagnosis, 300),
      arm: nullableBoolean(row.arm), post_surgical: nullableBoolean(row.post_surgical),
      observations: cleanString(row.observations, 500), confidence,
    };
  });
}

export function recordHumanReview({ dataDir, capture, actor, role, decision, rows = [] }) {
  if (!["CONFIRMADA", "DESCARTADA"].includes(decision)) throw new Error("invalid_decision");
  const confirmedRows = decision === "CONFIRMADA" ? validateConfirmedRows(rows) : [];
  const record = {
    captura_id: capture.captura_id,
    sourceHash: capture.hash,
    source: capture.fuente ?? "WHATSAPP_API",
    decision,
    rows: confirmedRows,
    reviewedBy: actor,
    reviewedRole: role,
    reviewedAt: new Date().toISOString(),
    publicationStatus: "NO_PUBLICADA",
  };
  writeJsonAtomic(join(captureRoot(dataDir), "reviews", `${capture.hash}.json`), record);
  const sourcePath = capture.fuente === "CARGA_MANUAL" ? inboxPath(dataDir) : join(dataDir, "whatsapp", "inbox.json");
  const sourceRows = readJson(sourcePath, []);
  const key = capture.fuente === "CARGA_MANUAL" ? "captura_id" : "mensaje_id";
  const updated = sourceRows.map((item) => item[key] === capture.captura_id ? { ...item, estado: decision, revisado_en: record.reviewedAt, revisado_por: actor } : item);
  writeJsonAtomic(sourcePath, updated);
  return record;
}
