import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHospitalServer } from "./app.mjs";
import { hashPassword } from "./auth.mjs";
import { createHmac } from "node:crypto";

function fixture({ waOverrides = {}, fetchImpl = fetch } = {}) {
  const root = mkdtempSync(join(tmpdir(), "sch-server-test-"));
  const distDir = join(root, "dist");
  const dataDir = join(root, "data");
  mkdirSync(distDir); mkdirSync(dataDir);
  writeFileSync(join(distDir, "index.html"), "<!doctype html><title>privado</title>");
  const catalogFile = join(root, "catalog.json");
  writeFileSync(catalogFile, JSON.stringify({ documents: [{ id: "abc12345", departments: ["guardia"], shifts: [{ date: "2026-09-21", text: "PEREZ" }, { date: "2026-09-22", text: "GOMEZ" }] }] }));
  const internacionFile = join(root, "internacion.json");
  writeFileSync(internacionFile, JSON.stringify({ beds: [{ slug: "clinica-1", cama: "101", estado: "OCUPADA", paciente: "PACIENTE PRUEBA" }] }));
  const passwordHash = hashPassword("clave-de-prueba-segura", "00112233445566778899aabbccddeeff");
  const users = [
    { id: "direccion", name: "Dirección", role: "DIRECTION", staffId: null, passwordHash },
    { id: "coordinacion", name: "Coordinación", role: "COORDINATOR", staffId: null, passwordHash },
    { id: "chofer1", name: "Chofer Uno", role: "DRIVER", staffId: "driver-1", passwordHash },
    { id: "consulta", name: "Consulta", role: "VIEWER", staffId: null, passwordHash },
  ];
  const authConfig = { secret: "s".repeat(32), users, secureCookie: false, sessionHours: 8 };
  const waConfig = { verifyToken: "", accessToken: "", appSecret: "", phoneNumberId: "", groupId: "", graphVersion: "", ...waOverrides };
  const server = createHospitalServer({ distDir, dataDir, catalogFile, internacionFile, authConfig, waConfig, fetchImpl });
  return { root, server };
}

async function running(fn, options) {
  const ctx = fixture(options);
  await new Promise((resolve) => ctx.server.listen(0, "127.0.0.1", resolve));
  const address = ctx.server.address();
  const base = `http://127.0.0.1:${address.port}`;
  try { await fn(base, ctx); }
  finally {
    await new Promise((resolve) => ctx.server.close(resolve));
    assert.ok(ctx.root.startsWith(tmpdir()));
    rmSync(ctx.root, { recursive: true, force: true });
  }
}

test("clinical app is private and login creates an httpOnly session", () => running(async (base) => {
  const blocked = await fetch(`${base}/internados/pacientes`, { redirect: "manual" });
  assert.equal(blocked.status, 302);
  assert.equal(blocked.headers.get("location"), "/login");

  const bad = await fetch(`${base}/api/login`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "user=direccion&password=incorrecta" });
  assert.equal(bad.status, 401);

  const login = await fetch(`${base}/api/login`, { method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "user=direccion&password=clave-de-prueba-segura" });
  assert.equal(login.status, 303);
  const cookie = login.headers.get("set-cookie");
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);

  const allowed = await fetch(`${base}/internados/pacientes`, { headers: { cookie } });
  assert.equal(allowed.status, 200);
  assert.match(await allowed.text(), /privado/);
  assert.match(allowed.headers.get("content-security-policy"), /frame-ancestors 'none'/);

  const logout = await fetch(`${base}/api/logout`, { method: "POST", redirect: "manual", headers: { cookie } });
  assert.equal(logout.status, 303);
  assert.match(logout.headers.get("set-cookie"), /Max-Age=0/);
}));

