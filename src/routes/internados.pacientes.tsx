import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { ParteFreshnessNotice } from "@/components/parte-freshness-notice";
import { searchBeds } from "@/data/internacion";
import { ageLabel } from "@/components/bed-card";
import { confirmarCama, loadLab } from "@/lib/identidad";
import { useParteTick } from "@/lib/use-parte";

export const Route = createFileRoute("/internados/pacientes")({ component: PacientesPage });

function PacientesPage() {
  useParteTick();
  const [q, setQ] = useState("");
  const rows = useMemo(() => {
    const list = searchBeds(q);
    return list.filter((b) => b.estado === "OCUPADA").sort((a, b) => a.servicio.localeCompare(b.servicio, "es"));
  }, [q]);
  const pendientes = rows.filter((b) => b.identidad !== "CONFIRMADA").length;

  return (
    <div className="space-y-4">
      <ParteFreshnessNotice />
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar paciente" autoComplete="off" />
      <p className="text-sm text-muted">
        {rows.length} internados · {pendientes} a confirmar · lab {loadLab().length}
      </p>

      <section className="space-y-2 rounded-2xl bg-surface p-4 shadow-[var(--shadow-border)]">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Lista del laboratorio</h2>
        <p className="text-sm text-muted">
          La fuente del laboratorio puede sugerir coincidencias, pero nunca confirma automáticamente una identidad. Una persona autorizada debe verificar cada cama.
        </p>
      </section>

      <div className="overflow-x-auto rounded-2xl bg-surface shadow-[var(--shadow-border)]">
        <table className="w-full min-w-[48rem] text-left text-sm">
          <thead className="border-b border-border text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="px-3 py-3 font-medium">Paciente</th>
              <th className="px-3 py-3 font-medium">Edad</th>
              <th className="px-3 py-3 font-medium">Servicio</th>
              <th className="px-3 py-3 font-medium">Cama</th>
              <th className="px-3 py-3 font-medium">Diagnóstico</th>
              <th className="px-3 py-3 font-medium">Identidad</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((b) => (
              <tr key={`${b.slug}-${b.cama}`} className="border-b border-border last:border-0">
                <td className="px-3 py-3 font-medium">
                  <Link to="/internados/$slug" params={{ slug: b.slug }} className="text-primary">
                    {b.paciente ?? "Nombre ilegible en pizarrón"}
                  </Link>
                </td>
                <td className="px-3 py-3 text-muted">{ageLabel(b.edad) ?? "—"}</td>
                <td className="px-3 py-3">{b.servicio}</td>
                <td className="px-3 py-3 tabular-nums">{b.cama}</td>
                <td className="px-3 py-3">{b.diagnostico ?? "—"}</td>
                <td className="px-3 py-3">
                  {b.identidad === "CONFIRMADA" ? (
                    <span className="text-ok">CONFIRMADO</span>
                  ) : (
                    <button
                      type="button"
                      className="min-h-11 rounded-lg bg-primary px-3 text-xs font-medium text-primary-fg"
                      onClick={() => { if (window.confirm(`Confirmar identidad de ${b.paciente ?? "paciente"} en cama ${b.cama}?`)) void confirmarCama(b.slug, b.cama, b.paciente ?? undefined); }}
                    >
                      A CONFIRMAR · Confirmar
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
