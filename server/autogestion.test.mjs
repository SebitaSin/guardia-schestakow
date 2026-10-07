import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { addressKey, createAutogestion, maskedName, readAutogestion, samePhone } from "./autogestion.mjs";
import { readPrivateContacts, upsertPrivateContact } from "./private-contacts.mjs";
import { readPrivateLocations, upsertPrivateLocation } from "./private-locations.mjs";
import { createHospitalServer } from "./app.mjs";
import { createFormProxy } from "../scripts/enlace-personal.mjs";

const SECRET = "s".repeat(40);
const geocodeOk = async () => ({ ok: true, json: async () => ({ status: "OK", results: [{ formatted_address: "Calle Nueva 500, San Rafael, Mendoza", types: ["street_address"], geometry: { location: { lat: -34.6, lng: -68.34 } } }] }) });

function setup(extra = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), "sch-autogestion-"));
  upsertPrivateContact(dataDir, SECRET, { staffId: "uti--perez", name: "PEREZ JUANA MARIA", service: "UTI", dni: "20111222", address: "Av. Mitre 120", phone: "260 4-551234" }, "direccion");
  upsertPrivateContact(dataDir, SECRET, { staffId: "uti--lopez", name: "LOPEZ ANA", service: "UTI", dni: "30111222", address: "Day 45", phone: "2604667788" }, "direccion");
  upsertPrivateLocation(dataDir, SECRET, { staffId: "uti--perez", address: "Av. Mitre 120, San Rafael", lat: -34.61, lng: -68.33, transportMode: "UNKNOWN" }, "direccion");
  let calls = 0;
  const auto = createAutogestion({ dataDir, secret: SECRET, maps: { serverKey: "k" }, fetchImpl: async (...args) => { calls += 1; return geocodeOk(...args); }, config: { enabled: true, geocodePerDay: 2 }, ...extra });
  const call = async (path, body, ip = "1.1.1.1") => {
    let out;
    await auto.handlePublic({ method: "POST", headers: {} }, {}, { pathname: `/api/autogestion/publico/${path}` }, ip, { send: () => {}, json: (_res, status, value) => { out = { status, ...value }; }, readBody: async () => Buffer.from(JSON.stringify(body)) });
    return out;
  };
  return { dataDir, auto, call, geocodes: () => calls, done: () => rmSync(dataDir, { recursive: true, force: true }) };
}
const answer = { servicio: "UTI", rol: "Enfermera", ayuda: ["triage", "inventado"], address: "Av. Mitre 120", phone: "2604551234", transportMode: "CAR", vehiculoSeguro: true, dispuesto: true, lugares: 2 };

test("comparaciones: mismo domicilio escrito distinto, mismo celular con otro formato, nombre enmascarado", () => {
  assert.equal(addressKey("Av. Mitre 120"), addressKey("mitre 120, San Rafael"));
  assert.notEqual(addressKey("Mitre 120"), addressKey("Mitre 210"));
  assert.equal(samePhone("260 4-551234", "+54 9 2604 551234"), true);
  assert.equal(samePhone("2604551234", "2604551235"), false);
  assert.equal(maskedName("PEREZ JUANA MARIA"), "PEREZ J. M.");
});

test("con el DNI sólo se ve nombre enmascarado y servicio; domicilio y celular piden los últimos 4 números", async () => {
  const t = setup();
  try {
    const found = await t.call("buscar", { dni: "20.111.222" });
    assert.deepEqual([found.status, found.encontrado, found.nombre, found.servicio, found.pideClave], [200, true, "PEREZ J. M.", "UTI", true]);
    assert.equal(JSON.stringify(found).includes("Mitre"), false);
    assert.equal(JSON.stringify(found).includes("551234"), false);
    assert.equal((await t.call("verificar", { token: found.token, ultimos4: "0000" })).status, 403);
    const shown = await t.call("verificar", { token: found.token, ultimos4: "1234" });
    assert.deepEqual([shown.status, shown.address, shown.phone], [200, "Av. Mitre 120", "260 4-551234"]);
  } finally { t.done(); }
});

test("cinco intentos fallidos bloquean ese DNI aunque después acierte", async () => {
  const t = setup();
  try {
    const found = await t.call("buscar", { dni: "20111222" });
    for (let i = 0; i < 5; i += 1) assert.equal((await t.call("verificar", { token: found.token, ultimos4: "0000" })).status, 403);
    assert.equal((await t.call("verificar", { token: found.token, ultimos4: "1234" })).status, 429);
  } finally { t.done(); }
});

