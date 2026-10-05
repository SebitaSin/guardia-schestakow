import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { readJson } from "./store.mjs";
import { whatsappCanSend, whatsappReady } from "./whatsapp.mjs";

// Etapa 6 — Mensajes salientes.
// Regla de Meta que condiciona todo el diseño: fuera de la ventana de servicio de
// 24 h contada desde el ÚLTIMO mensaje entrante de esa persona, sólo se puede
// enviar una plantilla aprobada. El texto libre se rechaza acá, no en Meta.

export const SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;
export const OUTBOUND_STATUSES = ["BORRADOR", "APROBADO", "ENVIADO", "ENTREGADO", "LEIDO", "FALLIDO", "RECHAZADO"];
export const OUTBOUND_KINDS = ["text", "template"];

// Sin envíos masivos: tope por aprobación y por hora.
export const MAX_RECIPIENTS_PER_REQUEST = 25;
export const MAX_SENDS_PER_HOUR = 200;
// Un mismo destinatario no recibe dos veces el mismo cuerpo en esta ventana.
export const DUPLICATE_WINDOW_MS = 10 * 60 * 1000;

function storagePath(dataDir) {
  return join(dataDir, "whatsapp", "private-outbox.enc.json");
}

function encryptionKey(secret) {
  if (String(secret ?? "").length < 32) throw new Error("outbound_secret_invalid");
  return createHash("sha256").update(`schestakow-private-whatsapp-outbox:${secret}`).digest();
}

function readOutboxState(dataDir, secret) {
  const path = storagePath(dataDir);
  if (!existsSync(path)) return { records: [] };
  const box = JSON.parse(readFileSync(path, "utf8"));
  if (box?.version !== 1) throw new Error("outbound_store_invalid");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(secret), Buffer.from(box.iv, "base64"));
  decipher.setAuthTag(Buffer.from(box.tag, "base64"));
  const plain = Buffer.concat([decipher.update(Buffer.from(box.data, "base64")), decipher.final()]);
  const parsed = JSON.parse(plain.toString("utf8"));
  if (!Array.isArray(parsed?.records)) throw new Error("outbound_store_invalid");
  return parsed;
}

function writeOutboxState(dataDir, secret, value) {
  const path = storagePath(dataDir);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(secret), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  const box = { version: 1, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: encrypted.toString("base64") };
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify(box), { encoding: "utf8", mode: 0o600 });
  renameSync(temp, path);
}

// ---------------------------------------------------------------------------
// Teléfonos
// ---------------------------------------------------------------------------

// Devuelve E.164 sin "+" (lo que espera Graph) o null si no es un celular válido.
// Acepta 2604056998, 0260 15 4056998, +54 9 260 405-6998, 5492604056998.
export function normalizeArgentinePhone(raw) {
  let digits = String(raw ?? "").replace(/\D/g, "");
  if (!digits) return null;
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("54")) {
    digits = digits.slice(2);
    if (digits.startsWith("9")) digits = digits.slice(1);
  }
  if (digits.startsWith("0")) digits = digits.replace(/^0+/, "");
  // 15 sobra sólo cuando queda un número de largo nacional válido sin él.
  if (digits.length === 12 && digits.includes("15")) {
    const withoutFifteen = digits.replace(/15/, "");
    if (withoutFifteen.length === 10) digits = withoutFifteen;
  }
  if (!/^\d{10}$/.test(digits)) return null;
  return `549${digits}`;
}

// ---------------------------------------------------------------------------
// Ventana de servicio de 24 h
// ---------------------------------------------------------------------------

export function serviceWindowStatus(dataDir, phone, now = Date.now()) {
  const target = normalizeArgentinePhone(phone);
  if (!target) return { open: false, lastInboundAt: null, expiresAt: null };
  const inbox = readJson(join(dataDir, "whatsapp", "inbox.json"), []);
  let latest = 0;
  for (const item of inbox) {
    if (normalizeArgentinePhone(item?.remitente) !== target) continue;
    const at = Date.parse(item?.recibido_en ?? "");
    if (Number.isFinite(at) && at > latest) latest = at;
  }
  if (!latest) return { open: false, lastInboundAt: null, expiresAt: null };
  const expiresAt = latest + SERVICE_WINDOW_MS;
  return { open: now < expiresAt, lastInboundAt: new Date(latest).toISOString(), expiresAt: new Date(expiresAt).toISOString() };
}

// ---------------------------------------------------------------------------
// Validación
// ---------------------------------------------------------------------------

