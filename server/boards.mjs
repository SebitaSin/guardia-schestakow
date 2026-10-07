// Planilla vigente de cada servicio (OBJETIVO.md, punto 3).
// La última foto válida de un servicio define su planilla; la anterior queda como antecedente.
// Lo que no se pudo contrastar queda para revisar (amarillo) hasta que una persona lo confirma.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readJson, writeJsonAtomic } from "./store.mjs";
import { bedKey, matchTemplate } from "./board-templates.mjs";
import { labForService, textSimilarity, verifyBoardRows } from "./board-verification.mjs";

const currentPath = (dataDir) => join(dataDir, "boards", "current.json");
const processedPath = (dataDir) => join(dataDir, "boards", "processed.json");
export function readBoards(dataDir) { return readJson(currentPath(dataDir), { services: {} }); }
export function processedCaptures(dataDir) { return readJson(processedPath(dataDir), {}); }

function fold(value) { return String(value ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim(); }
const digits = (value) => String(value ?? "").replace(/\D/g, "");
const text = (value, max) => { const clean = String(value ?? "").trim().slice(0, max); return clean || null; };

/** Camas conocidas por servicio (sólo etiquetas; nunca pacientes). */
function catalogBeds(internacionFile) {
  try {
    const beds = JSON.parse(readFileSync(internacionFile, "utf8")).beds ?? [];
    return beds.filter((bed) => bed.estado !== "NO_ASISTENCIAL").map((bed) => ({ slug: bed.slug, servicio: bed.servicio, cama: String(bed.cama) }));
  } catch { return []; }
}

function mostCommon(values) {
  const counts = new Map();
  for (const value of values.filter(Boolean)) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

/** A qué servicio corresponde una lectura: título de la planilla, texto del mensaje, o las camas que trae. */
/** Versión de las reglas de identificación. Al subirla, las fotos que quedaron "sin servicio" se vuelven a evaluar. */
export const RULES_VERSION = 2;
const UNKNOWN_SERVICE = "no se reconoció el servicio";
export function shouldRetry(done) {
  return Boolean(done) && done.estado === "NO_PUBLICADA" && done.motivo === UNKNOWN_SERVICE && (done.reglas ?? 1) < RULES_VERSION;
}

/** Un solo candidato claramente por encima del resto. */
function clearWinner(scores, minimum) {
  const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]);
  return ranked[0] && ranked[0][1] >= minimum && ranked[0][1] > 2 * (ranked[1]?.[1] ?? 0) ? ranked[0][0] : null;
}

/** De qué servicio manda fotos habitualmente cada remitente, según lo ya publicado. */
export function senderHistory(dataDir, remitente) {
  const history = new Map();
  if (!remitente) return history;
  const done = processedCaptures(dataDir);
  for (const item of readJson(join(dataDir, "captures", "inbox.json"), [])) {
    const slug = item?.remitente === remitente && done[item.hash]?.estado === "PUBLICADA" && done[item.hash]?.origen !== "REMITENTE" ? done[item.hash].slug : null;
    if (slug) history.set(slug, (history.get(slug) ?? 0) + 1);
  }
  return history;
}

