import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  applyStatusUpdates,
  approveOutbound,
  deliverOutbound,
  normalizeArgentinePhone,
  outboxSummary,
  queueOutbound,
  queueOutboundBatch,
  readOutbox,
  rejectOutbound,
  serviceWindowStatus,
  deliverManual,
  manualBatchLinks,
  waMeLink,
  validateOutbound,
} from "./whatsapp-send.mjs";
import { whatsappCanSend, whatsappReady } from "./whatsapp.mjs";

const SECRET = "x".repeat(48);
const CONFIG = {
  verifyToken: "v",
  accessToken: "token",
  appSecret: "s",
  phoneNumberId: "111222333",
  graphVersion: "v23.0",
};

function freshDir(inbound = []) {
  const dir = mkdtempSync(join(tmpdir(), "wa-out-"));
  mkdirSync(join(dir, "whatsapp"), { recursive: true });
  writeFileSync(join(dir, "whatsapp", "inbox.json"), JSON.stringify(inbound), "utf8");
  return dir;
}

function okFetch(body = { messages: [{ id: "wamid.TEST" }] }) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init, payload: JSON.parse(init.body) });
    return { ok: true, status: 200, json: async () => body };
  };
  impl.calls = calls;
  return impl;
}

test("normalizeArgentinePhone acepta los formatos que usa el hospital", () => {
  assert.equal(normalizeArgentinePhone("2604056998"), "5492604056998");
  assert.equal(normalizeArgentinePhone("+54 9 260 405-6998"), "5492604056998");
  assert.equal(normalizeArgentinePhone("0260 15 4056998"), "5492604056998");
  assert.equal(normalizeArgentinePhone("5492604056998"), "5492604056998");
  assert.equal(normalizeArgentinePhone("260405699"), null);
  assert.equal(normalizeArgentinePhone(""), null);
  assert.equal(normalizeArgentinePhone("hola"), null);
});

test("validateOutbound exige motivo y rechaza parámetros que Meta descarta", () => {
  assert.throws(() => validateOutbound({ to: "2604056998", kind: "text", body: "hola" }, "coord"), /invalid_motivo/);
  assert.throws(() => validateOutbound({ to: "nope", kind: "text", body: "h", motivo: "m" }, "coord"), /invalid_recipient/);
  assert.throws(
    () => validateOutbound({ to: "2604056998", kind: "template", templateName: "aviso_guardia", params: ["dos  espacios"], motivo: "m" }, "coord"),
    /invalid_template_params/,
  );
  assert.throws(
    () => validateOutbound({ to: "2604056998", kind: "template", templateName: "Aviso-Guardia", motivo: "m" }, "coord"),
    /invalid_template_name/,
  );
  const ok = validateOutbound({ to: "2604056998", kind: "template", templateName: "aviso_guardia", params: ["Sin", "jueves"], motivo: "cambio de guardia" }, "coord");
  assert.equal(ok.estado, "BORRADOR");
  assert.equal(ok.languageCode, "es_AR");
});

test("la ventana de servicio se calcula desde el último entrante", () => {
  const now = Date.parse("2026-09-28T18:00:00.000Z");
  const dir = freshDir([
    { remitente: "5492604056998", recibido_en: new Date(now - 2 * 60 * 60 * 1000).toISOString() },
    { remitente: "5492604111111", recibido_en: new Date(now - 30 * 60 * 60 * 1000).toISOString() },
  ]);
  assert.equal(serviceWindowStatus(dir, "2604056998", now).open, true);
  assert.equal(serviceWindowStatus(dir, "2604111111", now).open, false);
  assert.equal(serviceWindowStatus(dir, "2604999999", now).open, false);
});

test("texto libre fuera de ventana se rechaza sin llamar a Meta", async () => {
  const dir = freshDir([]);
  const record = queueOutbound(dir, SECRET, { to: "2604056998", kind: "text", body: "hola", motivo: "prueba" }, "coord");
  approveOutbound(dir, SECRET, record.id, "direccion");
  const impl = okFetch();
  await assert.rejects(
    deliverOutbound({ dataDir: dir, secret: SECRET, id: record.id, config: CONFIG, fetchImpl: impl }),
    /service_window_closed/,
  );
  assert.equal(impl.calls.length, 0);
  assert.equal(readOutbox(dir, SECRET)[0].estado, "FALLIDO");
});

