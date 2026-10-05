import cfg from "@/data/sch-resilience/config.json";
import type { ClosureState, RiskBreakdown, StaffImpact, WeatherState } from "./types";
import type { GraphEdge } from "./types";

function clamp(n: number) {
  return Math.max(0, Math.min(100, Math.round(n)));
}

function precipHazard(w: WeatherState): { H: number; why: string[] } {
  const why: string[] = [];
  const now = w.windows.find((x) => x.id === "NOW");
  const near = w.windows.find((x) => x.id === "0-2h");
  const mid = w.windows.find((x) => x.id === "2-6h");
  const mm = Math.max(now?.precip_mm ?? 0, near?.precip_mm ?? 0);
  const intense = Math.max(now?.intensity_mmh ?? 0, near?.intensity_mmh ?? 0);
  const hail = now?.hail || near?.hail || mid?.hail;
  const wind = Math.max(now?.wind_kmh ?? 0, near?.wind_kmh ?? 0);
  let H = 0;
  if (mm >= 20 || intense >= 10) {
    H = 75;
    why.push(`Lluvia intensa ${intense} mm/h, acum ${mm} mm (NOW/0-2h)`);
  } else if (mm >= 8 || intense >= 4) {
    H = 50;
    why.push(`Lluvia moderada ${mm} mm`);
  } else if (mm >= 2 || intense >= 1) {
    H = 28;
    why.push(`Lluvia ligera ${mm} mm`);
  } else if (now?.precip_mm == null) {
    H = 20;
    why.push("Precipitación SIN DATOS — no se asume cielo despejado");
  } else {
    H = 8;
    why.push("Precipitación baja o nula en ventana corta");
  }
  if (hail) {
    H = Math.max(H, 70);
    why.push("Granizo (código WMO 96/99)");
  }
  if (wind >= 70) {
    H = Math.max(H, 65);
    why.push(`Viento ${wind} km/h`);
  } else if (wind >= 45) {
    H = Math.max(H, H + 10);
    why.push(`Viento ${wind} km/h`);
  }
  if (w.warning_level != null && w.warning_level >= 3) {
    H = Math.max(H, 70);
    why.push("Aviso meteorológico oficial nivel ≥3");
  }
  if (w.provenance.status === "UNKNOWN") {
    H = Math.max(H, 25);
    why.push("Fuente meteorológica UNKNOWN");
  }
  return { H: clamp(H), why };
}

function accessHazard(edges: GraphEdge[]): { A: number; why: string[]; overrides: string[] } {
  const why: string[] = [];
  const overrides: string[] = [];
  const closed = edges.filter((e) => e.closure_state === "CLOSED");
  const unknownHigh = edges.filter((e) => e.closure_state === "UNKNOWN" && e.water_risk >= 50);
  const restricted = edges.filter((e) => e.closure_state === "RESTRICTED");
  let A = 10;
  if (closed.some((e) => e.from.startsWith("hospital") || e.to.startsWith("hospital"))) {
    A = 100;
    overrides.push("Acceso hospitalario CERRADO (humano/oficial)");
  } else if (closed.length) {
    A = Math.max(A, 80);
    overrides.push(`Tramo CERRADO: ${closed.map((e) => e.id).join(", ")}`);
  }
  if (unknownHigh.length) {
    A = Math.max(A, 55);
    why.push(`${unknownHigh.length} tramos UNKNOWN con riesgo hídrico alto — no se recomiendan`);
  }
  if (restricted.length) {
    A = Math.max(A, 40);
    why.push(`${restricted.length} tramos RESTRINGIDOS`);
  }
  return { A: clamp(A), why, overrides };
}

