import { createFileRoute, Link } from "@tanstack/react-router";
import { BedCard } from "@/components/bed-card";
import { ParteFreshnessNotice } from "@/components/parte-freshness-notice";
import { bedsFor, servicioBySlug } from "@/data/internacion";
import { useParteTick } from "@/lib/use-parte";

export const Route = createFileRoute("/internados/$slug")({ component: ServicioCamas });

function ServicioCamas() {
  useParteTick();
  const { slug } = Route.useParams();
  const meta = servicioBySlug(slug);
  const beds = bedsFor(slug);

  if (!meta) {
    return (
      <p className="text-muted">
        Servicio no encontrado.{" "}
        <Link to="/internados" className="text-primary">
          Volver al parte
        </Link>
      </p>
    );
  }

  return (
    <div className="space-y-5">
      <ParteFreshnessNotice />
      <header>
        <Link to="/internados" className="text-sm font-medium text-primary">
          ← Parte diario
        </Link>
        <h1 className="mt-2 text-[1.6rem] font-semibold tracking-tight">{meta.name}</h1>
        <p className="mt-1 text-muted">
          {meta.ocupadas} ocupadas · {meta.libres} libres · {meta.pct}%
        </p>
        {meta.note ? <p className="mt-2 text-sm text-warn">{meta.note}</p> : null}
      </header>

      <ul className="space-y-2">
        {beds.map((b) => (
          <li key={b.cama}>
            <BedCard bed={b} />
          </li>
        ))}
      </ul>
    </div>
  );
}