test("login rate limit blocks repeated password guessing", () => running(async (base) => {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const failed = await fetch(`${base}/api/login`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "user=direccion&password=incorrecta" });
    assert.equal(failed.status, 401);
  }
  const blocked = await fetch(`${base}/api/login`, { method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "user=direccion&password=clave-de-prueba-segura" });
  assert.equal(blocked.status, 429);
}));

test("WhatsApp bilateral: entrada firmada, borrador, aprobación, envío y acuse", () => running(async (base) => {
  const login = await fetch(`${base}/api/login`, { method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "user=direccion&password=clave-de-prueba-segura" });
  const cookie = login.headers.get("set-cookie");
  const auth = { cookie, "content-type": "application/json" };
  const inbound = { entry: [{ changes: [{ value: { messages: [{ id: "wamid.IN", from: "5492604056998", type: "text", text: { body: "Necesito confirmar mi guardia" } }] } }] }] };
  const raw = JSON.stringify(inbound);
  const signature = `sha256=${createHmac("sha256", "app-secret-test").update(raw).digest("hex")}`;
  const accepted = await fetch(`${base}/api/whatsapp/webhook`, { method: "POST", headers: { "x-hub-signature-256": signature }, body: raw });
  assert.equal(accepted.status, 200);
  const inbox = await fetch(`${base}/api/communications`, { headers: { cookie } });
  assert.equal((await inbox.json()).items[0].text, "Necesito confirmar mi guardia");
  const draftResponse = await fetch(`${base}/api/whatsapp/outbox`, { method: "POST", headers: auth, body: JSON.stringify({ to: "2604056998", kind: "text", body: "Guardia confirmada", motivo: "respuesta operativa" }) });
  assert.equal(draftResponse.status, 201);
  const draft = (await draftResponse.json()).record;
  const action = async (id, operation) => fetch(`${base}/api/whatsapp/outbox/action`, { method: "POST", headers: auth, body: JSON.stringify({ id, action: operation }) });
  assert.equal((await action(draft.id, "send")).status, 400);
  assert.equal((await action(draft.id, "approve")).status, 200);
  const sent = await action(draft.id, "send");
  assert.equal(sent.status, 200);
  assert.equal((await sent.json()).record.estado, "ENVIADO");
  const statusRaw = JSON.stringify({ entry: [{ changes: [{ value: { statuses: [{ id: "wamid.OUT", status: "delivered" }] } }] }] });
  const statusSignature = `sha256=${createHmac("sha256", "app-secret-test").update(statusRaw).digest("hex")}`;
  assert.equal((await fetch(`${base}/api/whatsapp/webhook`, { method: "POST", headers: { "x-hub-signature-256": statusSignature }, body: statusRaw })).status, 200);
  const outbox = await fetch(`${base}/api/whatsapp/outbox`, { headers: { cookie } });
  const current = (await outbox.json()).items[0];
  assert.equal(current.estado, "ENTREGADO");
  assert.equal(current.serviceWindow.open, true);
}, { waOverrides: { verifyToken: "verify", accessToken: "test-token", appSecret: "app-secret-test", phoneNumberId: "123", graphVersion: "v23.0" }, fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ messages: [{ id: "wamid.OUT" }] }) }) }));

test("WhatsApp schedules are private, role-guarded and cancellable", () => running(async (base) => {
  assert.equal((await fetch(`${base}/api/whatsapp/schedules`)).status, 401);
  const viewerLogin = await fetch(`${base}/api/login`, { method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "user=consulta&password=clave-de-prueba-segura" });
  assert.equal((await fetch(`${base}/api/whatsapp/schedules`, { headers: { cookie: viewerLogin.headers.get("set-cookie") } })).status, 403);
  const login = await fetch(`${base}/api/login`, { method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "user=direccion&password=clave-de-prueba-segura" });
  const auth = { cookie: login.headers.get("set-cookie"), "content-type": "application/json" };
  const created = await fetch(`${base}/api/whatsapp/schedules`, { method: "POST", headers: auth, body: JSON.stringify({ recipients: ["2604056998"], body: "Aviso programado", motivo: "Prueba", firstAt: new Date(Date.now() + 10 * 60_000).toISOString(), recurrence: "MONTHLY" }) });
  assert.equal(created.status, 201);
  const schedule = (await created.json()).schedule;
  assert.equal(schedule.recipientCount, 1);
  assert.equal("body" in schedule, false);
  assert.equal("recipients" in schedule, false);
  const listed = await fetch(`${base}/api/whatsapp/schedules`, { headers: auth });
  assert.equal((await listed.json()).schedules[0].id, schedule.id);
  assert.equal((await fetch(`${base}/api/whatsapp/schedules`, { method: "DELETE", headers: auth, body: JSON.stringify({ id: schedule.id }) })).status, 200);
}));

