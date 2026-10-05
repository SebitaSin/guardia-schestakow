import raw from "./staff.json";
import { DEPARTMENT_BY_SLUG, DEPARTMENTS, type Department } from "./departments";

export type StaffPerson = {
  surname: string;
  name: string;
};

type StaffFile = {
  matchMin: number;
  aliases: Record<string, string>;
  services: Record<string, StaffPerson[]>;
  senders?: Record<string, string>;
};

const file = raw as StaffFile;

export const MATCH_MIN = file.matchMin;
const ALIASES: Record<string, string> = Object.fromEntries(
  Object.entries(file.aliases).map(([k, v]) => [fold(k), fold(v)]),
);

const STOP = new Set(
  [
    "DR",
    "DRA",
    "LIC",
    "BIOQ",
    "TEC",
    "ENF",
    "KINE",
    "SR",
    "SRA",
    "GUARDIA",
    "GUARDIAS",
    "CRONOGRAMA",
    "PARTE",
    "PASIVA",
    "MES",
    "SERVICIO",
    "HOSPITAL",
    "PISO",
    "CLINICA",
    "MEDICA",
    "ENERO",
    "FEBRERO",
    "MARZO",
    "ABRIL",
    "MAYO",
    "JUNIO",
    "JULIO",
    "AGOSTO",
    "SEPTIEMBRE",
    "OCTUBRE",
    "NOVIEMBRE",
    "DICIEMBRE",
    "TURNO",
    "NOCHE",
    "MANANA",
    "TARDE",
    "ACTIVO",
    "PASIVO",
    "TITULAR",
    "FERIADO",
    "TOTAL",
    "EMPLEADO",
    "PERIODO",
    "NOMBRE",
    "APELLIDO",
    "HS",
    "HORAS",
    "UTIA",
    "UTI",
    "UCCYQ",
    "UCIQ",
    "UCO",
    "TIP",
  ].map(fold),
);

