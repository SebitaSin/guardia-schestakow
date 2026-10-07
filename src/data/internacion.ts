import raw from "./internacion.json";
import { applyIdentidad } from "@/lib/identidad";
import { applyBoards, type BoardBed } from "@/lib/boards";

export type BedEstado =
  | "OCUPADA"
  | "LIBRE"
  | "BLOQUEADA"
  | "RESERVADA"
  | "DESCONOCIDA"
  | "NO_ASISTENCIAL";

export type IdentidadEstado =
  | "CONFIRMADA"
  | "PROBABLE"
  | "NO_VERIFICADA"
  | "CONFLICTO"
  | "REVISAR"
  | "A_CONFIRMAR";

export type InternacionBed = {
  servicio: string;
  slug: string;
  sala: string | null;
  cama: string;
  estado: BedEstado;
  paciente: string | null;
  paciente_original?: string | null;
  paciente_oficial?: string | null;
  lab_dni?: string | null;
  edad: string | null;
  diagnostico: string | null;
  observaciones: string | null;
  arm: boolean;
  aislamiento: boolean;
  confianza: "Alta" | "Media" | "Baja";
  revisar: boolean;
  noAsistencial?: boolean;
  piso?: string | null;
  identidad?: IdentidadEstado;
  person_id?: string | null;
  encounter_id?: string | null;
  bed_id?: string;
  imagen_id?: string;
  ingreso?: string | null;
  primera_vista?: string | null;
  partes_visto?: number;
  /** Presente cuando la cama viene de una planilla vigente publicada desde una foto. */
  board?: BoardBed;
};

type File = {
  fecha: string;
  hora: string;
  fuente: string;
  notes: Record<string, string>;
  beds: InternacionBed[];
};

const file = raw as File;

export const PARTE_FECHA = file.fecha;
export const PARTE_HORA = file.hora;
export const PARTE_FUENTE = file.fuente;
export const PARTE_NOTES = file.notes;
export const BEDS: InternacionBed[] = file.beds;

function liveBeds(): InternacionBed[] {
  return applyBoards(applyIdentidad(BEDS));
}

function liveMeta() {
  return { fecha: PARTE_FECHA, hora: PARTE_HORA };
}

export function asistenciales(list = liveBeds()) {
  return list.filter((b) => b.estado !== "NO_ASISTENCIAL");
}

export type ServicioOcupacion = {
  slug: string;
  name: string;
  total: number;
  ocupadas: number;
  libres: number;
  bloqueadas: number;
  desconocidas: number;
  revisar: number;
  arm: number;
  aislamiento: number;
  pct: number;
  note?: string;
};

export function ocupacionPorServicio(): ServicioOcupacion[] {
  const map = new Map<string, InternacionBed[]>();
  for (const bed of asistenciales()) {
    const list = map.get(bed.slug) ?? [];
    list.push(bed);
    map.set(bed.slug, list);
  }
  return [...map.entries()]
    .map(([slug, list]) => summarize(slug, list))
    .sort((a, b) => internacionRank(a.slug) - internacionRank(b.slug) || b.pct - a.pct);
}

const INTERNACION_ORDER = [
  "terapia-intensiva",
  "tip",
  "uco",
  "uccyq",
  "clinica-1",
  "clinica-2",
  "clinica-3",
  "cirugia",
  "traumatologia",
  "obstetricia",
  "ginecologia",
  "neonatologia",
  "pediatria",
  "pediatria-este",
  "pediatria-norte",
  "pediatria-adolescentes",
  "urologia",
  "salud-mental",
  "siiaps",
  "internacion-2-14",
];

function internacionRank(slug: string) {
  const i = INTERNACION_ORDER.indexOf(slug);
  return i < 0 ? 80 : i;
}