test("communications roles see only messaging fields in the staff directory", () => running(async (base) => {
  const login = await fetch(`${base}/api/login`, { method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "user=coordinacion&password=clave-de-prueba-segura" });
  const cookie = login.headers.get("set-cookie");
  const directory = await fetch(`${base}/api/personal/messaging-directory`, { headers: { cookie } });
  assert.equal(directory.status, 200);
  const body = await directory.json();
  assert.ok(Array.isArray(body.people));
  assert.ok(body.people.length > 0);
  assert.equal(body.people.some((person) => "address" in person || "dni" in person || "email" in person), false);
  assert.equal((await fetch(`${base}/api/personal/directory`, { headers: { cookie } })).status, 403);
}));

test("driver receives only the dedicated screen and own operational record", () => running(async (base, ctx) => {
  mkdirSync(join(ctx.root, "data", "continuidad"), { recursive: true });
  writeFileSync(join(ctx.root, "data", "continuidad", "control.json"), JSON.stringify({ emergency: false, minima: {}, closures: [], staffMarks: [
    { staff_id: "driver-1", pickup_id: "PUNTO-NORTE", transport_status: "CAN_DRIVE" },
    { staff_id: "private-other", pickup_id: "NO-VISIBLE", transport_status: "NEEDS_TRANSPORT" },
  ] }));
  const login = await fetch(`${base}/api/login`, { method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "user=chofer1&password=clave-de-prueba-segura" });
  assert.equal(login.headers.get("location"), "/driver");
  const cookie = login.headers.get("set-cookie");
  const clinical = await fetch(`${base}/internados/pacientes`, { redirect: "manual", headers: { cookie } });
  assert.equal(clinical.status, 302);
  assert.equal(clinical.headers.get("location"), "/driver");
  const control = await fetch(`${base}/api/continuidad/control`, { headers: { cookie } });
  const state = await control.json();
  assert.deepEqual(state.staffMarks.map((item) => item.staff_id), ["driver-1"]);
  assert.doesNotMatch(JSON.stringify(state), /private-other|NO-VISIBLE/);
}));

test("manual photo stays private and requires a recorded human review", () => running(async (base) => {
  const login = await fetch(`${base}/api/login`, { method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "user=direccion&password=clave-de-prueba-segura" });
  const cookie = login.headers.get("set-cookie");
  const rejected = await fetch(`${base}/api/capture/upload`, { method: "POST", headers: { cookie, "content-type": "image/jpeg", "x-file-name": "fake.jpg" }, body: "not an image" });
  assert.equal(rejected.status, 400);
  const jpeg = Buffer.from([0xff, 0xd8, 0x01, 0x02, 0xff, 0xd9]);
  const uploaded = await fetch(`${base}/api/capture/upload`, { method: "POST", headers: { cookie, "content-type": "image/jpeg", "x-file-name": "pizarron.jpg" }, body: jpeg });
  assert.equal(uploaded.status, 201);
  const uploadBody = await uploaded.json();
  assert.equal(uploadBody.item.estado, "A_CONFIRMAR");
  assert.equal("path" in uploadBody.item, false);
  const captureId = uploadBody.item.captura_id;
  const original = await fetch(`${base}/api/capture/image/${captureId}`, { headers: { cookie } });
  assert.equal(original.status, 200);
  assert.deepEqual(Buffer.from(await original.arrayBuffer()), jpeg);
  const reviewed = await fetch(`${base}/api/capture/review`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ captureId, decision: "CONFIRMADA", rows: [{ service: "Clínica", room: "1", bed: "2", patient: null, diagnosis: null, arm: false, post_surgical: null, observations: null, confidence: 95 }] }) });
  assert.equal(reviewed.status, 200);
  const review = await reviewed.json();
  assert.equal(review.publicationStatus, "NO_PUBLICADA");
  assert.equal(review.reviewedBy, "direccion");
  const inbox = await fetch(`${base}/api/capture/inbox`, { headers: { cookie } });
  assert.equal((await inbox.json()).inbox[0].estado, "CONFIRMADA");
}));