test("sin webhook la app no bloquea el texto: decide Meta", async () => {
  const dir = freshDir([]);
  const record = queueOutbound(dir, SECRET, { to: "2604056998", kind: "text", body: "hola", motivo: "prueba" }, "coord");
  approveOutbound(dir, SECRET, record.id, "direccion");
  const impl = okFetch();
  const sendOnly = { accessToken: "token", phoneNumberId: "111222333", graphVersion: "v23.0", verifyToken: "", appSecret: "" };
  const sent = await deliverOutbound({ dataDir: dir, secret: SECRET, id: record.id, config: sendOnly, fetchImpl: impl });
  assert.equal(sent.estado, "ENVIADO");
  assert.equal(impl.calls.length, 1);
  assert.equal(impl.calls[0].payload.type, "text");
});

test("la plantilla sale aunque la ventana esté cerrada", async () => {
  const dir = freshDir([]);
  const record = queueOutbound(
    dir,
    SECRET,
    { to: "2604056998", kind: "template", templateName: "aviso_guardia", params: ["Sin", "jueves 2/10"], motivo: "cambio de guardia" },
    "coord",
  );
  approveOutbound(dir, SECRET, record.id, "direccion");
  const impl = okFetch();
  const sent = await deliverOutbound({ dataDir: dir, secret: SECRET, id: record.id, config: CONFIG, fetchImpl: impl });
  assert.equal(sent.estado, "ENVIADO");
  assert.equal(sent.wamid, "wamid.TEST");
  assert.equal(impl.calls[0].payload.type, "template");
  assert.equal(impl.calls[0].payload.to, "5492604056998");
  assert.deepEqual(impl.calls[0].payload.template.components[0].parameters.map((p) => p.text), ["Sin", "jueves 2/10"]);
  assert.match(impl.calls[0].url, /v23\.0\/111222333\/messages$/);
});

test("no se envía sin aprobación", async () => {
  const dir = freshDir([]);
  const record = queueOutbound(dir, SECRET, { to: "2604056998", kind: "template", templateName: "aviso_guardia", motivo: "m" }, "coord");
  await assert.rejects(
    deliverOutbound({ dataDir: dir, secret: SECRET, id: record.id, config: CONFIG, fetchImpl: okFetch() }),
    /outbound_not_approved/,
  );
});

test("el lote respeta el tope y rechaza destinatarios repetidos", () => {
  const dir = freshDir([]);
  const many = Array.from({ length: 26 }, (_, i) => `26040${String(i).padStart(5, "0")}`);
  assert.throws(() => queueOutboundBatch(dir, SECRET, many, { kind: "template", templateName: "aviso_guardia", motivo: "m" }, "coord"), /too_many_recipients/);
  assert.throws(
    () => queueOutboundBatch(dir, SECRET, ["2604056998", "0260 15 4056998"], { kind: "template", templateName: "aviso_guardia", motivo: "m" }, "coord"),
    /duplicate_recipient/,
  );
  const created = queueOutboundBatch(dir, SECRET, ["2604056998", "2604111111"], { kind: "template", templateName: "aviso_guardia", motivo: "m" }, "coord");
  assert.equal(created.length, 2);
});

test("un envío idéntico al mismo destinatario se bloquea", async () => {
  const dir = freshDir([]);
  const input = { to: "2604056998", kind: "template", templateName: "aviso_guardia", params: ["igual"], motivo: "m" };
  const first = queueOutbound(dir, SECRET, input, "coord");
  approveOutbound(dir, SECRET, first.id, "direccion");
  await deliverOutbound({ dataDir: dir, secret: SECRET, id: first.id, config: CONFIG, fetchImpl: okFetch() });
  const second = queueOutbound(dir, SECRET, input, "coord");
  approveOutbound(dir, SECRET, second.id, "direccion");
  await assert.rejects(
    deliverOutbound({ dataDir: dir, secret: SECRET, id: second.id, config: CONFIG, fetchImpl: okFetch() }),
    /duplicate_send/,
  );
});

test("un error de Meta queda registrado con código", async () => {
  const dir = freshDir([]);
  const record = queueOutbound(dir, SECRET, { to: "2604056998", kind: "template", templateName: "aviso_guardia", motivo: "m" }, "coord");
  approveOutbound(dir, SECRET, record.id, "direccion");
  const impl = async () => ({ ok: false, status: 400, json: async () => ({ error: { message: "Template name does not exist", code: 132001 } }) });
  await assert.rejects(deliverOutbound({ dataDir: dir, secret: SECRET, id: record.id, config: CONFIG, fetchImpl: impl }), /whatsapp_send_132001/);
  const stored = readOutbox(dir, SECRET)[0];
  assert.equal(stored.estado, "FALLIDO");
  assert.equal(stored.error_code, 132001);
  assert.equal(stored.intentos, 1);
});

