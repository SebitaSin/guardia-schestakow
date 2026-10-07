// Dispositivo vinculado del WhatsApp del hospital (OBJETIVO.md, punto 3).
// Sólo recibe: no envía mensajes, no marca como leído, no aparece "en línea".
// Cada foto que llega (grupo o chat directo) se deja en la carpeta de entrada de pizarras
// junto con un archivo .json que dice de qué grupo, de quién, a qué hora y con qué texto llegó.
// Uso:  node listener.mjs           -> escucha (requiere estar vinculado)
//       node listener.mjs --link    -> muestra el código QR para vincular y termina al conectar
import { spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import makeWASocket, { Browsers, DisconnectReason, downloadMediaMessage, fetchLatestBaileysVersion, normalizeMessageContent, useMultiFileAuthState } from "baileys";
import pino from "pino";
import { photoFolder } from "../photo-intake.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(process.env.APP_ROOT || join(here, "..", ".."));
const dataDir = resolve(process.env.APP_DATA_DIR || join(root, "var"));
const linkMode = process.argv.includes("--link");
const expected = String(process.env.WHATSAPP_PUBLIC_NUMBER || "2604056998").replace(/\D/g, "");
const stateDir = join(dataDir, "whatsapp-link");
const authDir = join(stateDir, "auth");
const statusPath = join(stateDir, "status.json");
const logPath = join(stateDir, "listener.log");
const { folder } = photoFolder({ root, dataDir });
const MAX_AGE_MS = 14 * 24 * 60 * 60_000;
const EXT = new Map([["image/jpeg", ".jpg"], ["image/png", ".png"], ["image/webp", ".webp"]]);
const logger = pino({ level: "silent" });

mkdirSync(stateDir, { recursive: true });
mkdirSync(folder, { recursive: true });
try { if (statSync(logPath).size > 1_000_000) writeFileSync(logPath, ""); } catch { /* sin registro previo */ }
function log(text) { try { appendFileSync(logPath, `${new Date().toISOString()} ${text}\n`); } catch { /* el registro no debe frenar la recepción */ } }

let status = { estado: "INICIANDO", numero: null, conectadoDesde: null, ultimaFoto: null, fotos: 0, error: null };
function setStatus(patch) {
  status = { ...status, ...patch, actualizado: new Date().toISOString() };
  try { const tmp = `${statusPath}.tmp`; writeFileSync(tmp, JSON.stringify(status, null, 2)); renameSync(tmp, statusPath); } catch { /* idem */ }
}
const digits = (jid) => String(jid ?? "").split("@")[0].split(":")[0].replace(/\D/g, "");

function linked() {
  try { return Boolean(JSON.parse(readFileSync(join(authDir, "creds.json"), "utf8"))?.me?.id); } catch { return false; }
}
if (!linkMode && !linked()) {
  setStatus({ estado: "SIN_VINCULAR", error: null });
  process.exit(3);
}
if (linkMode && linked()) {
  process.stdout.write("\nEste WhatsApp ya esta vinculado a la app. No hace falta escanear nada.\nSi la app no recibe fotos: en el celular, Dispositivos vinculados > cerrar la sesion \"Guardia Schestakow\" y volver a abrir este archivo.\n");
  process.exit(0);
}
if (!linkMode) {
  // Si el servidor se cierra o se reinicia, este proceso termina con él: nunca quedan dos conectados a la vez.
  process.stdin.on("end", () => process.exit(0)).on("close", () => process.exit(0)).on("error", () => process.exit(0)).resume();
  setInterval(() => setStatus({}), 30_000);
}

// El QR también se guarda como página para verlo grande en el navegador.
const qrPage = join(stateDir, "qr.html");
let qrPageOpened = false;
function writeQrPage(qr) {
  try {
    const require = createRequire(import.meta.url);
    const QRCode = require("qrcode-terminal/vendor/QRCode");
    const level = require("qrcode-terminal/vendor/QRCode/QRErrorCorrectLevel");
    const code = new QRCode(-1, level.L); code.addData(qr); code.make();
    const size = code.getModuleCount();
    let cells = "";
    for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) if (code.modules[y][x]) cells += `<rect x="${x + 4}" y="${y + 4}" width="1" height="1"/>`;
    const body = qr
      ? `<p>En el celular del 260 405 6998: WhatsApp Business &gt; Dispositivos vinculados &gt; Vincular un dispositivo.</p><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size + 8} ${size + 8}" width="520" height="520" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/>${cells}</svg><p>El codigo cambia cada 20 segundos; esta pagina se actualiza sola.</p>`
      : "";
    writeFileSync(qrPage, `<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="4"><title>Vincular WhatsApp</title><body style="font-family:system-ui;text-align:center;background:#f3f4f6">${body}</body>`);
    if (!qrPageOpened && process.platform === "win32") { qrPageOpened = true; spawn("cmd", ["/c", "start", "", qrPage], { stdio: "ignore", detached: true, windowsHide: true }).unref(); }
  } catch (error) { log(`qr_html ${String(error?.message ?? error).slice(0, 120)}`); }
}
function closeQrPage(text) {
  try { writeFileSync(qrPage, `<!doctype html><meta charset="utf-8"><title>Vincular WhatsApp</title><body style="font-family:system-ui;text-align:center;background:#f3f4f6"><h1>${text}</h1></body>`); } catch { /* sin página */ }
}

