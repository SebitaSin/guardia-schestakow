import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { AlertTriangle, Camera, Cloud, CloudDrizzle, CloudFog, CloudLightning, CloudSnow, CloudSun, ExternalLink, Radar, CloudRain, Minus, Pause, Play, Plus, Radio, ShieldCheck, Snowflake, Sparkles, Sun, Thermometer, Wind } from "lucide-react";
import { cn } from "@/lib/utils";

/* ----------------------------- datos del servidor ----------------------------- */
type Nivel = "amarillo" | "naranja" | "rojo";
type Oficial = { evento: string; nivel: Nivel; desde: string; hasta: string; emitido: string; descripcion: string; instrucciones: string; alcance: "LOCAL" | "REGIONAL"; distancia_km: number; poligonos: [number, number][][]; url: string };
type Calculada = { tipo: string; titulo: string; nivel: Nivel; desde: string; hasta: string; detalle: string };
type Hora = { t: string; temp: number | null; rh: number | null; rain: number | null; prob: number | null; gust: number | null; cape: number | null; frz: number | null };
type Dia = { fecha: string; code: number | null; tmax: number | null; tmin: number | null; lluvia: number | null; prob: number | null; rafaga: number | null; dir: number | null; acuerdo: "alto" | "medio" | "bajo" | null; otros: { nombre: string; lluvia: number | null; tmax: number | null }[] };
type Extendido = { modelo: string; comparados: string[]; dias: Dia[]; horas: { t: string; temp: number | null; rain: number | null; prob: number | null; gust: number | null; code: number | null }[] };
type Fuente<T> = { ok: boolean; en: string | null; datos: T | null; error?: string };
type Clima = {
  en: string; lugar: { lat: number; lon: number; nombre: string };
  oficial: Fuente<{ alertas: Oficial[]; avisos_en_el_pais: number; leidos: number }>;
  pronostico: Fuente<{ actual: { t: string | null; temp: number | null; rh: number | null; viento: number | null; rafaga: number | null; dir: number | null; lluvia: number | null; code: number | null }; horas: Hora[]; alertas: Calculada[]; extendido?: Extendido | null }>;
  enso: Fuente<{ oni: number | null; trimestre: string | null; nombre: string | null; semana: string | null; nino34: number | null }>;
  radar?: Fuente<{ imagen: string | null; vigente: boolean; lectura: { ciudad_dbz: number; cerca_dbz: number; region_dbz: number; celda: { km: number; dbz: number; rumbo: string } | null }; alertas: Calculada[] }>;
  sismos?: Fuente<{ lista: { en: string; lat: number; lon: number; mg: number; prof: number | null; prov: string; sentido: boolean; km: number }[]; alertas: Calculada[] }>;
  hidro?: Fuente<{ rios: { rio: string; nombre: string; donde: string; km: number; lectura: { t: string; m: number; hace_h: number; cambio_6h: number | null; cambio_24h: number | null; min7: number; max7: number; tendencia: "sube" | "baja" | "estable"; rapido: boolean } | null }[]; lluvia: { nombre: string; km: number; lectura: { t: string; hace_h: number; mm_3h: number; mm_24h: number; descartados: number } | null }[]; alertas: Calculada[] }>;
  cambios?: { en: string; de: string; a: string; motivos: { origen: string; texto: string }[] }[];
  nivel?: { color: Nivel | "verde"; grado?: number; nombre?: string; accion?: string; escala?: { grado: number; nombre: string; accion: string }[]; motivos: { nivel: Nivel | "verde"; grado?: number; origen: string; texto: string }[]; incompleto: boolean };
  parte: { texto: string | null; en: string; modelo?: string } | null;
};

const TZ = "America/Argentina/Mendoza";
const NIVEL_STYLE: Record<Nivel, { card: string; chip: string; fill: string; label: string }> = {
  amarillo: { card: "border-warn/40 bg-warn-soft", chip: "bg-warn text-white", fill: "#d97706", label: "Amarillo" },
  naranja: { card: "border-kpi-orange/50 bg-[#ffedd5]", chip: "bg-kpi-orange text-white", fill: "#c2410c", label: "Naranja" },
  rojo: { card: "border-danger/50 bg-danger-soft", chip: "bg-danger text-white", fill: "#b91c1c", label: "Rojo" },
};
const LEVEL_STYLE: Record<Nivel | "verde", { card: string; dot: string; label: string }> = {
  verde: { card: "border-ok/30 bg-ok-soft", dot: "bg-ok", label: "Verde · sin alertas" },
  amarillo: { card: NIVEL_STYLE.amarillo.card, dot: "bg-[#d97706]", label: "Amarillo · atención" },
  naranja: { card: NIVEL_STYLE.naranja.card, dot: "bg-kpi-orange", label: "Naranja · prepararse" },
  rojo: { card: NIVEL_STYLE.rojo.card, dot: "bg-danger", label: "Rojo · actuar" },
};
const when = (iso: string | null) => {
  if (!iso) return "—";
  const date = new Date(/[zZ]|[+-]\d\d:\d\d$/.test(iso) ? iso : `${iso}:00-03:00`);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("es-AR", { timeZone: TZ, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date).replace(",", "");
};
const hhmm = (iso: string | null) => (iso ? new Intl.DateTimeFormat("es-AR", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso)) : "—");
const round = (value: number | null | undefined, unit = "") => (value == null || Number.isNaN(value) ? "—" : `${Math.round(value)}${unit}`);
const compass = (deg: number | null) => (deg == null ? "" : ["N", "NE", "E", "SE", "S", "SO", "O", "NO"][Math.round(deg / 45) % 8]);

function iconFor(text: string) {
  const t = text.toLowerCase();
  if (/zonda|viento/.test(t)) return Wind;
  if (/granizo|tormenta/.test(t)) return CloudLightning;
  if (/lluvia|inund|aluvi/.test(t)) return CloudRain;
  if (/nev|helada|fr[ií]o/.test(t)) return Snowflake;
  if (/calor|temperatura/.test(t)) return Thermometer;
  return AlertTriangle;
}

function useClima() {
  const [data, setData] = useState<Clima | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const response = await fetch("/api/clima", { signal: AbortSignal.timeout(60_000) });
        if (!response.ok) throw new Error(String(response.status));
        const next = (await response.json()) as Clima;
        if (alive) { setData(next); setFailed(false); }
      } catch { if (alive) setFailed(true); }
    };
    void load();
    const timer = window.setInterval(load, 5 * 60_000);
    return () => { alive = false; window.clearInterval(timer); };
  }, []);
  return { data, failed };
}

/* ------------------------------ mapa satelital ------------------------------ */
const LAYERS = [
  { id: "GOES-East_ABI_GeoColor", label: "Color real", tms: "GoogleMapsCompatible_Level7", max: 7, hint: "Como se ve desde el espacio. De noche, nubes en infrarrojo." },
  { id: "GOES-East_ABI_Band13_Clean_Infrared", label: "Infrarrojo", tms: "GoogleMapsCompatible_Level6", max: 6, hint: "Topes nubosos fríos: cuanto más intenso el color, más alta y activa la tormenta." },
  { id: "GOES-East_ABI_Air_Mass", label: "Masas de aire", tms: "GoogleMapsCompatible_Level6", max: 6, hint: "Aire seco en altura (tonos rojizos): útil para seguir el Zonda y los frentes." },
] as const;
const CITIES: [string, number, number][] = [["Mendoza", -32.889, -68.845], ["Malargüe", -35.475, -69.585], ["Gral. Alvear", -34.977, -67.691], ["San Luis", -33.295, -66.336], ["Santiago", -33.45, -70.667], ["San Juan", -31.537, -68.536], ["Neuquén", -38.951, -68.059]];
const STEP_MS = 10 * 60_000;
const FRAMES = 12; // dos horas de imágenes, una cada 10 minutos
const project = (lat: number, lon: number, z: number) => {
  const scale = 256 * 2 ** z, phi = (lat * Math.PI) / 180;
  return { x: ((lon + 180) / 360) * scale, y: ((1 - Math.log(Math.tan(phi) + 1 / Math.cos(phi)) / Math.PI) / 2) * scale };
};
const unproject = (x: number, y: number, z: number) => {
  const scale = 256 * 2 ** z, n = Math.PI - (2 * Math.PI * y) / scale;
  return { lat: (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))), lon: (x / scale) * 360 - 180 };
};
const stamp = (ms: number) => `${new Date(ms).toISOString().slice(0, 19)}Z`;
const tileUrl = (layer: (typeof LAYERS)[number], time: string, z: number, x: number, y: number) => `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${layer.id}/default/${time}/${layer.tms}/${z}/${y}/${x}.png`;