export function validateOutbound(input, actor) {
  const to = normalizeArgentinePhone(input?.to);
  if (!to) throw new Error("invalid_recipient");
  const kind = String(input?.kind ?? "").trim();
  if (!OUTBOUND_KINDS.includes(kind)) throw new Error("invalid_kind");
  const author = String(actor ?? "").trim();
  if (!author || author.length > 120 || /[\r\n]/.test(author)) throw new Error("invalid_actor");

  const motivo = String(input?.motivo ?? "").trim();
  if (!motivo || motivo.length > 240 || /[\r\n]/.test(motivo)) throw new Error("invalid_motivo");

  const base = {
    id: randomUUID(),
    to,
    kind,
    motivo,
    estado: "BORRADOR",
    creado_en: new Date().toISOString(),
    creado_por: author,
    intentos: 0,
  };

  if (kind === "text") {
    const body = String(input?.body ?? "").trim();
    if (!body || body.length > 4_000) throw new Error("invalid_body");
    return { ...base, body };
  }

  const templateName = String(input?.templateName ?? "").trim();
  if (!/^[a-z0-9_]{1,512}$/.test(templateName)) throw new Error("invalid_template_name");
  const languageCode = String(input?.languageCode ?? "es_AR").trim();
  if (!/^[a-z]{2}(_[A-Z]{2})?$/.test(languageCode)) throw new Error("invalid_language_code");
  const rawParams = Array.isArray(input?.params) ? input.params : [];
  if (rawParams.length > 10) throw new Error("invalid_template_params");
  const params = rawParams.map((value) => {
    const text = String(value ?? "").trim();
    // Meta rechaza saltos de línea, tabs y espacios dobles en parámetros.
    if (!text || text.length > 1_024 || /[\r\n\t]/.test(text) || /\s{2,}/.test(text)) throw new Error("invalid_template_params");
    return text;
  });
  return { ...base, templateName, languageCode, params };
}

// ---------------------------------------------------------------------------
// Cola y aprobación
// ---------------------------------------------------------------------------

export function queueOutbound(dataDir, secret, input, actor) {
  const record = validateOutbound(input, actor);
  const state = readOutboxState(dataDir, secret);
  state.records.unshift(record);
  writeOutboxState(dataDir, secret, { records: state.records.slice(0, 5_000) });
  return record;
}

export function queueOutboundBatch(dataDir, secret, recipients, input, actor) {
  const list = Array.isArray(recipients) ? recipients : [];
  if (!list.length) throw new Error("no_recipients");
  if (list.length > MAX_RECIPIENTS_PER_REQUEST) throw new Error("too_many_recipients");
  const state = readOutboxState(dataDir, secret);
  const created = list.map((to) => validateOutbound({ ...input, to }, actor));
  const seen = new Set();
  for (const record of created) {
    if (seen.has(record.to)) throw new Error("duplicate_recipient");
    seen.add(record.to);
  }
  state.records.unshift(...created);
  writeOutboxState(dataDir, secret, { records: state.records.slice(0, 5_000) });
  return created;
}

export function approveOutbound(dataDir, secret, id, approver) {
  const actor = String(approver ?? "").trim();
  if (!actor || actor.length > 120 || /[\r\n]/.test(actor)) throw new Error("invalid_actor");
  const state = readOutboxState(dataDir, secret);
  const record = state.records.find((item) => item.id === id);
  if (!record) throw new Error("outbound_not_found");
  if (record.estado !== "BORRADOR") throw new Error("outbound_not_draft");
  record.estado = "APROBADO";
  record.aprobado_en = new Date().toISOString();
  record.aprobado_por = actor;
  writeOutboxState(dataDir, secret, state);
  return record;
}

export function rejectOutbound(dataDir, secret, id, actor, reason = "") {
  const state = readOutboxState(dataDir, secret);
  const record = state.records.find((item) => item.id === id);
  if (!record) throw new Error("outbound_not_found");
  if (!["BORRADOR", "APROBADO"].includes(record.estado)) throw new Error("outbound_not_pending");
  record.estado = "RECHAZADO";
  record.rechazado_en = new Date().toISOString();
  record.rechazado_por = String(actor ?? "").slice(0, 120);
  record.motivo_rechazo = String(reason ?? "").slice(0, 240);
  writeOutboxState(dataDir, secret, state);
  return record;
}