function summarize(slug: string, list: InternacionBed[]): ServicioOcupacion {
  const total = list.length;
  const ocupadas = list.filter((b) => b.estado === "OCUPADA").length;
  const libres = list.filter((b) => b.estado === "LIBRE").length;
  const bloqueadas = list.filter((b) => b.estado === "BLOQUEADA").length;
  const desconocidas = list.filter((b) => b.estado === "DESCONOCIDA").length;
  return {
    slug,
    name: list[0]?.servicio ?? slug,
    total,
    ocupadas,
    libres,
    bloqueadas,
    desconocidas,
    revisar: list.filter((b) => b.revisar).length,
    arm: list.filter((b) => b.arm).length,
    aislamiento: list.filter((b) => b.aislamiento).length,
    pct: (() => {
      const usable = ocupadas + libres;
      return usable ? Math.round((ocupadas / usable) * 100) : 0;
    })(),
    note: PARTE_NOTES[slug],
  };
}

export function resumenHospital() {
  const list = asistenciales();
  const ocupadas = list.filter((b) => b.estado === "OCUPADA").length;
  const libres = list.filter((b) => b.estado === "LIBRE").length;
  const bloqueadas = list.filter((b) => b.estado === "BLOQUEADA").length;
  const criticos = list.filter((b) => b.arm).length;
  return {
    total: list.length,
    ocupadas,
    libres,
    bloqueadas,
    criticos,
    arm: list.filter((b) => b.arm).length,
    aislamiento: list.filter((b) => b.aislamiento).length,
    revisar: list.filter((b) => b.revisar).length,
    postqx: list.filter((b) => /postqx|post CAL|POP |ces[aá]rea|postoperatorio/i.test(b.diagnostico ?? "")).length,
    pct: (() => {
      const usable = ocupadas + libres;
      return usable ? Math.round((ocupadas / usable) * 100) : 0;
    })(),
  };
}

export function bedsFor(slug: string) {
  return asistenciales().filter((b) => b.slug === slug);
}

export function servicioBySlug(slug: string) {
  return ocupacionPorServicio().find((s) => s.slug === slug);
}

export function searchBeds(q: string) {
  const n = fold(q.trim());
  const list = liveBeds();
  if (!n) return list;
  return list.filter((b) =>
    fold(
      [b.servicio, b.cama, b.sala, b.paciente, b.diagnostico, b.edad, b.observaciones, b.board?.dni, b.board?.hc]
        .filter(Boolean)
        .join(" "),
    ).includes(n),
  );
}

export type BedFilter = "todos" | "ocupada" | "libre" | "arm" | "aislamiento" | "revisar";

export function filterBeds(list: InternacionBed[], kind: BedFilter) {
  if (kind === "ocupada") return list.filter((b) => b.estado === "OCUPADA");
  if (kind === "libre") return list.filter((b) => b.estado === "LIBRE");
  if (kind === "arm") return list.filter((b) => b.arm);
  if (kind === "aislamiento") return list.filter((b) => b.aislamiento);
  if (kind === "revisar") return list.filter((b) => b.identidad === "A_CONFIRMAR" || b.revisar || b.estado === "DESCONOCIDA");
  return list;
}

