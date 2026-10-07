import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readFileSync } from "node:fs";
import { alertLevel, colorOf, gradeOf, quakeIntensity, steeringWind, hydroAlerts, rainReading, riverReading, computeAlerts, createWeatherWatch, inside, parseCap, parseEnso, parseExtended, parseInpres, quakeAlerts } from "./weather-watch.mjs";

test("los sismos del INPRES se leen con su hora, distancia y si fueron sentidos", () => {
  const list = parseInpres(readFileSync(new URL("./fixtures/inpres-20261006.xml", import.meta.url), "utf8"));
  assert.equal(list.length, 30);
  assert.deepEqual([list[0].en, list[0].mg, list[0].prov, list[0].sentido, list[0].prof], ["2026-10-06T20:28:32Z", 3.8, "SAN JUAN", true, 117]);
  assert.ok(list[0].km > 250 && list[0].km < 350, String(list[0].km));
  const now = Date.parse("2026-10-06T21:00:00Z");
  assert.deepEqual(quakeAlerts(list, now), []); // 3,8 a 300 km no es alerta
  const near = [{ en: "2026-10-06T20:00:00Z", mg: 5.4, km: 80, prov: "MENDOZA", prof: 20 }, { en: "2026-10-06T19:00:00Z", mg: 4.2, km: 60, prov: "MENDOZA", prof: 10 }, { en: "2026-10-05T19:00:00Z", mg: 6.5, km: 50, prov: "MENDOZA", prof: 10 }];
  assert.deepEqual(quakeAlerts(near, now).map((a) => [a.grado, a.nivel]), [[3, "amarillo"]]); // el 4,2 casi no se siente; el de hace más de 24 h ya no alerta
  // Intensidad estimada en la ciudad en vez de tabla fija de magnitud y distancia.
  const q = (mg, km, prof, hoursAgo = 1) => quakeAlerts([{ en: new Date(now - hoursAgo * 3_600_000).toISOString(), mg, km, prof, prov: "X" }], now)[0]?.grado ?? 0;
  assert.deepEqual([q(6.7, 64, 40), q(5.6, 15, 10), q(6.0, 300, 30), q(5.0, 200, 30), q(8.8, 445, 30), q(6.0, 120, 150), q(4.3, 60, 20)], [8, 8, 0, 0, 5, 3, 0]); // 1929 (6,7 a 64 km) · 5,6 bajo la ciudad · 6,0 a 300 km · 5,0 a 200 km · 8,8 en Chile · 6,0 profundo · 4,3 a 60 km
  assert.deepEqual([q(6.7, 64, 40, 7), q(6.7, 64, 40, 25), q(5.4, 80, 20, 7)], [8, 0, 0]); // uno fuerte sigue visible 24 h; uno leve, 6
  assert.equal(quakeIntensity({ mg: 6.7, km: 64, prof: 40 }), 6.5);
});

test("el pronóstico a 10 días usa ECMWF y dice cuánto coinciden los modelos", () => {
  const daily = { daily: { time: ["2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10"],
    weather_code_ecmwf_ifs025: [61, 3, 63, 61], temperature_2m_max_ecmwf_ifs025: [18, 20, 12, 15], temperature_2m_min_ecmwf_ifs025: [11, 9, 9, 8],
    precipitation_sum_ecmwf_ifs025: [10.7, 0.2, 36.8, 8], precipitation_probability_max_ecmwf_ifs025: [83, 12, 79, 60], wind_gusts_10m_max_ecmwf_ifs025: [36, 26, 34, 30], wind_direction_10m_dominant_ecmwf_ifs025: [167, 98, 184, 150],
    precipitation_sum_gfs_seamless: [9, 0, 1.7, 2], temperature_2m_max_gfs_seamless: [19, 21, 17, 15], precipitation_sum_icon_seamless: [11.2, 0.1, null, null], temperature_2m_max_icon_seamless: [15, 19, null, null] } };
  const out = parseExtended(daily, { hourly: { time: ["2026-10-07T00:00"], temperature_2m: [12], precipitation: [0.4], wind_gusts_10m: [20], weather_code: [61], precipitation_probability: [70] } });
  assert.deepEqual(out.dias.map((day) => day.acuerdo), ["alto", "alto", "bajo", "medio"]);
  assert.deepEqual([out.dias[2].lluvia, out.dias[2].otros.map((o) => o.nombre)], [36.8, ["GFS"]]);
  assert.deepEqual(out.horas[0], { t: "2026-10-07T00:00", temp: 12, rain: 0.4, prob: 70, gust: 20, code: 61 });
  assert.equal(parseExtended({}, {}), null);
});

