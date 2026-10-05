import type { IdentidadEstado, InternacionBed } from "@/data/internacion";
import labSeed from "@/data/lab-pacientes.json";

const EVENT = "schestakow-identidad";
let memoryMarks: IdentidadMark[] = [];

export type LabPaciente = {
  nombre: string;
  edad?: string;
  dni?: string;
  servicio?: string;
};

export type IdentidadMark = {
  slug: string;
  cama: string;
  identidad: IdentidadEstado;
  paciente_oficial?: string | null;
  lab_dni?: string | null;
};

function loadMarks(): IdentidadMark[] {
  return memoryMarks;
}

function saveMarks(marks: IdentidadMark[]) {
  memoryMarks = marks.slice(0, 800);
  if (typeof window !== "undefined") window.dispatchEvent(new Event(EVENT));
}

export function subscribeIdentidad(fn: () => void) {
  if (typeof window === "undefined") return () => undefined;
  window.addEventListener(EVENT, fn);
  return () => window.removeEventListener(EVENT, fn);
}

export function loadLab(): LabPaciente[] {
  const seed = (labSeed as { pacientes?: { nombre: string; dni?: string | null; servicio?: string }[] }).pacientes ?? [];
  return seed.map((p) => ({ nombre: p.nombre, dni: p.dni ?? undefined, servicio: p.servicio }));
}

export function foldId(s: string) {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9Ñ ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function lev(a: string, b: string) {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
  }
  return dp[m][n];
}

export function nombrePizarron(bed: InternacionBed) {
  const n = (bed.paciente_original || bed.paciente || "").trim();
  if (!n || /^revisar$/i.test(n) || n === "—") return "Nombre ilegible en pizarrón";
  return n;
}

export function parseLabList(text: string): LabPaciente[] {
  const out: LabPaciente[] = [];
  for (const line of text.split(/\r?\n/)) {
    const raw = line.trim();
    if (!raw || raw.length < 5) continue;
    if (/^(apellido|nombre|paciente|servicio|todos|buscar|dni|hc)/i.test(raw)) continue;
    const dni = raw.match(/\b(\d[\d.]{6,11})\b/)?.[1]?.replace(/\D/g, "");
    const edad = raw.match(/\b(\d{1,3})\s*(a[nñ]os|a\.|años)?\b/i)?.[1];
    const name = raw
      .replace(/\b\d[\d.]{6,11}\b/g, " ")
      .replace(/\b\d{1,3}\s*(a[nñ]os)?\b/gi, " ")
      .replace(/[,;|]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (foldId(name).split(" ").length < 2) continue;
    out.push({ nombre: name, edad, dni, servicio: undefined });
  }
  return out;
}

export type LabMatch = {
  lab: LabPaciente;
  score: number;
};

export function matchLab(bed: InternacionBed, lab: LabPaciente[]): LabMatch | null {
  const hyp = foldId(nombrePizarron(bed));
  if (hyp === "NOMBRE ILEGIBLE EN PIZARRON") return null;
  const tokens = hyp.split(" ").filter((t) => t.length > 1);
  let best: LabMatch | null = null;
  for (const row of lab) {
    const ln = foldId(row.nombre);
    const ltok = ln.split(" ").filter((t) => t.length > 1);
    let score = 0;
    for (const t of tokens) {
      if (ltok.some((u) => u === t || (t.length >= 4 && (u.startsWith(t) || t.startsWith(u))))) score += 3;
      else if (ltok.some((u) => Math.min(u.length, t.length) >= 4 && lev(u, t) <= 2)) score += 2;
    }
    if (bed.edad && row.edad && String(bed.edad).replace(/\D/g, "") === String(row.edad).replace(/\D/g, "")) {
      score += 2;
    }
    const dniBed = (bed.observaciones || "").replace(/\D/g, "");
    if (row.dni && dniBed && (dniBed.includes(row.dni) || row.dni.includes(dniBed.slice(0, 6)))) score += 5;
    if (score >= 5 && (!best || score > best.score)) best = { lab: row, score };
  }
  return best;
}

export async function confirmarCama(slug: string, cama: string, oficial?: string, dni?: string) {
  if (!oficial) return false;
  try {
    const response = await fetch("/api/identity/confirm", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ slug, cama, patient: oficial, dni }), signal: AbortSignal.timeout(8_000) });
    if (!response.ok) return false;
    const result = (await response.json()) as { marks: IdentidadMark[] };
    saveMarks(result.marks);
    return true;
  } catch { return false; }
}

export async function syncIdentityMarks() {
  try {
    const response = await fetch("/api/identity/marks", { signal: AbortSignal.timeout(8_000) });
    if (!response.ok) return false;
    saveMarks(((await response.json()) as { marks: IdentidadMark[] }).marks);
    return true;
  } catch { return false; }
}

export function applyIdentidad(beds: InternacionBed[]): InternacionBed[] {
  const marks = loadMarks();
  const lab = loadLab();
  return beds.map((bed) => {
    const mark = marks.find((m) => m.slug === bed.slug && m.cama === bed.cama);
    const original = bed.paciente_original || bed.paciente;
    const display = nombrePizarron(bed);
    let identidad: IdentidadEstado =
      mark?.identidad ??
      bed.identidad ??
      (bed.estado === "OCUPADA" ? "A_CONFIRMAR" : "NO_VERIFICADA");
    if (bed.estado === "OCUPADA" && (!identidad || identidad === "NO_VERIFICADA" || identidad === "REVISAR")) {
      identidad = "A_CONFIRMAR";
    }
    const sug = !mark && identidad === "A_CONFIRMAR" && lab.length ? matchLab(bed, lab) : null;
    return {
      ...bed,
      paciente: mark?.paciente_oficial || (display === "Nombre ilegible en pizarrón" ? original : display) || display,
      paciente_original: original,
      paciente_oficial: mark?.paciente_oficial ?? bed.paciente_oficial ?? null,
      identidad,
      revisar: identidad === "A_CONFIRMAR" || identidad === "CONFLICTO" || identidad === "REVISAR",
      observaciones: sug && sug.score >= 5 && sug.score < 8
        ? [bed.observaciones, `Lab posible: ${sug.lab.nombre}`].filter(Boolean).join(" · ")
        : bed.observaciones,
    };
  });
}
