import { createFileRoute } from "@tanstack/react-router";
import { RouteCard } from "@/components/sch-board";
import { useSch } from "@/lib/sch-resilience/use-sch";

export const Route = createFileRoute("/continuidad/transporte")({
  component: TransportePage,
});

function TransportePage() {
  const { snap, reviewPlan, can, role, driverId } = useSch();
  if (!snap) return <p className="text-sm text-muted">Sin snapshot.</p>;

  const names = new Map(snap.staff.people.map((p) => [p.staff_id, p.name]));
  let routes = snap.routes;
  if (role === "DRIVER") {
    if (!driverId) {
      return (
        <p className="text-sm text-warn">
          Rol conductor: identificá tu ficha en Configuración. Solo vas a ver tu ruta, sin el resto del plantel.
        </p>
      );
    }
    routes = routes.filter((r) => r.driver === driverId);
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        Recorridos deterministas: sólo asignan puntos que ya están sobre el corredor directo declarado por el conductor,
        sin desvíos, sin exceder capacidad y sin usar tramos prohibidos. No se guardan domicilios.
        {snap.shadow_mode ? " Modo sombra: una revisión de Dirección no despacha a nadie." : ""}
      </p>
      {routes.length ? (
        routes.map((r) => (
          <RouteCard
            key={r.route_id}
            route={r}
            peopleNames={names}
            canReview={can.approve}
            onReview={() => reviewPlan(r.route_id)}
            driverOnly={role === "DRIVER"}
          />
        ))
      ) : (
        <p className="rounded-2xl bg-surface p-4 text-sm text-muted shadow-[var(--shadow-border)]">
          No hay rutas. Hace falta personal marcado como “Necesita traslado” y, para asignar vehículo, un conductor con
          capacidad, voluntad de trasladar y corredor confirmados.
        </p>
      )}
    </div>
  );
}
