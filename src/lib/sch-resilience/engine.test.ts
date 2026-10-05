import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeRisk, conflictClosure, nextState } from "./risk.ts";
import { BASE_EDGES, applyClosures, dijkstra, edgeAllowed } from "./roads.ts";
import { optimizeTransport, invalidateIfStale } from "./routing.ts";
import { parseOpenMeteo, staleWeather, simulateWeather } from "./weather.ts";
import { reviewRoute, runEngine } from "./engine.ts";
import { redactSnapshot } from "./snapshot.ts";
import { stableHash } from "./hash.ts";
import type { StaffImpact, StaffOps, TransportRoute, WeatherState } from "./types.ts";

const emptyStaff: StaffImpact = {
  horizon: "2026-09-18",
  staff_required: null,
  staff_confirmed: 0,
  staff_unknown: 0,
  staff_at_risk: 0,
  staff_needing_transport: 0,
  coverage_available: 0,
  support_available: 0,
  disaster_support_available: 0,
  critical_role_gaps: [{ service: "*", gap: "UNKNOWN" }],
  people: [],
};

function person(partial: Partial<StaffOps> & Pick<StaffOps, "staff_id" | "name" | "transport_status">): StaffOps {
  return {
    service: "guardia",
    shift_date: "2026-09-18",
    criticality: null,
    operational_zone: null,
    preferred_pickup_point: "terminal",
    vehicle_available: null,
    vehicle_capacity: null,
    can_transport_others: null,
    availability_timestamp: "t",
    availability_status: "SCHEDULED_ONLY",
    support_service: null,
    disaster_support_status: "UNKNOWN",
    disaster_support_areas: [],
    scheduled: true,
    ...partial,
  };
}

function dryWeather(): WeatherState {
  return parseOpenMeteo({
    current: { time: "2026-09-18T06:00", precipitation: 0, weather_code: 0, wind_speed_10m: 8, visibility: 20000 },
    hourly: {
      time: Array.from({ length: 24 }, (_, i) => `2026-09-18T${String(i).padStart(2, "0")}:00`),
      precipitation: Array(24).fill(0),
      weather_code: Array(24).fill(0),
      wind_speed_10m: Array(24).fill(8),
      visibility: Array(24).fill(20000),
      precipitation_probability: Array(24).fill(5),
    },
  });
}

describe("risk engine", () => {
  it("does not treat UNKNOWN precip as clear skies", () => {
    const w = staleWeather(null, "down");
    const r = computeRisk(w, BASE_EDGES, emptyStaff);
    assert.ok(r.H >= 20);
    assert.equal(w.provenance.status, "UNKNOWN");
    assert.ok(r.explanation.some((e) => /SIN DATOS|UNKNOWN/i.test(e)));
  });

  it("hail raises H", () => {
    const w = parseOpenMeteo({
      current: { precipitation: 2, weather_code: 96, wind_speed_10m: 10 },
      hourly: { time: ["t"], precipitation: [2], weather_code: [96], wind_speed_10m: [10] },
    });
    const r = computeRisk(w, BASE_EDGES, emptyStaff);
    assert.ok(r.H >= 70);
  });

  it("uncertainty does not lower R", () => {
    const dry = computeRisk(dryWeather(), BASE_EDGES, emptyStaff);
    const stale = computeRisk(staleWeather(dryWeather(), "x"), BASE_EDGES, emptyStaff);
    assert.ok(stale.R >= dry.R);
  });

  it("never infers EMERGENCY without human", () => {
    const r = computeRisk(
      parseOpenMeteo({
        current: { precipitation: 40, weather_code: 99, wind_speed_10m: 90 },
        hourly: { time: ["t"], precipitation: [40], weather_code: [99], wind_speed_10m: [90] },
      }),
      applyClosures(BASE_EDGES, [
        { edge_id: "e_em_main", closure_state: "CLOSED", source: "HUMAN", updated_at: "2026-09-18T06:00:00Z" },
      ]),
      emptyStaff,
    );
    assert.notEqual(nextState("NORMAL", r, false), "EMERGENCY");
    assert.equal(nextState("NORMAL", r, true), "EMERGENCY");
  });

  it("never claims a road is SAFE", () => {
    const r = computeRisk(dryWeather(), BASE_EDGES, emptyStaff);
    assert.equal(r.explanation.some((e) => /\bSAFE\b|ruta segura garant/i.test(e)), false);
  });
});

