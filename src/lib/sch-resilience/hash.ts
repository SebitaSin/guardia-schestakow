export function stableHash(input: unknown): string {
  const s = typeof input === "string" ? input : JSON.stringify(input);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export function nowIso() {
  return new Date().toISOString();
}

export function isoInTz(date = new Date(), tz = "America/Argentina/Mendoza") {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function minutesFromNow(iso: string | null) {
  if (!iso) return Infinity;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return Infinity;
  return (Date.now() - t) / 60000;
}
