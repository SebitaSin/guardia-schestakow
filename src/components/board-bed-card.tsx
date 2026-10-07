import { useState } from "react";
import type { InternacionBed } from "@/data/internacion";
import { diasInternacion } from "@/data/internacion";
import { confirmBoardBed, type BoardValues } from "@/lib/boards";
import { cn } from "@/lib/utils";

const FIELDS = [
  ["paciente", "Apellido y nombre"], ["dni", "DNI"], ["edad", "Edad"], ["diagnostico", "Diagnóstico"],
  ["obra_social", "Obra social"], ["hc", "Historia clínica"], ["ingreso", "Ingreso"], ["observaciones", "Observaciones"],
] as const;

/** Cama de una planilla vigente: lo dudoso en amarillo, editable, con botón Confirmar. */
export function BoardBedCard({ bed }: { bed: InternacionBed }) {
  const row = bed.board!;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<BoardValues>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const doubtful = row.revision === "REVISAR" || row.revision === "CONFLICTO";
  const occupied = row.estado === "OCUPADA";

  async function send(values: BoardValues) {
    setBusy(true); setError("");
    const result = await confirmBoardBed(bed.slug, bed.cama, values);
    setBusy(false);
    if (result === "ok") { setEditing(false); setDraft({}); }
    else setError(result === "forbidden" ? "Tu usuario no puede confirmar camas." : "No se guardó. Probá de nuevo.");
  }
  function startEdit() {
    setDraft({ paciente: row.paciente, dni: row.dni ?? null, edad: row.edad ?? null, diagnostico: row.diagnostico ?? null, obra_social: row.obra_social ?? null, hc: row.hc ?? null, ingreso: row.ingreso ?? null, observaciones: row.observaciones ?? null });
    setEditing(true);
  }
  const details = [row.edad ? (/\D/.test(row.edad) ? row.edad : `${row.edad} años`) : null, row.dni ? `DNI ${row.dni}` : null, row.hc ? `HC ${row.hc}` : null, row.obra_social].filter(Boolean).join(" · ");

  return (
    <article className={cn("rounded-2xl px-4 py-3.5 shadow-[var(--shadow-border)]", row.revision === "CONFLICTO" ? "bg-danger-soft" : doubtful ? "bg-warn-soft" : "bg-surface")}>
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-semibold tabular-nums text-muted">Cama {bed.cama}</p>
        <span className={cn("text-[0.7rem] font-semibold uppercase tracking-[0.12em]", row.estado === "LIBRE" ? "text-ok" : occupied ? "text-primary" : "text-muted")}>
          {row.estado === "LIBRE" ? "Libre" : occupied ? "Ocupada" : "Sin dato"}
        </span>
      </div>

      {row.estado === "DESCONOCIDA" ? <p className="mt-2 text-sm text-muted">La última foto no muestra esta cama y no hay dato anterior.</p> : null}
      {row.estado === "LIBRE" && !editing ? <p className="mt-2 text-base text-muted">Libre</p> : null}
      {occupied && !editing ? (
        <>
          <p className="mt-2 text-[1.15rem] font-semibold leading-snug">{row.paciente ?? "Nombre no leído"}</p>
          {details ? <p className="mt-0.5 text-sm text-muted">{details}</p> : null}
          {row.ingreso ? <p className="mt-0.5 text-sm text-muted">Ingreso {row.ingreso}{bed.ingreso ? ` · ${diasInternacion(bed) === 1 ? "1 día" : `${diasInternacion(bed)} días`}` : ""}</p> : null}
          {row.diagnostico ? <p className="mt-1.5 text-base leading-snug">{row.diagnostico}</p> : <p className="mt-1.5 text-sm text-muted">Sin diagnóstico en la pizarra</p>}
          {row.observaciones ? <p className="mt-1 text-sm text-muted">{row.observaciones}</p> : null}
        </>
      ) : null}

      {!row.visto && row.estado !== "DESCONOCIDA" ? <p className="mt-2 text-xs text-warn">La última foto no muestra esta cama: se mantiene el dato anterior.</p> : null}
      {doubtful && row.motivos?.length ? <p className="mt-2 text-xs text-warn">{row.motivos.join(" · ")}</p> : null}
      {doubtful && row.sugerencia && !editing ? (
        <p className="mt-2 text-sm">Laboratorio tiene: <span className="font-medium">{row.sugerencia}</span>{" "}
          <button type="button" className="ml-1 min-h-9 rounded-md border px-2 text-xs font-medium" disabled={busy} onClick={() => void send({ usar_sugerencia: true })}>Usar ese nombre y confirmar</button>
        </p>
      ) : null}

      {editing ? (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {FIELDS.map(([field, label]) => (
            <label key={field} className={cn("text-xs text-muted", (field === "paciente" || field === "diagnostico" || field === "observaciones") && "sm:col-span-2")}>
              {label}
              <input className="mt-1 min-h-11 w-full rounded-md border bg-surface px-2 text-base text-fg" value={(draft[field] as string | null | undefined) ?? ""} onChange={(event) => setDraft((current) => ({ ...current, [field]: event.target.value || null }))} />
            </label>
          ))}
          <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={draft.arm ?? Boolean(row.arm)} onChange={(event) => setDraft((current) => ({ ...current, arm: event.target.checked }))} /> ARM</label>
        </div>
      ) : null}

      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
        {row.arm ? <span className="rounded-full bg-danger-soft px-2 py-0.5 font-medium text-danger">ARM</span> : null}
        {row.post_quirurgico ? <span className="rounded-full bg-primary-soft px-2 py-0.5 font-medium text-primary">Postquirúrgico</span> : null}
        {row.revision === "CONFIRMADA" ? <span className="rounded-full bg-ok-soft px-2 py-0.5 font-medium text-ok">Confirmado</span> : null}
        {row.revision === "VERIFICADA" && occupied ? <span className="rounded-full bg-ok-soft px-2 py-0.5 font-medium text-ok">Coincide con laboratorio</span> : null}
        {doubtful ? <span className="rounded-full bg-warn px-2 py-0.5 font-medium text-white">{row.revision === "CONFLICTO" ? "Datos que no coinciden" : "A confirmar"}</span> : null}
        {editing ? (
          <>
            <button type="button" className="min-h-11 rounded-lg bg-primary px-3 text-sm font-medium text-primary-fg" disabled={busy} onClick={() => void send({ ...draft, estado: "OCUPADA" })}>Guardar y confirmar</button>
            <button type="button" className="min-h-11 rounded-lg border px-3 text-sm font-medium" disabled={busy} onClick={() => void send({ estado: "LIBRE" })}>La cama está libre</button>
            <button type="button" className="min-h-11 px-2 text-sm text-muted" disabled={busy} onClick={() => setEditing(false)}>Cancelar</button>
          </>
        ) : (
          <>
            {doubtful ? <button type="button" className="min-h-11 rounded-lg bg-primary px-3 text-sm font-medium text-primary-fg" disabled={busy} onClick={() => void send({})}>Confirmar</button> : null}
            <button type="button" className="min-h-11 rounded-lg border px-3 text-sm font-medium" disabled={busy} onClick={startEdit}>Corregir</button>
          </>
        )}
      </div>
      {error ? <p role="alert" className="mt-2 text-sm text-danger">{error}</p> : null}
    </article>
  );
}