test("communications inbox classifies, encrypts and requires an authorized review", () => running(async (base, ctx) => {
  const directionLogin = await fetch(`${base}/api/login`, { method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "user=direccion&password=clave-de-prueba-segura" });
  const cookie = directionLogin.headers.get("set-cookie");
  const created = await fetch(`${base}/api/communications/manual`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ sender: "Guardia de prueba", text: "URGENTE: corte de energía" }) });
  assert.equal(created.status, 201);
  const item = (await created.json()).item;
  assert.equal(item.category, "ALERTA");
  assert.equal(item.priority, "URGENTE");

  const encrypted = readFileSync(join(ctx.root, "data", "communications", "private-inbox.enc.json"), "utf8");
  assert.doesNotMatch(encrypted, /Guardia de prueba|corte de energía/);

  const reviewed = await fetch(`${base}/api/communications/review`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ id: item.id, status: "RESUELTO", category: "ALERTA" }) });
  assert.equal(reviewed.status, 200);
  const inbox = await (await fetch(`${base}/api/communications`, { headers: { cookie } })).json();
  assert.equal(inbox.items[0].status, "RESUELTO");
  assert.equal(inbox.items[0].text, "URGENTE: corte de energía");

  const viewerLogin = await fetch(`${base}/api/login`, { method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "user=consulta&password=clave-de-prueba-segura" });
  const blocked = await fetch(`${base}/api/communications`, { headers: { cookie: viewerLogin.headers.get("set-cookie") } });
  assert.equal(blocked.status, 403);
}));

test("mail attachments require an authorized session and download without inline execution", () => running(async (base, ctx) => {
  const hash = "a".repeat(64);
  const id = hash.slice(0, 16);
  const mailDir = join(ctx.root, "data", "mail");
  const attachmentDir = join(mailDir, "attachments");
  mkdirSync(attachmentDir, { recursive: true });
  writeFileSync(join(attachmentDir, `${hash}.xlsx`), "cronograma-prueba");
  writeFileSync(join(mailDir, "pending.json"), JSON.stringify([{ id, sha256: hash, filename: "Cronograma septiembre.xlsx", status: "A_CONFIRMAR" }]));

  const directionLogin = await fetch(`${base}/api/login`, { method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "user=direccion&password=clave-de-prueba-segura" });
  const allowed = await fetch(`${base}/api/mail/attachment/${id}`, { headers: { cookie: directionLogin.headers.get("set-cookie") } });
  assert.equal(allowed.status, 200);
  assert.equal(await allowed.text(), "cronograma-prueba");
  assert.equal(allowed.headers.get("content-type"), "application/octet-stream");
  assert.match(allowed.headers.get("content-disposition"), /^attachment;/);
  assert.match(allowed.headers.get("cache-control"), /no-store/);

  const viewerLogin = await fetch(`${base}/api/login`, { method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "user=consulta&password=clave-de-prueba-segura" });
  const blocked = await fetch(`${base}/api/mail/attachment/${id}`, { headers: { cookie: viewerLogin.headers.get("set-cookie") } });
  assert.equal(blocked.status, 403);
}));

