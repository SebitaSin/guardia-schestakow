import { useCallback, useEffect, useState } from "react";
import { Check, ChevronDown, Copy, MapPinOff, Send, Share2, ShieldCheck, UserPlus, Users } from "lucide-react";
import { cn } from "@/lib/utils";

type Pendiente = { id: string; tipo: "cambio" | "nueva"; nombre: string; servicio: string; en: string; campos: string[]; actual: { address: string; phone: string; service: string } | null; propuesto: { address: string; phone: string; service: string } };
type Estado = {
  habilitado: boolean; enlacePublico?: string | null; total: number; respondieron: number; verificados: number; ultima: string | null;
  sinUbicar: { staffId: string; nombre: string; servicio: string }[];
  porServicio: { servicio: string; total: number; respondieron: number }[];
  ayuda: { clave: string; lugar: string; personas: { nombre: string; servicio: string; rol: string }[] }[]; soloSuServicio: number;
  pendientes: Pendiente[]; geocodeHoy: number; geocodeTope: number; mapaConfigurado: boolean;
};

async function call<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, { method: body ? "POST" : "GET", headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(String(response.status));
  return response.json() as Promise<T>;
}

const LOCAL = /^(localhost|127\.|192\.168\.|10\.|\[::1\])/;

/**
 * Enlace de autogestión: el personal carga sus datos desde el celular. Acá Dirección ve cuántos respondieron
 * y decide sobre los cambios que no se pudieron confirmar solos. Esta pantalla no envía ningún mensaje.
 */