const radarGif = readFileSync(new URL("./fixtures/radar-sur-20261006-2130.gif", import.meta.url));

test("grado de alerta 1 a 9: gravedad × certeza; lo regional y lo menor no lo suben", () => {
  const ok = (datos) => ({ ok: true, datos });
  const NOW = Date.parse("2026-10-07T12:00:00-03:00");
  const base = () => ({ oficial: ok({ alertas: [] }), pronostico: ok({ alertas: [] }), radar: ok({ vigente: true, alertas: [] }) });
  assert.deepEqual([gradeOf(1, 3), gradeOf(2, 1), gradeOf(2, 3), gradeOf(3, 2), gradeOf(4, 3)], [3, 3, 5, 6, 9]);
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 9].map(colorOf), ["verde", "verde", "amarillo", "amarillo", "naranja", "naranja", "rojo", "rojo"]);
  const calm = { ...base(), oficial: ok({ alertas: [{ alcance: "REGIONAL", nivel: "rojo", evento: "Nevadas" }] }) };
  assert.deepEqual([alertLevel(calm, NOW).grado, alertLevel(calm, NOW).color, alertLevel(calm, NOW).nombre, alertLevel(calm, NOW).motivos], [1, "verde", "Sin riesgo", []]);
  // Señal débil de tormenta para mañana: grado 2, no figura como alerta.
  const weak = { ...base(), pronostico: ok({ alertas: [{ tipo: "tormenta", nivel: "amarillo", titulo: "Tormentas", desde: "2026-10-08T15:00" }] }) };
  const weakLevel = alertLevel(weak, NOW);
  assert.deepEqual([weakLevel.grado, weakLevel.color, weak.pronostico.datos.alertas.length, weak.pronostico.datos.menores.length], [2, "verde", 0, 1]);
  // Granizo sólo en el modelo: describe el ambiente, no una tormenta. Lejos 3; en las próximas 6 horas 4.
  const hail = (desde) => alertLevel({ ...base(), pronostico: ok({ alertas: [{ tipo: "granizo", nivel: "naranja", titulo: "Riesgo de granizo", desde }] }) }, NOW).grado;
  assert.deepEqual([hail("2026-10-08T15:00"), hail("2026-10-07T15:00")], [3, 4]);
  // Alerta naranja del SMN vigente: 6. Con tormenta fuerte en el radar sigue en 6; pasa a 7 recién con núcleo de granizo persistente y cerca del hospital.
  const smn = { alcance: "LOCAL", nivel: "naranja", evento: "Tormentas", desde: "2026-10-07T09:00:00-03:00", hasta: "2026-10-07T21:00:00-03:00", certeza: "Likely" };
  assert.equal(alertLevel({ ...base(), oficial: ok({ alertas: [{ ...smn }] }) }, NOW).grado, 6);
  const typical = alertLevel({ ...base(), oficial: ok({ alertas: [{ ...smn }] }), radar: ok({ vigente: true, alertas: [{ grado: 5, titulo: "Tormenta fuerte con posible granizo sobre San Rafael", detalle: "x" }] }) }, NOW);
  assert.deepEqual([typical.grado, typical.color], [6, "naranja"]);
  const both = alertLevel({ ...base(), oficial: ok({ alertas: [{ ...smn }] }), radar: ok({ vigente: true, alertas: [{ grado: 7, titulo: "Granizo probable sobre San Rafael", detalle: "x" }] }) }, NOW);
  assert.deepEqual([both.grado, both.color, both.nombre, both.motivos[0].origen], [7, "rojo", "Emergencia", "SMN"]);
  // Núcleo de 60 dBZ pero lejos del hospital (grado 6 del radar): ningún camino pasa de 6.
  assert.equal(alertLevel({ ...base(), oficial: ok({ alertas: [{ ...smn }] }), radar: ok({ vigente: true, alertas: [{ grado: 6, titulo: "Tormenta muy fuerte con granizo probable sobre San Rafael", detalle: "x" }] }) }, NOW).grado, 6);
  // Por clima no se llega a 9: eso queda para un sismo destructivo.
  assert.equal(alertLevel({ ...base(), oficial: ok({ alertas: [{ ...smn, nivel: "rojo" }] }), radar: ok({ vigente: true, alertas: [{ grado: 8, titulo: "Núcleo de granizo extenso sobre San Rafael", detalle: "x" }] }) }, NOW).grado, 8);
  assert.deepEqual(steeringWind({ dir700: 270, wind700: 40, dir500: 270, wind500: 60 }), { dir: 270, kmh: 50 });
  assert.equal(steeringWind({ dir700: 270, wind700: 40 }).kmh, 40);
  assert.equal(alertLevel({ ...base(), oficial: ok({ alertas: [{ ...smn, nivel: "amarillo", certeza: "Possible" }] }) }, NOW).grado, 3);
  assert.equal(alertLevel({ ...base(), radar: { ok: false, datos: null } }, NOW).incompleto, true);
});

