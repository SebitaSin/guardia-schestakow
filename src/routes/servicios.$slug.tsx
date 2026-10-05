import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { CalendarGrid } from "@/components/calendar-grid";
import { StaffPortrait } from "@/components/staff-portrait";
import { DocCard } from "@/components/doc-card";
import {
  MONTHS_ES,
  displayTitle,
  docsForDept,
  dutiesOn,
  latestDoc,
  dutyLines,
  todayISO,
} from "@/data/catalog";
import { DEPARTMENT_BY_SLUG } from "@/data/departments";
import { findStaffPerson, personId, staffFor } from "@/data/staff";
import { useCatalogTick } from "@/lib/use-catalog";
import { cn } from "@/lib/utils";

type ServicioSearch = { mes?: string };

function parseMes(value: unknown): string | undefined {
  return typeof value === "string" && /^\d{4}-\d{2}$/.test(value) ? value : undefined;
}

export const Route = createFileRoute("/servicios/$slug")({
  validateSearch: (raw: Record<string, unknown>): ServicioSearch => ({
    mes: parseMes(raw.mes),
  }),
  component: ServicioPage,
  notFoundComponent: () => (
    <p className="text-muted">Ese servicio no está en el directorio.</p>
  ),
});

function ServicioPage() {
  useCatalogTick();
  const { slug } = Route.useParams();
  const { mes } = Route.useSearch();
  const dept = DEPARTMENT_BY_SLUG[slug];
  if (!dept) throw notFound();

  const docs = docsForDept(slug);
  const today = todayISO();
  const [yearNow, monthNow] = today.split("-").map(Number);
  const selected = mes
    ? { year: Number(mes.slice(0, 4)), month: Number(mes.slice(5, 7)) }
    : null;
  const featured = selected
    ? latestDoc(slug, selected.month, selected.year)
    : latestDoc(slug, monthNow, yearNow) ??
      latestDoc(slug, monthNow === 12 ? 1 : monthNow + 1, monthNow === 12 ? yearNow + 1 : yearNow) ??
      latestDoc(slug);
  const todayDuty = dutiesOn(today).find((h) => h.dept.slug === slug);
  const featuredIsCurrent = featured?.month === monthNow && featured?.year === yearNow;
  const Icon = dept.icon;
  const months = [...new Map(
    docs
      .filter((d) => d.month)
      .map((d) => [`${d.year}-${d.month}`, { year: d.year, month: d.month as number }]),
  ).values()].sort((a, b) => b.year - a.year || b.month - a.month);

  return (
    <div className="space-y-8">
      <Link
        to="/servicios"
        className="inline-flex h-11 items-center gap-1.5 text-sm font-medium text-muted hover:text-fg"
      >
        <ArrowLeft className="size-4" />
        Servicios
      </Link>

      <header className="flex items-start gap-4">
        <span className="flex size-14 items-center justify-center rounded-lg bg-primary-soft text-primary">
          <Icon className="size-6" strokeWidth={1.6} />
        </span>
        <div>
          <h1 className="font-display text-4xl font-medium tracking-tight md:text-3xl">{dept.name}</h1>
          <p className="mt-1 text-lg text-muted md:text-base">{dept.blurb}</p>
        </div>
      </header>

      {todayDuty ? (
        <section className="rounded-2xl bg-primary px-5 py-5 text-primary-fg md:rounded-xl md:px-5 md:py-4">
          <p className="text-sm font-medium uppercase tracking-widest opacity-80 md:text-xs">Hoy</p>
          <ul className="mt-3 space-y-2.5">
            {dutyLines(todayDuty.text).map((p) => {
              const hit = findStaffPerson(p.name, slug);
              return (
                <li key={p.name + (p.hours ?? "")} className="flex items-baseline justify-between gap-3">
                  {hit ? (
                    <Link
                      to="/ficha/$id"
                      params={{ id: personId(hit.slug, hit.person.surname) }}
                      className="font-display text-2xl font-medium leading-snug text-primary-fg underline-offset-2 md:text-lg"
                    >
                      {hit.person.name}
                    </Link>
                  ) : (
                    <span className="font-display text-2xl font-medium leading-snug md:text-lg">{p.name}</span>
                  )}
                  {p.hours ? (
                    <span className="shrink-0 tabular-nums text-base opacity-80 md:text-sm">{p.hours}</span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ) : docs.length === 0 ? (
        <p className="rounded-xl bg-surface p-5 text-muted shadow-[var(--shadow-border)]">
          No hay cronogramas de este servicio en el correo descargado.
        </p>
      ) : featuredIsCurrent ? (
        <p className="text-sm text-muted">
          No hay un turno nominado para hoy en el cronograma de {MONTHS_ES[monthNow - 1]}.
        </p>
      ) : (
        <p className="text-sm text-muted">
          No llegó el cronograma de {MONTHS_ES[monthNow - 1]} {yearNow}. El último en el correo
          {featured?.month
            ? ` es ${MONTHS_ES[featured.month - 1]} ${featured.year}`
            : " no cubre hoy"}
          .
        </p>
      )}

      {months.length ? (
        <div className="flex flex-wrap gap-2">
          {months.map((mm) => {
            const key = `${mm.year}-${String(mm.month).padStart(2, "0")}`;
            const active = featured?.month === mm.month && featured?.year === mm.year;
            return (
              <Link
                key={key}
                to="/servicios/$slug"
                params={{ slug }}
                search={{ mes: key }}
                className={cn(
                  "rounded-full px-3 py-1.5 text-xs font-medium capitalize",
                  active ? "bg-primary text-primary-fg" : "bg-primary-soft text-primary",
                )}
              >
                {MONTHS_ES[mm.month - 1]} {mm.year}
              </Link>
            );
          })}
        </div>
      ) : null}

      {featured && featured.shifts.length > 0 ? (
        <CalendarGrid doc={featured} highlightDate={featuredIsCurrent ? today : undefined} />
      ) : featured && featured.pageImages.length > 0 ? (
        <section className="overflow-hidden rounded-xl bg-surface shadow-[var(--shadow-border)]">
          <div className="flex items-center justify-between px-4 py-3">
            <h2 className="font-display text-lg font-medium">{displayTitle(featured)}</h2>
            <Link
              to="/archivo/$id"
              params={{ id: featured.id }}
              className="text-sm font-medium text-primary"
            >
              Abrir
            </Link>
          </div>
          <img src={featured.pageImages[0]} alt={displayTitle(featured)} className="w-full" />
        </section>
      ) : null}

      {staffFor(slug).length ? (
        <section>
          <div className="mb-3 flex items-end justify-between gap-3">
            <h2 className="font-display text-lg font-medium">Plantel de referencia</h2>
            <Link to="/plantel" className="text-sm font-medium text-primary">
              Ver todos
            </Link>
          </div>
          <p className="mb-3 text-sm text-muted">
            Si un cronograma no nombra el servicio, se usa este listado: hacen falta 4 coincidencias.
          </p>
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {staffFor(slug).map((p) => (
              <li key={p.surname}>
                <Link
                  to="/ficha/$id"
                  params={{ id: personId(slug, p.surname) }}
                  className="flex items-center gap-3 rounded-xl bg-surface px-3 py-2 text-sm shadow-[var(--shadow-border)]"
                >
                  <StaffPortrait name={p.name} seed={slug + p.surname} size={40} />
                  {p.name}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <p className="text-sm text-muted">
          Todavía no hay plantel de referencia para este servicio. Cuando llegue un cronograma con
          nombres se arma solo.
        </p>
      )}

      {docs.length ? (
        <section>
          <h2 className="mb-3 font-display text-lg font-medium">Documentos</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {docs.map((doc) => (
              <DocCard key={doc.id} doc={doc} />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
