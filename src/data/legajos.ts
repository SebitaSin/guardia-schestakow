import raw from "./legajos.json";
import { personId, type StaffPerson } from "./staff";

export type LegajoSource = { label: string; url: string };

export type LegajoPublic = {
  displayName?: string;
  specialty?: string;
  mp?: string;
  phone?: string;
  hours?: string;
  notes?: string;
  sources?: LegajoSource[];
  photo?: string | null;
};

const FILE = raw as Record<string, LegajoPublic>;

export const EMPTY_FICHA: Required<Omit<LegajoPublic, "sources" | "photo">> & { photo: string | null } = {
  displayName: "",
  specialty: "",
  mp: "",
  phone: "",
  hours: "",
  notes: "",
  photo: null,
};

export const ESPECIALIDAD: Record<string, string> = {
  "piso-clinica": "Clínica Médica",
  "clinica-1": "Clínica Médica 1",
  "clinica-2": "Clínica Médica 2",
  "clinica-3": "Clínica Médica 3",
  "guardia-clinica": "Guardia Clínica Médica",
  uco: "Unidad Coronaria",
  "terapia-intensiva": "Terapia Intensiva",
  uccyq: "Cuidados críticos y quemados",
  uciq: "UCIQ",
  "salud-mental": "Salud Mental",
  obstetricia: "Obstetricia",
  ginecologia: "Ginecología",
  neonatologia: "Neonatología",
  pediatria: "Pediatría",
  "cirugia-pediatrica": "Cirugía Pediátrica",
  tip: "Terapia Intensiva Pediátrica",
  cirugia: "Cirugía",
  traumatologia: "Traumatología",
  urologia: "Urología",
  anestesiologia: "Anestesiología",
  endoscopias: "Endoscopías",
  laboratorio: "Laboratorio / Bioquímica",
  hemoterapia: "Hemoterapia",
  "diagnostico-imagenes": "Diagnóstico por Imágenes",
  odontologia: "Odontología",
  kinesiologia: "Kinesiología",
  movilidad: "Movilidad",
  mantenimiento: "Mantenimiento",
  porteria: "Portería",
  mensajeria: "Mensajería",
  albergue: "Albergue",
  esterilizacion: "Esterilización",
  siiaps: "SIIAPS",
};

export function publicLegajo(slug: string, person: StaffPerson): LegajoPublic {
  return FILE[personId(slug, person.surname)] ?? {};
}

export function initialsOf(name: string) {
  const parts = name
    .replace(/^(Dr\.?|Dra\.?)\s+/i, "")
    .split(/\s+/)
    .filter(Boolean);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase();
}
