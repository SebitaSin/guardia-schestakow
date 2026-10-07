import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { DegradedBanner, HealthBoard, ProvenanceCard, ShadowBanner, SimBanner, StatusCard, WhatMayFail } from "@/components/sch-board";
import { useSch } from "@/lib/sch-resilience/use-sch";
import { fmtHora } from "@/lib/sch-resilience/format";
import { refreshMinutes } from "@/lib/sch-resilience/engine";
import type { Snapshot, WeatherWindow } from "@/lib/sch-resilience/types";

export const Route = createFileRoute("/continuidad/ahora")({
  component: AhoraPage,
});

function AhoraPage() {
  const { snap, busy, error, sim, refresh, can, emergency, setEmergency } = useSch();
  const [showHelp, setShowHelp] = useState(false);

  if (!snap) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted">{busy ? "Calculando estado operativo…" : "Sin snapshot todavía."}</p>
        {error ? <p className="text-sm text-danger">{error}</p> : null}
        <button type="button" className="h-11 rounded-lg bg-primary px-4 text-sm font-medium text-primary-fg" onClick={() => void refresh()}>
          Reintentar
        </button>
      </div>
    );
  }

  const now = snap.weather.windows.find((w) => w.id === "NOW");
  const action =
    snap.routes.length > 0
      ? `${snap.routes.length} ruta(s) en ${snap.routes[0].status}`
      : snap.staff.staff_needing_transport > 0
        ? "Hay pedidos de traslado sin conductor confirmado"
        : "Ninguna acción de transporte lista";

  return (
    <div className="space-y-4">
      <DegradedBanner snap={snap} />
      <SimBanner sim={sim} />
      <ShadowBanner snap={snap} />

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="h-11 rounded-lg bg-primary px-4 text-sm font-medium text-primary-fg disabled:opacity-40"
          onClick={() => void refresh()}
          disabled={busy}
        >
          {busy ? "Actualizando…" : "Actualizar ahora"}
        </button>
        <Link to="/continuidad/plan" className="flex h-11 items-center rounded-lg bg-surface px-4 text-sm font-medium shadow-[var(--shadow-border)]">
          Plan imprimible
        </Link>
        <button type="button" className="flex h-11 items-center rounded-lg bg-surface px-4 text-sm font-medium shadow-[var(--shadow-border)]" onClick={() => setShowHelp((value) => !value)} aria-expanded={showHelp}>
          ⓘ {showHelp ? "Ocultar explicación" : "¿Qué significa este panel?"}
        </button>
        {can.emergency ? (
          <button
            type="button"
            className="h-11 rounded-lg bg-danger px-4 text-sm font-medium text-primary-fg"
            onClick={() => setEmergency(!emergency, emergency ? "cierre humano" : "activación humana Dirección")}
          >
            {emergency ? "Salir de EMERGENCIA" : "Activar EMERGENCIA"}
          </button>
        ) : null}
        <p className="text-sm text-muted">
          Refresco cada {refreshMinutes(snap.system_state)} min · {fmtHora(snap.checked_at)}
        </p>
      </div>
      {error ? <p className="text-sm text-danger">{error}</p> : null}

      {showHelp ? (
        <section className="rounded-2xl border border-primary/30 bg-primary-soft/20 p-4 text-sm" aria-label="Ayuda de contingencias">
          <h2 className="font-semibold">Cómo leer Contingencias</h2>
          <dl className="mt-3 grid gap-3 md:grid-cols-2">
            <HelpItem term="Vigilancia" text="El sistema observa la situación. No declara una emergencia por sí solo." />
            <HelpItem term="Riesgo operativo" text="Puntaje general. H es clima, A accesibilidad, S situación del sistema y D disponibilidad de personal." />
            <HelpItem term="Personal UNKNOWN" text="Personas cuyo transporte o disponibilidad todavía no fue confirmado. No significa que estén ausentes." />
            <HelpItem term="Mínimo Dirección" text="Cantidad mínima de personal que Dirección definió para comparar cada servicio." />
            <HelpItem term="Rutas" text="Traslados confirmados y calculados. Si dice Ninguna, no hay un traslado operativo listo." />
            <HelpItem term="Precipitación ahora" text="Lluvia registrada en este momento. Las ventanas muestran el pronóstico de 0–2, 2–6, 6–12 y 12–24 horas." />
            <HelpItem term="Qué puede fallar" text="Advertencias generadas por reglas y fuentes. No son una orden automática." />
            <HelpItem term="Qué acción está lista" text="Acción operativa que ya tiene datos suficientes y confirmación humana." />
          </dl>
          <p className="mt-3 text-xs text-muted">La información meteorológica es una señal de apoyo y no reemplaza una alerta oficial. Solo Dirección puede activar EMERGENCIA.</p>
        </section>
      ) : null}

      <StatusCard snap={snap} />
      <WeatherAlerts snap={snap} />

      <section className="grid gap-3 rounded-2xl bg-surface p-4 shadow-[var(--shadow-border)] md:grid-cols-2">
        <Qa k="Qué está pasando" v={`${snap.system_state} · R ${snap.risk.R} ${snap.risk.band}`} />
        <Qa
          k="Cuándo"
          v={`Ahora ${now?.precip_mm == null ? "SIN DATOS de lluvia" : `${now.precip_mm} mm`} · verificado ${fmtHora(snap.checked_at)}`}
        />
        <Qa k="Qué puede fallar" v={snap.risk.overrides[0] || snap.risk.explanation[0] || "Sin override"} />
        <Qa k="Qué acción está lista" v={action} />
        <Qa
          k="Qué dato es incierto"
          v={
            snap.missing_sources.length
              ? snap.missing_sources.join(", ")
              : `${snap.staff.staff_unknown} plantel con transporte UNKNOWN`
          }
        />
      </section>

      <div className="grid gap-4 xl:grid-cols-2">
        <WhatMayFail snap={snap} />
        <ProvenanceCard snap={snap} />
      </div>
      <HealthBoard snap={snap} />
    </div>
  );
}

