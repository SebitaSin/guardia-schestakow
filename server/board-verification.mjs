import { dirname, join } from "node:path";
import { readFileSync } from "node:fs";
import { readJson } from "./store.mjs";
import { bedKey, matchTemplate } from "./board-templates.mjs";

function fold(value) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();
}

function nameKey(value) {
  return fold(value).split(/\s+/).filter(Boolean).sort().join(" ");
}

function bigrams(value) {
  const text = ` ${value} `;
  const result = [];
  for (let index = 0; index < text.length - 1; index += 1) result.push(text.slice(index, index + 2));
  return result;
}

export function textSimilarity(left, right) {
  const a = nameKey(left);
  const b = nameKey(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const first = bigrams(a);
  const second = bigrams(b);
  const available = [...second];
  let shared = 0;
  for (const pair of first) {
    const index = available.indexOf(pair);
    if (index >= 0) { shared += 1; available.splice(index, 1); }
  }
  return 2 * shared / (first.length + second.length);
}

function loadBeds(internacionFile) {
  if (!internacionFile) return [];
  try {
    const parsed = JSON.parse(readFileSync(internacionFile, "utf8"));
    return Array.isArray(parsed?.beds) ? parsed.beds : [];
  } catch { return []; }
}

function loadLab(dataDir, internacionFile) {
  const runtime = readJson(join(dataDir, "lab", "pacientes.json"), null);
  const seed = readJson(join(dirname(internacionFile || "."), "lab-pacientes.json"), null);
  const selected = runtime?.pacientes?.length ? runtime : seed;
  return Array.isArray(selected?.pacientes) ? selected.pacientes : [];
}

function serviceMatches(rowService, bed) {
  if (!rowService) return true;
  const wanted = fold(rowService);
  const service = fold(bed.servicio);
  const slug = fold(bed.slug);
  return wanted === service || wanted === slug || service.includes(wanted) || wanted.includes(service);
}

function bestNameMatch(name, rows) {
  let best = null;
  for (const row of rows) {
    const candidate = row.nombre ?? row.paciente ?? "";
    const score = textSimilarity(name, candidate);
    if (!best || score > best.score) best = { value: candidate, score, row };
  }
  return best;
}

/** `usePart: false` cuando el parte guardado es viejo: comparar contra él marcaría como conflicto a todo paciente nuevo. */
/**
 * Pacientes del laboratorio de los últimos días que corresponden a un servicio de la app:
 * los del propio servicio y, aparte, los que entraron por la guardia (que pueden haber subido a ese piso).
 */
const bedNumber = (value) => fold(value).match(/\d+/g)?.at(-1)?.replace(/^0+/, "") ?? "";
/** La cama de la pizarra y la del laboratorio son la misma: igual texto, o igual número (el laboratorio suele anteponer la sala). */
export function sameBed(board, lab) {
  const a = fold(board), b = fold(lab);
  if (!a || !b) return false;
  if (a === b || bedKey(board) === bedKey(lab)) return true;
  return /^\d+$/.test(a) ? bedNumber(b) === a.replace(/^0+/, "") : b.split(" ").includes(a);
}
const stamp = (text) => { const m = /(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\D+(\d{1,2}):(\d{2}))?/.exec(String(text ?? "")); return m ? Date.UTC(+m[3], +m[2] - 1, +m[1], +(m[4] ?? 0), +(m[5] ?? 0)) : 0; };

const closeDni = (a, b) => a.length >= 7 && b.length >= 7 && Math.abs(a.length - b.length) <= 1 && [...a].filter((digit, index) => digit !== b[index]).length + Math.abs(a.length - b.length) <= 2;
const words = (value) => fold(value).split(" ").filter((word) => word.length >= 4);
/**
 * El paciente que el laboratorio del servicio tiene en esa cama (órdenes de hoy o de ayer) y que además se parece
 * a lo leído en la pizarra: por documento, por nombre completo o por un apellido o nombre. Sin parecido, nada.
 */
export function labBedMatch(bedRows, row) {
  const dni = String(row.dni ?? "").replace(/\D/g, "");
  const read = words(row.patient);
  const room = bedNumber(row.room);
  let best = null;
  for (const item of bedRows ?? []) {
    if (!sameBed(row.bed, item.cama)) continue;
    if (room && bedNumber(item.sala) && room !== bedNumber(item.sala)) continue; // misma cama de otra sala
    const byDni = closeDni(dni, String(item.dni ?? "").replace(/\D/g, ""));
    const full = row.patient ? textSimilarity(row.patient, item.nombre) : 0;
    const byWord = read.some((word) => words(item.nombre).some((other) => textSimilarity(word, other) >= 0.8));
    if (!byDni && full < 0.5 && !byWord) continue;
    const score = byDni ? 1 : Math.max(full, byWord ? 0.7 : 0);
    if (!best || score > best.score) best = { row: item, score };
  }
  return best;
}

export function labForService(recent, slug, map, bedRows = null) {
  const own = [], entry = [];
  const names = Object.entries(map?.equivalencias ?? {}).filter(([, slugs]) => slugs.includes(slug)).map(([name]) => fold(name));
  const doors = (map?.ingreso ?? []).map(fold);
  for (const row of recent ?? []) {
    const service = fold(row.servicio);
    if (names.includes(service)) own.push(row); else if (doors.includes(service)) entry.push(row);
  }
  const unique = (rows) => [...new Map(rows.map((row) => [`${row.dni}|${fold(row.nombre)}`, row])).values()];
  return { own: unique(own), entry: unique(entry), beds: (bedRows ?? []).filter((row) => names.includes(fold(row.servicio))) };
}

/** Un único paciente del listado que se parece al nombre leído. Dos parecidos: no se elige. */
function singleMatch(name, rows, minimum) {
  const scored = rows.map((row) => ({ row, score: textSimilarity(name, row.nombre) })).filter((item) => item.score >= 0.55).sort((a, b) => b.score - a.score);
  if (!scored.length || scored[0].score < minimum) return { hit: null, ambiguous: false };
  // Otra persona (otro documento) casi igual de parecida: no hay forma de saber cuál es.
  const rival = scored.slice(1).find((item) => !item.row.dni || item.row.dni !== scored[0].row.dni);
  if (rival && rival.score > scored[0].score - 0.15) return { hit: null, ambiguous: true };
  return { hit: scored[0], ambiguous: false };
}

export function verifyBoardRows({ rows, dataDir, internacionFile, usePart = true, extraLab = [], serviceLab = null }) {
  const beds = loadBeds(internacionFile);
  const lab = [...extraLab, ...loadLab(dataDir, internacionFile)];
  const digits = (value) => String(value ?? "").replace(/\D/g, "");
  const verifiedRows = rows.map((original) => {
    const reasons = [];
    const sources = [];
    // El título leído en la foto se lleva al nombre que usa la app, sólo si la cama es de esa planilla.
    const template = matchTemplate(original.service, { fromTitle: true });
    const knownBed = template?.camas?.some((bed) => bedKey(bed) === bedKey(original.bed));
    const row = template?.servicio && (knownBed || !template.camas?.length) && template.servicio !== original.service
      ? { ...original, service: template.servicio, service_read: original.service }
      : original;
    const candidates = row.bed ? beds.filter((bed) => fold(bed.cama) === fold(row.bed) && serviceMatches(row.service, bed)) : [];
    const matchedBed = candidates.length === 1 ? candidates[0] : null;
    if (!row.service) reasons.push("servicio no legible");
    if (!row.bed) reasons.push("cama no legible");
    if (!row.patient) reasons.push("paciente no legible");
    if (row.bed && candidates.length === 0) reasons.push("cama no encontrada en el parte actual");
    if (candidates.length > 1) reasons.push("cama ambigua entre servicios");

    let partMatch = null;
    if (usePart && row.patient && matchedBed?.paciente) {
      const score = textSimilarity(row.patient, matchedBed.paciente);
      partMatch = { value: matchedBed.paciente, score };
      if (score >= 0.9) sources.push("PARTE_ACTUAL");
      else reasons.push("nombre diferente al parte actual");
    }
    let labMatch = row.patient ? bestNameMatch(row.patient, lab) : null;
    // Con DNI leído, el cruce con laboratorio es por DNI exacto y el nombre debe parecerse.
    const rowDni = digits(row.dni);
    const dniHit = rowDni.length >= 7 ? lab.find((item) => digits(item.dni) === rowDni) : null;
    let dniConfirmed = false;
    if (dniHit) {
      const score = textSimilarity(row.patient, dniHit.nombre);
      if (score >= 0.75) { dniConfirmed = true; labMatch = { value: dniHit.nombre, score: 1, row: dniHit }; sources.push("LABORATORIO_DNI"); }
      else reasons.push("el DNI figura en laboratorio con un nombre diferente");
    }
    if (labMatch?.score >= 0.9 && !dniConfirmed) sources.push("LABORATORIO");
    else if (!dniConfirmed && row.patient && lab.length) reasons.push("nombre sin coincidencia suficiente en laboratorio");
    // Segundo método: contra los pacientes con laboratorio reciente en ese mismo servicio. Al ser pocos, alcanza un
    // parecido menor, siempre que haya uno solo y que su documento no contradiga al leído en la pizarra.
    let serviceHit = null;
    if (serviceLab && row.patient && !dniConfirmed && !(labMatch?.score >= 0.9)) {
      let found = singleMatch(row.patient, serviceLab.own ?? [], 0.75);
      let source = "LABORATORIO_SERVICIO";
      if (!found.hit && !found.ambiguous) { found = singleMatch(row.patient, serviceLab.entry ?? [], 0.85); source = "LABORATORIO_GUARDIA"; }
      if (found.ambiguous) reasons.push("dos pacientes parecidos en el laboratorio del servicio");
      const labDniDigits = digits(found.hit?.row.dni);
      if (found.hit && rowDni.length >= 7 && labDniDigits.length >= 7 && [...rowDni].filter((digit, index) => digit !== labDniDigits[index]).length + Math.abs(rowDni.length - labDniDigits.length) > 2) {
        reasons.push("el documento leído es diferente al del laboratorio del servicio");
      } else if (found.hit) {
        serviceHit = found.hit;
        sources.push(source);
        labMatch = { value: found.hit.row.nombre, score: Math.max(found.hit.score, 0.7), row: found.hit.row };
        const stale = reasons.indexOf("nombre sin coincidencia suficiente en laboratorio");
        if (stale >= 0) reasons.splice(stale, 1);
      }
    }
    // Tercer método: la cama que figura en las órdenes de laboratorio de hoy o de ayer de ese servicio. Sólo vale si
    // además hay parecido de documento, nombre o apellido. Sin parecido no se pone nada. Una cama sin nadie anotado
    // en la pizarra no se busca: queda en blanco.
    const bedHit = serviceLab?.beds?.length && row.bed && (row.patient || rowDni.length >= 7) && !dniConfirmed && !(labMatch?.score >= 0.9) && !serviceHit ? labBedMatch(serviceLab.beds, row) : null;
    if (bedHit) {
      serviceHit = bedHit;
      sources.push("LABORATORIO_CAMA");
      labMatch = { value: bedHit.row.nombre, score: Math.max(bedHit.score, 0.7), row: bedHit.row };
      const stale = reasons.indexOf("nombre sin coincidencia suficiente en laboratorio");
      if (stale >= 0) reasons.splice(stale, 1);
    }
    if (Number(row.confidence) < 85) reasons.push("confianza de lectura menor a 85%");

    const supportedName = Boolean(partMatch?.score >= 0.9 || labMatch?.score >= 0.9 || serviceHit);
    const status = matchedBed && row.patient && supportedName && Number(row.confidence) >= 85 && !reasons.some((reason) => /no legible|ambigua|diferente|no encontrada/.test(reason))
      ? "VERIFICADA"
      : candidates.length > 1 || Boolean(partMatch && partMatch.score < 0.65) ? "CONFLICTO" : "REVISAR";
    return {
      ...row,
      verification: {
        status,
        reasons,
        sources: [...new Set(sources)],
        matchedBed: matchedBed ? { service: matchedBed.servicio, slug: matchedBed.slug, bed: matchedBed.cama, state: matchedBed.estado } : null,
        patientSuggestion: partMatch?.score >= 0.9 ? partMatch.value : labMatch?.score >= 0.7 ? labMatch.value : null,
        labDni: labMatch?.score >= 0.7 ? String(labMatch.row?.dni ?? "").replace(/\D/g, "") || null : null,
        scores: { part: partMatch ? Math.round(partMatch.score * 100) : null, lab: labMatch ? Math.round(labMatch.score * 100) : null },
      },
    };
  });
  const summary = {
    verified: verifiedRows.filter((row) => row.verification.status === "VERIFICADA").length,
    review: verifiedRows.filter((row) => row.verification.status === "REVISAR").length,
    conflicts: verifiedRows.filter((row) => row.verification.status === "CONFLICTO").length,
  };
  return { rows: verifiedRows, summary, status: summary.review || summary.conflicts ? "REVISAR" : "VERIFICADA_AUTOMATICAMENTE" };
}
