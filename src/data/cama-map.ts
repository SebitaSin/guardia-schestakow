/** Numeración del Hospital Schestakow: 100 = 1er piso, 200 = 2º, … 600 = 6º. */

export type CamaServicio = {
  slug: string;
  name: string;
  piso: string;
  rango: string;
};

export const CAMA_MAPA: CamaServicio[] = [
  { slug: "pediatria", name: "Pediatría", piso: "1º", rango: "100–199" },
  { slug: "obstetricia", name: "Maternidad", piso: "2º", rango: "200–299" },
  { slug: "cirugia", name: "Cirugía", piso: "3º", rango: "301–314" },
  { slug: "uccyq", name: "UCCyQ", piso: "3º", rango: "315–328" },
  { slug: "traumatologia", name: "Traumatología", piso: "4º", rango: "401–414" },
  { slug: "ginecologia", name: "Ginecología", piso: "4º", rango: "415–428" },
  { slug: "clinica-1", name: "Clínica Médica 1", piso: "5º", rango: "501–514" },
  { slug: "clinica-2", name: "Clínica Médica 2", piso: "5º", rango: "515–528" },
  { slug: "clinica-3", name: "Clínica Médica 3", piso: "6º", rango: "601–614" },
  { slug: "urologia", name: "Urología", piso: "6º", rango: "615 en adelante" },
  { slug: "uco", name: "UCO", piso: "Unidad", rango: "1–8" },
  { slug: "terapia-intensiva", name: "UTI adultos", piso: "Unidad", rango: "1–10" },
  { slug: "tip", name: "UTI pediátrica", piso: "Unidad", rango: "1–6" },
  { slug: "salud-mental", name: "Salud Mental", piso: "Unidad", rango: "—" },
  { slug: "neonatologia", name: "Neonatología", piso: "Unidad", rango: "—" },
  { slug: "siiaps", name: "SIIAPS", piso: "Unidad", rango: "—" },
];

export function numeroEdificio(cama: string): number | null {
  const m = cama.match(/(\d{3})/);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 100 && n <= 699 ? n : null;
}

export function servicioPorNumero(n: number): CamaServicio | null {
  if (n >= 100 && n <= 199) return CAMA_MAPA.find((x) => x.slug === "pediatria") ?? null;
  if (n >= 200 && n <= 299) return CAMA_MAPA.find((x) => x.slug === "obstetricia") ?? null;
  if (n >= 301 && n <= 314) return CAMA_MAPA.find((x) => x.slug === "cirugia") ?? null;
  if (n >= 315 && n <= 328) return CAMA_MAPA.find((x) => x.slug === "uccyq") ?? null;
  if (n >= 401 && n <= 414) return CAMA_MAPA.find((x) => x.slug === "traumatologia") ?? null;
  if (n >= 415 && n <= 428) return CAMA_MAPA.find((x) => x.slug === "ginecologia") ?? null;
  if (n >= 501 && n <= 514) return CAMA_MAPA.find((x) => x.slug === "clinica-1") ?? null;
  if (n >= 515 && n <= 528) return CAMA_MAPA.find((x) => x.slug === "clinica-2") ?? null;
  if (n >= 601 && n <= 614) return CAMA_MAPA.find((x) => x.slug === "clinica-3") ?? null;
  if (n >= 615 && n <= 699) return CAMA_MAPA.find((x) => x.slug === "urologia") ?? null;
  return null;
}

export function clasificarCama(cama: string): CamaServicio | null {
  const n = numeroEdificio(cama);
  return n ? servicioPorNumero(n) : null;
}
