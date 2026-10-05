import { Link } from "@tanstack/react-router";
import { NODES, BASE_EDGES, applyClosures } from "@/lib/sch-resilience/roads";
import type { ClosurePatch } from "@/lib/sch-resilience/roads";
import type { Health, Snapshot, SystemState, TransportRoute } from "@/lib/sch-resilience/types";
import { closureLabel, estadoLabel, fmtHora, healthLabel } from "@/lib/sch-resilience/format";
import { cn } from "@/lib/utils";
import pickups from "@/data/sch-resilience/pickups.json";

export function DegradedBanner({ snap }: { snap: Snapshot | null }) {
  if (!snap?.degraded) return null;
  const missing = snap.missing_sources.length ? snap.missing_sources.join(", ") : "fuente no viva";
  return (
    <div className="rounded-2xl bg-warn-soft px-4 py-3 text-warn" role="status">
      <p className="text-sm font-semibold uppercase tracking-wide">Datos degradados</p>
      <p className="text-sm">Falta o no está vivo: {missing}. No se muestra como dato en vivo.</p>
    </div>
  );
}

export function ShadowBanner({ snap }: { snap: Snapshot | null }) {
  if (!snap?.shadow_mode) return null;
  return (
    <div className="rounded-2xl bg-primary-soft px-4 py-3 text-primary" role="status">
      <p className="text-sm font-semibold uppercase tracking-wide">Modo sombra</p>
      <p className="text-sm">
        Las rutas son recomendaciones. No son órdenes de despacho. No contactar ni enviar personal desde esta pantalla.
      </p>
    </div>
  );
}

export function SimBanner({ sim }: { sim: string }) {
  if (sim === "off") return null;
  return (
    <div className="rounded-2xl bg-danger-soft px-4 py-3 text-danger" role="status">
      <p className="text-sm font-semibold uppercase tracking-wide">Simulación activa</p>
      <p className="text-sm">Escenario {sim} — no es meteorología ni cierre real. Desactivar en Configuración.</p>
    </div>
  );
}

function stateTone(s: SystemState) {
  if (s === "EMERGENCY") return "danger" as const;
  if (s === "PREPARE") return "warn" as const;
  if (s === "WATCH" || s === "RECOVERY") return "warn" as const;
  return "ok" as const;
}

function bandTone(b: Snapshot["risk"]["band"]) {
  if (b === "CRITICO") return "danger" as const;
  if (b === "ALTO") return "warn" as const;
  if (b === "MEDIO") return "warn" as const;
  return "ok" as const;
}

export function StatusCard({ snap }: { snap: Snapshot }) {
  const st = stateTone(snap.system_state);
  const bt = bandTone(snap.risk.band);
  const now = snap.weather.windows.find((w) => w.id === "NOW");
  return (
    <section className="rounded-2xl bg-surface p-4 shadow-[var(--shadow-border)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wide text-muted">Estado del sistema</p>
          <p
            className={cn(
              "mt-1 text-3xl font-semibold",
              st === "danger" && "text-danger",
              st === "warn" && "text-warn",
              st === "ok" && "text-ok",
            )}
          >
            {estadoLabel(snap.system_state)}
          </p>
          <p className="mt-1 text-sm text-muted">No se activa EMERGENCIA sola. Solo Dirección.</p>
        </div>
        <div className="text-right">
          <p className="text-sm font-semibold uppercase tracking-wide text-muted">Riesgo operativo</p>
          <p
            className={cn(
              "mt-1 text-3xl font-semibold tabular-nums",
              bt === "danger" && "text-danger",
              bt === "warn" && "text-warn",
              bt === "ok" && "text-ok",
            )}
          >
            {snap.risk.R}{" "}
            <span className="text-lg font-medium">{snap.risk.band}</span>
          </p>
          <p className="text-sm text-muted">
            H {snap.risk.H} · A {snap.risk.A} · S {snap.risk.S} · D {snap.risk.D}
          </p>
        </div>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-3 text-sm lg:grid-cols-4">
        <Fact k="Ventana" v={snap.staff.horizon} />
        <Fact k="Última verificación" v={fmtHora(snap.checked_at)} />
        <Fact k="Personal UNKNOWN" v={String(snap.staff.staff_unknown)} />
        <Fact k="Necesitan traslado" v={String(snap.staff.staff_needing_transport)} />
        <Fact k="Confirmados" v={String(snap.staff.staff_confirmed)} />
        <Fact k="Mínimo Dirección" v={snap.staff.staff_required == null ? "SIN DATOS" : String(snap.staff.staff_required)} />
        <Fact k="Rutas" v={snap.routes.length ? `${snap.routes.length} · ${snap.routes[0]?.status}` : "Ninguna"} />
        <Fact
          k="Precipitación ahora"
          v={now?.precip_mm == null ? "SIN DATOS" : `${now.precip_mm} mm`}
        />
      </dl>
    </section>
  );
}