function staffHazard(s: StaffImpact): { S: number; why: string[]; overrides: string[] } {
  const why: string[] = [];
  const overrides: string[] = [];
  const n = s.people.length || 1;
  const unk = s.staff_unknown / n;
  const need = s.staff_needing_transport;
  const atRisk = s.staff_at_risk;
  let S = 15;
  if (s.staff_required == null) {
    why.push("Dotación mínima no configurada por Dirección (UNKNOWN)");
    S = Math.max(S, Math.round(25 + unk * 40));
  } else if (s.staff_confirmed < s.staff_required) {
    const gap = s.staff_required - s.staff_confirmed;
    S = Math.max(S, 55 + Math.min(40, gap * 10));
    why.push(`Déficit configurado: ${s.staff_confirmed}/${s.staff_required}`);
    if (gap >= 2) overrides.push("Déficit de personal confirmado respecto del mínimo de Dirección");
  }
  if (need > 0) {
    S = Math.max(S, 40 + Math.min(40, need * 8));
    why.push(`${need} necesitan traslado`);
  }
  if (atRisk > 0) {
    S = Math.max(S, 35 + Math.min(30, atRisk * 5));
    why.push(`${atRisk} en zona de acceso riesgoso`);
  }
  if (unk > 0.6) {
    S = Math.max(S, 45);
    why.push("Más del 60% del turno con transporte UNKNOWN — no se asume que llegan solos");
  }
  return { S: clamp(S), why, overrides };
}

function uncertainty(w: WeatherState, edges: GraphEdge[], s: StaffImpact): number {
  let d = 0;
  if (w.provenance.status === "UNKNOWN") d += 40;
  else if (w.provenance.status === "STALE") d += 30;
  else if (w.provenance.status === "CONFLICT") d += 35;
  const unkEdges = edges.filter((e) => e.closure_state === "UNKNOWN").length;
  d += Math.min(30, unkEdges * 4);
  const n = s.people.length || 1;
  d += Math.min(30, Math.round((s.staff_unknown / n) * 30));
  return clamp(d);
}

function band(R: number): RiskBreakdown["band"] {
  if (R >= 75) return "CRITICO";
  if (R >= 50) return "ALTO";
  if (R >= 25) return "MEDIO";
  return "BAJO";
}

export function computeRisk(w: WeatherState, edges: GraphEdge[], staff: StaffImpact): RiskBreakdown {
  const h = precipHazard(w);
  const a = accessHazard(edges);
  const s = staffHazard(staff);
  const D = uncertainty(w, edges, staff);
  const { H: wH, A: wA, S: wS } = cfg.weights;
  let R = wH * h.H + wA * a.A + wS * s.S;
  if (D >= 40) {
    R = Math.max(R, R * (1 + cfg.uncertainty_floor * (D / 100)));
  }
  R = clamp(R);
  const overrides = [...a.overrides, ...s.overrides];
  return {
    H: h.H,
    A: a.A,
    S: s.S,
    D,
    R,
    band: band(R),
    model_version: cfg.model_version,
    explanation: [...h.why, ...a.why, ...s.why, `Incertidumbre D=${D}`],
    overrides,
  };
}

export function nextState(
  prev: RiskBreakdown["band"] | string,
  risk: RiskBreakdown,
  humanEmergency: boolean,
): "NORMAL" | "WATCH" | "PREPARE" | "EMERGENCY" | "RECOVERY" {
  if (humanEmergency) return "EMERGENCY";
  if (risk.overrides.some((o) => /hospitalario CERRADO/i.test(o))) return "PREPARE";
  if (risk.R >= cfg.thresholds.prepare) return "PREPARE";
  if (risk.R >= cfg.thresholds.watch) return "WATCH";
  if (prev === "EMERGENCY" || prev === "PREPARE") return "RECOVERY";
  return "NORMAL";
}

export function conflictClosure(
  edgeId: string,
  a: { state: ClosureState; at: string; source: string },
  b: { state: ClosureState; at: string; source: string },
): { status: "CONFLICT"; conservative: ClosureState } {
  const rank: Record<ClosureState, number> = { CLOSED: 3, RESTRICTED: 2, UNKNOWN: 1, OPEN: 0 };
  const conservative = rank[a.state] >= rank[b.state] ? a.state : b.state;
  return { status: "CONFLICT", conservative };
}
