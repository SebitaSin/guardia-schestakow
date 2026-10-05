import { storageGet, storageSet } from "@/lib/safe-storage";

const KEY = "schestakow.overrides.v1";
const EVENT = "schestakow-catalog";

export type DocOverride = {
  hidden?: boolean;
  departments?: string[];
  kind?: "cronograma" | "parte" | "pasiva" | "modificacion";
  month?: number | null;
  year?: number;
  title?: string;
  shifts?: { date: string; text: string }[];
};

export type OverridesFile = {
  docs: Record<string, DocOverride>;
  syncHours?: string[];
};

function empty(): OverridesFile {
  return { docs: {} };
}

export function loadOverrides(): OverridesFile {
  if (typeof window === "undefined") return empty();
  try {
    const raw = storageGet(KEY);
    if (!raw) return empty();
    const parsed = JSON.parse(raw) as Partial<OverridesFile>;
    return { docs: parsed.docs ?? {}, syncHours: parsed.syncHours };
  } catch {
    return empty();
  }
}

export function saveOverrides(next: OverridesFile) {
  storageSet(KEY, JSON.stringify(next));
  window.dispatchEvent(new Event(EVENT));
}

export function patchDoc(id: string, patch: DocOverride) {
  const cur = loadOverrides();
  cur.docs[id] = { ...cur.docs[id], ...patch };
  saveOverrides(cur);
}

export function isHidden(id: string): boolean {
  return Boolean(loadOverrides().docs[id]?.hidden);
}

export function setSyncHours(hours: string[]) {
  const cur = loadOverrides();
  cur.syncHours = hours;
  saveOverrides(cur);
}

export function subscribeCatalog(fn: () => void) {
  window.addEventListener(EVENT, fn);
  return () => window.removeEventListener(EVENT, fn);
}