test("exact staff locations are direction-only, encrypted at rest and absent from audit", () => running(async (base, ctx) => {
  const directionLogin = await fetch(`${base}/api/login`, { method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "user=direccion&password=clave-de-prueba-segura" });
  const cookie = directionLogin.headers.get("set-cookie");
  const payload = { staffId: "guardia--persona", address: "Avenida Prueba 123, San Rafael", lat: -34.6123, lng: -68.3312, transportMode: "CAR" };
  const saved = await fetch(`${base}/api/continuidad/private-locations`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify(payload) });
  assert.equal(saved.status, 200);
  const loaded = await fetch(`${base}/api/continuidad/private-locations`, { headers: { cookie } });
  const locations = (await loaded.json()).locations;
  assert.equal(locations[0].address, payload.address);

  const encrypted = readFileSync(join(ctx.root, "data", "continuidad", "private-staff-locations.enc.json"), "utf8");
  assert.doesNotMatch(encrypted, /Avenida Prueba|guardia--persona/);
  const audit = readFileSync(join(ctx.root, "data", "audit.json"), "utf8");
  assert.doesNotMatch(audit, /Avenida Prueba|34\.6123|68\.3312/);

  const viewerLogin = await fetch(`${base}/api/login`, { method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "user=consulta&password=clave-de-prueba-segura" });
  const blocked = await fetch(`${base}/api/continuidad/private-locations`, { headers: { cookie: viewerLogin.headers.get("set-cookie") } });
  assert.equal(blocked.status, 403);

  const maps = await fetch(`${base}/api/maps/config`, { headers: { cookie } });
  assert.deepEqual(await maps.json(), { configured: false, browserKey: null, routesKey: null });
}));

test("private staff address and phone are direction-only and encrypted at rest", () => running(async (base, ctx) => {
  const directionLogin = await fetch(`${base}/api/login`, { method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "user=direccion&password=clave-de-prueba-segura" });
  const cookie = directionLogin.headers.get("set-cookie");
  const payload = { staffId: "guardia--persona", address: "Calle Privada 456, San Rafael", phone: "2604556677" };
  const saved = await fetch(`${base}/api/continuidad/private-contacts`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify(payload) });
  assert.equal(saved.status, 200);
  const loaded = await fetch(`${base}/api/continuidad/private-contacts`, { headers: { cookie } });
  assert.deepEqual((await loaded.json()).contacts[0], { ...payload, updatedAt: (await saved.clone().json()).contact.updatedAt, updatedBy: "direccion" });

  const encrypted = readFileSync(join(ctx.root, "data", "continuidad", "private-staff-contacts.enc.json"), "utf8");
  assert.doesNotMatch(encrypted, /Calle Privada|2604556677|guardia--persona/);
  const audit = readFileSync(join(ctx.root, "data", "audit.json"), "utf8");
  assert.doesNotMatch(audit, /Calle Privada|2604556677/);

  const viewerLogin = await fetch(`${base}/api/login`, { method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "user=consulta&password=clave-de-prueba-segura" });
  const blocked = await fetch(`${base}/api/continuidad/private-contacts`, { headers: { cookie: viewerLogin.headers.get("set-cookie") } });
  assert.equal(blocked.status, 403);

  const deleted = await fetch(`${base}/api/continuidad/private-contacts`, { method: "DELETE", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ staffId: payload.staffId }) });
  assert.deepEqual(await deleted.json(), { deleted: true });
}));