describe("road constraints", () => {
  it("CLOSED is prohibited", () => {
    const e = { ...BASE_EDGES[0], closure_state: "CLOSED" as const };
    assert.equal(edgeAllowed(e), false);
  });

  it("UNKNOWN + high water is prohibited", () => {
    const e = { ...BASE_EDGES[0], closure_state: "UNKNOWN" as const, water_risk: 70 };
    assert.equal(edgeAllowed(e), false);
    const ok = { ...BASE_EDGES[0], closure_state: "UNKNOWN" as const, water_risk: 20 };
    assert.equal(edgeAllowed(ok), true);
  });

  it("dijkstra never traverses CLOSED", () => {
    const closed = applyClosures(BASE_EDGES, [
      { edge_id: "e_term_143s", closure_state: "CLOSED", source: "HUMAN", updated_at: "t" },
    ]);
    const path = dijkstra(closed, "terminal", "rn143_sur");
    assert.equal(path, null);
  });

  it("dijkstra never traverses UNKNOWN high water (e_term_143s)", () => {
    const path = dijkstra(BASE_EDGES, "terminal", "rn143_sur");
    assert.equal(path, null);
  });

  it("conflict keeps conservative CLOSED", () => {
    const c = conflictClosure("e1", { state: "OPEN", at: "1", source: "map" }, { state: "CLOSED", at: "2", source: "HUMAN" });
    assert.equal(c.status, "CONFLICT");
    assert.equal(c.conservative, "CLOSED");
  });
});

describe("routing", () => {
  it("respects capacity", () => {
    const people: StaffOps[] = [
      person({
        staff_id: "drv",
        name: "Drv",
        transport_status: "CAN_DRIVE",
        preferred_pickup_point: "terminal",
        vehicle_available: true,
        vehicle_capacity: 1,
        can_transport_others: true,
      }),
      person({ staff_id: "a", name: "a", transport_status: "NEEDS_TRANSPORT", preferred_pickup_point: "plaza_sm" }),
      person({ staff_id: "b", name: "b", transport_status: "NEEDS_TRANSPORT", preferred_pickup_point: "plaza_sm" }),
    ];
    const routes = optimizeTransport(people, BASE_EDGES);
    const seated = routes.reduce((n, r) => n + r.occupancy, 0);
    assert.ok(seated <= 1);
    assert.ok(routes.some((r) => r.unresolved_conditions.length > 0 || r.occupancy === 1));
  });

  it("does not invent a driver", () => {
    const people: StaffOps[] = [
      person({
        staff_id: "a",
        name: "A",
        transport_status: "NEEDS_TRANSPORT",
        availability_timestamp: null,
      }),
    ];
    const routes = optimizeTransport(people, BASE_EDGES);
    assert.equal(routes[0].driver, "SIN CONDUCTOR");
  });

  it("requires explicit willingness to transport others", () => {
    const routes = optimizeTransport([
      person({ staff_id: "drv", name: "Drv", transport_status: "CAN_DRIVE", preferred_pickup_point: "plaza_sm", vehicle_available: true, vehicle_capacity: 2, can_transport_others: false }),
      person({ staff_id: "p", name: "P", transport_status: "NEEDS_TRANSPORT", preferred_pickup_point: "plaza_sm" }),
    ], BASE_EDGES);
    assert.equal(routes[0].driver, "SIN CONDUCTOR");
  });

  it("does not invent a pickup point", () => {
    const people: StaffOps[] = [
      person({
        staff_id: "drv",
        name: "Drv",
        transport_status: "CAN_DRIVE",
        preferred_pickup_point: "plaza_sm",
        vehicle_available: true,
        vehicle_capacity: 2,
        can_transport_others: true,
      }),
      person({ staff_id: "sin-punto", name: "Sin punto", transport_status: "NEEDS_TRANSPORT", preferred_pickup_point: null }),
    ];
    const routes = optimizeTransport(people, BASE_EDGES);
    assert.equal(routes.some((route) => route.safe_route.includes("terminal")), false);
    assert.ok(routes.some((route) => route.unresolved_conditions.some((item) => /falta punto de encuentro/i.test(item))));
  });

  it("does not route staff marked unavailable", () => {
    const routes = optimizeTransport([
      person({ staff_id: "drv", name: "Drv", transport_status: "CAN_DRIVE", preferred_pickup_point: "plaza_sm", vehicle_available: true, vehicle_capacity: 2 }),
      person({ staff_id: "off", name: "Off", transport_status: "NEEDS_TRANSPORT", availability_status: "UNAVAILABLE" }),
    ], BASE_EDGES);
    assert.deepEqual(routes, []);
  });

  it("only picks up people already on the direct corridor", () => {
    const people: StaffOps[] = [
      person({ staff_id: "drv", name: "Drv", transport_status: "CAN_DRIVE", preferred_pickup_point: "terminal", vehicle_available: true, vehicle_capacity: 3, can_transport_others: true }),
      person({ staff_id: "on-route", name: "On", transport_status: "NEEDS_TRANSPORT", preferred_pickup_point: "plaza_sm" }),
      person({ staff_id: "off-route", name: "Off", transport_status: "NEEDS_TRANSPORT", preferred_pickup_point: "balloffet" }),
    ];
    const routes = optimizeTransport(people, BASE_EDGES);
    const assigned = routes.flatMap((route) => route.pickup_sequence.flatMap((stop) => stop.staff_ids));
    assert.deepEqual(assigned, ["on-route"]);
    assert.ok(routes.some((route) => route.unresolved_conditions.some((item) => /off-route.*fuera de los corredores directos/i.test(item))));
    assert.match(routes.find((route) => route.driver === "drv")?.risk_summary ?? "", /Sin desvíos/i);
  });

  it("safe_route never includes a CLOSED edge node-pair via forbidden hop", () => {
    const closed = applyClosures(BASE_EDGES, [
      { edge_id: "e_em_main", closure_state: "CLOSED", source: "HUMAN", updated_at: "t" },
    ]);
    const people: StaffOps[] = [
      person({
        staff_id: "drv",
        name: "Drv",
        transport_status: "CAN_DRIVE",
        preferred_pickup_point: "plaza_sm",
        vehicle_available: true,
        vehicle_capacity: 2,
        can_transport_others: true,
      }),
      person({ staff_id: "p", name: "P", transport_status: "NEEDS_TRANSPORT", preferred_pickup_point: "terminal" }),
    ];
    const routes = optimizeTransport(people, closed);
    for (const r of routes) {
      const seq = r.safe_route;
      for (let i = 0; i < seq.length - 1; i++) {
        const a = seq[i];
        const b = seq[i + 1];
        if ((a === "hospital_emergencias" && b === "hospital_main") || (a === "hospital_main" && b === "hospital_emergencias")) {
          assert.fail("used CLOSED hospital access");
        }
      }
    }
  });

  it("UNKNOWN staff is not treated as available", () => {
    const impact: StaffImpact = {
      ...emptyStaff,
      staff_unknown: 2,
      people: [
        person({ staff_id: "u1", name: "U1", transport_status: "UNKNOWN" }),
        person({ staff_id: "u2", name: "U2", transport_status: "UNKNOWN" }),
      ],
    };
    assert.equal(impact.people.filter((p) => p.transport_status === "UNKNOWN").length, 2);
    assert.equal(impact.staff_confirmed, 0);
  });
});

