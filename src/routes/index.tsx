import { createFileRoute, Link } from "@tanstack/react-router";
import { Clock3, RefreshCw, Smartphone } from "lucide-react";
import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { catalog, clinicalRank, dutiesOn, dutyLines, formatLongDate, formatUpdated, missingDutiesOn, todayISO } from "@/data/catalog";
import { liveUpdatedAt, updateFromMail } from "@/lib/live-catalog";
import { cn } from "@/lib/utils";
import { useCatalogTick } from "@/lib/use-catalog";

export const Route = createFileRoute("/")({ component: Home });

type ShiftKind = "DAY_12" | "NIGHT_12" | "FULL_24" | "UNKNOWN";
type LiveDuty = ReturnType<typeof dutiesOn>[number] & { name: string; hours: string | null; kind: ShiftKind; key: string };
const LEADERSHIP_PHRASES = [
  "Escuchar primero también es una forma de dirigir.",
  "Un buen jefe cuida a las personas y ordena las prioridades.",
  "La claridad da tranquilidad al equipo.",
  "Liderar es hacer que el trabajo de otros sea un poco más fácil.",
  "La mejor decisión es la que protege al paciente y al equipo.",
  "Reconocer el esfuerzo también construye un buen servicio.",
];

function classify(hours: string | null): ShiftKind {
  const value = String(hours ?? "").replace(/\s/g, "").toLowerCase();
  if (value === "24h" || value === "08:00–08:00" || value === "08:00-08:00") return "FULL_24";
  if (value === "08:00–20:00" || value === "08:00-20:00") return "DAY_12";
  if (value === "20:00–08:00" || value === "20:00-08:00") return "NIGHT_12";
  return "UNKNOWN";
}

function currentHour() {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Argentina/Mendoza", hour: "2-digit", hourCycle: "h23" }).formatToParts(new Date());
  return Number(parts.find((part) => part.type === "hour")?.value ?? 0);
}

function updatedLabel() {
  const at = liveUpdatedAt();
  const when = at ? new Date(at) : null;
  if (!when || Number.isNaN(when.getTime())) return formatUpdated(catalog.generatedAt);
  return new Intl.DateTimeFormat("es-AR", { timeZone: catalog.timezone, day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }).format(when);
}

