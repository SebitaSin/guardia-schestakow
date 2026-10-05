import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { persistSchAudit, persistSchSnapshot, pullWeather } from "./server";
import { refreshMinutes, reviewRoute, runEngine } from "./engine";
import {
  appendAudit,
  appendTransition,
  emergencyPlanText,
  loadSim,
  loadSnapshot,
  loadTransitions,
  redactSnapshot,
  saveSim,
  saveSnapshot,
  subscribeSch,
  loadAudit,
} from "./snapshot";
import { canActivateEmergency, canApprove, canEditMinima, canMarkAccess, canMarkStaff } from "./rbac";
import { simulateWeather, type SimKind } from "./weather";
import type { ClosurePatch } from "./roads";
import type { StaffMark } from "./staff-impact";
import type { AuditEvent, ClosureState, Role, Snapshot } from "./types";
import { nowIso } from "./hash";
import {
  loadOperationalControl,
  reviewOperationalRoute,
  setOperationalClosure,
  setOperationalEmergency,
  setOperationalMinimum,
  setOperationalStaff,
  type OperationalControl,
} from "@/lib/operational-api";

export type SchApi = {
  snap: Snapshot | null;
  busy: boolean;
  error: string | null;
  role: Role;
  driverId: string | null;
  sim: SimKind;
  emergency: boolean;
  dbOk: boolean;
  marks: StaffMark[];
  closures: ClosurePatch[];
  refresh: () => Promise<void>;
  setSim: (s: SimKind) => void;
  setEmergency: (on: boolean, reason: string) => void;
  markStaff: (id: string, patch: Partial<StaffMark>) => void;
  markClosure: (edge_id: string, closure_state: ClosureState) => void;
  reviewPlan: (routeId: string) => void;
  setMinima: (svc: string, n: number | null) => void;
  minima: Record<string, number | null>;
  planText: string;
  can: {
    approve: boolean;
    access: boolean;
    staff: boolean;
    emergency: boolean;
    minima: boolean;
  };
};

const Ctx = createContext<SchApi | null>(null);

function mergeSimClosures(base: ClosurePatch[], sim: SimKind): ClosurePatch[] {
  if (sim !== "access_closed") return base;
  const extra: ClosurePatch = {
    edge_id: "e_em_main",
    closure_state: "CLOSED",
    source: "SIMULACIÓN",
    updated_at: nowIso(),
  };
  return [extra, ...base.filter((c) => c.edge_id !== "e_em_main")];
}

async function computeTick(control: OperationalControl, connected: boolean): Promise<{ snap: Snapshot; dbOk: boolean }> {
  const prev = loadSnapshot();
  const sim = loadSim();
  const emergency = control.emergency;
  const closures = mergeSimClosures(control.closures, sim);
  const marks = control.staffMarks;
  const minima = control.minima;
  let weather = prev?.weather ?? null;
  let weatherError: string | null = null;
  let dbOk = connected;

  if (sim === "off") {
    try {
      const r = await pullWeather();
      if (r.ok) weather = r.weather;
      else {
        weatherError = r.error ?? "fetch failed";
        weather = r.weather;
      }
    } catch (e) {
      try {
        const { weatherUrl, parseOpenMeteo } = await import("./weather");
        const res = await fetch(weatherUrl(), { signal: AbortSignal.timeout(8000) });
        if (!res.ok) throw new Error(`http ${res.status}`);
        weather = parseOpenMeteo((await res.json()) as Record<string, unknown>);
      } catch (e2) {
        weatherError = e2 instanceof Error ? e2.message : e instanceof Error ? e.message : "red";
      }
    }
  } else {
    weather = simulateWeather(sim);
    if (sim === "api_down") weatherError = "SIMULACIÓN: API meteorológica caída";
  }

  const next = runEngine({
    weather,
    weatherError,
    closures,
    staffMarks: marks,
    minima: Object.keys(minima).length ? minima : undefined,
    prev,
    humanEmergency: emergency,
    initiator: control.role,
    dbOk,
  });

  if (prev && next.changed && prev.system_state !== next.system_state) {
    appendTransition({
      timestamp: next.checked_at,
      previous_state: prev.system_state,
      new_state: next.system_state,
      reason: next.risk.overrides[0] || next.risk.explanation[0] || "recálculo",
      evidence: `R=${next.risk.R} H=${next.risk.H} A=${next.risk.A} S=${next.risk.S} D=${next.risk.D}`,
      confidence: next.weather.provenance.confidence,
      initiator: control.role,
      authorization: next.system_state === "EMERGENCY" ? control.role : null,
    });
  }
  if (next.changed) {
    appendAudit({
      ts: next.checked_at,
      actor: control.role,
      action: "engine_run",
      kind: "system",
      payload: { hash: next.hash, state: next.system_state, R: next.risk.R, sim },
      model_version: next.model_version,
    });
  }
  saveSnapshot(next);

  try {
    const persisted = await persistSchSnapshot({
      data: {
        state: next.system_state,
        hash: next.hash,
        snapshot: JSON.stringify(redactSnapshot(next)),
      },
    });
    dbOk = connected && persisted.ok;
    if (next.changed) {
      void persistSchAudit({
        data: {
          actor: control.role,
          action: "engine_run",
          kind: "system",
          payload: JSON.stringify({ hash: next.hash, state: next.system_state, R: next.risk.R }),
          model: next.model_version,
        },
      });
    }
  } catch {
    dbOk = false;
  }

  const snap: Snapshot = dbOk
    ? next
    : {
        ...next,
        health: { ...next.health, database: "FAILED" },
        degraded: true,
        missing_sources: [...new Set([...next.missing_sources, "base de datos"])],
      };
  if (snap !== next) saveSnapshot(snap);
  return { snap, dbOk };
}