export function identifyService({ rows, texto, catalog, boards = null, sender = null }) {
  const title = mostCommon(rows.map((row) => row.service));
  const byName = title ? catalog.find((bed) => fold(bed.servicio) === fold(title)) : null;
  const titleTemplate = matchTemplate(title, { fromTitle: true });
  const textTemplate = matchTemplate(texto);
  if ((titleTemplate && !titleTemplate.slug) || (textTemplate && !textTemplate.slug)) {
    return { slug: null, motivo: `la planilla "${(titleTemplate?.slug ? textTemplate : titleTemplate ?? textTemplate).titulo}" todavía no tiene servicio asignado en la app` };
  }
  const titleSlug = titleTemplate?.slug ?? byName?.slug ?? null;
  const textSlug = textTemplate?.slug ?? null;
  if (titleSlug && textSlug && titleSlug !== textSlug) return { slug: null, motivo: "el texto del mensaje y el título de la planilla indican servicios distintos" };
  if (titleSlug) return { slug: titleSlug, origen: "TITULO" };
  if (textSlug) return { slug: textSlug, origen: "TEXTO_DEL_MENSAJE" };
  const read = rows.map((row) => bedKey(row.bed)).filter(Boolean);
  const scores = new Map();
  for (const bed of catalog) if (read.includes(bedKey(bed.cama))) scores.set(bed.slug, (scores.get(bed.slug) ?? 0) + 1);
  const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]);
  if (ranked[0] && ranked[0][1] >= Math.max(2, Math.ceil(read.length * 0.6)) && ranked[0][1] > (ranked[1]?.[1] ?? 0)) return { slug: ranked[0][0], origen: "CAMAS" };
  // Los mismos pacientes que ya estaban en la pizarra de un servicio: es la señal más firme cuando no hay título.
  const named = rows.filter((row) => row.patient);
  const byPatients = new Map();
  for (const [slug, board] of Object.entries(boards?.services ?? {})) {
    const known = (board?.beds ?? []).filter((bed) => bed.paciente);
    const hits = named.filter((row) => known.some((bed) => samePatient(bed, row))).length;
    if (hits) byPatients.set(slug, hits);
  }
  const patientsSlug = clearWinner(byPatients, Math.max(2, Math.ceil(named.length * 0.25)));
  if (patientsSlug) return { slug: patientsSlug, origen: "PACIENTES" };
  // Camas que coinciden sólo en parte (números mal leídos), si un servicio se despega del resto.
  const bedsSlug = clearWinner(scores, Math.max(3, Math.ceil(read.length * 0.25)));
  if (bedsSlug) return { slug: bedsSlug, origen: "CAMAS" };
  // Quien la manda, si siempre manda del mismo servicio.
  const total = [...(sender ?? new Map()).values()].reduce((sum, count) => sum + count, 0);
  const senderSlug = clearWinner(sender ?? new Map(), Math.max(2, Math.ceil(total * 0.8)));
  if (senderSlug) return { slug: senderSlug, origen: "REMITENTE" };
  return { slug: null, motivo: UNKNOWN_SERVICE };
}

function samePatient(previous, row) {
  if (!previous?.paciente || !row.patient) return false;
  const a = digits(previous.dni); const b = digits(row.dni);
  if (a.length >= 7 && a === b) return true;
  return textSimilarity(previous.paciente, row.patient) >= 0.9;
}

function mark(dataDir, hash, value) {
  const processed = processedCaptures(dataDir);
  processed[hash] = { ...value, reglas: RULES_VERSION, en: new Date().toISOString() };
  writeJsonAtomic(processedPath(dataDir), Object.fromEntries(Object.entries(processed).slice(-3_000)));
  return processed[hash];
}

