import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyLearnedCorrections, correctionStatus, recordBoardCorrections } from "./corrections.mjs";

test("repeated service corrections are encrypted and applied only after consistent examples", () => {
  const root = mkdtempSync(join(tmpdir(), "sch-corrections-"));
  const secret = "l".repeat(32);
  try {
    for (const sourceHash of ["a".repeat(64), "b".repeat(64)]) {
      recordBoardCorrections({ dataDir: root, secret, sourceHash, actor: "direccion", originalRows: [{ service: "CLINCA", patient: "Paciente" }], correctedRows: [{ service: "Clínica", patient: "Paciente" }] });
    }
    const encrypted = readFileSync(join(root, "learning", "board-corrections.enc.json"), "utf8");
    assert.doesNotMatch(encrypted, /CLINCA|Clínica|Paciente/);
    const rows = applyLearnedCorrections({ dataDir: root, secret, rows: [{ service: "clinca", patient: "Otro paciente" }] });
    assert.equal(rows[0].service, "Clínica");
    assert.equal(rows[0].patient, "Otro paciente");
    assert.equal(correctionStatus(root, secret).corrections, 2);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