test("los acuses de Meta avanzan el estado y no retroceden", async () => {
  const dir = freshDir([]);
  const record = queueOutbound(dir, SECRET, { to: "2604056998", kind: "template", templateName: "aviso_guardia", motivo: "m" }, "coord");
  approveOutbound(dir, SECRET, record.id, "direccion");
  await deliverOutbound({ dataDir: dir, secret: SECRET, id: record.id, config: CONFIG, fetchImpl: okFetch() });

  const statuses = (status) => ({ entry: [{ changes: [{ value: { statuses: [{ id: "wamid.TEST", status, pricing: { billable: true, category: "utility" } }] } }] }] });
  assert.equal(applyStatusUpdates(dir, SECRET, statuses("delivered")), 1);
  assert.equal(readOutbox(dir, SECRET)[0].estado, "ENTREGADO");
  assert.equal(readOutbox(dir, SECRET)[0].facturable, true);
  assert.equal(applyStatusUpdates(dir, SECRET, statuses("read")), 1);
  assert.equal(readOutbox(dir, SECRET)[0].estado, "LEIDO");
  // acuse fuera de orden
  assert.equal(applyStatusUpdates(dir, SECRET, statuses("delivered")), 0);
  assert.equal(readOutbox(dir, SECRET)[0].estado, "LEIDO");
});

test("rechazar saca el mensaje de la cola", () => {
  const dir = freshDir([]);
  const record = queueOutbound(dir, SECRET, { to: "2604056998", kind: "template", templateName: "aviso_guardia", motivo: "m" }, "coord");
  rejectOutbound(dir, SECRET, record.id, "direccion", "no corresponde");
  assert.equal(readOutbox(dir, SECRET)[0].estado, "RECHAZADO");
  assert.throws(() => approveOutbound(dir, SECRET, record.id, "direccion"), /outbound_not_draft/);
  assert.equal(outboxSummary(dir, SECRET).borradores, 0);
});

test("el almacén queda cifrado en disco", () => {
  const dir = freshDir([]);
  queueOutbound(dir, SECRET, { to: "2604056998", kind: "text", body: "dato reservado", motivo: "m" }, "coord");
  const raw = readOutbox(dir, SECRET);
  assert.equal(raw[0].body, "dato reservado");
  const onDisk = JSON.parse(readFileSync(join(dir, "whatsapp", "private-outbox.enc.json"), "utf8"));
  assert.equal(onDisk.version, 1);
  assert.ok(!JSON.stringify(onDisk).includes("dato reservado"));
});

test("waMeLink arma el link con el número normalizado", () => {
  assert.equal(waMeLink("0260 15 4056998", "Hola"), "https://wa.me/5492604056998?text=Hola");
  assert.match(waMeLink("2604056998", "Guardia jueves 2/10"), /text=Guardia%20jueves%202%2F10$/);
  assert.throws(() => waMeLink("nope", "x"), /invalid_recipient/);
  assert.throws(() => waMeLink("2604056998", ""), /invalid_body/);
});

test("el canal manual sale sin ventana de servicio y sin token", () => {
  const dir = freshDir([]);
  const record = queueOutbound(dir, SECRET, { to: "2604056998", kind: "text", body: "Cambio de guardia", motivo: "aviso" }, "coord");
  approveOutbound(dir, SECRET, record.id, "direccion");
  const sent = deliverManual(dir, SECRET, record.id, "direccion");
  assert.equal(sent.estado, "ENVIADO");
  assert.equal(sent.canal, "MANUAL");
  assert.equal(sent.acuse_disponible, false);
  assert.equal(sent.link, "https://wa.me/5492604056998?text=Cambio%20de%20guardia");
});

test("el canal manual respeta aprobación y no acepta plantillas", () => {
  const dir = freshDir([]);
  const draft = queueOutbound(dir, SECRET, { to: "2604056998", kind: "text", body: "x", motivo: "m" }, "coord");
  assert.throws(() => deliverManual(dir, SECRET, draft.id, "direccion"), /outbound_not_approved/);
  const tpl = queueOutbound(dir, SECRET, { to: "2604111111", kind: "template", templateName: "aviso_guardia", motivo: "m" }, "coord");
  approveOutbound(dir, SECRET, tpl.id, "direccion");
  assert.throws(() => deliverManual(dir, SECRET, tpl.id, "direccion"), /manual_requires_text/);
});

