// Entrada automática de fotos de pizarras (OBJETIVO.md, punto 3).
// Lee una carpeta local donde un sincronizador deja las imágenes del WhatsApp Business del hospital.
// Sólo lee: nunca borra, mueve ni modifica nada en esa carpeta.
import { mkdirSync, readFileSync, readdirSync, statSync, watch } from "node:fs";
import { extname, join, resolve } from "node:path";
import { appendAudit, readJson, writeJsonAtomic } from "./store.mjs";
import { saveManualCapture, storedCaptures } from "./capture.mjs";
import { aiReady, analyzeBoardImage, cachedReading } from "./ai.mjs";
import { processedCaptures, publishReading, recheckBoards, shouldRetry } from "./boards.mjs";
import { matchTemplate } from "./board-templates.mjs";

const TYPES = new Map([[".jpg", "image/jpeg"], [".jpeg", "image/jpeg"], [".png", "image/png"], [".webp", "image/webp"]]);
const MAX_AGE_MS = 14 * 24 * 60 * 60_000; // Vigencia: nada de más de dos semanas entra como información nueva.
const MAX_TRIES = 5;
const MAX_SEEN = 5_000;

/** Carpeta de entrada: variable PIZARRAS_FOLDER, o server/pizarras-folder.txt, o var/pizarras-entrada. */
export function photoFolder({ root, dataDir, env = process.env }) {
  const fromEnv = String(env.PIZARRAS_FOLDER ?? "").trim();
  if (fromEnv) return { folder: resolve(fromEnv), configured: true };
  try {
    const line = readFileSync(join(root, "server", "pizarras-folder.txt"), "utf8").replace(/^﻿/, "")
      .split(/\r?\n/).map((item) => item.trim()).find((item) => item && !item.startsWith("#"));
    if (line) return { folder: resolve(line), configured: true };
  } catch { /* sin archivo: se usa la carpeta por defecto */ }
  return { folder: join(dataDir, "pizarras-entrada"), configured: false };
}

/** Turno estimado por la hora de Mendoza (UTC-3). Es una estimación: el archivo no trae grupo ni remitente. */
export function estimateShift(date) {
  const hour = (date.getUTCHours() + 21) % 24;
  return hour < 11 ? "M" : hour < 17 ? "T" : "N";
}

function fold(value) { return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase(); }
/** Turno según el nombre del grupo de WhatsApp de origen. null si el nombre no lo dice. */
export function shiftFromGroup(name) {
  const text = fold(name);
  if (/MANANA/.test(text)) return "M";
  if (/MEDIODIA|SIESTA/.test(text)) return "T";
  if (/TARDE|NOCHE/.test(text)) return "N";
  return null;
}
const clip = (value, max) => (value === null || value === undefined ? null : String(value).slice(0, max) || null);
/** Datos del mensaje que deja el receptor de WhatsApp al lado de la imagen. */
function messageInfo(path) {
  let meta;
  try { meta = JSON.parse(readFileSync(`${path}.json`, "utf8")); } catch { return null; }
  if (!meta || typeof meta !== "object") return null;
  const sentAt = new Date(meta.enviado_en);
  if (!Number.isFinite(sentAt.getTime())) return null;
  const fromGroup = shiftFromGroup(meta.grupo);
  const template = matchTemplate(meta.texto); // el servicio suele venir escrito junto a la foto ("Uccyq")
  return {
    sentAt,
    extra: {
      foto_fecha: sentAt.toISOString(), mensaje_id: clip(meta.mensaje_id, 80), grupo: clip(meta.grupo, 120),
      remitente: clip(meta.remitente, 30), remitente_nombre: clip(meta.remitente_nombre, 80), texto: clip(meta.texto, 500),
      turno: fromGroup ?? estimateShift(sentAt), turno_origen: fromGroup ? "GRUPO" : "ESTIMADO_POR_HORA",
      ...(template ? { servicio: template.servicio ?? template.titulo, servicio_slug: template.slug ?? null, servicio_origen: "TEXTO_DEL_MENSAJE" } : {}),
    },
  };
}

