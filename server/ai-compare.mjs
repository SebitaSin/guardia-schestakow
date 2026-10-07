// Prueba de modelos antes de cambiar nada: vuelve a leer fotos de pizarras YA leídas con otras variantes (modelo,
// razonamiento, formato de respuesta) y compara contra la lectura vigente. No toca la caché ni lo publicado.
// Se enciende con "AI_COMPARE": "true" en server/ai-config.json y corre una sola vez por conjunto de fotos.
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { readJson, writeJsonAtomic } from "./store.mjs";
import { addUsage, aiReady, cachedReading, readBoard } from "./ai.mjs";
import { storedCaptures } from "./capture.mjs";
import { bedKey } from "./board-templates.mjs";
import { textSimilarity } from "./board-verification.mjs";

const fold = (value) => String(value ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();
const nameKey = (value) => fold(value).split(" ").filter(Boolean).sort().join(" ");
const digits = (value) => String(value ?? "").replace(/\D/g, "");
const occupied = (row) => Boolean(row?.patient || digits(row?.dni) || row?.diagnosis);

export const DEFAULT_VARIANTS = (config) => [
  { id: "actual-sin-razonar", model: config.model, effort: "none", schema: "largo" },
  { id: "luna-formato-actual", model: "gpt-6-luna", effort: "none", schema: "largo" },
  { id: "luna-compacto", model: "gpt-6-luna", effort: "none", schema: "compacto" },
  { id: "luna-compacto-razonando", model: "gpt-6-luna", effort: "low", schema: "compacto" },
];

/** Elige fotos fáciles, intermedias y difíciles según la confianza con que se leyeron (3 / 4 / 3 si se piden 10). */
export function pickPhotos(items, count = 10) {
  const scored = items.map((item) => { const rows = item.reading.rows.filter(occupied); return { ...item, score: rows.length ? rows.reduce((sum, row) => sum + (Number(row.confidence) || 0), 0) / rows.length : -1 }; })
    .filter((item) => item.score >= 0 && item.reading.rows.length >= 4).sort((a, b) => b.score - a.score);
  if (scored.length <= count) return scored;
  const easy = Math.round(count * 0.3), hard = Math.round(count * 0.3), mid = count - easy - hard;
  const start = Math.floor((scored.length - mid) / 2);
  return [...scored.slice(0, easy), ...scored.slice(start, start + mid), ...scored.slice(scored.length - hard)].filter((item, index, all) => all.findIndex((other) => other.hash === item.hash) === index);
}

/** Cuántas filas de una lectura tienen un DNI que existe en el laboratorio con un nombre parecido: dato comprobable sin revisar a mano. */
export function labConfirmed(rows, lab) {
  return rows.filter((row) => { const dni = digits(row.dni); const hit = dni.length >= 7 ? lab.get(dni) : null; return hit && textSimilarity(row.patient, hit) >= 0.75; }).length;
}

/** Compara dos lecturas de la misma foto cama por cama. Igualdad exacta (sin acentos ni mayúsculas); nada de "parecido". */
export function compareReadings(base, other) {
  const index = (rows) => { const map = new Map(); for (const row of rows) { const key = `${fold(row.room)}|${bedKey(row.bed)}`; if (bedKey(row.bed) && !map.has(key)) map.set(key, row); } return map; };
  const a = index(base), b = index(other);
  const out = { camas_base: a.size, camas_variante: b.size, faltan: 0, sobran: 0, nombre_igual: 0, nombre_distinto: 0, nombre_solo_base: 0, nombre_solo_variante: 0, dni_igual: 0, dni_distinto: 0, dni_solo_base: 0, dni_solo_variante: 0, diferencias: [] };
  for (const key of b.keys()) if (!a.has(key)) out.sobran += 1;
  for (const [key, row] of a) {
    const twin = b.get(key);
    if (!twin) { out.faltan += 1; continue; }
    const n1 = nameKey(row.patient), n2 = nameKey(twin.patient), d1 = digits(row.dni), d2 = digits(twin.dni);
    if (n1 && n2) { if (n1 === n2) out.nombre_igual += 1; else out.nombre_distinto += 1; } else if (n1) out.nombre_solo_base += 1; else if (n2) out.nombre_solo_variante += 1;
    if (d1 && d2) { if (d1 === d2) out.dni_igual += 1; else out.dni_distinto += 1; } else if (d1) out.dni_solo_base += 1; else if (d2) out.dni_solo_variante += 1;
    if (n1 !== n2 || d1 !== d2) out.diferencias.push({ cama: row.bed, base: { paciente: row.patient, dni: row.dni, confianza: row.confidence }, variante: { paciente: twin.patient, dni: twin.dni, confianza: twin.confidence } });
  }
  return out;
}

function loadLab(dataDir, internacionFile) {
  const map = new Map();
  for (const file of [join(dataDir, "lab", "pacientes.json"), internacionFile ? join(dirname(internacionFile), "lab-pacientes.json") : null]) {
    for (const item of (file ? readJson(file, null)?.pacientes : null) ?? []) { const dni = digits(item.dni); if (dni.length >= 7 && !map.has(dni)) map.set(dni, item.nombre ?? item.paciente ?? ""); }
  }
  return map;
}
const mimeOf = (path) => ({ ".png": "image/png", ".webp": "image/webp" })[extname(path).toLowerCase()] ?? "image/jpeg";

export async function runComparison({ dataDir, config, internacionFile = null, fetchImpl = fetch, variants = DEFAULT_VARIANTS(config), count = 10, sleep }) {
  if (!aiReady(config)) return { ok: false, motivo: "IA no configurada" };
  const seen = new Set();
  const candidates = storedCaptures(dataDir).filter((item) => item.hash && item.path && existsSync(item.path) && !seen.has(item.hash) && seen.add(item.hash)).map((item) => ({ hash: item.hash, path: item.path, reading: cachedReading(dataDir, item.hash) })).filter((item) => item.reading);
  const photos = pickPhotos(candidates, count);
  if (photos.length < 3) return { ok: false, motivo: "hay menos de 3 fotos ya leídas para comparar" };
  const firma = createHash("sha256").update(JSON.stringify([variants, photos.map((item) => item.hash)])).digest("hex").slice(0, 16);
  const reportPath = join(dataDir, "ai", "comparacion.json");
  if (readJson(reportPath, null)?.firma === firma) return { ok: true, repetida: true };
  const lab = loadLab(dataDir, internacionFile);
  const SUMS = ["camas_base", "camas_variante", "faltan", "sobran", "nombre_igual", "nombre_distinto", "nombre_solo_base", "nombre_solo_variante", "dni_igual", "dni_distinto", "dni_solo_base", "dni_solo_variante"];
  const base = { modelo: photos[0].reading.model ?? config.model, fotos: photos.length, filas: 0, nombres: 0, dnis: 0, confirmados_laboratorio: 0, tokens_entrada: 0, tokens_salida: 0, usd: 0 };
  for (const photo of photos) {
    const rows = photo.reading.rows;
    base.filas += rows.length; base.nombres += rows.filter((row) => row.patient).length; base.dnis += rows.filter((row) => digits(row.dni)).length; base.confirmados_laboratorio += labConfirmed(rows, lab);
    base.tokens_entrada += photo.reading.usage?.inputTokens ?? 0; base.tokens_salida += photo.reading.usage?.outputTokens ?? 0; base.usd += photo.reading.usage?.estimatedUsd ?? 0;
  }
  const usagePath = join(dataDir, "ai", `usage-${new Date().toISOString().slice(0, 7)}.json`);
  const results = [], detail = [];
  for (const variant of variants) {
    const total = { id: variant.id, modelo: variant.model, razonamiento: variant.effort, formato: variant.schema, fotos_leidas: 0, errores: [], filas: 0, nombres: 0, dnis: 0, confirmados_laboratorio: 0, tokens_entrada: 0, tokens_salida: 0, tokens_razonamiento: 0, usd: 0, ms: 0 };
    for (const key of SUMS) total[key] = 0;
    for (const photo of photos) {
      const usage = readJson(usagePath, { calls: 0, inputTokens: 0, outputTokens: 0, estimatedUsd: 0 });
      if (usage.estimatedUsd >= config.budgetUsd || usage.calls >= config.callLimit) { total.errores.push("tope mensual"); break; }
      try {
        const read = await readBoard({ bytes: readFileSync(photo.path), mime: mimeOf(photo.path), config, variant, fetchImpl, sleep });
        writeJsonAtomic(usagePath, addUsage(readJson(usagePath, usage), { ...read.usage, tarea: "comparacion", modelo: variant.model }));
        const diff = compareReadings(photo.reading.rows, read.rows);
        for (const key of SUMS) total[key] += diff[key];
        total.fotos_leidas += 1; total.filas += read.rows.length; total.nombres += read.rows.filter((row) => row.patient).length; total.dnis += read.rows.filter((row) => digits(row.dni)).length;
        total.confirmados_laboratorio += labConfirmed(read.rows, lab);
        total.tokens_entrada += read.usage.inputTokens; total.tokens_salida += read.usage.outputTokens; total.tokens_razonamiento += read.usage.reasoningTokens; total.usd += read.usage.estimatedUsd; total.ms += read.telemetry.ms;
        if (diff.diferencias.length) detail.push({ variante: variant.id, foto: photo.hash.slice(0, 12), diferencias: diff.diferencias });
      } catch (error) {
        if (error?.usage?.estimatedUsd) writeJsonAtomic(usagePath, addUsage(readJson(usagePath, usage), { ...error.usage, tarea: "comparacion", modelo: variant.model }));
        total.errores.push(String(error?.message ?? "error").slice(0, 60));
        if (/^openai_http_(400|401|403|404)$/.test(String(error?.message))) break; // el modelo o el parámetro no existe para esta cuenta: no insistir con las demás fotos
      }
    }
    total.usd_por_foto = total.fotos_leidas ? Math.round((total.usd / total.fotos_leidas) * 100000) / 100000 : null;
    total.segundos_por_foto = total.fotos_leidas ? Math.round(total.ms / total.fotos_leidas / 100) / 10 : null;
    delete total.ms;
    results.push(total);
  }
  // El informe no lleva nombres ni documentos; el detalle (con pacientes) queda aparte, sólo en esta PC.
  writeJsonAtomic(reportPath, { firma, en: new Date().toISOString(), laboratorio_cargado: lab.size, vigente: { ...base, usd_por_foto: Math.round((base.usd / photos.length) * 100000) / 100000 }, variantes: results });
  writeJsonAtomic(join(dataDir, "ai", "comparacion-detalle.json"), { firma, detalle: detail });
  return { ok: true, firma, variantes: results.length };
}
