import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { normalizeSolidario, readPrivateLocations, setSolidario, upsertPrivateLocation } from "./private-locations.mjs";

const SECRET = "s".repeat(40);
const place = { staffId: "persona-1", address: "Calle Falsa 123, San Rafael", lat: -34.61, lng: -68.33, transportMode: "CAR" };

test("la disponibilidad para el traslado solidario se guarda y no se pierde al corregir el domicilio", () => {
  const dataDir = mkdtempSync(join(tmpdir(), "sch-solidario-"));
  try {
    assert.throws(() => setSolidario(dataDir, SECRET, { staffId: "persona-1", vehiculoSeguro: true, dispuesto: true, lugares: 2 }, "direccion"), /location_not_found/);
    upsertPrivateLocation(dataDir, SECRET, place, "direccion");
    const saved = setSolidario(dataDir, SECRET, { staffId: "persona-1", vehiculoSeguro: true, dispuesto: true, lugares: 9, necesitaTraslado: true }, "direccion");
    assert.deepEqual([saved.solidario.dispuesto, saved.solidario.lugares, saved.solidario.necesitaTraslado, saved.solidario.por], [true, 4, false, "direccion"]);
    upsertPrivateLocation(dataDir, SECRET, { ...place, address: "Otra Calle 456, San Rafael" }, "direccion");
    const [after] = readPrivateLocations(dataDir, SECRET);
    assert.deepEqual([after.address, after.solidario.dispuesto, after.solidario.lugares], ["Otra Calle 456, San Rafael", true, 4]);
  } finally { rmSync(dataDir, { recursive: true, force: true }); }
});

test("sin vehículo seguro nadie figura como dispuesto a llevar", () => {
  assert.deepEqual([normalizeSolidario({ vehiculoSeguro: false, dispuesto: true, lugares: 3 }, "x").dispuesto, normalizeSolidario({ vehiculoSeguro: false, dispuesto: true, lugares: 3 }, "x").lugares], [false, 0]);
  assert.equal(normalizeSolidario({ necesitaTraslado: true }, "x").necesitaTraslado, true);
  assert.equal(normalizeSolidario({ vehiculoSeguro: true, necesitaTraslado: true }, "x").necesitaTraslado, false);
});
