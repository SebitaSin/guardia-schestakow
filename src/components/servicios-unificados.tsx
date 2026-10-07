import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { BedCard } from "@/components/bed-card";
import { BedGauge } from "@/components/bed-gauge";
import { Input } from "@/components/ui/input";
import { DEPARTMENTS } from "@/data/departments";
import { barTone, filterBeds, formatParteFecha, ocupacionPorServicio, searchBeds, type BedFilter } from "@/data/internacion";
import { boardFor, type Board } from "@/lib/boards";
import { useParteTick } from "@/lib/use-parte";
import { cn } from "@/lib/utils";

const FILTERS: { id: BedFilter; label: string }[] = [
  { id: "todos", label: "Todas" },
  { id: "ocupada", label: "Ocupadas" },
  { id: "libre", label: "Libres" },
  { id: "arm", label: "ARM" },
  { id: "revisar", label: "A confirmar" },
];

function boardLine(board: Board) {
  const when = new Date(board.foto_fecha).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  return `Pizarra del ${when}${board.grupo ? ` · ${board.grupo}` : board.remitente_nombre ? ` · ${board.remitente_nombre}` : ""}`;
}

function Turno({ board }: { board: Board }) {
  if (!board.turno) return null;
  return board.turno_origen === "GRUPO"
    ? <span className="ml-2 text-xs text-primary">{board.turno}</span>
    : <span className="ml-2 rounded bg-warn-soft px-1.5 py-0.5 text-xs text-warn">turno {board.turno} estimado</span>;
}