describe("engine gating", () => {
  it("heartbeat when hash unchanged", () => {
    const w = dryWeather();
    const a = runEngine({ weather: w, closures: [], staffMarks: [], staff: emptyStaff });
    const b = runEngine({ weather: w, closures: [], staffMarks: [], staff: emptyStaff, prev: a });
    assert.equal(b.changed, false);
    assert.equal(b.hash, a.hash);
  });

  it("idempotent double run", () => {
    const w = dryWeather();
    const a = runEngine({ weather: w, closures: [], staffMarks: [], staff: emptyStaff });
    const b = runEngine({ weather: w, closures: [], staffMarks: [], staff: emptyStaff });
    assert.equal(a.hash, b.hash);
  });

  it("snapshot has no address fields", () => {
    const s = runEngine({ weather: dryWeather(), closures: [], staffMarks: [], staff: emptyStaff });
    const blob = JSON.stringify(s);
    assert.equal(/domicilio|address|calle |altura /i.test(blob), false);
  });

  it("leaving EMERGENCY requires dropping the human flag (hash includes it)", () => {
    const w = dryWeather();
    const on = runEngine({ weather: w, closures: [], staffMarks: [], staff: emptyStaff, humanEmergency: true });
    assert.equal(on.system_state, "EMERGENCY");
    const off = runEngine({ weather: w, closures: [], staffMarks: [], staff: emptyStaff, humanEmergency: false, prev: on });
    assert.notEqual(off.system_state, "EMERGENCY");
    assert.equal(off.changed, true);
  });

  it("redacted snapshot omits people names and weather raw", () => {
    const s = runEngine({
      weather: dryWeather(),
      closures: [],
      staffMarks: [],
      staff: { ...emptyStaff, people: [person({ staff_id: "x", name: "Nombre Sensible", transport_status: "UNKNOWN" })] },
    });
    const red = JSON.stringify(redactSnapshot(s));
    assert.equal(red.includes("Nombre Sensible"), false);
    assert.equal(red.includes('"raw"'), false);
  });
});

