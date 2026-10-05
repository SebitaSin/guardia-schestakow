import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState, type ReactNode } from "react";
import { DocCard } from "@/components/doc-card";
import { PedidosPanel } from "@/components/pedidos";
import { MailInbox } from "@/components/mail-inbox";
import { WhatsAppFiles } from "@/components/whatsapp-files";
import { Input } from "@/components/ui/input";
import { MONTHS_ES, allDocuments, kindLabel, searchDocs, type DocKind } from "@/data/catalog";
import { DEPARTMENTS } from "@/data/departments";
import { useCatalogTick } from "@/lib/use-catalog";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/archivo/")({ component: ArchivoIndex });

const KINDS: { id: "todos" | DocKind; label: string }[] = [
  { id: "todos", label: "Todos" },
  { id: "cronograma", label: "Cronograma" },
  { id: "modificacion", label: "Cambio" },
  { id: "pasiva", label: "Pasiva" },
  { id: "parte", label: "Parte" },
];

function ArchivoIndex() {
  const tick = useCatalogTick();
  const [q, setQ] = useState("");
  const [dept, setDept] = useState("todos");
  const [kind, setKind] = useState<(typeof KINDS)[number]["id"]>("todos");
  const [month, setMonth] = useState("todos");

  const months = useMemo(() => {
    const set = new Set<string>();
    for (const d of allDocuments()) {
      if (d.month) set.add(`${d.year}-${d.month}`);
    }
    return [...set].sort().reverse();
  }, [tick]);

  const docs = useMemo(() => {
    return searchDocs(q).filter((d) => {
      if (dept !== "todos" && !d.departments.includes(dept)) return false;
      if (kind !== "todos" && d.kind !== kind) return false;
      if (month !== "todos") {
        const [y, m] = month.split("-").map(Number);
        if (d.year !== y || d.month !== m) return false;
      }
      return true;
    });
  }, [q, dept, kind, month, tick]);

  return (
    <div className="space-y-6">
      <header>
        <p className="text-xs font-medium uppercase tracking-widest text-primary">Correo</p>
        <h1 className="mt-2 font-display text-3xl font-medium tracking-tight">Archivo</h1>
        <p className="mt-2 text-muted">
          {allDocuments().length} documentos de guardia, cronograma o cambio.
        </p>
      </header>

      <MailInbox />
      <WhatsAppFiles />

      <Input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Buscar médico, servicio o mes"
        aria-label="Buscar en el archivo"
      />

      <PedidosPanel />

      <div className="flex flex-col gap-3">
        <FilterRow label="Servicio">
          <Chip active={dept === "todos"} onClick={() => setDept("todos")}>
            Todos
          </Chip>
          {DEPARTMENTS.map((d) => (
            <Chip key={d.slug} active={dept === d.slug} onClick={() => setDept(d.slug)}>
              {d.short}
            </Chip>
          ))}
        </FilterRow>
        <FilterRow label="Tipo">
          {KINDS.map((k) => (
            <Chip key={k.id} active={kind === k.id} onClick={() => setKind(k.id)}>
              {k.label}
            </Chip>
          ))}
        </FilterRow>
        <FilterRow label="Mes">
          <Chip active={month === "todos"} onClick={() => setMonth("todos")}>
            Todos
          </Chip>
          {months.map((key) => {
            const [y, m] = key.split("-").map(Number);
            return (
              <Chip key={key} active={month === key} onClick={() => setMonth(key)}>
                {MONTHS_ES[m - 1]} {y}
              </Chip>
            );
          })}
        </FilterRow>
      </div>

      <p className="text-sm text-muted tabular-nums">
        {docs.length} resultado{docs.length === 1 ? "" : "s"}
        {kind !== "todos" ? ` · ${kindLabel(kind)}` : null}
      </p>

      {docs.length === 0 ? (
        <p className="rounded-xl bg-surface p-6 text-muted shadow-[var(--shadow-border)]">
          Nada coincide con esos filtros.
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {docs.map((doc) => (
            <DocCard key={doc.id} doc={doc} />
          ))}
        </div>
      )}
    </div>
  );
}

function FilterRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 text-xs font-medium uppercase tracking-wider text-subtle">{label}</p>
      <div className="flex gap-1.5 overflow-x-auto pb-1">{children}</div>
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "min-h-11 shrink-0 rounded-full px-3 text-sm font-medium capitalize transition-colors duration-150",
        active ? "bg-primary text-primary-fg" : "bg-surface text-muted shadow-[var(--shadow-border)]",
      )}
    >
      {children}
    </button>
  );
}