/** Una sola pantalla para servicios, camas y pacientes: se elige el servicio y se ve su planilla. */
export function ServiciosUnificados({ slug }: { slug?: string }) {
  useParteTick();
  const [q, setQ] = useState("");
  const [filtro, setFiltro] = useState<BedFilter>("todos");
  const servicios = ocupacionPorServicio();
  const query = q.trim();
  const visible = useMemo(() => filterBeds(searchBeds(query), filtro).filter((bed) => bed.estado !== "NO_ASISTENCIAL"), [query, filtro, servicios]);
  const selected = slug ? servicios.find((item) => item.slug === slug) : undefined;
  const narrowing = Boolean(query) || filtro !== "todos";
  const sinPizarra = servicios.filter((item) => !boardFor(item.slug)).length;

  return (
    <div className="space-y-4">
      <Input value={q} onChange={(event) => setQ(event.target.value)} placeholder="Buscar paciente, DNI, cama o diagnóstico" autoComplete="off" />
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4">
        {FILTERS.map((item) => (
          <button key={item.id} type="button" onClick={() => setFiltro(item.id)} className={cn("h-11 shrink-0 rounded-full px-4 text-sm font-medium", filtro === item.id ? "bg-primary text-primary-fg" : "bg-surface text-muted shadow-[var(--shadow-border)]")}>
            {item.label}
          </button>
        ))}
      </div>

      <nav aria-label="Servicios" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
        <Link to="/internados/camas" className={cn("flex h-11 shrink-0 items-center rounded-lg px-3 text-sm font-medium", !slug ? "bg-fg text-bg" : "bg-surface shadow-[var(--shadow-border)]")}>Todos</Link>
        {servicios.map((item) => (
          <Link key={item.slug} to="/internados/$slug" params={{ slug: item.slug }} className={cn("flex h-11 shrink-0 items-center gap-2 rounded-lg px-3 text-sm font-medium", slug === item.slug ? "bg-fg text-bg" : "bg-surface shadow-[var(--shadow-border)]")}>
            <span className={cn("size-2 rounded-full", boardFor(item.slug) ? "bg-ok" : "bg-border")} aria-hidden />
            {item.name}
            {item.revisar && boardFor(item.slug) ? <span className="rounded-full bg-warn px-1.5 text-xs text-white">{item.revisar}</span> : null}
          </Link>
        ))}
      </nav>

      {slug && !selected ? <p className="text-muted">Servicio no encontrado.</p> : null}

      {selected ? (() => {
        const board = boardFor(selected.slug);
        const beds = visible.filter((bed) => bed.slug === selected.slug);
        const guardia = DEPARTMENTS.find((dept) => dept.slug === selected.slug);
        return (
          <section className="space-y-3">
            <header>
              <h1 className="text-[1.6rem] font-semibold tracking-tight">{selected.name}</h1>
              <p className="mt-1 text-muted">{selected.ocupadas} ocupadas · {selected.libres} libres{selected.desconocidas ? ` · ${selected.desconocidas} sin dato` : ""}</p>
              {board
                ? <p className="mt-1 text-sm">{boardLine(board)}<Turno board={board} />{selected.revisar ? <span className="ml-2 font-medium text-warn">{selected.revisar} a confirmar</span> : <span className="ml-2 text-ok">sin pendientes</span>}</p>
                : <p className="mt-1 rounded-lg border border-danger/50 bg-danger/10 p-2 text-sm">Sin pizarra nueva. Lo que sigue es el parte del {formatParteFecha()}: no representa la ocupación actual.</p>}
              {guardia ? <Link to="/servicios/$slug" params={{ slug: guardia.slug }} className="mt-2 inline-block text-sm font-medium text-primary">Guardia y cronograma de {guardia.name}</Link> : null}
            </header>
            {beds.length ? <ul className="space-y-2">{beds.map((bed) => <li key={bed.cama}><BedCard bed={bed} /></li>)}</ul> : <p className="text-sm text-muted">Ninguna cama coincide con la búsqueda o el filtro.</p>}
          </section>
        );
      })() : null}

      {!slug && !narrowing ? (
        <section className="space-y-2">
          {sinPizarra ? <p className="text-sm text-muted">La aguja marca las camas ocupadas sobre el total del servicio. En gris: {sinPizarra} servicio(s) sin pizarra nueva, con el parte del {formatParteFecha()}.</p> : null}
          <ul className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {servicios.map((item) => {
              const board = boardFor(item.slug);
              return (
                <li key={item.slug}>
                  <Link to="/internados/$slug" params={{ slug: item.slug }} className="block h-full rounded-2xl bg-surface p-3 text-center shadow-[var(--shadow-border)] transition-[box-shadow] hover:shadow-[var(--shadow-border-hover)]">
                    <p className="truncate text-sm font-semibold">{item.name}</p>
                    <BedGauge ocupadas={item.ocupadas} total={item.total} vigente={Boolean(board)} />
                    <p className="text-xs text-muted">{item.ocupadas} ocupadas de {item.total} · {item.libres} libres</p>
                    <p className="mt-1 text-xs">
                      {board
                        ? <>{new Date(board.foto_fecha).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}{item.revisar ? <span className="ml-1 rounded-full bg-warn px-1.5 font-medium text-white">{item.revisar} a confirmar</span> : null}</>
                        : <span className="text-danger">sin pizarra nueva</span>}
                    </p>
                  </Link>
                </li>
              );
            })}
          </ul>
          <Link to="/servicios" className="inline-block pt-2 text-sm font-medium text-primary">Cronogramas y guardias de todos los servicios</Link>
        </section>
      ) : null}

      {!slug && narrowing ? (
        visible.length ? servicios.map((item) => {
          const beds = visible.filter((bed) => bed.slug === item.slug);
          if (!beds.length) return null;
          return (
            <section key={item.slug} className="space-y-2">
              <h2 className="text-lg font-semibold">{item.name}{boardFor(item.slug) ? null : <span className="ml-2 text-xs font-normal text-danger">histórico, no vigente</span>}</h2>
              <ul className="space-y-2">{beds.map((bed) => <li key={bed.cama}><BedCard bed={bed} /></li>)}</ul>
            </section>
          );
        }) : <p className="text-sm text-muted">Sin resultados.</p>
      ) : null}
    </div>
  );
}
