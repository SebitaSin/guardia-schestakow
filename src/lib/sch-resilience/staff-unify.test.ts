import test from "node:test";
import assert from "node:assert/strict";
import { personAreas } from "../staff-directory.ts";
import { groupByArea, unifyPeople } from "../staff-unify.ts";

const base = { address: "", phone: "", updatedAt: "", updatedBy: "" };

test("distintas formas de escribir un área son la misma área", () => {
  for (const raw of ["UTI", "UTIA", "UTI ADULTOS", "uti adulto", "TERAPIA INTENSIVA ADULTO", "terapia-intensiva", "Terapia adultos"]) {
    assert.deepEqual(personAreas({ service: raw }), ["Terapia Intensiva"], raw);
  }
  assert.deepEqual(personAreas({ service: "UTI PEDIATRICA" }), ["Terapia Intensiva Pediátrica"]);
  assert.deepEqual(personAreas({ service: "UNIDAD CORONARIA, uco" }), ["UCO"]);
  assert.deepEqual(personAreas({ service: "CIRUGÍA, cirugia" }), ["Cirugía"]);
  assert.deepEqual(personAreas({ service: "ANATOMIA PATOLOGICA" }), personAreas({ service: "ANATOMÍA PATOLÓGICA" }));
  assert.deepEqual(personAreas({ service: "CLINICA MEDICA1" }), ["Clínica Médica 1"]);
  // La Guardia tiene clínica, cirugía y pediatría propias: no son los servicios de internación.
  assert.deepEqual(personAreas({ service: "guardia-clinica" }), ["Guardia · Clínica"]);
  assert.deepEqual(personAreas({ service: "GUARDIA DE PEDIATRÍA, PEDIATRÍA" }), ["Guardia · Pediatría", "Pediatría"]);
  assert.deepEqual(personAreas({ service: "GUARDIA CIRUGIA, CIRUGÍA" }), ["Guardia · Cirugía", "Cirugía"]);
  assert.deepEqual(personAreas({ service: "GUARDIA DE CIRUGIA INFANTIL" }), ["Cirugía Pediátrica"]);
  assert.deepEqual(personAreas({ service: "GUARDIA" }), ["Guardia"]);
  assert.deepEqual(personAreas({ service: "CLÍNICA MÉDICA" }), ["Clínica Médica"]);
});

test("un empleado repetido es una sola persona con todas sus áreas", () => {
  const people = [
    { ...base, staffId: "n1", name: "PRUEBA UNO ANA", service: "UTI ADULTOS", dni: "1", source: "nomina" },
    { ...base, staffId: "terapia-intensiva--prueba", name: "PRUEBA", service: "terapia-intensiva", source: "cronogramas" },
    { ...base, staffId: "n2", name: "PRUEBA DOS LUIS", service: "FARMACIA", dni: "2", source: "nomina" },
    { ...base, staffId: "n3", name: "ANA PRUEBA UNO", service: "ROTATIVO", dni: "1", source: "nomina" },
    { ...base, staffId: "uco--otro", name: "OTRO", service: "uco", source: "cronogramas" },
    { ...base, staffId: "cirugia--prueba", name: "PRUEBA", service: "cirugia", source: "cronogramas" },
  ];
  const unified = unifyPeople(people);
  const ana = unified.find((item) => item.ids.includes("n1"));
  assert.deepEqual(ana?.ids.sort(), ["n1", "n3", "terapia-intensiva--prueba"]);
  assert.deepEqual(ana?.areas, ["Terapia Intensiva", "Rotativo"]);
  // Apellido solo, con dos personas posibles y ninguna en ese servicio: no se adivina.
  assert.ok(unified.some((item) => item.ids.length === 1 && item.ids[0] === "cirugia--prueba"));
  assert.equal(unified.length, 4);
  const guard = unifyPeople([
    { ...base, staffId: "g1", name: "GUARDIA UNO", service: "GUARDIA", specialty: "MÉDICO-PEDIATRÍA", source: "nomina" },
    { ...base, staffId: "g2", name: "GUARDIA DOS", service: "GUARDIA", specialty: "CLÍNICA MÉDICA", source: "nomina" },
    { ...base, staffId: "g3", name: "GUARDIA TRES", service: "GUARDIA", specialty: "ENFERMERÍA", source: "nomina" },
    { ...base, staffId: "g4", name: "GUARDIA CUATRO", service: "PEDIATRÍA", specialty: "PEDIATRÍA", source: "nomina" },
  ]);
  assert.deepEqual(guard.map((item) => item.areas[0]).sort(), ["Guardia", "Guardia · Clínica", "Guardia · Pediatría", "Pediatría"]);
  const groups = groupByArea(unified);
  assert.equal(groups.find((group) => group.area === "Terapia Intensiva")?.people.length, 1);
  assert.deepEqual(groups.map((group) => group.area), ["Cirugía", "Farmacia", "Rotativo", "Terapia Intensiva", "UCO"]);
});