export function AutogestionPanel({ onChange }: { onChange: () => void }) {
  const [open, setOpen] = useState(false);
  const [estado, setEstado] = useState<Estado | null>(null);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState("");
  const [copied, setCopied] = useState(false);
  const [allServices, setAllServices] = useState(false);
  const [area, setArea] = useState("");

  const load = useCallback(() => call<Estado>("/api/autogestion/estado").then((data) => { setEstado(data); setError(false); }).catch(() => setError(true)), []);
  useEffect(() => { void load(); }, [load]);

  const isLocal = typeof window !== "undefined" && LOCAL.test(window.location.hostname);
  const link = isLocal && estado?.enlacePublico ? estado.enlacePublico : typeof window === "undefined" ? "" : `${window.location.origin}/mis-datos`;
  const local = isLocal && !estado?.enlacePublico;
  const text = `🏥 Hospital Schestakow: estamos actualizando los datos del personal para organizar traslados si hay una tormenta grave u otra emergencia. Es 1 minuto desde el celular, sólo con tu DNI:\n${link}\n\nPor favor reenvialo a tus grupos de trabajo del hospital, así llega a todos. Si te llega repetido no pasa nada: se responde una sola vez.`;

  async function resolve(id: string, accion: "aceptar" | "descartar") {
    setBusy(id);
    try { setEstado(await call<Estado>("/api/autogestion/resolver", { id, accion })); if (accion === "aceptar") onChange(); }
    catch { setError(true); }
    finally { setBusy(""); }
  }

  if (error && !estado) return <section className="rounded-2xl bg-surface p-3 text-sm text-muted shadow-[var(--shadow-border)]">Enlace para el personal: todavía no disponible. Hace falta reiniciar el servidor para activarlo.</section>;
  if (!estado) return null;
  const pct = estado.total ? Math.round((100 * estado.respondieron) / estado.total) : 0;
  const services = [...estado.porServicio].sort((a, b) => (b.total - b.respondieron) - (a.total - a.respondieron));
  const shown = allServices ? services : services.slice(0, 8);

  return (
    <section className="rounded-2xl bg-surface shadow-[var(--shadow-border)]">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full items-center gap-3 p-3 text-left">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary"><Share2 className="size-5" /></span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">Enlace para que el personal cargue sus datos</span>
          <span className="block text-xs text-muted">Respondieron {estado.respondieron} de {estado.total}{estado.pendientes.length ? ` · ${estado.pendientes.length} para revisar` : ""}{estado.ultima ? ` · última ${new Date(estado.ultima).toLocaleString("es-AR", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" })}` : ""}</span>
        </span>
        {estado.pendientes.length ? <span className="rounded-full bg-warn-soft px-2 py-0.5 text-xs font-semibold text-warn">{estado.pendientes.length}</span> : null}
        <ChevronDown className={cn("size-4 shrink-0 text-muted transition", open && "rotate-180")} />
      </button>
      {open ? (
        <div className="space-y-3 border-t border-border p-3">
          {!estado.habilitado ? <p className="rounded-xl border border-warn/40 bg-warn-soft p-3 text-sm">El enlace está apagado en la configuración del servidor.</p> : null}
          {local ? <p className="rounded-xl border border-warn/40 bg-warn-soft p-3 text-sm">Estás abriendo la app desde esta PC: este enlace todavía no abre en los celulares del personal. Para tener uno que abra en los celulares, hacé doble clic en ENLACE-PERSONAL en la carpeta de la app y volvé a abrir esta pantalla.</p> : null}
          {isLocal && estado.enlacePublico ? <p className="text-xs text-muted">Este es el último enlace que abrió ENLACE-PERSONAL. Sólo funciona mientras esa ventana siga abierta en esta PC; si la cerraste, abrila de nuevo y usá el enlace nuevo.</p> : null}
          <div className="flex flex-wrap items-center gap-2 rounded-xl bg-bg p-2.5">
            <code className="min-w-0 flex-1 truncate text-sm">{link}</code>
            <button type="button" onClick={() => { void navigator.clipboard?.writeText(link).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }); }} className="inline-flex items-center gap-1.5 rounded-lg bg-surface px-3 py-2 text-sm font-medium shadow-[var(--shadow-border)]">{copied ? <Check className="size-4 text-ok" /> : <Copy className="size-4" />}{copied ? "Copiado" : "Copiar"}</button>
            <a href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-white"><Send className="size-4" />Abrir WhatsApp para elegir grupos</a>
          </div>
          <p className="text-xs text-muted">La app no envía nada: se abre tu WhatsApp con el texto listo y vos elegís a qué grupos mandarlo. Cada persona entra con su DNI; si responde dos veces, se reemplaza.</p>

          <div>
            <div className="h-2.5 overflow-hidden rounded-full bg-bg"><div className="h-full rounded-full bg-ok transition-all" style={{ width: `${pct}%` }} /></div>
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                { icon: Users, value: estado.respondieron, label: `Respondieron (${pct}%)`, tone: "text-fg" },
                { icon: ShieldCheck, value: estado.verificados, label: "Confirmaron con su celular", tone: "text-ok" },
                { icon: UserPlus, value: estado.pendientes.length, label: "Para revisar", tone: estado.pendientes.length ? "text-warn" : "text-muted" },
                { icon: MapPinOff, value: estado.sinUbicar.length, label: "Respondieron, sin ubicar en el mapa", tone: estado.sinUbicar.length ? "text-warn" : "text-muted" },
              ].map((tile) => (
                <div key={tile.label} className="rounded-xl bg-bg p-2.5">
                  <tile.icon className={cn("size-4", tile.tone)} />
                  <p className={cn("mt-1 text-xl font-semibold leading-none tabular-nums", tile.tone)}>{tile.value}</p>
                  <p className="mt-1 text-[0.7rem] leading-tight text-muted">{tile.label}</p>
                </div>
              ))}
            </div>
          </div>

          {estado.pendientes.length ? (
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Para revisar: no se pudo confirmar que sea la persona</h3>
              <ul className="mt-1.5 grid gap-2 lg:grid-cols-2">
                {estado.pendientes.map((item) => (
                  <li key={item.id} className="rounded-xl border border-warn/40 bg-warn-soft/50 p-2.5 text-sm">
                    <p className="font-semibold">{item.nombre || "Sin nombre"} <span className="font-normal text-muted">· {item.servicio || "sin servicio"}</span></p>
                    {item.tipo === "nueva" ? <p className="mt-1 text-xs text-warn">No figura en la nómina. Dice trabajar en ese servicio.</p> : null}
                    <dl className="mt-1.5 space-y-1 text-xs">
                      {(item.tipo === "nueva" || item.campos.includes("address")) ? <div><dt className="inline text-muted">Domicilio: </dt><dd className="inline">{item.actual ? <><s className="text-muted">{item.actual.address || "sin dato"}</s> → </> : null}<b>{item.propuesto.address}</b></dd></div> : null}
                      {(item.tipo === "nueva" || item.campos.includes("phone")) ? <div><dt className="inline text-muted">Celular: </dt><dd className="inline">{item.actual ? <><s className="text-muted">{item.actual.phone || "sin dato"}</s> → </> : null}<b>{item.propuesto.phone}</b></dd></div> : null}
                      {item.campos.includes("service") ? <div><dt className="inline text-muted">Servicio: </dt><dd className="inline"><s className="text-muted">{item.actual?.service || "sin dato"}</s> → <b>{item.propuesto.service}</b></dd></div> : null}
                    </dl>
                    <div className="mt-2 flex gap-2">
                      <button type="button" disabled={busy === item.id} onClick={() => void resolve(item.id, "aceptar")} className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">{item.tipo === "nueva" ? "Sumar a la nómina" : "Aceptar el cambio"}</button>
                      <button type="button" disabled={busy === item.id} onClick={() => void resolve(item.id, "descartar")} className="rounded-lg bg-surface px-3 py-1.5 text-xs font-medium shadow-[var(--shadow-border)] disabled:opacity-50">Descartar</button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {estado.sinUbicar.length ? (
            <p className="text-xs text-muted"><b className="font-semibold text-fg">Sin ubicar en el mapa:</b> {estado.sinUbicar.slice(0, 12).map((item) => item.nombre).join(", ")}{estado.sinUbicar.length > 12 ? ` y ${estado.sinUbicar.length - 12} más` : ""}. Buscalos en la lista de abajo y verificá el domicilio; su respuesta sobre el traslado se aplica sola al ubicarlos.{estado.mapaConfigurado ? ` Ubicaciones automáticas de hoy: ${estado.geocodeHoy} de ${estado.geocodeTope}.` : ""}</p>
          ) : null}

          {estado.respondieron ? (
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">En una catástrofe se ofrecen a ayudar fuera de su servicio</h3>
              <p className="mt-0.5 text-xs text-muted">Es lo que cada persona declaró; nadie está asignado ni avisado. {estado.soloSuServicio} {estado.soloSuServicio === 1 ? "prefiere" : "prefieren"} quedarse sólo en su servicio.</p>
              <ul className="mt-1.5 grid gap-1.5 sm:grid-cols-2">
                {estado.ayuda.map((row) => (
                  <li key={row.clave} className="rounded-xl bg-bg text-sm">
                    <button type="button" disabled={!row.personas.length} onClick={() => setArea(area === row.clave ? "" : row.clave)} className="flex w-full items-center gap-2 px-2.5 py-2 text-left">
                      <span className={cn("w-7 shrink-0 text-right text-base font-semibold tabular-nums", row.personas.length ? "text-primary" : "text-muted")}>{row.personas.length}</span>
                      <span className="min-w-0 flex-1 leading-tight">{row.lugar}</span>
                      {row.personas.length ? <ChevronDown className={cn("size-4 shrink-0 text-muted transition", area === row.clave && "rotate-180")} /> : null}
                    </button>
                    {area === row.clave ? <ul className="space-y-0.5 border-t border-border px-2.5 py-2 text-xs">{row.personas.map((person, index) => <li key={index}><b className="font-medium">{person.nombre}</b> <span className="text-muted">· {person.rol || "sin cargo cargado"} · {person.servicio}</span></li>)}</ul> : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Servicios a los que más les falta responder</h3>
            <ul className="mt-1.5 grid gap-x-4 gap-y-1.5 sm:grid-cols-2">
              {shown.map((row) => (
                <li key={row.servicio} className="text-xs">
                  <div className="flex justify-between gap-2"><span className="truncate">{row.servicio}</span><span className="shrink-0 tabular-nums text-muted">{row.respondieron} de {row.total}</span></div>
                  <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-bg"><div className="h-full rounded-full bg-primary" style={{ width: `${row.total ? (100 * row.respondieron) / row.total : 0}%` }} /></div>
                </li>
              ))}
            </ul>
            {services.length > 8 ? <button type="button" onClick={() => setAllServices(!allServices)} className="mt-2 text-xs font-medium text-primary">{allServices ? "Ver menos" : `Ver los ${services.length} servicios`}</button> : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
