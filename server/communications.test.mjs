import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classifyCommunication, communicationsInbox, reviewCommunication, saveManualCommunication } from "./communications.mjs";

const SECRET = "c".repeat(32);

test("communication classifier separates alerts, transport, direction and questions", () => {
  assert.deepEqual(classifyCommunication({ text: "URGENTE: hay un incendio" }), { category: "ALERTA", priority: "URGENTE" });
  assert.equal(classifyCommunication({ text: "Necesito transporte al hospital" }).category, "TRANSPORTE");
  assert.equal(classifyCommunication({ text: "Comunicado de Dirección" }).category, "DIRECCION");
  assert.equal(classifyCommunication({ text: "¿Dónde debo presentarme?" }).category, "CONSULTA");
  assert.equal(classifyCommunication({ type: "image" }).category, "PIZARRA");
});

test("manual communications are encrypted and human review is preserved", () => {
  const dataDir = mkdtempSync(join(tmpdir(), "sch-communications-test-"));
  try {
    const saved = saveManualCommunication({ dataDir, secret: SECRET, sender: "Servicio de prueba", text: "Necesito transporte", actor: "direccion" });
    assert.equal(saved.category, "TRANSPORTE");
    const encrypted = readFileSync(join(dataDir, "communications", "private-inbox.enc.json"), "utf8");
    assert.doesNotMatch(encrypted, /Servicio de prueba|Necesito transporte/);

    reviewCommunication({ dataDir, secret: SECRET, id: saved.id, status: "RESUELTO", category: "TRANSPORTE", actor: "direccion" });
    const inbox = communicationsInbox({ dataDir, secret: SECRET, waConfig: {} });
    assert.equal(inbox.items[0].status, "RESUELTO");
    assert.equal(inbox.items[0].reviewedBy, "direccion");
    assert.equal(inbox.configured, false);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});