const cap = (polygon, extra = "") => `<alert><sent>2026-10-06T09:09:31-03:00</sent><info><event>Viento Zonda</event><severity>Severe</severity><onset>2026-10-06T15:00:00-03:00</onset><expires>2026-10-07T08:59:59-03:00</expires><description>R&#xE1;fagas</description><instruction>Cerr&#xE1; ventanas</instruction>${extra}<area><polygon>${polygon}</polygon></area></info></alert>`;
const AROUND = "-34,-69 -34,-68 -35,-68 -35,-69 -34,-69";
const NEAR = "-33.6,-69 -33.6,-68 -33.9,-68 -33.9,-69 -33.6,-69";
const FAR = "-25,-60 -25,-59 -26,-59 -26,-60 -25,-60";

test("un aviso CAP se clasifica por su relación con el hospital", () => {
  assert.equal(inside({ lat: -34.6, lon: -68.3 }, [{ lat: -34, lon: -69 }, { lat: -34, lon: -68 }, { lat: -35, lon: -68 }, { lat: -35, lon: -69 }]), true);
  const local = parseCap(cap(AROUND), "u");
  assert.deepEqual([local.alcance, local.nivel, local.evento, local.descripcion, local.distancia_km], ["LOCAL", "naranja", "Viento Zonda", "Ráfagas", 0]);
  assert.equal(parseCap(cap(NEAR), "u").alcance, "REGIONAL");
  assert.equal(parseCap(cap(FAR), "u"), null);
  assert.equal(parseCap("<alert></alert>", "u"), null);
});

test("las alertas calculadas salen de umbrales fijos y un día calmo no genera ninguna", () => {
  const hour = (i, extra = {}) => ({ t: `2026-10-07T${String(i).padStart(2, "0")}:00`, temp: 20, rh: 50, rain: 0, prob: 10, gust: 20, dir: 180, cape: 50, li: 2, frz: 3500, code: 2, wind700: 20, dir700: 200, ...extra });
  assert.deepEqual(computeAlerts(Array.from({ length: 24 }, (_, i) => hour(i))), []);
  const zonda = computeAlerts(Array.from({ length: 24 }, (_, i) => hour(i, i >= 14 && i <= 18 ? { gust: 75, dir: 280, rh: 12, wind700: 80, dir700: 290 } : {})));
  assert.deepEqual(zonda.map((a) => [a.tipo, a.nivel, a.desde.slice(11), a.hasta.slice(11)]), [["viento", "amarillo", "14:00", "18:00"], ["zonda", "amarillo", "14:00", "18:00"]]);
  const storm = computeAlerts(Array.from({ length: 24 }, (_, i) => hour(i, i >= 17 && i <= 19 ? { cape: 2100, li: -6, prob: 70, rain: 15 } : {})));
  assert.deepEqual(storm.map((a) => a.tipo).sort(), ["granizo", "lluvia", "lluvia", "tormenta"]); // lluvia intensa y, después, el acumulado del día
  assert.equal(storm.find((a) => a.tipo === "lluvia").nivel, "naranja");
});

