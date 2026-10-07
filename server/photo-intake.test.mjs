import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createPhotoIntake, estimateShift, photoFolder, scanPhotoFolder } from "./photo-intake.mjs";
import { captureInbox, findCapture } from "./capture.mjs";

const jpeg = (seed) => Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...Buffer.from(seed), 0xff, 0xd9]);
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "sch-intake-test-"));
  const dataDir = join(root, "data"); const folder = join(root, "fotos");
  mkdirSync(dataDir); mkdirSync(folder);
  return { root, dataDir, folder, done: () => rmSync(root, { recursive: true, force: true }) };
}

test("una foto nueva entra sola una única vez y la carpeta de origen no se toca", () => {
  const ctx = fixture();
  try {
    writeFileSync(join(ctx.folder, "IMG-20261005-WA0001.jpg"), jpeg("pizarra-uno"));
    writeFileSync(join(ctx.folder, "nota.txt"), "no es imagen");
    mkdirSync(join(ctx.folder, "Sent")); writeFileSync(join(ctx.folder, "Sent", "IMG-20261005-WA0009.jpg"), jpeg("enviada"));
    const now = new Date("2026-10-05T15:00:00Z");
    assert.equal(scanPhotoFolder({ dataDir: ctx.dataDir, folder: ctx.folder, now }).added.length, 1);
    assert.equal(scanPhotoFolder({ dataDir: ctx.dataDir, folder: ctx.folder, now }).added.length, 0);
    const inbox = captureInbox(ctx.dataDir);
    assert.equal(inbox.length, 1);
    assert.equal(inbox[0].fuente, "WHATSAPP_CARPETA");
    assert.equal(inbox[0].estado, "A_CONFIRMAR");
    assert.equal(inbox[0].turno_origen, "ESTIMADO_POR_HORA");
    assert.equal(inbox[0].path, undefined);
    assert.ok(findCapture(ctx.dataDir, inbox[0].captura_id));
    assert.deepEqual(readdirSync(ctx.folder).sort(), ["IMG-20261005-WA0001.jpg", "Sent", "nota.txt"]);
  } finally { ctx.done(); }
});

test("la misma imagen con otro nombre no se duplica y una foto de más de dos semanas no entra", () => {
  const ctx = fixture();
  try {
    const now = new Date("2026-10-05T15:00:00Z");
    writeFileSync(join(ctx.folder, "IMG-20261005-WA0001.jpg"), jpeg("igual"));
    writeFileSync(join(ctx.folder, "IMG-20261005-WA0002.jpg"), jpeg("igual"));
    writeFileSync(join(ctx.folder, "IMG-20260901-WA0003.jpg"), jpeg("vieja-por-nombre"));
    const oldPath = join(ctx.folder, "foto.jpg"); writeFileSync(oldPath, jpeg("vieja-por-fecha"));
    const old = new Date("2026-09-10T12:00:00Z"); utimesSync(oldPath, old, old);
    assert.equal(scanPhotoFolder({ dataDir: ctx.dataDir, folder: ctx.folder, now }).added.length, 1);
    assert.equal(captureInbox(ctx.dataDir).length, 1);
  } finally { ctx.done(); }
});

test("un archivo incompleto se reintenta y entra cuando termina de copiarse", () => {
  const ctx = fixture();
  try {
    const path = join(ctx.folder, "IMG-20261005-WA0004.jpg");
    const now = new Date("2026-10-05T15:00:00Z"); const stamp = new Date("2026-10-05T14:00:00Z");
    writeFileSync(path, Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2])); utimesSync(path, stamp, stamp);
    assert.equal(scanPhotoFolder({ dataDir: ctx.dataDir, folder: ctx.folder, now }).added.length, 0);
    assert.equal(scanPhotoFolder({ dataDir: ctx.dataDir, folder: ctx.folder, now }).added.length, 0);
    writeFileSync(path, jpeg("completa")); utimesSync(path, stamp, stamp);
    assert.equal(scanPhotoFolder({ dataDir: ctx.dataDir, folder: ctx.folder, now }).added.length, 1);
  } finally { ctx.done(); }
});

