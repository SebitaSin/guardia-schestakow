import { createFileRoute, Link } from "@tanstack/react-router";
import { BedDouble, HeartPulse, Lock } from "lucide-react";
import { Bar, BarChart, ResponsiveContainer, XAxis, YAxis } from "recharts";
import { ParteInbox } from "@/components/parte-inbox";
import { ContinuidadStrip } from "@/components/continuidad-strip";
import {
  alertasActivas,
  barTone,
  estadisticaDias,
  formatParteFecha,
  ocupacionPorServicio,
  patologias,
  resumenHospital,
  PARTE_FECHA,
} from "@/data/internacion";
import { clinicalRank, dutiesOn, dutyLines, todayISO } from "@/data/catalog";
import { cn } from "@/lib/utils";
import { useParteTick } from "@/lib/use-parte";

export const Route = createFileRoute("/internados/")({ component: DashboardPage });

const CRITICAL_GUARDS = ["terapia-intensiva", "uccyq", "uco", "guardia-clinica", "pediatria", "neonatologia", "obstetricia", "cirugia"];

function hourNow() {
  const part = new Intl.DateTimeFormat("en-US", { timeZone: "America/Argentina/Mendoza", hour: "2-digit", hourCycle: "h23" }).formatToParts(new Date()).find((item) => item.type === "hour");
  return Number(part?.value ?? 0);
}

function activeHours(hours: string | null, hour: number) {
  const value = String(hours ?? "").replace(/\s/g, "").toLowerCase();
  if (value === "24h" || value === "08:00–08:00" || value === "08:00-08:00") return true;
  if (value === "08:00–20:00" || value === "08:00-20:00") return hour >= 8 && hour < 20;
  if (value === "20:00–08:00" || value === "20:00-08:00") return hour >= 20 || hour < 8;
  return false;
}