function photoTime(name, stat) {
  const match = /(?:IMG|WA)[-_]?(\d{4})(\d{2})(\d{2})/i.exec(name);
  if (match) {
    const fromName = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 3);
    if (Number.isFinite(fromName)) return Math.min(fromName, stat.mtimeMs);
  }
  return stat.mtimeMs;
}

export function scanPhotoFolder({ dataDir, folder, now = new Date() }) {
  const seenPath = join(dataDir, "captures", "folder-seen.json");
  const added = [];
  let entries;
  try { entries = readdirSync(folder, { withFileTypes: true }); }
  catch (error) { return { ok: false, error: String(error?.code ?? "unreadable"), added }; }
  const seen = readJson(seenPath, {});
  let changed = false;
  for (const entry of entries) {
    if (!entry.isFile()) continue; // No se entra a subcarpetas (Sent, Private).
    const type = TYPES.get(extname(entry.name).toLowerCase());
    if (!type) continue;
    const path = join(folder, entry.name);
    let stat;
    try { stat = statSync(path); } catch { continue; }
    const key = `${entry.name}|${stat.size}|${Math.round(stat.mtimeMs)}`;
    const prior = seen[key];
    if (prior && (prior.estado !== "REINTENTAR" || prior.intentos >= MAX_TRIES)) continue;
    changed = true;
    const info = messageInfo(path);
    if (now.getTime() - (info ? info.sentAt.getTime() : photoTime(entry.name, stat)) > MAX_AGE_MS) { seen[key] = { estado: "VIEJA" }; continue; }
    try {
      const saved = saveManualCapture({
        dataDir, bytes: readFileSync(path), contentType: type, originalName: entry.name, actor: "sistema",
        source: info ? "WHATSAPP_VINCULADO" : "WHATSAPP_CARPETA",
        extra: info ? info.extra : { foto_fecha: stat.mtime.toISOString(), turno: estimateShift(stat.mtime), turno_origen: "ESTIMADO_POR_HORA" },
      });
      seen[key] = { estado: saved.duplicate ? "DUPLICADA" : "INGRESADA", hash: saved.item.hash };
      if (!saved.duplicate) {
        added.push(saved.item);
        appendAudit(dataDir, { actor: "system", action: "folder_image_capture", kind: "data_capture", sourceHash: saved.item.hash });
      }
    } catch (error) {
      // Un archivo a medio copiar falla la validación: se reintenta en la próxima pasada, hasta MAX_TRIES.
      seen[key] = { estado: "REINTENTAR", intentos: (prior?.intentos ?? 0) + 1, error: String(error?.message ?? "error") };
    }
  }
  if (changed) writeJsonAtomic(seenPath, Object.fromEntries(Object.entries(seen).slice(-MAX_SEEN)));
  return { ok: true, added };
}

