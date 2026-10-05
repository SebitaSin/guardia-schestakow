import { readFileSync } from "node:fs";
import { readPrivateContacts } from "./private-contacts.mjs";
import { readPrivateLocations } from "./private-locations.mjs";

const staff = JSON.parse(readFileSync(new URL("../src/data/staff.json", import.meta.url), "utf8"));
const fold = (value) => String(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-ZÑ ]/g, " ").replace(/\s+/g, " ").trim();
export const originalStaff = Object.entries(staff.services).flatMap(([service, people]) => people
  .filter((person) => !/^SIN\b/i.test(person.name) && !/^SIN\b/i.test(person.surname))
  .map((person) => ({ staffId: `${service}--${fold(person.surname).toLowerCase().replace(/\s+/g, "-")}`, name: person.name, service, address: "", phone: "", source: "cronogramas" })));

export function staffDirectory(dataDir, secret) {
  const indexed = new Map(originalStaff.map((person) => [person.staffId, person]));
  for (const person of readPrivateContacts(dataDir, secret)) indexed.set(person.staffId, { ...indexed.get(person.staffId), ...person });
  for (const point of readPrivateLocations(dataDir, secret)) {
    const person = indexed.get(point.staffId);
    if (person) indexed.set(point.staffId, { ...person, address: person.address || point.address, transportMode: point.transportMode });
  }
  return [...indexed.values()];
}
