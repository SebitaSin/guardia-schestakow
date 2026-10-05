/** localStorage que no tumba la app. Cuota llena o modo privado: sigue con memoria. */

function store(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    const s = window.localStorage;
    s.setItem("__t", "1");
    s.removeItem("__t");
    return s;
  } catch {
    return null;
  }
}

export function storageGet(key: string): string | null {
  try {
    return store()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function storageSet(key: string, value: string): boolean {
  const s = store();
  if (!s) return false;
  try {
    s.setItem(key, value);
    return true;
  } catch {
    try {
      const keys = Object.keys(s).filter((k) => k.startsWith("schestakow.") || k.startsWith("guardias."));
      for (const k of keys) {
        if (k === key) continue;
        if (k.includes("parte.pipeline")) continue;
        s.removeItem(k);
      }
      s.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  }
}

export function storageJson<T>(key: string, fallback: T): T {
  const raw = storageGet(key);
  if (!raw) return fallback;
  try {
    return { ...(fallback as object), ...(JSON.parse(raw) as object) } as T;
  } catch {
    return fallback;
  }
}