function weatherSignal(window: WeatherWindow) {
  const signals: string[] = [];
  let level = 0;
  if (window.hail === true) { level = Math.max(level, 3); signals.push("posible granizo"); }
  if ((window.intensity_mmh ?? 0) >= 10 || (window.precip_mm ?? 0) >= 20) { level = Math.max(level, 3); signals.push("lluvia intensa"); }
  else if ((window.intensity_mmh ?? 0) >= 4 || (window.precip_mm ?? 0) >= 8) { level = Math.max(level, 2); signals.push("lluvia relevante"); }
  if ((window.wind_kmh ?? 0) >= 70) { level = Math.max(level, 3); signals.push("viento muy fuerte"); }
  else if ((window.wind_kmh ?? 0) >= 45) { level = Math.max(level, 2); signals.push("viento fuerte"); }
  if (window.visibility_m != null && window.visibility_m < 1000) { level = Math.max(level, 3); signals.push("visibilidad crítica"); }
  else if (window.visibility_m != null && window.visibility_m < 3000) { level = Math.max(level, 2); signals.push("visibilidad reducida"); }
  if ((window.storm_prob ?? 0) >= 70) { level = Math.max(level, 2); signals.push("alta probabilidad de tormenta"); }
  return { level, signals };
}

function HelpItem({ term, text }: { term: string; text: string }) {
  return <div><dt className="font-semibold">{term}</dt><dd className="mt-0.5 text-muted">{text}</dd></div>;
}

function WeatherAlerts({ snap }: { snap: Snapshot }) {
  const sourceInvalid = snap.weather.provenance.status !== "VALID";
  const rows = snap.weather.windows.map((window) => ({ window, ...weatherSignal(window) }));
  const max = sourceInvalid ? 1 : Math.max(0, ...rows.map((row) => row.level));
  const palette = max >= 3
    ? "border-danger/40 bg-danger/10 text-danger"
    : max === 2
      ? "border-warn/50 bg-warn/10 text-warn"
      : max === 1
        ? "border-border bg-subtle text-muted"
        : "border-ok/40 bg-ok/10 text-ok";
  const title = sourceInvalid
    ? `Fuente meteorológica ${snap.weather.provenance.status}`
    : max >= 3
      ? "Señal meteorológica de riesgo alto"
      : max === 2
        ? "Señal meteorológica para vigilancia"
        : "Sin señales meteorológicas por umbral";
  return (
    <section className={`rounded-2xl border p-4 ${palette}`} role="status">
      <h2 className="font-semibold">{title}</h2>
      <p className="mt-1 text-sm">
        Pronóstico Open-Meteo verificado {fmtHora(snap.weather.provenance.retrieved_at)}. Es una señal operativa y no reemplaza una alerta oficial del SMN.
      </p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
        {rows.map(({ window, signals }) => (
          <div key={window.id} className="rounded-xl border border-current/20 bg-surface/80 p-3 text-foreground">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">{window.id}</p>
            <p className="mt-1 text-sm font-medium">{signals.length ? signals.join(" · ") : sourceInvalid ? "SIN DATOS VIGENTES" : "sin señal"}</p>
            <p className="mt-1 text-xs text-muted">
              Lluvia {window.precip_mm ?? "SIN DATOS"} mm · viento {window.wind_kmh ?? "SIN DATOS"} km/h · visibilidad {window.visibility_m ?? "SIN DATOS"} m
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

function Qa({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">{k}</p>
      <p className="mt-1 text-sm font-medium">{v}</p>
    </div>
  );
}
