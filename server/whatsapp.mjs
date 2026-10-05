import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readJson, writeJsonAtomic } from "./store.mjs";
import { classifyCommunication } from "./communications.mjs";

export function whatsappConfig(env = process.env) {
  return {
    verifyToken: String(env.WHATSAPP_VERIFY_TOKEN ?? ""),
    accessToken: String(env.WHATSAPP_ACCESS_TOKEN ?? ""),
    appSecret: String(env.WHATSAPP_APP_SECRET ?? ""),
    phoneNumberId: String(env.WHATSAPP_PHONE_NUMBER_ID ?? ""),
    groupId: String(env.WHATSAPP_GROUP_ID ?? ""),
    graphVersion: String(env.WHATSAPP_GRAPH_VERSION ?? ""),
    publicNumber: String(env.WHATSAPP_PUBLIC_NUMBER ?? ""),
  };
}

export function whatsappReady(config) {
  return Boolean(config.verifyToken && config.accessToken && config.appSecret && config.phoneNumberId && /^v\d+\.\d+$/.test(config.graphVersion));
}

// Enviar sólo necesita token, número y versión. El secreto de la app y el token de
// verificación sirven para RECIBIR (webhook) y no deben bloquear el envío.
export function whatsappCanSend(config) {
  return Boolean(config.accessToken && config.phoneNumberId && /^v\d+\.\d+$/.test(config.graphVersion));
}

export function verifyMetaSignature(raw, header, secret) {
  if (!secret || !header?.startsWith("sha256=")) return false;
  const expected = Buffer.from(createHmac("sha256", secret).update(raw).digest("hex"), "utf8");
  const provided = Buffer.from(header.slice(7), "utf8");
  return expected.length === provided.length && timingSafeEqual(expected, provided);
}

async function downloadMedia(mediaId, config, fetchImpl) {
  const meta = await fetchImpl(`https://graph.facebook.com/${config.graphVersion}/${encodeURIComponent(mediaId)}`, {
    headers: { Authorization: `Bearer ${config.accessToken}` },
    signal: AbortSignal.timeout(20_000),
  });
  if (!meta.ok) throw new Error(`media_metadata_${meta.status}`);
  const info = await meta.json();
  if (!info?.url) throw new Error("media_url_missing");
  const response = await fetchImpl(info.url, { headers: { Authorization: `Bearer ${config.accessToken}` }, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`media_download_${response.status}`);
  const type = String(response.headers.get("content-type") ?? "");
  if (!type.startsWith("image/")) throw new Error("media_not_image");
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length || bytes.length > 15 * 1024 * 1024) throw new Error("media_size_invalid");
  return bytes;
}

export function whatsappInbox(dataDir, config) {
  return {
    configured: whatsappReady(config),
    mode: config.groupId ? "API_GROUP" : "DIRECT_1_TO_1",
    inbox: readJson(join(dataDir, "whatsapp", "inbox.json"), []).map(({ path: _path, ...item }) => item),
  };
}

export function findWhatsAppMedia(dataDir, messageId) {
  const wanted = String(messageId ?? "");
  if (!wanted) return null;
  const item = readJson(join(dataDir, "whatsapp", "inbox.json"), []).find((candidate) => String(candidate?.mensaje_id ?? "") === wanted);
  if (!item?.path || !existsSync(item.path)) return null;
  return item;
}

export async function receiveWhatsApp({ raw, signature, dataDir, config, fetchImpl = fetch }) {
  if (!whatsappReady(config)) return { status: 503, body: "not configured" };
  if (!verifyMetaSignature(raw, signature, config.appSecret)) return { status: 403, body: "bad signature" };
  let payload;
  try { payload = JSON.parse(raw.toString("utf8")); } catch { return { status: 400, body: "invalid json" }; }
  const root = join(dataDir, "whatsapp");
  const mediaDir = join(root, "originals");
  mkdirSync(mediaDir, { recursive: true });
  const inboxPath = join(root, "inbox.json");
  const inbox = readJson(inboxPath, []);
  const known = new Set(inbox.map((item) => item.mensaje_id));
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      for (const msg of change.value?.messages ?? []) {
        if (!msg?.id || known.has(msg.id) || !["image", "text"].includes(msg.type)) continue;
        if (config.groupId && msg.group_id !== config.groupId) continue;
        try {
          const text = String(msg.type === "text" ? msg.text?.body ?? "" : msg.image?.caption ?? "").trim().slice(0, 4_000);
          if (msg.type === "text" && !text) continue;
          const classification = classifyCommunication({ type: msg.type, text });
          const base = {
            mensaje_id: String(msg.id).slice(0, 200),
            grupo: msg.group_id ? String(msg.group_id).slice(0, 200) : "1:1",
            remitente: String(msg.from ?? "UNKNOWN").slice(0, 80),
            recibido_en: new Date().toISOString(),
            tipo: msg.type,
            texto: text,
            categoria: classification.category,
            prioridad: classification.priority,
          };
          if (msg.type === "image") {
            if (!msg.image?.id) continue;
            const bytes = await downloadMedia(msg.image.id, config, fetchImpl);
            const hash = createHash("sha256").update(bytes).digest("hex");
            const path = join(mediaDir, `${hash}.bin`);
            if (!existsSync(path)) writeFileSync(path, bytes, { flag: "wx", mode: 0o600 });
            inbox.unshift({ ...base, hash, media_id: String(msg.image.id).slice(0, 200), media_type: String(msg.image.mime_type ?? "image/jpeg"), path, estado: "A_CONFIRMAR" });
          } else {
            inbox.unshift({ ...base, estado: "PENDIENTE" });
          }
          known.add(msg.id);
        } catch (error) {
          inbox.unshift({ mensaje_id: String(msg.id).slice(0, 200), recibido_en: new Date().toISOString(), tipo: "image", estado: "ERROR_CAPTURA", error: error instanceof Error ? error.message.slice(0, 80) : "capture_error" });
        }
      }
    }
  }
  writeJsonAtomic(inboxPath, inbox.slice(0, 500));
  return { status: 200, body: "ok" };
}
