import { createFileRoute } from "@tanstack/react-router";
import cfg from "@/data/sch-resilience/config.json";
import { useSch } from "@/lib/sch-resilience/use-sch";
import type { SimKind } from "@/lib/sch-resilience/weather";
import { DEPARTMENTS } from "@/data/departments";

export const Route = createFileRoute("/continuidad/config")({
  component: ConfigPage,
});

const SIMS: { id: SimKind; label: string }[] = [
  { id: "off", label: "Tiempo real (Open-Meteo)" },
  { id: "dry", label: "Simulación: seco" },
  { id: "rain", label: "Simulación: lluvia intensa" },
  { id: "hail", label: "Simulación: granizo" },
  { id: "api_down", label: "Simulación: API caída" },
  { id: "access_closed", label: "Simulación: acceso hospital CERRADO" },
];

function ConfigPage() {
  const { role, driverId, sim, setSim, minima, setMinima, can } = useSch();
  const canSimulate = role === "DIRECTION" || role === "ADMIN";

  return (
    <div className="space-y-4">
      <section className="rounded-2xl bg-surface p-4 shadow-[var(--shadow-border)]">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Identidad operativa</h2>
        <p className="mt-1 text-sm text-muted">
          El rol proviene de la sesión autenticada del servidor. No se puede cambiar desde el navegador.
        </p>
        <p className="mt-3 text-sm"><span className="font-medium">Rol:</span> {role}</p>
        {role === "DRIVER" ? <p className="mt-1 text-sm"><span className="font-medium">Ficha:</span> {driverId ?? "SIN ASIGNAR"}</p> : null}
      </section>

      <section className="rounded-2xl bg-surface p-4 shadow-[var(--shadow-border)]">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Escenarios (sombra)</h2>
        <p className="mt-1 text-sm text-muted">No reemplazan a Open-Meteo en producción. Quedan etiquetados SIMULACIÓN.</p>
        <div className="mt-3 grid gap-2">
          {SIMS.map((s) => (
            <button
              key={s.id}
              type="button"
              className="h-11 rounded-lg bg-bg px-3 text-left text-sm font-medium"
              disabled={!canSimulate}
              onClick={() => setSim(s.id)}
            >
              {sim === s.id ? "● " : "○ "}
              {s.label}
            </button>
          ))}
        </div>
        {!canSimulate ? <p className="mt-2 text-sm text-muted">Sólo Dirección puede cambiar escenarios.</p> : null}
      </section>

      <section className="rounded-2xl bg-surface p-4 shadow-[var(--shadow-border)]">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Modelo de riesgo</h2>
        <p className="mt-2 text-sm">
          R = {cfg.weights.H} H + {cfg.weights.A} A + {cfg.weights.S} S · umbral vigilancia {cfg.thresholds.watch} ·
          preparar {cfg.thresholds.prepare} · {cfg.model_version}
        </p>
        <p className="mt-2 text-sm text-muted">
          Pesos versionados en configuración. Dirección no los cambia desde un chat. EMERGENCIA exige humano.
        </p>
      </section>

      <section className="rounded-2xl bg-surface p-4 shadow-[var(--shadow-border)]">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Mínimos de dotación</h2>
        <p className="mt-1 text-sm text-muted">
          Vacío = SIN DATOS. El sistema no inventa importancia clínica. Solo Dirección carga un número.
        </p>
        <ul className="mt-3 space-y-2">
          {DEPARTMENTS.slice(0, 12).map((d) => (
            <li key={d.slug} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="min-w-40">{d.short}</span>
              {can.minima ? (
                <input
                  type="number"
                  min={0}
                  max={30}
                  className="h-11 w-24 rounded-md border border-border bg-surface px-2"
                  placeholder="—"
                  defaultValue={minima[d.slug] ?? ""}
                  onBlur={(e) => {
                    const raw = e.target.value.trim();
                    setMinima(d.slug, raw === "" ? null : Number(raw));
                  }}
                />
              ) : (
                <span className="text-muted">{minima[d.slug] ?? "SIN DATOS"}</span>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
