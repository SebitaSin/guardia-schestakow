import { storageGet, storageSet } from "@/lib/safe-storage";
import {
  MONTHS_ES,
  catalog,
  hasMonthCronograma,
  todayISO,
} from "@/data/catalog";
import { DEPARTMENTS, type Department } from "@/data/departments";

const STORAGE_KEY = "guardias.reclamos.v1";
const LEAD_DAYS = 10;
const IN_MONTH_MS = 4 * 60 * 60 * 1000;
const PRE_MONTH_MS = 24 * 60 * 60 * 1000;

export type ReclamoState = {
  email: string;
  paused: boolean;
};

export type ReclamosStore = {
  enabled: boolean;
  lastSent: Record<string, string>;
  services: Record<string, ReclamoState>;
};

const emptyStore = (): ReclamosStore => ({
  enabled: true,
  lastSent: {},
  services: {},
});

export function loadReclamos(): ReclamosStore {
  if (typeof window === "undefined") return emptyStore();
  try {
    const raw = storageGet(STORAGE_KEY);
    if (!raw) return emptyStore();
    const parsed = JSON.parse(raw) as Partial<ReclamosStore>;
    return {
      enabled: parsed.enabled !== false,
      lastSent: parsed.lastSent ?? {},
      services: parsed.services ?? {},
    };
  } catch {
    return emptyStore();
  }
}

export function saveReclamos(store: ReclamosStore) {
  storageSet(STORAGE_KEY, JSON.stringify(store));
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}

export function monthKey(year: number, month: number) {
  return `${year}-${pad(month)}`;
}

function addMonths(year: number, month: number, delta: number) {
  const d = new Date(Date.UTC(year, month - 1 + delta, 1));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
}

function daysUntil(fromISO: string, toISO: string) {
  const a = new Date(`${fromISO}T12:00:00Z`).getTime();
  const b = new Date(`${toISO}T12:00:00Z`).getTime();
  return Math.round((b - a) / 86400000);
}

export type TargetMonth = {
  year: number;
  month: number;
  phase: "lead" | "in-month";
  daysUntilStart: number;
};

export function targetMonths(now = new Date()): TargetMonth[] {
  const iso = todayISO(now);
  const [year, month] = iso.split("-").map(Number);
  const currentStart = `${year}-${pad(month)}-01`;
  const next = addMonths(year, month, 1);
  const nextStart = `${next.year}-${pad(next.month)}-01`;
  const out: TargetMonth[] = [
    {
      year,
      month,
      phase: "in-month",
      daysUntilStart: daysUntil(iso, currentStart),
    },
  ];
  const untilNext = daysUntil(iso, nextStart);
  if (untilNext >= 0 && untilNext <= LEAD_DAYS) {
    out.push({
      year: next.year,
      month: next.month,
      phase: untilNext === 0 ? "in-month" : "lead",
      daysUntilStart: untilNext,
    });
  }
  return out;
}

export type PendingReclamo = {
  dept: Department;
  targets: TargetMonth[];
  email: string;
  paused: boolean;
  due: boolean;
  lastSentAt: string | null;
};

export function pendingReclamos(store: ReclamosStore, now = new Date()): PendingReclamo[] {
  const targets = targetMonths(now);
  const nowMs = now.getTime();
  return DEPARTMENTS.flatMap((dept) => {
    const needed = targets.filter((t) => !hasMonthCronograma(dept.slug, t.month, t.year));
    if (!needed.length) return [];
    const svc = store.services[dept.slug] ?? { email: "", paused: false };
    const stampKey = `${dept.slug}:${needed.map((t) => monthKey(t.year, t.month)).join(",")}`;
    const lastSentAt = store.lastSent[stampKey] ?? null;
    const lastMs = lastSentAt ? Date.parse(lastSentAt) : 0;
    const interval = needed.some((t) => t.phase === "in-month") ? IN_MONTH_MS : PRE_MONTH_MS;
    const due =
      store.enabled &&
      !svc.paused &&
      Boolean(svc.email.trim()) &&
      (!lastMs || nowMs - lastMs >= interval);
    return [
      {
        dept,
        targets: needed,
        email: svc.email,
        paused: svc.paused,
        due,
        lastSentAt,
      },
    ];
  });
}

export function reclamoCopy(item: PendingReclamo) {
  const meses = item.targets
    .map((t) => `${MONTHS_ES[t.month - 1]} ${t.year}`)
    .join(" y ");
  const subject = `Pedido de cronograma de guardias — ${item.dept.name} — ${meses}`;
  const body = [
    `Estimados:`,
    ``,
    `Desde el tablero de Guardias del Hospital Schestakow les pedimos el cronograma de ${item.dept.name} correspondiente a ${meses}.`,
    ``,
    `Todavía no llegó al correo institucional de guardias. Por favor envíenlo respondiendo este mensaje.`,
    ``,
    `Gracias.`,
    `Hospital ${catalog.hospital}`,
  ].join("\n");
  return { subject, body };
}

export function markSent(store: ReclamosStore, item: PendingReclamo, at = new Date()): ReclamosStore {
  const stampKey = `${item.dept.slug}:${item.targets.map((t) => monthKey(t.year, t.month)).join(",")}`;
  return {
    ...store,
    lastSent: { ...store.lastSent, [stampKey]: at.toISOString() },
  };
}

export function patchService(
  store: ReclamosStore,
  slug: string,
  patch: Partial<ReclamoState>,
): ReclamosStore {
  const prev = store.services[slug] ?? { email: "", paused: false };
  return {
    ...store,
    services: { ...store.services, [slug]: { ...prev, ...patch } },
  };
}

export function mailtoHref(item: PendingReclamo) {
  const { subject, body } = reclamoCopy(item);
  const to = encodeURIComponent(item.email.trim());
  return `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