test("El Niño se lee de las dos tablas de NOAA, también con anomalías negativas pegadas", () => {
  const enso = parseEnso("SEAS YR TOTAL ANOM\n  JJA 2026  29.09   1.80\n  JAS 2026  29.12   2.16\n", " Week  Nino1+2  Nino3  Nino34  Nino4\n 30SEP2026     26.1 5.3     29.0 4.0     29.9 3.2     29.9 1.2\n");
  assert.deepEqual(enso, { oni: 2.16, trimestre: "JAS 2026", nombre: "El Niño muy fuerte", semana: "30SEP2026", nino34: 3.2 });
  assert.equal(parseEnso("  DJF 2021  25.5  -1.05\n", " 06JAN2021     23.1-0.6     24.6-0.9     25.5-1.1     27.2-1.0\n").nino34, -1.1);
  assert.equal(parseEnso("", "").oni, null);
});

test("si una fuente falla queda el último dato bueno marcado como desactualizado", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "sch-clima-"));
  let smnDown = false, capLocal = true, hourly = [90, 20];
  const fetchImpl = async (url) => {
    const text = (body) => ({ ok: true, text: async () => body });
    // El aviso CAP cambia de nombre cuando el SMN lo actualiza: así se vuelve a leer.
    const first = capLocal ? "a.xml" : "a2.xml";
    if (url.includes("AR.php")) return smnDown ? { ok: false, status: 503 } : text(`<a href="https://ssl.smn.gob.ar/feeds/CAP/xml_generados/${first}">x</a><a href="https://ssl.smn.gob.ar/feeds/CAP/xml_generados/b.xml">x</a>`);
    if (url.endsWith("a2.xml")) return text(cap(FAR));
    if (url.includes("a.xml")) return text(cap(capLocal ? AROUND : FAR));
    if (url.endsWith("b.xml")) return text(cap(FAR));
    if (url.includes("open-meteo")) return text(JSON.stringify({ current: { time: "2026-10-06T18:00", temperature_2m: 22 }, hourly: { time: ["2026-10-06T18:00", "2026-10-06T19:00"], wind_gusts_10m: hourly, precipitation: [0, 0] } }));
    if (url.includes("radar")) return { ok: true, headers: new Map([["last-modified", "Tue, 06 Oct 2026 20:55:00 GMT"]]), arrayBuffer: async () => radarGif };
    if (url.includes("inpres")) return text(readFileSync(new URL("./fixtures/inpres-20261006.xml", import.meta.url), "utf8"));
    if (url.includes("oni")) return text("  JAS 2026  29.12   2.16\n");
    return text(" 30SEP2026     26.1 5.3     29.0 4.0     29.9 3.2     29.9 1.2\n");
  };
  let clock = new Date("2026-10-06T21:00:00Z");
  const changes = [];
  const watch = createWeatherWatch({ dataDir, fetchImpl, env: {}, now: () => clock, onLevelChange: (change) => changes.push(change) });
  const first = await watch.get();
  assert.equal(first.oficial.datos.alertas.length, 1);
  assert.equal(first.oficial.datos.alertas[0].alcance, "LOCAL");
  assert.equal(first.pronostico.datos.alertas[0].nivel, "naranja");
  assert.equal(first.enso.datos.nombre, "El Niño muy fuerte");
  assert.equal(first.parte, null);
  assert.deepEqual([first.radar.ok, first.radar.datos.vigente, first.radar.datos.lectura.celda.km, first.radar.datos.alertas.length], [true, true, 101, 0]);
  assert.deepEqual([first.nivel.color, first.nivel.motivos[0].origen, first.nivel.incompleto], ["naranja", "SMN", false]);
  smnDown = true; clock = new Date("2026-10-06T21:30:00Z");
  const second = await watch.refresh();
  assert.deepEqual([second.oficial.ok, second.oficial.en, second.oficial.datos.alertas.length], [false, "2026-10-06T21:00:00.000Z", 1]);
  assert.equal(second.pronostico.ok, true);
  assert.equal(first.sismos.datos.lista.length, 30);
  // El aviso sale sólo cuando el nivel cambia: acá sigue en naranja, así que no hubo ninguno.
  assert.deepEqual([changes.length, second.cambios.length], [0, 0]);
  capLocal = false; smnDown = false; hourly = [20, 20]; clock = new Date("2026-10-06T22:00:00Z");
  const third = await watch.refresh();
  // La alerta se fue, pero un grado de 5 o más no se desploma: baja un escalón ahora y otro cada 30 minutos.
  assert.deepEqual([third.nivel.grado, third.nivel.color, third.nivel.bajando, third.nivel.motivos[0].origen, changes.length], [5, "naranja", true, "Sistema", 0]);
  clock = new Date("2026-10-06T22:10:00Z");
  assert.equal((await watch.refresh()).nivel.grado, 5); // todavía no pasaron 30 minutos
  clock = new Date("2026-10-06T22:31:00Z");
  const fourth = await watch.refresh();
  assert.deepEqual([fourth.nivel.grado, changes.length, changes[0]?.de, changes[0]?.a], [4, 1, "naranja", "amarillo"]);
  clock = new Date("2026-10-06T22:42:00Z");
  const fifth = await watch.refresh();
  assert.deepEqual([fifth.nivel.grado, fifth.nivel.color, fifth.nivel.bajando, changes.length, fifth.cambios.length], [1, "verde", undefined, 2, 2]);
  rmSync(dataDir, { recursive: true, force: true });
});

