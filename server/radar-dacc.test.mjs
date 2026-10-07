import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { analyzeRadar, decodeGif, radarAlerts } from "./radar-dacc.mjs";

const real = readFileSync(new URL("./fixtures/radar-sur-20261006-2130.gif", import.meta.url));

test("la imagen real del radar se decodifica y se mide el eco", () => {
  const gif = decodeGif(real);
  assert.deepEqual([gif.width, gif.height, gif.pixels.length], [900, 761, 900 * 761]);
  const reading = analyzeRadar(real);
  // El 6/10/2026 21:30 UTC no había ecos fuertes sobre la ciudad; la celda fuerte estaba unos 100 km al sur.
  assert.equal(reading.ciudad_dbz, 0);
  assert.ok(reading.region_dbz >= 54, `eco regional ${reading.region_dbz}`);
  assert.deepEqual([reading.celda.km, reading.celda.dbz, reading.celda.rumbo, reading.celda.nucleo_km2 >= 4, reading.ciudad], [101, 60, "S", true, { km2_45: 0, km2_54: 0, km2_60: 0, km2_60_8km: 0 }]); // los ecos sueltos de las sierras, a 20–30 km, no cuentan
  assert.deepEqual(radarAlerts(reading, "2026-10-06T21:30:00Z"), []);
});

test("sobre la ciudad cuenta la superficie de eco fuerte; los grados altos piden persistencia y cercanía", () => {
  const at = "2026-10-06T21:30:00Z";
  const scan = (km2_45, km2_54, km2_60, km2_60_8km = 0) => ({ celda: null, ciudad: { km2_45, km2_54, km2_60, km2_60_8km } });
  const grade = (...scans) => radarAlerts(scans[0], at, null, scans).map((alert) => [alert.grado, alert.nivel]);
  assert.deepEqual(grade(scan(3, 0.5, 0.1)), []); // un chaparrón o píxeles sueltos de 60 dBZ: nada
  assert.deepEqual(grade(scan(19, 3.9, 1.9)), []);
  assert.deepEqual(grade(scan(25, 1, 0)), [[3, "amarillo"]]);
  assert.deepEqual(grade(scan(40, 6, 1)), [[5, "naranja"]]);
  // Un solo barrido, por fuerte que sea, no pasa de 5: puede ser un eco falso.
  assert.deepEqual(grade(scan(120, 40, 30, 26)), [[5, "naranja"]]);
  assert.deepEqual(grade(scan(120, 40, 30, 26), scan(0, 0, 0)), [[5, "naranja"]]);
  // Repetido en dos de los últimos tres barridos:
  assert.deepEqual(grade(scan(60, 12, 7), scan(55, 11, 6.5)), [[6, "naranja"]]);
  assert.deepEqual(grade(scan(60, 12, 7), scan(0, 0, 0), scan(55, 11, 6.5)), [[6, "naranja"]]); // con un barrido vacío en el medio
  assert.deepEqual(grade(scan(90, 30, 12, 2), scan(80, 25, 11, 1)), [[7, "rojo"]]);
  assert.deepEqual(grade(scan(90, 30, 12, 0), scan(80, 25, 11, 0)), [[6, "naranja"]]); // núcleo grande pero a más de 8 km del hospital
  assert.deepEqual(grade(scan(150, 60, 40, 27), scan(140, 55, 38, 26)), [[8, "rojo"]]);
});

test("una celda lejana sólo es alerta si es considerable y viene hacia la ciudad", () => {
  const at = "2026-10-06T21:30:00Z";
  const far = (cell, steer) => radarAlerts({ ciudad: { km2_45: 0, km2_54: 0, km2_60: 0 }, celda: { rumbo: "S", grados: 180, km2: 60, nucleo_km2: 8, dbz: 60, ...cell } }, at, steer).map((alert) => alert.grado);
  const fromSouth = { dir: 185, kmh: 40 }, fromWest = { dir: 280, kmh: 40 };
  assert.deepEqual(far({ km: 49 }, fromSouth), [4]);
  assert.deepEqual(far({ km: 49 }, fromWest), []); // pasa de costado
  assert.deepEqual(far({ km: 49 }, null), []); // lejos y sin saber hacia dónde va
  assert.deepEqual(far({ km: 25 }, fromSouth), [5]);
  assert.deepEqual(far({ km: 25, dbz: 55 }, fromSouth), [4]);
  assert.deepEqual(far({ km: 25 }, null), [4]);
  assert.deepEqual(far({ km: 25, nucleo_km2: 3 }, fromSouth), []); // núcleo chico
  assert.deepEqual(far({ km: 25 }, { dir: 185, kmh: 5 }), [4]); // casi sin viento: no se va, puede quedarse descargando
  assert.deepEqual(far({ km: 49 }, { dir: 185, kmh: 5 }), []);
  assert.deepEqual(far({ km: 104 }, fromSouth), []);
  assert.match(radarAlerts({ ciudad: { km2_45: 0, km2_54: 0, km2_60: 0 }, celda: { km: 40, rumbo: "S", grados: 180, nucleo_km2: 8, dbz: 60 } }, at, fromSouth)[0].detalle, /llegaría en 60 minutos/);
  assert.throws(() => analyzeRadar(new Uint8Array([1, 2, 3])));
});

test("celda fuerte que no se mueve durante tres barridos: lluvia sostenida aguas arriba", () => {
  const at = "2026-10-06T21:30:00Z";
  const scan = (km) => ({ ciudad: { km2_45: 0, km2_54: 0, km2_60: 0, km2_60_8km: 0 }, celda: { km, dbz: 57, nucleo_km2: 9, km2: 50, grados: 250, rumbo: "O" } });
  const stuck = radarAlerts(scan(28), at, { dir: 250, kmh: 8 }, [scan(28), scan(28), scan(29)]);
  assert.deepEqual([stuck.length, stuck[0].sostenida, stuck[0].grado], [1, true, 3]);
  assert.match(stuck[0].titulo, /Lluvia sostenida a 28 km al O/);
  assert.equal(radarAlerts(scan(20), at, { dir: 250, kmh: 40 }, [scan(20), scan(30), scan(40)]).some((alert) => alert.sostenida), false); // se acerca: no es "quieta"
  assert.equal(radarAlerts(scan(28), at, null, [scan(28), scan(28)]).some((alert) => alert.sostenida), false); // dos barridos no alcanzan
});
