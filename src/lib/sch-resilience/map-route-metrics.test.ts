import assert from "node:assert/strict";
import test from "node:test";
import { crossedZones, fuelEstimate, parseHazardZones } from "../map-route-metrics.ts";
test("fuel uses route meters and explicit consumption", () => {
  assert.deepEqual(fuelEstimate(25000, 8, 1200), { liters: 2, cost: 2400 });
  assert.equal(fuelEstimate(25000, 0, 1200), null);
  assert.equal(fuelEstimate(-1, 8, 1200), null);
});
test("hazards need provenance; crossings with endpoints outside are detected", () => {
  const data = { type: "FeatureCollection", features: [{ properties: { name: "Zona de prueba", source: "TEST ONLY" }, geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] } }] };
  const zones = parseHazardZones(data);
  assert.equal(crossedZones([{ lat: 0.5, lng: -1 }, { lat: 0.5, lng: 2 }], zones).length, 1);
  assert.equal(crossedZones([{ lat: 2, lng: -1 }, { lat: 2, lng: 2 }], zones).length, 0);
  data.features[0].properties.source = "";
  assert.throws(() => parseHazardZones(data));
});
