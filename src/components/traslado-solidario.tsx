import { useMemo, useState } from "react";
import { Car, ChevronDown, HelpCircle, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PrivateStaffLocation } from "@/lib/private-locations";
import type { UnifiedPerson } from "@/lib/staff-unify";
import { DESVIO_MAX_KM, proponerCadenas, zonasSinLugar, type PersonaTraslado } from "@/lib/traslado-solidario";

const km1 = (value: number) => `${(Math.round(value * 10) / 10).toLocaleString("es-AR")} km`;

/**
 * Traslado solidario en catástrofe: quién se ofreció a llevar compañeros, quién necesita que lo pasen a buscar,
 * y la propuesta de cadenas. Es una propuesta: no avisa a nadie.
 */
export function TrasladoSolidario({ people, pointOf, hospital }: { people: UnifiedPerson[]; pointOf: (person: UnifiedPerson) => PrivateStaffLocation | null; hospital: { lat: number; lng: number } }) {
  const [open, setOpen] = useState(false);
  const data = useMemo(() => {
    const located = people.map((item) => ({ item, point: pointOf(item) })).filter((entry): entry is { item: UnifiedPerson; point: PrivateStaffLocation } => Boolean(entry.point));
    const declared = located.filter((entry) => entry.point.solidario);
    const personas: PersonaTraslado[] = declared.map(({ item, point }) => ({
      id: point.staffId, nombre: item.name, areas: item.areas, rol: item.person.role ?? "", punto: { lat: point.lat, lng: point.lng },
      dispuesto: Boolean(point.solidario?.dispuesto), lugares: point.solidario?.lugares ?? 0, necesitaTraslado: Boolean(point.solidario?.necesitaTraslado),
    }));
    const propuesta = proponerCadenas(personas, hospital);
    return {
      conDomicilio: located.length, declarados: declared.length,
      voluntarios: personas.filter((p) => p.dispuesto).length, lugares: personas.reduce((sum, p) => sum + (p.dispuesto ? p.lugares : 0), 0),
      necesitan: personas.filter((p) => p.necesitaTraslado).length, propuesta, zonas: zonasSinLugar(propuesta.sinLugar, hospital),
    };
  }, [people, pointOf, hospital]);
  const llevados = data.propuesta.cadenas.reduce((sum, chain) => sum + chain.pasajeros.length, 0);
  const sinDato = data.conDomicilio - data.declarados;

  return (
    <section className="rounded-2xl bg-surface shadow-[var(--shadow-border)]">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full items-center gap-3 p-3 text-left">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary"><Car className="size-5" /></span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">Traslado solidario en catástrofe</span>
          <span className="block text-xs text-muted">{data.voluntarios} con auto dispuestos a llevar ({data.lugares} lugares) · {data.necesitan} necesitan traslado · {sinDato} con domicilio y sin dato</span>
        </span>
        <ChevronDown className={cn("size-4 shrink-0 text-muted transition", open && "rotate-180")} />
      </button>
      {open ? (
        <div className="space-y-3 border-t border-border p-3">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              { icon: Car, value: data.voluntarios, label: "Dispuestos a llevar", tone: "text-primary" },
              { icon: Users, value: data.necesitan, label: "Necesitan traslado", tone: "text-fg" },
              { icon: Users, value: llevados, label: "Con compañero asignado", tone: "text-ok" },
              { icon: HelpCircle, value: sinDato, label: "Sin dato cargado", tone: sinDato ? "text-warn" : "text-muted" },
            ].map((tile) => (
              <div key={tile.label} className="rounded-xl bg-bg p-2.5">
                <tile.icon className={cn("size-4", tile.tone)} />
                <p className={cn("mt-1 text-xl font-semibold leading-none tabular-nums", tile.tone)}>{tile.value}</p>
                <p className="mt-1 text-[0.7rem] leading-tight text-muted">{tile.label}</p>
              </div>
            ))}
          </div>

          {!data.declarados ? (
            <p className="rounded-xl border border-warn/40 bg-warn-soft p-3 text-sm">Todavía no hay nadie cargado. Abrí a cada persona en la lista de abajo y marcá si tiene vehículo seguro y acepta llevar compañeros, o si necesita que la pasen a buscar. Hay {data.conDomicilio} personas con domicilio en el mapa.</p>
          ) : null}

          {data.propuesta.cadenas.length ? (
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Cadenas propuestas</h3>
              <ul className="mt-1.5 grid gap-2 lg:grid-cols-2">
                {data.propuesta.cadenas.map((chain) => (
                  <li key={chain.conductor.id} className="rounded-xl border border-border p-2.5">
                    <p className="flex items-center gap-2 text-sm font-semibold"><Car className="size-4 shrink-0 text-primary" />{chain.conductor.nombre}<span className="ml-auto shrink-0 text-xs font-normal text-muted">desvío {km1(chain.kmExtra)}</span></p>
                    <ol className="mt-1.5 space-y-1 border-l-2 border-primary-soft pl-3">
                      {chain.pasajeros.map((rider, index) => (
                        <li key={rider.persona.id} className="text-sm"><span className="mr-1.5 text-xs tabular-nums text-muted">{index + 1}.</span>{rider.persona.nombre}{rider.afinidad.length ? <span className="ml-1.5 text-xs text-ok">{rider.afinidad.join(" · ")}</span> : null}</li>
                      ))}
                      <li className="text-xs text-muted">Hospital · {km1(chain.kmConPasadas)} en total (directo {km1(chain.kmDirecto)})</li>
                    </ol>
                  </li>
                ))}
              </ul>
            </div>
          ) : data.declarados ? <p className="text-sm text-muted">Con lo cargado todavía no se arma ninguna cadena: falta alguien dispuesto a llevar que tenga de camino a alguien que necesite traslado.</p> : null}

          {data.zonas.length ? (
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Sin compañero que los lleve: para transporte del hospital o privado</h3>
              <ul className="mt-1.5 space-y-1.5">
                {data.zonas.map((zone, index) => (
                  <li key={index} className="rounded-xl bg-bg px-2.5 py-2 text-sm"><b className="font-semibold">{zone.personas.length} {zone.personas.length === 1 ? "persona" : "personas"}</b> a {km1(zone.km)} al {zone.rumbo}: <span className="text-muted">{zone.personas.map((p) => p.nombre).join(", ")}</span></li>
                ))}
              </ul>
            </div>
          ) : null}

          {data.propuesta.conductoresLibres.length ? <p className="text-xs text-muted">Dispuestos a llevar que hoy no tienen a nadie de camino: {data.propuesta.conductoresLibres.map((p) => p.nombre).join(", ")}.</p> : null}

          <p className="text-xs text-muted">Es una propuesta para revisar antes de avisar a nadie. Usa el domicilio registrado, no dónde está cada uno en ese momento, y distancias estimadas (línea recta por 1,3), no el recorrido real. "De camino" significa un desvío total de hasta {DESVIO_MAX_KM} km o el 25 % del viaje. Prioriza compañeros del mismo servicio y del mismo grupo de trabajo.</p>
        </div>
      ) : null}
    </section>
  );
}
