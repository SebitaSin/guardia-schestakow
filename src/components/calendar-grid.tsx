import { Link } from "@tanstack/react-router";
import { MONTHS_ES, WEEKDAYS_ES, monthCells, splitDuty, todayISO, type GuardiaDoc } from "@/data/catalog";
import { DEPARTMENT_BY_SLUG } from "@/data/departments";
import { cn } from "@/lib/utils";

export function CalendarGrid({
  doc,
  highlightDate,
}: {
  doc: GuardiaDoc;
  highlightDate?: string;
}) {
  if (!doc.month) return null;
  const today = todayISO();
  const cells = monthCells(doc.year, doc.month, doc.shifts);
  if (cells.every((c) => !c?.text) && !doc.shifts.length) return null;
  const dept = DEPARTMENT_BY_SLUG[doc.departments[0] ?? ""];

  return (
    <section className="overflow-hidden rounded-xl bg-surface shadow-[var(--shadow-border)]">
      <header className="flex items-baseline justify-between gap-3 px-4 py-4 md:px-5 md:py-3">
        <div>
          {dept ? (
            <p className="text-sm font-medium uppercase tracking-widest text-primary md:text-xs">{dept.name}</p>
          ) : null}
          <h3 className="font-display text-2xl font-medium capitalize md:text-lg">
            {MONTHS_ES[doc.month - 1]} {doc.year}
          </h3>
        </div>
        <p className="text-sm text-muted md:text-xs">Lunes a domingo</p>
      </header>
      <div className="max-w-full overflow-x-auto overscroll-x-contain">
        <div className="grid w-full min-w-[40rem] grid-cols-7 border-t border-border md:min-w-0">
        {WEEKDAYS_ES.map((d) => (
          <div
            key={d}
            className="border-b border-border px-1 py-2.5 text-center text-sm font-medium uppercase tracking-wider text-muted md:px-1 md:py-2 md:text-xs"
          >
            {d}
          </div>
        ))}
        {cells.map((cell, i) => {
          const isToday = cell?.date === today;
          const isHi = cell?.date === highlightDate;
          const people = cell?.text ? splitDuty(cell.text) : [];
          return (
            <div
              key={i}
              className={cn(
                "min-h-28 border-b border-r border-border p-2 last:border-r-0 md:min-h-24 md:p-2",
                i % 7 === 6 && "border-r-0",
                isToday && "bg-primary-soft",
                isHi && !isToday && "bg-warn-soft",
              )}
            >
              {cell ? (
                <>
                  <div className="flex items-center justify-between">
                    <span
                      className={cn(
                        "tabular-nums text-sm font-medium md:text-xs",
                        isToday ? "text-primary" : "text-muted",
                      )}
                    >
                      {cell.day}
                    </span>
                  </div>
                  <ul className="mt-1 space-y-0.5">
                    {people.slice(0, 4).map((p) => (
                      <li key={p} className="text-sm leading-snug break-words text-fg md:truncate md:text-xs">
                        {p}
                      </li>
                    ))}
                    {people.length > 4 ? (
                      <li className="text-sm text-muted md:text-xs">+{people.length - 4}</li>
                    ) : null}
                  </ul>
                </>
              ) : null}
            </div>
          );
        })}
        </div>
      </div>
      {doc.id ? (
        <div className="px-4 py-3">
          <Link
            to="/archivo/$id"
            params={{ id: doc.id }}
            className="text-sm font-medium text-primary hover:underline"
          >
            Ver documento original
          </Link>
        </div>
      ) : null}
    </section>
  );
}
