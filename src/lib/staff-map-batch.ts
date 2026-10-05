import type { DirectoryPerson } from "./staff-directory";
import type { PrivateStaffLocation } from "./private-locations";
import type { AddressPoint } from "./google-address";
import { hasPreciseAddress, validMapPoint } from "./staff-coverage";

export async function locatePendingStaff(people: DirectoryPerson[], locations: PrivateStaffLocation[], actions: {
  geocode: (address: string) => Promise<AddressPoint[]>;
  save: (person: DirectoryPerson, point: AddressPoint) => Promise<void>;
  cancelled: () => boolean;
  progress: (count: number, total: number) => void;
}) {
  const existing = new Set(locations.filter(validMapPoint).map((point) => point.staffId));
  const candidates = people.filter((p) => !existing.has(p.staffId) && hasPreciseAddress(p.address) && p.sourceConfidence !== "DUDOSO");
  const cache = new Map<string, AddressPoint[]>();
  let saved = 0, review = 0, processed = 0, blocker = "", transientFailures = 0;
  for (const person of candidates) {
    if (actions.cancelled()) break;
    try {
      const addressKey = person.address.trim().toLocaleLowerCase("es");
      const results = cache.get(addressKey) ?? await actions.geocode(person.address);
      transientFailures = 0;
      cache.set(addressKey, results);
      if (actions.cancelled()) break;
      if (results.length === 1 && results[0].precise && validMapPoint(results[0])) { await actions.save(person, results[0]); saved++; }
      else review++;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/ZERO_RESULTS|stale_private_address/.test(message)) { review++; transientFailures = 0; }
      else if (/no respondió|timeout|UNKNOWN_ERROR|network/i.test(message)) {
        review++; transientFailures++;
        if (transientFailures >= 3) { blocker = `Tres fallos de conexión consecutivos: ${message}`; break; }
      }
      else { blocker = message; break; }
    }
    processed++; actions.progress(processed, candidates.length);
  }
  return { saved, review, processed, candidates: candidates.length, blocker };
}
