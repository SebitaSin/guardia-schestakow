import { createFileRoute } from "@tanstack/react-router";
import { PersonalMapPage } from "@/components/personal-map";
import { useSch } from "@/lib/sch-resilience/use-sch";
import { BASE_EDGES } from "@/lib/sch-resilience/roads";
import { closureLabel, fmtHora } from "@/lib/sch-resilience/format";
import type { ClosureState } from "@/lib/sch-resilience/types";

export const Route = createFileRoute("/continuidad/mapa")({ component: MapaPage });
const STATES: ClosureState[] = ["UNKNOWN", "OPEN", "RESTRICTED", "CLOSED"];
function MapaPage() {
  const { snap, closures, markClosure, can, sim } = useSch();
  const shown = sim === "access_closed" && snap ? snap.closures : closures;
  return <div className="space-y-4">
    <PersonalMapPage />
    <section className="rounded-2xl bg-surface p-4 shadow-[var(--shadow-border)]">
      <h2 className="font-semibold">Registro de tramos y cortes</h2>
      <p className="mt-1 text-sm text-muted">Se conserva el registro existente. Los índices de agua de la base estática no son una capa geográfica validada y no modifican la ruta de Google. Un tramo cerrado no debe utilizarse.</p>
      <ul className="mt-3 space-y-2">{BASE_EDGES.map((edge) => {
        const patch = shown.find((item) => item.edge_id === edge.id);
        const state = patch?.closure_state ?? edge.closure_state;
        return <li key={edge.id} className="flex flex-wrap items-center gap-2 rounded-xl bg-bg px-3 py-2 text-sm">
          <span className="font-medium">{edge.id}</span><span className="text-muted">{edge.from} → {edge.to}</span><span>{closureLabel(state)}</span>
          <span className="text-xs text-muted">{patch ? `${patch.source} ${fmtHora(patch.updated_at)}` : "Base estática: no verificada"}</span>
          {can.access && <select aria-label={`Estado de ${edge.id}`} className="ml-auto h-11 rounded-md border border-border bg-surface px-2" value={state} onChange={(event) => markClosure(edge.id, event.target.value as ClosureState)}>{STATES.map((item) => <option key={item} value={item}>{closureLabel(item)}</option>)}</select>}
        </li>;
      })}</ul>
    </section>
  </div>;
}