test("manualBatchLinks lista sólo lo aprobado", () => {
  const dir = freshDir([]);
  const a = queueOutbound(dir, SECRET, { to: "2604056998", kind: "text", body: "uno", motivo: "m" }, "coord");
  queueOutbound(dir, SECRET, { to: "2604111111", kind: "text", body: "dos", motivo: "m" }, "coord");
  approveOutbound(dir, SECRET, a.id, "direccion");
  const links = manualBatchLinks(dir, SECRET);
  assert.equal(links.length, 1);
  assert.equal(links[0].to, "5492604056998");
});

test("enviar no exige el secreto de la app ni el token de verificación", async () => {
  const dir = freshDir([]);
  const record = queueOutbound(dir, SECRET, { to: "2604056998", kind: "template", templateName: "hello_world", languageCode: "en_US", motivo: "prueba de conexión" }, "coord");
  approveOutbound(dir, SECRET, record.id, "direccion");
  const impl = okFetch();
  const sendOnly = { verifyToken: "", appSecret: "", accessToken: "token", phoneNumberId: "111222333", graphVersion: "v23.0" };
  assert.equal(whatsappCanSend(sendOnly), true);
  assert.equal(whatsappReady(sendOnly), false);
  const sent = await deliverOutbound({ dataDir: dir, secret: SECRET, id: record.id, config: sendOnly, fetchImpl: impl });
  assert.equal(sent.estado, "ENVIADO");
  assert.equal(impl.calls[0].payload.template.language.code, "en_US");
  assert.equal(impl.calls[0].payload.template.components, undefined);
});

test("sin token o sin número no se envía y no se llama a Meta", async () => {
  const dir = freshDir([]);
  const record = queueOutbound(dir, SECRET, { to: "2604056998", kind: "template", templateName: "hello_world", languageCode: "en_US", motivo: "prueba" }, "coord");
  approveOutbound(dir, SECRET, record.id, "direccion");
  const impl = okFetch();
  assert.equal(whatsappCanSend({ ...CONFIG, accessToken: "" }), false);
  assert.equal(whatsappCanSend({ ...CONFIG, phoneNumberId: "" }), false);
  assert.equal(whatsappCanSend({ ...CONFIG, graphVersion: "latest" }), false);
  await assert.rejects(deliverOutbound({ dataDir: dir, secret: SECRET, id: record.id, config: { ...CONFIG, accessToken: "" }, fetchImpl: impl }), /whatsapp_not_configured/);
  assert.equal(impl.calls.length, 0);
});

test("si Meta rechaza 549... por lista de prueba, reintenta una vez sin el 9", async () => {
  const dir = freshDir([]);
  const record = queueOutbound(dir, SECRET, { to: "2604604804", kind: "template", templateName: "hello_world", languageCode: "en_US", motivo: "prueba" }, "coord");
  approveOutbound(dir, SECRET, record.id, "direccion");
  const calls = [];
  const impl = async (_url, init) => {
    const payload = JSON.parse(init.body);
    calls.push(payload.to);
    return payload.to.startsWith("549")
      ? { ok: false, status: 400, json: async () => ({ error: { code: 131030, message: "Recipient phone number not in allowed list" } }) }
      : { ok: true, status: 200, json: async () => ({ messages: [{ id: "wamid.ALT" }] }) };
  };
  const sent = await deliverOutbound({ dataDir: dir, secret: SECRET, id: record.id, config: CONFIG, fetchImpl: impl });
  assert.deepEqual(calls, ["5492604604804", "542604604804"]);
  assert.equal(sent.estado, "ENVIADO");
  assert.equal(sent.wamid, "wamid.ALT");
  assert.equal(sent.enviado_a, "542604604804");
});

test("otro error de Meta no dispara el reintento", async () => {
  const dir = freshDir([]);
  const record = queueOutbound(dir, SECRET, { to: "2604604804", kind: "template", templateName: "hello_world", languageCode: "en_US", motivo: "prueba" }, "coord");
  approveOutbound(dir, SECRET, record.id, "direccion");
  let count = 0;
  const impl = async () => { count += 1; return { ok: false, status: 401, json: async () => ({ error: { code: 190, message: "Authentication Error" } }) }; };
  await assert.rejects(deliverOutbound({ dataDir: dir, secret: SECRET, id: record.id, config: CONFIG, fetchImpl: impl }), /whatsapp_send_190/);
  assert.equal(count, 1);
});
