import type { InternacionBed } from "@/data/internacion";
import { diasInternacion } from "@/data/internacion";
import { confirmarCama, nombrePizarron } from "@/lib/identidad";
import { cn } from "@/lib/utils";
import { BoardBedCard } from "@/components/board-bed-card";

export function ageLabel(edad: string | null) {
  if (!edad) return null;
  if (/años|mes|aprox|REVISAR/i.test(edad)) return edad;
  return `${edad} años`;
}

function estadoClass(estado: InternacionBed["estado"]) {
  if (estado === "LIBRE") return "text-ok";
  if (estado === "OCUPADA") return "text-primary";
  if (estado === "RESERVADA") return "text-warn";
  return "text-warn";
}

export function BedCard({ bed }: { bed: InternacionBed }) {
  if (bed.board) return <BoardBedCard bed={bed} />;
  return <ParteBedCard bed={bed} />;
}

function ParteBedCard({ bed }: { bed: InternacionBed }) {
  const empty = bed.estado === "LIBRE";
  const nombre = nombrePizarron(bed);
  const pendiente =
    bed.estado === "OCUPADA" && bed.identidad !== "CONFIRMADA" && bed.identidad !== "PROBABLE";

  return (
    <article className="rounded-2xl bg-surface px-4 py-3.5 shadow-[var(--shadow-border)]">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-semibold tabular-nums text-muted">Cama {bed.cama}</p>
        <span className={cn("text-[0.7rem] font-semibold uppercase tracking-[0.12em]", estadoClass(bed.estado))}>
          {bed.estado}
        </span>
      </div>
      {empty ? (
        <p className="mt-2 text-base text-muted">Libre</p>
      ) : (
        <>
          <p className="mt-2 text-[1.15rem] font-semibold leading-snug">{bed.paciente_oficial ?? nombre}</p>
          {bed.paciente_oficial && nombre && bed.paciente_oficial !== nombre ? (
            <p className="mt-0.5 text-sm text-muted">Pizarrón: {nombre}</p>
          ) : null}
          {ageLabel(bed.edad) ? <p className="mt-0.5 text-sm text-muted">{ageLabel(bed.edad)}</p> : null}
          {bed.estado === "OCUPADA" ? (
            <p className="mt-0.5 text-sm text-muted">
              {diasInternacion(bed) === 1 ? "1 día internado" : `${diasInternacion(bed)} días internado`}
              {bed.ingreso ? " · FI" : ""}
            </p>
          ) : null}
          {bed.diagnostico ? (
            <p className="mt-1.5 text-base leading-snug">{bed.diagnostico}</p>
          ) : bed.estado === "OCUPADA" ? (
            <p className="mt-1.5 text-sm text-warn">Diagnóstico no se leyó en la foto</p>
          ) : null}
          {bed.observaciones ? <p className="mt-1 text-sm text-muted">{bed.observaciones}</p> : null}
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            {bed.arm ? <span className="rounded-full bg-danger-soft px-2 py-0.5 font-medium text-danger">ARM</span> : null}
            {bed.aislamiento ? (
              <span className="rounded-full bg-warn-soft px-2 py-0.5 font-medium text-warn">Aislamiento</span>
            ) : null}
            {bed.identidad === "CONFIRMADA" ? (
              <span className="rounded-full bg-ok-soft px-2 py-0.5 font-medium text-ok">CONFIRMADO</span>
            ) : pendiente ? (
              <span className="rounded-full bg-warn-soft px-2 py-0.5 font-medium text-warn">A CONFIRMAR</span>
            ) : null}
            {pendiente ? (
              <button
                type="button"
                className="min-h-11 rounded-lg bg-primary px-3 text-sm font-medium text-primary-fg"
                onClick={() => { if (window.confirm(`Confirmar identidad de ${bed.paciente_oficial ?? nombre} en cama ${bed.cama}?`)) void confirmarCama(bed.slug, bed.cama, bed.paciente_oficial ?? nombre); }}
              >
                Confirmar
              </button>
            ) : null}
          </div>
        </>
      )}
    </article>
  );
}
