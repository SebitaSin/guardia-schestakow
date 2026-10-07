import test from "node:test";
import assert from "node:assert/strict";
import { grupoDe, km, proponerCadenas, zonasSinLugar, type PersonaTraslado } from "../traslado-solidario";

const H = { lat: -34.62, lng: -68.33 };
// Puntos sobre una misma línea hacia el oeste del hospital: 1 grado de longitud ≈ 91 km a esta latitud.
const oeste = (kmRectos: number, lat = -34.62) => ({ lat, lng: -68.33 - kmRectos / 91.3 });
const persona = (id: string, punto: { lat: number; lng: number }, extra: Partial<PersonaTraslado> = {}): PersonaTraslado => ({ id, nombre: id, areas: ["UTI"], rol: "Médico", punto, dispuesto: false, lugares: 0, necesitaTraslado: false, ...extra });

test("la distancia estimada es la recta por 1,3", () => {
  assert.ok(Math.abs(km(oeste(10), H) - 13) < 0.2);
});

test("el conductor levanta a quien le queda de camino y no a quien lo desvía", () => {
  const conductor = persona("conductor", oeste(8), { dispuesto: true, lugares: 2 });
  const deCamino = persona("de-camino", oeste(4), { necesitaTraslado: true });
  const lejos = persona("desviado", { lat: -34.50, lng: -68.33 }, { necesitaTraslado: true }); // 13 km al norte
  const out = proponerCadenas([conductor, deCamino, lejos], H);
  assert.deepEqual(out.cadenas.map((c) => [c.conductor.id, c.pasajeros.map((p) => p.persona.id)]), [["conductor", ["de-camino"]]]);
  assert.ok(out.cadenas[0].kmExtra < 0.2, String(out.cadenas[0].kmExtra));
  assert.deepEqual(out.sinLugar.map((p) => p.id), ["desviado"]);
});

test("respeta los lugares y prefiere al compañero del mismo servicio y grupo", () => {
  const medico = persona("medico-uti", oeste(8, -34.621), { dispuesto: true, lugares: 1 });
  const enfermero = persona("enfermero-clinica", oeste(8, -34.619), { dispuesto: true, lugares: 1, areas: ["Clínica"], rol: "Enfermero" });
  const pasajeroUti = persona("pasajero-uti", oeste(4), { necesitaTraslado: true });
  const pasajeroClinica = persona("pasajero-clinica", oeste(5), { necesitaTraslado: true, areas: ["Clínica"], rol: "Enfermera" });
  const tercero = persona("tercero", oeste(3), { necesitaTraslado: true });
  const out = proponerCadenas([medico, enfermero, pasajeroUti, pasajeroClinica, tercero], H);
  const de = (id: string) => out.cadenas.find((c) => c.conductor.id === id)!.pasajeros.map((p) => p.persona.id);
  assert.deepEqual(de("medico-uti"), ["pasajero-uti"]);
  assert.deepEqual(de("enfermero-clinica"), ["pasajero-clinica"]);
  assert.deepEqual(out.cadenas.find((c) => c.conductor.id === "medico-uti")!.pasajeros[0].afinidad, ["mismo servicio (UTI)", "ambos médicos"]);
  assert.deepEqual(out.sinLugar.map((p) => p.id), ["tercero"]); // no quedaban lugares
});

test("sin voluntarios no se inventa nada y los que necesitan traslado se agrupan por zona", () => {
  const a = persona("a", oeste(5), { necesitaTraslado: true }), b = persona("b", oeste(5, -34.622), { necesitaTraslado: true }), c = persona("c", { lat: -34.70, lng: -68.33 }, { necesitaTraslado: true });
  const out = proponerCadenas([a, b, c, persona("nadie", oeste(2))], H);
  assert.deepEqual([out.cadenas.length, out.sinLugar.length, out.conductoresLibres.length], [0, 3, 0]);
  const zonas = zonasSinLugar(out.sinLugar, H);
  assert.deepEqual(zonas.map((z) => [z.personas.length, z.rumbo]), [[2, "oeste"], [1, "sur"]]);
  assert.deepEqual([grupoDe("Médica cirujana"), grupoDe("Lic. en Enfermería"), grupoDe("Chofer"), grupoDe("")], ["médicos", "enfermería", "servicios generales", ""]);
});
