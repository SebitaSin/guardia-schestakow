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
  assert.deepEqual([reading.celda.km, reading.celda.dbz, reading.celda.rumbo, reading.celda.nucleo_km2 >= 4, reading.ciudad], [101, 60, "S", true, { km2_45: 0, km2_54: 0, km2_60: 0 }]); // los ecos sueltos de las sierras, a 20–30 km, no cuentan
  assert.deepEqual(radarAlerts(reading, "2026-10-06T21:30:00Z"), []);
});

test("sobre la ciudad cuenta la superficie de eco fuerte, no un píxel", () => {
  const at = "2026-10-06T21:30:00Z";
  const city = (km2_45, km2_54, km2_60) => radarAlerts({ ciudad_dbz: 65, celda: null, ciudad: { km2_45, km2_54, km2_60 } }, at).map((alert) => [alert.grado, alert.nivel]);
  assert.deepEqual(city(3, 0.5, 0.1), []); // un chaparrón o píxeles sueltos de 60 dBZ: nada
  assert.deepEqual(city(19, 3.9, 1.9), []);
  assert.deepEqual(city(25, 1, 0), [[3, "amarillo"]]);
  assert.deepEqual(city(40, 6, 1), [[5, "naranja"]]);
  assert.deepEqual(city(60, 12, 3), [[7, "rojo"]]);
  assert.deepEqual(city(90, 30, 12), [[8, "rojo"]]);
});

test("una celda lejana sólo es alerta si es considerable y viene hacia la ciudad", () => {
  const at = "2026-10-06T21:30:00Z";
  const far = (cell, steer) => radarAlerts({ ciudad: { km2_45: 0, km2_54: 0, km2_60: 0 }, celda: { rumbo: "S", grados: 180, km2: 60, nucleo_km2: 8, dbz: 60, ...cell } }, at, steer).map((alert) => alert.grado);
  const fromSouth = { dir: 185, kmh: 40 }, fromWest = { dir: 280, kmh: 40 };
  assert.deepEqual(far({ km: 49 }, fromSouth), [4]);
  assert.deepEqual(far({ km: 49 }, fromWest), []); // pasa de costado
  assert.deepEqual(far({ km: 49 }, null), []); // lejos y sin saber hacia dónde va
  assert.deepEqual(far({ km: 25 }, fromSouth), [6]);
  assert.deepEqual(far({ km: 25, dbz: 55 }, fromSouth), [4]);
  assert.deepEqual(far({ km: 25 }, null), [4]);
  assert.deepEqual(far({ km: 25, nucleo_km2: 3 }, fromSouth), []); // núcleo chico
  assert.deepEqual(far({ km: 25 }, { dir: 185, kmh: 5 }), []); // casi sin viento que la traiga
  assert.deepEqual(far({ km: 104 }, fromSouth), []);
  assert.match(radarAlerts({ ciudad: { km2_45: 0, km2_54: 0, km2_60: 0 }, celda: { km: 40, rumbo: "S", grados: 180, nucleo_km2: 8, dbz: 60 } }, at, fromSouth)[0].detalle, /llegaría en 60 minutos/);
  assert.throws(() => analyzeRadar(new Uint8Array([1, 2, 3])));
});