test("mediciones del INA: tendencia del río, lluvia caída y descarte de un pluviómetro que falla", () => {
  const NOW = Date.parse("2026-10-07T07:00:00Z");
  const at = (hoursAgo, valor) => ({ timestart: new Date(NOW - hoursAgo * 3_600_000).toISOString(), valor });
  const calm = riverReading([at(50, 0.8), at(27, 0.83), at(9, 0.86), at(3, 0.88)], NOW);
  assert.deepEqual([calm.m, calm.hace_h, calm.cambio_6h, calm.cambio_24h, calm.tendencia, calm.rapido, calm.min7, calm.max7], [0.88, 3, 0.02, 0.05, "sube", false, 0.8, 0.88]);
  const rising = riverReading([at(30, 0.8), at(27, 0.85), at(9, 1.0), at(3, 1.4)], NOW);
  assert.deepEqual([rising.cambio_6h, rising.rapido], [0.4, true]);
  assert.equal(riverReading([], NOW), null);
  const rain = rainReading([at(30, 5), at(8, 320), at(7, 576), at(6, 0), at(5, 0.75), at(4, 12), at(3, 10.5)], NOW);
  assert.deepEqual([rain.mm_3h, rain.mm_24h, rain.descartados, rain.hace_h], [23.25, 23.25, 2, 3]);
  const datos = { lluvia: [{ nombre: "El Tigre", km: 25, lectura: rain }, { nombre: "Lejos", km: 73, lectura: { ...rain, mm_3h: 60 } }, { nombre: "Viejo", km: 30, lectura: { ...rain, mm_3h: 60, hace_h: 9 } }], rios: [{ rio: "Diamante", nombre: "La Jaula", donde: "aguas arriba", arriba: true, lectura: rising }, { rio: "Diamante", nombre: "Monte Comán", donde: "aguas abajo", arriba: false, lectura: rising }] };
  assert.deepEqual(hydroAlerts(datos).map((alert) => [alert.grado, alert.tipo]), [[4, "lluvia_medida"], [3, "rio"]]);
  const level = alertLevel({ oficial: { ok: true, datos: { alertas: [] } }, pronostico: { ok: true, datos: { alertas: [] } }, radar: { ok: true, datos: { vigente: true, alertas: [] } }, hidro: { ok: true, datos: { alertas: hydroAlerts(datos) } } }, NOW);
  assert.deepEqual([level.grado, level.motivos[0].origen], [4, "Medición INA"]);
});