/** Publica una lectura como planilla vigente de su servicio. Devuelve qué pasó y por qué. */
export function publishReading({ dataDir, internacionFile, capture, reading, extraLab = [], recentLab = null, labMap = null, labBeds = null }) {
  const rows = Array.isArray(reading?.rows) ? reading.rows : [];
  if (!rows.length) return mark(dataDir, capture.hash, { estado: "NO_PUBLICADA", motivo: "la lectura no encontró ninguna cama" });
  const catalog = catalogBeds(internacionFile);
  const found = identifyService({ rows, texto: capture.texto, catalog, boards: readBoards(dataDir), sender: senderHistory(dataDir, capture.remitente) });
  if (!found.slug) return mark(dataDir, capture.hash, { estado: "NO_PUBLICADA", motivo: found.motivo });
  const serviceBeds = catalog.filter((bed) => bed.slug === found.slug);
  const servicio = serviceBeds[0]?.servicio ?? matchTemplate(capture.texto)?.servicio ?? found.slug;
  const fotoFecha = capture.foto_fecha ?? capture.recibido_en;
  const boards = readBoards(dataDir);
  const previous = boards.services[found.slug] ?? null;
  if (previous?.hash === capture.hash) return mark(dataDir, capture.hash, { estado: "PUBLICADA", slug: found.slug, servicio });
  if (previous && Date.parse(fotoFecha) < Date.parse(previous.foto_fecha)) {
    return mark(dataDir, capture.hash, { estado: "NO_PUBLICADA", slug: found.slug, servicio, motivo: "ya hay una pizarra más nueva de ese servicio; esta queda como antecedente" });
  }
  const verified = verifyBoardRows({ rows: rows.map((row) => ({ ...row, service: servicio })), dataDir, internacionFile, usePart: false, extraLab, serviceLab: recentLab ? labForService(recentLab, found.slug, labMap, labBeds) : null }).rows;
  const previousBeds = new Map((previous?.beds ?? []).map((bed) => [bedKey(bed.cama), bed]));
  const seen = new Map();
  const extras = [];
  for (const row of verified) {
    const key = bedKey(row.bed);
    const known = serviceBeds.find((bed) => bedKey(bed.cama) === key);
    const old = previousBeds.get(key);
    const occupied = Boolean(row.patient || row.diagnosis || digits(row.dni));
    let bed;
    if (old?.revision === "CONFIRMADA" && (occupied ? samePatient(old, row) : old.estado === "LIBRE")) {
      bed = { ...old, visto: true }; // misma persona en la misma cama: la confirmación sigue valiendo
    } else {
      const reasons = (row.verification?.reasons ?? []).filter((reason) => known || reason !== "cama no encontrada en el parte actual");
      if (!key) reasons.push("cama no legible"); else if (!known) reasons.push("cama que no figura en el catálogo del servicio");
      const sure = occupied ? row.verification?.status === "VERIFICADA" : Number(row.confidence) >= 85 && Boolean(known);
      bed = {
        cama: known?.cama ?? text(row.bed, 20) ?? "?", estado: occupied ? "OCUPADA" : "LIBRE",
        paciente: text(row.patient, 180), dni: digits(row.dni) || null, edad: text(row.age, 20), hc: text(row.hc, 30),
        obra_social: text(row.insurance, 80), ingreso: text(row.admission, 40), diagnostico: text(row.diagnosis, 300),
        arm: row.arm === true, post_quirurgico: row.post_surgical === true, observaciones: text(row.observations, 500),
        confianza: Number(row.confidence) || 0,
        revision: sure ? "VERIFICADA" : row.verification?.status === "CONFLICTO" ? "CONFLICTO" : "REVISAR",
        motivos: sure ? [] : [...new Set(reasons)].slice(0, 6),
        sugerencia: row.verification?.patientSuggestion && row.verification.patientSuggestion !== row.patient ? row.verification.patientSuggestion : null,
        sugerencia_dni: !sure ? row.verification?.labDni ?? null : null,
        fuentes: row.verification?.sources ?? [], visto: true,
      };
    }
    if (key && known && !seen.has(key)) seen.set(key, bed); else extras.push(bed);
  }
  // Camas del servicio que la foto no muestra: no se borra a nadie por lo que no se ve.
  const beds = serviceBeds.map((known) => {
    const key = bedKey(known.cama);
    if (seen.has(key)) return seen.get(key);
    const old = previousBeds.get(key);
    return old ? { ...old, visto: false } : { cama: known.cama, estado: "DESCONOCIDA", paciente: null, revision: null, motivos: [], visto: false };
  });
  boards.services[found.slug] = {
    slug: found.slug, servicio, origen_servicio: found.origen, foto_fecha: fotoFecha, publicado_en: new Date().toISOString(),
    captura_id: capture.captura_id, hash: capture.hash, turno: capture.turno ?? null, turno_origen: capture.turno_origen ?? null,
    grupo: capture.grupo ?? null, remitente_nombre: capture.remitente_nombre ?? null, modelo: reading.model ?? null,
    beds: [...beds, ...extras],
    antecedentes: [previous ? { hash: previous.hash, captura_id: previous.captura_id, foto_fecha: previous.foto_fecha } : null, ...(previous?.antecedentes ?? [])].filter(Boolean).slice(0, 20),
  };
  writeJsonAtomic(currentPath(dataDir), boards);
  return mark(dataDir, capture.hash, { estado: "PUBLICADA", slug: found.slug, servicio, origen: found.origen, camas: verified.length, a_revisar: boards.services[found.slug].beds.filter((bed) => bed.revision === "REVISAR" || bed.revision === "CONFLICTO").length });
}

