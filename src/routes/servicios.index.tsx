import { createFileRoute, Link } from "@tanstack/react-router";
import { docsForDept } from "@/data/catalog";
import { DEPARTMENTS, GROUPS } from "@/data/departments";

export const Route = createFileRoute("/servicios/")({ component: ServiciosIndex });

function ServiciosIndex() {
  return (
    <div className="space-y-8">
      <header>
        <p className="text-xs font-medium uppercase tracking-widest text-primary">Directorio</p>
        <h1 className="mt-2 font-display text-3xl font-medium tracking-tight">Servicios</h1>
        <p className="mt-2 max-w-xl text-muted">
          Íconos por dependencia. El plano de obra de Guardia de Emergencias no alcanza para un
          mapa fiel del hospital, así que el tablero se organiza por ala.
        </p>
        <Link to="/plantel" className="mt-3 inline-block text-sm font-medium text-primary">
          Plantel médico de cada servicio
        </Link>
      </header>

      {GROUPS.map((group) => {
        const items = DEPARTMENTS.filter((d) => d.group === group.id);
        return (
          <section key={group.id}>
            <h2 className="mb-3 font-display text-2xl font-medium md:text-lg">{group.label}</h2>
            <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
              {items.map((dept) => {
                const n = docsForDept(dept.slug).length;
                const Icon = dept.icon;
                return (
                  <li key={dept.slug}>
                    <Link
                      to="/servicios/$slug"
                      params={{ slug: dept.slug }}
                      className="flex min-h-28 items-start gap-3 rounded-2xl bg-surface p-5 shadow-[var(--shadow-border)] transition-[box-shadow] duration-200 hover:shadow-[var(--shadow-border-hover)] md:min-h-24 md:rounded-xl md:p-4"
                    >
                      <span className="flex size-14 items-center justify-center rounded-lg bg-primary-soft text-primary md:size-11 md:rounded-md">
                        <Icon className="size-7 md:size-5" strokeWidth={1.75} />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-lg font-medium leading-tight md:text-base">{dept.name}</span>
                        <span className="mt-1 block text-base text-muted md:text-sm">{dept.blurb}</span>
                        <span className="mt-1 block text-sm text-subtle md:text-xs">
                          {n ? `${n} documento${n === 1 ? "" : "s"}` : "Sin cronograma en el correo"}
                        </span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