test("el radar solo no alerta por granizo: necesita otro dato de alarma para San Rafael", () => {
  const ok = (datos) => ({ ok: true, datos });
  const NOW = Date.parse("2026-10-07T04:06:00-03:00");
  const cell = () => ({ tipo: "radar", grado: 6, nivel: "naranja", titulo: "Celda con posible granizo a 30 km al O, viene hacia la ciudad", detalle: "Eco de 60 dBZ", desde: "2026-10-07T07:06:00Z", hasta: "2026-10-07T07:06:00Z" });
  const hail = () => ({ tipo: "radar", grado: 7, nivel: "rojo", titulo: "Granizo probable sobre San Rafael", detalle: "3 km² con 60 dBZ", desde: "2026-10-07T07:06:00Z", hasta: "2026-10-07T07:06:00Z" });
  const state = (radar, extra = {}) => ({ oficial: ok({ alertas: [] }), pronostico: ok({ alertas: [] }), radar: ok({ vigente: true, alertas: radar }), ...extra });
  // Lo que pasó el 7/10 a las 04:06: una celda a 30 km, sin nada más. Antes daba naranja (6); ahora no es alerta.
  const alone = state([cell()]);
  const level = alertLevel(alone, NOW);
  assert.deepEqual([level.grado, level.color, alone.radar.datos.alertas.length, alone.radar.datos.menores.length], [2, "verde", 0, 1]);
  assert.match(alone.radar.datos.menores[0].detalle, /Sólo lo marca el radar/);
  // Eco muy intenso sobre la ciudad pero sin compañía: vigilancia, no emergencia.
  const cityAlone = state([hail()]);
  assert.deepEqual([alertLevel(cityAlone, NOW).grado, cityAlone.radar.datos.alertas[0].titulo, cityAlone.radar.datos.alertas[0].nivel], [5, "Eco muy intenso y persistente sobre San Rafael, sin otra señal que lo confirme", "naranja"]); // única excepción: núcleo extenso y repetido en dos barridos
  const strongAlone = state([{ ...hail(), grado: 6, titulo: "Tormenta muy fuerte con granizo probable sobre San Rafael" }]);
  assert.deepEqual([alertLevel(strongAlone, NOW).grado, strongAlone.radar.datos.alertas[0].titulo], [3, "Eco muy intenso sobre San Rafael, sin otra señal que lo confirme"]);
  // Fuente caída no es fuente que dijo "no pasa nada": sin SMN o sin modelo, al radar no se le baja el grado.
  assert.equal(alertLevel(state([hail()], { oficial: { ok: false, datos: { alertas: [] } } }), NOW).grado, 7);
  // Inestabilidad baja en el modelo (CAPE 600, 25 %) ya acompaña al radar.
  assert.equal(alertLevel(state([cell()], { pronostico: ok({ alertas: [], horas: [{ t: "2026-10-07T05:00", cape: 600, prob: 25 }] }) }), NOW).grado, 6);
  // Con alerta local del SMN vigente, con pronóstico de tormenta en las próximas horas o con lluvia fuerte medida: vale el grado del radar.
  const smn = { alcance: "LOCAL", nivel: "amarillo", evento: "Tormentas", desde: "2026-10-07T00:00:00-03:00", hasta: "2026-10-07T12:00:00-03:00", certeza: "Likely" };
  assert.equal(alertLevel(state([cell()], { oficial: ok({ alertas: [smn] }) }), NOW).grado, 6);
  const withSmn = state([hail()], { oficial: ok({ alertas: [{ ...smn }] }) });
  assert.deepEqual([alertLevel(withSmn, NOW).grado, withSmn.radar.datos.apoyo], [7, ["alerta del SMN para la zona"]]);
  assert.equal(alertLevel(state([cell()], { pronostico: ok({ alertas: [{ tipo: "granizo", nivel: "naranja", titulo: "Riesgo de granizo", desde: "2026-10-07T06:00", hasta: "2026-10-07T09:00" }] }) }), NOW).grado, 6);
  assert.equal(alertLevel(state([cell()], { pronostico: ok({ alertas: [{ tipo: "granizo", nivel: "naranja", titulo: "Riesgo de granizo", desde: "2026-10-08T18:00", hasta: "2026-10-08T21:00" }] }) }), NOW).motivos.find((m) => m.origen === "Radar").grado, 2); // pronóstico para mañana no acompaña a una celda de ahora
  assert.equal(alertLevel(state([cell()], { hidro: ok({ alertas: [], lluvia: [{ km: 25, lectura: { hace_h: 2, mm_3h: 14 } }] }) }), NOW).grado, 6);
  assert.equal(alertLevel(state([cell()], { oficial: ok({ alertas: [{ ...smn, alcance: "REGIONAL" }] }) }), NOW).grado, 2); // una alerta a 100 km no acompaña
});

