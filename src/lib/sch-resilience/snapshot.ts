import { storageGet, storageSet } from "@/lib/safe-storage";
import type { ClosurePatch } from "./roads";
import type { AuditEvent, Snapshot, Transition } from "./types";
import type { StaffMark } from "./staff-impact";
import type { SimKind } from "./weather";

const SNAP = "schestakow.sch.snapshot.v1";
const MARKS = "schestakow.sch.marks.v1";
const CLOS = "schestakow.sch.closures.v1";
const AUD = "schestakow.sch.audit.v1";
const TR = "schestakow.sch.transitions.v1";
const SIM = "schestakow.sch.sim.v1";
const EM = "schestakow.sch.human_emergency.v1";
const MIN = "schestakow.sch.minima.v1";
const EVT = "schestakow-sch";

function parse<T>(key: string, fallback: T): T {
  try {
    const raw = storageGet(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function loadSnapshot(): Snapshot | null {
  return parse<Snapshot | null>(SNAP, null);
}

export function saveSnapshot(s: Snapshot) {
  storageSet(SNAP, JSON.stringify(s));
  ping();
}

export function loadMarks(): StaffMark[] {
  return parse<StaffMark[]>(MARKS, []);
}

export function saveMarks(m: StaffMark[]) {
  storageSet(MARKS, JSON.stringify(m.slice(0, 800)));
  ping();
}

export function loadClosures(): ClosurePatch[] {
  return parse<ClosurePatch[]>(CLOS, []);
}

export function saveClosures(c: ClosurePatch[]) {
  storageSet(CLOS, JSON.stringify(c.slice(0, 200)));
  ping();
}

export function loadAudit(): AuditEvent[] {
  return parse<AuditEvent[]>(AUD, []);
}

export function appendAudit(e: AuditEvent) {
  const all = [e, ...loadAudit()].slice(0, 400);
  storageSet(AUD, JSON.stringify(all));
  ping();
}

export function loadTransitions(): Transition[] {
  return parse<Transition[]>(TR, []);
}

export function appendTransition(t: Transition) {
  storageSet(TR, JSON.stringify([t, ...loadTransitions()].slice(0, 80)));
  ping();
}

export function loadSim(): SimKind {
  const v = storageGet(SIM);
  if (v === "dry" || v === "rain" || v === "hail" || v === "api_down" || v === "access_closed") return v;
  return "off";
}

export function saveSim(s: SimKind) {
  storageSet(SIM, s);
  ping();
}

export function loadEmergency(): boolean {
  return storageGet(EM) === "1";
}

export function saveEmergency(on: boolean) {
  storageSet(EM, on ? "1" : "0");
  ping();
}

export function loadMinima(): Record<string, number | null> {
  return parse<Record<string, number | null>>(MIN, {});
}

export function saveMinima(m: Record<string, number | null>) {
  storageSet(MIN, JSON.stringify(m));
  ping();
}

function ping() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(EVT));
}

export function subscribeSch(fn: () => void) {
  if (typeof window === "undefined") return () => undefined;
  window.addEventListener(EVT, fn);
  window.addEventListener("storage", fn);
  return () => {
    window.removeEventListener(EVT, fn);
    window.removeEventListener("storage", fn);
  };
}

/** DB-safe copy: no names, no raw weather blob. */
export function redactSnapshot(s: Snapshot) {
  return {
    checked_at: s.checked_at,
    system_state: s.system_state,
    degraded: s.degraded,
    missing_sources: s.missing_sources,
    risk: s.risk,
    hash: s.hash,
    shadow_mode: s.shadow_mode,
    health: s.health,
    staff: {
      horizon: s.staff.horizon,
      staff_required: s.staff.staff_required,
      staff_confirmed: s.staff.staff_confirmed,
      staff_unknown: s.staff.staff_unknown,
      staff_at_risk: s.staff.staff_at_risk,
      staff_needing_transport: s.staff.staff_needing_transport,
      coverage_available: s.staff.coverage_available,
      support_available: s.staff.support_available,
      disaster_support_available: s.staff.disaster_support_available,
      critical_role_gaps: s.staff.critical_role_gaps,
    },
    closures: s.closures,
    routes: s.routes.map((r) => ({
      route_id: r.route_id,
      driver: r.driver,
      occupancy: r.occupancy,
      vehicle_capacity: r.vehicle_capacity,
      status: r.status,
      risk_summary: r.risk_summary,
      unresolved_conditions: r.unresolved_conditions,
      safe_route: r.safe_route,
    })),
    weather: {
      windows: s.weather.windows,
      provenance: s.weather.provenance,
      warning_level: s.weather.warning_level,
    },
  };
}

export function emergencyPlanText(s: Snapshot) {
  const lines = [
    `HOSPITAL SCHESTAKOW — PLAN DE CONTINUIDAD`,
    `Estado: ${s.system_state}  Riesgo ${s.risk.R} ${s.risk.band}  (${s.model_version})`,
    `Verificado: ${s.checked_at}`,
    s.degraded ? `DATOS DEGRADADOS: ${s.missing_sources.join(", ") || "fuente no viva"}` : "Fuentes: ver tarjeta de procedencia",
    `Modo sombra: ${s.shadow_mode ? "SÍ (no es una orden operativa)" : "NO"}`,
    "",
    "CIERRES",
    ...(s.closures.length ? s.closures.map((c) => `- ${c.edge_id}: ${c.closure_state} (${c.source} ${c.updated_at})`) : ["- Ningún cierre humano/oficial cargado"]),
    "",
    "PERSONAL PRÓXIMO TURNO",
    `- Confirmados: ${s.staff.staff_confirmed}  UNKNOWN: ${s.staff.staff_unknown}  Traslado: ${s.staff.staff_needing_transport}`,
    `- Cobertura voluntaria: ${s.staff.coverage_available}  Apoyo a otro servicio: ${s.staff.support_available}`,
    `- Apoyo declarado en catástrofe: ${s.staff.disaster_support_available}`,
    `- Mínimo Dirección: ${s.staff.staff_required ?? "SIN DATOS"}`,
    "",
    "RUTAS",
    ...(s.routes.length
      ? s.routes.map((r) => `- ${r.route_id} ${r.status} conductor=${r.driver} ${r.occupancy}/${r.vehicle_capacity} ${r.risk_summary}`)
      : ["- Sin rutas (no hay NEEDS_TRANSPORT o no hay conductor)"]),
    "",
    "PUNTOS DE ENCUENTRO",
    "- Puerta de Guardia / Acceso principal / Terminal / Plaza San Martín",
    "",
    "NO CONTACTAR NI DESPACHAR PERSONAL DESDE ESTE TEXTO.",
  ];
  return lines.join("\n");
}
