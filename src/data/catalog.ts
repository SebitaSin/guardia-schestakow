import raw from "./catalog.json";
import { DEPARTMENT_BY_SLUG, DEPARTMENTS, type Department } from "./departments";
import { loadOverrides } from "@/lib/overrides";
import { liveDocuments } from "@/lib/live-catalog";

export type DocKind = "cronograma" | "parte" | "pasiva" | "modificacion";
export type PreviewKind = "calendar" | "table" | "pages" | "image" | "text" | "file";

export type Shift = { date: string; text: string };
export type CalCell = { day: number | null; text: string };

export type GuardiaDoc = {
  id: string;
  title: string;
  filename: string;
  departments: string[];
  kind: DocKind;
  month: number | null;
  year: number;
  fileType: string;
  fileUrl: string | null;
  thumbUrl: string | null;
  pageImages: string[];
  preview: PreviewKind;
  notes: string[];
  flags: string[];
  calendar: CalCell[][] | null;
  table: string[][] | null;
  shifts: Shift[];
  bytes: number;
  /** Sólo en cronogramas leídos automáticamente del correo. */
  source?: { mailDate: string; layout?: string; sender?: string };
  superseded?: boolean;
};

export type Catalog = {
  generatedAt: string;
  hospital: string;
  location: string;
  sourceLabel: string;
  syncHours: string[];
  timezone: string;
  documents: GuardiaDoc[];
};

export const catalog = raw as Catalog;

function applyLive(doc: GuardiaDoc): GuardiaDoc {
  const over = loadOverrides().docs[doc.id];
  if (!over) return doc;
  return {
    ...doc,
    departments: over.departments ?? doc.departments,
    kind: over.kind ?? doc.kind,
    month: over.month === undefined ? doc.month : over.month,
    year: over.year ?? doc.year,
    title: over.title ?? doc.title,
    shifts: over.shifts ?? doc.shifts,
  };
}

/** Lo leído del correo va primero y reemplaza al archivo fijo cuando es el mismo documento. */
function baseDocuments(): GuardiaDoc[] {
  const live = liveDocuments();
  if (!live.length) return catalog.documents;
  const ids = new Set(live.map((d) => d.id));
  return [...live, ...catalog.documents.filter((d) => !ids.has(d.id))];
}

export function allDocuments(): GuardiaDoc[] {
  const hidden = loadOverrides().docs;
  return baseDocuments().map(applyLive).filter((d) => !hidden[d.id]?.hidden && !d.superseded);
}

export function liveSyncHours(): string[] {
  return loadOverrides().syncHours ?? catalog.syncHours;
}

export const MONTHS_ES = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];

export const WEEKDAYS_ES = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"];
export const WEEKDAYS_FULL = [
  "lunes",
  "martes",
  "miércoles",
  "jueves",
  "viernes",
  "sábado",
  "domingo",
];

export function todayISO(date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: catalog.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function formatLongDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12));
  const weekday = WEEKDAYS_FULL[dt.getUTCDay() === 0 ? 6 : dt.getUTCDay() - 1];
  return `${weekday} ${d} de ${MONTHS_ES[m - 1]} de ${y}`;
}

export function kindLabel(kind: DocKind): string {
  switch (kind) {
    case "cronograma":
      return "Cronograma";
    case "parte":
      return "Parte";
    case "pasiva":
      return "Guardia pasiva";
    case "modificacion":
      return "Modificación";
  }
}

export function displayTitle(doc: GuardiaDoc): string {
  const generic = /^(mayo|junio|julio|agosto|septiembre|setiembre|octubre)(\s*26)?$/i;
  if (doc.title.length > 18 && !generic.test(doc.title.trim())) return doc.title;
  const dept = DEPARTMENT_BY_SLUG[doc.departments[0] ?? ""];
  const month = doc.month ? MONTHS_ES[doc.month - 1] : "";
  return [kindLabel(doc.kind), dept?.short, month, doc.year].filter(Boolean).join(" · ");
}

export function docsForDept(slug: string): GuardiaDoc[] {
  return allDocuments().filter((d) => d.departments.includes(slug));
}

export function hasMonthCronograma(slug: string, month: number, year: number): boolean {
  return docsForDept(slug).some(
    (d) => d.month === month && d.year === year && d.kind !== "modificacion",
  );
}

export function docsInMonth(month: number, year: number): GuardiaDoc[] {
  const pool = allDocuments()
    .filter((d) => d.month === month && d.year === year && d.kind !== "modificacion")
    .sort(rankDocs);
  const byDept = new Map<string, GuardiaDoc>();
  for (const doc of pool) {
    const slug = doc.departments[0];
    if (!slug || byDept.has(slug)) continue;
    byDept.set(slug, doc);
  }
  return DEPARTMENTS.map((d) => byDept.get(d.slug)).filter((d): d is GuardiaDoc => Boolean(d));
}