test("aviso a corto plazo del SMN: se lee aunque venga con el prefijo cap: y la distancia es al borde del polígono", () => {
  const acp = `<?xml version="1.0"?><cap:alert xmlns:cap="urn:oasis:names:tc:emergency:cap:1.2"><cap:sent>2026-12-15T15:50:00-03:00</cap:sent><cap:info><cap:event>TORMENTAS FUERTES</cap:event><cap:urgency>Immediate</cap:urgency><cap:severity>Severe</cap:severity><cap:certainty>Observed</cap:certainty><cap:expires>2026-12-15T17:50:00-03:00</cap:expires><cap:description>TORMENTAS FUERTES CON OCASIONAL CAIDA DE GRANIZO</cap:description><cap:instruction>x</cap:instruction><cap:area><cap:areaDesc>MENDOZA: SAN RAFAEL.</cap:areaDesc><cap:polygon>-34.5,-68.5 -34.5,-68.2 -34.8,-68.2 -34.8,-68.5 -34.5,-68.5</cap:polygon></cap:area></cap:info></cap:alert>`;
  const url = "https://ssl.smn.gob.ar/feeds/CAP/avisocortoplazo/x.xml";
  const inside = parseCap(acp, url);
  assert.deepEqual([inside.alcance, inside.nivel, inside.corto_plazo, inside.certeza, inside.evento, inside.desde], ["LOCAL", "naranja", true, "Observed", "Aviso a corto plazo: tormentas fuertes con ocasional caida de granizo", "2026-12-15T15:50:00-03:00"]);
  const outside = parseCap(acp, url, { lat: -34.65, lon: -68.0 }); // 18 km al este del borde, frente a la mitad de un lado (lejos de los vértices)
  assert.deepEqual([outside.alcance, outside.distancia_km, outside.corto_plazo], ["REGIONAL", 18, true]);
  const NOW = Date.parse("2026-12-15T16:00:00-03:00");
  const ok = (datos) => ({ ok: true, en: new Date(NOW).toISOString(), datos });
  const state = (alert, radar = []) => ({ oficial: ok({ alertas: [alert] }), pronostico: ok({ alertas: [] }), radar: ok({ vigente: true, alertas: radar }) });
  assert.equal(alertLevel(state({ ...inside }), NOW).grado, 5); // cubre la ciudad, radar al día y sin eco
  assert.equal(alertLevel(state({ ...inside }, [{ grado: 5, titulo: "Tormenta fuerte con posible granizo sobre San Rafael", detalle: "x" }]), NOW).grado, 6);
  assert.equal(alertLevel(state({ ...inside }, [{ grado: 7, titulo: "Granizo probable sobre San Rafael", detalle: "x" }]), NOW).grado, 7);
  assert.equal(alertLevel(state({ ...outside }), NOW).grado, 4); // a 18 km: alrededores
  assert.equal(alertLevel(state({ ...outside, distancia_km: 90 }), NOW).grado, 2); // lejos: sólo informativo
});