function DashboardPage() {
  useParteTick();
  const k = resumenHospital();
  const servicios = ocupacionPorServicio();
  const alertas = alertasActivas().slice(0, 6);
  const patho = patologias();
  const today = todayISO();
  const hour = hourNow();
  const dutyHits = dutiesOn(today).filter((duty) => duty.text.trim()).sort((a, b) => clinicalRank(a.dept.slug) - clinicalRank(b.dept.slug));
  const dutyRows = dutyHits.flatMap((duty) => dutyLines(duty.text).map((line) => ({ ...line, dept: duty.dept, doc: duty.doc })));
  const guardiasAhora = dutyRows.filter((row) => activeHours(row.hours, hour));
  const sinHorario = dutyRows.filter((row) => !row.hours).length;
  const activeServices = new Set(guardiasAhora.map((row) => row.dept.slug));
  const missingCritical = CRITICAL_GUARDS.filter((slug) => !activeServices.has(slug));
  const staleDays = Math.max(0, Math.floor((Date.parse(`${today}T12:00:00`) - Date.parse(`${PARTE_FECHA}T12:00:00`)) / 86_400_000));
  const fullServices = servicios.filter((service) => service.libres === 0 && service.total > 0);
  const highServices = servicios.filter((service) => service.pct >= 90 && service.libres > 0);

  const dias = estadisticaDias();
  const chartDias = dias.buckets.map((b) => ({ name: b.name, n: b.n }));
  const chartPatho = patho.counts.slice(0, 8);
  const analysisTone = staleDays > 1 || fullServices.length ? "danger" : highServices.length || missingCritical.length ? "warn" : "ok";
  const analysisTitle = staleDays > 1
    ? `Parte de camas desactualizado: ${staleDays} días`
    : fullServices.length
      ? `${fullServices.length} servicio(s) sin camas libres`
      : missingCritical.length
        ? "Faltan guardias identificables para la franja actual"
        : "Sin alertas operativas críticas por las reglas actuales";

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">Parte diario {formatParteFecha()} · Guardias de {today}</p>

      <ParteInbox />

      <ContinuidadStrip />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Kpi icon={BedDouble} label="Total camas" value={k.total} tone="blue" />
        <Kpi label="Ocupadas" value={k.ocupadas} hint={`${k.pct}%`} tone="green" />
        <Kpi label="Libres" value={k.libres} tone="orange" />
        <Kpi icon={Lock} label="Bloqueadas" value={k.bloqueadas} tone="purple" />
        <Kpi icon={HeartPulse} label="Críticos / ARM" value={k.criticos} tone="red" />
      </div>

      <section className={cn("rounded-2xl border p-4", analysisTone === "danger" && "border-danger/50 bg-danger/10", analysisTone === "warn" && "border-warn/50 bg-warn/10", analysisTone === "ok" && "border-ok/40 bg-ok/10")}>
        <p className="text-xs font-semibold uppercase tracking-wide">Análisis automático para la urgencia</p>
        <h2 className="mt-1 text-lg font-semibold">{analysisTitle}</h2>
        <ul className="mt-2 space-y-1 text-sm">
          {staleDays > 1 ? <li>• Confirmar un parte actualizado antes de usar ocupación o diagnósticos para decisiones operativas.</li> : null}
          {fullServices.length ? <li>• Sin camas libres: {fullServices.map((service) => service.name).join(", ")}.</li> : null}
          {highServices.length ? <li>• Ocupación igual o mayor al 90%: {highServices.map((service) => `${service.name} ${service.pct}%`).join(", ")}.</li> : null}
          {missingCritical.length ? <li>• Sin profesional confirmado por horario en servicios críticos: {missingCritical.join(", ")}.</li> : null}
          {sinHorario ? <li>• {sinHorario} asignación(es) tienen nombre pero no horario; no se presentan como guardia activa.</li> : null}
        </ul>
        <p className="mt-2 text-xs text-muted">Reglas deterministas y auditables. Es apoyo operativo; no recomienda conductas clínicas.</p>
      </section>

      <div className="grid gap-4 xl:grid-cols-2">
        <section className="rounded-2xl bg-surface p-4 shadow-[var(--shadow-border)]">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Ocupación por servicio</h2>
            <Link to="/internados/camas" className="text-sm font-medium text-primary">
              Ver camas
            </Link>
          </div>
          <ul className="space-y-2.5">
            {servicios.slice(0, 12).map((s) => (
              <li key={s.slug}>
                <Link to="/internados/$slug" params={{ slug: s.slug }} className="block">
                  <div className="flex items-baseline justify-between gap-2 text-sm">
                    <span className="font-medium">{s.name}</span>
                    <span className="tabular-nums text-muted">
                      {s.ocupadas} · {s.libres} · {s.ocupadas + s.libres}
                    </span>
                  </div>
                  <div className="mt-1 h-2 overflow-hidden rounded-full bg-border">
                    <div
                      className={cn(
                        "h-full rounded-full",
                        barTone(s.pct) === "danger" && "bg-danger",
                        barTone(s.pct) === "warn" && "bg-warn",
                        barTone(s.pct) === "ok" && "bg-ok",
                      )}
                      style={{ width: `${Math.min(100, s.pct)}%` }}
                    />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-2xl bg-surface p-4 shadow-[var(--shadow-border)]">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">Días de internación</h2>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartDias} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                <Bar dataKey="n" fill="#1d4ed8" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-2 text-xs text-muted">
            Desde hoy. Si el pizarrón trae FI, se usa esa fecha. Si no, se cuenta cada parte en el que aparece el
            nombre.
          </p>
        </section>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <section className="rounded-2xl bg-surface p-4 shadow-[var(--shadow-border)]">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Alertas</h2>
            <Link to="/internados/alertas" className="text-sm font-medium text-primary">
              Ver todas
            </Link>
          </div>
          <ul className="space-y-3">
            {alertas.map((a) => (
              <li key={a.title} className="flex gap-3">
                <span
                  className={cn(
                    "mt-1 size-2.5 shrink-0 rounded-full",
                    a.tone === "danger" && "bg-danger",
                    a.tone === "warn" && "bg-warn",
                    a.tone === "ok" && "bg-primary",
                  )}
                />
                <span>
                  <span className="block text-sm font-medium leading-tight">{a.title}</span>
                  <span className="block text-sm text-muted">{a.detail}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-2xl bg-surface p-4 shadow-[var(--shadow-border)]">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">De guardia en este momento</h2>
            <Link to="/" className="text-sm font-medium text-primary">
              Ver todas
            </Link>
          </div>
          {guardiasAhora.length ? (
            <ul className="space-y-2">
              {guardiasAhora.slice(0, 12).map((row, index) => (
                <li key={`${row.doc.id}-${row.name}-${index}`} className="rounded-xl bg-bg p-3">
                  <p className="font-medium">{row.name}</p>
                  <p className="text-sm text-muted">{row.dept.short} · {row.hours}</p>
                  <Link to="/archivo/$id" params={{ id: row.doc.id }} className="text-xs font-medium text-primary">Ver fuente</Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">No hay profesionales que puedan confirmarse para la franja actual con los horarios disponibles.</p>
          )}
        </section>

        <section className="rounded-2xl bg-surface p-4 shadow-[var(--shadow-border)]">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">
            Diagnósticos ({patho.total})
          </h2>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartPatho} layout="vertical" margin={{ top: 4, right: 8, left: 32, bottom: 4 }}>
                <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="label" width={110} tick={{ fontSize: 10 }} />
                <Bar dataKey="n" fill="#0f766e" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      </div>
    </div>
  );
}

function Kpi({
  label,
  value,
  hint,
  tone,
  icon: Icon,
}: {
  label: string;
  value: number;
  hint?: string;
  tone: "blue" | "green" | "orange" | "purple" | "red";
  icon?: typeof BedDouble;
}) {
  const color =
    tone === "blue"
      ? "text-kpi-blue"
      : tone === "green"
        ? "text-kpi-green"
        : tone === "orange"
          ? "text-kpi-orange"
          : tone === "purple"
            ? "text-kpi-purple"
            : "text-kpi-red";
  return (
    <div className="rounded-2xl bg-surface px-3 py-3 shadow-[var(--shadow-border)]">
      <p className={cn("text-xs font-semibold uppercase tracking-wide", color)}>{label}</p>
      <p className="mt-1 flex items-end gap-1 text-3xl font-semibold tabular-nums leading-none">
        {Icon ? <Icon className={cn("mb-0.5 size-5", color)} strokeWidth={1.75} /> : null}
        {value}
      </p>
      {hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
    </div>
  );
}