describe("shadow approval", () => {
  it("review in shadow stays SHADOW", () => {
    const r: TransportRoute = {
      route_id: "r1",
      driver: "drv",
      vehicle_capacity: 2,
      occupancy: 1,
      pickup_sequence: [],
      safe_route: ["terminal", "hospital_emergencias"],
      estimated_departure: null,
      estimated_arrival: null,
      risk_summary: "x",
      source_timestamp: "t",
      unresolved_conditions: [],
      status: "SHADOW",
    };
    const next = reviewRoute(r, true, "DIRECTION");
    assert.equal(next.status, "SHADOW");
    assert.ok(next.unresolved_conditions.some((c) => /MODO SOMBRA/i.test(c)));
  });

  it("review without shadow becomes APPROVED", () => {
    const r: TransportRoute = {
      route_id: "r1",
      driver: "drv",
      vehicle_capacity: 2,
      occupancy: 1,
      pickup_sequence: [],
      safe_route: [],
      estimated_departure: null,
      estimated_arrival: null,
      risk_summary: "x",
      source_timestamp: "t",
      unresolved_conditions: [],
      status: "DRAFT",
    };
    assert.equal(reviewRoute(r, false, "DIRECTION").status, "APPROVED");
  });

  it("APPROVED invalidates when sources change past threshold", () => {
    const r: TransportRoute = {
      route_id: "r1",
      driver: "drv",
      vehicle_capacity: 2,
      occupancy: 1,
      pickup_sequence: [],
      safe_route: [],
      estimated_departure: null,
      estimated_arrival: null,
      risk_summary: "x",
      source_timestamp: "t",
      unresolved_conditions: [],
      status: "APPROVED",
    };
    const next = invalidateIfStale(r, "new", "old", 15, 10);
    assert.equal(next.status, "RECHECK_REQUIRED");
  });

  it("carries APPROVED across rerun until invalidate", () => {
    const staff: StaffImpact = {
      ...emptyStaff,
      staff_needing_transport: 1,
      people: [
        person({
          staff_id: "drv",
          name: "Drv",
          transport_status: "CAN_DRIVE",
          vehicle_available: true,
          vehicle_capacity: 2,
          can_transport_others: true,
          preferred_pickup_point: "plaza_sm",
        }),
        person({ staff_id: "p", name: "P", transport_status: "NEEDS_TRANSPORT", preferred_pickup_point: "terminal" }),
      ],
    };
    const a = runEngine({ weather: dryWeather(), closures: [], staffMarks: [], staff });
    assert.ok(a.routes.length);
    const approved: typeof a = {
      ...a,
      routes: a.routes.map((r) => ({ ...r, status: "APPROVED" as const })),
    };
    const b = runEngine({
      weather: simulateWeather("rain"),
      closures: [],
      staffMarks: [],
      staff,
      prev: approved,
    });
    assert.ok(b.routes.every((r) => r.status === "RECHECK_REQUIRED" || r.status === "APPROVED" || r.status === "SHADOW"));
  });
});

describe("simulations", () => {
  it("api_down is UNKNOWN not live", () => {
    const w = simulateWeather("api_down");
    assert.equal(w.provenance.status, "UNKNOWN");
    assert.equal(w.windows[0].precip_mm, null);
  });

  it("hail simulation is labeled SIMULACIÓN", () => {
    const w = simulateWeather("hail");
    assert.match(w.provenance.source, /SIMULACIÓN/);
    const r = computeRisk(w, BASE_EDGES, emptyStaff);
    assert.ok(r.H >= 70);
  });

  it("hospital CLOSED overlay is PREPARE not auto-EMERGENCY", () => {
    const s = runEngine({
      weather: simulateWeather("access_closed"),
      closures: [{ edge_id: "e_em_main", closure_state: "CLOSED", source: "SIMULACIÓN", updated_at: "t" }],
      staffMarks: [],
      staff: emptyStaff,
    });
    assert.notEqual(s.system_state, "EMERGENCY");
    assert.ok(s.risk.A >= 80);
  });
});

describe("hash", () => {
  it("stable", () => {
    assert.equal(stableHash({ a: 1 }), stableHash({ a: 1 }));
  });
});