function fold(s: string) {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/** Días internado: FI del pizarrón si existe; si no, partes desde que apareció el nombre. */
export function diasInternacion(bed: InternacionBed, hoy = bed.board ? new Date().toLocaleDateString("en-CA", { timeZone: "America/Argentina/Mendoza" }) : PARTE_FECHA) {
  const fi = bed.ingreso && /^\d{4}-\d{2}-\d{2}$/.test(bed.ingreso) ? bed.ingreso : null;
  const start = fi || (bed.primera_vista && /^\d{4}-\d{2}-\d{2}$/.test(bed.primera_vista) ? bed.primera_vista : hoy);
  const a = Date.parse(`${start}T12:00:00`);
  const b = Date.parse(`${hoy}T12:00:00`);
  const byDate = Number.isFinite(a) && Number.isFinite(b) ? Math.max(1, Math.round((b - a) / 86400000) + 1) : 1;
  const byParte = Math.max(1, bed.partes_visto ?? 1);
  return fi ? byDate : Math.max(byDate, byParte);
}

export function estadisticaDias() {
  const buckets = [
    { name: "1 día", min: 1, max: 1, n: 0 },
    { name: "2 días", min: 2, max: 2, n: 0 },
    { name: "3–4", min: 3, max: 4, n: 0 },
    { name: "5–7", min: 5, max: 7, n: 0 },
    { name: "8–14", min: 8, max: 14, n: 0 },
    { name: "15+", min: 15, max: 999, n: 0 },
  ];
  const list = asistenciales().filter((b) => b.estado === "OCUPADA");
  for (const bed of list) {
    const d = diasInternacion(bed);
    const bkt = buckets.find((x) => d >= x.min && d <= x.max);
    if (bkt) bkt.n += 1;
  }
  return { buckets, total: list.length };
}

export function alertasActivas() {
  const out: { tone: "danger" | "warn" | "ok"; title: string; detail: string }[] = [];
  for (const s of ocupacionPorServicio()) {
    if (s.pct >= 85 && s.total >= 6) {
      out.push({
        tone: "danger",
        title: `${s.name} · ${s.pct}% ocupación`,
        detail: s.libres === 1 ? "Solo 1 cama libre" : `${s.libres} libres / ${s.total}`,
      });
    } else if (s.pct >= 75 && s.total >= 6) {
      out.push({
        tone: "warn",
        title: `${s.name} · ${s.pct}% ocupación`,
        detail: `${s.libres} libres / ${s.total}`,
      });
    }
    if (s.arm) {
      out.push({
        tone: "warn",
        title: `${s.name} · ${s.arm} en ARM`,
        detail: "Asistencia respiratoria mecánica",
      });
    }
  }
  const rev = resumenHospital().revisar;
  if (rev) {
    out.push({
      tone: "ok",
      title: `${rev} pacientes A CONFIRMAR`,
      detail: "Nombre del pizarrón visible. Falta cruce de laboratorio o confirmación a mano.",
    });
  }
  return out;
}

const GROUPS: { id: string; label: string; re: RegExp }[] = [
  { id: "resp", label: "Respiratoria", re: /\bNAC\b|neumon[ií]a|IRAB|BQL|asm[aá]|EPOC|CAFO|disnea/i },
  { id: "trauma", label: "Traumatológica", re: /\bFx\b|fractura|TEC|cadera|f[eé]mur|luxaci[oó]n/i },
  { id: "qx", label: "Quirúrgica / CAL", re: /\bCAL\b|postqx|post CAL|hernia|colecist|gastrect/i },
  { id: "neuro", label: "Neurológica", re: /\bACV\b|convul|epilep|confusional|Guillain/i },
  { id: "onco", label: "Oncológica", re: /\bCA\b|linfoma|LMA|MTS|TU\b/i },
  { id: "dbt", label: "Pie DBT / metabólica", re: /Pie DBT|hipogluc|hipergluc|CAD|tirotoxic/i },
  { id: "mat", label: "Obstétrica", re: /Emb\.|ces[aá]rea|APP|pielonefritis/i },
  { id: "sm", label: "Salud mental", re: /\bIS\b|\bIAE\b|\bF20\b|\bF32\b|\bF14\b|heteroagresi/i },
];

export function patologias() {
  const occ = asistenciales().filter((b) => b.estado === "OCUPADA");
  const counts = GROUPS.map((g) => ({
    label: g.label,
    n: occ.filter((b) => g.re.test(`${b.diagnostico ?? ""} ${b.observaciones ?? ""}`)).length,
  })).filter((x) => x.n > 0);
  const tagged = new Set(
    occ.filter((b) => GROUPS.some((g) => g.re.test(`${b.diagnostico ?? ""}`))).map((b) => b.cama + b.slug),
  );
  const otras = occ.length - tagged.size;
  if (otras > 0) counts.push({ label: "Otras / sin agrupar", n: otras });
  counts.sort((a, b) => b.n - a.n);
  return { total: occ.length, counts };
}

export function barTone(pct: number) {
  if (pct >= 80) return "danger" as const;
  if (pct >= 60) return "warn" as const;
  return "ok" as const;
}

export function formatParteFecha() {
  const { fecha, hora } = liveMeta();
  const [y, m, d] = fecha.split("-").map(Number);
  return `${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}/${y} ${hora} hs`;
}
