import { createFileRoute, Link } from "@tanstack/react-router";
import { Check, ChevronDown, Mail, Pencil, RefreshCw, RotateCcw, Smartphone, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { MONTHS_ES, catalog, docsForDept, dutiesOn, dutyLines, formatLongDate, formatUpdated, missingDutiesOn, todayISO } from "@/data/catalog";
import { liveClaims, liveUpdatedAt, pauseClaim, saveManualDuty, updateFromMail, type ManualDuty } from "@/lib/live-catalog";
import { cn } from "@/lib/utils";
import { useCatalogTick } from "@/lib/use-catalog";
import { DEPARTMENT_BY_SLUG } from "@/data/departments";

export const Route = createFileRoute("/")({ component: Home });

type ShiftKind = "DAY_12" | "NIGHT_12" | "FULL_24" | "UNKNOWN";
type LiveDuty = ReturnType<typeof dutiesOn>[number] & { name: string; hours: string | null; kind: ShiftKind; key: string };

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
  const day = (value: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: catalog.timezone }).format(value);
  const time = new Intl.DateTimeFormat("es-AR", { timeZone: catalog.timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(when);
  if (day(when) === day(new Date())) return `${time} h`;
  return `${new Intl.DateTimeFormat("es-AR", { timeZone: catalog.timezone, day: "numeric", month: "short" }).format(when)}, ${time} h`;
}

// Bloques en este orden; dentro de cada uno, alfabético.
const CRITICOS = new Set(["terapia-intensiva", "uco", "uciq", "uccyq", "tip", "neonatologia"]);
// Las planillas de Cirugía y Pediatría son las de sus guardias: van con Guardia Clínica.
const GUARDIA = new Set(["cirugia", "pediatria"]);
const GUARDIA_NAMES: Record<string, string> = { cirugia: "Guardia de Cirugía", pediatria: "Guardia de Pediatría" };
// Servicios que tienen que estar siempre a la vista, aunque nunca haya llegado una planilla suya.
const ALWAYS_SHOWN = ["guardia-clinica", "cirugia", "pediatria", "terapia-intensiva", "uco", "uccyq", "tip", "neonatologia"];
// "UCIQ" no existe como servicio del hospital: es UCCyQ (aclaración de Sebastián, 7/10/2026). No se muestra.
const HIDDEN = new Set(["uciq"]);
const INFRA = new Set(["albergue", "mantenimiento", "mensajeria", "movilidad", "porteria"]);
const APOYO = new Set(["esterilizacion", "kinesiologia"]);
const SECTIONS = [
  { id: "criticos", label: "Servicios críticos", short: "Críticos" },
  { id: "guardia", label: "Guardia", short: "Guardia" },
  { id: "medicos", label: "Internación y servicios médicos", short: "Internación" },
  { id: "apoyo", label: "Apoyo", short: "Apoyo" },
  { id: "infra", label: "Infraestructura", short: "Infraestr." },
] as const;
type SectionId = (typeof SECTIONS)[number]["id"];
type ServiceGroup = { slug: string; name: string; section: SectionId; docId: string | null; entries: LiveDuty[]; blanks: number; raw: string; manual?: ManualDuty; photo: boolean };

function sectionOf(dept: { slug: string; group: string }): SectionId {
  if (CRITICOS.has(dept.slug)) return "criticos";
  if (dept.slug.startsWith("guardia-") || GUARDIA.has(dept.slug)) return "guardia";
  if (INFRA.has(dept.slug)) return "infra";
  if (APOYO.has(dept.slug) || dept.group === "diagnostico") return "apoyo";
  return "medicos";
}

const MAIL_ACCOUNT = "htjs.2026@gmail.com";
const MAIL_URL = `https://mail.google.com/mail/?authuser=${encodeURIComponent(MAIL_ACCOUNT)}`;

// Las dos últimas direcciones que mandaron planillas del servicio: destinatarios por defecto del reclamo.
function lastSenders(slug: string): string[] {
  const docs = docsForDept(slug).filter((doc) => doc.source?.sender)
    .sort((a, b) => ((b.year ?? 0) - (a.year ?? 0)) || ((b.month ?? 0) - (a.month ?? 0)) || String(b.source?.mailDate ?? "").localeCompare(String(a.source?.mailDate ?? "")));
  const out: string[] = [];
  for (const doc of docs) {
    const who = doc.source?.sender?.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/)?.[0]?.toLowerCase();
    if (who && !out.includes(who)) out.push(who);
  }
  return out.slice(0, 2);
}