export function monthCoverage(month: number, year: number): {
  present: Department[];
  missing: Department[];
} {
  const present: Department[] = [];
  const missing: Department[] = [];
  for (const dept of DEPARTMENTS) {
    if (hasMonthCronograma(dept.slug, month, year)) present.push(dept);
    else missing.push(dept);
  }
  return { present, missing };
}

export function latestDoc(slug: string, month?: number, year?: number): GuardiaDoc | undefined {
  const list = docsForDept(slug);
  const pool =
    month && year ? list.filter((d) => d.month === month && d.year === year) : list;
  if (!pool.length) return undefined;
  const withShifts = pool.filter((d) => d.shifts.length > 0);
  return [...(withShifts.length ? withShifts : pool)].sort(rankDocs)[0];
}

function rankDocs(a: GuardiaDoc, b: GuardiaDoc): number {
  const score = (d: GuardiaDoc) =>
    (d.year || 0) * 100 +
    (d.month || 0) +
    (d.kind === "cronograma" ? 0.4 : 0) +
    (d.shifts.length > 0 ? 0.2 : 0) +
    (d.flags.includes("definitivo") ? 0.15 : 0) -
    (d.flags.includes("tentativo") ? 0.1 : 0) +
    // A igualdad de condiciones vale el correo más nuevo.
    (d.source?.mailDate ? Math.min(0.04, Math.max(0, Date.parse(d.source.mailDate) / 1e15)) : 0);
  return score(b) - score(a);
}

export type DutyHit = {
  dept: Department;
  doc: GuardiaDoc;
  text: string;
};

export function dutiesOn(iso: string): DutyHit[] {
  const hits: DutyHit[] = [];
  for (const dept of DEPARTMENTS) {
    const docs = docsForDept(dept.slug)
      .filter((d) => d.shifts.some((s) => s.date === iso))
      .sort(rankDocs);
    const doc = docs[0];
    if (!doc) continue;
    // Un servicio puede mandar más de un plantel (médicos, licenciados, pasivas): se muestran todos.
    const fromMail = docs.filter((d) => d.source);
    const parts: string[] = [];
    for (const item of fromMail.length ? fromMail : [doc]) {
      const text = item.shifts.find((s) => s.date === iso)?.text ?? "";
      for (const piece of text.split(/\s*·\s*/)) if (piece.trim() && !parts.includes(piece.trim())) parts.push(piece.trim());
    }
    if (!parts.length) continue;
    hits.push({ dept, doc, text: parts.join(" · ") });
  }
  return hits;
}

/**
 * Servicios que tuvieron guardia en las semanas anteriores pero no tienen planilla para ese día.
 * Se muestran en blanco, con tantos lugares como tenía la guardia del mes anterior.
 */
export function missingDutiesOn(iso: string): { dept: Department; slots: number }[] {
  const covered = new Set(dutiesOn(iso).map((hit) => hit.dept.slug));
  const [year, month, day] = iso.split("-").map(Number);
  // Mismo día de la semana en las semanas anteriores: cuánta gente tuvo de guardia cada servicio.
  const history = new Map<string, number[]>();
  for (let week = 1; week <= 9; week++) {
    const date = new Date(Date.UTC(year, month - 1, day - 7 * week, 12)).toISOString().slice(0, 10);
    for (const hit of dutiesOn(date)) {
      const counts = history.get(hit.dept.slug) ?? [];
      if (counts.length < 4) counts.push(dutyLines(hit.text).length);
      history.set(hit.dept.slug, counts);
    }
  }
  const out: { dept: Department; slots: number }[] = [];
  for (const dept of DEPARTMENTS) {
    if (covered.has(dept.slug)) continue;
    const counts = (history.get(dept.slug) ?? []).sort((x, y) => x - y);
    if (!counts.length) continue;
    out.push({ dept, slots: Math.max(1, Math.min(counts[Math.floor(counts.length / 2)], 12)) });
  }
  return out;
}

export function alerts(): GuardiaDoc[] {
  return allDocuments().filter(
    (d) =>
      d.kind === "modificacion" ||
      d.flags.includes("tentativo") ||
      d.flags.includes("actualizado") ||
      d.flags.includes("cambio"),
  );
}

