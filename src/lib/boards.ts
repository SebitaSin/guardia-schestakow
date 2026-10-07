// Planillas vigentes por servicio, publicadas por el servidor a partir de las fotos de pizarras.
import type { IdentidadEstado, InternacionBed } from "@/data/internacion";

export type BoardRevision = "VERIFICADA" | "REVISAR" | "CONFLICTO" | "CONFIRMADA" | null;
export type BoardBed = {
  cama: string;
  estado: "OCUPADA" | "LIBRE" | "DESCONOCIDA";
  paciente: string | null;
  dni?: string | null;
  edad?: string | null;
  hc?: string | null;
  obra_social?: string | null;
  ingreso?: string | null;
  diagnostico?: string | null;
  arm?: boolean;
  post_quirurgico?: boolean;
  observaciones?: string | null;
  confianza?: number;
  revision: BoardRevision;
  motivos?: string[];
  sugerencia?: string | null;
  visto: boolean;
};
export type Board = {
  slug: string;
  servicio: string;
  foto_fecha: string;
  publicado_en: string;
  captura_id: string;
  turno: "M" | "T" | "N" | null;
  turno_origen: string | null;
  grupo: string | null;
  remitente_nombre: string | null;
  beds: BoardBed[];
};
export type BoardValues = Partial<Pick<BoardBed, "paciente" | "dni" | "edad" | "hc" | "obra_social" | "ingreso" | "diagnostico" | "observaciones" | "arm">> & { estado?: "LIBRE" | "OCUPADA"; usar_sugerencia?: boolean };

const EVENT = "schestakow-boards";
let boards: Record<string, Board> = {};
let lastSync = 0;

export function getBoards() { return boards; }
export function boardFor(slug: string): Board | undefined { return boards[slug]; }

function store(next: Record<string, Board> | undefined) {
  boards = next ?? {};
  if (typeof window !== "undefined") window.dispatchEvent(new Event(EVENT));
}

export function subscribeBoards(fn: () => void) {
  if (typeof window === "undefined") return () => undefined;
  window.addEventListener(EVENT, fn);
  return () => window.removeEventListener(EVENT, fn);
}

export async function syncBoards(force = false) {
  if (!force && Date.now() - lastSync < 5_000) return false;
  lastSync = Date.now();
  try {
    const response = await fetch("/api/boards", { signal: AbortSignal.timeout(8_000) });
    if (!response.ok) return false;
    store(((await response.json()) as { services?: Record<string, Board> }).services);
    return true;
  } catch { return false; }
}

export async function confirmBoardBed(slug: string, cama: string, values: BoardValues = {}): Promise<"ok" | "forbidden" | "error"> {
  try {
    const response = await fetch("/api/boards/confirm", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ slug, cama, values }), signal: AbortSignal.timeout(8_000) });
    if (response.status === 403) return "forbidden";
    if (!response.ok) return "error";
    store(((await response.json()) as { services?: Record<string, Board> }).services);
    return "ok";
  } catch { return "error"; }
}

/** "28/9/2026" o "5/10/26" → "2026-09-28". Si no es una fecha completa, null. */
export function boardDateISO(value: string | null | undefined): string | null {
  const match = /^\s*(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})\b/.exec(value ?? "");
  if (!match) return null;
  const day = Number(match[1]); const month = Number(match[2]);
  const year = match[3].length === 2 ? 2000 + Number(match[3]) : Number(match[3]);
  if (day < 1 || day > 31 || month < 1 || month > 12) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function identidad(row: BoardBed): IdentidadEstado {
  if (row.revision === "CONFIRMADA") return "CONFIRMADA";
  if (row.revision === "VERIFICADA") return "PROBABLE";
  if (row.revision === "CONFLICTO") return "CONFLICTO";
  return row.estado === "OCUPADA" ? "A_CONFIRMAR" : "NO_VERIFICADA";
}

/** Reemplaza las camas de cada servicio que tiene planilla vigente por las de esa planilla. */
export function applyBoards(beds: InternacionBed[]): InternacionBed[] {
  if (!Object.keys(boards).length) return beds;
  const out: InternacionBed[] = [];
  const done = new Set<string>();
  for (const bed of beds) {
    const board = boards[bed.slug];
    if (!board) { out.push(bed); continue; }
    if (done.has(bed.slug)) continue;
    done.add(bed.slug);
    const base = beds.filter((item) => item.slug === bed.slug);
    for (const row of board.beds) {
      const ref = base.find((item) => item.cama === row.cama);
      out.push({
        servicio: bed.servicio, slug: bed.slug, sala: ref?.sala ?? null, piso: ref?.piso ?? bed.piso, cama: row.cama,
        estado: row.estado, paciente: row.paciente, paciente_original: row.paciente, paciente_oficial: null, lab_dni: row.dni ?? null,
        edad: row.edad ?? null, diagnostico: row.diagnostico ?? null, observaciones: row.observaciones ?? null,
        arm: Boolean(row.arm), aislamiento: false,
        confianza: (row.confianza ?? 0) >= 90 ? "Alta" : (row.confianza ?? 0) >= 75 ? "Media" : "Baja",
        revisar: row.revision === "REVISAR" || row.revision === "CONFLICTO",
        identidad: identidad(row),
        ingreso: boardDateISO(row.ingreso), primera_vista: board.foto_fecha.slice(0, 10), partes_visto: 1,
        board: row,
      });
    }
    out.push(...base.filter((item) => item.estado === "NO_ASISTENCIAL"));
  }
  return out;
}