function Fact({ k, v }: { k: string; v: string }) {
  return (
    <div className="rounded-xl bg-bg px-3 py-2">
      <dt className="text-xs font-semibold uppercase tracking-wide text-muted">{k}</dt>
      <dd className="mt-0.5 font-medium">{v}</dd>
    </div>
  );
}

export function WhatMayFail({ snap }: { snap: Snapshot }) {
  return (
    <section className="rounded-2xl bg-surface p-4 shadow-[var(--shadow-border)]">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Qué puede fallar</h2>
      {snap.risk.overrides.length ? (
        <ul className="mt-2 space-y-1.5 text-sm">
          {snap.risk.overrides.map((o) => (
            <li key={o} className="font-medium text-danger">
              {o}
            </li>
          ))}
        </ul>
      ) : null}
      <ul className="mt-2 space-y-1.5 text-sm text-muted">
        {snap.risk.explanation.map((e) => (
          <li key={e}>{e}</li>
        ))}
      </ul>
    </section>
  );
}

export function ProvenanceCard({ snap }: { snap: Snapshot }) {
  const p = snap.weather.provenance;
  return (
    <section className="rounded-2xl bg-surface p-4 shadow-[var(--shadow-border)]">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Procedencia</h2>
      <dl className="mt-3 grid gap-2 text-sm">
        <div className="flex justify-between gap-3">
          <dt className="text-muted">Fuente</dt>
          <dd className="font-medium">{p.source}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted">Estado</dt>
          <dd className="font-medium">{p.status}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted">Emitido</dt>
          <dd className="font-medium">{fmtHora(p.timestamp)}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted">Recuperado</dt>
          <dd className="font-medium">{fmtHora(p.retrieved_at)}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted">Vence</dt>
          <dd className="font-medium">{fmtHora(p.expires_at)}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted">Confianza</dt>
          <dd className="font-medium">{p.confidence}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted">Modelo</dt>
          <dd className="font-medium">
            {snap.model_version} · {snap.graph_version}
          </dd>
        </div>
      </dl>
      <p className="mt-3 text-xs text-muted">No hay hechos anónimos de IA. El puntaje es reglas ponderadas, no un modelo generativo.</p>
    </section>
  );
}

