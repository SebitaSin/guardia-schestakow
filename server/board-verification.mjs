import { dirname, join } from "node:path";
import { readFileSync } from "node:fs";
import { readJson } from "./store.mjs";

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

export function verifyBoardRows({ rows, dataDir, internacionFile }) {
  const beds = loadBeds(internacionFile);
  const lab = loadLab(dataDir, internacionFile);
  const verifiedRows = rows.map((row) => {
    const reasons = [];
    const sources = [];
    const candidates = row.bed ? beds.filter((bed) => fold(bed.cama) === fold(row.bed) && serviceMatches(row.service, bed)) : [];
    const matchedBed = candidates.length === 1 ? candidates[0] : null;
    if (!row.service) reasons.push("servicio no legible");
    if (!row.bed) reasons.push("cama no legible");
    if (!row.patient) reasons.push("paciente no legible");
    if (row.bed && candidates.length === 0) reasons.push("cama no encontrada en el parte actual");
    if (candidates.length > 1) reasons.push("cama ambigua entre servicios");

    let partMatch = null;
    if (row.patient && matchedBed?.paciente) {
      const score = textSimilarity(row.patient, matchedBed.paciente);
      partMatch = { value: matchedBed.paciente, score };
      if (score >= 0.9) sources.push("PARTE_ACTUAL");
      else reasons.push("nombre diferente al parte actual");
    }
    const labMatch = row.patient ? bestNameMatch(row.patient, lab) : null;
    if (labMatch?.score >= 0.9) sources.push("LABORATORIO");
    else if (row.patient && lab.length) reasons.push("nombre sin coincidencia suficiente en laboratorio");
    if (Number(row.confidence) < 85) reasons.push("confianza de lectura menor a 85%");

    const supportedName = Boolean(partMatch?.score >= 0.9 || labMatch?.score >= 0.9);
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
        patientSuggestion: partMatch?.score >= 0.9 ? partMatch.value : labMatch?.score >= 0.9 ? labMatch.value : null,
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
