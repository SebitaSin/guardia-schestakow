import { allDocuments, type GuardiaDoc } from "@/data/catalog";
import { fold } from "@/data/staff";
import { loadOverrides, patchDoc } from "@/lib/overrides";
import { storageGet, storageSet } from "@/lib/safe-storage";

export type CambioAplicado = {
  id: string;
  at: string;
  fuente: string;
  docId: string;
  servicio: string;
  a: string;
  b: string;
  dateA: string;
  dateB: string;
  beforeA: string;
  beforeB: string;
  afterA: string;
  afterB: string;
};

const LOG = "schestakow.cambios.v1";

export function loadCambios(): CambioAplicado[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(storageGet(LOG) || "[]") as CambioAplicado[];
  } catch {
    return [];
  }
}

function saveLog(items: CambioAplicado[]) {
  storageSet(LOG, JSON.stringify(items.slice(0, 80)));
}

function nameHit(token: string, who: string) {
  const t = fold(token);
  const w = fold(who);
  if (!t || !w || t === "SIN") return false;
  return t === w || t.startsWith(w) || w.startsWith(t);
}

function partsOf(text: string) {
  return text.split(/\s*[·|/]\s*/).map((p) => p.trim()).filter(Boolean);
}

function replaceName(text: string, who: string, neu: string) {
  const parts = partsOf(text);
  const i = parts.findIndex((p) => nameHit(p, who));
  if (i < 0) return null;
  parts[i] = neu;
  return parts.join(" · ");
}

function takenName(text: string, who: string) {
  return partsOf(text).find((p) => nameHit(p, who)) ?? null;
}

function isoForDay(day: number, month: number, year: number) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function prepararPermuta(input: {
  a: string;
  b: string;
  diaA: number;
  diaB: number;
  month?: number;
  year?: number;
  slug?: string;
  fuente?: string;
}): { ok: true; cambio: CambioAplicado } | { ok: false; error: string } {
  const now = new Date();
  const month = input.month ?? now.getMonth() + 1;
  const year = input.year ?? now.getFullYear();
  const dateA = isoForDay(input.diaA, month, year);
  const dateB = isoForDay(input.diaB, month, year);
  if (dateA === dateB) return { ok: false, error: "Las dos fechas son la misma." };

  const docs = allDocuments().filter((d) => {
    if (d.kind === "parte") return false;
    if (input.slug && !d.departments.includes(input.slug)) return false;
    const sa = d.shifts.find((s) => s.date === dateA)?.text ?? "";
    const sb = d.shifts.find((s) => s.date === dateB)?.text ?? "";
    return Boolean(takenName(sa, input.a) && takenName(sb, input.b));
  });

  const doc: GuardiaDoc | undefined = docs[0];
  if (!doc) {
    return {
      ok: false,
      error: `No se encontró ${input.a} el día ${input.diaA} y ${input.b} el día ${input.diaB} en el mismo cronograma.`,
    };
  }

  const beforeA = doc.shifts.find((s) => s.date === dateA)?.text ?? "";
  const beforeB = doc.shifts.find((s) => s.date === dateB)?.text ?? "";
  const nameA = takenName(beforeA, input.a);
  const nameB = takenName(beforeB, input.b);
  if (!nameA || !nameB) return { ok: false, error: "Los nombres no coinciden con el cronograma." };

  const afterA = replaceName(beforeA, input.a, nameB);
  const afterB = replaceName(beforeB, input.b, nameA);
  if (!afterA || !afterB) return { ok: false, error: "No se pudo reescribir el turno." };

  const shifts = doc.shifts.map((s) => {
    if (s.date === dateA) return { ...s, text: afterA };
    if (s.date === dateB) return { ...s, text: afterB };
    return s;
  });
  const cambio: CambioAplicado = {
    id: `${doc.id}-${dateA}-${dateB}-${Date.now()}`,
    at: now.toISOString(),
    fuente: input.fuente ?? "manual",
    docId: doc.id,
    servicio: doc.departments[0] ?? "",
    a: nameA,
    b: nameB,
    dateA,
    dateB,
    beforeA,
    beforeB,
    afterA,
    afterB,
  };
  return { ok: true, cambio };
}

export async function aplicarPermuta(input: {
  a: string; b: string; diaA: number; diaB: number; month?: number; year?: number; slug?: string; fuente?: string;
}): Promise<{ ok: true; cambio: CambioAplicado } | { ok: false; error: string }> {
  const proposed = prepararPermuta(input);
  if (!proposed.ok) return proposed;
  try {
    const response = await fetch("/api/catalog/change", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(proposed.cambio),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return { ok: false, error: response.status === 409 ? "El cronograma cambió. Actualizá y volvé a verificar." : "El servidor no autorizó el cambio." };
    const result = (await response.json()) as { change: CambioAplicado; override: { shifts: { date: string; text: string }[] } };
    patchDoc(result.change.docId, { shifts: result.override.shifts });
    saveLog([result.change, ...loadCambios().filter((item) => item.id !== result.change.id)]);
    return { ok: true, cambio: result.change };
  } catch {
    return { ok: false, error: "No se pudo registrar el cambio en el servidor." };
  }
}

export async function syncCambios() {
  try {
    const response = await fetch("/api/catalog/state", { signal: AbortSignal.timeout(8_000) });
    if (!response.ok) return false;
    const state = (await response.json()) as { overrides?: { docs?: Record<string, { shifts?: { date: string; text: string }[] }> }; changes?: CambioAplicado[] };
    for (const [id, override] of Object.entries(state.overrides?.docs ?? {})) if (override.shifts) patchDoc(id, { shifts: override.shifts });
    saveLog(state.changes ?? []);
    return true;
  } catch { return false; }
}

export function overridesShifts(id: string) {
  return loadOverrides().docs[id]?.shifts;
}