function shortStamp(iso: string): string {
  const [day, time] = iso.split("T");
  const [, month, dayOfMonth] = (day ?? "").split("-");
  return `${Number(dayOfMonth)}/${Number(month)} ${time?.slice(0, 5) ?? ""}`.trim();
}

// Abre el redactor de la casilla del hospital con el pedido escrito; el envío lo hace la persona.
function claimUrl(name: string, to: string[], iso: string): string {
  const [year, month] = iso.split("-").map(Number);
  const period = `${MONTHS_ES[month - 1]} ${year}`;
  const subject = `Planilla de guardias de ${period} - ${name}`;
  const body = `Buenos días.\n\nNo recibimos la planilla de guardias de ${period} de ${name}.\nPor favor enviarla a esta casilla (${MAIL_ACCOUNT}), de ser posible en Word, Excel o PDF y no como foto, para que se cargue sola.\n\nMuchas gracias.\nHospital Schestakow`;
  return `${MAIL_URL}&view=cm&fs=1&to=${encodeURIComponent(to.join(","))}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

// Pasados 45 minutos sin revisar el correo, la pantalla lo dice en vez de seguir mostrando "Actualizado".
const STALE_MS = 45 * 60_000;

const COLLAPSED_ROWS = 5; // una tarjeta larga muestra esto y el resto queda a un toque

/** Anillo de cobertura: servicios con guardia cargada sobre el total del bloque. */
function Ring({ done, total }: { done: number; total: number }) {
  const radius = 16, length = 2 * Math.PI * radius;
  const share = total ? done / total : 0;
  return (
    <span className="relative grid size-11 shrink-0 place-items-center">
      <svg viewBox="0 0 40 40" className="absolute inset-0 size-full -rotate-90" aria-hidden="true">
        <circle cx="20" cy="20" r={radius} fill="none" strokeWidth="3.5" className="stroke-primary-soft" />
        <circle cx="20" cy="20" r={radius} fill="none" strokeWidth="3.5" strokeLinecap="round" strokeDasharray={`${share * length} ${length}`} className="stroke-primary transition-[stroke-dasharray] duration-500" />
      </svg>
      <span className={cn("font-semibold tabular-nums leading-none", total >= 10 ? "text-[0.6rem]" : "text-[0.7rem]")}>{done}<span className="text-muted">/{total}</span></span>
    </span>
  );
}

function Home() {
  const tick = useCatalogTick();
  const [minute, setMinute] = useState(0);
  useEffect(() => { const id = setInterval(() => setMinute((n) => n + 1), 60_000); return () => clearInterval(id); }, []);
  const [updating, setUpdating] = useState(false);
  const today = todayISO();
  const [query, setQuery] = useState("");
  const [focus, setFocus] = useState<SectionId | "todos">("todos");
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [editing, setEditing] = useState<{ slug: string; draft: string; saving: boolean; error: boolean } | null>(null);
  const hour = currentHour();
  const active12: ShiftKind = hour >= 8 && hour < 20 ? "DAY_12" : "NIGHT_12";
  const isNow = (kind: ShiftKind) => kind === active12 || kind === "FULL_24";
  const duties = useMemo(() => dutiesOn(today).filter((duty) => duty.text.trim()), [today, tick]);
  const entries = useMemo<LiveDuty[]>(() => duties
    .flatMap((duty) => dutyLines(duty.text).map((line, index) => ({ ...duty, ...line, kind: classify(line.hours), key: `${duty.doc.id}-${index}-${line.name}` }))), [duties]);
  const needle = query.trim().toLocaleLowerCase("es");
  const visible = needle ? entries.filter((entry) => `${entry.name} ${entry.dept.name} ${entry.dept.short}`.toLocaleLowerCase("es").includes(needle)) : entries;
  const serviceGroups = useMemo(() => {
    const groups = new Map<string, ServiceGroup>();
    for (const entry of visible) {
      const group = groups.get(entry.dept.slug);
      if (group) group.entries.push(entry);
      else groups.set(entry.dept.slug, { slug: entry.dept.slug, name: entry.dept.name, section: sectionOf(entry.dept), docId: entry.doc.id, entries: [entry], blanks: 0, raw: entry.text, manual: entry.manual, photo: !entry.manual && entry.doc.flags.includes("foto") });
    }
    // Servicio sin planilla para hoy: queda en blanco, con los lugares que tenía la guardia anterior.
    for (const missing of missingDutiesOn(today)) {
      if (needle && !`${missing.dept.name} ${missing.dept.short}`.toLocaleLowerCase("es").includes(needle)) continue;
      groups.set(missing.dept.slug, { slug: missing.dept.slug, name: missing.dept.name, section: sectionOf(missing.dept), docId: null, entries: [], blanks: missing.slots, raw: "", photo: false });
    }
    for (const slug of ALWAYS_SHOWN) {
      const dept = DEPARTMENT_BY_SLUG[slug];
      if (!dept || groups.has(slug) || (needle && !`${dept.name} ${dept.short} ${GUARDIA_NAMES[slug] ?? ""}`.toLocaleLowerCase("es").includes(needle))) continue;
      groups.set(slug, { slug, name: dept.name, section: sectionOf(dept), docId: null, entries: [], blanks: 1, raw: "", photo: false });
    }
    for (const slug of HIDDEN) groups.delete(slug);
    for (const group of groups.values()) group.name = GUARDIA_NAMES[group.slug] ?? group.name;
    for (const group of groups.values()) group.entries.sort((a, b) => Number(isNow(b.kind)) - Number(isNow(a.kind)));
    return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name, "es"));
  }, [visible, today, needle, tick, active12]);
  const withSheet = serviceGroups.filter((group) => group.entries.length).length;
  const withoutSheet = serviceGroups.length - withSheet;
  const updatedAt = liveUpdatedAt();
  const claims = liveClaims();
  const stale = useMemo(() => { const at = updatedAt ? new Date(updatedAt).getTime() : NaN; return Number.isFinite(at) && Date.now() - at > STALE_MS; }, [updatedAt, minute, tick]);
  const blocks = SECTIONS.map((section) => {
    const groups = serviceGroups.filter((group) => group.section === section.id);
    return { ...section, groups, done: groups.filter((group) => group.entries.length).length, people: groups.reduce((sum, group) => sum + group.entries.length, 0) };
  }).filter((block) => block.groups.length);

  const startEdit = (group: ServiceGroup) => setEditing({ slug: group.slug, draft: group.raw.split(/\s*·\s*/).filter(Boolean).join("\n"), saving: false, error: false });
  const save = async (slug: string, text: string) => {
    setEditing((current) => current && { ...current, saving: true, error: false });
    const ok = await saveManualDuty(slug, today, text.split("\n").map((line) => line.trim()).filter(Boolean).join(" · "));
    setEditing((current) => ok ? null : current && { ...current, saving: false, error: true });
  };

  return (
    <div className="space-y-3">
      <section className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div className="min-w-0">
          <p className="text-base font-semibold first-letter:uppercase">{formatLongDate(today)}</p>
          <p className={cn("flex items-center gap-1.5 text-xs", stale ? "font-semibold text-warn" : "text-muted")} role={stale ? "status" : undefined}>
            <span className={cn("size-1.5 rounded-full", stale ? "bg-warn" : "bg-ok")} />{stale ? "Correo sin revisar desde " : "Correo revisado "}{updatedLabel()}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" disabled={updating} onClick={() => { setUpdating(true); void updateFromMail().finally(() => setUpdating(false)); }} className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-primary px-3.5 text-sm font-medium text-primary-fg disabled:opacity-60"><RefreshCw className={cn("size-4", updating && "animate-spin")} />{updating ? "Actualizando…" : "Actualizar"}</button>
          <a href={MAIL_URL} target="_blank" rel="noreferrer" aria-label="Ir al mail" className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-border bg-surface px-3 text-sm font-medium"><Mail className="size-4" /><span className="max-[380px]:hidden">Ir al mail</span></a>
        </div>
      </section>

      {/* Resumen por bloque: sirve de gráfico y de filtro. */}
      <nav aria-label="Bloques de servicios" className="grid grid-cols-3 gap-2 lg:grid-cols-6">
        {[{ id: "todos" as const, short: "Todos", done: withSheet, total: serviceGroups.length, missing: withoutSheet }, ...blocks.map((block) => ({ id: block.id, short: block.short, done: block.done, total: block.groups.length, missing: block.groups.length - block.done }))].map((tile) => {
          const selected = focus === tile.id;
          return (
            <button key={tile.id} type="button" onClick={() => setFocus(selected ? "todos" : tile.id)} aria-pressed={selected} className={cn("flex flex-col items-center gap-1 rounded-2xl border bg-surface px-1.5 py-2 text-center transition sm:flex-row sm:gap-2.5 sm:px-3 sm:text-left", selected ? "border-primary ring-2 ring-primary/20" : "border-transparent shadow-[var(--shadow-border)]")}>
              <Ring done={tile.done} total={tile.total} />
              <span className="min-w-0">
                <span className="block text-[0.8rem] font-semibold leading-tight sm:text-sm">{tile.short}</span>
                <span className={cn("block text-[0.7rem] leading-tight", tile.missing ? "text-warn" : "text-muted")}>{tile.missing ? `${tile.missing} sin planilla` : "completo"}</span>
              </span>
            </button>
          );
        })}
      </nav>

      <div className="hidden sm:block"><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar persona o servicio" aria-label="Buscar persona o servicio" autoComplete="off" /></div>

      {blocks.filter((block) => focus === "todos" || focus === block.id).map((block) => (
        <section key={block.id} aria-label={block.label}>
          <h2 className="mb-2 flex items-center gap-2 px-1 text-xs font-semibold uppercase tracking-wide text-muted">{block.label}<span className="h-px flex-1 bg-border" />{block.done < block.groups.length ? <span className="normal-case tracking-normal text-warn">{block.groups.length - block.done} sin planilla</span> : null}</h2>
          <div className="columns-1 gap-3 sm:columns-2 lg:columns-3 2xl:columns-4">
            {block.groups.map((group) => {
              const claim = group.blanks ? claims?.services[group.slug] : undefined;
              const to = claim?.to?.length ? claim.to : lastSenders(group.slug);
              const edit = editing?.slug === group.slug ? editing : null;
              const expanded = Boolean(open[group.slug]) || Boolean(needle);
              const rows = expanded ? group.entries : group.entries.slice(0, COLLAPSED_ROWS);
              const hidden = group.entries.length - rows.length;
              return (
                <article key={group.slug} className={cn("group/card mb-3 break-inside-avoid overflow-hidden rounded-2xl border bg-surface shadow-[var(--shadow-border)]", group.blanks ? "border-warn/50" : "border-transparent")}>
                  <header className="flex items-start justify-between gap-2 px-3 pt-2.5">
                    <div className="min-w-0">
                      <h3 className="text-[0.95rem] font-semibold leading-tight">
                        {group.docId && !group.manual ? <Link to="/archivo/$id" params={{ id: group.docId }} title="Ver la planilla de origen">{group.name}</Link> : group.name}
                      </h3>
                      {group.blanks ? (
                        <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs font-medium text-warn" aria-label={`Sin planilla de este mes; ${group.blanks} ${group.blanks === 1 ? "lugar" : "lugares"} sin dato`}>
                          Sin planilla
                          {Array.from({ length: Math.min(group.blanks, 6) }, (_, index) => <span key={index} className="h-1.5 w-5 rounded-full bg-warn/30" />)}
                        </p>
                      )
                        : group.manual ? <p className="mt-0.5 text-xs text-primary" title={`Por ${group.manual.by}`}>Editado a mano · {shortStamp(group.manual.at)}</p>
                        : group.photo ? <p className="mt-0.5 text-xs text-warn" title="Leída de una foto por IA: verificar contra la imagen">Leída de una foto · verificar</p> : null}
                    </div>
                    <span className="flex shrink-0 items-center gap-1">
                      {group.blanks && claim?.status !== "excluido" ? <a href={claimUrl(group.name, to, today)} target="_blank" rel="noreferrer" title={to.length ? `Reclamar a ${to.join(" y ")}` : "Reclamar: sin remitente conocido, completar el destinatario"} className="rounded-lg bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-fg">Reclamar</a> : null}
                      {!edit ? <button type="button" onClick={() => startEdit(group)} title="Editar quién está de guardia hoy" aria-label={`Editar guardia de ${group.name}`} className="grid size-8 place-items-center rounded-lg text-muted hover:bg-bg hover:text-fg"><Pencil className="size-4" /></button> : null}
                    </span>
                  </header>
                  {edit ? (
                    <div className="space-y-2 px-3 pb-3 pt-2">
                      <textarea value={edit.draft} onChange={(event) => setEditing({ ...edit, draft: event.target.value, error: false })} rows={Math.max(3, edit.draft.split("\n").length + 1)} autoFocus placeholder={"Una persona por renglón\nEj.: Pérez 08-20"} className="w-full resize-y rounded-xl border border-border bg-bg p-2 text-sm leading-snug outline-none focus:border-primary" aria-label={`Personas de guardia hoy en ${group.name}, una por renglón`} />
                      {edit.error ? <p className="text-xs font-medium text-danger" role="alert">No se pudo guardar. Revisá la conexión y probá de nuevo.</p> : null}
                      <div className="flex flex-wrap items-center gap-2">
                        <button type="button" disabled={edit.saving} onClick={() => void save(group.slug, edit.draft)} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-medium text-primary-fg disabled:opacity-60"><Check className="size-4" />{edit.saving ? "Guardando…" : "Guardar"}</button>
                        <button type="button" disabled={edit.saving} onClick={() => setEditing(null)} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-sm"><X className="size-4" />Cancelar</button>
                        {group.manual ? <button type="button" disabled={edit.saving} onClick={() => void save(group.slug, "")} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2 text-sm text-muted underline"><RotateCcw className="size-3.5" />Volver a la planilla</button> : null}
                      </div>
                    </div>
                  ) : (
                    <ul className={cn("px-3 pt-1.5", group.entries.length || (claim && (claim.status === "cancelado" || claims?.enabled)) ? "pb-2.5" : "pb-1.5")}>
                      {claim && (claim.status === "pendiente" || claim.status === "cancelado") ? (() => {
                        const cancelled = claim.status === "cancelado";
                        if (!cancelled && !claims?.enabled) return null; // apagado: no suma nada mostrarlo en cada tarjeta
                        const text = cancelled ? "Reclamo automático cancelado este mes"
                          : claim.lastSent ? `Reclamo automático: ${claim.sent} enviados, último ${shortStamp(claim.lastSent)}` : "Reclamo automático: todavía sin enviar";
                        return (
                          <li className="flex items-center justify-between gap-2 py-0.5 text-xs text-muted">
                            <span>{text}</span>
                            {claims?.enabled || cancelled ? <button type="button" onClick={() => void pauseClaim(group.slug, !cancelled)} className="shrink-0 font-medium text-primary underline">{cancelled ? "Reanudar" : "Cancelar"}</button> : null}
                          </li>
                        );
                      })() : null}
                      {rows.map((entry) => {
                        const now = isNow(entry.kind);
                        const later = entry.kind !== "UNKNOWN" && !now;
                        return (
                          <li key={entry.key} className={cn("flex items-center justify-between gap-2 py-[3px] text-sm leading-snug", later && "text-muted")}>
                            <span className={cn("min-w-0 break-words", now && "font-medium")}>{entry.name}</span>
                            {entry.hours ? <span className={cn("shrink-0 rounded-md px-1.5 py-0.5 text-[0.7rem] tabular-nums", now ? "bg-primary-soft font-semibold text-primary" : "bg-bg text-muted")}>{entry.hours}</span> : null}
                          </li>
                        );
                      })}
                      {hidden > 0 || (expanded && !needle && group.entries.length > COLLAPSED_ROWS) ? (
                        <li><button type="button" onClick={() => setOpen({ ...open, [group.slug]: !expanded })} className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-primary"><ChevronDown className={cn("size-3.5 transition", expanded && "rotate-180")} />{expanded ? "Ver menos" : `Ver ${hidden} más`}</button></li>
                      ) : null}
                    </ul>
                  )}
                </article>
              );
            })}
          </div>
        </section>
      ))}

      {!serviceGroups.length ? (
        <p className="rounded-xl border border-warn/40 bg-warn/10 p-3 text-sm text-muted" role="status">
          {query
            ? "No hay guardias que coincidan con la búsqueda."
            : `No hay guardias cargadas para ${formatLongDate(today)} en los cronogramas disponibles. Esto no significa que el servicio esté descubierto.`}
        </p>
      ) : null}

      <p className="px-1 text-xs text-muted">Según el último cronograma recibido por correo o lo editado a mano. No confirma presencia. En color, quien tiene turno en este momento.</p>

      <a href="?install=1" className="install-hint flex min-h-11 items-center gap-3 rounded-xl bg-primary-soft px-4 py-2 text-primary md:hidden">
        <Smartphone className="size-5 shrink-0" /><span className="text-sm font-medium">Agregar a la pantalla de inicio</span>
      </a>
    </div>
  );
}