function SatelliteMap({ hospital, alerts }: { hospital: { lat: number; lon: number }; alerts: Oficial[] }) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [layerId, setLayerId] = useState<(typeof LAYERS)[number]["id"]>(LAYERS[0].id);
  const layer = LAYERS.find((item) => item.id === layerId) ?? LAYERS[0];
  const [zoom, setZoom] = useState(6);
  const z = Math.min(zoom, layer.max);
  const [center, setCenter] = useState(hospital);
  const [latest, setLatest] = useState<number | null>(null);
  const [searching, setSearching] = useState(true);
  const [index, setIndex] = useState(FRAMES - 1);
  const [playing, setPlaying] = useState(false);
  const [animated, setAnimated] = useState(false); // recién al reproducir se cargan todas las imágenes
  const drag = useRef<{ x: number; y: number; cx: number; cy: number } | null>(null);

  useEffect(() => {
    const element = box.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setSize({ w: element.clientWidth, h: element.clientHeight }));
    observer.observe(element);
    setSize({ w: element.clientWidth, h: element.clientHeight });
    return () => observer.disconnect();
  }, []);

  // Última imagen disponible: se prueba de la más nueva hacia atrás hasta que una exista.
  useEffect(() => {
    let alive = true;
    setSearching(true); setLatest(null);
    const origin = project(hospital.lat, hospital.lon, 5);
    const start = Math.floor((Date.now() - 10 * 60_000) / STEP_MS) * STEP_MS;
    const attempt = (step: number) => {
      if (!alive) return;
      if (step > 30) { setSearching(false); return; }
      const probe = new Image();
      probe.onload = () => { if (alive) { setLatest(start - step * STEP_MS); setIndex(FRAMES - 1); setSearching(false); } };
      probe.onerror = () => attempt(step + 1);
      probe.src = tileUrl(layer, stamp(start - step * STEP_MS), 5, Math.floor(origin.x / 256), Math.floor(origin.y / 256));
    };
    attempt(0);
    const timer = window.setInterval(() => attempt(0), 5 * 60_000);
    return () => { alive = false; window.clearInterval(timer); };
  }, [layer, hospital.lat, hospital.lon]);

  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => setIndex((current) => (current + 1) % FRAMES), 550);
    return () => window.clearInterval(timer);
  }, [playing]);

  const times = useMemo(() => (latest == null ? [] : Array.from({ length: FRAMES }, (_, i) => latest - (FRAMES - 1 - i) * STEP_MS)), [latest]);
  const mid = project(center.lat, center.lon, z);
  const left = Math.round(mid.x - size.w / 2), top = Math.round(mid.y - size.h / 2);
  const tiles = useMemo(() => {
    const out: { x: number; y: number; px: number; py: number }[] = [];
    if (!size.w || !size.h) return out;
    const max = 2 ** z;
    for (let ty = Math.floor(top / 256); ty <= Math.floor((top + size.h) / 256); ty++) {
      for (let tx = Math.floor(left / 256); tx <= Math.floor((left + size.w) / 256); tx++) {
        if (ty < 0 || ty >= max) continue;
        out.push({ x: ((tx % max) + max) % max, y: ty, px: tx * 256 - left, py: ty * 256 - top });
      }
    }
    return out;
  }, [left, top, size.w, size.h, z]);
  const at = (lat: number, lon: number) => { const p = project(lat, lon, z); return { x: p.x - left, y: p.y - top }; };
  const pin = at(hospital.lat, hospital.lon);
  const shown = animated ? times : times.slice(index, index + 1);
  const current = times[index] ?? null;
  const live = index === FRAMES - 1;

  const onDown = (event: ReactPointerEvent<HTMLDivElement>) => { drag.current = { x: event.clientX, y: event.clientY, cx: mid.x, cy: mid.y }; event.currentTarget.setPointerCapture(event.pointerId); };
  const onMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    setCenter(unproject(drag.current.cx - (event.clientX - drag.current.x), drag.current.cy - (event.clientY - drag.current.y), z));
  };
  const onUp = () => { drag.current = null; };

  return (
    <section className="overflow-hidden rounded-2xl bg-nav text-nav-fg shadow-[var(--shadow-border)]">
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
        <div className="flex items-center gap-2 text-sm font-semibold"><Radio className="size-4" />Satélite GOES-19<span className="font-normal text-nav-muted">· NOAA / NASA</span></div>
        <div className="flex rounded-xl bg-white/10 p-0.5 text-xs font-medium" role="tablist" aria-label="Tipo de imagen">
          {LAYERS.map((item) => <button key={item.id} type="button" role="tab" aria-selected={item.id === layer.id} onClick={() => setLayerId(item.id)} className={cn("rounded-[10px] px-2.5 py-1.5 transition", item.id === layer.id ? "bg-white text-fg" : "text-nav-fg/80")}>{item.label}</button>)}
        </div>
      </div>
      <div ref={box} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} className="relative h-[320px] cursor-grab touch-none select-none overflow-hidden bg-black active:cursor-grabbing sm:h-[440px] lg:h-[520px]" aria-label="Imagen satelital de la región; arrastrá para mover">
        {shown.map((time) => (
          <div key={`${layer.id}-${z}-${time}`} className="absolute inset-0 transition-opacity duration-200" style={{ opacity: time === current ? 1 : 0 }}>
            {tiles.map((tile) => <img key={`${tile.x}-${tile.y}`} src={tileUrl(layer, stamp(time), z, tile.x, tile.y)} alt="" draggable={false} width={256} height={256} className="absolute max-w-none" style={{ left: tile.px, top: tile.py }} onError={(event) => { event.currentTarget.style.visibility = "hidden"; }} />)}
          </div>
        ))}
        <svg className="pointer-events-none absolute inset-0 size-full" aria-hidden="true">
          {alerts.flatMap((alert, a) => alert.poligonos.map((polygon, p) => (
            <polygon key={`${a}-${p}`} points={polygon.map(([lat, lon]) => { const point = at(lat, lon); return `${point.x.toFixed(1)},${point.y.toFixed(1)}`; }).join(" ")} fill={NIVEL_STYLE[alert.nivel].fill} fillOpacity={0.22} stroke={NIVEL_STYLE[alert.nivel].fill} strokeWidth={1.5} />
          )))}
        </svg>
        {CITIES.map(([name, lat, lon]) => { const point = at(lat, lon); return (
          <span key={name} className="pointer-events-none absolute flex -translate-y-1/2 items-center gap-1 text-[0.68rem] font-medium text-white/90 [text-shadow:0_1px_3px_rgb(0_0_0/0.9)]" style={{ left: point.x - 2.5, top: point.y }}><span className="size-[5px] rounded-full bg-white/90" />{name}</span>
        ); })}
        <span className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2" style={{ left: pin.x, top: pin.y }}>
          <span className="absolute -inset-2 animate-ping rounded-full bg-primary/60" /><span className="relative block size-3 rounded-full border-2 border-white bg-primary" />
        </span>
        <span className="pointer-events-none absolute -translate-x-1/2 rounded-md bg-primary px-1.5 py-0.5 text-[0.68rem] font-semibold text-white shadow" style={{ left: pin.x, top: pin.y + 10 }}>Hospital · San Rafael</span>
        <div className="absolute right-2 top-2 flex flex-col overflow-hidden rounded-xl bg-white/90 text-fg shadow">
          <button type="button" onPointerDown={(event) => event.stopPropagation()} onClick={() => setZoom(Math.min(layer.max, z + 1))} disabled={z >= layer.max} aria-label="Acercar" className="grid size-9 place-items-center disabled:opacity-30"><Plus className="size-4" /></button>
          <button type="button" onPointerDown={(event) => event.stopPropagation()} onClick={() => setZoom(Math.max(4, z - 1))} disabled={z <= 4} aria-label="Alejar" className="grid size-9 place-items-center border-t border-border disabled:opacity-30"><Minus className="size-4" /></button>
        </div>
        {alerts.length ? <div className="pointer-events-none absolute left-2 top-2 rounded-lg bg-black/55 px-2 py-1 text-[0.68rem] text-white">Zonas sombreadas: alertas del SMN</div> : null}
        {!current ? <p className="absolute inset-0 grid place-items-center px-6 text-center text-sm text-white/80">{searching ? "Buscando la última imagen del satélite…" : "No se pudo cargar la imagen satelital. Se reintenta sola."}</p> : null}
      </div>
      <div className="flex items-center gap-3 px-3 py-2.5">
        <button type="button" disabled={!current} onClick={() => { setAnimated(true); setPlaying(!playing); }} aria-label={playing ? "Pausar" : "Reproducir las últimas dos horas"} className="grid size-10 shrink-0 place-items-center rounded-full bg-white text-fg disabled:opacity-40">{playing ? <Pause className="size-4" /> : <Play className="size-4 translate-x-px" />}</button>
        <input type="range" min={0} max={FRAMES - 1} value={index} disabled={!current} onChange={(event) => { setAnimated(true); setPlaying(false); setIndex(Number(event.target.value)); }} aria-label="Momento de la imagen" className="h-1.5 min-w-0 flex-1 accent-white" />
        <div className="shrink-0 text-right leading-tight">
          <p className="text-sm font-semibold tabular-nums">{current ? `${hhmm(new Date(current).toISOString())} h` : "—"}</p>
          <p className={cn("text-[0.68rem]", live ? "text-emerald-300" : "text-nav-muted")}>{live ? "última imagen" : "imagen anterior"}</p>
        </div>
      </div>
      <p className="border-t border-white/10 px-3 py-2 text-xs text-nav-muted">{layer.hint} El satélite publica una imagen cada 10 minutos, con unos 20 a 40 de demora.</p>
    </section>
  );
}