export function SchProvider({ children }: { children: ReactNode }) {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [role, setRoleState] = useState<Role>("VIEWER");
  const [driverId, setDriverIdState] = useState<string | null>(null);
  const [sim, setSimState] = useState<SimKind>("off");
  const [emergency, setEmergencyState] = useState(false);
  const [dbOk, setDbOk] = useState(true);
  const [marks, setMarks] = useState<StaffMark[]>([]);
  const [closures, setClosures] = useState<ClosurePatch[]>([]);
  const [minima, setMinimaState] = useState<Record<string, number | null>>({});

  const refresh = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const operational = await loadOperationalControl();
      const control = operational.control;
      setRoleState(control.role);
      setDriverIdState(control.staffId);
      setEmergencyState(control.emergency);
      setMarks(control.staffMarks);
      setClosures(control.closures);
      setMinimaState(control.minima);
      const r = await computeTick(control, operational.connected);
      setSnap(r.snap);
      setDbOk(r.dbOk);
      if (!operational.connected) setError("Control operativo no conectado: modo consulta y datos UNKNOWN.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "error");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    setSimState(loadSim());
    const prev = loadSnapshot();
    if (prev) setSnap(prev);
    void refresh();
    return subscribeSch(() => {
      setSnap(loadSnapshot());
      setSimState(loadSim());
    });
    // first mount only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const mins = refreshMinutes(snap?.system_state ?? "NORMAL");
    const id = window.setInterval(() => void refresh(), Math.max(2, mins) * 60_000);
    return () => window.clearInterval(id);
  }, [snap?.system_state, refresh]);

  const api = useMemo<SchApi>(() => {
    const r = role;
    return {
      snap,
      busy,
      error,
      role,
      driverId,
      sim,
      emergency,
      dbOk,
      marks,
      closures,
      refresh,
      setSim: (s) => {
        saveSim(s);
        setSimState(s);
        appendAudit({ ts: nowIso(), actor: r, action: "set_sim", kind: "human_decision", payload: { sim: s } });
        void refresh();
      },
      setEmergency: (on, reason) => {
        if (!canActivateEmergency(r)) return;
        void setOperationalEmergency(on, reason).then(() => refresh()).catch((e) => setError(e instanceof Error ? e.message : "No se pudo registrar EMERGENCIA"));
      },
      markStaff: (id, patch) => {
        if (!canMarkStaff(r) && r !== "DRIVER") return;
        if (r === "DRIVER" && (!driverId || id !== driverId)) return;
        if (r === "STAFF" && driverId && id !== driverId) return;
        void setOperationalStaff(id, patch).then(() => refresh()).catch((e) => setError(e instanceof Error ? e.message : "No se pudo actualizar el traslado"));
      },
      markClosure: (edge_id, closure_state) => {
        if (!canMarkAccess(r)) return;
        void setOperationalClosure(edge_id, closure_state).then(() => refresh()).catch((e) => setError(e instanceof Error ? e.message : "No se pudo actualizar el acceso"));
      },
      reviewPlan: (routeId) => {
        if (!canApprove(r) || !snap) return;
        void reviewOperationalRoute(routeId).then(() => {
          const routes = snap.routes.map((rt) => (rt.route_id === routeId ? reviewRoute(rt, snap.shadow_mode, r) : rt));
          const next = { ...snap, routes };
          saveSnapshot(next);
          setSnap(next);
        }).catch((e) => setError(e instanceof Error ? e.message : "No se pudo registrar la revisión"));
      },
      setMinima: (svc, n) => {
        if (!canEditMinima(r)) return;
        void setOperationalMinimum(svc, n).then(() => refresh()).catch((e) => setError(e instanceof Error ? e.message : "No se pudo guardar la dotación"));
      },
      minima,
      planText: snap ? emergencyPlanText(snap) : "Sin snapshot.",
      can: {
        approve: canApprove(r),
        access: canMarkAccess(r),
        staff: canMarkStaff(r) || r === "DRIVER",
        emergency: canActivateEmergency(r),
        minima: canEditMinima(r),
      },
    };
  }, [snap, busy, error, role, driverId, sim, emergency, dbOk, marks, closures, minima, refresh]);

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useSch(): SchApi {
  const v = useContext(Ctx);
  if (!v) throw new Error("useSch fuera de SchProvider");
  return v;
}

export function useAudit() {
  const [rows, setRows] = useState<AuditEvent[]>([]);
  useEffect(() => {
    const read = () => {
      const local = loadAudit();
      setRows(local);
      void fetch("/api/audit", { signal: AbortSignal.timeout(8_000) }).then(async (response) => {
        if (!response.ok) return;
        const data = (await response.json()) as { events?: Record<string, unknown>[] };
        const server = (data.events ?? []).map((event): AuditEvent => ({
          ts: String(event.at ?? ""), actor: String(event.actor ?? "system"), action: String(event.action ?? ""),
          kind: event.kind === "human_decision" || event.kind === "ai_recommendation" ? event.kind : "system",
          payload: event, result: event.status ? String(event.status) : undefined,
        }));
        setRows([...server, ...local].sort((a, b) => b.ts.localeCompare(a.ts)).slice(0, 500));
      }).catch(() => undefined);
    };
    read();
    return subscribeSch(read);
  }, []);
  return rows;
}

export function useTransitions() {
  const [rows, setRows] = useState(loadTransitions());
  useEffect(() => {
    const read = () => setRows(loadTransitions());
    read();
    return subscribeSch(read);
  }, []);
  return rows;
}
