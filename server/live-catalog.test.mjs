import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHospitalServer } from "./app.mjs";
import { hashPassword } from "./auth.mjs";
import { createMailRunner, mailSyncMinutes, scheduleMailSync } from "./scheduler.mjs";

async function withServer(mailRunner, fn) {
  const root = mkdtempSync(join(tmpdir(), "sch-live-test-"));
  const distDir = join(root, "dist"); const dataDir = join(root, "data");
  mkdirSync(distDir); mkdirSync(dataDir);
  writeFileSync(join(distDir, "index.html"), "<!doctype html>");
  const passwordHash = hashPassword("clave-de-prueba-segura", "00112233445566778899aabbccddeeff");
  const authConfig = { secret: "s".repeat(32), users: [{ id: "consulta", name: "Consulta", role: "VIEWER", staffId: null, passwordHash }], secureCookie: false, sessionHours: 8 };
  const waConfig = { verifyToken: "", accessToken: "", appSecret: "", phoneNumberId: "", groupId: "", graphVersion: "" };
  const server = createHospitalServer({ distDir, dataDir, authConfig, waConfig, mailRunner });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const login = await fetch(`${base}/api/login`, { method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "user=consulta&password=clave-de-prueba-segura" });
  const cookie = login.headers.get("set-cookie").split(";")[0];
  try { await fn({ base, cookie, dataDir }); }
  finally { await new Promise((resolve) => server.close(resolve)); rmSync(root, { recursive: true, force: true }); }
}

test("live catalog is private, empty by default and serves what the reader published", () => withServer(null, async ({ base, cookie, dataDir }) => {
  assert.equal((await fetch(`${base}/api/catalog/live`)).status, 401);
  const empty = await (await fetch(`${base}/api/catalog/live`, { headers: { cookie } })).json();
  assert.deepEqual(empty.documents, []);
  assert.equal(empty.generatedAt, null);
  mkdirSync(join(dataDir, "catalog"));
  writeFileSync(join(dataDir, "catalog", "live.json"), JSON.stringify({ generatedAt: "2026-10-05T00:00:00-03:00", documents: [{ id: "abc", departments: ["guardia"], year: 2026, month: 10, shifts: [{ date: "2026-10-05", text: "PRUEBA" }] }], unread: [{ id: "x", filename: "foto.jpg", mailDate: "2026-10-01", departments: [], reason: "interno" }] }));
  const live = await (await fetch(`${base}/api/catalog/live`, { headers: { cookie } })).json();
  assert.equal(live.documents.length, 1);
  assert.deepEqual(live.unread, [{ id: "x", filename: "foto.jpg", mailDate: "2026-10-01", departments: [] }]);
  assert.equal((await fetch(`${base}/api/catalog/refresh`, { method: "POST", headers: { cookie } })).status, 503);
}));

test("refresh starts the mail runner and a failing runner never breaks the server", () => {
  let calls = 0;
  const runner = { running: false, run() { calls += 1; throw new Error("spawn EPERM"); } };
  return withServer(runner, async ({ base, cookie }) => {
    const response = await fetch(`${base}/api/catalog/refresh`, { method: "POST", headers: { cookie } });
    assert.equal(response.status, 202);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(calls, 1);
    assert.equal((await fetch(`${base}/api/health`)).status, 200);
  });
});

test("mail runner survives a synchronous spawn failure and can run again", async () => {
  let attempts = 0;
  const runner = createMailRunner({ root: tmpdir(), dataDir: tmpdir(), env: {}, spawnImpl: () => { attempts += 1; const error = new Error("spawn EPERM"); error.code = "EPERM"; throw error; } });
  assert.deepEqual(await runner.run(), { started: true, ok: false });
  assert.equal(runner.running, false);
  assert.deepEqual(await runner.run(), { started: true, ok: false });
  assert.equal(attempts, 2);
  let killed = false;
  const hung = createMailRunner({ root: tmpdir(), dataDir: tmpdir(), env: {}, timeoutMs: 20, spawnImpl: () => { const handlers = {}; return { once(name, fn) { handlers[name] = fn; }, kill() { killed = true; handlers.exit?.(null); } }; } });
  const keepAlive = setInterval(() => undefined, 5);
  assert.deepEqual(await hung.run(), { started: true, ok: false, code: null });
  clearInterval(keepAlive);
  assert.equal(killed, true);
  assert.equal(hung.running, false);
  const stop = scheduleMailSync({ run() { throw new Error("boom"); } }, { GMAIL_SYNC_ENABLED: "true" });
  stop();
  assert.equal(mailSyncMinutes({}), 10);
  assert.equal(mailSyncMinutes({ GMAIL_SYNC_HOURS: "24" }), 10);
  assert.equal(mailSyncMinutes({ GMAIL_SYNC_MINUTES: "1" }), 2);
});