/* ------------------------------ radar de la DACC ------------------------------ */
const RADAR_VIEWS = [
  { id: "sur", label: "Sur", hint: "Compuesto del sur de Mendoza, con San Rafael al centro." },
  { id: "latest", label: "Provincia", hint: "Compuesto de toda la provincia." },
  { id: "animacion", label: "Animación", hint: "Secuencia de las últimas imágenes." },
] as const;

function RadarCard({ radar }: { radar: Clima["radar"] }) {
  const [view, setView] = useState<(typeof RADAR_VIEWS)[number]["id"]>("sur");
  const reading = radar?.datos?.lectura;
  const stale = radar?.datos ? !radar.datos.vigente : false;
  const tick = radar?.datos?.imagen ?? "";
  const summary = !radar?.datos ? "No se pudo leer el radar."
    : stale ? `La última imagen es de ${when(radar.datos.imagen)}: está vieja y no se usa para alertar.`
    : reading?.ciudad_dbz ? `Eco de ${reading.ciudad_dbz} dBZ a menos de 15 km de la ciudad.`
    : reading?.celda ? `Sin ecos fuertes sobre la ciudad. Celda más cercana con posible granizo: ${reading.celda.dbz} dBZ a ${reading.celda.km} km al ${reading.celda.rumbo}.`
    : "Sin celdas con posible granizo en el alcance del radar.";
  return (
    <section className="overflow-hidden rounded-2xl bg-nav text-nav-fg shadow-[var(--shadow-border)]">
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
        <div className="flex items-center gap-2 text-sm font-semibold"><Radar className="size-4" />Radar de granizo<span className="font-normal text-nav-muted">· DACC Mendoza</span></div>
        <div className="flex rounded-xl bg-white/10 p-0.5 text-xs font-medium" role="tablist" aria-label="Vista del radar">
          {RADAR_VIEWS.map((item) => <button key={item.id} type="button" role="tab" aria-selected={item.id === view} onClick={() => setView(item.id)} className={cn("rounded-[10px] px-2.5 py-1.5 transition", item.id === view ? "bg-white text-fg" : "text-nav-fg/80")}>{item.label}</button>)}
        </div>
      </div>
      <div className="bg-black">
        <img key={view} src={`https://www2.contingencias.mendoza.gov.ar/radar/${view}.gif?t=${encodeURIComponent(tick)}`} alt={`Radar meteorológico de la DACC, vista ${view}`} referrerPolicy="no-referrer" className="mx-auto max-h-[520px] w-full object-contain" />
      </div>
      <div className="space-y-1 px-3 py-2.5">
        <p className={cn("text-sm font-medium", stale && "text-amber-300")}>{summary}</p>
        <p className="text-xs text-nav-muted">Lectura automática de la imagen{radar?.datos?.imagen && !stale ? ` de las ${hhmm(radar.datos.imagen)} h` : ""}: mide el color del eco y su distancia a la ciudad. Desde 54 dBZ suele haber granizo; desde 60, granizo grande. Sólo cuenta celdas de 10 km² o más. {RADAR_VIEWS.find((item) => item.id === view)?.hint}</p>
      </div>
    </section>
  );
}

/* --------------------------------- gráficos --------------------------------- */
function HourChart({ hours, value, max, unit, bars, threshold, label }: { hours: Hora[]; value: (hour: Hora) => number | null; max: number; unit: string; bars?: boolean; threshold?: number; label: string }) {
  const W = 480, H = 110, pad = 4, base = H - 16;
  const values = hours.map((hour) => value(hour) ?? 0);
  const top = Math.max(max, ...values) || 1;
  const x = (i: number) => pad + (i * (W - 2 * pad)) / Math.max(1, hours.length - 1);
  const y = (v: number) => base - (v / top) * (base - 8);
  const peak = Math.max(...values), peakAt = values.indexOf(peak);
  return (
    <figure className="rounded-2xl bg-surface p-3 shadow-[var(--shadow-border)]">
      <figcaption className="flex items-baseline justify-between gap-2"><span className="text-sm font-semibold">{label}</span><span className="text-xs text-muted">máx. <b className="tabular-nums text-fg">{Math.round(peak * 10) / 10} {unit}</b>{hours[peakAt] ? ` · ${when(hours[peakAt].t)}` : ""}</span></figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-1 w-full" role="img" aria-label={`${label}: máximo ${Math.round(peak)} ${unit}`}>
        {threshold != null && threshold <= top ? <><line x1={pad} x2={W - pad} y1={y(threshold)} y2={y(threshold)} stroke="var(--color-warn)" strokeDasharray="4 4" strokeWidth="1" /><text x={W - pad} y={y(threshold) - 3} textAnchor="end" fontSize="9" fill="var(--color-warn)">alerta {threshold} {unit}</text></> : null}
        {bars
          ? values.map((v, i) => <rect key={i} x={x(i) - 3} width={6} y={y(v)} height={Math.max(0, base - y(v))} rx={2} fill="var(--color-primary)" opacity={v ? 0.9 : 0} />)
          : <><path d={`M${values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" L")} L${x(values.length - 1)},${base} L${x(0)},${base} Z`} fill="var(--color-primary-soft)" /><path d={`M${values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" L")}`} fill="none" stroke="var(--color-primary)" strokeWidth="2" strokeLinejoin="round" /></>}
        <line x1={pad} x2={W - pad} y1={base} y2={base} stroke="var(--color-border)" />
        {hours.map((hour, i) => {
          const single = hours.length <= 24, hh = hour.t.slice(11, 13);
          const text = single ? (["00", "06", "12", "18"].includes(hh) ? `${Number(hh)} h` : null) : hour.t.endsWith("T00:00") ? when(hour.t).split(" ")[0] : hour.t.endsWith("T12:00") ? "12 h" : null;
          return text ? <text key={hour.t} x={Math.max(10, x(i))} y={H - 3} textAnchor="middle" fontSize="9" fill="var(--color-muted)">{text}</text> : null;
        })}
      </svg>
    </figure>
  );
}

