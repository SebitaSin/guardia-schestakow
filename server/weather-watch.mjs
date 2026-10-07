// Vigilancia meteorológica para Contingencia (punto 7 del objetivo).
// Junta en un solo estado: alertas oficiales del SMN (CAP), pronóstico horario (Open-Meteo),
// alertas tempranas calculadas con reglas sobre ese pronóstico, y el estado de El Niño (NOAA).
// Lo oficial y lo calculado nunca se mezclan: cada dato dice de dónde sale y de cuándo es.
import { createHash } from "node:crypto";
import { join } from "node:path";
import { readJson, writeJsonAtomic } from "./store.mjs";
import { addUsage, aiDay, openAiResponses, usageOf } from "./ai.mjs";
import { RADAR_URL, analyzeRadar, radarAlerts } from "./radar-dacc.mjs";

export const HOSPITAL = { lat: -34.6177, lon: -68.3301, nombre: "San Rafael, Mendoza" };
const TTL_MS = 10 * 60_000;
const REGIONAL_KM = 150;
const UA = { "user-agent": "Mozilla/5.0 (compatible; HospitalSchestakow-Contingencia/1.0)" };
const SMN_FEED = "https://ssl.smn.gob.ar/CAP/AR.php";
const NIVEL = { Minor: "amarillo", Moderate: "amarillo", Severe: "naranja", Extreme: "rojo" };
const ORDER = { rojo: 3, naranja: 2, amarillo: 1 };

/**
 * Escala de alerta del hospital, de 1 a 9. Combina GRAVEDAD del fenómeno (1 menor … 4 extremo) con CERTEZA
 * (1 posible, pronóstico lejano · 2 probable, oficial o dentro de 6 h · 3 observado sobre la ciudad), como la matriz
 * impacto × probabilidad del servicio meteorológico británico y los campos severity/certainty del estándar CAP que
 * usa el SMN. Las acciones son una propuesta a validar por la Dirección.
 */
export const GRADOS = [
  { grado: 1, nombre: "Sin riesgo", accion: "Funcionamiento normal." },
  { grado: 2, nombre: "Atención", accion: "Fenómeno menor o lejano. Sin acciones." },
  { grado: 3, nombre: "Vigilancia", accion: "Seguir la evolución cada hora." },
  { grado: 4, nombre: "Preaviso", accion: "Avisar a los jefes de guardia y revisar que las guardias estén cubiertas." },
  { grado: 5, nombre: "Preparación", accion: "Probar el grupo electrógeno, revisar desagües y techos, asegurar insumos y oxígeno." },
  { grado: 6, nombre: "Alistamiento", accion: "Personal de refuerzo en espera y traslado solidario listo para activarse." },
  { grado: 7, nombre: "Emergencia", accion: "Activar el plan de contingencia." },
  { grado: 8, nombre: "Emergencia grave", accion: "Fenómeno extremo inminente: plan de contingencia completo y convocatoria de personal." },
  { grado: 9, nombre: "Catástrofe", accion: "Evento extremo en curso sobre la ciudad: modo catástrofe." },
];
const MATRIX = { 1: [2, 2, 3], 2: [3, 4, 5], 3: [5, 6, 7], 4: [7, 8, 9] };
export const gradeOf = (gravedad, certeza) => MATRIX[Math.max(1, Math.min(4, gravedad))][Math.max(1, Math.min(3, certeza)) - 1];
export const colorOf = (grado) => (grado >= 7 ? "rojo" : grado >= 5 ? "naranja" : grado >= 3 ? "amarillo" : "verde");