test("carpeta inexistente: informa el error y no rompe; turno estimado por hora de Mendoza", () => {
  const ctx = fixture();
  try {
    const intake = createPhotoIntake({ root: ctx.root, dataDir: ctx.dataDir, env: { PIZARRAS_FOLDER: join(ctx.root, "no-existe") } });
    assert.equal(intake.scan().ok, false);
    assert.equal(intake.status().lastError, "ENOENT");
    assert.equal(intake.status().lecturaAutomatica, false);
    assert.equal(photoFolder({ root: ctx.root, dataDir: ctx.dataDir, env: {} }).configured, false);
    assert.equal(estimateShift(new Date("2026-10-05T11:00:00Z")), "M"); // 08:00
    assert.equal(estimateShift(new Date("2026-10-05T16:00:00Z")), "T"); // 13:00
    assert.equal(estimateShift(new Date("2026-10-05T23:30:00Z")), "N"); // 20:30
    assert.equal(estimateShift(new Date("2026-10-06T02:00:00Z")), "N"); // 23:00
  } finally { ctx.done(); }
});

test("sin autorización de IA no se llama a ningún servicio externo al entrar una foto", () => {
  const ctx = fixture();
  try {
    let calls = 0;
    writeFileSync(join(ctx.folder, "IMG-20261005-WA0001.jpg"), jpeg("sin-ia"));
    const stamp = new Date(); utimesSync(join(ctx.folder, "IMG-20261005-WA0001.jpg"), stamp, stamp);
    const intake = createPhotoIntake({ root: ctx.root, dataDir: ctx.dataDir, env: { PIZARRAS_FOLDER: ctx.folder }, ai: { enabled: true, apiKey: "x", model: "m", allowClinicalData: false }, fetchImpl: () => { calls += 1; throw new Error("no"); } });
    intake.scan();
    assert.equal(calls, 0);
  } finally { ctx.done(); }
});

test("una foto recibida por WhatsApp vinculado conserva grupo, remitente, texto y turno del grupo", async () => {
  const { shiftFromGroup } = await import("./photo-intake.mjs");
  const ctx = fixture();
  try {
    const now = new Date("2026-10-05T15:00:00Z");
    for (const [name, grupo] of [["WA-20261005-140000-AAA.jpg", "Pizarras Mañana"], ["WA-20261005-140100-BBB.jpg", "Secretarios de Sala"]]) {
      writeFileSync(join(ctx.folder, `${name}.json`), JSON.stringify({ mensaje_id: name, grupo, remitente: "5492600000000", remitente_nombre: "Secretaria de prueba", texto: "Uccyq", enviado_en: "2026-10-05T23:30:00Z" }));
      writeFileSync(join(ctx.folder, name), jpeg(name));
    }
    assert.equal(scanPhotoFolder({ dataDir: ctx.dataDir, folder: ctx.folder, now }).added.length, 2);
    const inbox = captureInbox(ctx.dataDir);
    const byGroup = inbox.find((item) => item.grupo === "Pizarras Mañana");
    const unknown = inbox.find((item) => item.grupo === "Secretarios de Sala");
    assert.equal(byGroup.fuente, "WHATSAPP_VINCULADO");
    assert.equal(byGroup.texto, "Uccyq");
    assert.deepEqual([byGroup.turno, byGroup.turno_origen], ["M", "GRUPO"]);
    assert.deepEqual([unknown.turno, unknown.turno_origen], ["N", "ESTIMADO_POR_HORA"]);
    assert.equal(shiftFromGroup("Camas mediodía"), "T");
    assert.equal(shiftFromGroup("Tarde/Noche"), "N");
    assert.equal(shiftFromGroup(null), null);
  } finally { ctx.done(); }
});
