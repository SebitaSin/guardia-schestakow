import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { ArrowLeft, Download } from "lucide-react";
import { CalendarGrid } from "@/components/calendar-grid";
import { flagBadge } from "@/components/doc-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MONTHS_ES, displayTitle, docById, kindLabel } from "@/data/catalog";
import { DEPARTMENT_BY_SLUG } from "@/data/departments";
import { useCatalogTick } from "@/lib/use-catalog";

export const Route = createFileRoute("/archivo/$id")({
  component: ArchivoDoc,
  notFoundComponent: () => <p className="text-muted">No encontramos ese documento.</p>,
});

function ArchivoDoc() {
  useCatalogTick();
  const { id } = Route.useParams();
  const doc = docById(id);
  if (!doc) throw notFound();
  const dept = DEPARTMENT_BY_SLUG[doc.departments[0] ?? ""];
  const month = doc.month ? MONTHS_ES[doc.month - 1] : null;

  return (
    <div className="space-y-6">
      <Link
        to="/archivo"
        className="inline-flex h-11 items-center gap-1.5 text-sm font-medium text-muted hover:text-fg"
      >
        <ArrowLeft className="size-4" />
        Archivo
      </Link>

      <header className="space-y-3">
        <div className="flex flex-wrap gap-1.5">
          <Badge>{kindLabel(doc.kind)}</Badge>
          {doc.flags.map((f) => (
            <span key={f}>{flagBadge(f)}</span>
          ))}
        </div>
        <h1 className="font-display text-3xl font-medium tracking-tight">{displayTitle(doc)}</h1>
        <p className="text-muted">{[dept?.name, month, doc.year].filter(Boolean).join(" · ")}</p>
        {dept ? (
          <Link
            to="/servicios/$slug"
            params={{ slug: dept.slug }}
            className="text-sm font-medium text-primary hover:underline"
          >
            Ir a {dept.short}
          </Link>
        ) : null}
      </header>

      {doc.notes.length > 1 ? (
        <div className="rounded-xl bg-surface px-4 py-3 text-sm text-muted shadow-[var(--shadow-border)]">
          {doc.notes.slice(1).map((n) => (
            <p key={n}>{n}</p>
          ))}
        </div>
      ) : null}

      {doc.shifts.length > 0 ? <CalendarGrid doc={doc} /> : null}

      {doc.table && doc.preview === "table" ? (
        <div className="overflow-x-auto rounded-xl bg-surface shadow-[var(--shadow-border)]">
          <table className="min-w-full text-left text-sm">
            <tbody>
              {doc.table.map((row, i) => (
                <tr key={i} className="border-b border-border last:border-0">
                  {row.map((cell, j) => (
                    <td key={j} className={`px-3 py-2 align-top ${i === 0 ? "font-medium" : ""}`}>
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {doc.pageImages.length ? (
        <div className="space-y-3">
          {doc.pageImages.map((src, i) => (
            <figure
              key={src}
              className="overflow-hidden rounded-xl bg-surface shadow-[var(--shadow-border)]"
            >
              <img src={src} alt={`Página ${i + 1} de ${displayTitle(doc)}`} className="w-full" />
            </figure>
          ))}
        </div>
      ) : null}

      {doc.fileUrl ? (
        <Button asChild variant="secondary">
          <a href={doc.fileUrl} download>
            <Download className="size-4" />
            Descargar original
          </a>
        </Button>
      ) : null}

      {!doc.shifts.length && !doc.pageImages.length && !doc.table ? (
        <p className="rounded-xl bg-surface p-5 text-muted shadow-[var(--shadow-border)]">
          Este archivo llegó como Word o Excel antiguo y no se pudo abrir como imagen. El contenido
          quedó indexado por servicio y mes.
        </p>
      ) : null}
    </div>
  );
}