const groupNames = new Map();
async function groupName(sock, jid) {
  if (!jid.endsWith("@g.us")) return null;
  if (!groupNames.has(jid)) {
    try { groupNames.set(jid, (await sock.groupMetadata(jid)).subject ?? null); }
    catch { return null; }
  }
  return groupNames.get(jid);
}

async function handleMessage(sock, msg) {
  const jid = msg.key?.remoteJid ?? "";
  if (!jid || jid === "status@broadcast" || jid.endsWith("@newsletter")) return;
  const content = normalizeMessageContent(msg.message);
  // Registro sin contenido: de qué chat llegó algo y de qué tipo, para saber por qué una foto no entró.
  const kinds = Object.keys(content ?? {}).filter((key) => key !== "messageContextInfo").join(",") || (msg.messageStubType ? `sin_descifrar_${msg.messageStubType}:${(msg.messageStubParameters ?? []).join(" ").slice(0, 60)}` : "vacio");
  log(`mensaje ${jid.endsWith("@g.us") ? `grupo "${(await groupName(sock, jid)) ?? jid}"` : "directo"} tipo=${kinds}`);
  const image = content?.imageMessage ?? (String(content?.documentMessage?.mimetype ?? "").startsWith("image/") ? content.documentMessage : null);
  if (!image) return;
  const extension = EXT.get(String(image.mimetype ?? "").split(";")[0].toLowerCase());
  if (!extension) return;
  const sentAt = new Date(Number(msg.messageTimestamp) * 1000);
  if (!Number.isFinite(sentAt.getTime()) || Date.now() - sentAt.getTime() > MAX_AGE_MS) return;
  const bytes = await downloadMediaMessage(msg, "buffer", {}, { logger, reuploadRequest: sock.updateMediaMessage });
  if (!bytes?.length) throw new Error("descarga_vacia");
  const stamp = sentAt.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
  const name = `WA-${stamp}-${String(msg.key.id).replace(/[^A-Za-z0-9]/g, "").slice(0, 24)}${extension}`;
  const target = join(folder, name);
  if (existsSync(target)) return;
  const meta = {
    origen: "WHATSAPP_VINCULADO",
    mensaje_id: msg.key.id,
    grupo: await groupName(sock, jid),
    es_grupo: jid.endsWith("@g.us"),
    remitente: digits(msg.key.participantAlt || msg.key.participant || msg.key.remoteJidAlt || jid) || null,
    remitente_nombre: msg.key.fromMe ? "Número del hospital" : msg.pushName ?? null,
    texto: String(image.caption ?? "").trim().slice(0, 500) || null,
    enviado_en: sentAt.toISOString(),
  };
  writeFileSync(`${target}.json`, JSON.stringify(meta, null, 2)); // primero los datos, después la imagen
  writeFileSync(`${target}.part`, bytes);
  renameSync(`${target}.part`, target);
  setStatus({ ultimaFoto: new Date().toISOString(), fotos: status.fotos + 1 });
}

