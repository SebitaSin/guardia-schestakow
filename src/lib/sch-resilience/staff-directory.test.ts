import test from "node:test";
import assert from "node:assert/strict";
import { whatsappNumber, personAreas, worksInArea } from "../staff-directory.ts";
test("Argentine mobile contacts normalize without assuming an area code for incomplete numbers", () => {
  assert.equal(whatsappNumber("2604056998"), "5492604056998");
  assert.equal(whatsappNumber("+54 9 260 405 6998"), "5492604056998");
  assert.equal(whatsappNumber("0260 15 4056998"), "5492604056998");
  assert.equal(whatsappNumber("542604056998"), "5492604056998");
  assert.equal(whatsappNumber("4428285"), null);
  assert.equal(whatsappNumber("sin teléfono"), null);
  assert.equal(whatsappNumber("2604056998 / 2604056999"), null);
});
test("service tabs retain multiple real assignments and normalize clinical-unit labels", () => {
  assert.deepEqual(personAreas({service: "CLINICA MEDICA1, MOVILIDAD, movilidad"}), ["Clínica Médica 1", "Movilidad"]);
  assert.equal(worksInArea({service: "CLINICA MEDICA1, MOVILIDAD"}, "clinica-1"), true);
  assert.equal(worksInArea({service: "CLINICA MEDICA1, MOVILIDAD"}, "Clínica Médica 2"), false);
  assert.equal(worksInArea({service: "", role: "MANTENIMIENTO"}, "Mantenimiento"), true);
  assert.deepEqual(personAreas({service: ""}), ["Sin servicio o tarea"]);
});