export function createPhotoIntake({ root, dataDir, ai = { enabled: false }, env = process.env, fetchImpl = fetch, intervalMs = 60_000, waLink = null, internacionFile = null, lab = null }) {
  const { folder, configured } = photoFolder({ root, dataDir, env });
  const state = { lastScanAt: null, lastNewAt: null, lastError: null, received: 0 };
  let watcher = null; let interval = null; let debounce = null;

  // Lee y publica, de la más vieja a la más nueva, cada captura que todavía no tiene destino.
  // La lectura por IA corre sólo si está encendida y autorizada para datos clínicos (decisión de Sebastián).
  const attempts = new Map();
  let processing = false;
  let rechecked = 0;
  async function processPending() {
    if (processing) return;
    processing = true;
    try {
      const done = processedCaptures(dataDir);
      const pending = storedCaptures(dataDir)
        .filter((item) => item.estado === "A_CONFIRMAR" && item.hash && item.path && (!done[item.hash] || shouldRetry(done[item.hash])))
        .sort((a, b) => String(a.foto_fecha ?? a.recibido_en).localeCompare(String(b.foto_fecha ?? b.recibido_en)));
      for (const item of pending) {
        let reading = cachedReading(dataDir, item.hash);
        if (!reading) {
          if (!aiReady(ai) || (attempts.get(item.hash) ?? 0) >= 3) continue;
          attempts.set(item.hash, (attempts.get(item.hash) ?? 0) + 1);
          try {
            reading = await analyzeBoardImage({ imagePath: item.path, sourceHash: item.hash, dataDir, config: ai, fetchImpl });
            appendAudit(dataDir, { actor: "system", action: "ai_board_transcription_auto", kind: "ai_recommendation", sourceHash: item.hash, model: reading.model, cached: reading.cached, rows: reading.rows.length });
          } catch (error) {
            appendAudit(dataDir, { actor: "system", action: "ai_board_transcription_auto_failed", kind: "system", sourceHash: item.hash, error: String(error?.message ?? "error").slice(0, 80) });
            continue;
          }
        }
        try {
          // Dos comprobaciones contra laboratorio: paciente por paciente, y contra el listado reciente de su servicio.
          const extraLab = lab ? await lab.forRows(reading.rows) : [];
          const recentLab = lab?.recent ? await lab.recent() : null;
          const outcome = publishReading({ dataDir, internacionFile, capture: { ...item, captura_id: item.captura_id }, reading, extraLab, recentLab, labMap: lab?.serviceMap?.() ?? null, labBeds: lab?.beds ? await lab.beds() : null });
          appendAudit(dataDir, { actor: "system", action: outcome.estado === "PUBLICADA" ? "board_published" : "board_not_published", kind: "data_capture", sourceHash: item.hash, service: outcome.slug ?? null, reason: outcome.motivo ?? null });
        } catch (error) {
          appendAudit(dataDir, { actor: "system", action: "board_publish_failed", kind: "system", sourceHash: item.hash, error: String(error?.message ?? "error").slice(0, 80) });
        }
      }
      // Cada media hora: lo que quedó a confirmar se vuelve a comprobar, porque durante el día entran laboratorios nuevos.
      if (lab && Date.now() - rechecked > 30 * 60_000) {
        rechecked = Date.now();
        try { const improved = await recheckBoards({ dataDir, internacionFile, lookup: lab.candidates, recentLab: lab.recent ? await lab.recent() : null, labMap: lab.serviceMap?.() ?? null, labBeds: lab.beds ? await lab.beds() : null }); appendAudit(dataDir, { actor: "system", action: "boards_rechecked_with_lab", kind: "data_capture", improved }); }
        catch (error) { appendAudit(dataDir, { actor: "system", action: "boards_recheck_failed", kind: "system", error: String(error?.message ?? "error").slice(0, 80) }); }
      }
    } finally { processing = false; }
  }

  function scan() {
    try {
      const result = scanPhotoFolder({ dataDir, folder });
      state.lastScanAt = new Date().toISOString();
      state.lastError = result.ok ? null : result.error;
      if (result.added.length) { state.lastNewAt = state.lastScanAt; state.received += result.added.length; }
      if (internacionFile) processPending().catch(() => undefined);
      return result;
    } catch (error) {
      state.lastError = String(error?.message ?? "error");
      return { ok: false, error: state.lastError, added: [] };
    }
  }

  function startWatcher() {
    if (watcher) return;
    try {
      watcher = watch(folder, () => { clearTimeout(debounce); debounce = setTimeout(scan, 1_500); debounce.unref?.(); });
      watcher.on("error", () => { try { watcher?.close(); } catch { /* ya cerrado */ } watcher = null; });
      watcher.unref?.();
    } catch { watcher = null; }
  }

  return {
    folder,
    scan,
    processPending,
    status: () => ({ carpeta: folder, configurada: configured, lecturaAutomatica: aiReady(ai), laboratorio: lab?.status() ?? null, vinculo: waLink?.status() ?? null, ...state }),
    start() {
      if (!configured) { try { mkdirSync(folder, { recursive: true }); } catch { /* se informa en lastError al revisar */ } }
      scan(); startWatcher();
      // Respaldo: algunas carpetas sincronizadas no avisan cambios; además reengancha el aviso si la carpeta aparece después.
      interval = setInterval(() => { scan(); startWatcher(); }, intervalMs);
      interval.unref?.();
    },
    stop() { clearInterval(interval); clearTimeout(debounce); try { watcher?.close(); } catch { /* ya cerrado */ } watcher = null; },
  };
}