let attempts = 0;
async function connect() {
  const { state, saveCreds } = await useMultiFileAuthState(authDir);
  let version;
  try { ({ version } = await fetchLatestBaileysVersion()); } catch { version = undefined; }
  const sock = makeWASocket({ auth: state, version, logger, browser: Browsers.windows("Guardia Schestakow"), markOnlineOnConnect: false, syncFullHistory: false, generateHighQualityLinkPreview: false });
  sock.ev.on("creds.update", saveCreds);
  sock.ev.on("connection.update", async (update) => {
    if (update.qr && linkMode) {
      const qrcode = (await import("qrcode-terminal")).default;
      process.stdout.write("\n\nEn el celular del 260 405 6998: WhatsApp Business > Dispositivos vinculados > Vincular un dispositivo, y escanear:\n\n");
      qrcode.generate(update.qr, { small: true });
      writeQrPage(update.qr);
      setStatus({ estado: "ESPERANDO_QR" });
    }
    if (update.connection === "open") {
      attempts = 0;
      const number = digits(sock.user?.id);
      if (expected && !number.endsWith(expected)) {
        // Se vinculó otro número: no se recibe nada de una cuenta que no es la del hospital.
        log(`numero_inesperado`);
        setStatus({ estado: "NUMERO_INCORRECTO", numero: null, error: "Se vinculó un WhatsApp que no es el 260 405 6998. Se desvinculó solo." });
        process.stdout.write("\nEse WhatsApp no es el 260 405 6998. Se desvinculó. Repetir con el WhatsApp Business del hospital.\n");
        closeQrPage("Ese WhatsApp no es el 260 405 6998. Se desvinculó solo. Repetir con el del hospital.");
        try { await sock.logout(); } catch { /* ya cerrado */ }
        try { renameSync(authDir, `${authDir}-descartada-${Date.now()}`); } catch { /* sin sesión guardada */ }
        setTimeout(() => process.exit(linkMode ? 1 : 3), 1_500);
        return;
      }
      setStatus({ estado: "CONECTADO", numero: number, conectadoDesde: new Date().toISOString(), error: null });
      log("conectado");
      if (linkMode) {
        closeQrPage(`Vinculado con el ${number}. Ya se puede cerrar esta ventana.`);
        process.stdout.write(`\nVinculado con el ${number}. Ya se puede cerrar esta ventana: la app empieza a recibir fotos sola en menos de un minuto.\n`);
        setTimeout(() => process.exit(0), 6_000); // deja guardar las claves de la sesión
      }
    }
    if (update.connection === "close") {
      const code = update.lastDisconnect?.error?.output?.statusCode;
      log(`cerrado_${code ?? "sin_codigo"}`);
      if (code === DisconnectReason.connectionReplaced && !linkMode) { setStatus({ estado: "RECONECTANDO", error: "sesion_abierta_en_otro_proceso" }); return process.exit(4); }
      if (code === DisconnectReason.loggedOut) {
        // El teléfono desvinculó este dispositivo: la sesión guardada ya no sirve. Se aparta (no se borra).
        try { renameSync(authDir, `${authDir}-cerrada-${Date.now()}`); } catch { /* sin sesión guardada */ }
        setStatus({ estado: "SIN_VINCULAR", numero: null, error: "El teléfono desvinculó este dispositivo. Hay que vincular de nuevo." });
        if (!linkMode) return process.exit(3);
      } else if (!linkMode) {
        setStatus({ estado: "RECONECTANDO", error: code ? `desconexion_${code}` : "desconexion" });
      }
      attempts += 1;
      if (linkMode && attempts > 40) { process.stdout.write("\nNo se vinculó. Cerrar y volver a intentar.\n"); return process.exit(1); }
      setTimeout(() => connect().catch(fatal), code === DisconnectReason.restartRequired ? 500 : Math.min(60_000, 2_000 * attempts));
    }
  });
  if (!linkMode) {
    sock.ev.on("groups.upsert", (groups) => { for (const group of groups ?? []) log(`grupo_nuevo "${group.subject ?? group.id}"`); });
    sock.ev.on("connection.update", async (update) => {
      if (update.connection !== "open") return;
      try { const all = await sock.groupFetchAllParticipating(); log(`grupos ${Object.values(all).map((group) => `"${group.subject}"`).join(", ") || "ninguno"}`); for (const group of Object.values(all)) groupNames.set(group.id, group.subject ?? null); }
      catch (error) { log(`grupos_error ${String(error?.message ?? error).slice(0, 80)}`); }
    });
    sock.ev.on("messages.upsert", async ({ messages }) => {
      for (const msg of messages ?? []) {
        try { await handleMessage(sock, msg); }
        catch (error) { log(`foto_error ${String(error?.message ?? error).slice(0, 120)}`); setStatus({ error: "No se pudo bajar una foto; ver listener.log" }); }
      }
    });
  }
}
function fatal(error) {
  log(`fatal ${String(error?.message ?? error).slice(0, 200)}`);
  setStatus({ estado: "ERROR", error: String(error?.message ?? error).slice(0, 200) });
  process.exit(1);
}
process.on("uncaughtException", fatal);
process.on("unhandledRejection", (error) => log(`rechazo ${String(error?.message ?? error).slice(0, 200)}`));
connect().catch(fatal);