export function fold(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/Ñ/g, "Ñ")
    .replace(/[^A-ZÑ ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function canonical(token: string): string {
  const key = fold(token);
  return ALIASES[key] ?? key;
}

export function surnamesOf(people: StaffPerson[]): Set<string> {
  return new Set(people.map((p) => canonical(p.surname)));
}

export function staffFor(slug: string): StaffPerson[] {
  return file.services[slug] ?? [];
}

const INDEX: { slug: string; surnames: Set<string> }[] = DEPARTMENTS.map((d) => ({
  slug: d.slug,
  surnames: surnamesOf(staffFor(d.slug)),
}));

const SURNAME_OWNERS: Record<string, string[]> = {};
for (const row of INDEX) {
  for (const surname of row.surnames) {
    (SURNAME_OWNERS[surname] ??= []).push(row.slug);
  }
}

function exclusiveCount(slug: string, hits: string[]): number {
  return hits.filter((h) => SURNAME_OWNERS[h]?.length === 1 && SURNAME_OWNERS[h][0] === slug).length;
}

export function detectServiceLabel(text: string): string | null {
  const f = fold(text);
  if (/\bTIP\b/.test(f) || /TERAPIA INTENSIVA PEDIATR/.test(f)) return "tip";
  if (/\bUTIA\b/.test(f) || /TERAPIA INTENSIVA/.test(f) || /\bUTI\b/.test(f)) return "terapia-intensiva";
  if (/\bUCCYQ\b/.test(f) || /CUIDADOS CRITICOS Y QUEMAD/.test(f)) return "uccyq";
  if (/\bUCIQ\b/.test(f)) return "uciq";
  if (/\bUCO\b/.test(f) || /UNIDAD CORONARIA/.test(f)) return "uco";
  if (/PISO/.test(f) && /CLINICA/.test(f)) return "piso-clinica";
  if (/GUARDIA CENTRAL/.test(f) || (/GUARDIA/.test(f) && /CLINICA/.test(f))) return "guardia-clinica";
  if (/SALUD MENTAL/.test(f)) return "salud-mental";
  if (/OBSTETRIC/.test(f)) return "obstetricia";
  if (/GINECOLOG/.test(f)) return "ginecologia";
  if (/NEONATOLOG/.test(f)) return "neonatologia";
  if (/CIRUGIA PEDIATR/.test(f)) return "cirugia-pediatrica";
  if (/PEDIATR/.test(f) && !/CIRUGIA/.test(f) && !/NEONATO/.test(f)) return "pediatria";
  if (/ANESTESI/.test(f)) return "anestesiologia";
  if (/ENDOSCOP/.test(f)) return "endoscopias";
  if (/HEMOTER/.test(f) || /\bHT\b/.test(f)) return "hemoterapia";
  if (/LABORATORIO|BIOQUIM/.test(f)) return "laboratorio";
  if (/DIAGNOSTICO POR IMAGEN|RX\b|RADIOLOG/.test(f)) return "diagnostico-imagenes";
  if (/ODONTO/.test(f)) return "odontologia";
  if (/KINESIO/.test(f)) return "kinesiologia";
  if (/TRAUMATOLOG/.test(f)) return "traumatologia";
  if (/UROLOG/.test(f)) return "urologia";
  if (/MANTENIMIENTO/.test(f)) return "mantenimiento";
  if (/PORTERIA/.test(f)) return "porteria";
  if (/MENSAJER/.test(f)) return "mensajeria";
  if (/ALBERGUE/.test(f)) return "albergue";
  if (/ESTERILIZ/.test(f)) return "esterilizacion";
  if (/MOVILIDAD|CAMILLER/.test(f)) return "movilidad";
  if (/\bCIRUGIA\b/.test(f) && !/PEDIATR/.test(f)) return "cirugia";
  return null;
}

type Ranked = { slug: string; score: number; exclusive: number; hits: string[] };

function rankServices(text: string): Ranked[] {
  const keys = extractSurnames(text);
  if (!keys.length) return [];
  return INDEX.map(({ slug, surnames }) => {
    const hits = keys.filter((k) => surnames.has(k));
    return { slug, score: hits.length, exclusive: exclusiveCount(slug, hits), hits };
  })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.exclusive - a.exclusive || b.score - a.score);
}

export type StaffMatch = {
  dept: Department;
  score: number;
  hits: string[];
  second?: { slug: string; score: number };
};

function toMatch(row: Ranked, second?: Ranked): StaffMatch | null {
  const dept = DEPARTMENT_BY_SLUG[row.slug];
  if (!dept) return null;
  return {
    dept,
    score: row.score,
    hits: row.hits,
    second: second ? { slug: second.slug, score: second.score } : undefined,
  };
}

export function matchService(text: string, min = MATCH_MIN): StaffMatch | null {
  const ranked = rankServices(text);
  const best = ranked[0];
  if (!best || best.score < min) return null;
  const second = ranked[1];
  if (second && second.score === best.score && second.exclusive === best.exclusive) return null;
  return toMatch(best, second);
}

export function classifyCronograma(title: string, body: string): StaffMatch | null {
  const labeled = detectServiceLabel(`${title} ${body}`);
  if (labeled && DEPARTMENT_BY_SLUG[labeled]) {
    const ranked = rankServices(`${title} ${body}`);
    const row = ranked.find((r) => r.slug === labeled) ?? {
      slug: labeled,
      score: 0,
      exclusive: 0,
      hits: [] as string[],
    };
    const second = ranked.find((r) => r.slug !== labeled);
    return toMatch(row, second);
  }
  return matchService(`${title}\n${body}`);
}

export function classifyDocText(parts: string[]): StaffMatch | null {
  const [title, ...rest] = parts;
  return classifyCronograma(title ?? "", rest.filter(Boolean).join(" · "));
}

export function extractSurnames(text: string): string[] {
  const folded = fold(text);
  if (!folded) return [];
  const words = folded.split(" ");
  const found = new Set<string>();
  for (let i = 0; i < words.length; i += 1) {
    const w = words[i];
    if (!w || w.length < 3 || STOP.has(w) || /^R[1-4]$/.test(w)) continue;
    const compounds: string[] = [];
    if (i + 2 < words.length && w === "GARCIA" && words[i + 1] === "DEL") {
      compounds.push(`GARCIA DEL ${words[i + 2]}`);
    }
    if (i + 1 < words.length && (w === "DE" || w === "DI" || w === "DEL")) {
      compounds.push(`${w} ${words[i + 1]}`);
    }
    if (i + 1 < words.length && w === "GIL") {
      compounds.push(`GIL ${words[i + 1]}`);
    }
    for (const c of compounds) {
      const key = canonical(c);
      if (key.length >= 3) found.add(key);
    }
    if (w !== "DE" && w !== "DI" && w !== "DEL" && w !== "LA" && w !== "LOS" && w !== "LAS") {
      found.add(canonical(w));
    }
  }
  return [...found];
}

export function personId(slug: string, surname: string) {
  return `${slug}--${fold(surname).toLowerCase().replace(/\s+/g, "-")}`;
}

export const STAFF_INDEX = DEPARTMENTS.flatMap((department) =>
  staffFor(department.slug)
    .filter((person) => !/^SIN\b/i.test(person.surname.trim()) && !/^SIN\b/i.test(person.name.trim()))
    .map((person) => ({
      id: personId(department.slug, person.surname),
      name: person.name,
      surname: person.surname,
      service: department.slug,
      serviceName: department.short,
    })),
);

export function personById(id: string): { slug: string; person: StaffPerson } | null {
  const i = id.indexOf("--");
  if (i < 0) return null;
  const slug = id.slice(0, i);
  const sur = fold(id.slice(i + 2).replace(/-/g, " "));
  const person = staffFor(slug).find((p) => fold(p.surname) === sur);
  return person ? { slug, person } : null;
}

export function findStaffPerson(dutyName: string, deptSlug?: string) {
  const keys = extractSurnames(dutyName);
  if (!keys.length) return null;
  const slugs = deptSlug
    ? [deptSlug, ...DEPARTMENTS.map((d) => d.slug).filter((s) => s !== deptSlug)]
    : DEPARTMENTS.map((d) => d.slug);
  for (const slug of slugs) {
    for (const person of staffFor(slug)) {
      if (keys.includes(canonical(person.surname))) return { slug, person };
    }
  }
  return null;
}
