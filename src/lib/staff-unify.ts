import { areaKey, personAreas, searchKey, type DirectoryPerson } from "./staff-directory";

/** Una persona real, aunque figure en más de una ficha (nómina + cronogramas de un servicio). */
export type UnifiedPerson = { person: DirectoryPerson; name: string; ids: string[]; areas: string[] };

const NO_AREA = "Sin servicio o tarea";

function tokens(name: string | undefined) {
  return searchKey(name ?? "").replace(/[^a-zñ ]/g, " ").split(/\s+/).filter((token) => token.length > 1);
}

/**
 * La Guardia tiene clínica, cirugía y pediatría propias. Si la ficha dice sólo "Guardia",
 * la especialidad de la persona indica a cuál pertenece.
 */
function areasOf(person: DirectoryPerson): string[] {
  const specialty = searchKey(person.specialty ?? "");
  return personAreas(person).map((area) => {
    if (area !== "Guardia") return area;
    if (specialty.includes("pediatr")) return "Guardia · Pediatría";
    if (specialty.includes("cirug")) return "Guardia · Cirugía";
    if (specialty.includes("clinica medica")) return "Guardia · Clínica";
    return area;
  });
}

function addAreas(target: string[], person: DirectoryPerson) {
  for (const area of areasOf(person)) {
    if (area !== NO_AREA && !target.some((known) => areaKey(known) === areaKey(area))) target.push(area);
  }
}

/**
 * Junta las fichas repetidas de un mismo empleado y le asigna todas sus áreas, ya unificadas
 * (UTI, UTIA y Terapia Intensiva Adultos son la misma área).
 * Una ficha de cronograma (sólo apellido, o apellido y un nombre) se une a la persona de la nómina
 * cuando no hay dudas: mismo nombre, o única persona posible, o única del mismo servicio.
 */
export function unifyPeople(people: DirectoryPerson[]): UnifiedPerson[] {
  type Entry = UnifiedPerson & { tokenSet: Set<string>; dni: string };
  const entries: Entry[] = [];
  const byName = new Map<string, Entry[]>();
  const fromSchedules = (person: DirectoryPerson) => person.source === "cronogramas";
  const create = (person: DirectoryPerson): Entry => {
    const entry: Entry = { person, name: person.name?.trim() || person.staffId, ids: [person.staffId], areas: [], tokenSet: new Set(tokens(person.name)), dni: (person.dni ?? "").trim() };
    addAreas(entry.areas, person);
    entries.push(entry);
    return entry;
  };

  for (const person of people.filter((item) => !fromSchedules(item))) {
    const key = tokens(person.name).sort().join(" ");
    const dni = (person.dni ?? "").trim();
    const same = key ? (byName.get(key) ?? []).find((entry) => !entry.dni || !dni || entry.dni === dni) : undefined;
    if (same) {
      same.ids.push(person.staffId);
      addAreas(same.areas, person);
      if (!same.dni) same.dni = dni;
      continue;
    }
    const entry = create(person);
    if (key) byName.set(key, [...(byName.get(key) ?? []), entry]);
  }

  const nominal = [...entries];
  for (const person of people.filter(fromSchedules)) {
    const mine = tokens(person.name);
    const areas = areasOf(person).map(areaKey);
    const candidates = mine.length ? nominal.filter((entry) => mine.every((token) => entry.tokenSet.has(token))) : [];
    const exact = candidates.filter((entry) => entry.tokenSet.size === mine.length);
    const sameArea = candidates.filter((entry) => entry.areas.some((area) => areas.includes(areaKey(area))));
    const match = exact.length === 1 ? exact[0]
      : sameArea.length === 1 ? sameArea[0]
        : candidates.length === 1 && mine.length >= 2 ? candidates[0]
          : undefined;
    if (match) {
      match.ids.push(person.staffId);
      addAreas(match.areas, person);
    } else {
      create(person);
    }
  }

  return entries
    .map(({ person, name, ids, areas }) => ({ person, name, ids, areas: areas.length ? areas : [NO_AREA] }))
    .sort((a, b) => a.name.localeCompare(b.name, "es"));
}

/** Áreas unificadas con sus personas, en orden alfabético. */
export function groupByArea(people: UnifiedPerson[]): { area: string; people: UnifiedPerson[] }[] {
  const groups = new Map<string, { area: string; people: UnifiedPerson[] }>();
  for (const item of people) {
    for (const area of item.areas) {
      const key = areaKey(area);
      const group = groups.get(key) ?? { area, people: [] };
      group.people.push(item);
      groups.set(key, group);
    }
  }
  return [...groups.values()].sort((a, b) => (a.area === NO_AREA ? 1 : b.area === NO_AREA ? -1 : a.area.localeCompare(b.area, "es")));
}
