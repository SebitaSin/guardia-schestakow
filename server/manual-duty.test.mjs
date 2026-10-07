import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHospitalServer } from "./app.mjs";
import { hashPassword } from "./auth.mjs";

async function running(fn) {
  const root = mkdtempSync(join(tmpdir(), "sch-manual-test-"));
  const distDir = join(root, "dist"), dataDir = join(root, "data");
  mkdirSync(distDir); mkdirSync(join(dataDir, "mail"), { recursive: true });
  writeFileSync(join(distDir, "index.html"), "<!doctype html>");
  writeFileSync(join(root, "catalog.json"), JSON.stringify({ documents: [] }));
  writeFileSync(join(root, "internacion.json"), JSON.stringify({ beds: [] }));
  writeFileSync(join(dataDir, "mail", "reclamos.json"), JSON.stringify({ enabled: false, month: "2026-10", services: { demo: { to: ["a@example.org"], status: "pendiente", sent: 0, lastSent: null } } }));
  const passwordHash = hashPassword("clave-de-prueba-segura", "00112233445566778899aabbccddeeff");
  const users = [{ id: "direccion", name: "Dirección", role: "DIRECTION", staffId: null, passwordHash }, { id: "consulta", name: "Consulta", role: "VIEWER", staffId: null, passwordHash }];
  const server = createHospitalServer({ distDir, dataDir, catalogFile: join(root, "catalog.json"), internacionFile: join(root, "internacion.json"), authConfig: { secret: "s".repeat(32), users, secureCookie: false, sessionHours: 8 }, waConfig: { verifyToken: "", accessToken: "", appSecret: "", phoneNumberId: "", groupId: "", graphVersion: "" } });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const login = async (user) => (await fetch(`${base}/api/login`, { method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded" }, body: `user=${user}&password=clave-de-prueba-segura` })).headers.get("set-cookie");
  const post = (cookie, path, body) => fetch(`${base}${path}`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify(body) });
  try { await fn({ base, login, post }); }
  finally { await new Promise((resolve) => server.close(resolve)); rmSync(root, { recursive: true, force: true }); }
}

test("la guardia editada a mano se guarda, se publica y se puede quitar", () => running(async ({ base, login, post }) => {
  const cookie = await login("direccion");
  assert.equal((await post(await login("consulta"), "/api/guardias/manual", { slug: "uco", date: "2026-10-06", text: "Perez" })).status, 403);
  assert.equal((await post(cookie, "/api/guardias/manual", { slug: "../x", date: "2026-10-06", text: "Perez" })).status, 400);
  assert.equal((await post(cookie, "/api/guardias/manual", { slug: "uco", date: "hoy", text: "Perez" })).status, 400);
  assert.equal((await post(cookie, "/api/guardias/manual", { slug: "uco", date: "2026-10-06", text: "Perez 08-20 · Gomez" })).status, 200);
  let live = await (await fetch(`${base}/api/catalog/live`, { headers: { cookie } })).json();
  assert.equal(live.manual["2026-10-06|uco"].text, "Perez 08-20 · Gomez");
  assert.equal(live.manual["2026-10-06|uco"].by, "direccion");
  assert.equal((await post(cookie, "/api/guardias/manual", { slug: "uco", date: "2026-10-06", text: "" })).status, 200);
  live = await (await fetch(`${base}/api/catalog/live`, { headers: { cookie } })).json();
  assert.deepEqual(live.manual, {});
}));

test("el reclamo de un servicio se cancela y se reanuda", () => running(async ({ base, login, post }) => {
  const cookie = await login("direccion");
  assert.equal((await post(cookie, "/api/reclamos/pause", { slug: "nadie", paused: true })).status, 400);
  assert.deepEqual(await (await post(cookie, "/api/reclamos/pause", { slug: "demo", paused: true })).json(), { slug: "demo", paused: true });
  let live = await (await fetch(`${base}/api/catalog/live`, { headers: { cookie } })).json();
  assert.equal(live.reclamos.services.demo.status, "cancelado");
  await post(cookie, "/api/reclamos/pause", { slug: "demo", paused: false });
  live = await (await fetch(`${base}/api/catalog/live`, { headers: { cookie } })).json();
  assert.equal(live.reclamos.services.demo.status, "pendiente");
}));
