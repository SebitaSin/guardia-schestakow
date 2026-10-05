import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { readJson } from "./store.mjs";

export const COMMUNICATION_CATEGORIES = ["ALERTA", "PIZARRA", "DIRECCION", "CONSULTA", "TRANSPORTE", "GENERAL"];
export const COMMUNICATION_STATUSES = ["PENDIENTE", "EN_REVISION", "RESUELTO", "DESCARTADO"];

function whatsappConfigured(config) {
  return Boolean(config?.verifyToken && config?.accessToken && config?.appSecret && config?.phoneNumberId && /^v\d+\.\d+$/.test(config?.graphVersion));
}

function fold(value) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

export function classifyCommunication({ type = "text", text = "" } = {}) {
  const normalized = fold(text);
  if (type === "image") return { category: "PIZARRA", priority: "ALTA" };
  if (/\b(emergencia|urgente|alerta|evacuar|evacuacion|incendio|inundacion|derrumbe|codigo rojo)\b/.test(normalized)) {
    return { category: "ALERTA", priority: "URGENTE" };
  }
  if (/\b(traslado|transporte|vehiculo|auto|camioneta|colectivo|recorrido|ruta|pasar a buscar|llevar al hospital)\b/.test(normalized)) {
    return { category: "TRANSPORTE", priority: "ALTA" };
  }
  if (/\b(directora|direccion|comunicado|circular|disposicion)\b/.test(normalized)) {
    return { category: "DIRECCION", priority: "ALTA" };
  }
  if (/[?¿]/.test(text) || /\b(como|cuando|donde|quien|que hago|pueden|podemos|consulta|duda)\b/.test(normalized)) {
    return { category: "CONSULTA", priority: "NORMAL" };
  }
  return { category: "GENERAL", priority: "NORMAL" };
}

function storagePath(dataDir) {
  return join(dataDir, "communications", "private-inbox.enc.json");
}

function encryptionKey(secret) {
  if (String(secret ?? "").length < 32) throw new Error("communication_secret_invalid");
  return createHash("sha256").update(`schestakow-private-communications:${secret}`).digest();
}

function readPrivateState(dataDir, secret) {
  const path = storagePath(dataDir);
  if (!existsSync(path)) return { records: [], reviews: {} };
  const box = JSON.parse(readFileSync(path, "utf8"));
  if (box?.version !== 1) throw new Error("communication_store_invalid");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(secret), Buffer.from(box.iv, "base64"));
  decipher.setAuthTag(Buffer.from(box.tag, "base64"));
  const plain = Buffer.concat([decipher.update(Buffer.from(box.data, "base64")), decipher.final()]);
  const parsed = JSON.parse(plain.toString("utf8"));
  if (!Array.isArray(parsed?.records) || !parsed?.reviews || typeof parsed.reviews !== "object") throw new Error("communication_store_invalid");
  return parsed;
}

function writePrivateState(dataDir, secret, value) {
  const path = storagePath(dataDir);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(secret), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  const box = { version: 1, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: encrypted.toString("base64") };
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(box), { encoding: "utf8", mode: 0o600 });
  renameSync(temporary, path);
}

function cleanText(value, max) {
  return String(value ?? "").trim().replace(/\0/g, "").slice(0, max);
}

export function saveManualCommunication({ dataDir, secret, sender, text, actor }) {
  const cleanSender = cleanText(sender, 120);
  const cleanMessage = cleanText(text, 4_000);
  if (!cleanSender || !cleanMessage) throw new Error("invalid_communication");
  const classification = classifyCommunication({ type: "text", text: cleanMessage });
  const state = readPrivateState(dataDir, secret);
  const item = {
    id: randomUUID(),
    source: "REGISTRO_MANUAL",
    sender: cleanSender,
    receivedAt: new Date().toISOString(),
    type: "text",
    text: cleanMessage,
    category: classification.category,
    priority: classification.priority,
    status: "PENDIENTE",
    recordedBy: actor,
  };
  state.records.unshift(item);
  state.records = state.records.slice(0, 500);
  writePrivateState(dataDir, secret, state);
  return item;
}

function publicWhatsAppItem(item) {
  const classification = classifyCommunication({ type: item.tipo, text: item.texto ?? item.caption ?? "" });
  return {
    id: String(item.mensaje_id),
    source: "WHATSAPP_API",
    sender: String(item.remitente ?? "Sin identificar"),
    conversation: String(item.grupo ?? "1:1"),
    receivedAt: String(item.recibido_en ?? ""),
    type: item.tipo === "image" ? "image" : "text",
    text: String(item.texto ?? item.caption ?? ""),
    category: COMMUNICATION_CATEGORIES.includes(item.categoria) ? item.categoria : classification.category,
    priority: item.prioridad ?? classification.priority,
    status: item.estado === "A_CONFIRMAR" ? "PENDIENTE" : String(item.estado ?? "PENDIENTE"),
    captureId: item.tipo === "image" ? String(item.mensaje_id) : null,
  };
}

function publicCaptureItem(item) {
  return {
    id: String(item.captura_id),
    source: "FOTO_MANUAL",
    sender: String(item.cargado_por ?? "Carga manual"),
    conversation: "Carga desde la aplicación",
    receivedAt: String(item.recibido_en ?? ""),
    type: "image",
    text: String(item.nombre_original ?? "Foto de pizarra"),
    category: "PIZARRA",
    priority: "ALTA",
    status: item.estado === "A_CONFIRMAR" ? "PENDIENTE" : String(item.estado ?? "PENDIENTE"),
    captureId: String(item.captura_id),
  };
}

export function communicationsInbox({ dataDir, secret, waConfig }) {
  const state = readPrivateState(dataDir, secret);
  const whatsapp = readJson(join(dataDir, "whatsapp", "inbox.json"), []).map(publicWhatsAppItem);
  const captures = readJson(join(dataDir, "captures", "inbox.json"), []).map(publicCaptureItem);
  const all = [...state.records, ...whatsapp, ...captures].map((item) => ({ ...item, ...(state.reviews[item.id] ?? {}) }));
  all.sort((a, b) => String(b.receivedAt).localeCompare(String(a.receivedAt)));
  return {
    configured: whatsappConfigured(waConfig),
    mode: waConfig.groupId ? "API_GROUP" : "DIRECT_1_TO_1",
    publicNumber: String(waConfig.publicNumber ?? ""),
    items: all.slice(0, 500),
    counts: {
      pending: all.filter((item) => item.status === "PENDIENTE").length,
      alerts: all.filter((item) => item.category === "ALERTA" && item.status !== "RESUELTO" && item.status !== "DESCARTADO").length,
      boards: all.filter((item) => item.category === "PIZARRA" && item.status !== "RESUELTO" && item.status !== "DESCARTADO").length,
    },
  };
}

export function reviewCommunication({ dataDir, secret, id, status, category, actor }) {
  const cleanId = cleanText(id, 220);
  if (!cleanId || !COMMUNICATION_STATUSES.includes(status) || !COMMUNICATION_CATEGORIES.includes(category)) throw new Error("invalid_communication_review");
  const state = readPrivateState(dataDir, secret);
  state.reviews[cleanId] = { status, category, reviewedAt: new Date().toISOString(), reviewedBy: actor };
  writePrivateState(dataDir, secret, state);
  return { id: cleanId, ...state.reviews[cleanId] };
}
