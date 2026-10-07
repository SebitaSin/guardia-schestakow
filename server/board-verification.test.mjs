import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { textSimilarity, verifyBoardRows } from "./board-verification.mjs";

test("name comparison tolerates order and accents without inventing a patient", () => {
  assert.ok(textSimilarity("Pérez, María", "MARIA PEREZ") > 0.9);
  assert.ok(textSimilarity("PEREZ MARIA", "GOMEZ JUAN") < 0.65);
});

test("board rows are verified only when bed and a registered name agree", () => {
  const root = mkdtempSync(join(tmpdir(), "sch-board-verification-"));
  try {
    const internacionFile = join(root, "internacion.json");
    writeFileSync(internacionFile, JSON.stringify({ beds: [{ servicio: "Clínica Médica", slug: "clinica-1", cama: "101", estado: "OCUPADA", paciente: "MARIA PEREZ" }] }));
    writeFileSync(join(root, "lab-pacientes.json"), JSON.stringify({ pacientes: [{ nombre: "PEREZ MARIA", servicio: "Clínica" }] }));
    const result = verifyBoardRows({ dataDir: root, internacionFile, rows: [{ service: "Clínica Médica", room: "1", bed: "101", patient: "Maria Perez", diagnosis: null, arm: null, post_surgical: null, observations: null, confidence: 96 }] });
    assert.equal(result.status, "VERIFICADA_AUTOMATICAMENTE");
    assert.equal(result.rows[0].verification.status, "VERIFICADA");
    assert.deepEqual(result.rows[0].verification.sources.sort(), ["LABORATORIO", "PARTE_ACTUAL"]);

    const uncertain = verifyBoardRows({ dataDir: root, internacionFile, rows: [{ service: "Clínica Médica", room: "1", bed: "101", patient: null, diagnosis: null, arm: null, post_surgical: null, observations: null, confidence: 40 }] });
    assert.equal(uncertain.rows[0].verification.status, "REVISAR");
    assert.equal(uncertain.rows[0].patient, null);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// --- Tercer método: sala y cama de las órdenes de laboratorio de hoy o ayer ---
const { labBedMatch, labForService, sameBed } = await import("./board-verification.mjs");
const { parseOrderDetail } = await import("./lab-lookup.mjs");
const MAP = { equivalencias: { PEDIATRIA: ["pediatria"] }, ingreso: ["GUARDIA"] };
const ALL = [
  { fecha: "07/10/2026", dni: "55111222", nombre: "ROJAS, TOMAS AGUSTIN", servicio: "PEDIATRIA", sala: "119", cama: "3" },
  { fecha: "06/10/2026", dni: "56333444", nombre: "VEGA, LUNA", servicio: "PEDIATRIA", sala: "120", cama: "3" },
  { fecha: "07/10/2026", dni: "58000001", nombre: "ROJAS, OTRO", servicio: "CIRUGIA", sala: "2", cama: "3" },
];
const checkBed = (row) => {
  const dataDir = mkdtempSync(join(tmpdir(), "sch-cama-"));
  try { return verifyBoardRows({ rows: [{ service: "Pediatría", confidence: 90, ...row }], dataDir, internacionFile: null, usePart: false, serviceLab: labForService([], "pediatria", MAP, ALL) }).rows[0].verification; }
  finally { rmSync(dataDir, { recursive: true, force: true }); }
};

test("la cama de la pizarra se reconoce en la del laboratorio", () => {
  assert.equal(sameBed("3", "3"), true);
  assert.equal(sameBed("03", "Cama 3"), true);
  assert.equal(sameBed("3", "13"), false);
});

test("misma cama + parecido por nombre, por apellido o por documento: coincidencia; cada sala con su paciente", () => {
  const byName = checkBed({ bed: "3", patient: "ROJA TOMA" });
  assert.deepEqual([byName.sources, byName.patientSuggestion, byName.labDni], [["LABORATORIO_CAMA"], "ROJAS, TOMAS AGUSTIN", "55111222"]);
  assert.equal(checkBed({ bed: "3", patient: "VEGA" }).patientSuggestion, "VEGA, LUNA"); // sólo el apellido
  assert.equal(checkBed({ bed: "3", patient: "XXXX", dni: "56333445" }).patientSuggestion, "VEGA, LUNA"); // documento con un dígito distinto
  assert.equal(checkBed({ bed: "3", room: "120", patient: "ROJAS" }).sources.includes("LABORATORIO_CAMA"), false); // Rojas está en la sala 119
  assert.equal(labForService([], "pediatria", MAP, ALL).beds.some((row) => row.servicio === "CIRUGIA"), false);
});

test("sin parecido no se pone nada; cama sin nadie anotado no se busca", () => {
  const other = checkBed({ bed: "3", patient: "GIMENEZ MARCOS" });
  assert.deepEqual([other.sources, other.patientSuggestion, other.reasons.some((reason) => /cama/.test(reason) && /laboratorio/.test(reason))], [[], null, false]);
  const empty = checkBed({ bed: "3", patient: "" });
  assert.deepEqual([empty.sources, empty.patientSuggestion, empty.labDni], [[], null, null]);
  assert.equal(labBedMatch(ALL, { bed: "7", patient: "ROJAS TOMAS" }), null);
});

test("pantalla de resultados de una orden: se leen sala y cama; Piso vacío no confunde", () => {
  const html = `<div><b>Orden</b> <span>900001</span></div><table><tr><td>Paciente</td><td>PRUEBA, ANA</td><td>Edad</td><td>7 Meses 16 Días</td><td>Fecha de Nac</td><td>01/01/2026</td><td>Sexo</td><td>Femenino</td></tr><tr><td>Fecha</td><td>06/10/2026 15:42:37</td><td>Médico</td><td>MEDICO.PRUEBA</td><td>Origen</td><td>INTERNACION</td><td>Servicio</td><td>PEDIATRIA</td><td>Sala</td><td>119</td></tr><tr><td>Piso</td><td></td><td>Cama</td><td>3</td></tr></table><table><tr><td>Hemograma</td></tr></table>`;
  assert.deepEqual(parseOrderDetail(html), { paciente: "PRUEBA, ANA", servicio: "PEDIATRIA", sala: "119", cama: "3" });
  assert.deepEqual(parseOrderDetail("<p>Orden 900003</p><td>Servicio</td><td>GUARDIA</td><td>Sala</td><td></td><td>Piso</td><td></td><td>Cama</td><td></td>").cama, "");
});