test("verificada: guarda transporte y traslado solidario; responder dos veces no duplica", async () => {
  const t = setup();
  try {
    for (const lugares of [2, 3]) {
      const found = await t.call("buscar", { dni: "20111222" });
      await t.call("verificar", { token: found.token, ultimos4: "1234" });
      const saved = await t.call("guardar", { token: found.token, ...answer, lugares });
      assert.deepEqual([saved.status, saved.revision, saved.progreso.respondieron, saved.progreso.servicio.respondieron, saved.progreso.servicio.total], [200, false, 1, 1, 2]);
    }
    const point = readPrivateLocations(t.dataDir, SECRET).find((item) => item.staffId === "uti--perez");
    assert.deepEqual([point.transportMode, point.solidario.dispuesto, point.solidario.lugares, point.solidario.por], ["CAR", true, 3, "autogestión"]);
    assert.equal(readPrivateContacts(t.dataDir, SECRET).length, 2);
    assert.equal(readAutogestion(t.dataDir, SECRET).respuestas["uti--perez"].veces, 2);
    assert.equal(t.geocodes(), 0); // el domicilio no cambió: no se vuelve a ubicar
  } finally { t.done(); }
});

test("sin verificar y con otro celular: no pisa lo registrado, queda para que Dirección decida", async () => {
  const t = setup();
  try {
    const found = await t.call("buscar", { dni: "20111222" });
    const saved = await t.call("guardar", { token: found.token, servicio: "Guardia", rol: "Enfermera", address: "Calle Nueva 500", phone: "2604999000", transportMode: "PUBLIC_TRANSPORT", necesitaTraslado: true });
    assert.deepEqual([saved.status, saved.revision], [200, true]);
    let contact = readPrivateContacts(t.dataDir, SECRET).find((item) => item.staffId === "uti--perez");
    assert.deepEqual([contact.address, contact.phone], ["Av. Mitre 120", "260 4-551234"]);
    const estado = t.auto.estado();
    assert.deepEqual([estado.respondieron, estado.verificados, estado.pendientes.length, estado.pendientes[0].campos], [1, 0, 1, ["address", "phone", "service"]]);
    assert.equal(readPrivateLocations(t.dataDir, SECRET)[0].solidario.necesitaTraslado, true); // la declaración sí se toma
    await t.auto.resolver({ id: estado.pendientes[0].id, accion: "aceptar" }, "direccion");
    contact = readPrivateContacts(t.dataDir, SECRET).find((item) => item.staffId === "uti--perez");
    assert.deepEqual([contact.address, contact.phone, t.auto.estado().pendientes.length], ["Calle Nueva 500", "2604999000", 0]);
    assert.equal(readPrivateLocations(t.dataDir, SECRET)[0].address, "Calle Nueva 500, San Rafael, Mendoza");
  } finally { t.done(); }
});

test("escribir el mismo celular registrado alcanza como prueba: el domicilio nuevo se guarda y se ubica", async () => {
  const t = setup();
  try {
    const found = await t.call("buscar", { dni: "30111222" });
    const saved = await t.call("guardar", { token: found.token, servicio: "Guardia", rol: "Médica", ayuda: ["guardia", "triage"], address: "Calle Nueva 500", phone: "0260 15 4667788", transportMode: "WALKING", necesitaTraslado: false });
    assert.equal(saved.revision, false);
    assert.equal(readPrivateContacts(t.dataDir, SECRET).find((item) => item.staffId === "uti--lopez").address, "Calle Nueva 500");
    assert.equal(readPrivateLocations(t.dataDir, SECRET).some((item) => item.staffId === "uti--lopez" && item.solidario), true);
    assert.equal(t.geocodes(), 1);
    const lopez = readPrivateContacts(t.dataDir, SECRET).find((item) => item.staffId === "uti--lopez");
    assert.deepEqual([lopez.service, lopez.role], ["Guardia", "Médica"]);
    const estado = t.auto.estado();
    assert.deepEqual(estado.ayuda.filter((item) => item.personas.length).map((item) => [item.clave, item.personas[0].nombre]), [["triage", "LOPEZ ANA"], ["guardia", "LOPEZ ANA"]]);
  } finally { t.done(); }
});

test("un DNI fuera de la nómina queda pendiente y recién entra cuando Dirección lo acepta", async () => {
  const t = setup();
  try {
    const found = await t.call("buscar", { dni: "40111222" });
    assert.deepEqual([found.encontrado, found.servicios], [false, ["UTI"]]);
    assert.equal((await t.call("guardar", { token: found.token, ...answer })).status, 400); // falta nombre
    for (let i = 0; i < 2; i += 1) await t.call("guardar", { token: (i ? await t.call("buscar", { dni: "40111222" }) : found).token, ...answer, nombre: "GOMEZ LUIS" });
    assert.equal(readPrivateContacts(t.dataDir, SECRET).length, 2);
    const estado = t.auto.estado();
    assert.deepEqual([estado.pendientes.length, estado.pendientes[0].tipo], [1, "nueva"]);
    await t.auto.resolver({ id: estado.pendientes[0].id, accion: "aceptar" }, "direccion");
    assert.equal(readPrivateContacts(t.dataDir, SECRET).some((item) => item.staffId === "autogestion--40111222" && item.name === "GOMEZ LUIS"), true);
  } finally { t.done(); }
});

