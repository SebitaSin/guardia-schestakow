import cfg from "@/data/sch-resilience/config.json";
import geo from "@/data/sch-resilience/geo.json";
import { BASE_EDGES, applyClosures, type ClosurePatch } from "./roads";
import { computeRisk, nextState } from "./risk";
import { buildStaffImpact, type StaffMark } from "./staff-impact";
import { optimizeTransport, invalidateIfStale } from "./routing";
import { staleWeather } from "./weather";
import { isoInTz, nowIso, stableHash } from "./hash";
import type { HealthBoard, Snapshot, StaffImpact, SystemState, TransportRoute, WeatherState } from "./types";

const ENGINE_SCHEMA = 2;

export type EngineInput = {
  weather: WeatherState | null;
  weatherError?: string | null;
  closures: ClosurePatch[];
  staffMarks: StaffMark[];
  staff?: StaffImpact;
  minima?: Record<string, number | null>;
  prev?: Snapshot | null;
  humanEmergency?: boolean;
  initiator?: string;
  dbOk?: boolean;
};

export function runEngine(input: EngineInput): Snapshot {
  const checked = nowIso();
  const weather = input.weather ?? staleWeather(input.prev?.weather ?? null, input.weatherError ?? "sin dato");
  const edges = applyClosures(BASE_EDGES, input.closures);
  const dateIso = isoInTz(new Date(), cfg.timezone);
  const staff =
    input.staff ??
    buildStaffImpact({ dateIso, marks: input.staffMarks, minima: input.minima });
  const risk = computeRisk(weather, edges, staff);

  const weatherHash = stableHash({
    schema: ENGINE_SCHEMA,
    w: weather.windows,
    st: weather.provenance.status,
    c: input.closures,
    sm: input.staffMarks,
    em: Boolean(input.humanEmergency),
    mn: input.minima ?? null,
  });
  const prevHash = input.prev?.hash;
  if (prevHash === weatherHash && input.prev) {
    return { ...input.prev, checked_at: checked, changed: false };
  }

  const prevState: SystemState = input.prev?.system_state ?? "NORMAL";
  let system_state = nextState(prevState, risk, Boolean(input.humanEmergency));
  if (system_state === "EMERGENCY" && !input.humanEmergency) {
    system_state = risk.R >= cfg.thresholds.prepare ? "PREPARE" : prevState === "EMERGENCY" ? "RECOVERY" : "WATCH";
  }

  const missing: string[] = [];
  if (weather.provenance.status !== "VALID") missing.push("meteorología");
  if (staff.staff_required == null) missing.push("mínimos de dotación");
  const degraded = weather.provenance.status !== "VALID" || missing.includes("meteorología");

  let routes: TransportRoute[] = [];
  const needLevelD = risk.R >= cfg.thresholds.watch || staff.staff_needing_transport > 0;
  if (needLevelD && staff.staff_needing_transport > 0) {
    routes = optimizeTransport(staff.people, edges);
  }
  routes = routes.map((r) => {
    const prevR = input.prev?.routes.find((p) => p.route_id === r.route_id);
    const merged = prevR
      ? {
          ...r,
          status: prevR.status,
          unresolved_conditions: uniqueStrings([...prevR.unresolved_conditions, ...r.unresolved_conditions]),
        }
      : r;
    return invalidateIfStale(
      merged,
      weatherHash,
      input.prev?.hash ?? "",
      Math.abs(risk.R - (input.prev?.risk.R ?? 0)),
      cfg.approval_invalidate_risk_delta,
    );
  });

  const health: HealthBoard = {
    weather: weather.provenance.status === "VALID" ? "OK" : weather.provenance.status === "STALE" ? "STALE" : "FAILED",
    road: input.closures.length ? "OK" : "STALE",
    staff: staff.staff_unknown === staff.people.length && staff.people.length > 0 ? "STALE" : "OK",
    routing: "OK",
    database: input.dbOk === false ? "FAILED" : "OK",
    automation: "OK",
    last_success: checked,
  };

  return {
    checked_at: checked,
    changed: true,
    system_state,
    degraded,
    missing_sources: missing,
    risk,
    weather,
    staff,
    routes,
    closures: input.closures,
    health,
    hash: weatherHash,
    shadow_mode: cfg.shadow_mode,
    model_version: cfg.model_version,
    geo_model_version: geo.geo_model_version,
    graph_version: cfg.graph_version,
  };
}

function uniqueStrings(xs: string[]) {
  return [...new Set(xs)];
}

export function refreshMinutes(state: SystemState) {
  return cfg.refresh_minutes[state] ?? 30;
}

/** Dirección may review a plan. Shadow mode never becomes an operational order. */
export function reviewRoute(route: TransportRoute, shadow: boolean, actor: string): TransportRoute {
  if (shadow) {
    const note = `Revisado por ${actor} — MODO SOMBRA, no es orden de despacho`;
    return {
      ...route,
      status: "SHADOW",
      unresolved_conditions: uniqueStrings([...route.unresolved_conditions, note]),
    };
  }
  return { ...route, status: "APPROVED" };
}