/** Vuelve a comprobar contra laboratorio las camas que quedaron a confirmar (por ejemplo, al conectar el laboratorio). */
export async function recheckBoards({ dataDir, internacionFile, lookup, recentLab = null, labMap = null, labBeds = null }) {
  const boards = readBoards(dataDir);
  let improved = 0;
  for (const board of Object.values(boards.services)) {
    for (const [index, bed] of board.beds.entries()) {
      if (bed.estado !== "OCUPADA" || !bed.paciente || (bed.revision !== "REVISAR" && bed.revision !== "CONFLICTO")) continue; // sin nadie anotado no se busca paciente
      const row = { service: board.servicio, bed: bed.cama, patient: bed.paciente, dni: bed.dni, confidence: bed.confianza };
      const extraLab = await lookup({ dni: bed.dni, patient: bed.paciente });
      const serviceLab = recentLab ? labForService(recentLab, board.slug, labMap, labBeds) : null;
      if (!extraLab.length && !(serviceLab?.own.length || serviceLab?.entry.length || serviceLab?.beds.length)) continue;
      const check = verifyBoardRows({ rows: [row], dataDir, internacionFile, usePart: false, extraLab, serviceLab }).rows[0].verification;
      const sure = check.status === "VERIFICADA";
      const next = { ...bed, revision: sure ? "VERIFICADA" : bed.revision, motivos: sure ? [] : check.reasons.slice(0, 6), fuentes: check.sources,
        sugerencia: !sure && check.patientSuggestion && check.patientSuggestion !== bed.paciente ? check.patientSuggestion : null, sugerencia_dni: !sure ? check.labDni ?? null : null };
      if (JSON.stringify(next) !== JSON.stringify(bed)) { board.beds[index] = next; improved += 1; }
    }
  }
  if (improved) {
    // Se vuelve a leer por si entró una foto mientras se consultaba; sólo se pisan camas que siguen iguales.
    const fresh = readBoards(dataDir);
    for (const [slug, board] of Object.entries(boards.services)) {
      const target = fresh.services[slug];
      if (!target || target.hash !== board.hash) continue;
      target.beds = target.beds.map((bed, index) => (bed.revision === "CONFIRMADA" ? bed : board.beds[index] ?? bed));
    }
    writeJsonAtomic(currentPath(dataDir), fresh);
  }
  return improved;
}

const EDITABLE = { paciente: 180, dni: 20, edad: 20, hc: 30, obra_social: 80, ingreso: 40, diagnostico: 300, observaciones: 500 };

/** Una persona corrige (si hace falta) y confirma una cama. Vale sólo para ese paciente en esa cama. */
export function confirmBed({ dataDir, slug, cama, values = {}, actor }) {
  const boards = readBoards(dataDir);
  const board = boards.services[String(slug)];
  const index = board?.beds.findIndex((bed) => bed.cama === String(cama)) ?? -1;
  if (index < 0) throw new Error("bed_not_found");
  const bed = { ...board.beds[index] };
  if (values.usar_sugerencia === true && bed.sugerencia) { bed.paciente = bed.sugerencia; if (bed.sugerencia_dni) bed.dni = bed.sugerencia_dni; }
  for (const [field, max] of Object.entries(EDITABLE)) if (field in values) bed[field] = field === "dni" ? digits(values[field]).slice(0, max) || null : text(values[field], max);
  if (typeof values.arm === "boolean") bed.arm = values.arm;
  if (values.estado === "LIBRE") Object.assign(bed, { estado: "LIBRE", paciente: null, dni: null, edad: null, hc: null, obra_social: null, ingreso: null, diagnostico: null, observaciones: null, arm: false });
  else if (values.estado === "OCUPADA" || bed.paciente) bed.estado = "OCUPADA";
  Object.assign(bed, { revision: "CONFIRMADA", motivos: [], sugerencia: null, sugerencia_dni: null, confirmado_por: actor, confirmado_en: new Date().toISOString() });
  board.beds[index] = bed;
  writeJsonAtomic(currentPath(dataDir), boards);
  return bed;
}
