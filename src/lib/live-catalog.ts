import { storageGet, storageSet } from "@/lib/safe-storage";
import type { GuardiaDoc } from "@/data/catalog";

/** Cronogramas que el servidor lee solo del correo. Se actualizan sin recompilar la app. */
const KEY = "schestakow.live.v1";
const EVENT = "schestakow-catalog";
const MAX_CACHE_CHARS = 1_500_000;

export type UnreadFile = { id: string; filename: string; mailDate: string; departments: string[] };
/** Guardia corregida a mano en la pantalla principal. Clave: "AAAA-MM-DD|servicio". */
export type ManualDuty = { text: string; by: string; at: string };
/** Reclamo de planillas faltantes, calculado por el servidor (scripts/reclamos.py). */
export type ClaimInfo = { to: string[]; status: "pendiente" | "recibida" | "excluido" | "cancelado"; sent: number; lastSent: string | null };
export type ClaimsState = { enabled: boolean; month: string | null; services: Record<string, ClaimInfo> };
type LiveState = { generatedAt: string | null; mailAt: string | null; documents: GuardiaDoc[]; unread: UnreadFile[]; reclamos?: ClaimsState | null; manual?: Record<string, ManualDuty> };

function validDoc(value: unknown): value is GuardiaDoc {
  const doc = value as Partial<GuardiaDoc> | null;
  return Boolean(doc && typeof doc.id === "string" && Array.isArray(doc.departments) && Array.isArray(doc.shifts) && typeof doc.year === "number");
}

function fromCache(): LiveState {
  try {
    const parsed = JSON.parse(storageGet(KEY) ?? "null") as Partial<LiveState> | null;
    if (parsed && Array.isArray(parsed.documents)) return { generatedAt: parsed.generatedAt ?? null, mailAt: parsed.mailAt ?? null, documents: parsed.documents.filter(validDoc), unread: Array.isArray(parsed.unread) ? parsed.unread : [] };
  } catch { /* caché ilegible: se vuelve a pedir */ }
  return { generatedAt: null, mailAt: null, documents: [], unread: [] };
}

let state: LiveState = fromCache();

export function liveDocuments(): GuardiaDoc[] {
  return state.documents;
}

/** Adjuntos del correo que todavía no se pudieron leer. */
export function liveUnread(): UnreadFile[] {
  return state.unread;
}

export function liveManual(): Record<string, ManualDuty> {
  return state.manual ?? {};
}

/** Guarda en el servidor quién está de guardia ese día en ese servicio. Texto vacío: vuelve a valer la planilla. */
export async function saveManualDuty(slug: string, date: string, text: string): Promise<boolean> {
  try {
    const response = await fetch("/api/guardias/manual", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ slug, date, text }), signal: AbortSignal.timeout(10_000) });
    if (!response.ok) return false;
    return refreshLive();
  } catch {
    return false;
  }
}

export function liveClaims(): ClaimsState | null {
  return state.reclamos ?? null;
}

export function liveUpdatedAt(): string | null {
  return state.mailAt ?? state.generatedAt;
}

type LiveResponse = { generatedAt: string | null; documents: unknown[]; unread?: UnreadFile[]; mail?: { at: string | null }; running?: boolean; reclamos?: ClaimsState; manual?: Record<string, ManualDuty> };

async function fetchLive(): Promise<LiveResponse> {
  const response = await fetch("/api/catalog/live", { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`catalog_live_${response.status}`);
  return response.json() as Promise<LiveResponse>;
}

/** Trae lo último que leyó el servidor. Si falla, queda lo que ya había. */
export async function refreshLive(): Promise<boolean> {
  try {
    const data = await fetchLive();
    const documents = (Array.isArray(data.documents) ? data.documents : []).filter(validDoc);
    const unread = (Array.isArray(data.unread) ? data.unread : []).filter((item) => item && typeof item.id === "string" && typeof item.filename === "string");
    const next: LiveState = { generatedAt: data.generatedAt ?? null, mailAt: data.mail?.at ?? null, documents, unread, reclamos: data.reclamos && typeof data.reclamos.services === "object" ? data.reclamos : null, manual: data.manual && typeof data.manual === "object" ? data.manual : {} };
    const changed = next.generatedAt !== state.generatedAt || next.mailAt !== state.mailAt || documents.length !== state.documents.length || unread.length !== state.unread.length || JSON.stringify(next.reclamos ?? null) !== JSON.stringify(state.reclamos ?? null) || JSON.stringify(next.manual ?? {}) !== JSON.stringify(state.manual ?? {});
    state = next;
    if (changed) {
      const raw = JSON.stringify(next);
      if (raw.length <= MAX_CACHE_CHARS) storageSet(KEY, raw);
      window.dispatchEvent(new Event(EVENT));
    }
    return true;
  } catch {
    return false;
  }
}

/** Cancela o reanuda el reclamo automático de un servicio para el mes en curso. */
export async function pauseClaim(slug: string, paused: boolean): Promise<boolean> {
  try {
    const response = await fetch("/api/reclamos/pause", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ slug, paused }), signal: AbortSignal.timeout(10_000) });
    if (!response.ok) return false;
    return refreshLive();
  } catch {
    return false;
  }
}

/** Botón Actualizar: pide revisar el correo, espera a que termine y trae el resultado. */
export async function updateFromMail(): Promise<boolean> {
  try {
    const response = await fetch("/api/catalog/refresh", { method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(10_000) });
    if (!response.ok) return refreshLive();
    const deadline = Date.now() + 240_000;
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    while (Date.now() < deadline) {
      const data = await fetchLive();
      if (!data.running) break;
      await new Promise((resolve) => setTimeout(resolve, 3_000));
    }
    return refreshLive();
  } catch {
    return refreshLive();
  }
}

/** Mantiene la app al día sola: al abrir, cada 5 minutos y al volver a la pestaña. */
export function startLive(): () => void {
  void refreshLive();
  const timer = window.setInterval(() => void refreshLive(), 5 * 60_000);
  const onVisible = () => { if (document.visibilityState === "visible") void refreshLive(); };
  document.addEventListener("visibilitychange", onVisible);
  return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
}
