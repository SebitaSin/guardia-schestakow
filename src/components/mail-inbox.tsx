import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Check, RefreshCw } from "lucide-react";
import { MONTHS_ES, allDocuments } from "@/data/catalog";
import { DEPARTMENT_BY_SLUG } from "@/data/departments";
import { liveDocuments, liveUnread, updateFromMail } from "@/lib/live-catalog";
import { useCatalogTick } from "@/lib/use-catalog";
import { cn } from "@/lib/utils";

type Row = { id: string; filename: string; mailDate: string; month: string; destination: string | null };

function monthKey(year: number, month: number) {
  return `${year}-${String(month).padStart(2, "0")}`;
}

/** Mes al que corresponde un archivo sin leer: el que nombra, o el del correo. */
function guessMonth(filename: string, mailDate: string) {
  const text = filename.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const year = Number(mailDate.slice(0, 4)) || new Date().getFullYear();
  const mailMonth = Number(mailDate.slice(5, 7)) || 1;
  const named = [...MONTHS_ES, "setiembre"].findIndex((name) => text.includes(name));
  if (named < 0) return monthKey(year, mailMonth);
  const month = named === 12 ? 9 : named + 1;
  return monthKey(month < mailMonth - 6 ? year + 1 : year, month);
}

function monthLabel(key: string) {
  const [year, month] = key.split("-").map(Number);
  return `${MONTHS_ES[month - 1] ?? ""} ${year}`;
}

/** Archivos recibidos por correo, por mes, con el destino que la app les asignó. */
export function MailInbox() {
  const tick = useCatalogTick();
  const [updating, setUpdating] = useState(false);
  const groups = useMemo(() => {
    const shown = new Set(allDocuments().map((doc) => doc.id));
    const rows: Row[] = [
      ...liveDocuments().filter((doc) => doc.month).map((doc) => ({
        id: doc.id,
        filename: doc.filename || doc.title,
        mailDate: doc.source?.mailDate ?? "",
        month: monthKey(doc.year, doc.month ?? 1),
        destination: shown.has(doc.id) ? DEPARTMENT_BY_SLUG[doc.departments[0] ?? ""]?.name ?? doc.departments[0] ?? "Guardias" : "Reemplazado por una versión más nueva",
      })),
      ...liveUnread().map((file) => ({ id: file.id, filename: file.filename || "archivo", mailDate: file.mailDate, month: guessMonth(file.filename, file.mailDate), destination: null })),
    ];
    const byMonth = new Map<string, Row[]>();
    for (const row of rows) byMonth.set(row.month, [...(byMonth.get(row.month) ?? []), row]);
    return [...byMonth.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([month, list]) => ({ month, list: list.sort((a, b) => Number(Boolean(a.destination)) - Number(Boolean(b.destination)) || b.mailDate.localeCompare(a.mailDate)) }));
  }, [tick]);

  return (
    <section className="rounded-xl bg-surface p-4 shadow-[var(--shadow-border)] md:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-lg font-medium">Archivos del correo</h2>
        <button type="button" disabled={updating} onClick={() => { setUpdating(true); void updateFromMail().finally(() => setUpdating(false)); }} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-fg disabled:opacity-60">
          <RefreshCw className={cn("size-4", updating && "animate-spin")} />{updating ? "Actualizando…" : "Actualizar"}
        </button>
      </div>
      {groups.length === 0 ? <p className="mt-3 text-sm text-muted">Todavía no hay archivos del correo.</p> : null}
      <div className="mt-3 space-y-2">
        {groups.map((group, index) => {
          const done = group.list.filter((row) => row.destination).length;
          return (
            <details key={group.month} open={index === 0} className="rounded-lg bg-bg">
              <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-3 px-3 text-sm font-medium capitalize">
                <span>{monthLabel(group.month)}</span>
                <span className="text-muted tabular-nums">{done} de {group.list.length} procesados</span>
              </summary>
              <ul className="border-t border-border">
                {group.list.map((row) => (
                  <li key={row.id} className="flex items-center gap-3 border-b border-border px-3 py-2 text-sm last:border-0">
                    {row.destination ? <Check className="size-4 shrink-0 text-ok" aria-label="Procesado" /> : <span className="size-4 shrink-0 rounded-full border border-border" aria-label="Sin procesar" />}
                    <span className="min-w-0 flex-1">
                      {row.destination
                        ? <Link to="/archivo/$id" params={{ id: row.id }} className="block truncate font-medium text-primary">{row.filename}</Link>
                        : <a href={`/api/mail/attachment/${encodeURIComponent(row.id)}`} download className="block truncate font-medium text-primary">{row.filename}</a>}
                    </span>
                    <span className={cn("shrink-0 text-right", row.destination ? "" : "text-muted")}>{row.destination ?? "Sin procesar"}</span>
                  </li>
                ))}
              </ul>
            </details>
          );
        })}
      </div>
    </section>
  );
}