test("tope diario de ubicaciones en el mapa: pasado el tope responde igual y queda sin ubicar", async () => {
  const t = setup({ config: { enabled: true, geocodePerDay: 0 } });
  try {
    const found = await t.call("buscar", { dni: "30111222" });
    await t.call("guardar", { token: found.token, servicio: "UTI", rol: "Médica", address: "Day 45", phone: "2604667788", transportMode: "CAR", vehiculoSeguro: true, dispuesto: true, lugares: 1 });
    assert.deepEqual([t.geocodes(), t.auto.estado().sinUbicar.length], [0, 1]);
    upsertPrivateLocation(t.dataDir, SECRET, { staffId: "uti--lopez", address: "Day 45, San Rafael", lat: -34.6, lng: -68.3, transportMode: "CAR" }, "direccion");
    assert.equal(t.auto.estado().sinUbicar.length, 0);
    assert.equal(readPrivateLocations(t.dataDir, SECRET).find((item) => item.staffId === "uti--lopez").solidario.dispuesto, true);
  } finally { t.done(); }
});

test("datos inválidos y sesión vencida se rechazan", async () => {
  let clock = Date.now();
  const t = setup({ now: () => clock });
  try {
    const found = await t.call("buscar", { dni: "20111222" });
    assert.equal((await t.call("buscar", { dni: "12" })).status, 400);
    assert.equal((await t.call("guardar", { token: found.token, ...answer, phone: "llamame" })).error, "telefono");
    assert.equal((await t.call("guardar", { token: found.token, ...answer, transportMode: "UNKNOWN" })).error, "transporte");
    clock += 31 * 60_000;
    assert.equal((await t.call("guardar", { token: found.token, ...answer })).status, 401);
  } finally { t.done(); }
});

test("por el servidor: la página abre sin usuario, el resto de la app sigue pidiendo acceso", async () => {
  const t = setup();
  const server = createHospitalServer({ distDir: t.dataDir, dataDir: t.dataDir, authConfig: { users: [], secret: SECRET, trustProxy: false }, waConfig: {} });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const page = await fetch(`${base}/mis-datos`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Tus datos para emergencias/);
    assert.match(await (await fetch(`${base}/mis-datos.js`)).text(), /autogestion\/publico/);
    const found = await (await fetch(`${base}/api/autogestion/publico/buscar`, { method: "POST", body: JSON.stringify({ dni: "20111222" }) })).json();
    assert.equal(found.nombre, "PEREZ J. M.");
    assert.equal((await fetch(`${base}/api/autogestion/publico/buscar`, { method: "POST", headers: { origin: "https://otro.sitio" }, body: "{}" })).status, 403);
    assert.equal((await fetch(`${base}/api/autogestion/estado`)).status, 401);
    assert.equal((await fetch(`${base}/api/continuidad/private-contacts`)).status, 401);
    assert.equal((await fetch(`${base}/`, { redirect: "manual" })).status, 302);
  } finally { server.close(); t.done(); }
});

test("el pasamanos del enlace sólo deja pasar la ficha: el resto de la app no sale", async () => {
  const t = setup();
  const server = createHospitalServer({ distDir: t.dataDir, dataDir: t.dataDir, authConfig: { users: [], secret: SECRET, trustProxy: false }, waConfig: {} });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const proxy = createFormProxy({ appPort: server.address().port });
  await new Promise((resolve) => proxy.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${proxy.address().port}`;
  try {
    assert.match(await (await fetch(`${base}/mis-datos`)).text(), /Tus datos para emergencias/);
    assert.equal((await fetch(`${base}/`, { redirect: "manual" })).headers.get("location"), "/mis-datos");
    for (const path of ["/login", "/api/health", "/api/continuidad/private-contacts", "/api/autogestion/estado", "/assets/x.js"]) assert.equal((await fetch(`${base}${path}`)).status, 404, path);
    const found = await (await fetch(`${base}/api/autogestion/publico/buscar`, { method: "POST", body: JSON.stringify({ dni: "20111222" }) })).json();
    assert.equal(found.nombre, "PEREZ J. M.");
    // El tope por dirección cuenta a cada persona por separado, no al pasamanos.
    let blocked = 0;
    for (let i = 0; i < 85; i += 1) if ((await fetch(`${base}/api/autogestion/publico/buscar`, { method: "POST", headers: { "cf-connecting-ip": "9.9.9.9" }, body: JSON.stringify({ dni: "20111222" }) })).status === 429) blocked += 1;
    assert.equal(blocked, 5);
    assert.equal((await fetch(`${base}/api/autogestion/publico/buscar`, { method: "POST", headers: { "cf-connecting-ip": "8.8.8.8" }, body: JSON.stringify({ dni: "20111222" }) })).status, 200);
  } finally { proxy.close(); server.close(); t.done(); }
});
