import { Link } from "@tanstack/react-router";
import { dutyLines, kindLabel, wasModified, type GuardiaDoc } from "@/data/catalog";
import { DEPARTMENT_BY_SLUG } from "@/data/departments";
import { StaffPortrait } from "@/components/staff-portrait";
import { findStaffPerson, personId } from "@/data/staff";

export function DutyCard({
  doc,
  today,
}: {
  doc: GuardiaDoc;
  today: string;
}) {
  const slug = doc.departments[0] ?? "";
  const dept = DEPARTMENT_BY_SLUG[slug];
  const shift = doc.shifts.find((s) => s.date === today);
  const people = shift?.text ? dutyLines(shift.text) : [];
  const heading = dept?.short ?? doc.title;
  const modified = wasModified(doc);

  return (
    <div className="flex min-h-12 flex-col rounded-2xl bg-surface px-4 py-4 pr-4 shadow-[var(--shadow-border)] md:rounded-xl md:px-4 md:py-3.5">
      <div className="flex items-start justify-between gap-3">
        <Link
          to="/archivo/$id"
          params={{ id: doc.id }}
          draggable={false}
          className="min-w-0 text-[1.25rem] font-semibold leading-tight tracking-tight text-fg md:text-lg"
        >
          {heading}
        </Link>
        <span className="shrink-0 pt-0.5 text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-primary">
          {kindLabel(doc.kind)}
        </span>
      </div>
      {modified ? <p className="mt-1 text-sm text-warn">Modificado</p> : null}

      {people.length ? (
        <ul className="mt-3 space-y-2.5">
          {people.map((p) => {
            const hit = findStaffPerson(p.name, slug);
            const placeholder = /^sin(?:\s|$)|^s\/?d$|^nadie$/i.test(p.name.trim());
            return (
              <li key={p.name + (p.hours ?? "")} className="flex items-center justify-between gap-3">
                {hit && !placeholder ? (
                  <Link
                    to="/ficha/$id"
                    params={{ id: personId(hit.slug, hit.person.surname) }}
                    className="flex min-w-0 items-center gap-2.5 text-[1.0625rem] leading-snug text-primary md:text-base"
                  >
                    <StaffPortrait name={hit.person.name} seed={hit.slug + hit.person.surname} size={36} />
                    {hit.person.name}
                  </Link>
                ) : (
                  <span className="min-w-0 text-[1.0625rem] leading-snug text-fg md:text-base">{placeholder ? "Sin profesional nominado" : p.name}</span>
                )}
                {p.hours ? (
                  <span className="shrink-0 tabular-nums text-[0.9375rem] text-muted md:text-sm">{p.hours}</span>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mt-3 text-base leading-snug text-muted md:text-sm">
          {doc.shifts.length
            ? "Hay cronograma del mes, sin turno nominado hoy"
            : "Correo del mes · falta leer los nombres"}
        </p>
      )}
    </div>
  );
}
