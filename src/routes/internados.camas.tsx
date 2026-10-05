import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { BedCard } from "@/components/bed-card";
import { ParteFreshnessNotice } from "@/components/parte-freshness-notice";
import { Input } from "@/components/ui/input";
import {
  barTone,
  filterBeds,
  ocupacionPorServicio,
  searchBeds,
  type BedFilter,
} from "@/data/internacion";
import { useParteTick } from "@/lib/use-parte";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/internados/camas")({ component: CamasPage });

const FILTERS: { id: BedFilter; label: string }[] = [
  { id: "todos", label: "Todos" },
  { id: "ocupada", label: "Ocupadas" },
  { id: "libre", label: "Libres" },
  { id: "arm", label: "ARM" },
  { id: "aislamiento", label: "Aislamiento" },
  { id: "revisar", label: "A confirmar" },
];

function CamasPage() {
  useParteTick();
  const [q, setQ] = useState("");
  const [filtro, setFiltro] = useState<BedFilter>("todos");
  const servicios = ocupacionPorServicio();
  const query = q.trim();
  const visible = useMemo(() => {
    const base = searchBeds(query);
    return filterBeds(base, filtro);
  }, [query, filtro]);

  return (
    <div className="space-y-5">
      <ParteFreshnessNotice />
      <Input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Buscar paciente, cama o diagnóstico"
        autoComplete="off"
      />
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFiltro(f.id)}
            className={cn(
              "h-11 shrink-0 rounded-full px-4 text-sm font-medium",
              filtro === f.id ? "bg-primary text-primary-fg" : "bg-surface text-muted shadow-[var(--shadow-border)]",
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {!query ? (
        <section className="rounded-2xl bg-surface p-4 shadow-[var(--shadow-border)]">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">Por servicio</h2>
          <ul className="space-y-2">
            {servicios.map((s) => (
              <li key={s.slug}>
                <Link to="/internados/$slug" params={{ slug: s.slug }} className="block">
                  <div className="flex justify-between gap-2 text-sm">
                    <span className="font-medium">{s.name}</span>
                    <span className="tabular-nums text-muted">
                      {s.ocupadas}/{s.ocupadas + s.libres} · {s.pct}%
                    </span>
                  </div>
                  <div className="mt-1 h-2 overflow-hidden rounded-full bg-border">
                    <div
                      className={cn(
                        "h-full rounded-full",
                        barTone(s.pct) === "danger" && "bg-danger",
                        barTone(s.pct) === "warn" && "bg-warn",
                        barTone(s.pct) === "ok" && "bg-ok",
                      )}
                      style={{ width: `${Math.min(100, s.pct)}%` }}
                    />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {servicios.map((s) => {
        const beds = visible.filter((b) => b.slug === s.slug);
        if (!beds.length) return null;
        return (
          <section key={s.slug} className="space-y-2">
            <h2 className="text-lg font-semibold">{s.name}</h2>
            <ul className="space-y-2">
              {beds.map((b) => (
                <li key={b.cama}>
                  <BedCard bed={b} />
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
