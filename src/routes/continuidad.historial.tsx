import { createFileRoute } from "@tanstack/react-router";
import { useAudit, useTransitions } from "@/lib/sch-resilience/use-sch";
import { fmtHora } from "@/lib/sch-resilience/format";
import { estadoLabel } from "@/lib/sch-resilience/format";

export const Route = createFileRoute("/continuidad/historial")({
  component: HistorialPage,
});

function HistorialPage() {
  const trans = useTransitions();
  const audit = useAudit();
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <section className="rounded-2xl bg-surface p-4 shadow-[var(--shadow-border)]">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Transiciones de estado</h2>
        {trans.length ? (
          <ol className="mt-3 space-y-3 text-sm">
            {trans.map((t, i) => (
              <li key={`${t.timestamp}-${i}`}>
                <p className="font-medium">
                  {estadoLabel(t.previous_state)} → {estadoLabel(t.new_state)}
                </p>
                <p className="text-muted">
                  {fmtHora(t.timestamp)} · {t.initiator}
                  {t.authorization ? ` · auth ${t.authorization}` : ""}
                </p>
                <p>{t.reason}</p>
                <p className="text-xs text-muted">{t.evidence}</p>
              </li>
            ))}
          </ol>
        ) : (
          <p className="mt-3 text-sm text-muted">Sin transiciones registradas.</p>
        )}
      </section>
      <section className="rounded-2xl bg-surface p-4 shadow-[var(--shadow-border)]">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Auditoría</h2>
        <p className="mt-1 text-xs text-muted">Recomendación de sistema ≠ decisión humana.</p>
        {audit.length ? (
          <ol className="mt-3 space-y-3 text-sm">
            {audit.slice(0, 80).map((a, i) => (
              <li key={`${a.ts}-${i}`}>
                <p className="font-medium">
                  {a.kind === "human_decision" ? "HUMANO" : a.kind === "ai_recommendation" ? "RECOMENDACIÓN" : "SISTEMA"}{" "}
                  · {a.action}
                </p>
                <p className="text-muted">
                  {fmtHora(a.ts)} · {a.actor}
                  {a.result ? ` · ${a.result}` : ""}
                </p>
              </li>
            ))}
          </ol>
        ) : (
          <p className="mt-3 text-sm text-muted">Sin eventos.</p>
        )}
      </section>
    </div>
  );
}
