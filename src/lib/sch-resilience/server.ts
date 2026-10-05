/**
 * Persistencia local de SCH-RESILIENCE.
 *
 * Antes esto eran server functions que escribían a Postgres. La app ahora es
 * estática: no hay servidor ni base. El snapshot ya era local de primera clase
 * (ver snapshot.ts) y la copia en base era redactada — así que acá se conserva
 * la misma traza, en localStorage, con la misma firma de llamada.
 *
 * Se mantienen los recortes de longitud del validador original: son el límite
 * que impide que un payload suelto llene el almacenamiento del navegador.
 */
import { fetchWeather, staleWeather } from "./weather";
import { stableHash } from "./hash";
import { storageGet, storageSet } from "@/lib/safe-storage";

const K_STATE = "sch.state";
const K_AUDIT = "sch.audit";
const K_CLOSURES = "sch.closures";
const K_WEATHER = "sch.weather";
const AUDIT_MAX = 500;

type Ok = { ok: true };
type Err = { ok: false; error: string };

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = storageGet(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): Ok | Err {
  try {
    storageSet(key, JSON.stringify(value));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "storage" };
  }
}

export async function pullWeather() {
  try {
    const w = await fetchWeather();
    const payload = JSON.stringify({ windows: w.windows, warning: w.warning_level });
    writeJson(K_WEATHER, {
      source: w.provenance.source.slice(0, 40),
      status: w.provenance.status.slice(0, 16),
      payload: payload.slice(0, 20_000),
      hash: stableHash(payload),
      issued_at: w.provenance.timestamp,
    });
    return { ok: true as const, weather: w };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "fetch failed";
    return { ok: false as const, weather: staleWeather(null, msg), error: msg };
  }
}

export async function persistSchSnapshot(input: {
  data: { state?: string; hash?: string; snapshot?: string };
}): Promise<Ok | Err> {
  const d = input?.data ?? {};
  return writeJson(K_STATE, {
    state: String(d.state ?? "NORMAL").slice(0, 24),
    hash: String(d.hash ?? "").slice(0, 64),
    snapshot: String(d.snapshot ?? "{}").slice(0, 80_000),
    updated_at: new Date().toISOString(),
  });
}

export async function persistSchAudit(input: {
  data: {
    actor?: string;
    action?: string;
    kind?: string;
    payload?: string;
    model?: string;
    result?: string;
  };
}): Promise<Ok | Err> {
  const d = input?.data ?? {};
  const row = {
    actor: String(d.actor ?? "system").slice(0, 40),
    action: String(d.action ?? "").slice(0, 80),
    kind: String(d.kind ?? "system").slice(0, 32),
    payload: String(d.payload ?? "{}").slice(0, 4000),
    model: d.model ? String(d.model).slice(0, 40) : null,
    result: d.result ? String(d.result).slice(0, 80) : null,
    at: new Date().toISOString(),
  };
  const log = readJson<(typeof row)[]>(K_AUDIT, []);
  log.push(row);
  // Traza acotada: se conservan los últimos AUDIT_MAX eventos.
  return writeJson(K_AUDIT, log.slice(-AUDIT_MAX));
}

export async function persistSchClosure(input: {
  data: { edge_id?: string; closure_state?: string; source?: string; actor?: string };
}): Promise<Ok | Err> {
  const d = input?.data ?? {};
  const edge_id = String(d.edge_id ?? "").slice(0, 40);
  if (!edge_id) return { ok: false, error: "edge" };
  const all = readJson<Record<string, unknown>>(K_CLOSURES, {});
  all[edge_id] = {
    edge_id,
    closure_state: String(d.closure_state ?? "UNKNOWN").slice(0, 16),
    source: String(d.source ?? "HUMAN").slice(0, 40),
    source_type: "HUMAN_CONFIRMED",
    actor: String(d.actor ?? "unknown").slice(0, 40),
    updated_at: new Date().toISOString(),
  };
  return writeJson(K_CLOSURES, all);
}

/** Cortes de calle confirmados por humanos, para el mapa y el ruteo. */
export function readSchClosures(): Record<string, unknown> {
  return readJson<Record<string, unknown>>(K_CLOSURES, {});
}

/** Traza de decisiones, para la pantalla de historial. */
export function readSchAudit(): unknown[] {
  return readJson<unknown[]>(K_AUDIT, []);
}

export type WeatherPull = Awaited<ReturnType<typeof pullWeather>>;