function assertSendBudget(records, record, now) {
  const hourAgo = now - 60 * 60 * 1000;
  const recent = records.filter((item) => ["ENVIADO", "ENTREGADO", "LEIDO"].includes(item.estado) && Date.parse(item.enviado_en ?? "") > hourAgo);
  if (recent.length >= MAX_SENDS_PER_HOUR) throw new Error("send_rate_limit");
  const fingerprint = record.kind === "text" ? record.body : `${record.templateName}:${(record.params ?? []).join("|")}`;
  const duplicate = recent.find((item) => item.to === record.to && (item.kind === "text" ? item.body : `${item.templateName}:${(item.params ?? []).join("|")}`) === fingerprint && Date.parse(item.enviado_en ?? "") > now - DUPLICATE_WINDOW_MS);
  if (duplicate) throw new Error("duplicate_send");
}

function buildPayload(record) {
  if (record.kind === "text") {
    return { messaging_product: "whatsapp", recipient_type: "individual", to: record.to, type: "text", text: { preview_url: false, body: record.body } };
  }
  const components = record.params?.length
    ? [{ type: "body", parameters: record.params.map((text) => ({ type: "text", text })) }]
    : [];
  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: record.to,
    type: "template",
    template: { name: record.templateName, language: { code: record.languageCode }, ...(components.length ? { components } : {}) },
  };
}

// ---------------------------------------------------------------------------
// Envío real
// ---------------------------------------------------------------------------

