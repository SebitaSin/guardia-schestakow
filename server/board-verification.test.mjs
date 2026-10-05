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
