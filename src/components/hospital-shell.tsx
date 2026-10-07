import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  BedDouble,
  CalendarDays,
  Hospital,
  LayoutGrid,
  Menu,
  LogOut,
  Search,
  Shield,
  UserRound,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { ContinuidadChip } from "@/components/continuidad-strip";
import { allDocuments, dutiesOn, todayISO } from "@/data/catalog";
import { BEDS, formatParteFecha, resumenHospital, searchBeds } from "@/data/internacion";
import { fold, personId, staffFor } from "@/data/staff";
import { DEPARTMENTS } from "@/data/departments";
import { matchesDutyQuery } from "@/lib/duty-query";
import { cn } from "@/lib/utils";

const SIDE = [
  { to: "/", label: "Guardias de hoy", icon: CalendarDays, match: "guardias" },
  { to: "/internados/camas", label: "Servicios, camas y pacientes", icon: BedDouble, match: "camas" },
  { to: "/plantel", label: "Personal", icon: UserRound, match: "plantel" },
  { to: "/continuidad", label: "Contingencia", icon: Shield, match: "continuidad" },
  { to: "/complementos", label: "Complementos", icon: LayoutGrid, match: "complementos" },
] as const;

// Pantallas que viven dentro de Complementos: el menú las marca ahí y ofrecen volver.
const COMPLEMENTOS = ["captura", "archivo", "cambios", "alertas", "dashboard", "comunicaciones"];

function which(pathname: string) {
  if (pathname.startsWith("/personal-mapa")) return "plantel";
  if (pathname.startsWith("/continuidad")) return "continuidad";
  if (pathname.startsWith("/complementos")) return "complementos";
  if (pathname.startsWith("/internados/captura")) return "captura";
  if (pathname.startsWith("/comunicaciones")) return "comunicaciones";
  if (pathname.startsWith("/internados/pacientes")) return "pacientes";
  if (pathname.startsWith("/internados/alertas")) return "alertas";
  if (pathname.startsWith("/internados/camas")) return "camas";
  if (pathname.startsWith("/internados/") && pathname !== "/internados") return "camas";
  if (pathname === "/internados" || pathname === "/internados/") return "dashboard";
  if (pathname === "/") return "guardias";
  if (pathname.startsWith("/servicios")) return "servicios";
  if (pathname.startsWith("/plantel")) return "plantel";
  if (pathname.startsWith("/cambios")) return "cambios";
  if (pathname.startsWith("/archivo")) return "archivo";
  return "";
}

function titleFor(key: string) {
  if (key === "complementos") return { h: "Complementos", s: "Fotos, archivo, cambios, alertas y mensajes" };
  if (key === "dashboard") return { h: "Resumen del hospital", s: "Ocupación y días de internación" };
  if (key === "guardias") return { h: "Guardias de hoy", s: "08–20 · 20–08 · 24 horas" };
  if (key === "servicios") return { h: "Servicios", s: "Cronogramas por servicio" };
  if (key === "camas") return { h: "Servicios", s: "Camas y pacientes de cada servicio" };
  if (key === "pacientes") return { h: "Pacientes", s: "Internados del parte diario" };
  if (key === "alertas") return { h: "Alertas", s: "Ocupación y lecturas a revisar" };
  if (key === "continuidad") return { h: "Contingencia", s: "Clima, alertas y mapa" };
  if (key === "captura") return { h: "Fotos de pizarras", s: "Lo que llega por WhatsApp y dónde se publicó" };
  if (key === "comunicaciones") return { h: "Comunicaciones", s: "Mensajes de WhatsApp a contactos y grupos" };
  if (key === "plantel") return { h: "Personal", s: "Plantel, transporte y mapa privado" };
  if (key === "cambios") return { h: "Cambios", s: "Permutas de cronograma por mail o a mano" };
  if (key === "archivo") return { h: "Archivo", s: "Cronogramas recibidos" };
  return { h: "Hospital Schestakow", s: "" };
}

