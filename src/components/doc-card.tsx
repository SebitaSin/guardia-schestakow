import { Link } from "@tanstack/react-router";
import { FileText, ImageIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { MONTHS_ES, displayTitle, kindLabel, wasModified, type GuardiaDoc } from "@/data/catalog";
import { DEPARTMENT_BY_SLUG } from "@/data/departments";
import { cn } from "@/lib/utils";

export function flagBadge(flag: string) {
  if (flag === "tentativo") return <Badge variant="warn">Tentativo</Badge>;
  if (flag === "definitivo") return <Badge variant="ok">Definitivo</Badge>;
  if (flag === "actualizado" || flag === "cambio")
    return <Badge variant="danger">Actualizado</Badge>;
  if (flag === "pasiva") return <Badge variant="muted">Pasiva</Badge>;
  return <Badge variant="outline">{flag}</Badge>;
}

export function DocCard({ doc, className }: { doc: GuardiaDoc; className?: string }) {
  const dept = DEPARTMENT_BY_SLUG[doc.departments[0] ?? ""];
  const month = doc.month ? MONTHS_ES[doc.month - 1] : null;

  return (
    <Link
      to="/archivo/$id"
      params={{ id: doc.id }}
      className={cn(
        "group flex flex-col overflow-hidden rounded-xl bg-surface shadow-[var(--shadow-border)] transition-[box-shadow,transform] duration-200 ease-[var(--ease-out)] hover:shadow-[var(--shadow-border-hover)]",
        className,
      )}
    >
      <div className="relative aspect-video overflow-hidden bg-primary-soft">
        {doc.thumbUrl ? (
          <img
            src={doc.thumbUrl}
            alt=""
            className="size-full object-cover object-top transition-transform duration-300 ease-[var(--ease-out)] group-hover:scale-[1.02]"
          />
        ) : (
          <div className="flex size-full items-center justify-center text-primary">
            {doc.preview === "image" ? (
              <ImageIcon className="size-8" strokeWidth={1.5} />
            ) : (
              <FileText className="size-8" strokeWidth={1.5} />
            )}
          </div>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-2 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-primary">
            {kindLabel(doc.kind)}
          </span>
          {wasModified(doc) ? <span className="text-sm text-warn">Modificado</span> : null}
        </div>
        <h3 className="font-display text-lg font-medium leading-snug tracking-tight md:text-base">
          {displayTitle(doc)}
        </h3>
        <p className="mt-auto text-sm text-muted">
          {[dept?.short, month, doc.year].filter(Boolean).join(" · ")}
        </p>
      </div>
    </Link>
  );
}
