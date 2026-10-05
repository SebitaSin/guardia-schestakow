import cfg from "@/data/sch-resilience/config.json";
import type { GraphEdge, StaffOps, TransportRoute } from "./types";
import { dijkstra } from "./roads";
import { nowIso, stableHash } from "./hash";

function pickupNode(p: StaffOps) {
  return p.preferred_pickup_point || null;
}

/** Deterministic direct-corridor routing. No forbidden edge, excess capacity or detour. */
export function optimizeTransport(
  staff: StaffOps[],
  edges: GraphEdge[],
  hospitalNode = "hospital_emergencias",
): TransportRoute[] {
  const allNeed = staff.filter((s) => s.transport_status === "NEEDS_TRANSPORT" && s.availability_status !== "UNAVAILABLE");
  const need = allNeed.filter((s) => pickupNode(s));
  const drivers = staff.filter(
    (s) => s.transport_status === "CAN_DRIVE" && s.availability_status !== "UNAVAILABLE" && s.vehicle_available === true && s.can_transport_others === true && (s.vehicle_capacity ?? 0) > 0 && pickupNode(s),
  );
  const unresolved: string[] = allNeed.filter((s) => !pickupNode(s)).map((s) => `${s.staff_id}: falta punto de encuentro confirmado`);
  if (!allNeed.length) return [];
  if (!need.length) {
    return [{
      route_id: `unresolved-${stableHash(unresolved.join(","))}`,
      driver: "SIN ASIGNAR",
      vehicle_capacity: 0,
      occupancy: 0,
      pickup_sequence: [],
      safe_route: [],
      estimated_departure: null,
      estimated_arrival: null,
      risk_summary: "No se puede calcular un recorrido sin puntos de encuentro confirmados.",
      source_timestamp: nowIso(),
      unresolved_conditions: unresolved,
      status: cfg.shadow_mode ? "SHADOW" : "DRAFT",
    }];
  }
  if (!drivers.length) {
    return [
      {
        route_id: `unresolved-${stableHash(need.map((n) => n.staff_id).join(","))}`,
        driver: "SIN CONDUCTOR",
        vehicle_capacity: 0,
        occupancy: 0,
        pickup_sequence: [],
        safe_route: [],
        estimated_departure: null,
        estimated_arrival: null,
        risk_summary: "No hay conductor con vehículo y capacidad confirmados.",
        source_timestamp: nowIso(),
        unresolved_conditions: [...unresolved, ...need.map((n) => n.staff_id)],
        status: cfg.shadow_mode ? "SHADOW" : "DRAFT",
      },
    ];
  }

  const remaining = [...need].sort((a, b) => a.staff_id.localeCompare(b.staff_id));
  const routes: TransportRoute[] = [];
  const driversSorted = [...drivers].sort((a, b) => a.staff_id.localeCompare(b.staff_id));

  for (const d of driversSorted) {
    if (!remaining.length) break;
    const cap = d.vehicle_capacity ?? 1;
    const start = pickupNode(d);
    if (!start) continue;
    const direct = dijkstra(edges, start, hospitalNode);
    if (!direct) {
      unresolved.push(`${d.staff_id}: sin corredor directo permitido al hospital`);
      continue;
    }
    const pathOrder = new Map(direct.path.map((node, index) => [node, index]));
    const seated = remaining
      .filter((person) => pathOrder.has(pickupNode(person) ?? ""))
      .sort((a, b) => {
        const order = (pathOrder.get(pickupNode(a) ?? "") ?? Infinity) - (pathOrder.get(pickupNode(b) ?? "") ?? Infinity);
        return order || a.staff_id.localeCompare(b.staff_id);
      })
      .slice(0, cap);
    if (!seated.length) continue;
    const assigned = new Set(seated.map((person) => person.staff_id));
    for (let index = remaining.length - 1; index >= 0; index -= 1) {
      if (assigned.has(remaining[index].staff_id)) remaining.splice(index, 1);
    }
    const seq: TransportRoute["pickup_sequence"] = [];
    for (const node of direct.path) {
      const atNode = seated.filter((person) => pickupNode(person) === node);
      if (!atNode.length) continue;
      const eta = dijkstra(edges, start, node)?.min ?? 0;
      seq.push({ node, staff_ids: atNode.map((person) => person.staff_id), eta_min: eta });
    }
    routes.push({
      route_id: `r-${stableHash(d.staff_id + seated.map((s) => s.staff_id).join())}`,
      driver: d.staff_id,
      vehicle_capacity: cap,
      occupancy: seated.length,
      pickup_sequence: seq,
      safe_route: direct.path,
      estimated_departure: null,
      estimated_arrival: null,
      risk_summary: `Capacidad ${seated.length}/${cap}. Arribo est. ${direct.min} min. Sin desvíos: paradas sobre el corredor directo declarado.`,
      source_timestamp: nowIso(),
      unresolved_conditions: [],
      status: cfg.shadow_mode ? "SHADOW" : "DRAFT",
    });
  }
  for (const r of remaining) unresolved.push(`${r.staff_id}: punto fuera de los corredores directos confirmados`);
  if (unresolved.length && routes[0]) {
    routes[0] = { ...routes[0], unresolved_conditions: [...routes[0].unresolved_conditions, ...unresolved] };
  } else if (unresolved.length) {
    routes.push({
      route_id: `open-${stableHash(unresolved.join())}`,
      driver: "SIN ASIGNAR",
      vehicle_capacity: 0,
      occupancy: 0,
      pickup_sequence: [],
      safe_route: [],
      estimated_departure: null,
      estimated_arrival: null,
      risk_summary: "Personal sin ruta segura o sin capacidad.",
      source_timestamp: nowIso(),
      unresolved_conditions: unresolved,
      status: cfg.shadow_mode ? "SHADOW" : "DRAFT",
    });
  }
  return routes;
}

export function invalidateIfStale(
  route: TransportRoute,
  currentHash: string,
  prevHash: string,
  riskDelta: number,
  threshold: number,
): TransportRoute {
  if (route.status !== "APPROVED") return route;
  if (currentHash !== prevHash && riskDelta >= threshold) {
    return { ...route, status: "RECHECK_REQUIRED", unresolved_conditions: [...route.unresolved_conditions, "Fuente cambió tras aprobación"] };
  }
  return route;
}