export function monthsPresent(): { year: number; month: number; count: number }[] {
  const map = new Map<string, number>();
  for (const d of allDocuments()) {
    if (!d.month) continue;
    const key = `${d.year}-${d.month}`;
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return [...map.entries()]
    .map(([k, count]) => {
      const [year, month] = k.split("-").map(Number);
      return { year, month, count };
    })
    .sort((a, b) => b.year - a.year || b.month - a.month);
}

export type MonthCell = {
  day: number;
  date: string;
  text: string;
} | null;

export function monthCells(year: number, month: number, shifts: Shift[]): MonthCell[] {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const startDow = (first.getUTCDay() + 6) % 7;
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const byDate = new Map(shifts.map((s) => [s.date, s.text]));
  const cells: MonthCell[] = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= days; d++) {
    const date = `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    cells.push({ day: d, date, text: byDate.get(date) ?? "" });
  }
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

export function splitDuty(text: string): string[] {
  const chunks = text
    .split(/\s*·\s*|\s{2,}/)
    .map((s) => s.trim())
    .filter(Boolean);
  const out: string[] = [];
  const nameSlash = /(?<=[A-Za-zÁÉÍÓÚÑáéíóúñ.])\s*\/\s*(?=[A-Za-zÁÉÍÓÚÑáéíóúñ.])/;
  for (const chunk of chunks) {
    if (!nameSlash.test(chunk)) {
      out.push(chunk);
      continue;
    }
    const people = chunk.split(nameSlash).map((s) => s.trim()).filter(Boolean);
    if (people.length === 2) {
      const timePair = people[1].match(
        /^(.*?)(?:\s+)?(\d{1,2}(?::\d{2})?\s*-\s*\d{1,2}(?::\d{2})?)\s*\/\s*(\d{1,2}(?::\d{2})?\s*-\s*\d{1,2}(?::\d{2})?)$/,
      );
      if (timePair) {
        const second = timePair[1].trim();
        out.push(`${people[0]} ${timePair[2]}`.trim());
        out.push(`${second} ${timePair[3]}`.trim());
        continue;
      }
    }
    out.push(...people);
  }
  return out;
}

export type DutyLine = { name: string; hours: string | null };

const HOURS_RANGE =
  /(\d{1,2})(?::(\d{2}))?\s*(?:h|hs)?\s*[-–]\s*(\d{1,2})(?::(\d{2}))?\s*(?:hs|h)?/i;
const HOURS_24 = /\b24\s*(?:hs|h|horas)\b/i;

function clock(hour: string, minute?: string) {
  return `${hour.padStart(2, "0")}:${minute ?? "00"}`;
}

export function dutyLines(text: string): DutyLine[] {
  return splitDuty(text).map((chunk) => {
    if (HOURS_24.test(chunk)) {
      const name = chunk.replace(HOURS_24, "").replace(/\s+/g, " ").trim();
      return { name: name || chunk.trim(), hours: "24 h" };
    }
    const match = chunk.match(HOURS_RANGE);
    if (!match) return { name: chunk, hours: null };
    const hours = `${clock(match[1], match[2])}–${clock(match[3], match[4])}`;
    const name = chunk.replace(match[0], "").replace(/\s+/g, " ").trim();
    return { name: name || chunk, hours };
  });
}

export function wasModified(doc: GuardiaDoc): boolean {
  return (
    doc.kind === "modificacion" ||
    doc.flags.includes("cambio") ||
    doc.flags.includes("actualizado")
  );
}

const CLINICAL_PRIORITY: Record<string, number> = {
  "terapia-intensiva": 0,
  uccyq: 1,
  uco: 2,
  uciq: 3,
  "piso-clinica": 4,
  "guardia-clinica": 5,
  cirugia: 6,
  pediatria: 7,
  obstetricia: 8,
};

export function clinicalRank(slug: string): number {
  if (slug in CLINICAL_PRIORITY) return CLINICAL_PRIORITY[slug];
  const i = DEPARTMENTS.findIndex((d) => d.slug === slug);
  return 20 + (i < 0 ? 50 : i);
}

export function formatUpdated(isoDay: string): string {
  const [y, m, d] = isoDay.split("-").map(Number);
  if (!y || !m || !d) return isoDay;
  return `${d} de ${MONTHS_ES[m - 1]} de ${y}`;
}

export function searchDocs(query: string): GuardiaDoc[] {
  const q = query.trim().toLowerCase();
  const docs = allDocuments();
  if (!q) return docs;
  return docs.filter((d) => {
    const hay = [
      d.title,
      d.filename,
      displayTitle(d),
      ...d.notes,
      ...d.shifts.map((s) => s.text),
      ...d.departments.map((s) => DEPARTMENT_BY_SLUG[s]?.name ?? s),
    ]
      .join(" ")
      .toLowerCase();
    return hay.includes(q);
  });
}

export function docById(id: string): GuardiaDoc | undefined {
  const raw = baseDocuments().find((d) => d.id === id);
  return raw ? applyLive(raw) : undefined;
}