function Home() {
  const tick = useCatalogTick();
  const [updating, setUpdating] = useState(false);
  const today = todayISO();
  const [query, setQuery] = useState("");
  const hour = currentHour();
  const active12: ShiftKind = hour >= 8 && hour < 20 ? "DAY_12" : "NIGHT_12";
  const entries = useMemo<LiveDuty[]>(() => dutiesOn(today)
    .filter((duty) => duty.text.trim())
    .sort((a, b) => clinicalRank(a.dept.slug) - clinicalRank(b.dept.slug))
    .flatMap((duty) => dutyLines(duty.text).map((line, index) => ({ ...duty, ...line, kind: classify(line.hours), key: `${duty.doc.id}-${index}-${line.name}` }))), [today, tick]);
  const needle = query.trim().toLocaleLowerCase("es");
  const visible = needle ? entries.filter((entry) => `${entry.name} ${entry.dept.name} ${entry.dept.short}`.toLocaleLowerCase("es").includes(needle)) : entries;
  const serviceGroups = useMemo(() => {
    const groups = new Map<string, { slug: string; name: string; entries: LiveDuty[]; blanks: number }>();
    for (const entry of visible) {
      const group = groups.get(entry.dept.slug);
      if (group) group.entries.push(entry);
      else groups.set(entry.dept.slug, { slug: entry.dept.slug, name: entry.dept.name, entries: [entry], blanks: 0 });
    }
    // Servicio sin planilla para hoy: queda en blanco, con los lugares que tenía la guardia anterior.
    for (const missing of missingDutiesOn(today)) {
      if (needle && !`${missing.dept.name} ${missing.dept.short}`.toLocaleLowerCase("es").includes(needle)) continue;
      groups.set(missing.dept.slug, { slug: missing.dept.slug, name: missing.dept.name, entries: [], blanks: missing.slots });
    }
    return [...groups.values()].sort((a, b) => clinicalRank(a.slug) - clinicalRank(b.slug));
  }, [visible, today, needle, tick]);
  const coveredServices = new Set(visible.map((entry) => entry.dept.slug));
  const [leadershipPhrase] = useState(() => LEADERSHIP_PHRASES[Math.floor(Math.random() * LEADERSHIP_PHRASES.length)]);

  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-xl bg-surface shadow-[var(--shadow-border)]">
        <div className="grid md:grid-cols-[1.4fr_1fr]">
          <div className="flex flex-col justify-between gap-4 p-4 md:p-8">
            <div>
              <h1 className="font-display text-[1.75rem] font-medium tracking-tight md:text-4xl">Guardias en tiempo real</h1>
              <p className="mt-1.5 text-base capitalize md:text-lg">{formatLongDate(today)}</p>
              <p className="mt-1 text-sm text-muted">Actualizado {updatedLabel()}</p>
            </div>
            <div><button type="button" disabled={updating} onClick={() => { setUpdating(true); void updateFromMail().finally(() => setUpdating(false)); }} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-fg disabled:opacity-60"><RefreshCw className={cn("size-4", updating && "animate-spin")} />{updating ? "Actualizando…" : "Actualizar"}</button></div>
          </div>
          <div className="relative h-20 md:h-auto"><img src="/hospital/fachada.jpg" alt="Fachada del Hospital Teodoro Schestakow" className="absolute inset-0 size-full object-cover object-[68%_40%]" /></div>
        </div>
      </section>

      <p className="rounded-xl border border-warn/40 bg-warn/10 p-3 text-sm">“En tiempo real” significa estado actual según el último cronograma recibido. No confirma presencia física ni presentismo.</p>

      <a href="?install=1" className="install-hint flex min-h-12 items-center gap-3 rounded-xl bg-primary-soft px-4 py-3 text-primary md:hidden">
        <Smartphone className="size-5 shrink-0" /><span><span className="block font-medium">Usar en el celular</span><span className="block text-sm text-muted">Agregala a la pantalla de inicio</span></span>
      </a>

      <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar médico o servicio" aria-label="Buscar médico o servicio" autoComplete="off" />

      <section className="grid grid-cols-3 gap-2" aria-label="Resumen operativo de guardias">
        <div className="rounded-xl bg-surface p-3 shadow-[var(--shadow-border)]">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">Guardias confirmadas</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{visible.length}</p>
        </div>
        <div className="rounded-xl bg-surface p-3 shadow-[var(--shadow-border)]">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">Servicios cubiertos</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{coveredServices.size}</p>
        </div>
        <div className="rounded-xl bg-surface p-3 shadow-[var(--shadow-border)]">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">Para recordar hoy</p>
          <p className="mt-1 text-sm font-medium leading-snug">{leadershipPhrase}</p>
        </div>
      </section>

      <section className="rounded-2xl border border-border bg-surface p-4 shadow-[var(--shadow-border)]">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-semibold">Guardia actual por servicio</h2>
            <p className="mt-1 text-sm text-muted">Primero el servicio; debajo, los médicos incluidos en el cronograma.</p>
          </div>
          <span className="rounded-full bg-primary-soft px-2.5 py-1 text-xs font-semibold text-primary">{formatLongDate(today)}</span>
        </div>
        <div className="mt-4 grid gap-3 xl:grid-cols-2">
          {serviceGroups.map((group) => {
            const serviceActive = group.entries.some((entry) => classify(entry.hours) === active12 || classify(entry.hours) === "FULL_24");
            return (
              <section key={group.name} className={cn("rounded-xl border border-border bg-bg p-3", serviceActive && "ring-1 ring-primary/40")}>
                <div className="flex items-center justify-between gap-3 border-b border-border pb-2">
                  <div>
                    <h3 className="text-base font-semibold">{group.name}</h3>
                    {group.entries.length ? <p className="text-xs text-muted">{group.entries.length} {group.entries.length === 1 ? "profesional" : "profesionales"}</p> : null}
                  </div>
                  <span className={cn("rounded-full px-2.5 py-1 text-xs font-semibold", serviceActive ? "bg-primary-soft text-primary" : "bg-surface text-muted")}>
                    {group.blanks ? "SIN PLANILLA" : serviceActive ? "ACTIVO AHORA" : "PROGRAMADO"}
                  </span>
                </div>
                <ul className="divide-y divide-border">
                  {Array.from({ length: group.blanks }, (_, index) => <li key={`blank-${index}`} className="h-12" aria-label="Sin dato" />)}
                  {group.entries.map((entry) => {
                    const active = classify(entry.hours) === active12 || classify(entry.hours) === "FULL_24";
                    return (
                      <li key={entry.key} className="flex items-center justify-between gap-3 py-3 first:pt-3 last:pb-0">
                        <div className="min-w-0"><p className="font-medium">{entry.name}</p>{active ? <p className="text-xs font-semibold text-primary">De guardia ahora</p> : null}</div>
                        <div className="flex shrink-0 items-center gap-3"><span className="flex items-center gap-1 text-sm tabular-nums text-muted"><Clock3 className="size-4" />{entry.hours ?? "SIN DATOS"}</span><Link to="/archivo/$id" params={{ id: entry.doc.id }} className="text-xs font-medium text-primary">Ver fuente</Link></div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
          {!serviceGroups.length ? (
            <p className="rounded-xl border border-warn/40 bg-warn/10 p-3 text-sm text-muted xl:col-span-2" role="status">
              {query
                ? "No hay guardias que coincidan con la búsqueda."
                : `No hay guardias cargadas para ${formatLongDate(today)} en los cronogramas disponibles. Revisá Archivo y confirmá una fuente vigente; este resultado no significa que el servicio esté descubierto.`}
            </p>
          ) : null}
        </div>
      </section>
    </div>
  );
}
