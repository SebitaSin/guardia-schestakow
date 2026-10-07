import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { boardTemplates, matchTemplate, templateGuide } from "./board-templates.mjs";
import { verifyBoardRows } from "./board-verification.mjs";

test("el servicio se reconoce por el texto del mensaje o por el título, sin confundir parecidos", () => {
  assert.equal(boardTemplates().length, 15);
  assert.equal(matchTemplate("Uti ped")?.slug, "tip");
  assert.equal(matchTemplate("*Neo*")?.slug, "neonatologia");
  assert.equal(matchTemplate("*Buen día, servicio de maternidad*")?.slug, "obstetricia");
  assert.equal(matchTemplate("Ped ala este")?.slug, "pediatria-este");
  assert.equal(matchTemplate("Uccyq")?.slug, "uccyq");
  assert.equal(matchTemplate("pizarra uti pediátrica")?.slug, "tip");
  assert.equal(matchTemplate("UTI")?.slug, "terapia-intensiva");
  assert.equal(matchTemplate("Pediatría ala norte")?.slug, "pediatria-norte");
  assert.equal(matchTemplate("pediatria"), null); // no alcanza para saber cuál
  assert.equal(matchTemplate("clinica medica I"), null); // en un mensaje es ambiguo
  assert.equal(matchTemplate("CLÍNICA MÉDICA I", { fromTitle: true })?.slug, "clinica-2");
  assert.equal(matchTemplate("Clínica Médica II", { fromTitle: true }), null);
  assert.equal(matchTemplate("producto"), null);
  assert.ok(!templateGuide().includes("401/1, 401/2, 402/1")); // camas sin confirmar no se dan como guía
});

test("el DNI leído cruza exacto con laboratorio y un DNI con otro nombre queda para revisar", () => {
  const root = mkdtempSync(join(tmpdir(), "sch-board-templates-"));
  try {
    const internacionFile = join(root, "internacion.json");
    writeFileSync(internacionFile, JSON.stringify({ beds: [{ servicio: "Clínica Médica 2", slug: "clinica-2", cama: "515/1", estado: "OCUPADA", paciente: null }] }));
    writeFileSync(join(root, "lab-pacientes.json"), JSON.stringify({ pacientes: [{ nombre: "PRUEBA UNO, ANA", dni: "11222333" }] }));
    const base = { service: "CLÍNICA MÉDICA I", room: null, bed: "515/1", diagnosis: null, arm: null, post_surgical: null, observations: null, confidence: 95 };
    const ok = verifyBoardRows({ dataDir: root, internacionFile, rows: [{ ...base, patient: "Prueba Uno Ana", dni: "11.222.333" }] }).rows[0];
    assert.equal(ok.service, "Clínica Médica 2");
    assert.equal(ok.service_read, "CLÍNICA MÉDICA I");
    assert.equal(ok.verification.status, "VERIFICADA");
    assert.deepEqual(ok.verification.sources, ["LABORATORIO_DNI"]);
    const other = verifyBoardRows({ dataDir: root, internacionFile, rows: [{ ...base, patient: "Distinto Apellido Juan", dni: "11222333" }] }).rows[0];
    assert.notEqual(other.verification.status, "VERIFICADA");
    assert.ok(other.verification.reasons.includes("el DNI figura en laboratorio con un nombre diferente"));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