export function HealthBoard({ snap }: { snap: Snapshot }) {
  const rows: { k: string; v: Health }[] = [
    { k: "Meteorología", v: snap.health.weather },
    { k: "Caminos", v: snap.health.road },
    { k: "Plantel", v: snap.health.staff },
    { k: "Ruteo", v: snap.health.routing },
    { k: "Control operativo", v: snap.health.database },
    { k: "Automatización", v: snap.health.automation },
  ];
  return (
    <section className="rounded-2xl bg-surface p-4 shadow-[var(--shadow-border)]">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Salud de fuentes</h2>
      <ul className="mt-3 grid grid-cols-2 gap-2 text-sm">
        {rows.map((row) => (
          <li key={row.k} className="flex items-center justify-between rounded-xl bg-bg px-3 py-2">
            <span>{row.k}</span>
            <span
              className={cn(
                "font-semibold",
                row.v === "OK" && "text-ok",
                row.v === "STALE" && "text-warn",
                (row.v === "FAILED" || row.v === "DEGRADED") && "text-danger",
              )}
            >
              {healthLabel(row.v)}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-muted">Último éxito: {fmtHora(snap.health.last_success)}</p>
    </section>
  );
}

export function SchemaMap({
  closures,
  routes,
  timestamp,
}: {
  closures: ClosurePatch[];
  routes: TransportRoute[];
  timestamp: string;
}) {
  const edges = applyClosures(BASE_EDGES, closures);
  const nodeMap = new Map(NODES.map((n) => [n.id, n]));
  const routeSet = new Set<string>();
  for (const r of routes) {
    for (let i = 0; i < r.safe_route.length - 1; i++) {
      routeSet.add(`${r.safe_route[i]}|${r.safe_route[i + 1]}`);
      routeSet.add(`${r.safe_route[i + 1]}|${r.safe_route[i]}`);
    }
  }
  return (
    <section className="rounded-2xl bg-surface p-4 shadow-[var(--shadow-border)]">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Mapa esquemático</h2>
        <p className="text-xs text-muted">Capa dinámica {fmtHora(timestamp)} · no hay domicilios</p>
      </div>
      <svg viewBox="0 0 100 100" className="h-auto w-full rounded-xl bg-bg" role="img" aria-label="Red vial esquemática San Rafael">
        {edges.map((e) => {
          const a = nodeMap.get(e.from);
          const b = nodeMap.get(e.to);
          if (!a || !b) return null;
          const onRoute = routeSet.has(`${e.from}|${e.to}`);
          const closed = e.closure_state === "CLOSED";
          const forbidden = e.closure_state === "UNKNOWN" && e.water_risk >= 50;
          const restricted = e.closure_state === "RESTRICTED";
          return (
            <line
              key={e.id}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              className={cn(
                closed && "stroke-danger",
                !closed && forbidden && "stroke-warn",
                !closed && !forbidden && restricted && "stroke-warn",
                !closed && !forbidden && !restricted && onRoute && "stroke-primary",
                !closed && !forbidden && !restricted && !onRoute && "stroke-border-strong",
              )}
              strokeWidth={onRoute ? 1.8 : closed ? 1.6 : 1.1}
              strokeDasharray={closed || forbidden ? "2 1.5" : undefined}
            />
          );
        })}
        {NODES.map((n) => (
          <g key={n.id}>
            <circle
              cx={n.x}
              cy={n.y}
              r={n.kind === "hospital" ? 2.4 : n.kind === "pickup" ? 2 : 1.5}
              className={cn(
                n.kind === "hospital" && "fill-primary",
                n.kind === "pickup" && "fill-ok",
                n.kind === "zone" && "fill-warn",
                n.kind === "intersection" && "fill-muted",
              )}
            />
            <text x={n.x + 2.2} y={n.y + 1} className="fill-fg" fontSize="2.6">
              {n.name}
            </text>
          </g>
        ))}
      </svg>
      <ul className="mt-3 flex flex-wrap gap-3 text-xs text-muted">
        <li>Azul: hospital / ruta propuesta</li>
        <li>Verde: punto de encuentro</li>
        <li>Rojo punteado: CERRADA</li>
        <li>Ámbar punteado: UNKNOWN + agua</li>
      </ul>
      <p className="mt-2 text-xs text-muted">
        Esquema estático. No es tráfico en vivo. Puntos de encuentro: {pickups.points.map((p) => p.name).join(", ")}.
      </p>
    </section>
  );
}

export function RouteCard({
  route,
  peopleNames,
  canReview,
  onReview,
  driverOnly,
}: {
  route: TransportRoute;
  peopleNames: Map<string, string>;
  canReview: boolean;
  onReview: () => void;
  driverOnly: boolean;
}) {
  return (
    <article className="rounded-2xl bg-surface p-4 shadow-[var(--shadow-border)]">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wide text-muted">{route.status}</p>
          <h3 className="text-lg font-semibold">
            {route.driver === "SIN CONDUCTOR" || route.driver === "SIN ASIGNAR"
              ? route.driver
              : `Conductor ${peopleNames.get(route.driver) ?? route.driver}`}
          </h3>
        </div>
        <p className="tabular-nums text-sm text-muted">
          {route.occupancy}/{route.vehicle_capacity || "—"}
        </p>
      </div>
      <p className="mt-2 text-sm">{route.risk_summary}</p>
      {route.pickup_sequence.length ? (
        <ol className="mt-3 space-y-1.5 text-sm">
          {route.pickup_sequence.map((s, i) => (
            <li key={`${s.node}-${i}`}>
              {i + 1}. {nodeName(s.node)} · {s.staff_ids.map((id) => peopleNames.get(id) ?? id).join(", ")} · +{s.eta_min} min
            </li>
          ))}
        </ol>
      ) : (
        <p className="mt-3 text-sm text-muted">Sin paradas asignadas.</p>
      )}
      {route.unresolved_conditions.length ? (
        <ul className="mt-3 space-y-1 text-sm text-danger">
          {route.unresolved_conditions.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      ) : null}
      {canReview && !driverOnly ? (
        <button type="button" className="mt-4 h-11 rounded-lg bg-primary px-4 text-sm font-medium text-primary-fg" onClick={onReview}>
          {route.status === "SHADOW" ? "Marcar revisado (sigue en sombra)" : "Aprobar"}
        </button>
      ) : null}
    </article>
  );
}

function nodeName(id: string) {
  return NODES.find((n) => n.id === id)?.name ?? id;
}

export const TABS = [
  { to: "/continuidad", label: "Ahora" },
  { to: "/continuidad/turno", label: "Próximo turno" },
  { to: "/continuidad/mapa", label: "Mapa" },
  { to: "/continuidad/transporte", label: "Transporte" },
  { to: "/continuidad/historial", label: "Historial" },
  { to: "/continuidad/config", label: "Configuración" },
] as const;

export function ContinuidadTabs({ current }: { current: string }) {
  return (
    <nav className="flex flex-wrap gap-2">
      {TABS.map((t) => {
        const active = current === t.to;
        return (
          <Link
            key={t.to}
            to={t.to}
            className={cn(
              "flex h-11 items-center rounded-lg px-3 text-sm font-medium",
              active ? "bg-primary text-primary-fg" : "bg-surface text-fg shadow-[var(--shadow-border)]",
            )}
          >
            {t.label}
          </Link>
        );
      })}
      <Link to="/continuidad/plan" className="flex h-11 items-center rounded-lg px-3 text-sm font-medium text-primary">
        Plan imprimible
      </Link>
    </nav>
  );
}

export { closureLabel };