/* ------------------------------ lluvia por hora ------------------------------ */
const RAIN_LEVELS = [
  { min: 15, label: "Muy fuerte", range: "15 mm o más", bar: "bg-danger", text: "text-danger" },
  { min: 7.5, label: "Fuerte", range: "7,5 a 15", bar: "bg-kpi-orange", text: "text-kpi-orange" },
  { min: 2.5, label: "Moderada", range: "2,5 a 7,5", bar: "bg-primary", text: "text-primary" },
  { min: 0.1, label: "Débil", range: "menos de 2,5", bar: "bg-primary/40", text: "text-muted" },
];
const rainLevel = (mm: number) => RAIN_LEVELS.find((level) => mm >= level.min) ?? null;
const mm1 = (value: number) => (Math.round(value * 10) / 10).toLocaleString("es-AR");
const hourOf = (iso: string) => Number(iso.slice(11, 13));
const rainDay = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00-03:00`).toLocaleDateString("es-AR", { weekday: "short", day: "numeric" }).replace(".", "");
const dayHour = (iso: string) => `${rainDay(iso)}, ${hourOf(iso)} h`;

/** Lluvia prevista hora por hora: barras con color según intensidad, escala en mm, días separados y lectura al tocar. */
function RainChart({ hours, fromNow }: { hours: { t: string; rain: number | null; prob: number | null }[]; fromNow?: boolean }) {
  const values = hours.map((hour) => hour.rain ?? 0);
  const peak = Math.max(0, ...values), peakAt = values.indexOf(peak);
  const total = values.reduce((sum, value) => sum + value, 0);
  const top = [5, 10, 20, 30, 50, 100].find((step) => step >= peak) ?? Math.ceil(peak / 50) * 50;
  const [picked, setPicked] = useState<number | null>(null);
  const shown = picked != null && picked < hours.length ? picked : peak > 0 ? peakAt : null;
  // Tramos de lluvia: horas seguidas con 0,2 mm o más (se tolera una hora seca en el medio).
  const spells: { from: number; to: number; mm: number }[] = [];
  values.forEach((value, index) => {
    if (value < 0.2) return;
    const last = spells.at(-1);
    if (last && index - last.to <= 2) { last.to = index; last.mm += value; } else spells.push({ from: index, to: index, mm: value });
  });
  const next = spells[0];
  const many = hours.length > 24;
  const end = (index: number) => {
    const stop = new Date(new Date(`${hours[index].t}:00-03:00`).getTime() + 3_600_000 - 3 * 3_600_000).toISOString().slice(0, 16); // hora local de fin del tramo
    return stop.slice(0, 10) === hours[next.from].t.slice(0, 10) ? `${hourOf(stop)} h` : `${rainDay(stop)}, ${hourOf(stop)} h`;
  };
  const headline = !next ? "Sin lluvia prevista en este período"
    : `${!fromNow ? `Lluvia de ${hourOf(hours[next.from].t)} h` : next.from === 0 ? "Lluvia prevista desde ahora" : `Próxima lluvia: ${dayHour(hours[next.from].t)}`} hasta ${end(next.to)} · ${mm1(next.mm)} mm${spells.length > 1 ? ` · después, ${spells.length - 1} ${spells.length === 2 ? "tramo" : "tramos"} más` : ""}`;
  const level = shown != null ? rainLevel(values[shown]) : null;

  return (
    <figure className="rounded-2xl bg-surface p-3 shadow-[var(--shadow-border)] sm:p-4">
      <figcaption>
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
          <span className="text-sm font-semibold">Lluvia por hora</span>
          <span className="text-xs text-muted">Pronóstico, no medición</span>
        </div>
        <p className={cn("mt-1 text-base font-semibold leading-snug", next ? "text-fg" : "text-muted")}>{headline}</p>
        {peak > 0 ? (
          <div className="mt-2 grid grid-cols-3 gap-2 text-center">
            <div className="rounded-xl bg-bg px-2 py-1.5"><p className="text-lg font-semibold leading-none tabular-nums">{mm1(total)} <span className="text-xs font-normal text-muted">mm</span></p><p className="mt-1 text-[0.7rem] leading-tight text-muted">Total del período</p></div>
            <div className="rounded-xl bg-bg px-2 py-1.5"><p className={cn("text-lg font-semibold leading-none tabular-nums", rainLevel(peak)?.text)}>{mm1(peak)} <span className="text-xs font-normal text-muted">mm/h</span></p><p className="mt-1 text-[0.7rem] leading-tight text-muted">Hora más fuerte: {dayHour(hours[peakAt].t)}</p></div>
            <div className="rounded-xl bg-bg px-2 py-1.5"><p className="text-lg font-semibold leading-none tabular-nums">{values.filter((value) => value >= 0.2).length} <span className="text-xs font-normal text-muted">h</span></p><p className="mt-1 text-[0.7rem] leading-tight text-muted">Horas con lluvia</p></div>
          </div>
        ) : null}
      </figcaption>

      {peak > 0 ? (
        <>
          <p className="mt-3 min-h-5 text-sm" aria-live="polite">
            {shown != null ? <><b className="font-semibold">{dayHour(hours[shown].t)}:</b> <span className={cn("font-semibold tabular-nums", level?.text)}>{mm1(values[shown])} mm</span>{level ? ` · ${level.label.toLowerCase()}` : " · sin lluvia"}{hours[shown].prob != null ? <span className="text-muted"> · probabilidad {Math.round(hours[shown].prob ?? 0)} %</span> : null}</> : null}
          </p>
          <div className="mt-1 flex gap-1.5">
            <div className="relative w-7 shrink-0 text-right text-[0.7rem] tabular-nums text-muted" style={{ height: 150 }} aria-hidden="true">
              <span className="absolute right-0 top-0 -translate-y-1/2">{top}</span>
              <span className="absolute right-0 top-1/2 -translate-y-1/2">{mm1(top / 2)}</span>
              <span className="absolute bottom-0 right-0 translate-y-1/2">0</span>
            </div>
            <div className="min-w-0 flex-1">
              <div className="relative border-b border-border-strong" style={{ height: 150 }} role="img" aria-label={`Lluvia por hora. ${headline}. Total ${mm1(total)} milímetros.`}>
                <div className="absolute inset-x-0 top-0 border-t border-dashed border-border" /><div className="absolute inset-x-0 top-1/2 border-t border-dashed border-border" />
                <div className="absolute inset-0 flex items-end">
                  {hours.map((hour, index) => {
                    const value = values[index], tone = rainLevel(value), isPeak = index === peakAt;
                    return (
                      <div key={hour.t} onPointerEnter={() => setPicked(index)} onClick={() => setPicked(index)} className={cn("relative flex h-full min-w-0 flex-1 cursor-pointer items-end justify-center", index > 0 && hourOf(hour.t) === 0 && "border-l border-border-strong", shown === index && "bg-primary-soft/60")}>
                        {tone ? <div className={cn("w-[70%] min-w-[3px] rounded-t-sm", tone.bar)} style={{ height: `${Math.max(2, (value / top) * 100)}%` }}>{isPeak ? <span className={cn("absolute left-1/2 whitespace-nowrap pb-0.5 text-[0.7rem] font-semibold tabular-nums", tone.text)} style={{ bottom: `${Math.min(88, (value / top) * 100)}%`, transform: "translateX(-50%)" }}>{mm1(value)}</span> : null}</div> : null}
                        {fromNow && index === 0 ? <span className="absolute left-0 top-0 h-full border-l-2 border-fg/60" /> : null}
                      </div>
                    );
                  })}
                </div>
              </div>
              <div className="flex h-9 text-[0.7rem] text-muted" aria-hidden="true">
                {hours.map((hour, index) => {
                  const h = hourOf(hour.t), newDay = index === 0 || (h === 0 && index >= (many ? 6 : 3));
                  const tick = h % (many ? 6 : 3) === 0;
                  return (
                    <div key={hour.t} className="relative min-w-0 flex-1">
                      {tick && h !== 0 ? <span className="absolute left-1/2 top-0.5 -translate-x-1/2 tabular-nums">{h}</span> : null}
                      {newDay ? <span className={cn("absolute top-4 whitespace-nowrap font-semibold text-fg", index === 0 ? "left-0" : "left-1")}>{fromNow && index === 0 ? "ahora" : rainDay(hour.t)}</span> : null}
                      {h === 0 && index > 0 ? <span className="absolute left-1/2 top-0.5 -translate-x-1/2 tabular-nums">0</span> : null}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
          <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[0.7rem] text-muted">
            {[...RAIN_LEVELS].reverse().map((item) => <li key={item.label} className="flex items-center gap-1"><span className={cn("size-2.5 rounded-sm", item.bar)} /><b className="font-medium text-fg">{item.label}</b> {item.range}</li>)}
            <li className="w-full sm:w-auto">Escala en mm por hora · tocá una barra para ver esa hora</li>
          </ul>
        </>
      ) : null}
    </figure>
  );
}

/* ----------------------------- pronóstico a 10 días ----------------------------- */
function sky(code: number | null): { icon: typeof Sun; label: string } {
  if (code == null) return { icon: Cloud, label: "Sin dato" };
  if (code === 0) return { icon: Sun, label: "Despejado" };
  if (code <= 2) return { icon: CloudSun, label: "Algo nublado" };
  if (code === 3) return { icon: Cloud, label: "Nublado" };
  if (code <= 48) return { icon: CloudFog, label: "Niebla" };
  if (code <= 57) return { icon: CloudDrizzle, label: "Llovizna" };
  if (code <= 67) return { icon: CloudRain, label: "Lluvia" };
  if (code <= 77) return { icon: CloudSnow, label: "Nieve" };
  if (code <= 82) return { icon: CloudRain, label: "Chaparrones" };
  if (code <= 86) return { icon: CloudSnow, label: "Nevadas" };
  return { icon: CloudLightning, label: code >= 96 ? "Tormenta con granizo" : "Tormenta" };
}
const AGREE = { alto: { text: "Modelos de acuerdo", tone: "text-ok" }, medio: { text: "Acuerdo parcial", tone: "text-muted" }, bajo: { text: "Modelos en desacuerdo", tone: "text-warn" } } as const;
const dayName = (iso: string, long = false) => new Intl.DateTimeFormat("es-AR", { timeZone: "UTC", weekday: long ? "long" : "short", day: "numeric", ...(long ? { month: "long" } : {}) }).format(new Date(`${iso}T12:00:00Z`)).replace(",", "");

function TenDays({ data }: { data: Extendido }) {
  const [selected, setSelected] = useState(data.dias[0]?.fecha ?? "");
  const day = data.dias.find((item) => item.fecha === selected) ?? data.dias[0];
  const hours = useMemo(() => data.horas.filter((hour) => hour.t.startsWith(day?.fecha ?? "-")).map((hour) => ({ ...hour, rh: null, cape: null, frz: null })), [data.horas, day?.fecha]);
  if (!day) return null;
  const watch = (item: Dia) => (item.lluvia ?? 0) >= 30 || (item.rafaga ?? 0) >= 60;
  return (
    <section className="rounded-2xl bg-surface p-3 shadow-[var(--shadow-border)]">
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-1">
        <h2 className="text-sm font-semibold">Pronóstico a 10 días</h2>
        <p className="text-xs text-muted">Modelo {data.modelo} (Centro Europeo). Tocá un día para verlo hora por hora.</p>
      </div>
      <div className="-mx-1 mt-2 flex gap-2 overflow-x-auto px-1 pb-1 lg:grid lg:grid-cols-10 lg:overflow-visible">
        {data.dias.map((item, index) => { const look = sky(item.code); const active = item.fecha === day.fecha; return (
          <button key={item.fecha} type="button" onClick={() => setSelected(item.fecha)} aria-pressed={active} className={cn("flex w-[5.4rem] shrink-0 flex-col items-center gap-1 rounded-2xl border px-1.5 py-2 text-center transition lg:w-auto", active ? "border-primary bg-primary-soft ring-2 ring-primary/20" : watch(item) ? "border-warn/50 bg-warn-soft" : "border-border bg-bg")}>
            <span className="text-xs font-semibold capitalize">{index === 0 ? "Hoy" : dayName(item.fecha)}</span>
            <look.icon className={cn("size-6", item.code != null && item.code >= 95 ? "text-warn" : "text-primary")} aria-label={look.label} />
            <span className="text-sm font-semibold tabular-nums leading-none">{round(item.tmax, "°")}<span className="ml-1 font-normal text-muted">{round(item.tmin, "°")}</span></span>
            <span className={cn("text-[0.7rem] tabular-nums leading-tight", (item.lluvia ?? 0) >= 1 ? "font-semibold text-primary" : "text-muted")}>{(item.lluvia ?? 0) >= 0.1 ? `${Math.round((item.lluvia ?? 0) * 10) / 10} mm` : "sin lluvia"}</span>
            <span className="text-[0.65rem] tabular-nums leading-tight text-muted">ráf. {round(item.rafaga)} km/h</span>
            {item.acuerdo ? <span className={cn("size-1.5 rounded-full", item.acuerdo === "alto" ? "bg-ok" : item.acuerdo === "medio" ? "bg-border-strong" : "bg-warn")} title={AGREE[item.acuerdo].text} /> : null}
          </button>
        ); })}
      </div>
      <div className="mt-3 rounded-xl bg-bg p-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <p className="text-sm font-semibold first-letter:uppercase">{dayName(day.fecha, true)} · {sky(day.code).label.toLowerCase()}</p>
          <p className="text-xs text-muted">Máx. {round(day.tmax, " °C")} · mín. {round(day.tmin, " °C")} · lluvia {day.lluvia != null ? `${Math.round(day.lluvia * 10) / 10} mm` : "—"}{day.prob != null ? ` (prob. ${Math.round(day.prob)} %)` : ""} · ráfagas {round(day.rafaga, " km/h")} {compass(day.dir)}</p>
        </div>
        {day.acuerdo ? <p className={cn("mt-1 text-xs font-medium", AGREE[day.acuerdo].tone)}>{AGREE[day.acuerdo].text} sobre la lluvia: {data.modelo.split(" ")[0]} {day.lluvia != null ? `${Math.round(day.lluvia * 10) / 10} mm` : "—"}{day.otros.map((other) => `, ${other.nombre} ${other.lluvia != null ? `${Math.round(other.lluvia * 10) / 10} mm` : "—"}`).join("")}.{day.acuerdo === "bajo" ? " Tomarlo como posible, no como seguro." : ""}</p> : null}
        {hours.length ? (
          <div className="mt-2 grid gap-3 md:grid-cols-2">
            <div className="md:col-span-2"><RainChart hours={hours} /></div>
            <HourChart hours={hours} label="Temperatura" unit="°C" max={30} value={(hour) => hour.temp} />
            <HourChart hours={hours} label="Ráfagas" unit="km/h" max={70} threshold={60} value={(hour) => hour.gust} />
          </div>
        ) : null}
      </div>
      <p className="mt-2 px-1 text-xs text-muted">El punto de cada día indica si los modelos {data.comparados.join(", ")} coinciden sobre la lluvia: verde sí, ámbar no. Los días en ámbar tienen lluvia de 30 mm o más o ráfagas de 60 km/h o más. Más allá del quinto día la precisión baja en cualquier modelo.</p>
    </section>
  );
}

/* ---------------------------------- pantalla ---------------------------------- */
export function ClimaPanel() {
  const { data, failed } = useClima();
  if (!data) return <p className="rounded-2xl bg-surface p-4 text-sm text-muted shadow-[var(--shadow-border)]">{failed ? "No se pudo consultar el estado del tiempo. Se reintenta sola en unos minutos." : "Consultando alertas, pronóstico y satélite…"}</p>;
  const oficiales = data.oficial.datos?.alertas ?? [];
  const locales = oficiales.filter((alert) => alert.alcance === "LOCAL");
  const regionales = oficiales.filter((alert) => alert.alcance === "REGIONAL");
  const forecast = data.pronostico.datos;
  const calculadas = forecast?.alertas ?? [];
  const hours = forecast?.horas ?? [];
  const enso = data.enso.datos;
  const maxOf = (pick: (hour: Hora) => number | null) => Math.max(0, ...hours.map((hour) => pick(hour) ?? 0));
  const rainTotal = hours.slice(0, 24).reduce((sum, hour) => sum + (hour.rain ?? 0), 0);
  const level = data.nivel ?? { color: (locales[0]?.nivel ?? calculadas[0]?.nivel ?? "verde") as Nivel | "verde", motivos: [], incompleto: !data.oficial.ok || !data.pronostico.ok };
  const grade = level.grado ?? ({ verde: 1, amarillo: 3, naranja: 5, rojo: 7 } as const)[level.color];
  const sources: [string, Fuente<unknown>][] = [["Alertas SMN", data.oficial], ["Radar DACC", data.radar ?? { ok: false, en: null, datos: null }], ["Ríos y lluvia INA", data.hidro ?? { ok: false, en: null, datos: null }], ["Sismos INPRES", data.sismos ?? { ok: false, en: null, datos: null }], ["Pronóstico Open-Meteo", data.pronostico], ["El Niño · NOAA", data.enso]];

  return (
    <div className="space-y-3">
      {/* Grado de alerta del hospital, de 1 a 9 */}
      <section className={cn("rounded-2xl border p-4", LEVEL_STYLE[level.color].card)}>
        <div className="flex flex-wrap items-start gap-x-5 gap-y-3">
          <div className="flex items-center gap-3">
            <span className={cn("relative grid size-16 shrink-0 place-items-center rounded-2xl text-white", LEVEL_STYLE[level.color].dot)}>
              {grade >= 5 ? <span className={cn("absolute inset-0 animate-ping rounded-2xl opacity-30", LEVEL_STYLE[level.color].dot)} /> : null}
              <span className="relative text-4xl font-bold leading-none tabular-nums">{grade}</span>
            </span>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-fg/60">Alerta · San Rafael · grado {grade} de 9</p>
              <h1 className="text-2xl font-semibold leading-tight">{level.nombre ?? LEVEL_STYLE[level.color].label}</h1>
              <div className="mt-1.5 flex gap-0.5" role="img" aria-label={`Grado ${grade} de 9`}>
                {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((step) => <span key={step} className={cn("h-2.5 w-5 rounded-sm sm:w-6", LEVEL_STYLE[step >= 7 ? "rojo" : step >= 5 ? "naranja" : step >= 3 ? "amarillo" : "verde"].dot, step > grade && "opacity-20", step === grade && "ring-2 ring-fg/70 ring-offset-1")} />)}
              </div>
            </div>
          </div>
          <div className="min-w-0 flex-1 basis-72 text-sm text-fg/85">
            {level.accion ? <p className="font-semibold text-fg">{grade >= 3 ? "Qué hacer: " : ""}{level.accion}</p> : null}
            {level.motivos.length ? (
              <ul className="mt-1.5 space-y-1">{level.motivos.map((reason, index) => <li key={index} className="flex gap-2"><span className={cn("mt-0.5 grid size-5 shrink-0 place-items-center rounded-md text-[0.7rem] font-bold text-white", LEVEL_STYLE[reason.nivel]?.dot)}>{reason.grado ?? ""}</span><span><b className="font-semibold">{reason.origen}:</b> {reason.texto}</span></li>)}</ul>
            ) : (
              <p className="mt-1">{data.oficial.ok ? `Ni el SMN, ni el radar, ni el pronóstico de 48 horas marcan riesgo para la ciudad.${regionales.length ? ` En la región: ${[...new Set(regionales.map((alert) => `${alert.evento.toLowerCase()} a ${alert.distancia_km} km`))].join(", ")}.` : ""}` : "Sin motivos de alerta en lo que se pudo consultar."}</p>
            )}
            {level.incompleto ? <p className="mt-1 font-semibold text-warn">Atención: alguna fuente no respondió o está desactualizada; el grado puede ser mayor.</p> : null}
          </div>
        </div>
        {level.escala ? (
          <details className="mt-3 border-t border-fg/10 pt-2 text-sm">
            <summary className="cursor-pointer text-xs font-semibold text-fg/70">Cómo se calcula el grado y qué pide cada uno</summary>
            <p className="mt-2 text-xs text-fg/70">El grado sale de dos cosas: qué tan grave es el fenómeno y qué tan seguro es que afecte a la ciudad (pronóstico lejano, alerta oficial o dentro de 6 horas, u observado en el radar sobre San Rafael). Vale el más alto entre SMN, radar, sismos y pronóstico. En el radar cuenta la superficie de eco fuerte sobre la ciudad, no un punto; una celda lejana sólo cuenta si es grande y el viento en altura la trae. Las acciones son una propuesta: las valida la Dirección.</p>
            <ol className="mt-2 grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
              {level.escala.map((step) => <li key={step.grado} className={cn("flex gap-2 rounded-lg bg-surface/70 p-2 text-xs", step.grado === grade && "ring-2 ring-fg/60")}><span className={cn("grid size-6 shrink-0 place-items-center rounded-md font-bold text-white", LEVEL_STYLE[step.grado >= 7 ? "rojo" : step.grado >= 5 ? "naranja" : step.grado >= 3 ? "amarillo" : "verde"].dot)}>{step.grado}</span><span><b className="font-semibold">{step.nombre}.</b> {step.accion}</span></li>)}
            </ol>
          </details>
        ) : null}
      </section>

      {data.parte?.texto ? (
        <section className="rounded-2xl bg-surface p-4 shadow-[var(--shadow-border)]">
          <h2 className="flex items-center gap-2 text-sm font-semibold"><Sparkles className="size-4 text-primary" />Parte para el hospital<span className="text-xs font-normal text-muted">· redactado por IA a las {hhmm(data.parte.en)} h con los datos de esta pantalla</span></h2>
          <p className="mt-1.5 text-sm leading-relaxed">{data.parte.texto}</p>
        </section>
      ) : null}

      <div className="grid gap-3 xl:grid-cols-[1.6fr_1fr]">
        <SatelliteMap hospital={data.lugar} alerts={oficiales} />

        <div className="space-y-3">
          {/* Ahora */}
          <section className="grid grid-cols-4 gap-2">
            {[
              { icon: Thermometer, label: "Temperatura", value: round(forecast?.actual.temp, "°") },
              { icon: Wind, label: `Ráfaga ${compass(forecast?.actual.dir ?? null)}`, value: round(forecast?.actual.rafaga), unit: "km/h" },
              { icon: Sun, label: "Humedad", value: round(forecast?.actual.rh, "%") },
              { icon: CloudRain, label: "Lluvia 24 h", value: hours.length ? String(Math.round(rainTotal * 10) / 10) : "—", unit: "mm" },
            ].map((item) => (
              <div key={item.label} className="rounded-2xl bg-surface p-2.5 shadow-[var(--shadow-border)]">
                <item.icon className="size-4 text-primary" />
                <p className="mt-1 text-xl font-semibold leading-none tabular-nums">{item.value}<span className="ml-0.5 text-[0.65rem] font-normal text-muted">{item.unit}</span></p>
                <p className="mt-1 text-[0.68rem] leading-tight text-muted">{item.label}</p>
              </div>
            ))}
          </section>

          {/* Alertas oficiales */}
          <section className="rounded-2xl bg-surface p-3 shadow-[var(--shadow-border)]">
            <h2 className="text-sm font-semibold">Alertas oficiales del SMN</h2>
            {!oficiales.length ? <p className="mt-1 text-sm text-muted">{data.oficial.ok ? "Ninguna vigente para San Rafael ni a menos de 150 km." : "Sin dato: no se pudo consultar al SMN."}</p> : (
              <ul className="mt-2 space-y-2">
                {oficiales.map((alert, index) => { const Icon = iconFor(alert.evento); return (
                  <li key={index} className={cn("rounded-xl border p-2.5", NIVEL_STYLE[alert.nivel].card)}>
                    <div className="flex items-center gap-2"><Icon className="size-4 shrink-0" /><span className="min-w-0 flex-1 text-sm font-semibold">{alert.evento}</span><span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[0.65rem] font-semibold uppercase", NIVEL_STYLE[alert.nivel].chip)}>{NIVEL_STYLE[alert.nivel].label}</span></div>
                    <p className="mt-1 text-xs font-medium">{alert.alcance === "LOCAL" ? "Cubre San Rafael" : `En la región, a ${alert.distancia_km} km`} · {when(alert.desde)} a {when(alert.hasta)}</p>
                    <details className="mt-1 text-xs text-fg/80"><summary className="cursor-pointer font-medium">Qué dice y qué recomienda</summary><p className="mt-1">{alert.descripcion}</p>{alert.instrucciones ? <p className="mt-1">{alert.instrucciones}</p> : null}</details>
                  </li>
                ); })}
              </ul>
            )}
            {locales.length === 0 && regionales.length > 0 ? <p className="mt-2 text-xs text-muted">Las de la región no cubren la ciudad, pero pueden afectar rutas y derivaciones.</p> : null}
          </section>

          {/* Alertas tempranas */}
          <section className="rounded-2xl bg-surface p-3 shadow-[var(--shadow-border)]">
            <h2 className="text-sm font-semibold">Alertas tempranas · próximas 48 h</h2>
            <p className="text-xs text-muted">Estimación propia con reglas fijas sobre el pronóstico. No reemplaza al SMN.</p>
            {!calculadas.length ? <p className="mt-2 text-sm text-muted">{data.pronostico.ok ? "El pronóstico no supera ningún umbral de viento, Zonda, tormenta, granizo, lluvia, calor ni helada." : "Sin dato: no se pudo consultar el pronóstico."}</p> : (
              <ul className="mt-2 space-y-2">
                {calculadas.map((alert, index) => { const Icon = iconFor(alert.titulo); return (
                  <li key={index} className={cn("flex items-start gap-2 rounded-xl border p-2.5", NIVEL_STYLE[alert.nivel].card)}>
                    <Icon className="mt-0.5 size-4 shrink-0" />
                    <div className="min-w-0 flex-1"><p className="text-sm font-semibold">{alert.titulo}</p><p className="text-xs">{when(alert.desde)} a {when(alert.hasta)} · {alert.detalle}</p></div>
                    <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[0.65rem] font-semibold uppercase", NIVEL_STYLE[alert.nivel].chip)}>{NIVEL_STYLE[alert.nivel].label}</span>
                  </li>
                ); })}
              </ul>
            )}
          </section>
        </div>
      </div>

      {forecast?.extendido ? <TenDays data={forecast.extendido} /> : null}

      <div className="grid gap-3 xl:grid-cols-2">
        <RadarCard radar={data.radar} />
        <section className="flex flex-col overflow-hidden rounded-2xl bg-surface shadow-[var(--shadow-border)]">
          <div className="px-3 py-2.5">
            <h2 className="text-sm font-semibold">Calles y rutas en vivo</h2>
            <p className="text-xs text-muted">Mapa de Waze: cortes, anegamientos, accidentes y demoras que cargan los conductores. No es un parte oficial de Vialidad.</p>
          </div>
          <iframe title="Mapa de tránsito de Waze para San Rafael" src={`https://embed.waze.com/iframe?zoom=12&lat=${data.lugar.lat}&lon=${data.lugar.lon}&ct=livemap`} loading="lazy" className="min-h-[360px] w-full flex-1 border-0" />
        </section>
      </div>

      {hours.length ? (
        <section className="grid gap-3 md:grid-cols-3">
          <div className="md:col-span-3"><RainChart hours={hours} fromNow /></div>
          <HourChart hours={hours} label="Ráfagas de viento" unit="km/h" max={70} threshold={60} value={(hour) => hour.gust} />
          <HourChart hours={hours} label="Inestabilidad (CAPE)" unit="J/kg" max={1000} threshold={800} value={(hour) => hour.cape} />
          <HourChart hours={hours} label="Probabilidad de lluvia" unit="%" max={100} value={(hour) => hour.prob} />
        </section>
      ) : null}

      <div className="grid gap-3 xl:grid-cols-2">
        {/* Ríos y lluvia medidos (INA) */}
        <section className="rounded-2xl bg-surface p-3 shadow-[var(--shadow-border)]">
          <h2 className="text-sm font-semibold">Ríos y lluvia medidos</h2>
          <p className="text-xs text-muted">Mediciones reales de la Red Hidrológica Nacional (INA), no pronóstico. Llegan con algunas horas de atraso.</p>
          {!data.hidro?.datos ? <p className="mt-2 text-sm text-muted">{data.hidro ? "Sin dato: no se pudo consultar al INA." : "Se activa al reiniciar el servidor."}</p> : (
            <>
              <ul className="mt-2 space-y-2">
                {data.hidro.datos.rios.map((item) => {
                  const r = item.lectura;
                  const span = r ? Math.max(0.05, r.max7 - r.min7) : 1;
                  return (
                    <li key={item.nombre} className={cn("rounded-xl p-2.5", r?.rapido ? "bg-warn-soft" : "bg-bg")}>
                      <div className="flex items-baseline justify-between gap-2">
                        <p className="min-w-0 text-sm"><b className="font-semibold">Río {item.rio}</b> · {item.nombre} <span className="text-xs text-muted">({item.donde})</span></p>
                        {r ? <p className="shrink-0 text-lg font-semibold tabular-nums leading-none">{mm1(r.m)} <span className="text-xs font-normal text-muted">m</span></p> : <p className="shrink-0 text-xs text-muted">sin dato</p>}
                      </div>
                      {r ? (
                        <>
                          <div className="relative mt-2 h-1.5 rounded-full bg-border" title="Entre el mínimo y el máximo de los últimos 7 días"><span className={cn("absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface", r.rapido ? "bg-warn" : "bg-primary")} style={{ left: `${Math.max(2, Math.min(98, ((r.m - r.min7) / span) * 100))}%` }} /></div>
                          <p className="mt-1.5 text-xs text-muted"><b className={cn("font-semibold", r.rapido ? "text-warn" : r.tendencia === "sube" ? "text-fg" : "text-muted")}>{r.rapido ? "▲ Sube rápido" : r.tendencia === "sube" ? "▲ Sube" : r.tendencia === "baja" ? "▼ Baja" : "● Estable"}</b>{r.cambio_24h != null ? ` · ${r.cambio_24h > 0 ? "+" : ""}${mm1(r.cambio_24h)} m en 24 h` : ""} · semana: {mm1(r.min7)} a {mm1(r.max7)} m · medido hace {r.hace_h} h</p>
                        </>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
              <h3 className="mt-3 text-xs font-semibold uppercase tracking-wide text-muted">Lluvia caída (pluviómetros)</h3>
              <table className="mt-1 w-full text-sm">
                <thead><tr className="text-left text-[0.7rem] text-muted"><th className="py-1 font-medium">Estación</th><th className="py-1 text-right font-medium">3 h</th><th className="py-1 text-right font-medium">24 h</th><th className="py-1 text-right font-medium">Medido</th></tr></thead>
                <tbody>
                  {data.hidro.datos.lluvia.map((item) => (
                    <tr key={item.nombre} className="border-t border-border">
                      <td className="py-1.5 pr-2">{item.nombre} <span className="text-xs text-muted">· {item.km} km</span>{item.lectura?.descartados ? <span className="block text-[0.7rem] text-warn">{item.lectura.descartados} {item.lectura.descartados === 1 ? "registro descartado" : "registros descartados"} por valor imposible</span> : null}</td>
                      {item.lectura ? <><td className={cn("py-1.5 text-right tabular-nums", item.lectura.mm_3h >= 20 ? "font-semibold text-warn" : item.lectura.mm_3h >= 1 ? "font-semibold text-primary" : "text-muted")}>{mm1(item.lectura.mm_3h)} mm</td><td className={cn("py-1.5 text-right tabular-nums", item.lectura.mm_24h >= 1 ? "font-semibold" : "text-muted")}>{mm1(item.lectura.mm_24h)} mm</td><td className={cn("py-1.5 text-right text-xs", item.lectura.hace_h > 6 ? "text-warn" : "text-muted")}>hace {item.lectura.hace_h} h</td></> : <td colSpan={3} className="py-1.5 text-right text-xs text-muted">sin dato</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-2 text-xs text-muted">Estos puntos no tienen un nivel oficial de alerta: se muestra la tendencia. El Diamante en La Jaula y el Atuel en La Angostura están antes de los diques, que amortiguan las crecidas.</p>
            </>
          )}
        </section>

        {/* Sismos */}
        <section className="rounded-2xl bg-surface p-4 shadow-[var(--shadow-border)]">
          <h2 className="text-sm font-semibold">Sismos · últimos registrados cerca</h2>
          <p className="text-xs text-muted">Instituto Nacional de Prevención Sísmica. Alerta si en las últimas 6 horas hubo uno de magnitud 4 o más a menos de 100 km, 5 o más a menos de 200 km, o 6 o más a menos de 300 km.</p>
          {(() => {
            const all = data.sismos?.datos?.lista ?? [];
            const near = all.filter((quake) => quake.km <= 500).slice(0, 6);
            if (!data.sismos?.datos) return <p className="mt-2 text-sm text-muted">Sin dato: no se pudo consultar al INPRES.</p>;
            if (!near.length) return <p className="mt-2 text-sm text-muted">Ninguno a menos de 500 km entre los últimos {all.length} sismos del país.</p>;
            return (
              <ul className="mt-2 divide-y divide-border">
                {near.map((quake) => (
                  <li key={quake.en} className="flex items-center gap-3 py-1.5 text-sm">
                    <span className={cn("grid size-9 shrink-0 place-items-center rounded-full text-sm font-semibold tabular-nums", quake.mg >= 5 ? "bg-danger-soft text-danger" : quake.mg >= 4 ? "bg-warn-soft text-warn" : "bg-bg text-fg")}>{quake.mg.toFixed(1)}</span>
                    <span className="min-w-0 flex-1"><span className="block font-medium">A {quake.km} km · {quake.prov.charAt(0) + quake.prov.slice(1).toLowerCase()}</span><span className="block text-xs text-muted">{when(quake.en)} · profundidad {quake.prof ?? "?"} km{quake.sentido ? " · sentido" : ""}</span></span>
                  </li>
                ))}
              </ul>
            );
          })()}
        </section>
        {/* Cambios de nivel */}
        <section className="rounded-2xl bg-surface p-4 shadow-[var(--shadow-border)]">
          <h2 className="text-sm font-semibold">Cambios del nivel de alerta</h2>
          <p className="text-xs text-muted">Se revisa cada 10 minutos, haya o no alguien mirando. Cuando no es verde, se avisa con una barra en todas las pantallas.</p>
          {data.cambios?.length ? (
            <ul className="mt-2 space-y-1.5">
              {data.cambios.map((change) => (
                <li key={change.en} className="flex items-start gap-2 text-sm">
                  <span className={cn("mt-1.5 size-2.5 shrink-0 rounded-full", LEVEL_STYLE[(change.a as Nivel | "verde")]?.dot ?? "bg-border")} />
                  <span><b className="font-semibold capitalize">{change.a}</b> <span className="text-muted">(antes {change.de}) · {when(change.en)}</span>{change.motivos[0] ? <span className="block text-xs text-muted">{change.motivos[0].origen}: {change.motivos[0].texto}</span> : null}</span>
                </li>
              ))}
            </ul>
          ) : <p className="mt-2 text-sm text-muted">Todavía no hubo cambios de nivel desde que se activó este seguimiento.</p>}
        </section>
      </div>

      {/* El Niño */}
      <section className="rounded-2xl bg-surface p-4 shadow-[var(--shadow-border)]">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">El Niño · Pacífico ecuatorial</h2>
            <p className="mt-0.5 text-2xl font-semibold leading-tight">{enso?.nombre ?? "Sin dato"}</p>
            <p className="text-xs text-muted">{enso ? `Índice ONI ${enso.oni?.toFixed(2)} °C (trimestre ${enso.trimestre}). Última semana, región Niño 3.4: ${enso.nino34 != null ? `${enso.nino34 > 0 ? "+" : ""}${enso.nino34.toFixed(1)} °C` : "sin dato"} (${enso.semana ?? ""}).` : "No se pudo consultar a NOAA."}</p>
          </div>
          <p className="max-w-md text-xs text-muted">Desde +0,5 °C hay El Niño; desde +2,0 °C se lo considera muy fuerte. Es un indicador de temporada: sube la probabilidad de lluvias y tormentas intensas, no predice un evento de un día puntual.</p>
        </div>
        {enso?.oni != null ? (
          <div className="relative mt-3 h-2.5 rounded-full bg-[linear-gradient(90deg,#1d4ed8_0%,#93c5fd_38%,#e2e8f0_50%,#fdba74_62%,#b91c1c_100%)]">
            <span className="absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-fg shadow" style={{ left: `${Math.min(100, Math.max(0, ((enso.oni + 3) / 6) * 100))}%` }} />
            <span className="absolute -bottom-4 left-0 text-[0.65rem] text-muted">La Niña −3</span><span className="absolute -bottom-4 left-1/2 -translate-x-1/2 text-[0.65rem] text-muted">neutral</span><span className="absolute -bottom-4 right-0 text-[0.65rem] text-muted">El Niño +3</span>
          </div>
        ) : null}
      </section>

      <a href="https://www.skylinewebcams.com/es/webcam/argentina/provincia-de-mendoza/san-rafael/canon-del-atuel.html" target="_blank" rel="noreferrer" className="flex items-center gap-3 rounded-2xl bg-surface p-4 shadow-[var(--shadow-border)]">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary"><Camera className="size-5" /></span>
        <span className="min-w-0 flex-1"><span className="block text-sm font-semibold">Cámara en vivo · Cañón del Atuel y Valle Grande</span><span className="block text-xs text-muted">Río Atuel y ruta provincial 173, las 24 horas. Se abre en el sitio de SkylineWebcams. Es la única cámara pública de la zona que se encontró.</span></span>
        <ExternalLink className="size-4 shrink-0 text-muted" />
      </a>

      <p className="flex flex-wrap gap-x-4 gap-y-1 px-1 pt-2 text-xs text-muted">
        {sources.map(([name, source]) => <span key={name} className={cn(!source.ok && "font-semibold text-warn")}>{name}: {source.ok ? `${hhmm(source.en)} h` : source.en ? `falló; dato de ${when(source.en)}` : "sin dato"}</span>)}
        <span>Satélite: NASA GIBS</span>
      </p>
    </div>
  );
}