const tag = (xml, name) => (xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`))?.[1] ?? "").trim();
const decode = (text) => text.replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16))).replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"');

export function km(a, b) {
  const rad = Math.PI / 180, dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

export function inside(point, polygon) {
  let hit = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if ((a.lon > point.lon) !== (b.lon > point.lon) && point.lat < ((b.lat - a.lat) * (point.lon - a.lon)) / (b.lon - a.lon) + a.lat) hit = !hit;
  }
  return hit;
}

/** Un aviso CAP del SMN, con su relación al hospital: LOCAL (lo cubre), REGIONAL (a menos de 150 km) o null (lejos). */
export function parseCap(xml, url, point = HOSPITAL) {
  const polygons = [...xml.matchAll(/<polygon>([\s\S]*?)<\/polygon>/g)].map((match) => match[1].trim().split(/\s+/).map((pair) => { const [lat, lon] = pair.split(",").map(Number); return { lat, lon }; }).filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon))).filter((polygon) => polygon.length >= 3);
  if (!polygons.length) return null;
  const local = polygons.some((polygon) => inside(point, polygon));
  const distance = local ? 0 : Math.min(...polygons.flatMap((polygon) => polygon.map((vertex) => km(point, vertex))));
  if (!local && distance > REGIONAL_KM) return null;
  const thin = (polygon) => { const step = Math.max(1, Math.ceil(polygon.length / 160)); return polygon.filter((_, index) => index % step === 0).map((p) => [Number(p.lat.toFixed(3)), Number(p.lon.toFixed(3))]); };
  return {
    evento: decode(tag(xml, "event")) || decode(tag(xml, "headline")), nivel: NIVEL[tag(xml, "severity")] ?? "amarillo", severidad: tag(xml, "severity"),
    urgencia: tag(xml, "urgency"), certeza: tag(xml, "certainty"), desde: tag(xml, "onset") || tag(xml, "sent"), hasta: tag(xml, "expires"), emitido: tag(xml, "sent"),
    descripcion: decode(tag(xml, "description")), instrucciones: decode(tag(xml, "instruction")), alcance: local ? "LOCAL" : "REGIONAL", distancia_km: Math.round(distance),
    poligonos: polygons.map(thin), url,
  };
}

function runs(hours, test) {
  const out = []; let current = null;
  hours.forEach((hour, index) => {
    if (test(hour)) { if (!current) { current = { from: index, to: index }; out.push(current); } else current.to = index; }
    else current = null;
  });
  return out;
}

/** Alertas tempranas calculadas con reglas fijas sobre el pronóstico horario. No son alertas oficiales. */
export function computeAlerts(hours) {
  const alerts = [];
  const add = (tipo, titulo, nivel, run, detalle) => alerts.push({ tipo, titulo, nivel, desde: hours[run.from].t, hasta: hours[run.to].t, detalle });
  const peak = (run, key) => Math.max(...hours.slice(run.from, run.to + 1).map((hour) => hour[key] ?? 0));
  const low = (run, key) => Math.min(...hours.slice(run.from, run.to + 1).map((hour) => hour[key] ?? Infinity));
  for (const run of runs(hours, (h) => (h.gust ?? 0) >= 60)) {
    const top = peak(run, "gust");
    add("viento", "Viento fuerte", top >= 100 ? "rojo" : top >= 80 ? "naranja" : "amarillo", run, `Ráfagas de hasta ${Math.round(top)} km/h`);
  }
  // Zonda: viento del oeste en altura que baja seco y cálido. Señales: ráfagas del sector oeste, aire muy seco y flujo fuerte del oeste a 3.000 m.
  const west = (deg) => deg >= 225 && deg <= 350;
  for (const run of runs(hours, (h) => (h.gust ?? 0) >= 40 && west(h.dir ?? -1) && (h.rh ?? 100) <= 25 && west(h.dir700 ?? -1) && (h.wind700 ?? 0) >= 50)) {
    const top = peak(run, "gust");
    add("zonda", "Condiciones de viento Zonda", top >= 70 ? "naranja" : "amarillo", run, `Ráfagas del oeste de hasta ${Math.round(top)} km/h con humedad de ${Math.round(low(run, "rh"))} %`);
  }
  for (const run of runs(hours, (h) => [95, 96, 99].includes(h.code) || ((h.cape ?? 0) >= 800 && (h.prob ?? 0) >= 40))) {
    const top = peak(run, "cape");
    add("tormenta", "Tormentas", top >= 1800 ? "naranja" : "amarillo", run, `Inestabilidad (CAPE) de hasta ${Math.round(top)} J/kg, probabilidad de lluvia de hasta ${Math.round(peak(run, "prob"))} %`);
  }
  for (const run of runs(hours, (h) => [96, 99].includes(h.code) || ((h.cape ?? 0) >= 1500 && (h.li ?? 0) <= -4 && (h.frz ?? 9999) <= 4200 && (h.prob ?? 0) >= 40))) {
    add("granizo", "Riesgo de granizo", "naranja", run, `CAPE de hasta ${Math.round(peak(run, "cape"))} J/kg con isoterma de 0 °C a ${Math.round(low(run, "frz"))} m`);
  }
  // Lluvia: acumulado móvil de 3 horas (anegamientos, aluviones) y de 24 horas.
  const sum = (index, span) => hours.slice(Math.max(0, index - span + 1), index + 1).reduce((total, hour) => total + (hour.rain ?? 0), 0);
  hours.forEach((hour, index) => { hour.rain3 = sum(index, 3); hour.rain24 = sum(index, 24); });
  for (const run of runs(hours, (h) => h.rain3 >= 20)) {
    const top = peak(run, "rain3");
    add("lluvia", "Lluvia intensa: riesgo de anegamiento o aluvión", top >= 40 ? "naranja" : "amarillo", run, `Hasta ${Math.round(top)} mm en 3 horas`);
  }
  for (const run of runs(hours, (h) => h.rain24 >= 50 && h.rain3 < 20)) {
    const top = peak(run, "rain24");
    add("lluvia", "Lluvia persistente: riesgo de inundación", top >= 80 ? "naranja" : "amarillo", run, `Hasta ${Math.round(top)} mm en 24 horas`);
  }
  for (const run of runs(hours, (h) => (h.temp ?? 0) >= 38)) add("calor", "Calor extremo", peak(run, "temp") >= 41 ? "naranja" : "amarillo", run, `Máxima de ${Math.round(peak(run, "temp"))} °C`);
  for (const run of runs(hours, (h) => (h.temp ?? 99) <= -3)) add("frio", "Helada fuerte", "amarillo", run, `Mínima de ${Math.round(low(run, "temp"))} °C`);
  return alerts.sort((a, b) => (ORDER[b.nivel] - ORDER[a.nivel]) || a.desde.localeCompare(b.desde));
}

export function parseForecast(data) {
  const h = data?.hourly ?? {};
  const hours = (h.time ?? []).map((t, i) => ({ t, temp: h.temperature_2m?.[i], rh: h.relative_humidity_2m?.[i], rain: h.precipitation?.[i], prob: h.precipitation_probability?.[i], gust: h.wind_gusts_10m?.[i], dir: h.wind_direction_10m?.[i], cape: h.cape?.[i], li: h.lifted_index?.[i], frz: h.freezing_level_height?.[i], code: h.weather_code?.[i], wind700: h.wind_speed_700hPa?.[i], dir700: h.wind_direction_700hPa?.[i] }));
  const c = data?.current ?? {};
  return { actual: { t: c.time ?? null, temp: c.temperature_2m ?? null, rh: c.relative_humidity_2m ?? null, viento: c.wind_speed_10m ?? null, rafaga: c.wind_gusts_10m ?? null, dir: c.wind_direction_10m ?? null, lluvia: c.precipitation ?? null, code: c.weather_code ?? null }, horas: hours };
}

/** Sismos del INPRES (Instituto Nacional de Prevención Sísmica). El identificador de cada sismo es su hora UTC. */
export function parseInpres(xml, point = HOSPITAL) {
  const out = [];
  for (const block of String(xml ?? "").matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const get = (name) => (block[1].match(new RegExp(`<${name}>\\s*([^<]*?)\\s*</${name}>`))?.[1] ?? "").trim();
    const id = get("idSismo"), lat = Number(get("latitud")), lon = Number(get("longitud")), mg = Number(get("mg"));
    if (!/^\d{14}$/.test(id) || !Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(mg)) continue;
    const en = `${id.slice(0, 4)}-${id.slice(4, 6)}-${id.slice(6, 8)}T${id.slice(8, 10)}:${id.slice(10, 12)}:${id.slice(12, 14)}Z`;
    out.push({ en, lat, lon, mg, prof: Number(get("prof")) || null, prov: get("prov"), sentido: /^f00$/i.test(get("color_link")), km: Math.round(km(point, { lat, lon })) });
  }
  return out.sort((a, b) => b.en.localeCompare(a.en));
}

/** Un sismo fuerte y cercano en las últimas 6 horas pide revisar el hospital, aunque el clima esté en calma. */
export function quakeAlerts(quakes, nowMs) {
  const alerts = [];
  for (const quake of quakes) {
    if (nowMs - Date.parse(quake.en) > 6 * 3_600_000) continue;
    const nivel = quake.mg >= 6 && quake.km <= 300 ? "rojo" : quake.mg >= 5 && quake.km <= 200 ? "naranja" : quake.mg >= 4 && quake.km <= 100 ? "amarillo" : null;
    // Sentido sin daños esperables = 3; daños posibles = 5; daños probables = 7; fuerte y muy cerca = 9.
    const grado = quake.mg >= 6.5 && quake.km <= 100 ? 9 : nivel === "rojo" ? 7 : nivel === "naranja" ? 5 : 3;
    if (nivel) alerts.push({ tipo: "sismo", grado, nivel: colorOf(grado), titulo: `Sismo de magnitud ${quake.mg.toFixed(1)} a ${quake.km} km`, detalle: `${quake.prov}, profundidad ${quake.prof ?? "?"} km`, desde: quake.en, hasta: quake.en });
  }
  return alerts.sort((a, b) => ORDER[b.nivel] - ORDER[a.nivel]);
}

const MODELS = [["ecmwf_ifs025", "ECMWF"], ["gfs_seamless", "GFS"], ["icon_seamless", "ICON"]];

/**
 * Pronóstico a 10 días. El principal es el del Centro Europeo (ECMWF), que es el modelo global de referencia;
 * GFS (Estados Unidos) e ICON (Alemania) se usan sólo para decir cuánto coinciden entre sí cada día.
 */
export function parseExtended(daily, hourly) {
  const d = daily?.daily ?? {}, h = hourly?.hourly ?? {};
  const pick = (name, model, index) => d[`${name}_${model}`]?.[index] ?? null;
  const dias = (d.time ?? []).map((fecha, index) => {
    const otros = MODELS.slice(1).map(([id, nombre]) => ({ nombre, lluvia: pick("precipitation_sum", id, index), tmax: pick("temperature_2m_max", id, index) })).filter((item) => item.lluvia != null);
    const rains = [pick("precipitation_sum", MODELS[0][0], index), ...otros.map((item) => item.lluvia)].filter((value) => value != null);
    const wet = rains.filter((value) => value >= 1).length, top = Math.max(0, ...rains), low = Math.min(...rains);
    // Acuerdo sobre la lluvia: todos secos o todos con lluvia parecida = alto; discuten cuánta = medio; uno dice lluvia fuerte y otro nada = bajo.
    const acuerdo = rains.length < 2 ? null : wet === 0 || (wet === rains.length && top - low <= Math.max(5, top * 0.5)) ? "alto" : top >= 10 && low < top * 0.3 ? "bajo" : "medio";
    return { fecha, code: pick("weather_code", MODELS[0][0], index), tmax: pick("temperature_2m_max", MODELS[0][0], index), tmin: pick("temperature_2m_min", MODELS[0][0], index), lluvia: pick("precipitation_sum", MODELS[0][0], index), prob: pick("precipitation_probability_max", MODELS[0][0], index), rafaga: pick("wind_gusts_10m_max", MODELS[0][0], index), dir: pick("wind_direction_10m_dominant", MODELS[0][0], index), acuerdo, otros };
  }).filter((day) => day.tmax != null);
  const horas = (h.time ?? []).map((t, i) => ({ t, temp: h.temperature_2m?.[i] ?? null, rain: h.precipitation?.[i] ?? null, prob: h.precipitation_probability?.[i] ?? null, gust: h.wind_gusts_10m?.[i] ?? null, code: h.weather_code?.[i] ?? null }));
  return dias.length ? { modelo: "ECMWF IFS", comparados: MODELS.map(([, nombre]) => nombre), dias, horas } : null;
}

export function parseEnso(oniText, weeklyText) {
  const oniLine = String(oniText ?? "").trim().split("\n").filter((line) => /^\s*[A-Z]{3}\s+\d{4}/.test(line)).pop()?.trim().split(/\s+/) ?? [];
  const weekLine = String(weeklyText ?? "").trim().split("\n").filter((line) => /^\s*\d{2}[A-Z]{3}\d{4}/.test(line)).pop() ?? "";
  const numbers = weekLine.replace(/^\s*\S+/, "").match(/-?\d+\.\d/g)?.map(Number) ?? [];
  const oni = oniLine.length >= 4 ? Number(oniLine[3]) : null;
  const nombre = oni == null || Number.isNaN(oni) ? null : oni >= 2 ? "El Niño muy fuerte" : oni >= 1.5 ? "El Niño fuerte" : oni >= 1 ? "El Niño moderado" : oni >= 0.5 ? "El Niño débil" : oni <= -1.5 ? "La Niña fuerte" : oni <= -1 ? "La Niña moderada" : oni <= -0.5 ? "La Niña débil" : "Neutral";
  return { oni: oni == null || Number.isNaN(oni) ? null : oni, trimestre: oniLine.length >= 2 ? `${oniLine[0]} ${oniLine[1]}` : null, nombre, semana: weekLine.trim().split(/\s+/)[0] || null, nino34: numbers.length >= 6 ? numbers[5] : null };
}

/**
 * Grado de alerta del hospital (1 a 9): el más alto entre la alerta oficial que cubre la ciudad, lo que el radar ve
 * ahora, los sismos y lo que anticipa el pronóstico. Una alerta oficial sólo regional no sube el grado.
 * Lo que queda en grado 2 o menos no figura como alerta: pasa a `menores`.
 */
export function alertLevel(state, nowMs = Date.now()) {
  const motivos = [];
  const radarAlerts = state.radar?.datos?.alertas ?? [];
  const overCity = radarAlerts.some((alert) => alert.grado >= 5 && / sobre San Rafael/.test(alert.titulo));
  const hoursTo = (iso) => { const at = Date.parse(/[zZ]|[+-]\d\d:\d\d$/.test(String(iso)) ? iso : `${iso}:00-03:00`); return Number.isFinite(at) ? (at - nowMs) / 3_600_000 : 0; };
  for (const alert of state.oficial?.datos?.alertas ?? []) {
    if (alert.alcance !== "LOCAL") continue;
    const gravedad = { amarillo: 2, naranja: 3, rojo: 4 }[alert.nivel] ?? 2;
    const inForce = hoursTo(alert.desde) <= 0 && hoursTo(alert.hasta) >= 0;
    const certeza = alert.certeza === "Observed" || (inForce && overCity) ? 3 : alert.certeza === "Possible" || hoursTo(alert.desde) > 24 ? 1 : 2;
    alert.grado = gradeOf(gravedad, certeza);
    motivos.push({ grado: alert.grado, origen: "SMN", texto: `${alert.evento}${certeza === 3 ? " (confirmado por el radar)" : ""}` });
  }
  for (const alert of radarAlerts) motivos.push({ grado: alert.grado ?? 3, origen: "Radar", texto: alert.titulo });
  for (const alert of state.sismos?.datos?.alertas ?? []) motivos.push({ grado: alert.grado ?? 3, origen: "Sismo", texto: alert.titulo });
  for (const alert of state.hidro?.datos?.alertas ?? []) motivos.push({ grado: alert.grado, origen: "Medición INA", texto: alert.titulo });
  const forecast = state.pronostico?.datos;
  if (forecast?.alertas) {
    for (const alert of forecast.alertas) {
      // Señal débil de tormenta o una helada: fenómeno menor. Lo demás, según el umbral que superó.
      const gravedad = (alert.tipo === "tormenta" && alert.nivel === "amarillo") || alert.tipo === "frio" ? 1 : { amarillo: 2, naranja: 3, rojo: 4 }[alert.nivel] ?? 2;
      alert.grado = gradeOf(gravedad, hoursTo(alert.desde) <= 6 ? 2 : 1); // un modelo solo nunca es "observado"
      motivos.push({ grado: alert.grado, origen: "Pronóstico", texto: alert.titulo });
    }
    forecast.menores = forecast.alertas.filter((alert) => alert.grado <= 2);
    forecast.alertas = forecast.alertas.filter((alert) => alert.grado > 2).map((alert) => ({ ...alert, nivel: colorOf(alert.grado) }));
  }
  motivos.sort((a, b) => b.grado - a.grado);
  const incompleto = [state.oficial, state.pronostico, state.radar].some((source) => !source?.ok) || state.radar?.datos?.vigente === false;
  const grado = motivos[0]?.grado ?? 1;
  const step = GRADOS[grado - 1];
  return { grado, color: colorOf(grado), nombre: step.nombre, accion: step.accion, motivos: motivos.slice(0, 6).map((item) => ({ ...item, nivel: colorOf(item.grado) })), incompleto, escala: GRADOS };
}

/**
 * Mediciones reales (no pronóstico) de la Red Hidrológica Nacional, publicadas por el INA (alerta.ina.gob.ar):
 * altura de los ríos Diamante y Atuel aguas arriba y aguas abajo de San Rafael, y lluvia caída en estaciones cercanas.
 * Llegan con 2 a 5 horas de atraso. Esos puntos no tienen niveles oficiales de alerta: se informa la tendencia.
 */
export const HIDRO = {
  rios: [
    { serie: 8233, rio: "Diamante", nombre: "La Jaula", donde: "aguas arriba, antes de los diques", km: 90, arriba: true },
    { serie: 36905, rio: "Diamante", nombre: "Monte Comán", donde: "aguas abajo de la ciudad", km: 43, arriba: false },
    { serie: 9192, rio: "Atuel", nombre: "La Angostura", donde: "aguas arriba, antes de El Nihuil", km: 73, arriba: true },
    { serie: 6866, rio: "Atuel", nombre: "Carmensa", donde: "aguas abajo", km: 83, arriba: false },
  ],
  lluvia: [
    { serie: 8997, nombre: "El Tigre (río Diamante)", km: 25 },
    { serie: 39095, nombre: "Las Malvinas", km: 37 },
    { serie: 6966, nombre: "Villa Atuel", km: 43 },
    { serie: 6859, nombre: "El Nihuil", km: 56 },
    { serie: 9013, nombre: "La Angostura", km: 73 },
  ],
};
const cleanObs = (rows) => (Array.isArray(rows) ? rows : []).map((row) => ({ at: Date.parse(row.timestart), v: row.valor })).filter((row) => Number.isFinite(row.at) && typeof row.v === "number" && Number.isFinite(row.v)).sort((a, b) => a.at - b.at);
const r2 = (value) => Math.round(value * 100) / 100;

export function riverReading(rows, nowMs) {
  const obs = cleanObs(rows).filter((row) => row.v > -5 && row.v < 30);
  const last = obs.at(-1);
  if (!last) return null;
  const back = (hours) => { const target = last.at - hours * 3_600_000; const hit = obs.filter((row) => row.at <= target && row.at >= target - 5 * 3_600_000).at(-1); return hit ? r2(last.v - hit.v) : null; };
  const cambio_6h = back(6), cambio_24h = back(24);
  const week = obs.filter((row) => row.at >= last.at - 7 * 86_400_000).map((row) => row.v);
  return { t: new Date(last.at).toISOString(), m: last.v, hace_h: Math.round((nowMs - last.at) / 3_600_000), cambio_6h, cambio_24h, min7: Math.min(...week), max7: Math.max(...week),
    tendencia: (cambio_24h ?? 0) >= 0.05 ? "sube" : (cambio_24h ?? 0) <= -0.05 ? "baja" : "estable", rapido: (cambio_6h ?? 0) >= 0.25 || (cambio_24h ?? 0) >= 0.5 };
}

export function rainReading(rows, nowMs) {
  const all = cleanObs(rows);
  // Un pluviómetro que marca más de 120 mm en un registro está fallando (visto en El Tigre el 6/10/2026: 320 y 576): se descarta.
  const obs = all.filter((row) => row.v >= 0 && row.v <= 120);
  const last = obs.at(-1);
  if (!last) return null;
  const sum = (hours) => r2(obs.filter((row) => row.at > last.at - hours * 3_600_000).reduce((total, row) => total + row.v, 0));
  return { t: new Date(last.at).toISOString(), hace_h: Math.round((nowMs - last.at) / 3_600_000), mm_3h: sum(3), mm_24h: sum(24), descartados: all.filter((row) => row.at > last.at - 86_400_000).length - obs.filter((row) => row.at > last.at - 86_400_000).length };
}

/** Alertas por lo medido: lluvia intensa caída a 45 km o menos (dato de hasta 6 h) y río en ascenso rápido aguas arriba. */
export function hydroAlerts(datos) {
  const alerts = [];
  for (const item of datos?.lluvia ?? []) {
    if (!item.lectura || item.km > 45 || item.lectura.hace_h > 6 || item.lectura.mm_3h < 20) continue;
    const grado = item.lectura.mm_3h >= 40 ? 6 : 4;
    alerts.push({ tipo: "lluvia_medida", grado, nivel: colorOf(grado), titulo: `Lluvia intensa medida en ${item.nombre}, a ${item.km} km`, detalle: `${item.lectura.mm_3h} mm en 3 horas (medición de hace ${item.lectura.hace_h} h)`, desde: item.lectura.t, hasta: item.lectura.t });
  }
  for (const item of datos?.rios ?? []) {
    if (!item.lectura?.rapido || !item.arriba || item.lectura.hace_h > 8) continue;
    alerts.push({ tipo: "rio", grado: 3, nivel: "amarillo", titulo: `Río ${item.rio} en ascenso rápido en ${item.nombre} (${item.donde})`, detalle: `Subió ${item.lectura.cambio_6h ?? "?"} m en 6 horas y ${item.lectura.cambio_24h ?? "?"} m en 24 horas; ahora ${item.lectura.m} m`, desde: item.lectura.t, hasta: item.lectura.t });
  }
  return alerts.sort((a, b) => b.grado - a.grado);
}

async function getText(fetchImpl, url, ms = 20_000) {
  const response = await fetchImpl(url, { headers: UA, signal: AbortSignal.timeout(ms) });
  if (!response.ok) throw new Error(`http_${response.status}`);
  return response.text();
}

export function createWeatherWatch({ dataDir, fetchImpl = fetch, env = process.env, now = () => new Date(), onLevelChange = null }) {
  const capCache = new Map();
  const statePath = join(dataDir, "clima", "estado.json");
  const historyPath = join(dataDir, "clima", "historial.json");
  let state = readJson(statePath, null);
  let loading = null;

  async function official() {
    const feed = await getText(fetchImpl, SMN_FEED);
    // Una página que no es el listado del SMN (bloqueo, mantenimiento) no significa "sin alertas".
    if (!/CAP/i.test(feed)) throw new Error("listado_no_reconocido");
    const urls = [...new Set([...feed.matchAll(/https:\/\/ssl\.smn\.gob\.ar\/feeds\/CAP\/[^"<\s]+\.xml/g)].map((match) => match[0]))];
    for (const url of [...capCache.keys()]) if (!urls.includes(url)) capCache.delete(url);
    const missing = urls.filter((url) => !capCache.has(url));
    for (let i = 0; i < missing.length; i += 8) {
      await Promise.all(missing.slice(i, i + 8).map(async (url) => { try { capCache.set(url, parseCap(await getText(fetchImpl, url, 15_000), url)); } catch { /* se reintenta en la próxima vuelta */ } }));
    }
    const live = now().getTime(), seen = new Set(), alerts = [];
    for (const url of urls) {
      const alert = capCache.get(url);
      if (!alert || (alert.hasta && Date.parse(alert.hasta) < live)) continue;
      const key = `${alert.evento}|${alert.desde}|${alert.hasta}|${alert.alcance}|${alert.nivel}`;
      if (seen.has(key)) { alerts.find((item) => item.key === key)?.poligonos.push(...alert.poligonos); continue; }
      seen.add(key); alerts.push({ key, ...alert });
    }
    alerts.sort((a, b) => (a.alcance === b.alcance ? 0 : a.alcance === "LOCAL" ? -1 : 1) || (ORDER[b.nivel] - ORDER[a.nivel]) || String(a.desde).localeCompare(String(b.desde)));
    return { alertas: alerts.map(({ key, ...alert }) => alert), avisos_en_el_pais: urls.length, leidos: urls.filter((url) => capCache.has(url)).length };
  }

  async function forecast() {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${HOSPITAL.lat}&longitude=${HOSPITAL.lon}&timezone=America%2FArgentina%2FMendoza&forecast_days=3&current=temperature_2m,relative_humidity_2m,wind_speed_10m,wind_gusts_10m,wind_direction_10m,precipitation,weather_code&hourly=temperature_2m,relative_humidity_2m,precipitation,precipitation_probability,wind_gusts_10m,wind_direction_10m,cape,lifted_index,freezing_level_height,weather_code,wind_speed_700hPa,wind_direction_700hPa`;
    const parsed = parseForecast(JSON.parse(await getText(fetchImpl, url)));
    if (!parsed.horas.length) throw new Error("sin_horas");
    const stamp = new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Argentina/Mendoza", dateStyle: "short", timeStyle: "short" }).format(now()).replace(" ", "T");
    const next = parsed.horas.filter((hour) => hour.t >= stamp.slice(0, 13) + ":00").slice(0, 48);
    // Extendido a 10 días: si falla, lo de 48 horas y las alertas siguen igual.
    let extendido = null;
    try {
      const base = `https://api.open-meteo.com/v1/forecast?latitude=${HOSPITAL.lat}&longitude=${HOSPITAL.lon}&timezone=America%2FArgentina%2FMendoza&forecast_days=10`;
      const [daily, hourly] = await Promise.all([
        getText(fetchImpl, `${base}&models=${MODELS.map(([id]) => id).join(",")}&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_gusts_10m_max,wind_direction_10m_dominant`),
        getText(fetchImpl, `${base}&models=${MODELS[0][0]}&hourly=temperature_2m,precipitation,precipitation_probability,wind_gusts_10m,weather_code`),
      ]);
      extendido = parseExtended(JSON.parse(daily), JSON.parse(hourly));
    } catch { extendido = state?.pronostico?.datos?.extendido ?? null; }
    return { actual: parsed.actual, horas: next.map(({ t, temp, rh, rain, prob, gust, cape, frz, dir700, wind700 }) => ({ t, temp, rh, rain, prob, gust, cape, frz, dir700, wind700 })), alertas: computeAlerts(next), extendido };
  }

  /** Radar de la DACC (compuesto Sur): se baja la imagen y se mide el eco cerca de la ciudad. */
  async function radar() {
    const response = await fetchImpl(RADAR_URL, { headers: UA, signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`http_${response.status}`);
    const modified = Date.parse(response.headers?.get?.("last-modified") ?? "");
    const reading = analyzeRadar(new Uint8Array(await response.arrayBuffer()));
    const imagen = Number.isFinite(modified) ? new Date(modified).toISOString() : null;
    // Una imagen de más de 25 minutos no describe lo que pasa ahora: se muestra, pero no dispara alertas.
    const vigente = imagen != null && now().getTime() - modified < 25 * 60_000;
    return { imagen, vigente, lectura: reading, alertas: vigente ? radarAlerts(reading, imagen) : [] };
  }

  async function quakes() {
    const list = parseInpres(await getText(fetchImpl, "https://www.inpres.gob.ar/mapa/sismos.xml"));
    if (!list.length) throw new Error("sin_sismos");
    return { lista: list.slice(0, 30), alertas: quakeAlerts(list, now().getTime()) };
  }

  async function enso() {
    const [oni, weekly] = await Promise.all([getText(fetchImpl, "https://www.cpc.ncep.noaa.gov/data/indices/oni.ascii.txt"), getText(fetchImpl, "https://www.cpc.ncep.noaa.gov/data/indices/wksst9120.for")]);
    const parsed = parseEnso(oni, weekly);
    if (parsed.oni == null) throw new Error("sin_oni");
    return parsed;
  }

  /** Ríos y lluvia medidos (INA). Se actualizan cada hora en origen: acá se consultan cada 30 minutos. */
  let hydroCache = null;
  async function hydro() {
    if (hydroCache && now().getTime() - hydroCache.at < 30 * 60_000) return hydroCache.datos;
    const stamp = (ms) => new Date(ms).toISOString().slice(0, 19);
    const series = async (id, days) => JSON.parse(await getText(fetchImpl, `https://alerta.ina.gob.ar/a5/obs/puntual/observaciones?series_id=${id}&timestart=${stamp(now().getTime() - days * 86_400_000)}&timeend=${stamp(now().getTime() + 86_400_000)}&format=json`, 25_000));
    const read = async (item, days, parse) => { try { return { ...item, lectura: parse(await series(item.serie, days), now().getTime()) }; } catch { return { ...item, lectura: null }; } };
    const [rios, lluvia] = await Promise.all([Promise.all(HIDRO.rios.map((item) => read(item, 8, riverReading))), Promise.all(HIDRO.lluvia.map((item) => read(item, 2, rainReading)))]);
    if (![...rios, ...lluvia].some((item) => item.lectura)) throw new Error("sin_mediciones");
    const datos = { rios, lluvia };
    datos.alertas = hydroAlerts(datos);
    hydroCache = { at: now().getTime(), datos };
    return datos;
  }

  /** Parte breve escrito por IA a partir de los datos ya calculados. Opcional, con tope de frecuencia y dentro del tope mensual de gasto. */
  async function brief(next, previous) {
    const enabled = String(env.AI_WEATHER_BRIEF ?? "false").toLowerCase() === "true" && env.OPENAI_API_KEY && env.OPENAI_MODEL;
    const facts = { sismos: next.sismos?.datos?.alertas ?? [], radar: next.radar?.datos?.alertas ?? [], oficiales: (next.oficial.datos?.alertas ?? []).map(({ evento, nivel, desde, hasta, alcance, distancia_km }) => ({ evento, nivel, desde, hasta, alcance, distancia_km })), calculadas: next.pronostico.datos?.alertas ?? [], enso: next.enso.datos ? { nombre: next.enso.datos.nombre, oni: next.enso.datos.oni } : null };
    const firma = createHash("sha256").update(JSON.stringify(facts)).digest("hex").slice(0, 16);
    if (!enabled) return previous ?? null;
    if (previous?.firma === firma) return previous;
    if (previous?.en && now().getTime() - Date.parse(previous.en) < 60 * 60_000) return previous; // como mucho uno por hora
    if (!facts.oficiales.length && !facts.calculadas.length && !facts.radar.length && !facts.sismos.length) return { firma, en: now().toISOString(), texto: null };
    const usagePath = join(dataDir, "ai", `usage-${now().toISOString().slice(0, 7)}.json`);
    const usage = readJson(usagePath, { calls: 0, inputTokens: 0, outputTokens: 0, estimatedUsd: 0 });
    if (usage.estimatedUsd >= Number(env.AI_MONTHLY_BUDGET_USD ?? 0) || usage.calls >= Number(env.AI_MONTHLY_CALL_LIMIT ?? 0)) return previous ?? null;
    // Tope diario: el parte de clima sólo usa hasta la mitad; el resto queda para leer fotos de pizarras, que importan más.
    const daily = Number(env.AI_DAILY_BUDGET_USD ?? 0);
    if (daily > 0 && (usage.dias?.[aiDay(now())] ?? 0) > daily / 2) return previous ?? null;
    // Es sólo redacción sobre datos ya calculados: va con el modelo más económico y sin razonamiento. Si la cuenta
    // no lo tiene habilitado (error 400/403/404), se usa el modelo general de la app.
    const prompt = `Sos el meteorólogo de guardia de un hospital público de San Rafael, Mendoza. Con estos datos (alertas oficiales del SMN, alertas calculadas sobre el pronóstico y estado de El Niño) escribí un parte en español rioplatense de no más de 90 palabras: qué se espera y cuándo, y después hasta tres acciones concretas para preparar el hospital (personal, energía, accesos, ambulancias, insumos). No inventes datos ni horarios que no estén acá. No uses listas ni títulos.\n\n${JSON.stringify(facts)}`;
    const ask = (model, effort) => openAiResponses({ apiKey: env.OPENAI_API_KEY, fetchImpl, timeoutMs: 45_000, body: { model, store: false, reasoning: { effort }, max_output_tokens: effort === "none" ? 250 : 1200, input: prompt } });
    let model = env.AI_BRIEF_MODEL || "gpt-6-luna", answer;
    try { answer = await ask(model, "none"); }
    catch (error) {
      if (!/^openai_http_(400|403|404)$/.test(String(error?.message)) || model === env.OPENAI_MODEL) throw error;
      model = env.OPENAI_MODEL; answer = await ask(model, "low");
    }
    const raw = answer.raw;
    const text = (raw.output ?? []).flatMap((item) => item.content ?? []).find((item) => item.type === "output_text")?.text?.trim() ?? "";
    writeJsonAtomic(usagePath, addUsage(readJson(usagePath, usage), { ...usageOf(raw, model, { inputRate: Number(env.AI_INPUT_USD_PER_MILLION ?? 0), outputRate: Number(env.AI_OUTPUT_USD_PER_MILLION ?? 0) }), tarea: "parte_clima", modelo: model }, now()));
    return text ? { firma, en: now().toISOString(), texto: text, modelo: model } : previous ?? null;
  }

  async function refresh() {
    const at = now().toISOString();
    // Si una fuente falla, queda su último dato bueno con su hora y el aviso de que está desactualizado.
    const source = async (name, load) => {
      try { return { ok: true, en: at, datos: await load() }; }
      catch (error) { return { ok: false, en: state?.[name]?.en ?? null, datos: state?.[name]?.datos ?? null, error: String(error?.message ?? "error").slice(0, 60) }; }
    };
    const [oficial, pronostico, ensoState, radarState] = await Promise.all([source("oficial", official), source("pronostico", forecast), source("enso", enso), source("radar", radar)]);
    const sismos = await source("sismos", quakes);
    const hidro = await source("hidro", hydro);
    const next = { en: at, lugar: HOSPITAL, oficial, pronostico, enso: ensoState, radar: radarState, sismos, hidro, parte: state?.parte ?? null };
    // El radar se evalúa con el viento a 3.000 m de esta hora: una celda lejana sólo cuenta si viene hacia la ciudad.
    if (radarState.datos?.lectura && radarState.datos.vigente) {
      const hour = (pronostico.datos?.horas ?? []).find((item) => Date.parse(`${item.t}:00-03:00`) + 3_600_000 > now().getTime());
      radarState.datos.viento_altura = hour && Number.isFinite(hour.dir700) ? { dir: hour.dir700, kmh: hour.wind700 } : null;
      // La DACC publica barridos distintos cada pocos minutos y alguno sale casi vacío (visto el 7/10/2026: 06:24 con
      // 9 celdas, 06:26 con ninguna). Para que la alerta no parpadee, vale la lectura más grave de los últimos 12 minutos.
      const data = radarState.datos;
      const earlier = (state?.radar?.datos?.recientes ?? []).filter((item) => item.imagen !== data.imagen && now().getTime() - Date.parse(item.imagen) < 12 * 60_000);
      data.recientes = [{ imagen: data.imagen, lectura: data.lectura }, ...earlier].slice(0, 4);
      const top = (alerts) => Math.max(0, ...alerts.map((alert) => alert.grado));
      data.alertas = data.recientes.map((item) => radarAlerts(item.lectura, item.imagen, data.viento_altura)).sort((a, b) => top(b) - top(a))[0];
    }
    next.nivel = alertLevel(next, now().getTime());
    // Cambio de nivel: queda en el historial y se avisa. El primer cálculo no cuenta como cambio.
    const before = state?.nivel?.color ?? null;
    if (before && before !== next.nivel.color) {
      const change = { en: at, de: before, a: next.nivel.color, gradoDe: state?.nivel?.grado ?? null, gradoA: next.nivel.grado, motivos: next.nivel.motivos.slice(0, 4) };
      try {
        const history = readJson(historyPath, []);
        history.unshift(change);
        writeJsonAtomic(historyPath, history.slice(0, 300));
      } catch { /* el historial no frena nada */ }
      try { onLevelChange?.(change); } catch { /* el aviso es accesorio */ }
    }
    try { next.cambios = readJson(historyPath, []).slice(0, 8); } catch { next.cambios = []; }
    try { next.parte = await brief(next, state?.parte ?? null); } catch { /* el parte de IA es opcional: nunca frena lo demás */ }
    state = next;
    try { writeJsonAtomic(statePath, state); } catch { /* disco no disponible: sigue en memoria */ }
    return state;
  }

  return {
    async get() {
      if (state?.en && now().getTime() - Date.parse(state.en) < TTL_MS) return state;
      loading ??= refresh().finally(() => { loading = null; });
      return state ?? loading; // con dato previo responde enseguida y actualiza por detrás
    },
    refresh,
  };
}