export async function deliverOutbound({ dataDir, secret, id, config, fetchImpl = fetch, now = Date.now() }) {
  if (!whatsappCanSend(config)) throw new Error("whatsapp_not_configured");
  const state = readOutboxState(dataDir, secret);
  const record = state.records.find((item) => item.id === id);
  if (!record) throw new Error("outbound_not_found");
  if (record.estado !== "APROBADO") throw new Error("outbound_not_approved");

  if (record.kind === "text") {
    const window = serviceWindowStatus(dataDir, record.to, now);
    // Sin webhook de recepción la app no puede conocer la ventana de 24 h: decide Meta (error 131047).
    if (!window.open && whatsappReady(config)) {
      record.estado = "FALLIDO";
      record.error = "service_window_closed";
      record.fallado_en = new Date(now).toISOString();
      writeOutboxState(dataDir, secret, state);
      throw new Error("service_window_closed");
    }
    if (window.expiresAt) record.ventana_vence_en = window.expiresAt;
  }

  assertSendBudget(state.records, record, now);
  record.intentos += 1;

  let response;
  try {
    response = await fetchImpl(`https://graph.facebook.com/${config.graphVersion}/${encodeURIComponent(config.phoneNumberId)}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(buildPayload(record)),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (error) {
    record.estado = "FALLIDO";
    record.error = error instanceof Error ? error.message.slice(0, 120) : "network_error";
    record.fallado_en = new Date(now).toISOString();
    writeOutboxState(dataDir, secret, state);
    throw error;
  }

  let result = await response.json().catch(() => ({}));
  // En modo prueba Meta guarda los celulares argentinos sin el 9. Si rechaza 549... (131030),
  // reintenta una sola vez con 54... antes de dar el envío por fallido.
  if (!response.ok && Number(result?.error?.code) === 131030 && /^549\d{10}$/.test(record.to)) {
    const alternate = `54${record.to.slice(3)}`;
    try {
      const retry = await fetchImpl(`https://graph.facebook.com/${config.graphVersion}/${encodeURIComponent(config.phoneNumberId)}/messages`, {
        method: "POST",
        headers: { Authorization: `Bearer ${config.accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify(buildPayload({ ...record, to: alternate })),
        signal: AbortSignal.timeout(20_000),
      });
      const retryResult = await retry.json().catch(() => ({}));
      if (retry.ok) { response = retry; result = retryResult; record.enviado_a = alternate; }
    } catch { /* se informa el error original */ }
  }
  if (!response.ok) {
    record.estado = "FALLIDO";
    record.error = String(result?.error?.message ?? `http_${response.status}`).slice(0, 240);
    record.error_code = Number(result?.error?.code ?? response.status);
    record.fallado_en = new Date(now).toISOString();
    writeOutboxState(dataDir, secret, state);
    throw new Error(`whatsapp_send_${record.error_code}`);
  }

  record.estado = "ENVIADO";
  record.wamid = String(result?.messages?.[0]?.id ?? "").slice(0, 200);
  record.enviado_en = new Date(now).toISOString();
  delete record.error;
  delete record.error_code;
  writeOutboxState(dataDir, secret, state);
  return record;
}

// ---------------------------------------------------------------------------
// Acuses de Meta
// ---------------------------------------------------------------------------

// El receptor de whatsapp.mjs sólo lee change.value.messages; los acuses de
// entrega llegan en change.value.statuses. Sin esto el registro de "entrega y
// error" que pide la Etapa 6 queda incompleto.
const STATUS_MAP = { sent: "ENVIADO", delivered: "ENTREGADO", read: "LEIDO", failed: "FALLIDO" };

export function applyStatusUpdates(dataDir, secret, payload) {
  const state = readOutboxState(dataDir, secret);
  const byWamid = new Map(state.records.filter((item) => item.wamid).map((item) => [item.wamid, item]));
  let touched = 0;
  for (const entry of payload?.entry ?? []) {
    for (const change of entry?.changes ?? []) {
      for (const status of change?.value?.statuses ?? []) {
        const record = byWamid.get(String(status?.id ?? ""));
        const next = STATUS_MAP[String(status?.status ?? "")];
        if (!record || !next) continue;
        // No retroceder: LEIDO no vuelve a ENTREGADO por un acuse fuera de orden.
        const order = ["ENVIADO", "ENTREGADO", "LEIDO"];
        if (next !== "FALLIDO" && order.indexOf(next) <= order.indexOf(record.estado)) continue;
        record.estado = next;
        record.acuse_en = new Date().toISOString();
        if (next === "FALLIDO") {
          record.error = String(status?.errors?.[0]?.title ?? "delivery_failed").slice(0, 240);
          record.error_code = Number(status?.errors?.[0]?.code ?? 0);
        }
        if (status?.pricing) {
          record.facturable = Boolean(status.pricing.billable);
          record.categoria_precio = String(status.pricing.category ?? "").slice(0, 60);
        }
        touched += 1;
      }
    }
  }
  if (touched) writeOutboxState(dataDir, secret, state);
  return touched;
}

export function readOutbox(dataDir, secret, limit = 200) {
  return readOutboxState(dataDir, secret).records.slice(0, limit);
}

export function outboxSummary(dataDir, secret, now = Date.now()) {
  const records = readOutboxState(dataDir, secret).records;
  const hourAgo = now - 60 * 60 * 1000;
  return {
    borradores: records.filter((item) => item.estado === "BORRADOR").length,
    aprobados: records.filter((item) => item.estado === "APROBADO").length,
    fallidos: records.filter((item) => item.estado === "FALLIDO").length,
    enviados_ultima_hora: records.filter((item) => Date.parse(item.enviado_en ?? "") > hourAgo).length,
    cupo_hora: MAX_SENDS_PER_HOUR,
  };
}

// ---------------------------------------------------------------------------
// Canal manual (wa.me) — funciona sin cuenta de Meta
// ---------------------------------------------------------------------------

// Alternativa a la Cloud API mientras no haya token, y salida permanente para
// avisos de bajo volumen. Ventajas frente a la API: no hay ventana de 24 h
// porque no la envía un bot sino una persona desde el teléfono institucional,
// no requiere plantilla aprobada, y no se factura por mensaje.
// Límite real: no hay acuse de entrega. El estado queda en ENVIADO y no avanza.

export function waMeLink(phone, body) {
  const to = normalizeArgentinePhone(phone);
  if (!to) throw new Error("invalid_recipient");
  const text = String(body ?? "").trim();
  if (!text || text.length > 4_000) throw new Error("invalid_body");
  return `https://wa.me/${to}?text=${encodeURIComponent(text)}`;
}

export function deliverManual(dataDir, secret, id, actor, now = Date.now()) {
  const who = String(actor ?? "").trim();
  if (!who || who.length > 120 || /[\r\n]/.test(who)) throw new Error("invalid_actor");
  const state = readOutboxState(dataDir, secret);
  const record = state.records.find((item) => item.id === id);
  if (!record) throw new Error("outbound_not_found");
  if (record.estado !== "APROBADO") throw new Error("outbound_not_approved");
  if (record.kind !== "text") throw new Error("manual_requires_text");

  assertSendBudget(state.records, record, now);
  const link = waMeLink(record.to, record.body);
  record.estado = "ENVIADO";
  record.canal = "MANUAL";
  record.enviado_en = new Date(now).toISOString();
  record.enviado_por = who;
  record.acuse_disponible = false;
  record.intentos += 1;
  writeOutboxState(dataDir, secret, state);
  return { ...record, link };
}

// Links para una tanda ya aprobada, en el orden en que Coordinación debe abrirlos.
export function manualBatchLinks(dataDir, secret) {
  return readOutboxState(dataDir, secret)
    .records.filter((item) => item.estado === "APROBADO" && item.kind === "text")
    .map((item) => ({ id: item.id, to: item.to, motivo: item.motivo, link: waMeLink(item.to, item.body) }));
}