export function HospitalShell({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const key = which(pathname);
  const titles = titleFor(key);
  const k = resumenHospital();
  const [parteDay, parteMonth, parteYear] = formatParteFecha().slice(0, 10).split("/").map(Number);
  const parteFresh = Date.now() - new Date(parteYear, parteMonth - 1, parteDay).getTime() < 14 * 86_400_000;

  const hits = useMemo(() => {
    const n = q.trim();
    if (n.length < 2) {
      return {
        beds: [] as ReturnType<typeof searchBeds>,
        docs: [] as ReturnType<typeof allDocuments>,
        people: [] as { id: string; name: string; service: string }[],
      };
    }
    const needle = fold(n);
    const people: { id: string; name: string; service: string }[] = [];
    for (const d of DEPARTMENTS) {
      for (const p of staffFor(d.slug)) {
        if (fold(p.name).includes(needle) || fold(p.surname).includes(needle)) {
          people.push({ id: personId(d.slug, p.surname), name: p.name, service: d.short });
        }
      }
    }
    const unique = people.filter((p, i, arr) => arr.findIndex((x) => x.id === p.id) === i).slice(0, 6);
    return {
      beds: searchBeds(n).filter((b) => b.estado === "OCUPADA").slice(0, 6),
      docs: allDocuments().filter((d) => matchesDutyQuery(n, d)).slice(0, 6),
      people: unique,
    };
  }, [q]);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  const nav = (
    <nav className="flex flex-1 flex-col gap-1 p-3">
      {SIDE.map((item) => {
        const active = key === item.match || (item.match === "complementos" && COMPLEMENTOS.includes(key)) || (item.match === "camas" && key === "servicios");
        return (
          <Link
            key={item.to}
            to={item.to}
            className={cn(
              "flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium",
              active ? "bg-primary text-primary-fg" : "text-nav-muted hover:bg-white/5 hover:text-nav-fg",
            )}
          >
            <item.icon className="size-4 shrink-0" strokeWidth={1.75} />
            {item.label}
          </Link>
        );
      })}
      <div className="mt-auto space-y-2 pt-6">
        <form method="post" action="/api/logout">
          <button type="submit" className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-sm text-nav-muted hover:text-nav-fg">
            <LogOut className="size-4" strokeWidth={1.75} />
            Cerrar sesión
          </button>
        </form>
        <p className="px-3 text-xs text-nav-muted">
          {typeof window !== "undefined" ? window.location.host : ""} · Parte {formatParteFecha()}
        </p>
      </div>
    </nav>
  );

  return (
    <div className="flex min-h-dvh bg-bg text-fg">
      <aside className="hidden w-56 shrink-0 flex-col bg-nav text-nav-fg md:flex">
        <div className="flex items-center gap-2.5 px-4 py-5">
          <span className="flex size-9 items-center justify-center rounded-md bg-primary text-primary-fg">
            <Hospital className="size-5" strokeWidth={1.75} />
          </span>
          <span>
            <span className="block text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-nav-muted">
              Hospital
            </span>
            <span className="block text-sm font-semibold leading-tight">Schestakow</span>
          </span>
        </div>
        {nav}
      </aside>

      {open ? (
        <div className="fixed inset-0 z-40 md:hidden">
          <button type="button" className="absolute inset-0 bg-black/40" aria-label="Cerrar menú" onClick={() => setOpen(false)} />
          <aside className="relative flex h-full w-64 flex-col bg-nav text-nav-fg">
            <div className="flex items-center justify-between px-4 py-4">
              <span className="font-semibold">Schestakow</span>
              <button type="button" className="flex size-10 items-center justify-center" onClick={() => setOpen(false)}>
                <X className="size-5" />
              </button>
            </div>
            {nav}
          </aside>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 border-b border-border bg-surface pt-safe-t">
          <div className="flex flex-wrap items-center gap-3 px-4 py-3">
            <button
              type="button"
              className="flex size-10 items-center justify-center rounded-lg md:hidden"
              onClick={() => setOpen(true)}
            >
              <Menu className="size-5" />
            </button>
            <div className="min-w-0 flex-1">
              {COMPLEMENTOS.includes(key) ? <Link to="/complementos" className="block text-xs font-medium text-primary">← Complementos</Link> : null}
              <h1 className="truncate text-lg font-semibold leading-tight">{titles.h}</h1>
              <p className="truncate text-sm text-muted">{titles.s}</p>
            </div>
            {key !== "continuidad" ? <ContinuidadChip /> : null}
            <div className="relative w-full md:w-80">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Buscar paciente, cama, médico…"
                className="pl-9"
                autoComplete="off"
              />
              {q.trim().length >= 2 ? (
                <div className="absolute z-40 mt-1 max-h-80 w-full overflow-auto rounded-xl bg-surface p-2 shadow-[var(--shadow-border-hover)]">
                  {hits.people.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      className="block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-primary-soft"
                      onClick={() => {
                        setQ("");
                        void navigate({ to: "/ficha/$id", params: { id: p.id } });
                      }}
                    >
                      <span className="font-medium">{p.name}</span>
                      <span className="block text-muted">Ficha · {p.service}</span>
                    </button>
                  ))}
                  {hits.beds.map((b) => (
                    <button
                      key={`${b.slug}-${b.cama}`}
                      type="button"
                      className="block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-primary-soft"
                      onClick={() => {
                        setQ("");
                        void navigate({ to: "/internados/$slug", params: { slug: b.slug } });
                      }}
                    >
                      <span className="font-medium">{b.paciente}</span>
                      <span className="block text-muted">
                        {b.servicio} · {b.cama}
                      </span>
                    </button>
                  ))}
                  {hits.docs.map((d) => (
                    <button
                      key={d.id}
                      type="button"
                      className="block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-primary-soft"
                      onClick={() => {
                        setQ("");
                        void navigate({ to: "/archivo/$id", params: { id: d.id } });
                      }}
                    >
                      <span className="font-medium">{d.title}</span>
                      <span className="block text-muted">Guardia / cronograma</span>
                    </button>
                  ))}
                  {!hits.beds.length && !hits.docs.length && !hits.people.length ? (
                    <p className="px-3 py-2 text-sm text-muted">Sin coincidencias</p>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
        </header>

        <main className="min-w-0 flex-1 overflow-x-clip px-4 py-4 pb-24 md:px-6 md:py-6"><AlertBar />{children}</main>

{/* El resumen de camas sólo se muestra si el parte tiene menos de dos semanas: un parte viejo no es dato vigente. */}
        {parteFresh ? (
        <footer className="fixed inset-x-0 bottom-0 z-20 flex flex-wrap gap-x-5 gap-y-1 bg-nav px-4 py-2 pb-safe-b text-xs text-nav-fg md:left-56">
          <span>{k.libres} camas libres</span>
          <span>{k.aislamiento} aislamiento</span>
          <span>{k.arm} ARM</span>
          <span>{k.postqx} postquirúrgicos</span>
          <span className="md:ml-auto">{BEDS.length} camas en el parte · {formatParteFecha()}</span>
        </footer>
        ) : null}
      </div>
    </div>
  );
}

/** Barra que aparece en todas las pantallas cuando el nivel de alerta de Contingencia no es verde. */
const ALERT_BAR = {
  amarillo: { box: "border-warn/40 bg-warn-soft text-fg", dot: "bg-[#d97706]", name: "Alerta amarilla" },
  naranja: { box: "border-kpi-orange/50 bg-[#ffedd5] text-fg", dot: "bg-kpi-orange", name: "Alerta naranja" },
  rojo: { box: "border-danger/50 bg-danger-soft text-fg", dot: "bg-danger", name: "Alerta roja" },
} as const;

function AlertBar() {
  const [level, setLevel] = useState<{ color: string; grado?: number; nombre?: string; motivos: { origen: string; texto: string }[] } | null>(null);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const response = await fetch("/api/clima/nivel", { signal: AbortSignal.timeout(30_000) });
        if (!response.ok) return;
        const data = (await response.json()) as { nivel: { color: string; grado?: number; nombre?: string; motivos: { origen: string; texto: string }[] } | null };
        if (alive) setLevel(data.nivel);
      } catch { /* sin dato: no se muestra nada */ }
    };
    void load();
    const timer = window.setInterval(load, 5 * 60_000);
    return () => { alive = false; window.clearInterval(timer); };
  }, []);
  const style = level ? ALERT_BAR[level.color as keyof typeof ALERT_BAR] : undefined;
  if (!level || !style) return null;
  return (
    <a href="/continuidad" className={`mb-3 flex items-center gap-2.5 rounded-xl border px-3 py-2 text-sm ${style.box}`} role="status">
      <span className={`size-2.5 shrink-0 rounded-full ${style.dot}`} />
      <span className="min-w-0"><b className="font-semibold">{level.grado ? `Alerta grado ${level.grado} de 9 · ${level.nombre}` : style.name}.</b> {level.motivos.slice(0, 2).map((reason) => `${reason.origen}: ${reason.texto}`).join(" · ")}</span>
      <span className="ml-auto shrink-0 text-xs font-medium underline">Ver</span>
    </a>
  );
}