test("viewer cannot mutate emergency, capture, mail or audit", () => running(async (base) => {
  const login = await fetch(`${base}/api/login`, { method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "user=consulta&password=clave-de-prueba-segura" });
  const cookie = login.headers.get("set-cookie");
  const requests = [
    fetch(`${base}/api/continuidad/emergency`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ on: true, reason: "intento inválido" }) }),
    fetch(`${base}/api/capture/inbox`, { headers: { cookie } }),
    fetch(`${base}/api/mail/status`, { headers: { cookie } }),
    fetch(`${base}/api/audit`, { headers: { cookie } }),
    fetch(`${base}/api/catalog/change`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: "{}" }),
    fetch(`${base}/api/identity/confirm`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: "{}" }),
  ];
  for (const response of await Promise.all(requests)) assert.equal(response.status, 403);
}));

test("personal edits preserve all fields and mapped coordinates, but names are immutable", () => running(async (base) => {
  const login = await fetch(`${base}/api/login`, { method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "user=direccion&password=clave-de-prueba-segura" });
  const headers = { cookie: login.headers.get("set-cookie"), "content-type": "application/json" };
  const post = (path, body) => fetch(`${base}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
  const payload = { staffId: "manual-personal-test", name: "Persona de prueba", service: "Servicio A", address: "Domicilio Prueba 123", phone: "2604556677", dni: "12345678", email: "prueba@example.org", transportMode: "BICYCLE", verifyAddress: false };
  assert.equal((await post("/api/continuidad/private-contacts", payload)).status, 200);
  assert.equal((await post("/api/continuidad/private-locations", { staffId: payload.staffId, address: payload.address, lat: -34.62, lng: -68.32, transportMode: "BICYCLE" })).status, 200);
  const saved = await post("/api/continuidad/private-contacts", { staffId: payload.staffId, phone: "2604998877", dni: "87654321", service: "Servicio B" });
  const result = await saved.json();
  assert.equal(result.contact.name, payload.name);
  assert.equal(result.contact.email, payload.email);
  assert.equal(result.contact.address, payload.address);
  assert.equal(result.contact.service, "Servicio B");
  assert.equal(result.contact.dni, "87654321");
  assert.equal(result.location.transportMode, "BICYCLE");
  assert.equal(result.location.lat, -34.62);
  assert.equal(result.locationStatus, "verified");
  const renamed = await post("/api/continuidad/private-contacts", { ...payload, name: "Otro nombre" });
  assert.equal(renamed.status, 400);
  assert.equal((await renamed.json()).error, "staff_name_locked");
  const changed = await post("/api/continuidad/private-contacts", { staffId: payload.staffId, address: "Otra dirección 555", verifyAddress: false });
  assert.equal((await changed.json()).location, null);
  const points = await fetch(`${base}/api/continuidad/private-locations`, { headers });
  assert.equal((await points.json()).locations.length, 0);
}));

test("personal groups persist mixed members and drafts encrypted; service groups reject other areas", () => running(async (base, ctx) => {
  const login = await fetch(`${base}/api/login`, { method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "user=direccion&password=clave-de-prueba-segura" });
  const headers = { cookie: login.headers.get("set-cookie"), "content-type": "application/json" };
  const request = (path, body, method = "POST") => fetch(`${base}${path}`, { method, headers, body: JSON.stringify(body) });
  for (const [staffId, service] of [["test-person-a", "Area A"], ["test-person-b", "Area B"]]) assert.equal((await request("/api/continuidad/private-contacts", { staffId, name: staffId, service, address: "", phone: "2604556677", verifyAddress: false })).status, 200);
  const groupResponse = await request("/api/personal/groups", { name: "Jefes prueba", scope: "MIXED", memberIds: ["test-person-a", "test-person-b", "test-person-a"] });
  assert.equal(groupResponse.status, 200);
  const { group } = await groupResponse.json();
  assert.deepEqual(group.memberIds, ["test-person-a", "test-person-b"]);
  assert.equal((await request("/api/personal/groups", { name: "Área prueba", scope: "SERVICE", service: "Area A", memberIds: group.memberIds })).status, 400);
  assert.equal((await request("/api/personal/groups", { name: "No existe", scope: "MIXED", memberIds: ["unknown-staff"] })).status, 400);
  const equivalentArea = await request("/api/personal/groups", { name: "Misma área", scope: "SERVICE", service: "ÁREA A", memberIds: ["test-person-a"] });
  assert.equal(equivalentArea.status, 200);
  const equivalentId = (await equivalentArea.json()).group.id;
  await request("/api/personal/groups", { id: equivalentId }, "DELETE");
  const drafted = await request("/api/personal/groups", { id: group.id, text: "Aviso de prueba no enviado" }, "PATCH");
  assert.equal(drafted.status, 200);
  const groups = await fetch(`${base}/api/personal/groups`, { headers });
  assert.equal((await groups.json()).groups[0].draft, "Aviso de prueba no enviado");
  const encrypted = readFileSync(join(ctx.root, "data", "continuidad", "staff-groups.enc.json"), "utf8");
  assert.doesNotMatch(encrypted, /Jefes prueba|test-person|Aviso de prueba/);
  const viewer = await fetch(`${base}/api/login`, { method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "user=consulta&password=clave-de-prueba-segura" });
  const forbidden = await fetch(`${base}/api/personal/directory`, { headers: { cookie: viewer.headers.get("set-cookie") } });
  assert.equal(forbidden.status, 403);
  const blocked = await fetch(`${base}/api/personal/groups`, { headers: { cookie: viewer.headers.get("set-cookie") } });
  assert.equal(blocked.status, 403);
  assert.equal((await request("/api/personal/groups", { id: group.id }, "DELETE")).status, 200);
  const directory = await fetch(`${base}/api/personal/directory`, { headers });
  assert.equal((await directory.json()).people.filter((p) => p.staffId.startsWith("test-person-")).length, 2);
}));

test("patient identity requires an authorized human and an occupied known bed", () => running(async (base) => {
  const login = await fetch(`${base}/api/login`, { method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "user=direccion&password=clave-de-prueba-segura" });
  const cookie = login.headers.get("set-cookie");
  const missing = await fetch(`${base}/api/identity/confirm`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ slug: "clinica-1", cama: "999", patient: "NOMBRE" }) });
  assert.equal(missing.status, 404);
  const confirmed = await fetch(`${base}/api/identity/confirm`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ slug: "clinica-1", cama: "101", patient: "PACIENTE PRUEBA" }) });
  assert.equal(confirmed.status, 200);
  const body = await confirmed.json();
  assert.equal(body.mark.source, "HUMAN_CONFIRMED");
  assert.equal(body.mark.confirmedBy, "direccion");
  const marks = await fetch(`${base}/api/identity/marks`, { headers: { cookie } });
  assert.equal((await marks.json()).marks.length, 1);
}));

test("guard swap is server-validated, persisted and audited", () => running(async (base) => {
  const login = await fetch(`${base}/api/login`, { method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "user=direccion&password=clave-de-prueba-segura" });
  const cookie = login.headers.get("set-cookie");
  const payload = { docId: "abc12345", dateA: "2026-09-21", dateB: "2026-09-22", a: "PEREZ", b: "GOMEZ", beforeA: "PEREZ", beforeB: "GOMEZ", afterA: "GOMEZ", afterB: "PEREZ" };
  const changed = await fetch(`${base}/api/catalog/change`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify(payload) });
  assert.equal(changed.status, 200);
  const body = await changed.json();
  assert.equal(body.change.actor, "direccion");
  assert.equal(body.override.shifts[0].text, "GOMEZ");
  const stale = await fetch(`${base}/api/catalog/change`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify(payload) });
  assert.equal(stale.status, 409);
  const state = await fetch(`${base}/api/catalog/state`, { headers: { cookie } });
  const persisted = await state.json();
  assert.equal(persisted.changes.length, 1);
  assert.equal(persisted.overrides.docs.abc12345.shifts[1].text, "PEREZ");
}));

test("emergency is server-authorized, reasoned and persisted", () => running(async (base) => {
  const login = await fetch(`${base}/api/login`, { method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "user=direccion&password=clave-de-prueba-segura" });
  const cookie = login.headers.get("set-cookie");
  const invalid = await fetch(`${base}/api/continuidad/emergency`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ on: true, reason: "x" }) });
  assert.equal(invalid.status, 400);
  const activated = await fetch(`${base}/api/continuidad/emergency`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ on: true, reason: "simulacro autorizado" }) });
  assert.equal(activated.status, 200);
  assert.equal((await activated.json()).emergency, true);
  const state = await fetch(`${base}/api/continuidad/control`, { headers: { cookie } });
  assert.equal((await state.json()).emergency, true);
}));

test("staff updates preserve prior transport data and validate availability", () => running(async (base) => {
  const login = await fetch(`${base}/api/login`, { method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "user=direccion&password=clave-de-prueba-segura" });
  const cookie = login.headers.get("set-cookie");
  const headers = { cookie, "content-type": "application/json" };
  const first = await fetch(`${base}/api/continuidad/staff`, {
    method: "POST", headers,
    body: JSON.stringify({ staffId: "guardia--persona-prueba", patch: { transport_status: "CAN_DRIVE", pickup_id: "plaza_sm", vehicle_available: true, vehicle_capacity: 4, can_transport_others: true, availability_status: "CAN_SUPPORT_OTHER_SERVICE", support_service: "uco", disaster_support_status: "YES", disaster_support_areas: ["guardia-triage", "logistica-insumos"] } }),
  });
  assert.equal(first.status, 200);
  const second = await fetch(`${base}/api/continuidad/staff`, {
    method: "POST", headers,
    body: JSON.stringify({ staffId: "guardia--persona-prueba", patch: { operational_zone: "centro" } }),
  });
  assert.equal(second.status, 200);
  const state = await (await fetch(`${base}/api/continuidad/control`, { headers: { cookie } })).json();
  const mark = state.staffMarks.find((item) => item.staff_id === "guardia--persona-prueba");
  assert.equal(mark.transport_status, "CAN_DRIVE");
  assert.equal(mark.pickup_id, "plaza_sm");
  assert.equal(mark.vehicle_capacity, 4);
  assert.equal(mark.availability_status, "CAN_SUPPORT_OTHER_SERVICE");
  assert.equal(mark.support_service, "uco");
  assert.equal(mark.disaster_support_status, "YES");
  assert.deepEqual(mark.disaster_support_areas, ["guardia-triage", "logistica-insumos"]);
  assert.equal(mark.operational_zone, "centro");

  const invalid = await fetch(`${base}/api/continuidad/staff`, {
    method: "POST", headers,
    body: JSON.stringify({ staffId: "guardia--persona-prueba", patch: { availability_status: "INVENTADA" } }),
  });
  assert.equal(invalid.status, 400);

  const invalidAreas = await fetch(`${base}/api/continuidad/staff`, {
    method: "POST", headers,
    body: JSON.stringify({ staffId: "guardia--persona-prueba", patch: { disaster_support_status: "YES", disaster_support_areas: ["área inválida con espacios"] } }),
  });
  assert.equal(invalidAreas.status, 400);
}));

test("secrets cannot be configured from the browser and unsigned WhatsApp is closed", () => running(async (base) => {
  const login = await fetch(`${base}/api/login`, { method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "user=direccion&password=clave-de-prueba-segura" });
  const cookie = login.headers.get("set-cookie");
  const config = await fetch(`${base}/api/whatsapp/config`, { method: "POST", headers: { cookie } });
  assert.equal(config.status, 405);
  const webhook = await fetch(`${base}/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=x&hub.challenge=y`);
  assert.equal(webhook.status, 503);
}));
